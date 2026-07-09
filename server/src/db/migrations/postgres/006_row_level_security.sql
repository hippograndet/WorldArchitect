-- Defense-in-depth tenant isolation for hosted Postgres.
--
-- Application code still carries owner_id predicates explicitly. These RLS
-- policies are the database backstop for missed predicates or raw-ID paths.
-- The server sets app.current_owner_id with SET LOCAL before app queries.

CREATE OR REPLACE FUNCTION app_current_owner_id()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_owner_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app_is_local_singleton()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT app_current_owner_id() = 'local-user'
$$;

-- LangGraph PostgresSaver checkpoint tables. The package can create these
-- lazily, but hosted deployments run with a restricted runtime role, so the
-- app migration path owns their creation instead.
CREATE TABLE IF NOT EXISTS checkpoint_migrations (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

INSERT INTO checkpoint_migrations (v)
VALUES (0), (1), (2), (3), (4)
ON CONFLICT (v) DO NOTHING;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'worlds',
    'categories',
    'articles',
    'article_versions',
    'article_links',
    'world_bible_entries',
    'world_bible_meta',
    'cost_settings',
    'call_log',
    'coherence_warnings',
    'world_snapshots',
    'pending_drafts',
    'name_bank',
    'auditor_edge_proposals',
    'entity_mentions',
    'article_issues',
    'publish_history',
    'world_issues',
    'runs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

ALTER TABLE provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_events FORCE ROW LEVEL SECURITY;
ALTER TABLE article_search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_search_index FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_worlds ON worlds
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_categories ON categories
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_articles ON articles
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_article_versions ON article_versions
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_article_links ON article_links
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_world_bible_entries ON world_bible_entries
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_world_bible_meta ON world_bible_meta
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_cost_settings ON cost_settings
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_provider_settings ON provider_settings
  USING (id = app_current_owner_id() OR (app_is_local_singleton() AND id = 'singleton'))
  WITH CHECK (id = app_current_owner_id() OR (app_is_local_singleton() AND id = 'singleton'));

CREATE POLICY tenant_call_log ON call_log
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_coherence_warnings ON coherence_warnings
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_world_snapshots ON world_snapshots
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_pending_drafts ON pending_drafts
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_name_bank ON name_bank
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_auditor_edge_proposals ON auditor_edge_proposals
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_entity_mentions ON entity_mentions
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_article_issues ON article_issues
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_publish_history ON publish_history
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_world_issues ON world_issues
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

CREATE POLICY tenant_runs ON runs
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());

-- run_events intentionally has no owner_id; visibility follows its parent run.
CREATE POLICY tenant_run_events ON run_events
  USING (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = run_events.run_id
        AND runs.owner_id = app_current_owner_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM runs
      WHERE runs.id = run_events.run_id
        AND runs.owner_id = app_current_owner_id()
    )
  );

-- article_search_index intentionally has no owner_id; visibility follows its
-- parent article. App queries still join articles, but this protects raw reads.
CREATE POLICY tenant_article_search_index ON article_search_index
  USING (
    EXISTS (
      SELECT 1 FROM articles
      WHERE articles.id = article_search_index.article_id
        AND articles.owner_id = app_current_owner_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM articles
      WHERE articles.id = article_search_index.article_id
        AND articles.owner_id = app_current_owner_id()
    )
  );

-- Scope LangGraph checkpoint tables through runs(thread_id). checkpointer.ts
-- reapplies these policies after PostgresSaver.setup() for older databases
-- where the tables may have been created lazily before this migration existed.
DO $$
DECLARE
  table_name TEXT;
BEGIN
  IF to_regclass('checkpoints') IS NULL
    OR to_regclass('checkpoint_blobs') IS NULL
    OR to_regclass('checkpoint_writes') IS NULL THEN
    RETURN;
  END IF;

  FOREACH table_name IN ARRAY ARRAY['checkpoints', 'checkpoint_blobs', 'checkpoint_writes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'tenant_' || table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (EXISTS (SELECT 1 FROM runs WHERE runs.id = %I.thread_id AND runs.owner_id = app_current_owner_id())) WITH CHECK (EXISTS (SELECT 1 FROM runs WHERE runs.id = %I.thread_id AND runs.owner_id = app_current_owner_id()))',
      'tenant_' || table_name,
      table_name,
      table_name,
      table_name
    );
  END LOOP;
END $$;
