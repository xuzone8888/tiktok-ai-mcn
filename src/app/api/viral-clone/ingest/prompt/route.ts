/**
 * Viral Clone — 提示词入口
 * POST /api/viral-clone/ingest/prompt
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createVCAdminClient } from '@/lib/viral-clone/vc-supabase';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { prompt, ref_image_urls, aspect_ratio } = await request.json();

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json({ success: false, error: '请输入视频描述' }, { status: 400 });
    }

    const adminClient = createVCAdminClient();

    // 创建 Job（状态: analyzing — 提示词入口跳过 ingesting）
    const { data: job, error: jobError } = await adminClient
      .from('viral_clone_jobs')
      .insert({
        user_id: user.id,
        entry_type: 'prompt',
        status: 'analyzing',
        aspect_ratio: aspect_ratio || '9:16',
      })
      .select()
      .single();

    if (jobError) {
      return NextResponse.json({ success: false, error: `创建任务失败: ${jobError.message}` }, { status: 500 });
    }

    // 如果有参考图，创建 anchor_frame 资产
    const refImages = Array.isArray(ref_image_urls) ? ref_image_urls : [];
    for (const imgUrl of refImages.slice(0, 3)) {
      await adminClient
        .from('viral_clone_assets')
        .insert({
          user_id: user.id,
          asset_type: 'anchor_frame',
          url: imgUrl,
          content_type: 'image/jpeg',
          metadata: { job_id: job.id },
        });
    }

    // 写事件
    await adminClient
      .from('viral_clone_events')
      .insert({
        job_id: job.id,
        event_type: 'job_created',
        payload: {
          prompt: prompt.substring(0, 500),
          refImageCount: refImages.length,
          aspectRatio: aspect_ratio || '9:16',
          note: refImages.length === 0 ? '无参考图，连续性可能下降' : undefined,
        },
      });

    return NextResponse.json({
      success: true,
      data: { job_id: job.id },
    });
  } catch (error) {
    console.error('[VC Ingest Prompt] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '服务器错误',
    }, { status: 500 });
  }
}
