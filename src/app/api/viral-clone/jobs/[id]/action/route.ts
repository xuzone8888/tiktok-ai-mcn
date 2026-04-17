/**
 * Viral Clone — Job Actions
 * POST /api/viral-clone/jobs/[id]/action
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';
import { analyzeSourceVideoV2, analyzeFromPrompt } from '@/lib/viral-clone/analyzer';
import { generateMasterPlan, generateCloneSpec } from '@/lib/viral-clone/planner';
import { splitSourceVideo } from '@/lib/viral-clone/stitcher';
import { segmentByTimeline } from '@/lib/viral-clone/segmenter';
import { orchestrateJob } from '@/lib/viral-clone/orchestrator';
import { getProviderSnapshot } from '@/lib/viral-clone/providers/provider-registry';
import type { AspectRatio, MasterPlan, CloneSpecV2 } from '@/types/viral-clone';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;
    const vc = createVCAdminClient();

    // 验证 Job 归属
    const { data: job } = await vc
      .from('viral_clone_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (!job) {
      return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    }

    switch (action) {
      case 'plan': {
        if (!['ingesting', 'analyzing', 'created'].includes(job.status)) {
          return NextResponse.json({ success: false, error: `当前状态 ${job.status} 不能触发规划` }, { status: 400 });
        }

        await vc.from('viral_clone_jobs').update({ status: 'analyzing' }).eq('id', jobId);
        await vc.from('viral_clone_events').insert({ job_id: jobId, event_type: 'analysis_started', payload: {} });

        (async () => {
          try {
            const bg = createVCAdminClient();
            let analysis;
            let videoUrl = '';
            if (job.entry_type === 'upload' && job.source_asset_id) {
              const { data: asset } = await bg.from('viral_clone_assets').select('url').eq('id', job.source_asset_id).single();
              videoUrl = asset?.url || '';
              analysis = await analyzeSourceVideoV2(videoUrl);
            } else if (job.entry_type === 'link' && job.source_asset_id) {
              const { data: asset } = await bg.from('viral_clone_assets').select('url').eq('id', job.source_asset_id).single();
              videoUrl = asset?.url || '';
              analysis = await analyzeSourceVideoV2(videoUrl);
            } else {
              // prompt 入口 — 仍用 V1 creative mode
              const v1Analysis = await analyzeFromPrompt(body.prompt || 'generic product video');

              await bg.from('viral_clone_events').insert({ job_id: jobId, event_type: 'analysis_completed', payload: v1Analysis });

              const { data: anchors } = await bg.from('viral_clone_assets').select('url')
                .eq('user_id', user.id).eq('asset_type', 'anchor_frame')
                .order('created_at', { ascending: false }).limit(3);

              await bg.from('viral_clone_jobs').update({ status: 'planning' }).eq('id', jobId);

              const masterPlan = await generateMasterPlan({
                analysis: v1Analysis,
                aspectRatio: (job.aspect_ratio || '9:16') as AspectRatio,
                anchorUrls: anchors?.map((a: Record<string, unknown>) => a.url as string) || [],
                userPrompt: body.prompt,
                language: v1Analysis.language === 'zh' ? 'zh' : 'en',
              });

              await bg.from('viral_clone_jobs').update({
                status: 'awaiting_confirmation',
                confirmed_plan_snapshot: masterPlan,
                provider_capability_snapshot: getProviderSnapshot(),
                total_segments: masterPlan.segments.length,
              }).eq('id', jobId);

              await bg.from('viral_clone_events').insert({ job_id: jobId, event_type: 'plan_ready', payload: { segmentCount: masterPlan.segments.length } });
              return; // prompt 入口到此结束
            }

            // V2 clone mode
            await bg.from('viral_clone_events').insert({ job_id: jobId, event_type: 'analysis_completed', payload: { utterances: analysis.utterances.length, beats: analysis.visual_beats.length } });

            const { data: anchors } = await bg.from('viral_clone_assets').select('url')
              .eq('user_id', user.id).eq('asset_type', 'anchor_frame')
              .order('created_at', { ascending: false }).limit(3);

            await bg.from('viral_clone_jobs').update({ status: 'planning' }).eq('id', jobId);

            // 预切分 source clips
            const initialSegments = segmentByTimeline(analysis, analysis.suggested_segments, []);
            const clipUrls = await splitSourceVideo(
              videoUrl,
              initialSegments.map(s => ({ index: s.index, start_s: s.source_start_s, end_s: s.source_end_s }))
            );

            const cloneSpec = await generateCloneSpec({
              analysis,
              aspectRatio: (job.aspect_ratio || '9:16') as AspectRatio,
              anchorUrls: anchors?.map((a: Record<string, unknown>) => a.url as string) || [],
              videoUrl,
              clipUrls: clipUrls.length > 0 ? clipUrls : undefined,
              language: analysis.language === 'zh' ? 'zh' : 'en',
            });

            await bg.from('viral_clone_jobs').update({
              status: 'awaiting_confirmation',
              confirmed_plan_snapshot: cloneSpec,
              provider_capability_snapshot: getProviderSnapshot(),
              total_segments: cloneSpec.segments.length,
            }).eq('id', jobId);

            await bg.from('viral_clone_events').insert({ job_id: jobId, event_type: 'plan_ready', payload: { segmentCount: cloneSpec.segments.length, mode: 'clone' } });
          } catch (error) {
            const bg = createVCAdminClient();
            await bg.from('viral_clone_jobs').update({ status: 'failed', error_message: error instanceof Error ? error.message : String(error) }).eq('id', jobId);
          }
        })();

        return NextResponse.json({ success: true, data: { job_id: jobId, status: 'analyzing' } });
      }

      case 'confirm': {
        if (job.status !== 'awaiting_confirmation') {
          return NextResponse.json({ success: false, error: '当前状态不能确认方案' }, { status: 400 });
        }
        // 支持 V1 MasterPlan 和 V2 CloneSpecV2
        const rawPlan = job.confirmed_plan_snapshot;
        const isV2Plan = rawPlan && typeof rawPlan === 'object' && 'mode' in (rawPlan as Record<string, unknown>);

        let finalPlan = rawPlan;
        if (body.edited_plan && !isV2Plan) {
          // V1: 允许编辑 visual_goal
          const v1Plan = rawPlan as MasterPlan;
          finalPlan = { ...v1Plan, ...body.edited_plan, segments: body.edited_plan.segments || v1Plan.segments };
        } else if (isV2Plan) {
          // V2: 支持段数覆盖和台词微调
          const v2Plan = rawPlan as CloneSpecV2;
          let updatedPlan = { ...v2Plan };

          // 2/3/4 段数覆盖: 重新分段
          if (body.segment_count_override && [2, 3, 4].includes(body.segment_count_override)) {
            const { segmentByTimeline } = await import('@/lib/viral-clone/segmenter');
            const newSegments = segmentByTimeline(
              v2Plan.source_analysis,
              body.segment_count_override as 2 | 3 | 4,
              v2Plan.segments[0]?.ref_images || []
            );
            updatedPlan = { ...updatedPlan, segments: newSegments };
          }

          // 每段台词微调: body.edited_segments = [{ index, spoken_text_exact }]
          if (Array.isArray(body.edited_segments)) {
            updatedPlan.segments = updatedPlan.segments.map(seg => {
              const edit = body.edited_segments.find(
                (e: { index: number }) => e.index === seg.index
              );
              if (edit?.spoken_text_exact) {
                return { ...seg, spoken_text_exact: edit.spoken_text_exact };
              }
              return seg;
            });
          }

          finalPlan = updatedPlan;
        }

        const planSegCount = isV2Plan
          ? (finalPlan as CloneSpecV2).segments.length
          : (finalPlan as MasterPlan).segments.length;

        const updatePayload: Record<string, unknown> = {
          confirmed_plan_snapshot: finalPlan,
          total_segments: planSegCount,
        };
        // 保存用户选择的编排模式
        if (body.orchestration_mode && ['sequential', 'parallel_2', 'chain_extend'].includes(body.orchestration_mode)) {
          updatePayload.orchestration_mode = body.orchestration_mode;
        }
        await vc.from('viral_clone_jobs').update(updatePayload).eq('id', jobId);
        await vc.from('viral_clone_events').insert({ job_id: jobId, event_type: 'plan_confirmed', payload: { orchestration_mode: body.orchestration_mode || 'parallel_2' } });

        // 自动启动编排（确认并开始生成）
        console.log(`[VC Action] confirm received, auto_start=${body.auto_start}, jobId=${jobId}`);
        if (body.auto_start) {
          // 先同步落库 generating 状态 + 清除旧租约，再启动异步编排
          console.log(`[VC Action] auto_start=true, updating status to generating...`);
          const { error: updateErr } = await vc.from('viral_clone_jobs').update({
            status: 'generating',
            started_at: new Date().toISOString(),
            lease_owner: null,
            lease_expires_at: null,
          }).eq('id', jobId);
          if (updateErr) {
            console.error(`[VC Action] Failed to update status:`, updateErr);
          } else {
            console.log(`[VC Action] Status updated to generating, lease cleared, starting orchestration...`);
          }
          orchestrateJob(jobId).catch(e => console.error(`[VC] Orchestrate error:`, e));
          return NextResponse.json({ success: true, data: { job_id: jobId, status: 'generating', auto_started: true } });
        }

        return NextResponse.json({ success: true, data: { job_id: jobId } });
      }

      case 'orchestrate': {
        if (!['awaiting_confirmation', 'generating'].includes(job.status)) {
          return NextResponse.json({ success: false, error: `当前状态 ${job.status} 不能启动编排` }, { status: 400 });
        }
        // 先同步落库 generating 状态 + 清除旧租约
        await vc.from('viral_clone_jobs').update({
          status: 'generating',
          started_at: new Date().toISOString(),
          lease_owner: null,
          lease_expires_at: null,
        }).eq('id', jobId);
        orchestrateJob(jobId).catch(e => console.error(`[VC] Orchestrate error:`, e));
        return NextResponse.json({ success: true, data: { job_id: jobId, status: 'generating' } });
      }

      case 'retry-segment': {
        const { segment_id, override_provider } = body;
        if (!segment_id) return NextResponse.json({ success: false, error: '缺少 segment_id' }, { status: 400 });

        const updates: Record<string, unknown> = { status: 'queued', retry_count: 0, error_message: null, tech_qc: null, semantic_qc: null, continuity_qc: null };
        if (override_provider) updates.provider = override_provider;

        await vc.from('viral_clone_segments').update(updates).eq('id', segment_id).eq('job_id', jobId);

        if (job.status === 'manual_review' || job.status === 'failed') {
          orchestrateJob(jobId).catch(e => console.error(`[VC] Retry error:`, e));
        }
        return NextResponse.json({ success: true, data: { job_id: jobId, segment_id } });
      }

      case 'publish': {
        if (job.status !== 'completed' || !job.final_asset_id) {
          return NextResponse.json({ success: false, error: '任务未完成或没有最终成品' }, { status: 400 });
        }
        const { data: finalAsset } = await vc.from('viral_clone_assets').select('url').eq('id', job.final_asset_id).single();
        if (!finalAsset?.url) return NextResponse.json({ success: false, error: '找不到最终视频' }, { status: 404 });

        // 需要 account_ids 才能发布
        const { account_ids, caption, privacy_level } = body;
        if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
          // 没有选择账号 → 返回 video_url 让前端跳转到发布页
          return NextResponse.json({
            success: true,
            data: { job_id: jobId, video_url: finalAsset.url, ready_for_publish: true },
          });
        }

        // 从 confirmed_plan_snapshot 提取标题建议
        const planSnapshot = job.confirmed_plan_snapshot;
        const isV2Snap = planSnapshot && typeof planSnapshot === 'object' && 'mode' in (planSnapshot as Record<string, unknown>);
        let defaultTitle = caption || 'AI Generated Video';
        if (isV2Snap) {
          defaultTitle = caption || (planSnapshot as CloneSpecV2).source_analysis?.summary?.substring(0, 100) || defaultTitle;
        } else if (planSnapshot) {
          defaultTitle = caption || (planSnapshot as MasterPlan).full_script?.substring(0, 100) || defaultTitle;
        }

        // 创建 publish_task
        const userSupabase = await createClient();
        const { data: publishTask, error: ptError } = await userSupabase
          .from('publish_tasks')
          .insert({
            user_id: user.id,
            name: `爆款复制 · ${new Date().toLocaleDateString('zh-CN')}`,
            status: 'pending',
            title_template: defaultTitle,
            privacy_level: privacy_level || 'PUBLIC_TO_EVERYONE',
            allow_comment: true,
            allow_duet: true,
            allow_stitch: true,
            brand_content_toggle: false,
            brand_organic_toggle: false,
            is_aigc: true,
            batch_interval_seconds: 0,
            total_items: account_ids.length,
            pending_count: account_ids.length,
            published_count: 0,
            failed_count: 0,
          })
          .select()
          .single();

        if (ptError || !publishTask) {
          return NextResponse.json({ success: false, error: '创建发布任务失败: ' + (ptError?.message || '未知') }, { status: 500 });
        }

        // 创建 publish_task_items（每个账号一条）
        const items = account_ids.map((accountId: string) => ({
          task_id: publishTask.id,
          account_id: accountId,
          video_url: finalAsset.url,
          video_source: 'viral_clone',
          title: defaultTitle,
          status: 'pending',
          scheduled_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await userSupabase
          .from('publish_task_items')
          .insert(items);

        if (itemsError) {
          await userSupabase.from('publish_tasks').delete().eq('id', publishTask.id);
          return NextResponse.json({ success: false, error: '创建任务项失败' }, { status: 500 });
        }

        // 后台启动发布
        const { processPublishQueue } = await import('@/lib/publish-processor');
        processPublishQueue({
          taskId: publishTask.id,
          mode: 'immediate',
        }).catch(err => console.error('[VC Publish] Background error:', err));

        return NextResponse.json({
          success: true,
          data: {
            job_id: jobId,
            publish_task_id: publishTask.id,
            video_url: finalAsset.url,
            account_count: account_ids.length,
          },
        });
      }

      default:
        return NextResponse.json({ success: false, error: `未知 action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[VC Action] Error:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '服务器错误' }, { status: 500 });
  }
}
