CREATE TABLE IF NOT EXISTS llm_traces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  article_id TEXT REFERENCES articles(id),
  agent_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  error_message TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_traces_run ON llm_traces(owner_id, world_id, run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_traces_world ON llm_traces(owner_id, world_id, created_at DESC);

ALTER TABLE llm_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_traces FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_llm_traces ON llm_traces;
CREATE POLICY tenant_llm_traces ON llm_traces
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());
