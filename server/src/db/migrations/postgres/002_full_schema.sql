-- Brings the Postgres schema up to parity with the current SQLite shape
-- (server/src/db/schema.ts's applySchema() + runMigrations()). Written fresh
-- from the current final shape, not as a replay of SQLite's ALTER history —
-- there is no legacy Postgres data to stay backward-compatible with.
--
-- owner_id backfill on insert is handled in application code
-- (server/src/db/ownership.ts), not DB triggers — see dev-docs/architecture.md
-- decision 9 for why. No CREATE TRIGGER statements here by design.

CREATE TABLE IF NOT EXISTS coherence_warnings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_article_id TEXT REFERENCES articles(id),
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_snapshots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  pipeline_type TEXT NOT NULL DEFAULT 'expand_description',
  selected_proposal TEXT NOT NULL DEFAULT '{}',
  draft_content TEXT,
  expansion_params TEXT NOT NULL DEFAULT '{}',
  phase TEXT NOT NULL DEFAULT 'done',
  parent_update TEXT,
  selected_ideas TEXT,
  context_package TEXT,
  concepts TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(article_id, pipeline_type)
);

-- auto_select exists in SQLite (schema.ts M2) but was missing here — routes/articles.ts
-- writes to it on every pending-draft insert, so this was a live Postgres bug.
ALTER TABLE pending_drafts ADD COLUMN IF NOT EXISTS auto_select INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS name_bank (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'generated',
  gender TEXT NOT NULL DEFAULT 'neutral',
  social_class TEXT NOT NULL DEFAULT 'common',
  name_component TEXT NOT NULL DEFAULT 'full',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_name_bank_world ON name_bank(owner_id, world_id, entity_type);

CREATE TABLE IF NOT EXISTS auditor_edge_proposals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'references',
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auditor_edges_world ON auditor_edge_proposals(owner_id, world_id, status);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  article_id TEXT REFERENCES articles(id),
  title TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'general',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_world ON entity_mentions(owner_id, world_id, status);

CREATE TABLE IF NOT EXISTS article_issues (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  excerpt TEXT,
  explanation TEXT NOT NULL,
  suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_issues_article ON article_issues(article_id, status);
CREATE INDEX IF NOT EXISTS idx_article_issues_world ON article_issues(owner_id, world_id, severity, status);

CREATE TABLE IF NOT EXISTS publish_history (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES article_versions(id),
  published_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publish_history_world ON publish_history(owner_id, world_id, published_at DESC);

CREATE TABLE IF NOT EXISTS world_issues (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'coherence',
  description TEXT NOT NULL,
  article_ids TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'auditor',
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_issues_world ON world_issues(owner_id, world_id, status);

-- article_links exists in 001_initial.sql but was missing these two indexes
-- that the SQLite schema has (schema.ts M1).
CREATE INDEX IF NOT EXISTS idx_article_links_target ON article_links(target_article_id, link_type);
CREATE INDEX IF NOT EXISTS idx_article_links_source ON article_links(source_article_id, link_type);

INSERT INTO provider_settings (id, provider, config, updated_at)
VALUES ('singleton', 'none', '{}', 0)
ON CONFLICT (id) DO NOTHING;
