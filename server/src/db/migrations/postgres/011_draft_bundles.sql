ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS world_id TEXT REFERENCES worlds(id) ON DELETE CASCADE;
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS source_run_id TEXT;
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS run_type TEXT;
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS context_basis TEXT NOT NULL DEFAULT 'current';
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS context_draft_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS display_title TEXT;
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS resolved_at BIGINT;

ALTER TABLE pending_drafts DROP CONSTRAINT IF EXISTS pending_drafts_article_id_pipeline_type_key;

UPDATE pending_drafts pd
SET world_id = a.world_id
FROM articles a
WHERE pd.article_id = a.id AND pd.world_id IS NULL;

UPDATE pending_drafts
SET run_type = pipeline_type
WHERE run_type IS NULL;

UPDATE pending_drafts
SET display_title = pipeline_type
WHERE display_title IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_drafts_article_status_newest
  ON pending_drafts(owner_id, world_id, article_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_drafts_owner_id
  ON pending_drafts(owner_id, id);
