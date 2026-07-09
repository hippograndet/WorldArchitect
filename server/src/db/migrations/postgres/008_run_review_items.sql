ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_status_check;

CREATE TABLE IF NOT EXISTS run_review_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  article_id TEXT REFERENCES articles(id),
  step TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL DEFAULT '{}',
  decision_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_review_items_run
  ON run_review_items(owner_id, world_id, run_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_review_items_one_pending
  ON run_review_items(owner_id, world_id, run_id, article_id, kind)
  WHERE status = 'pending';

ALTER TABLE run_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_review_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_run_review_items ON run_review_items;
CREATE POLICY tenant_run_review_items ON run_review_items
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());
