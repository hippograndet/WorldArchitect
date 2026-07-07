-- M18: call_log — tool-loop iteration count + pipeline-run correlation.

ALTER TABLE call_log ADD COLUMN IF NOT EXISTS iterations INTEGER;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS pipeline_run_id TEXT;
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS pipeline_type TEXT;

CREATE INDEX IF NOT EXISTS idx_call_log_pipeline_run ON call_log(world_id, pipeline_run_id);
