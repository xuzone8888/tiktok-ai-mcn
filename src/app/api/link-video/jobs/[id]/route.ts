/**
 * 单个任务 API
 * 
 * GET    /api/link-video/jobs/[id] - 获取任务详情
 * PATCH  /api/link-video/jobs/[id] - 更新任务
 * DELETE /api/link-video/jobs/[id] - 删除/取消任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { VideoConfig, LinkVideoJob } from '@/types/link-video';

// ============================================================================
// GET - 获取任务详情
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 获取任务详情 (带关联数据)
    const { data: job, error } = await supabase
      .from('link_video_jobs')
      .select(`
        *,
        product_link:product_link_cache(*),
        ai_model:ai_models(id, name, avatar_url, gender, age_range, style_tags)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无权访问' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });

  } catch (error) {
    console.error('[Job API] GET error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH - 更新任务
// ============================================================================

interface UpdateJobRequest {
  video_config?: Partial<VideoConfig>;
  ai_model_id?: string | null;
  selected_main_image_url?: string;
  selected_image_urls?: string[];
  script_text?: string;
  status?: string;
  current_step?: number;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    const body: UpdateJobRequest = await request.json();
    const adminSupabase = createAdminClient();

    // 检查任务是否存在且属于当前用户
    const { data: existingJob, error: checkError } = await adminSupabase
      .from('link_video_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (checkError || !existingJob) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无权访问' },
        { status: 404 }
      );
    }

    // 构建更新对象
    const updates: Partial<LinkVideoJob> = {};

    if (body.video_config) {
      updates.video_config = {
        ...existingJob.video_config,
        ...body.video_config,
      };
    }

    if (body.ai_model_id !== undefined) {
      updates.ai_model_id = body.ai_model_id;
    }

    if (body.selected_main_image_url) {
      updates.selected_main_image_url = body.selected_main_image_url;
    }

    if (body.selected_image_urls) {
      updates.selected_image_urls = body.selected_image_urls;
    }

    if (body.script_text !== undefined) {
      updates.script_text = body.script_text;
      
      // 添加到脚本版本历史
      const currentVersions = existingJob.script_versions || [];
      const newVersion = {
        version: currentVersions.length + 1,
        content: body.script_text,
        created_at: new Date().toISOString(),
      };
      updates.script_versions = [...currentVersions, newVersion];
    }

    if (body.status) {
      updates.status = body.status;
    }

    if (body.current_step) {
      updates.current_step = body.current_step;
    }

    // 执行更新
    const { data: updatedJob, error: updateError } = await adminSupabase
      .from('link_video_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Job API] Update error:', updateError);
      return NextResponse.json(
        { success: false, error: '更新失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });

  } catch (error) {
    console.error('[Job API] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE - 删除/取消任务
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    const adminSupabase = createAdminClient();

    // 检查任务状态
    const { data: job, error: checkError } = await adminSupabase
      .from('link_video_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (checkError || !job) {
      return NextResponse.json(
        { success: false, error: '任务不存在或无权访问' },
        { status: 404 }
      );
    }

    // 如果任务正在处理中，改为取消状态
    const processingStatuses = ['generating_script', 'generating_grid', 'generating_video'];
    if (processingStatuses.includes(job.status)) {
      const { error: cancelError } = await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'cancelled',
          error_message: '用户取消',
        })
        .eq('id', id);

      if (cancelError) {
        return NextResponse.json(
          { success: false, error: '取消失败' },
          { status: 500 }
        );
      }

      // TODO: 退还积分 (如果已预扣)

      return NextResponse.json({
        success: true,
        message: '任务已取消',
      });
    }

    // 否则直接删除
    const { error: deleteError } = await adminSupabase
      .from('link_video_jobs')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json(
        { success: false, error: '删除失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '任务已删除',
    });

  } catch (error) {
    console.error('[Job API] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}






