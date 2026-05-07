import type Database from 'better-sqlite3';

function tryAlter(db: Database.Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!msg.includes('already exists') && !msg.includes('duplicate column name')) throw err;
  }
}

export function runMigrations(db: Database.Database): void {
  // M1: add link_type to article_links
  tryAlter(db, `ALTER TABLE article_links ADD COLUMN link_type TEXT NOT NULL DEFAULT 'references'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_article_links_target ON article_links(target_article_id, link_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_article_links_source ON article_links(source_article_id, link_type)`);

  // M2: extend pending_drafts for multi-step pipeline
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN context_package TEXT`);
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN concepts TEXT`);
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN pipeline_type TEXT NOT NULL DEFAULT 'expand_description'`);
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN auto_select INTEGER NOT NULL DEFAULT 0`);
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN parent_update TEXT`);

  // M3: articles.depth for graph hierarchy
  tryAlter(db, `ALTER TABLE articles ADD COLUMN depth INTEGER NOT NULL DEFAULT 1`);

  // M4: worlds.style_config for vibe, writing style, inspirations
  tryAlter(db, `ALTER TABLE worlds ADD COLUMN style_config TEXT NOT NULL DEFAULT '{}'`);

  // M5: auditor edge proposals table
  tryAlter(db, `
    CREATE TABLE IF NOT EXISTS auditor_edge_proposals (
      id                   TEXT PRIMARY KEY,
      world_id             TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      source_article_id    TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      target_article_id    TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      link_type            TEXT NOT NULL DEFAULT 'references',
      rationale            TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      created_at           INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_auditor_edges_world ON auditor_edge_proposals(world_id, status)`);

  // M6: pending_drafts.selected_ideas for Oracle idea selection
  tryAlter(db, `ALTER TABLE pending_drafts ADD COLUMN selected_ideas TEXT`);

  // M7: call_log agentType string updates (cosmetic — updates old log rows)
  try {
    db.exec(`UPDATE call_log SET agent_type = 'muse'        WHERE agent_type = 'proposal'`);
    db.exec(`UPDATE call_log SET agent_type = 'scribe'       WHERE agent_type = 'expander'`);
    db.exec(`UPDATE call_log SET agent_type = 'lorekeeper'   WHERE agent_type = 'summarizer'`);
    db.exec(`UPDATE call_log SET agent_type = 'architect'    WHERE agent_type = 'skeleton'`);
    db.exec(`UPDATE call_log SET agent_type = 'cartographer' WHERE agent_type = 'child_proposer'`);
    db.exec(`UPDATE call_log SET agent_type = 'warden'       WHERE agent_type = 'coherence'`);
    db.exec(`UPDATE call_log SET agent_type = 'sentinel'     WHERE agent_type = 'retention'`);
    db.exec(`UPDATE call_log SET agent_type = 'condenser'    WHERE agent_type = 'bible_compressor'`);
    db.exec(`UPDATE call_log SET agent_type = 'stylist'      WHERE agent_type = 'prompt_engineer'`);
    db.exec(`UPDATE call_log SET agent_type = 'curator'      WHERE agent_type = 'taste'`);
  } catch { /* ignore — call_log may be empty or already updated */ }

  // M8: pending_drafts — change UNIQUE(article_id) to UNIQUE(article_id, pipeline_type)
  // Allows multiple concurrent drafts of different types on the same article.
  // SQLite can't ALTER constraints, so we recreate the table.
  const pendingDraftsSql = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='pending_drafts'`,
  ).get() as { sql: string } | undefined)?.sql ?? '';

  if (!pendingDraftsSql.includes('UNIQUE(article_id, pipeline_type)')) {
    db.transaction(() => {
      db.exec(`CREATE TABLE pending_drafts_new (
        id                TEXT PRIMARY KEY,
        article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        pipeline_type     TEXT NOT NULL DEFAULT 'expand_description',
        selected_proposal TEXT NOT NULL DEFAULT '{}',
        draft_content     TEXT,
        expansion_params  TEXT NOT NULL DEFAULT '{}',
        phase             TEXT NOT NULL DEFAULT 'done',
        parent_update     TEXT,
        selected_ideas    TEXT,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        UNIQUE(article_id, pipeline_type)
      )`);
      db.exec(`INSERT OR IGNORE INTO pending_drafts_new
        SELECT id, article_id,
               COALESCE(pipeline_type, 'expand_description'),
               COALESCE(selected_proposal, '{}'),
               draft_content,
               COALESCE(expansion_params, '{}'),
               COALESCE(phase, 'done'),
               parent_update,
               selected_ideas,
               created_at, updated_at
        FROM pending_drafts`);
      db.exec(`DROP TABLE pending_drafts`);
      db.exec(`ALTER TABLE pending_drafts_new RENAME TO pending_drafts`);
    })();
  }
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      tone         TEXT NOT NULL DEFAULT 'narrative',
      origin_point TEXT,
      style_config TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id                    TEXT PRIMARY KEY,
      world_id              TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      title                 TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'stub',
      template_type         TEXT NOT NULL DEFAULT 'general',
      temporal_anchor_start TEXT,
      temporal_anchor_end   TEXT,
      is_fixed_point        INTEGER NOT NULL DEFAULT 0,
      current_version_id    TEXT,
      depth                 INTEGER NOT NULL DEFAULT 1,
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
      link_type         TEXT NOT NULL DEFAULT 'references',
      PRIMARY KEY (source_article_id, target_article_id)
    );

    CREATE INDEX IF NOT EXISTS idx_article_links_target ON article_links(target_article_id, link_type);
    CREATE INDEX IF NOT EXISTS idx_article_links_source ON article_links(source_article_id, link_type);

    CREATE TABLE IF NOT EXISTS coherence_warnings (
      id                TEXT PRIMARY KEY,
      article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      source_article_id TEXT REFERENCES articles(id),
      severity          TEXT NOT NULL,
      description       TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        INTEGER NOT NULL
    );

    -- World Bible: LLM context store — one summary per article, no UI editing.
    -- Summaries are set by agents or derived from article body on manual save.
    CREATE TABLE IF NOT EXISTS world_bible_entries (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
      summary    TEXT NOT NULL,
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
      article_id        TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      pipeline_type     TEXT NOT NULL DEFAULT 'expand_description',
      selected_proposal TEXT NOT NULL DEFAULT '{}',
      draft_content     TEXT,
      expansion_params  TEXT NOT NULL DEFAULT '{}',
      phase             TEXT NOT NULL DEFAULT 'done',
      parent_update     TEXT,
      selected_ideas    TEXT,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      UNIQUE(article_id, pipeline_type)
    );

    CREATE TABLE IF NOT EXISTS cost_settings (
      world_id        TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
      daily_cap       INTEGER,
      bible_threshold INTEGER NOT NULL DEFAULT 80000
    );

    -- Global singleton: one row, id always 'singleton'.
    CREATE TABLE IF NOT EXISTS provider_settings (
      id         TEXT PRIMARY KEY DEFAULT 'singleton',
      provider   TEXT NOT NULL DEFAULT 'none',
      config     TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.prepare(`
    INSERT OR IGNORE INTO provider_settings (id, provider, config, updated_at)
    VALUES ('singleton', 'none', '{}', 0)
  `).run();
}
