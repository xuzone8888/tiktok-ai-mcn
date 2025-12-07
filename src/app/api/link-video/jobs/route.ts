/**
 * 链接转视频任务 API
 * 
 * GET  /api/link-video/jobs - 获取用户的任务列表
 * POST /api/link-video/jobs - 创建新任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { 
  VideoConfig, 
  ManualProductInfo, 
  LinkVideoJob,
  DEFAULT_VIDEO_CONFIG,
} from '@/types/link-video';
import { getLinkVideoCredits } from '@/types/link-video';

// ============================================================================
// GET - 获取用户任务列表
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // 构建查询
    let query = supabase
      .from('link_video_jobs')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: jobs, error, count } = await query;

    if (error) {
      console.error('[Jobs API] Query error:', error);
      return NextResponse.json(
        { success: false, error: '获取任务列表失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        jobs: jobs || [],
        total: count || 0,
        limit,
        offset,
      },
    });

  } catch (error) {
    console.error('[Jobs API] GET error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST - 创建新任务
// ============================================================================

interface CreateJobRequest {
  product_link_id?: string;
  manual_product_info?: ManualProductInfo;
  video_config: VideoConfig;
  ai_model_id?: string;
  selected_main_image_url: string;
  selected_image_urls: string[];
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 解析请求体
    const body: CreateJobRequest = await request.json();
    const {
      product_link_id,
      manual_product_info,
      video_config,
      ai_model_id,
      selected_main_image_url,
      selected_image_urls,
    } = body;

    // 验证必填字段
    if (!video_config) {
      return NextResponse.json(
        { success: false, error: '请提供视频配置' },
        { status: 400 }
      );
    }

    if (!selected_main_image_url) {
      return NextResponse.json(
        { success: false, error: '请选择主图' },
        { status: 400 }
      );
    }

    if (!product_link_id && !manual_product_info) {
      return NextResponse.json(
        { success: false, error: '请提供商品链接或手动输入商品信息' },
        { status: 400 }
      );
    }

    // 计算预估积分
    const creditsEstimated = getLinkVideoCredits(video_config.duration);

    // 检查用户积分
    const adminSupabase = createAdminClient();
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('credits')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: '获取用户信息失败' },
        { status: 500 }
      );
    }

    if (profile.credits < creditsEstimated) {
      return NextResponse.json({
        success: false,
        error: `积分不足，需要 ${creditsEstimated} 积分，当前余额 ${profile.credits} 积分`,
        credits_required: creditsEstimated,
        credits_available: profile.credits,
      }, { status: 400 });
    }

    // 如果选择了 AI 模特，验证合约
    if (ai_model_id) {
      const { data: contract } = await adminSupabase
        .from('contracts')
        .select('id')
        .eq('user_id', user.id)
        .eq('model_id', ai_model_id)
        .eq('status', 'active')
        .gt('end_date', new Date().toISOString())
        .single();

      if (!contract) {
        return NextResponse.json({
          success: false,
          error: '您尚未签约该模特，请先前往模特资源库签约',
        }, { status: 400 });
      }
    }

    // 创建任务
    const { data: job, error: createError } = await adminSupabase
      .from('link_video_jobs')
      .insert({
        user_id: user.id,
        product_link_id: product_link_id || null,
        ai_model_id: ai_model_id || null,
        manual_product_info: manual_product_info || null,
        video_config,
        selected_main_image_url,
        selected_image_urls: selected_image_urls || [],
        status: 'created',
        current_step: 2, // 创建时已完成第1步 (链接解析)
        credits_estimated: creditsEstimated,
      })
      .select()
      .single();

    if (createError) {
      console.error('[Jobs API] Create error:', createError);
      return NextResponse.json(
        { success: false, error: '创建任务失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      job,
    });

  } catch (error) {
    console.error('[Jobs API] POST error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}






