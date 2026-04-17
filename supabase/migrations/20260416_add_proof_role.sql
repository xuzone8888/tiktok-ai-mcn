-- ============================================================================
-- Migration: CloneSpec V2 Schema Updates
-- 1. 添加 'proof' 段角色
-- 2. 添加新事件类型 (continuity_qc, seam_qc, bgm)
-- ============================================================================

-- 1. segment_role: 添加 'proof' 支持 4 段模式
ALTER TABLE viral_clone_segments
  DROP CONSTRAINT IF EXISTS viral_clone_segments_segment_role_check;

ALTER TABLE viral_clone_segments
  ADD CONSTRAINT viral_clone_segments_segment_role_check
  CHECK (segment_role IN ('hook', 'body', 'demo', 'proof', 'cta', 'b_roll'));

-- 2. event_type: 添加 continuity/seam QC 和 BGM 事件
ALTER TABLE viral_clone_events
  DROP CONSTRAINT IF EXISTS viral_clone_events_event_type_check;

ALTER TABLE viral_clone_events
  ADD CONSTRAINT viral_clone_events_event_type_check
  CHECK (event_type IN (
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
  ));
