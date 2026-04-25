import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      tone         TEXT NOT NULL DEFAULT 'narrative',
      origin_point TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      hidden     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id                    TEXT PRIMARY KEY,
      world_id              TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      category_id           TEXT NOT NULL REFERENCES categories(id),
      title                 TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'stub',
      template_type         TEXT NOT NULL DEFAULT 'general',
      temporal_anchor_start TEXT,
      temporal_anchor_end   TEXT,
      is_fixed_point        INTEGER NOT NULL DEFAULT 0,
      current_version_id    TEXT,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_versions (
      id                       TEXT PRIMARY KEY,
      article_id               TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_number           INTEGER NOT NULL,
      body                     TEXT NOT NULL,
      summary                  TEXT NOT NULL,
      expansion_params         TEXT,
      proposal_used            TEXT,
      word_count               INTEGER NOT NULL DEFAULT 0,
      is_revert                INTEGER NOT NULL DEFAULT 0,
      reverted_from_version_id TEXT,
      created_at               INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_links (
      source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      target_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      PRIMARY KEY (source_article_id, target_article_id)
    );

    CREATE TABLE IF NOT EXISTS coherence_warnings (
      id                TEXT PRIMARY KEY,
      article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      source_article_id TEXT REFERENCES articles(id),
      severity          TEXT NOT NULL,
      description       TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_bible_entries (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
      summary    TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_bible_meta (
      world_id    TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
      token_count INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_snapshots (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      agent_type    TEXT NOT NULL,
      article_id    TEXT REFERENCES articles(id),
      tokens_in     INTEGER,
      tokens_out    INTEGER,
      status        TEXT NOT NULL,
      error_message TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_drafts (
      id                TEXT PRIMARY KEY,
      article_id        TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
      selected_proposal TEXT NOT NULL,
      draft_content     TEXT,
      expansion_params  TEXT NOT NULL,
      phase             TEXT NOT NULL,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cost_settings (
      world_id        TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
      daily_cap       INTEGER,
      bible_threshold INTEGER NOT NULL DEFAULT 80000
    );

    -- Global singleton: one row, id always 'singleton'.
    -- config stores keys/URLs/model choices as JSON (never returned unmasked).
    CREATE TABLE IF NOT EXISTS provider_settings (
      id         TEXT PRIMARY KEY DEFAULT 'singleton',
      provider   TEXT NOT NULL DEFAULT 'none',
      config     TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Seed the provider_settings singleton if it doesn't exist yet.
  db.prepare(`
    INSERT OR IGNORE INTO provider_settings (id, provider, config, updated_at)
    VALUES ('singleton', 'none', '{}', 0)
  `).run();
}
