-- ============================================================================
-- Viral Clone V1.5 Database Schema
-- 
-- 5 主表 + 1 事件表
-- 全部启用 RLS，每张表必须同时有 USING 和 WITH CHECK
-- ============================================================================

-- ============================================================================
-- Table 1: viral_clone_assets — 统一素材表
-- 存储所有中间产物和最终产物（源视频、锚定帧、生成段、拼接视频、超分视频、缩略图）
-- ============================================================================

CREATE TABLE IF NOT EXISTS viral_clone_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 素材类型
  asset_type TEXT NOT NULL CHECK (asset_type IN (
    'source_video',      -- 用户上传的源视频
    'anchor_frame',      -- 锚定参考帧（产品/人物/风格）
    'raw_segment',       -- provider 生成的原始分段视频
    'rescued_segment',   -- continuity rescue 补救段
    'stitched_video',    -- FFmpeg 拼接后的完整视频
    'upscaled_video',    -- 720p→1080p 超分后的最终视频
    'thumbnail'          -- 封面缩略图
  )),

  -- 存储信息
  url TEXT NOT NULL,                -- 自有 OSS URL（必须是自有存储，禁止第三方临时 URL）
  oss_key TEXT,                     -- OSS 对象键
  filename TEXT,                    -- 原始文件名
  content_type TEXT DEFAULT 'video/mp4',
  size_bytes BIGINT DEFAULT 0,

  -- 媒体元信息
  duration_ms INT,                  -- 视频时长（毫秒）
  width INT,                        -- 像素宽
  height INT,                       -- 像素高
  fps REAL,                         -- 帧率
  has_audio BOOLEAN DEFAULT true,   -- 是否含音轨

  -- 扩展元数据（ffprobe 结果、抽帧信息等）
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vca_user_id ON viral_clone_assets(user_id);
CREATE INDEX IF NOT EXISTS idx_vca_asset_type ON viral_clone_assets(asset_type);

-- ============================================================================
-- Table 2: viral_clone_jobs — 主任务表
-- 每次"爆款复制"操作对应一条 job
-- ============================================================================

CREATE TABLE IF NOT EXISTS viral_clone_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 入口类型
  entry_type TEXT NOT NULL CHECK (entry_type IN ('upload', 'link', 'prompt')),

  -- 任务状态（9 态状态机）
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created',                -- 初始
    'ingesting',              -- 入口处理中（上传/下载/链接解析）
    'analyzing',              -- Qwen 分析中
    'planning',               -- 脚本规划中
    'awaiting_confirmation',  -- 等待用户确认方案
    'generating',             -- 分段生成中
    'stitching',              -- FFmpeg 拼接中
    'upscaling',              -- 1080p 超分中
    'completed',              -- 完成
    'failed',                 -- 失败
    'manual_review'           -- 需人工审核
  )),

  -- 源素材引用
  source_asset_id UUID REFERENCES viral_clone_assets(id) ON DELETE SET NULL,

  -- 用户确认后冻结的方案快照（包含 full_script, style_bible, segments, anchors 等）
  confirmed_plan_snapshot JSONB,

  -- 音频策略
  audio_strategy TEXT DEFAULT 'native_per_segment' CHECK (audio_strategy IN (
    'native_per_segment',  -- 每段原生口播（V1.5 主方案）
    'unified_tts',         -- 统一 TTS 配音（V1.5 不做）
    'no_audio'             -- 无音频
  )),

  -- 编排模式
  orchestration_mode TEXT DEFAULT 'sequential' CHECK (orchestration_mode IN (
    'sequential',   -- 顺序生成
    'parallel_2',   -- 2 段并发
    'chain_extend'  -- Grok 链式延伸（零拼接）
  )),

  -- Provider 能力快照（开工时冻结，避免运行中配置变更影响）
  provider_capability_snapshot JSONB DEFAULT '{}',

  -- 预算控制
  currency_code TEXT DEFAULT 'CNY',
  budget_minor INT DEFAULT 0,             -- 预算上限（分）
  spent_minor INT DEFAULT 0,              -- 已花费（分）
  budget_exhausted BOOLEAN DEFAULT false,  -- 预算熔断标记

  -- 最终产物
  final_asset_id UUID REFERENCES viral_clone_assets(id) ON DELETE SET NULL,

  -- 输出配置
  aspect_ratio TEXT DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '16:9')),
  target_resolution TEXT DEFAULT '1080x1920',

  -- 分段统计
  total_segments INT DEFAULT 0,
  completed_segments INT DEFAULT 0,
  failed_segments INT DEFAULT 0,

  -- 租约（防重复执行）
  lease_owner TEXT,                        -- worker 标识
  lease_expires_at TIMESTAMPTZ,            -- 租约过期时间

  -- 错误信息
  error_message TEXT,

  -- 源链接（仅 entry_type='link' 时有值）
  source_url TEXT,

  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vcj_user_id ON viral_clone_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_vcj_status ON viral_clone_jobs(status);
CREATE INDEX IF NOT EXISTS idx_vcj_lease ON viral_clone_jobs(lease_owner, lease_expires_at)
  WHERE lease_owner IS NOT NULL;

-- ============================================================================
-- Table 3: viral_clone_segments — 分段任务表
-- 每个 segment 对应 VEO 的一次视频生成请求
-- ============================================================================

CREATE TABLE IF NOT EXISTS viral_clone_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES viral_clone_jobs(id) ON DELETE CASCADE,

  -- 段序号和角色
  segment_index INT NOT NULL,
  segment_role TEXT NOT NULL DEFAULT 'body' CHECK (segment_role IN (
    'hook',    -- 开头吸引
    'body',    -- 主体内容
    'demo',    -- 产品演示
    'proof',   -- 证言/对比
    'cta',     -- 行动号召
    'b_roll'   -- 过渡画面
  )),

  -- 口播文案（每段必须有明确文案）
  spoken_text TEXT NOT NULL DEFAULT '',

  -- 画面描述
  visual_goal TEXT DEFAULT '',

  -- 目标时长（秒）
  target_duration REAL DEFAULT 8.0,

  -- Provider 信息
  provider TEXT NOT NULL DEFAULT 'veo_std_refs' CHECK (provider IN (
    'veo_std_refs',     -- VEO 标准 + 3 图参考 (主路)
    'veo_fast_frames',  -- VEO Fast + 首尾帧 (rescue only)
    'grok_ref',         -- Grok 参考图生成
    'grok_extend'       -- Grok 链式延伸
  )),

  -- 编译后的 prompt
  prompt_en TEXT,
  prompt_zh TEXT,

  -- 参考图 URL 列表（JSON 数组，指向 viral_clone_assets 或直接 URL）
  anchors JSONB DEFAULT '[]',

  -- 生成结果
  raw_asset_id UUID REFERENCES viral_clone_assets(id) ON DELETE SET NULL,
  provider_task_id TEXT,              -- 第三方任务 ID

  -- 分段状态（6 态）
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',          -- 排队中
    'generating',      -- 生成中
    'ready_for_qc',    -- 待 QC
    'ready',           -- QC 通过
    'stitched',        -- 已拼接
    'replaced',        -- 已被 rescue 替换
    'failed'           -- 失败
  )),

  -- QC 结果（JSONB 存储详细检查结果）
  tech_qc JSONB,          -- { passed: bool, duration_ok: bool, resolution_ok: bool, ... }
  semantic_qc JSONB,      -- { passed: bool, content_match: bool, product_visible: bool, ... }
  continuity_qc JSONB,    -- { passed: bool, person_consistent: bool, color_consistent: bool, ... }

  -- 裁剪参数（stitcher 用）
  trim_start_ms INT DEFAULT 0,      -- 段首裁剪毫秒数
  trim_end_ms INT DEFAULT 0,        -- 段尾裁剪毫秒数

  -- 衔接提示（给 stitcher 的指令）
  seam_hint TEXT DEFAULT '',

  -- 重试
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,

  -- 错误信息
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcs_job_id ON viral_clone_segments(job_id);
CREATE INDEX IF NOT EXISTS idx_vcs_status ON viral_clone_segments(status);
CREATE INDEX IF NOT EXISTS idx_vcs_job_index ON viral_clone_segments(job_id, segment_index);

-- ============================================================================
-- Table 4: viral_clone_attempts — 成本审计表
-- 每次 provider 调用、下载、QC、stitch、upscale 都记一条
-- ============================================================================

CREATE TABLE IF NOT EXISTS viral_clone_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES viral_clone_jobs(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES viral_clone_segments(id) ON DELETE SET NULL,

  -- 操作类型
  attempt_type TEXT NOT NULL CHECK (attempt_type IN (
    'generate',       -- provider 视频生成
    'download',       -- 下载 provider 结果到 OSS
    'tech_qc',        -- 技术 QC
    'semantic_qc',    -- 语义 QC
    'continuity_qc',  -- 连续性 QC
    'stitch',         -- FFmpeg 拼接
    'upscale',        -- 1080p 超分
    'analyze',        -- Qwen 分析
    'plan'            -- Qwen 规划
  )),

  -- Provider 信息
  provider TEXT,                    -- veo_std_refs / veo_fast_frames / qwen / ffmpeg
  provider_task_id TEXT,            -- 第三方任务 ID
  provider_result_url TEXT,         -- 第三方原始 URL（仅审计用，禁止用于后续处理）

  -- 结果
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN (
    'started', 'completed', 'failed', 'timeout'
  )),
  result JSONB,                     -- 操作结果明细
  error_message TEXT,

  -- 成本（分）
  cost_minor INT DEFAULT 0,

  -- 耗时（毫秒）
  duration_ms INT DEFAULT 0,

  -- 输出素材（如果操作产生了新素材）
  output_asset_id UUID REFERENCES viral_clone_assets(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vca_attempts_job_id ON viral_clone_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_vca_attempts_segment_id ON viral_clone_attempts(segment_id)
  WHERE segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vca_attempts_type ON viral_clone_attempts(attempt_type);

-- ============================================================================
-- Table 5: viral_clone_events — 前端进度事件流
-- V1.5 落库先行，前端用轮询消费
-- ============================================================================

CREATE TABLE IF NOT EXISTS viral_clone_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES viral_clone_jobs(id) ON DELETE CASCADE,

  -- 事件类型
  event_type TEXT NOT NULL CHECK (event_type IN (
    'job_created',
    'ingest_started', 'ingest_completed', 'ingest_failed',
    'analysis_started', 'analysis_completed',
    'plan_ready',
    'plan_confirmed',
    'segment_queued', 'segment_generating', 'segment_completed', 'segment_failed',
    'segment_qc_passed', 'segment_qc_failed',
    'segment_rescued',
    'continuity_qc_started', 'continuity_qc_completed',
    'seam_qc_started', 'seam_qc_completed',
    'stitch_started', 'stitch_completed', 'stitch_failed',
    'upscale_started', 'upscale_completed', 'upscale_failed',
    'bgm_generated',
    'job_completed', 'job_failed',
    'budget_warning', 'budget_exhausted',
    'manual_review_needed'
  )),

  -- 事件负载
  payload JSONB DEFAULT '{}',

  -- 关联的 segment（可选）
  segment_id UUID REFERENCES viral_clone_segments(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vce_job_id ON viral_clone_events(job_id);
CREATE INDEX IF NOT EXISTS idx_vce_job_created ON viral_clone_events(job_id, created_at);

-- ============================================================================
-- Enable Row Level Security
-- ============================================================================

ALTER TABLE viral_clone_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_clone_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_clone_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_clone_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_clone_events ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies: viral_clone_assets
-- 每条策略必须同时有 USING 和 WITH CHECK（审计约束）
-- ============================================================================

CREATE POLICY "vc_assets_select" ON viral_clone_assets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "vc_assets_insert" ON viral_clone_assets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_assets_update" ON viral_clone_assets
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_assets_delete" ON viral_clone_assets
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- RLS Policies: viral_clone_jobs
-- ============================================================================

CREATE POLICY "vc_jobs_select" ON viral_clone_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "vc_jobs_insert" ON viral_clone_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_jobs_update" ON viral_clone_jobs
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vc_jobs_delete" ON viral_clone_jobs
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- RLS Policies: viral_clone_segments (通过 job 关联 user)
-- ============================================================================

CREATE POLICY "vc_segments_select" ON viral_clone_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_segments.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_segments_insert" ON viral_clone_segments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_segments.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_segments_update" ON viral_clone_segments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_segments.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_segments.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_segments_delete" ON viral_clone_segments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_segments.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS Policies: viral_clone_attempts (通过 job 关联 user)
-- ============================================================================

CREATE POLICY "vc_attempts_select" ON viral_clone_attempts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_attempts.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_attempts_insert" ON viral_clone_attempts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_attempts.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_attempts_update" ON viral_clone_attempts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_attempts.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_attempts.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_attempts_delete" ON viral_clone_attempts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_attempts.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS Policies: viral_clone_events (通过 job 关联 user)
-- ============================================================================

CREATE POLICY "vc_events_select" ON viral_clone_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_events.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "vc_events_insert" ON viral_clone_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM viral_clone_jobs
      WHERE viral_clone_jobs.id = viral_clone_events.job_id
      AND viral_clone_jobs.user_id = auth.uid()
    )
  );

-- Events 不允许用户直接 UPDATE/DELETE（只有 service role 可操作）

-- ============================================================================
-- Updated_at 自动更新触发器
-- ============================================================================

CREATE OR REPLACE FUNCTION vc_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vc_assets_updated_at
  BEFORE UPDATE ON viral_clone_assets
  FOR EACH ROW EXECUTE FUNCTION vc_update_updated_at();

CREATE TRIGGER trg_vc_jobs_updated_at
  BEFORE UPDATE ON viral_clone_jobs
  FOR EACH ROW EXECUTE FUNCTION vc_update_updated_at();

CREATE TRIGGER trg_vc_segments_updated_at
  BEFORE UPDATE ON viral_clone_segments
  FOR EACH ROW EXECUTE FUNCTION vc_update_updated_at();

-- ============================================================================
-- RPC: increment_spent — 原子递增 Job 已花费积分
-- orchestrator.ts 在并发生成时调用，确保成本追踪不丢失
-- ============================================================================

CREATE OR REPLACE FUNCTION increment_spent(p_job_id UUID, p_amount INT)
RETURNS VOID AS $$
BEGIN
  UPDATE viral_clone_jobs
  SET spent_minor = spent_minor + p_amount,
      budget_exhausted = CASE
        WHEN budget_minor > 0 AND (spent_minor + p_amount) >= budget_minor THEN true
        ELSE budget_exhausted
      END
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 完成提示
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Viral Clone V1.5 database schema created successfully!';
  RAISE NOTICE 'Tables: viral_clone_assets, viral_clone_jobs, viral_clone_segments, viral_clone_attempts, viral_clone_events';
END $$;
