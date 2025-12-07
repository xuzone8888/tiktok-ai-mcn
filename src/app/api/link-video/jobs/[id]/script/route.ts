/**
 * 脚本生成 API
 * POST /api/link-video/jobs/[id]/script
 * 
 * 根据商品信息和配置生成带货脚本
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateLinkVideoScript } from '@/lib/link-video-script';
import { LINK_VIDEO_CREDITS, isScriptRewriteCharged, getScriptRewriteCost } from '@/types/link-video';

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
    const body = await request.json();
    const { rewrite = false } = body;

    const adminSupabase = createAdminClient();

    // 3. 获取任务
    const { data: job, error: jobError } = await adminSupabase
      .from('link_video_jobs')
      .select(`
        *,
        product_link:product_link_cache(*),
        ai_model:ai_models(id, name, avatar_url, gender, age_range, style_tags, trigger_word)
      `)
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: '任务不存在' },
        { status: 404 }
      );
    }

    // 4. 检查重写费用
    let creditsCharged = 0;
    if (rewrite && isScriptRewriteCharged(job.script_rewrite_count)) {
      creditsCharged = getScriptRewriteCost(job.script_rewrite_count);
      
      // 检查用户积分
      const { data: profile } = await adminSupabase
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .single();

      if (!profile || profile.credits < creditsCharged) {
        return NextResponse.json({
          success: false,
          error: `积分不足，重写脚本需要 ${creditsCharged} 积分`,
        }, { status: 400 });
      }
    }

    // 5. 更新状态为生成中
    await adminSupabase
      .from('link_video_jobs')
      .update({
        status: 'generating_script',
        current_step: 3,
      })
      .eq('id', jobId);

    // 6. 准备商品信息
    const productInfo = job.manual_product_info || job.product_link?.parsed_data;
    if (!productInfo) {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'failed',
          error_message: '缺少商品信息',
        })
        .eq('id', jobId);

      return NextResponse.json({
        success: false,
        error: '缺少商品信息，请重新解析链接或手动输入',
      }, { status: 400 });
    }

    // 7. 生成脚本
    const scriptResult = await generateLinkVideoScript({
      productInfo,
      videoConfig: job.video_config,
      modelProfile: job.ai_model ? {
        name: job.ai_model.name,
        gender: job.ai_model.gender,
        ageRange: job.ai_model.age_range,
        styleTags: job.ai_model.style_tags,
      } : undefined,
    });

    if (!scriptResult.success || !scriptResult.script) {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'failed',
          error_message: scriptResult.error || '脚本生成失败',
        })
        .eq('id', jobId);

      return NextResponse.json({
        success: false,
        error: scriptResult.error || '脚本生成失败',
      }, { status: 500 });
    }

    // 8. 保存脚本
    const currentVersions = job.script_versions || [];
    const newVersion = {
      version: currentVersions.length + 1,
      content: scriptResult.script,
      created_at: new Date().toISOString(),
    };

    const updates: Record<string, unknown> = {
      script_text: scriptResult.script,
      script_versions: [...currentVersions, newVersion],
      status: 'script_generated',
      current_step: 3,
    };

    if (rewrite) {
      updates.script_rewrite_count = job.script_rewrite_count + 1;
    }

    await adminSupabase
      .from('link_video_jobs')
      .update(updates)
      .eq('id', jobId);

    // 9. 扣除重写费用
    if (creditsCharged > 0) {
      await adminSupabase.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: creditsCharged,
        p_description: `链接转视频 - 脚本重写 (第${job.script_rewrite_count + 1}次)`,
        p_reference_type: 'link_video_job',
        p_reference_id: jobId,
      });
    }

    return NextResponse.json({
      success: true,
      script: scriptResult.script,
      version: newVersion.version,
      credits_charged: creditsCharged,
    });

  } catch (error) {
    console.error('[Script API] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}






