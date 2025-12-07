/**
 * 九宫格生成 API
 * POST /api/link-video/jobs/[id]/grid
 * 
 * 使用 Nano Banana Pro 生成产品九宫格图片
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateNineGrid, queryNanoBananaResult } from '@/lib/suchuang-api';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    
    // 1. 验证用户
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 2. 解析请求
    const body = await request.json().catch(() => ({}));
    const { retry = false } = body;

    const adminSupabase = createAdminClient();

    // 3. 获取任务
    const { data: job, error: jobError } = await adminSupabase
      .from('link_video_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    // 4. 检查主图
    if (!job.selected_main_image_url) {
      return NextResponse.json({
        success: false,
        error: '请先选择主图',
      }, { status: 400 });
    }

    // 5. 更新状态为生成中
    await adminSupabase
      .from('link_video_jobs')
      .update({
        status: 'generating_grid',
        current_step: 4,
        grid_retry_count: retry ? job.grid_retry_count + 1 : job.grid_retry_count,
      })
      .eq('id', jobId);

    // 6. 获取产品描述
    const productInfo = job.manual_product_info || 
      (job.product_link_id ? await getProductInfo(adminSupabase, job.product_link_id) : null);
    
    const productDescription = productInfo?.title || undefined;

    // 7. 调用 Nano Banana Pro 生成九宫格
    console.log('[Grid API] Generating nine-grid for job:', jobId);
    console.log('[Grid API] Main image URL:', job.selected_main_image_url);

    const gridResult = await generateNineGrid(
      job.selected_main_image_url,
      productDescription
    );

    if (!gridResult.success || !gridResult.taskId) {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'failed',
          error_message: gridResult.error || '九宫格生成任务创建失败',
        })
        .eq('id', jobId);

      return NextResponse.json({
        success: false,
        error: gridResult.error || '九宫格生成失败',
      }, { status: 500 });
    }

    // 8. 保存任务 ID
    await adminSupabase
      .from('link_video_jobs')
      .update({
        grid_task_id: gridResult.taskId,
      })
      .eq('id', jobId);

    return NextResponse.json({
      success: true,
      task_id: gridResult.taskId,
      message: '九宫格生成任务已提交，请轮询状态',
    });

  } catch (error) {
    console.error('[Grid API] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 获取九宫格生成状态
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    const adminSupabase = createAdminClient();

    // 获取任务
    const { data: job } = await adminSupabase
      .from('link_video_jobs')
      .select('grid_task_id, grid_image_url, status')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (!job) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    // 如果已有结果
    if (job.grid_image_url) {
      return NextResponse.json({
        success: true,
        status: 'completed',
        grid_image_url: job.grid_image_url,
      });
    }

    // 如果没有任务 ID
    if (!job.grid_task_id) {
      return NextResponse.json({
        success: true,
        status: 'pending',
        message: '尚未开始生成',
      });
    }

    // 查询外部任务状态
    const taskResult = await queryNanoBananaResult(job.grid_task_id, 'nano-banana-pro');

    if (!taskResult.success) {
      return NextResponse.json({
        success: true,
        status: 'processing',
        message: '正在生成中...',
      });
    }

    const task = taskResult.task;

    if (task?.status === 'completed' && task.resultUrl) {
      // 更新数据库
      await adminSupabase
        .from('link_video_jobs')
        .update({
          grid_image_url: task.resultUrl,
          status: 'grid_generated',
        })
        .eq('id', jobId);

      return NextResponse.json({
        success: true,
        status: 'completed',
        grid_image_url: task.resultUrl,
      });
    }

    if (task?.status === 'failed') {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'failed',
          error_message: task.errorMessage || '九宫格生成失败',
        })
        .eq('id', jobId);

      return NextResponse.json({
        success: false,
        status: 'failed',
        error: task.errorMessage || '九宫格生成失败',
      });
    }

    return NextResponse.json({
      success: true,
      status: 'processing',
      message: '正在生成中...',
    });

  } catch (error) {
    console.error('[Grid API] GET error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 辅助函数：获取商品信息
async function getProductInfo(supabase: ReturnType<typeof createAdminClient>, linkId: string) {
  const { data } = await supabase
    .from('product_link_cache')
    .select('parsed_data')
    .eq('id', linkId)
    .single();
  
  return data?.parsed_data;
}




