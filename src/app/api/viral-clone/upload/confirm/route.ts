/**
 * Viral Clone — 上传完成确认
 * POST /api/viral-clone/upload/confirm
 *
 * [P0 Fix] 确认后自动推进到 analyzing 并触发规划流,
 *          避免 upload jobs 卡在 ingesting 状态。
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';
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

    const { job_id, asset_id } = await request.json();

    if (!job_id || !asset_id) {
      return NextResponse.json({ success: false, error: '缺少 job_id 或 asset_id' }, { status: 400 });
    }

    const vc = createVCAdminClient();

    // 验证 job 归属
    const { data: job } = await vc
      .from('viral_clone_jobs')
      .select('id, user_id, aspect_ratio, source_asset_id')
      .eq('id', job_id)
      .eq('user_id', user.id)
      .single();

    if (!job) {
      return NextResponse.json({ success: false, error: '任务不存在' }, { status: 404 });
    }

    // 更新 job 状态 → analyzing（跳过 ingesting，因为文件已上传完成）
    await vc
      .from('viral_clone_jobs')
      .update({ status: 'analyzing', source_asset_id: asset_id })
      .eq('id', job_id);

    await vc
      .from('viral_clone_events')
      .insert({
        job_id,
        event_type: 'ingest_completed',
        payload: { asset_id },
      });

    // [P0 Fix] 异步触发规划流 — 不阻塞响应
    (async () => {
      try {
        const bg = createVCAdminClient();

        // 获取源视频 URL
        const { data: asset } = await bg
          .from('viral_clone_assets')
          .select('url')
          .eq('id', asset_id)
          .single();

        if (!asset?.url) {
          await bg.from('viral_clone_jobs').update({ status: 'failed', error_message: '找不到源视频' }).eq('id', job_id);
          return;
        }

        // Step 1: V2 深度分析
        await bg.from('viral_clone_events').insert({ job_id, event_type: 'analysis_started', payload: {} });
        const analysis = await analyzeSourceVideoV2(asset.url);
        await bg.from('viral_clone_events').insert({ job_id, event_type: 'analysis_completed', payload: { utterances: analysis.utterances.length, beats: analysis.visual_beats.length } });

        // Step 2: 获取锚定图
        const { data: anchors } = await bg
          .from('viral_clone_assets')
          .select('url')
          .eq('user_id', user.id)
          .eq('asset_type', 'anchor_frame')
          .order('created_at', { ascending: false })
          .limit(3);

        // Step 3: V2 规划 — 先切 source clips，再生成 CloneSpecV2
        await bg.from('viral_clone_jobs').update({ status: 'planning' }).eq('id', job_id);

        // 预切分：确定初始段数并尝试切出 source clips
        const initialSegments = segmentByTimeline(analysis, analysis.suggested_segments, []);
        const clipUrls = await splitSourceVideo(
          asset.url,
          initialSegments.map(s => ({ index: s.index, start_s: s.source_start_s, end_s: s.source_end_s }))
        );

        const cloneSpec = await generateCloneSpec({
          analysis,
          aspectRatio: (job.aspect_ratio || '9:16') as AspectRatio,
          anchorUrls: anchors?.map((a: Record<string, unknown>) => a.url as string) || [],
          videoUrl: asset.url,
          clipUrls: clipUrls.length > 0 ? clipUrls : undefined,
          language: analysis.language === 'zh' ? 'zh' : 'en',
        });

        // Step 4: 等待确认
        await bg.from('viral_clone_jobs').update({
          status: 'awaiting_confirmation',
          confirmed_plan_snapshot: cloneSpec,
          provider_capability_snapshot: getProviderSnapshot(),
          total_segments: cloneSpec.segments.length,
        }).eq('id', job_id);

        await bg.from('viral_clone_events').insert({ job_id, event_type: 'plan_ready', payload: { segmentCount: cloneSpec.segments.length, mode: 'clone' } });

      } catch (error) {
        const bg = createVCAdminClient();
        await bg.from('viral_clone_jobs').update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        }).eq('id', job_id);
      }
    })();

    return NextResponse.json({ success: true, data: { job_id, status: 'analyzing' } });
  } catch (error) {
    console.error('[VC Upload Confirm] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
