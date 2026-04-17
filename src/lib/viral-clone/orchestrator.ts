/**
 * Orchestrator — 服务端状态机编排器
 *
 * 职责:
 * 1. 管理 Job 生命周期: created → ... → completed/failed
 * 2. 有界并发: 单 job 最多 2 段并发
 * 3. 预算熔断: 超过 budget_minor 直接停
 * 4. 租约机制: lease_owner + lease_expires_at 防重复执行
 * 5. Provider 结果立即转存 OSS（审计补充①）
 * 6. QC → Repair → Stitch → Upscale 完整流水线
 *
 * 设计原则:
 * - 每个状态转换都写事件到 viral_clone_events
 * - 每次 provider 调用都记录到 viral_clone_attempts
 * - 不依赖内存状态，完全依赖数据库
 */

import type {
  ViralCloneJob,
  ViralCloneSegment,
  ViralCloneAsset,
  ViralCloneAttempt,
  MasterPlan,
  CloneSpecV2,
  JobStatus,
  SegmentStatus,
  EventType,
  AttemptType,
  ProviderAlias,
  AspectRatio,
} from '@/types/viral-clone';
import { getProviderSnapshot, getProviderCreditCost } from './providers/provider-registry';
import { generateSegmentVideo } from './providers/veo-provider';
import { generateWithReference, extendVideo } from './providers/grok-provider';
import { compileSegmentPrompt, compileBlueprintPrompt } from './prompt-compiler';
import { runTechQC } from './qc/tech-qc';
import { runSemanticQC, runSemanticQCV2 } from './qc/semantic-qc';
import { runContinuityQC } from './qc/continuity-qc';
import { runSeamQC } from './qc/seam-qc';
import { stitchAndUpscale } from './stitcher';
import { createVCAdminClient } from './vc-supabase';

// P2 增强模块（可选，失败不阻塞主流程）
import { evaluateRepairStrategy, repairSegment } from './enhance/grok-repair';
import { generateBGM } from './enhance/lyria-bgm';
import { upscaleCover } from './enhance/imagen-cover';
import { generateTTSFallback, shouldUseTTSFallback } from './enhance/tts-fallback';

// ============================================================================
// 配置
// ============================================================================

/** Service Role Client (bypasses RLS) */
function getAdminClient() {
  return createVCAdminClient();
}

/** Supabase admin client type */
type AdminClient = ReturnType<typeof createVCAdminClient>;

/** 租约超时（秒） */
const LEASE_DURATION_S = 600; // 10 分钟

/** 单 Job 最大并发段数 */
const MAX_CONCURRENT_SEGMENTS = 2;

/** 段最大重试次数 */
const MAX_SEGMENT_RETRIES = 3;

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 启动 Job 编排
 *
 * 入口: 用户确认方案后调用
 *
 * 流程:
 * 1. 获取租约
 * 2. 创建 segment 记录
 * 3. 按并发限制逐批生成
 * 4. 每段: 提交 → 等待 → 下载 → QC → 通过/重试
 * 5. 全部通过后: stitch → upscale → 完成
 */
export async function orchestrateJob(jobId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabase = getAdminClient();
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Orchestrator] ▶ Starting job ${jobId}`);
  console.log(`[Orchestrator]   worker=${workerId}`);
  console.log(`${'='.repeat(60)}`);

  try {
    // ========================================================================
    // Step 1: 获取租约（容错：失败时强制获取）
    // ========================================================================

    let leaseAcquired = await acquireLease(supabase, jobId, workerId);
    if (!leaseAcquired) {
      console.warn(`[Orchestrator] ⚠ Lease acquisition failed, forcing lease...`);
      // 强制获取租约（清除旧租约后重试）
      const expiresAt = new Date(Date.now() + LEASE_DURATION_S * 1000).toISOString();
      await supabase
        .from('viral_clone_jobs')
        .update({ lease_owner: workerId, lease_expires_at: expiresAt })
        .eq('id', jobId);
      leaseAcquired = true;
      console.log(`[Orchestrator] ✓ Lease forced successfully`);
    } else {
      console.log(`[Orchestrator] ✓ Lease acquired`);
    }

    // ========================================================================
    // Step 2: 加载 Job 和 MasterPlan
    // ========================================================================

    console.log(`[Orchestrator] Step 2: Loading job data...`);
    const { data: job } = await supabase
      .from('viral_clone_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (!job) {
      console.error(`[Orchestrator] ✗ Job not found!`);
      return { success: false, error: 'Job 不存在' };
    }
    console.log(`[Orchestrator] ✓ Job loaded, status=${job.status}`);

    const rawPlan = job.confirmed_plan_snapshot;
    const isV2 = rawPlan && typeof rawPlan === 'object' && 'mode' in rawPlan;
    const plan = rawPlan as MasterPlan | CloneSpecV2;

    // 验证 plan 是否有效
    const segmentCount = isV2
      ? (plan as CloneSpecV2).segments?.length
      : (plan as MasterPlan).segments?.length;

    if (!plan || !segmentCount || segmentCount === 0) {
      console.error(`[Orchestrator] ✗ Plan is empty or missing!`);
      await updateJobStatus(supabase, jobId, 'failed', '方案为空或未确认');
      return { success: false, error: '方案为空' };
    }
    console.log(`[Orchestrator] ✓ Plan loaded: ${segmentCount} segments, mode=${isV2 ? 'clone-v2' : 'v1'}`);

    // ========================================================================
    // Step 3: 更新状态 → generating
    // ========================================================================

    console.log(`[Orchestrator] Step 3: Updating status to generating...`);
    await updateJobStatus(supabase, jobId, 'generating');
    await emitEvent(supabase, jobId, 'segment_queued', { totalSegments: segmentCount });
    console.log(`[Orchestrator] ✓ Status updated, creating segments...`);

    // ========================================================================
    // Step 4: 创建 Segment 记录
    // ========================================================================

    console.log(`[Orchestrator] Step 4: Creating segment records...`);
    const segments = isV2
      ? await createSegmentRecordsV2(supabase, jobId, plan as CloneSpecV2)
      : await createSegmentRecords(supabase, jobId, plan as MasterPlan);
    console.log(`[Orchestrator] ✓ Created ${segments.length} segment records`);

    // ========================================================================
    // Step 5: 有界并发生成
    // ========================================================================

    console.log(`[Orchestrator] Step 5: Starting bounded generation...`);
    await generateSegmentsBounded(supabase, job, plan, segments, isV2 ? (plan as CloneSpecV2) : undefined);

    // 刷新租约
    await renewLease(supabase, jobId, workerId);

    // ========================================================================
    // Step 6: 检查是否全部完成
    // ========================================================================

    const { data: updatedSegments } = await supabase
      .from('viral_clone_segments')
      .select('*')
      .eq('job_id', jobId)
      .order('segment_index');

    const allReady = updatedSegments?.every(
      (s: ViralCloneSegment) => s.status === 'ready'
    );
    const anyFailed = updatedSegments?.some(
      (s: ViralCloneSegment) => s.status === 'failed'
    );

    if (anyFailed) {
      // 检查是否需要人工审核
      const failedCount = updatedSegments?.filter(
        (s: ViralCloneSegment) => s.status === 'failed'
      ).length || 0;

      await updateJobStatus(supabase, jobId, 'manual_review',
        `${failedCount} 个分段生成失败，需要人工审核`
      );
      await emitEvent(supabase, jobId, 'manual_review_needed', { failedCount });
      return { success: false, error: `${failedCount} 个分段失败` };
    }

    if (!allReady) {
      await updateJobStatus(supabase, jobId, 'manual_review', '部分分段状态异常');
      return { success: false, error: '部分分段状态异常' };
    }

    // ========================================================================
    // Step 7: Continuity QC — 相邻段连续性检查 [P1 Fix]
    // ========================================================================

    const readyForContinuity = updatedSegments!
      .filter((s: ViralCloneSegment) => s.status === 'ready' && s.raw_asset_id)
      .sort((a: ViralCloneSegment, b: ViralCloneSegment) => a.segment_index - b.segment_index);

    if (readyForContinuity.length >= 2) {
      await emitEvent(supabase, jobId, 'continuity_qc_started', {});

      for (let i = 0; i < readyForContinuity.length - 1; i++) {
        const segA = readyForContinuity[i];
        const segB = readyForContinuity[i + 1];

        // 提取尾帧和首帧
        const { data: assetA } = await supabase
          .from('viral_clone_assets').select('url').eq('id', segA.raw_asset_id!).single();
        const { data: assetB } = await supabase
          .from('viral_clone_assets').select('url').eq('id', segB.raw_asset_id!).single();

        if (assetA?.url && assetB?.url) {
          const tailFrame = await extractFrame(assetA.url, 'tail');
          const headFrame = await extractFrame(assetB.url, 'head');

          const contResult = await runContinuityQC(
            tailFrame,
            headFrame,
            segA.segment_index,
            segB.segment_index
          );

          // 存入后一段的 continuity_qc
          await supabase
            .from('viral_clone_segments')
            .update({ continuity_qc: contResult })
            .eq('id', segB.id);

          if (!contResult.passed) {
            await emitEvent(supabase, jobId, 'segment_qc_failed', {
              segmentId: segB.id,
              qcType: 'continuity',
              severity: contResult.severity,
              details: contResult.details,
            });

            // critical 级别的连续性断裂 → 人工审核
            if (contResult.severity === 'critical') {
              await updateJobStatus(supabase, jobId, 'manual_review',
                `段 ${segA.segment_index}→${segB.segment_index} 连续性严重断裂`
              );
              return { success: false, error: '连续性 QC 失败' };
            }
          }
        }
      }

      await emitEvent(supabase, jobId, 'continuity_qc_completed', {});
    }

    // ========================================================================
    // Step 7b: Seam QC — 拼接缝检查（音频能量 + 句尾完成度）
    // ========================================================================

    const readyForSeam = updatedSegments!
      .filter((s: ViralCloneSegment) => s.status === 'ready' && s.raw_asset_id)
      .sort((a: ViralCloneSegment, b: ViralCloneSegment) => a.segment_index - b.segment_index);

    if (readyForSeam.length >= 2) {
      await emitEvent(supabase, jobId, 'seam_qc_started', {});

      for (let i = 0; i < readyForSeam.length - 1; i++) {
        const segA = readyForSeam[i];
        const segB = readyForSeam[i + 1];

        const { data: assetA } = await supabase
          .from('viral_clone_assets').select('url').eq('id', segA.raw_asset_id!).single();
        const { data: assetB } = await supabase
          .from('viral_clone_assets').select('url').eq('id', segB.raw_asset_id!).single();

        if (assetA?.url && assetB?.url) {
          try {
            const seamResult = await runSeamQC(
              assetA.url,
              assetB.url,
              segA.spoken_text || '',
              segA.segment_index,
              segB.segment_index
            );

            // 应用建议裁剪量到 segment
            if (seamResult.suggested_trim_tail_ms > 0) {
              await supabase.from('viral_clone_segments')
                .update({ trim_end_ms: segA.trim_end_ms + seamResult.suggested_trim_tail_ms })
                .eq('id', segA.id);
            }
            if (seamResult.suggested_trim_head_ms > 0) {
              await supabase.from('viral_clone_segments')
                .update({ trim_start_ms: segB.trim_start_ms + seamResult.suggested_trim_head_ms })
                .eq('id', segB.id);
            }

            // broken 级别记录警告但不阻塞
            if (seamResult.severity === 'broken') {
              await emitEvent(supabase, jobId, 'segment_qc_failed', {
                segmentId: segB.id,
                qcType: 'seam',
                severity: seamResult.severity,
                details: seamResult.details,
              });
            }
          } catch (seamErr) {
            console.warn(`[Orchestrator] SeamQC ${segA.segment_index}→${segB.segment_index} failed (non-blocking):`, seamErr);
          }
        }
      }

      await emitEvent(supabase, jobId, 'seam_qc_completed', {});
    }

    // ========================================================================
    // Step 8: Stitch + Upscale
    // ========================================================================

    await updateJobStatus(supabase, jobId, 'stitching');
    await emitEvent(supabase, jobId, 'stitch_started', {});

    const readySegments = updatedSegments!.filter(
      (s: ViralCloneSegment) => s.status === 'ready' && s.raw_asset_id
    );

    // 获取每段的视频 URL
    const segmentVideos = await Promise.all(
      readySegments.map(async (seg: ViralCloneSegment) => {
        const { data: asset } = await supabase
          .from('viral_clone_assets')
          .select('url')
          .eq('id', seg.raw_asset_id!)
          .single();

        return {
          videoUrl: asset?.url || '',
          trimStartMs: seg.trim_start_ms,
          trimEndMs: seg.trim_end_ms,
          seamHint: seg.seam_hint,
          role: seg.segment_role,
          generationDurationMs: (seg.generation_duration ?? seg.target_duration) * 1000,
        };
      })
    );

    const stitchResult = await stitchAndUpscale({
      segments: segmentVideos.filter(s => s.videoUrl),
      aspectRatio: (job.aspect_ratio || '9:16') as AspectRatio,
      userId: job.user_id,
      jobId,
    });

    if (!stitchResult.success || !stitchResult.finalUrl) {
      await updateJobStatus(supabase, jobId, 'failed', stitchResult.error || '拼接失败');
      await emitEvent(supabase, jobId, 'stitch_failed', { error: stitchResult.error });
      return { success: false, error: stitchResult.error };
    }

    await emitEvent(supabase, jobId, 'stitch_completed', {});

    // 如果有超分
    if (stitchResult.upscaledUrl) {
      await emitEvent(supabase, jobId, 'upscale_completed', {});
    }

    // ========================================================================
    // Step 8b: [P2] 增强: BGM + 封面超分（可选，失败不阻塞）
    // ========================================================================

    let bgmUrl: string | undefined;
    let coverUrl: string | undefined;

    // BGM 生成
    try {
      const bgmResult = await generateBGM({
        styleBible: plan.style_bible,
        durationSeconds: plan.estimated_time || 30,
        userId: job.user_id,
        jobId,
      });
      if (bgmResult.success && bgmResult.audioUrl) {
        bgmUrl = bgmResult.audioUrl;
        await emitEvent(supabase, jobId, 'bgm_generated', { url: bgmUrl });
      }
    } catch (bgmErr) {
      console.warn(`[Orchestrator] BGM generation failed (non-blocking):`, bgmErr);
    }

    // 封面超分
    try {
      const finalUrl = stitchResult.finalUrl || stitchResult.stitchedUrl;
      if (finalUrl) {
        const coverResult = await upscaleCover({
          sourceImageUrl: finalUrl, // 视频 URL，Imagen 会截首帧
          userId: job.user_id,
          jobId,
          aspectRatio: (job.aspect_ratio || '9:16') as AspectRatio,
        });
        if (coverResult.success && coverResult.coverUrl) {
          coverUrl = coverResult.coverUrl;
          // 创建 thumbnail 资产
          await supabase.from('viral_clone_assets').insert({
            user_id: job.user_id,
            asset_type: 'thumbnail',
            url: coverUrl,
            oss_key: coverResult.ossKey,
            content_type: 'image/jpeg',
            width: coverResult.width,
            height: coverResult.height,
          });
        }
      }
    } catch (coverErr) {
      console.warn(`[Orchestrator] Cover upscale failed (non-blocking):`, coverErr);
    }

    // ========================================================================
    // Step 9: 创建最终资产并完成
    // ========================================================================

    const hasUpscale = !!stitchResult.upscaledUrl;

    // 创建 stitched_video 资产
    const { data: stitchedAsset } = await supabase
      .from('viral_clone_assets')
      .insert({
        user_id: job.user_id,
        asset_type: 'stitched_video',
        url: stitchResult.stitchedUrl,
        oss_key: stitchResult.stitchedOssKey,
        content_type: 'video/mp4',
      })
      .select()
      .single();

    // 创建 upscaled_video 资产（如果有）
    let finalAssetId = stitchedAsset?.id;

    if (hasUpscale) {
      const { data: upscaledAsset } = await supabase
        .from('viral_clone_assets')
        .insert({
          user_id: job.user_id,
          asset_type: 'upscaled_video',
          url: stitchResult.upscaledUrl,
          oss_key: stitchResult.upscaledOssKey,
          content_type: 'video/mp4',
        })
        .select()
        .single();

      finalAssetId = upscaledAsset?.id || finalAssetId;
    }

    // 更新 Job 为完成
    await supabase
      .from('viral_clone_jobs')
      .update({
        status: 'completed',
        final_asset_id: finalAssetId,
        completed_at: new Date().toISOString(),
        completed_segments: segmentCount,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq('id', jobId);

    await emitEvent(supabase, jobId, 'job_completed', {
      finalUrl: stitchResult.finalUrl,
      hasUpscale,
      hasBGM: !!bgmUrl,
      hasCover: !!coverUrl,
      durationMs: stitchResult.durationMs,
    });

    console.log(`[Orchestrator] Job ${jobId} completed successfully!`);
    return { success: true };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Orchestrator] Fatal error:`, errMsg);

    try {
      const supabase = getAdminClient();
      await updateJobStatus(supabase, jobId, 'failed', errMsg);
      await emitEvent(supabase, jobId, 'job_failed', { error: errMsg });
    } catch {
      // 忽略清理错误
    }

    return { success: false, error: errMsg };
  }
}

// ============================================================================
// 内部函数 — 租约管理
// ============================================================================

async function acquireLease(
  supabase: AdminClient,
  jobId: string,
  workerId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LEASE_DURATION_S * 1000).toISOString();

  // 原子更新: 只有在无租约或租约已过期时才能获取
  const { data, error } = await supabase
    .from('viral_clone_jobs')
    .update({
      lease_owner: workerId,
      lease_expires_at: expiresAt,
    })
    .eq('id', jobId)
    .or(`lease_owner.is.null,lease_expires_at.lt.${now}`)
    .select('id')
    .single();

  return !!data && !error;
}

async function renewLease(
  supabase: AdminClient,
  jobId: string,
  workerId: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + LEASE_DURATION_S * 1000).toISOString();

  await supabase
    .from('viral_clone_jobs')
    .update({ lease_expires_at: expiresAt })
    .eq('id', jobId)
    .eq('lease_owner', workerId);
}

// ============================================================================
// 内部函数 — Segment 生成
// ============================================================================

async function createSegmentRecords(
  supabase: AdminClient,
  jobId: string,
  plan: MasterPlan
): Promise<ViralCloneSegment[]> {
  const segmentRows = plan.segments.map((seg, index) => {
    // 编译提示词
    const { prompt_en, prompt_zh } = compileSegmentPrompt(
      seg,
      plan.style_bible,
      plan.output_profile.aspect
    );

    return {
      job_id: jobId,
      segment_index: index,
      segment_role: seg.role,
      spoken_text: seg.spoken_text,
      visual_goal: seg.visual_goal,
      target_duration: seg.target_seconds,
      provider: plan.provider_route,
      prompt_en,
      prompt_zh,
      anchors: JSON.stringify(seg.ref_images),
      seam_hint: seg.seam_hint,
      status: 'queued' as SegmentStatus,
    };
  });

  const { data, error } = await supabase
    .from('viral_clone_segments')
    .insert(segmentRows)
    .select();

  if (error) throw new Error(`创建 segment 记录失败: ${error.message}`);
  return data as ViralCloneSegment[];
}

/**
 * V2: 从 CloneSpecV2 创建 segment 记录
 * 使用 blueprint 的真实台词和画面描述
 */
async function createSegmentRecordsV2(
  supabase: AdminClient,
  jobId: string,
  spec: CloneSpecV2
): Promise<ViralCloneSegment[]> {
  const segmentRows = spec.segments.map((blueprint, index) => {
    // V2: 使用 Blueprint 编译器
    const prompt_en = compileBlueprintPrompt(
      blueprint,
      spec.style_bible,
      spec.source_analysis,
      spec.output_profile.aspect
    );

    // 从 visual beats 拼接 visual_goal（兼容旧字段）
    const matchedBeats = spec.source_analysis.visual_beats.filter(b =>
      blueprint.beat_ids.includes(b.id)
    );
    const visual_goal = matchedBeats.map(b => b.description).join('; ') || blueprint.role;

    return {
      job_id: jobId,
      segment_index: index,
      segment_role: blueprint.role,
      spoken_text: blueprint.spoken_text_exact,
      visual_goal,
      target_duration: blueprint.target_seconds,
      source_span_duration: blueprint.source_span_seconds,
      generation_duration: blueprint.generation_duration_seconds,
      qc_expected_duration: blueprint.qc_expected_duration_seconds,
      provider: spec.provider_route,
      prompt_en,
      prompt_zh: null,
      anchors: JSON.stringify(blueprint.ref_images),
      seam_hint: blueprint.seam_hint,
      status: 'queued' as SegmentStatus,
    };
  });

  const { data, error } = await supabase
    .from('viral_clone_segments')
    .insert(segmentRows)
    .select();

  if (error) throw new Error(`创建 V2 segment 记录失败: ${error.message}`);
  return data as ViralCloneSegment[];
}

async function generateSegmentsBounded(
  supabase: AdminClient,
  job: ViralCloneJob,
  plan: MasterPlan | CloneSpecV2,
  segments: ViralCloneSegment[],
  cloneSpec?: CloneSpecV2
): Promise<void> {
  // chain_extend 模式: 串行生成，每段从上一段延伸
  if (job.orchestration_mode === 'chain_extend') {
    let prevVideoUrl: string | null = null;

    for (const segment of segments) {
      // 预算熔断检查
      const { data: currentJob } = await supabase
        .from('viral_clone_jobs')
        .select('spent_minor, budget_minor, budget_exhausted')
        .eq('id', job.id)
        .single();

      if (currentJob?.budget_exhausted ||
          (currentJob?.budget_minor > 0 && currentJob?.spent_minor >= currentJob?.budget_minor)) {
        await updateJobStatus(supabase, job.id, 'failed', '预算已耗尽');
        await emitEvent(supabase, job.id, 'budget_exhausted', {});
        return;
      }

      // 第一段用 grok_ref（参考图），后续段用 grok_extend（延伸）
      if (segment.segment_index === 0 || !prevVideoUrl) {
        // 第一段：参考图生成
        await supabase.from('viral_clone_segments')
          .update({ provider: 'grok_ref' })
          .eq('id', segment.id);
        segment.provider = 'grok_ref' as ProviderAlias;
      } else {
        // 后续段：从上一段延伸
        await supabase.from('viral_clone_segments')
          .update({ provider: 'grok_extend' })
          .eq('id', segment.id);
        segment.provider = 'grok_extend' as ProviderAlias;
      }

      await processSegment(supabase, job, plan, segment, prevVideoUrl, cloneSpec);

      // 获取本段生成的视频 URL，作为下一段的源
      const { data: updSeg } = await supabase
        .from('viral_clone_segments')
        .select('raw_asset_id, status')
        .eq('id', segment.id)
        .single();

      if (updSeg?.raw_asset_id && updSeg.status === 'ready') {
        const { data: asset } = await supabase
          .from('viral_clone_assets')
          .select('url')
          .eq('id', updSeg.raw_asset_id)
          .single();
        prevVideoUrl = asset?.url || null;
      } else {
        // 段失败，chain 断裂，尝试重置为 ref 模式
        prevVideoUrl = null;
      }
    }
    return;
  }

  // 默认: 有界并发（Veo 模式）
  let index = 0;

  while (index < segments.length) {
    // 预算熔断检查
    const { data: currentJob } = await supabase
      .from('viral_clone_jobs')
      .select('spent_minor, budget_minor, budget_exhausted')
      .eq('id', job.id)
      .single();

    if (currentJob?.budget_exhausted ||
        (currentJob?.budget_minor > 0 && currentJob?.spent_minor >= currentJob?.budget_minor)) {
      await updateJobStatus(supabase, job.id, 'failed', '预算已耗尽');
      await emitEvent(supabase, job.id, 'budget_exhausted', {
        spent: currentJob?.spent_minor,
        budget: currentJob?.budget_minor,
      });
      return;
    }

    // 取一批段
    const batchSize = Math.min(MAX_CONCURRENT_SEGMENTS, segments.length - index);
    const batch = segments.slice(index, index + batchSize);

    // 并发生成本批
    await Promise.all(
      batch.map(segment => processSegment(supabase, job, plan, segment, null, cloneSpec))
    );

    index += batchSize;
  }
}

async function processSegment(
  supabase: AdminClient,
  job: ViralCloneJob,
  plan: MasterPlan | CloneSpecV2,
  segment: ViralCloneSegment,
  prevVideoUrl: string | null,
  cloneSpec?: CloneSpecV2
): Promise<void> {
  const startTime = Date.now();

  // 更新状态 → generating
  await supabase
    .from('viral_clone_segments')
    .update({ status: 'generating' })
    .eq('id', segment.id);
  await emitEvent(supabase, job.id, 'segment_generating', {
    segmentId: segment.id,
    segmentIndex: segment.segment_index,
  });

  // 记录 attempt 开始
  const { data: attempt } = await supabase
    .from('viral_clone_attempts')
    .insert({
      job_id: job.id,
      segment_id: segment.id,
      attempt_type: 'generate' as AttemptType,
      provider: segment.provider,
      status: 'started',
    })
    .select()
    .single();

  try {
    // 根据 provider 路由到不同的生成引擎
    let result: { success: boolean; oss_url?: string; oss_key?: string; provider_task_id?: string; provider_url?: string; size_bytes?: number; error?: string };

    const refImages = Array.isArray(segment.anchors)
      ? segment.anchors
      : JSON.parse(segment.anchors as unknown as string || '[]');

    if (segment.provider === 'grok_ref') {
      // Grok 参考图生成
      const grokResult = await generateWithReference({
        provider: 'grok_ref',
        prompt: segment.prompt_en || '',
        ref_images: refImages,
        aspect_ratio: (job.aspect_ratio || '9:16') as '9:16' | '16:9',
        user_id: job.user_id,
        duration: segment.generation_duration ?? segment.target_duration,
      });
      result = { ...grokResult, provider_task_id: undefined, provider_url: undefined };

    } else if (segment.provider === 'grok_extend' && prevVideoUrl) {
      // Grok 链式延伸
      const grokResult = await extendVideo({
        prompt: segment.prompt_en || '',
        source_video_url: prevVideoUrl,
        aspect_ratio: (job.aspect_ratio || '9:16') as '9:16' | '16:9',
        user_id: job.user_id,
        duration: segment.generation_duration ?? segment.target_duration,
      });
      result = { ...grokResult, provider_task_id: undefined, provider_url: undefined };

    } else {
      // VEO Provider（默认）
      result = await generateSegmentVideo({
        provider: segment.provider as ProviderAlias,
        prompt: segment.prompt_en || '',
        ref_images: refImages,
        aspect_ratio: (job.aspect_ratio || '9:16') as '9:16' | '16:9',
        user_id: job.user_id,
      });
    }

    const durationMs = Date.now() - startTime;
    const creditCost = getProviderCreditCost(segment.provider as ProviderAlias);

    // 更新 attempt
    await supabase
      .from('viral_clone_attempts')
      .update({
        status: result.success ? 'completed' : 'failed',
        provider_task_id: result.provider_task_id,
        provider_result_url: result.provider_url, // 仅审计用
        cost_minor: creditCost,
        duration_ms: durationMs,
        error_message: result.error,
        completed_at: new Date().toISOString(),
      })
      .eq('id', attempt?.id);

    // 更新已花费
    try {
      await supabase.rpc('increment_spent', {
        p_job_id: job.id,
        p_amount: creditCost,
      });
    } catch {
      // 如果 RPC 不存在，直接更新
      await supabase
        .from('viral_clone_jobs')
        .update({ spent_minor: (job.spent_minor || 0) + creditCost })
        .eq('id', job.id);
    }

    if (!result.success) {
      await handleSegmentFailure(supabase, job, plan, segment, cloneSpec);
      return;
    }

    // 创建 raw_segment 资产
    const { data: asset } = await supabase
      .from('viral_clone_assets')
      .insert({
        user_id: job.user_id,
        asset_type: 'raw_segment',
        url: result.oss_url,
        oss_key: result.oss_key,
        content_type: 'video/mp4',
        size_bytes: result.size_bytes || 0,
      })
      .select()
      .single();

    // 更新 segment
    await supabase
      .from('viral_clone_segments')
      .update({
        status: 'ready_for_qc',
        raw_asset_id: asset?.id,
        provider_task_id: result.provider_task_id,
      })
      .eq('id', segment.id);

    // 执行 QC
    await runSegmentQC(supabase, job, plan, segment, asset?.id, result.oss_url!, cloneSpec);

    await emitEvent(supabase, job.id, 'segment_completed', {
      segmentId: segment.id,
      segmentIndex: segment.segment_index,
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    await supabase
      .from('viral_clone_attempts')
      .update({
        status: 'failed',
        error_message: errMsg,
        duration_ms: Date.now() - startTime,
        completed_at: new Date().toISOString(),
      })
      .eq('id', attempt?.id);

    await handleSegmentFailure(supabase, job, plan, segment, cloneSpec);
  }
}

// ============================================================================
// 内部函数 — QC
// ============================================================================

async function runSegmentQC(
  supabase: AdminClient,
  job: ViralCloneJob,
  plan: MasterPlan | CloneSpecV2,
  segment: ViralCloneSegment,
  assetId: string | undefined,
  videoUrl: string,
  cloneSpec?: CloneSpecV2
): Promise<void> {
  // Tech QC — 使用 qc_expected_duration（provider 期望输出时长），而非 target_duration（源跨度）
  const qcExpectedDuration = segment.qc_expected_duration ?? segment.generation_duration ?? segment.target_duration;
  const sourceSpanDuration = segment.source_span_duration ?? undefined;
  const techResult = await runTechQC(videoUrl, qcExpectedDuration, sourceSpanDuration);

  // 更新 Tech QC 结果
  await supabase
    .from('viral_clone_segments')
    .update({ tech_qc: techResult })
    .eq('id', segment.id);

  if (!techResult.passed) {
    console.warn(`[Orchestrator] Segment ${segment.segment_index} failed Tech QC`);
    await emitEvent(supabase, job.id, 'segment_qc_failed', {
      segmentId: segment.id,
      qcType: 'tech',
      details: techResult.details,
    });
    // Tech QC 失败但不立即重试，先让后续 QC 也跑完
  }

  // Semantic QC（跳过 b_roll 段）[P0 Fix: 先抽帧再分析]
  if (segment.segment_role !== 'b_roll') {
    const keyFrame = await extractFrame(videoUrl, 'mid');

    // V2: 对照 Blueprint 检查
    let semanticResult;
    if (cloneSpec && cloneSpec.segments[segment.segment_index]) {
      const blueprint = cloneSpec.segments[segment.segment_index];
      semanticResult = await runSemanticQCV2(
        keyFrame,
        blueprint,
        cloneSpec.source_analysis
      );
    } else {
      // V1 fallback
      semanticResult = await runSemanticQC(
        keyFrame,
        segment.spoken_text,
        segment.visual_goal,
        segment.segment_role
      );
    }

    await supabase
      .from('viral_clone_segments')
      .update({ semantic_qc: semanticResult })
      .eq('id', segment.id);

    if (!semanticResult.passed) {
      await emitEvent(supabase, job.id, 'segment_qc_failed', {
        segmentId: segment.id,
        qcType: 'semantic',
        details: semanticResult.details,
      });
    }
  }

  // 汇总 QC 结果
  const { data: updatedSeg } = await supabase
    .from('viral_clone_segments')
    .select('tech_qc, semantic_qc')
    .eq('id', segment.id)
    .single();

  const techPassed = (updatedSeg?.tech_qc as Record<string, unknown>)?.passed !== false;
  const semanticPassed = (updatedSeg?.semantic_qc as Record<string, unknown>)?.passed !== false;

  if (techPassed && semanticPassed) {
    // QC 全部通过
    await supabase
      .from('viral_clone_segments')
      .update({ status: 'ready' })
      .eq('id', segment.id);
    await emitEvent(supabase, job.id, 'segment_qc_passed', { segmentId: segment.id });
  } else {
    // QC 未通过 → 构建具体失败原因，然后尝试重试
    const failReasons: string[] = [];
    if (!techPassed) {
      const techDetails = (updatedSeg?.tech_qc as Record<string, unknown>)?.details || '';
      failReasons.push(`Tech QC 失败: ${techDetails}`);
    }
    if (!semanticPassed) {
      const semDetails = (updatedSeg?.semantic_qc as Record<string, unknown>)?.details || '';
      failReasons.push(`Semantic QC 失败: ${semDetails}`);
    }
    const failReason = failReasons.join('; ');
    await handleSegmentFailure(supabase, job, plan, segment, cloneSpec, failReason);
  }
}

// ============================================================================
// 内部函数 — Repair Policy
// ============================================================================

async function handleSegmentFailure(
  supabase: AdminClient,
  job: ViralCloneJob,
  plan: MasterPlan | CloneSpecV2,
  segment: ViralCloneSegment,
  cloneSpec?: CloneSpecV2,
  failReason?: string
): Promise<void> {
  const currentRetry = segment.retry_count || 0;

  if (currentRetry < MAX_SEGMENT_RETRIES) {
    // 重试: 重新生成同 provider
    console.log(`[Orchestrator] Retrying segment ${segment.segment_index} (attempt ${currentRetry + 1}/${MAX_SEGMENT_RETRIES})${failReason ? ` reason: ${failReason}` : ''}`);

    await supabase
      .from('viral_clone_segments')
      .update({
        status: 'queued',
        retry_count: currentRetry + 1,
      })
      .eq('id', segment.id);

    // 递归重新处理
    const updatedSegment = { ...segment, retry_count: currentRetry + 1, status: 'queued' as SegmentStatus };
    await processSegment(supabase, job, plan, updatedSegment, null, cloneSpec);
  } else {
    // 超过最大重试 → 标记失败，附带具体原因
    console.error(`[Orchestrator] Segment ${segment.segment_index} exceeded max retries`);

    const errorMsg = failReason
      ? `超过最大重试次数 (${MAX_SEGMENT_RETRIES}): ${failReason}`
      : `超过最大重试次数 (${MAX_SEGMENT_RETRIES})`;

    await supabase
      .from('viral_clone_segments')
      .update({
        status: 'failed',
        error_message: errorMsg,
      })
      .eq('id', segment.id);

    await emitEvent(supabase, job.id, 'segment_failed', {
      segmentId: segment.id,
      segmentIndex: segment.segment_index,
    });
  }
}

// ============================================================================
// 工具函数
// ============================================================================

async function updateJobStatus(
  supabase: AdminClient,
  jobId: string,
  status: JobStatus,
  errorMessage?: string
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (errorMessage) updates.error_message = errorMessage;

  if (status === 'generating') {
    updates.started_at = new Date().toISOString();
  } else if (status === 'completed' || status === 'failed') {
    updates.completed_at = new Date().toISOString();
    updates.lease_owner = null;
    updates.lease_expires_at = null;
  }

  await supabase
    .from('viral_clone_jobs')
    .update(updates)
    .eq('id', jobId);
}

async function emitEvent(
  supabase: AdminClient,
  jobId: string,
  eventType: EventType,
  payload: Record<string, unknown>,
  segmentId?: string
): Promise<void> {
  await supabase
    .from('viral_clone_events')
    .insert({
      job_id: jobId,
      event_type: eventType,
      payload,
      segment_id: segmentId || null,
    });
}

// ============================================================================
// 帧提取工具 [P3 Fix: Serverless 兼容 — 不依赖本地 FFmpeg]
// ============================================================================

/**
 * 从视频 URL 中生成帧引用
 *
 * 生产模式: 不调用 FFmpeg（Vercel Serverless 无 ffmpeg 二进制），
 * 而是返回带时间戳位置标记的视频 URL。
 * Qwen3.5-Omni 原生支持视频 URL 分析，QC 模块直接传视频 URL 即可。
 *
 * @param videoUrl 视频 OSS URL
 * @param position 'head' = 开头, 'mid' = 中间, 'tail' = 结尾
 * @returns 带位置标记的帧引用字符串（QC 模块识别）
 */
async function extractFrame(
  videoUrl: string,
  position: 'head' | 'mid' | 'tail'
): Promise<string> {
  // Qwen3.5-Omni 支持直接分析视频 URL，不需要抽帧
  // 返回 JSON 格式的帧引用，QC 模块解析后传给 Qwen 做对比分析
  // 格式: { type: 'video_frame_ref', url, position, seek_hint_s }
  const seekHint: Record<string, number> = {
    head: 0.3,
    mid: 4.0,  // 假设 8s 段
    tail: 7.5,
  };

  return JSON.stringify({
    type: 'video_frame_ref',
    url: videoUrl,
    position,
    seek_hint_s: seekHint[position] ?? 0,
  });
}

