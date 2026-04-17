/**
 * Viral Clone — 链接导入
 * POST /api/viral-clone/ingest/link
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';
import { ingestFromLink } from '@/lib/viral-clone/link-adapter';
import { analyzeSourceVideoV2 } from '@/lib/viral-clone/analyzer';
import { generateCloneSpec } from '@/lib/viral-clone/planner';
import { splitSourceVideo } from '@/lib/viral-clone/stitcher';
import { segmentByTimeline } from '@/lib/viral-clone/segmenter';
import { getProviderSnapshot } from '@/lib/viral-clone/providers/provider-registry';
import type { AspectRatio } from '@/types/viral-clone';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { url, aspect_ratio } = await request.json();

    if (!url) {
      return NextResponse.json({ success: false, error: '缺少视频链接' }, { status: 400 });
    }

    // 验证 URL 格式
    try { new URL(url); } catch {
      return NextResponse.json({ success: false, error: '无效的 URL 格式' }, { status: 400 });
    }

    const adminClient = createVCAdminClient();

    // 创建 Job（状态: ingesting）
    const { data: job, error: jobError } = await adminClient
      .from('viral_clone_jobs')
      .insert({
        user_id: user.id,
        entry_type: 'link',
        status: 'ingesting',
        source_url: url,
        aspect_ratio: aspect_ratio || '9:16',
      })
      .select()
      .single();

    if (jobError) {
      return NextResponse.json({ success: false, error: `创建任务失败: ${jobError.message}` }, { status: 500 });
    }

    // 写事件
    await adminClient
      .from('viral_clone_events')
      .insert({
        job_id: job.id,
        event_type: 'ingest_started',
        payload: { url },
      });

    // 异步导入（不阻塞响应）
    ingestFromLink(url, user.id).then(async (result) => {
      try {
        const bgAdmin = createVCAdminClient();
        if (result.success && result.videoUrl) {
          // 创建 source_video 资产
          const { data: asset } = await bgAdmin
            .from('viral_clone_assets')
            .insert({
              user_id: user.id,
              asset_type: 'source_video',
              url: result.videoUrl,
              oss_key: result.ossKey,
              content_type: 'video/mp4',
              size_bytes: result.sizeBytes || 0,
            })
            .select()
            .single();

          // 更新 Job
          await bgAdmin
            .from('viral_clone_jobs')
            .update({
              source_asset_id: asset?.id,
              status: 'analyzing',
            })
            .eq('id', job.id);

          await bgAdmin
            .from('viral_clone_events')
            .insert({
              job_id: job.id,
              event_type: 'ingest_completed',
              payload: { assetId: asset?.id, platform: result.platform },
            });

          // [P0 Fix] 自动推进: 分析 → 规划 → 等待确认
          try {
            await bgAdmin.from('viral_clone_events').insert({ job_id: job.id, event_type: 'analysis_started', payload: {} });
            const analysis = await analyzeSourceVideoV2(result.videoUrl);
            await bgAdmin.from('viral_clone_events').insert({ job_id: job.id, event_type: 'analysis_completed', payload: { utterances: analysis.utterances.length, beats: analysis.visual_beats.length } });

            // 获取锚定图
            const { data: anchors } = await bgAdmin
              .from('viral_clone_assets')
              .select('url')
              .eq('user_id', user.id)
              .eq('asset_type', 'anchor_frame')
              .order('created_at', { ascending: false })
              .limit(3);

            await bgAdmin.from('viral_clone_jobs').update({ status: 'planning' }).eq('id', job.id);

            // 预切分：source clips
            const initialSegments = segmentByTimeline(analysis, analysis.suggested_segments, []);
            const clipUrls = await splitSourceVideo(
              result.videoUrl,
              initialSegments.map(s => ({ index: s.index, start_s: s.source_start_s, end_s: s.source_end_s }))
            );

            const cloneSpec = await generateCloneSpec({
              analysis,
              aspectRatio: (aspect_ratio || '9:16') as AspectRatio,
              anchorUrls: anchors?.map((a: Record<string, unknown>) => a.url as string) || [],
              videoUrl: result.videoUrl,
              clipUrls: clipUrls.length > 0 ? clipUrls : undefined,
              language: analysis.language === 'zh' ? 'zh' : 'en',
            });

            await bgAdmin.from('viral_clone_jobs').update({
              status: 'awaiting_confirmation',
              confirmed_plan_snapshot: cloneSpec,
              provider_capability_snapshot: getProviderSnapshot(),
              total_segments: cloneSpec.segments.length,
            }).eq('id', job.id);

            await bgAdmin.from('viral_clone_events').insert({ job_id: job.id, event_type: 'plan_ready', payload: { segmentCount: cloneSpec.segments.length, mode: 'clone' } });
          } catch (planError) {
            console.error('[VC Ingest Link] Planning error:', planError);
            await bgAdmin.from('viral_clone_jobs').update({
              status: 'failed',
              error_message: planError instanceof Error ? planError.message : '规划失败',
            }).eq('id', job.id);
          }
        } else {
          // 导入失败
          await bgAdmin
            .from('viral_clone_jobs')
            .update({
              status: 'failed',
              error_message: result.fallbackMessage || result.error || '链接导入失败',
            })
            .eq('id', job.id);

          await bgAdmin
            .from('viral_clone_events')
            .insert({
              job_id: job.id,
              event_type: 'ingest_failed',
              payload: {
                error: result.error,
                fallback: result.fallbackMessage,
              },
            });
        }
      } catch (bgError) {
        console.error('[VC Ingest Link] Background error:', bgError);
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        job_id: job.id,
        status: 'downloading',
        platform: 'detecting',
      },
    });
  } catch (error) {
    console.error('[VC Ingest Link] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
