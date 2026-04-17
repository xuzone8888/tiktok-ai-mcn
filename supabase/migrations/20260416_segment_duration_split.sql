-- ============================================================================
-- 把 target_duration 拆成三个语义明确的字段
--
-- source_span_duration    = 源视频这段覆盖多少秒
-- generation_duration     = 模型真正要生成多少秒（provider-aware）
-- qc_expected_duration    = Tech QC 对比的目标时长
--
-- 保留 target_duration 兼容旧代码，新代码改读新字段
-- ============================================================================

ALTER TABLE viral_clone_segments
  ADD COLUMN IF NOT EXISTS source_span_duration REAL,
  ADD COLUMN IF NOT EXISTS generation_duration REAL,
  ADD COLUMN IF NOT EXISTS qc_expected_duration REAL;

-- 回填旧数据：旧记录的 target_duration 实际是源跨度
-- generation_duration 和 qc_expected_duration 默认回填 8（VEO 固定输出）
UPDATE viral_clone_segments
SET source_span_duration = target_duration,
    generation_duration = 8.0,
    qc_expected_duration = 8.0
WHERE source_span_duration IS NULL;

COMMENT ON COLUMN viral_clone_segments.source_span_duration IS '源视频这段覆盖多少秒';
COMMENT ON COLUMN viral_clone_segments.generation_duration IS '模型真正要生成多少秒（provider-aware）';
COMMENT ON COLUMN viral_clone_segments.qc_expected_duration IS 'Tech QC 对比的目标时长';
COMMENT ON COLUMN viral_clone_segments.target_duration IS 'DEPRECATED: 使用 source_span_duration / generation_duration 代替';
