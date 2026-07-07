-- M16/M17: Runs — server-side LangGraph run tracking (backing Forge) + article locking.
-- runs.status values: pending | running | paused | completed | stopped | failed

CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  graph_type    TEXT NOT NULL DEFAULT 'forge',
  checkpoint_id TEXT NOT NULL,
  article_ids   TEXT NOT NULL DEFAULT '[]',
  budget_used   BIGINT NOT NULL DEFAULT 0,
  budget_limit  BIGINT NOT NULL DEFAULT 200000,
  error_message TEXT,
  items_completed BIGINT NOT NULL DEFAULT 0,
  items_total   BIGINT NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_world ON runs(owner_id, world_id, status);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS items_completed BIGINT NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS items_total BIGINT NOT NULL DEFAULT 0;

ALTER TABLE articles ADD COLUMN IF NOT EXISTS locked_by_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_articles_locked_by_run ON articles(locked_by_run_id);

-- Forge's per-run event log (mirrors client ForgeLogEntry: step/title/ok/ts).
-- No owner_id column — every read joins through runs(run_id) for tenant scoping.
CREATE TABLE IF NOT EXISTS run_events (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step       TEXT NOT NULL,
  title      TEXT NOT NULL,
  ok         BOOLEAN NOT NULL DEFAULT TRUE,
  message    TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);
