/**
 * 视频生成 API
 * POST /api/link-video/jobs/[id]/video
 * 
 * 使用 Sora2/Sora2 Pro 生成最终视频
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { submitSora2, querySora2Result, getSora2ModelName } from '@/lib/suchuang-api';
import { getLinkVideoCredits } from '@/types/link-video';

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
    const { retry = false, batchIndex = 0 } = body;
    
    // batchIndex > 0 表示批量生成的第2个及以后的任务
    const isBatchExtra = batchIndex > 0;

    const adminSupabase = createAdminClient();

    // 3. 获取任务
    const { data: job, error: jobError } = await adminSupabase
      .from('link_video_jobs')
      .select(`
        *,
        ai_model:ai_models(id, name, trigger_word, avatar_url)
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

    // 4. 检查前置条件
    if (!job.script_text) {
      return NextResponse.json({
        success: false,
        error: '请先生成脚本',
      }, { status: 400 });
    }

    if (!job.grid_image_url) {
      return NextResponse.json({
        success: false,
        error: '请先生成九宫格图片',
      }, { status: 400 });
    }

    // 5. 检查/扣除积分
    // 批量生成时，每个视频都需要单独扣除积分
    const creditsNeeded = getLinkVideoCredits(job.video_config.duration);
    
    // 决定是否需要扣积分：
    // - 首次生成(batchIndex=0, retry=false, credits_used=0)：扣
    // - 批量额外(batchIndex>0)：每个都扣
    // - 重试(retry=true)：不扣
    const shouldDeductCredits = !retry && (isBatchExtra || job.credits_used === 0);
    
    if (shouldDeductCredits) {
      // 检查用户积分
      const { data: profile } = await adminSupabase
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .single();

      if (!profile || profile.credits < creditsNeeded) {
        return NextResponse.json({
          success: false,
          error: `积分不足，需要 ${creditsNeeded} 积分`,
        }, { status: 400 });
      }

      // 扣除积分
      const { error: deductError } = await adminSupabase
        .from('profiles')
        .update({ credits: profile.credits - creditsNeeded })
        .eq('id', user.id);

      if (deductError) {
        return NextResponse.json({
          success: false,
          error: '积分扣除失败',
        }, { status: 500 });
      }

      // 记录交易
      const batchLabel = isBatchExtra ? ` (批量#${batchIndex + 1})` : '';
      await adminSupabase.from('credit_transactions').insert({
        user_id: user.id,
        amount: -creditsNeeded,
        type: 'usage',
        description: `链接秒变视频 - ${job.video_config.duration}秒视频${batchLabel}`,
        reference_type: 'link_video_job',
        reference_id: jobId,
        balance_before: profile.credits,
        balance_after: profile.credits - creditsNeeded,
      });

      // 更新任务积分（累加）
      await adminSupabase
        .from('link_video_jobs')
        .update({ credits_used: (job.credits_used || 0) + creditsNeeded })
        .eq('id', jobId);
    }

    // 6. 更新状态为生成中（只有主任务更新 job 状态）
    if (!isBatchExtra) {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          status: 'generating_video',
          current_step: 5,
          started_at: job.started_at || new Date().toISOString(),
          video_retry_count: retry ? job.video_retry_count + 1 : job.video_retry_count,
        })
        .eq('id', jobId);
    }

    // 7. 构建 Prompt
    // 组合脚本 + AI 模特触发词 (参考 generate-video 模块的实现)
    let finalPrompt = '';
    
    // 批量变体修饰词 - 为每个批量任务生成不同风格的视频
    const variationStyles = [
      '', // 第一个保持原样
      'Dynamic camera movements, energetic pacing. ',
      'Smooth transitions, elegant style. ',
      'Close-up details, intimate feel. ',
      'Wide shots, cinematic composition. ',
    ];
    
    // 如果是批量任务，添加变体修饰词
    if (batchIndex > 0 && batchIndex < variationStyles.length) {
      finalPrompt = variationStyles[batchIndex];
      console.log('[Video API] Added batch variation modifier:', variationStyles[batchIndex], 'for batch index:', batchIndex);
    }
    
    // 如果有 AI 模特，注入触发词到 prompt 开头
    if (job.ai_model?.trigger_word) {
      finalPrompt += `Professional video featuring ${job.ai_model.trigger_word}. `;
      console.log('[Video API] Injected AI model trigger word:', job.ai_model.trigger_word);
    }

    // 添加脚本内容 (截取前750字符，为其他修饰词留空间)
    const scriptContent = job.script_text.length > 750 
      ? job.script_text.substring(0, 750) + '...'
      : job.script_text;
    finalPrompt += scriptContent;

    // 添加质量提升词 - 批量任务使用不同的结尾修饰
    const qualityModifiers = [
      '. High quality, cinematic, professional lighting, viral TikTok style.',
      '. Premium quality, dynamic movements, trending aesthetic.',
      '. Studio quality, smooth camera work, engaging visuals.',
      '. Professional production, natural lighting, authentic feel.',
      '. Broadcast quality, creative angles, captivating style.',
    ];
    finalPrompt += qualityModifiers[batchIndex % qualityModifiers.length];

    // 8. 确定 Sora 模型
    const duration = job.video_config.duration;
    const aspectRatio = job.video_config.aspect_ratio;
    const isPro = duration === 15 || duration === 25;
    const quality = duration === 15 && isPro ? 'hd' : 'standard';
    
    const model = getSora2ModelName(
      aspectRatio as '9:16' | '16:9',
      duration as 10 | 15 | 25,
      quality
    );

    console.log('[Video API] Generating video:', {
      jobId,
      model,
      duration,
      aspectRatio,
      promptLength: finalPrompt.length,
      hasGridImage: !!job.grid_image_url,
    });

    // 9. 调用 Sora2 API
    const videoResult = await submitSora2({
      prompt: finalPrompt,
      model,
      duration,
      aspectRatio: aspectRatio as '9:16' | '16:9',
      url: job.grid_image_url, // 使用九宫格作为参考图
    });

    if (!videoResult.success || !videoResult.taskId) {
      // 视频生成失败，退还积分
      if (shouldDeductCredits) {
        await refundCredits(adminSupabase, user.id, jobId, creditsNeeded);
      }

      // 只有主任务(batchIndex=0)失败才更新 job 状态
      if (!isBatchExtra) {
        await adminSupabase
          .from('link_video_jobs')
          .update({
            status: 'failed',
            error_message: videoResult.error || '视频生成任务创建失败',
          })
          .eq('id', jobId);
      }

      return NextResponse.json({
        success: false,
        error: videoResult.error || '视频生成失败',
      }, { status: 500 });
    }

    // 10. 保存任务 ID（只有主任务更新）
    if (!isBatchExtra) {
      await adminSupabase
        .from('link_video_jobs')
        .update({
          video_task_id: videoResult.taskId,
        })
        .eq('id', jobId);
    }

    console.log('[Video API] Task submitted:', {
      taskId: videoResult.taskId,
      batchIndex,
      isBatchExtra,
    });

    return NextResponse.json({
      success: true,
      task_id: videoResult.taskId,
      batch_index: batchIndex,
      message: '视频生成任务已提交，请轮询状态',
    });

  } catch (error) {
    console.error('[Video API] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 获取视频生成状态
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const searchParams = new URL(request.url).searchParams;
    const externalTaskId = searchParams.get("taskId") || null;
    
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
      .select('video_task_id, final_video_url, status, credits_used')
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
    if (job.final_video_url) {
      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: job.final_video_url,
      });
    }

    // 如果没有任务 ID
    if (!job.video_task_id) {
      return NextResponse.json({
        success: true,
        status: 'pending',
        message: '尚未开始生成',
      });
    }

    // 如果传入 taskId（批量变体），使用该 taskId 查询，避免多个变体共用同一结果
    const targetTaskId = externalTaskId || job.video_task_id;

    // 查询外部任务状态
    const taskResult = await querySora2Result(targetTaskId);

    if (!taskResult.success) {
      return NextResponse.json({
        success: true,
        status: 'processing',
        progress: 0,
        message: '正在生成中...',
      });
    }

    const task = taskResult.task;
    const raw = taskResult.raw as { progress?: number };

    if (task?.status === 'completed' && task.resultUrl) {
      // 主任务：更新数据库状态
      if (!externalTaskId) {
        await adminSupabase
          .from('link_video_jobs')
          .update({
            final_video_url: task.resultUrl,
            status: 'success',
            completed_at: new Date().toISOString(),
            progress: 100,
          })
          .eq('id', jobId);
      }

      // 所有完成的视频都同步到 generations 表（包括批量变体）
      try {
        const { data: fullJob } = await adminSupabase
          .from('link_video_jobs')
          .select('*, ai_model:ai_models(name)')
          .eq('id', jobId)
          .single();

        if (fullJob) {
          const batchLabel = externalTaskId ? ` #${(parseInt(externalTaskId.slice(-2), 16) % 10) + 1}` : '';
          const { error: insertError } = await adminSupabase.from('generations').insert({
            user_id: user.id,
            task_id: targetTaskId,
            type: 'video',
            source: 'link_video',
            status: 'completed',
            prompt: (fullJob.script_text?.substring(0, 200) || '链接秒变视频') + batchLabel,
            model: fullJob.ai_model?.name || 'Sora2',
            result_url: task.resultUrl,
            video_url: task.resultUrl,
            credit_cost: externalTaskId ? getLinkVideoCredits(fullJob.video_config?.duration || 15) : (fullJob.credits_used || 0),
            created_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });
          
          if (insertError) {
            console.error('[Video API] Failed to insert generation:', insertError);
          } else {
            console.log('[Video API] Synced to generations table:', { taskId: targetTaskId, isBatch: !!externalTaskId });
          }
        }
      } catch (syncError) {
        console.error('[Video API] Failed to sync to generations:', syncError);
      }

      return NextResponse.json({
        success: true,
        status: 'completed',
        video_url: task.resultUrl,
        progress: 100,
      });
    }

    if (task?.status === 'failed') {
      // 仅主任务才执行积分退还和状态更新
      if (!externalTaskId) {
        // 失败时退还积分
        if (job.credits_used > 0) {
          await refundCredits(adminSupabase, user.id, jobId, job.credits_used);
        }

        await adminSupabase
          .from('link_video_jobs')
          .update({
            status: 'failed',
            error_message: task.errorMessage || '视频生成失败',
          })
          .eq('id', jobId);
      }

      return NextResponse.json({
        success: false,
        status: 'failed',
        error: task.errorMessage || '视频生成失败',
      });
    }

    // 更新进度
    const progress = raw?.progress || 0;
    if (progress > 0 && !externalTaskId) {
      await adminSupabase
        .from('link_video_jobs')
        .update({ progress })
        .eq('id', jobId);
    }

    return NextResponse.json({
      success: true,
      status: 'processing',
      progress,
      message: `正在生成中... ${progress}%`,
    });

  } catch (error) {
    console.error('[Video API] GET error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

// 辅助函数：退还积分
async function refundCredits(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  jobId: string,
  amount: number
) {
  // 获取当前余额
  const { data: profile } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .single();

  if (!profile) return;

  // 退还积分
  await supabase
    .from('profiles')
    .update({ credits: profile.credits + amount })
    .eq('id', userId);

  // 记录退还
  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: amount,
    type: 'refund',
    description: '链接秒变视频 - 生成失败退还',
    reference_type: 'link_video_job',
    reference_id: jobId,
    balance_before: profile.credits,
    balance_after: profile.credits + amount,
  });

  // 更新任务
  await supabase
    .from('link_video_jobs')
    .update({
      credits_refunded: amount,
      credits_used: 0,
    })
    .eq('id', jobId);
}


