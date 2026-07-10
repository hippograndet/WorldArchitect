CREATE TABLE IF NOT EXISTS article_metadata_facts (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  subject_type      TEXT,
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  authority         TEXT NOT NULL DEFAULT 'user_confirmed',
  source_version_id TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  UNIQUE(article_id, key)
);

CREATE INDEX IF NOT EXISTS idx_article_metadata_facts_article
  ON article_metadata_facts(owner_id, article_id);

ALTER TABLE article_metadata_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_metadata_facts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_article_metadata_facts ON article_metadata_facts;
CREATE POLICY tenant_article_metadata_facts ON article_metadata_facts
  USING (owner_id = app_current_owner_id())
  WITH CHECK (owner_id = app_current_owner_id());
