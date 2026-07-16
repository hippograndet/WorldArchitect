-- Authoritative, ordered record of every article a recursive Forge run
-- touches — mirrors forgeState.ts's ForgeQueueItem (live LangGraph
-- checkpoint state) into a durable, queryable table so the client can show
-- an accurate queue/progress view instead of reverse-engineering one from
-- call_log history. See dev-docs plan "Grow UI: authoritative run-item
-- queue" for the full design.
CREATE TABLE IF NOT EXISTS run_queue_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id),
  title TEXT NOT NULL,
  depth INTEGER NOT NULL,
  start_step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  seq BIGSERIAL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_queue_items_run
  ON run_queue_items(owner_id, world_id, run_id, seq);

ALTER TABLE run_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_queue_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_run_queue_items ON run_queue_items;
CREATE POLICY tenant_run_queue_items ON run_queue_items
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());
