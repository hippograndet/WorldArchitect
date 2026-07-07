-- M19: full-text search index for the search_articles tool.
-- Mirrors server/src/db/schema.ts's M19 SQLite migration (FTS5 there,
-- tsvector here) — a driver-specific side table, not a column on the shared
-- articles/article_versions tables, so schemaDrift.test.ts's column-diff
-- check never sees it (only the table-only-in-one-driver warning, which is
-- expected here since FTS5 and tsvector have no shared shape).

CREATE TABLE IF NOT EXISTS article_search_index (
  article_id  TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_article_search_gin ON article_search_index USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_article_search_world ON article_search_index(world_id);
