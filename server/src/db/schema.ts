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
  // M0 compatibility: categories were introduced before migrations were formalised.
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_world ON categories(world_id, sort_order)`);
  tryAlter(db, `ALTER TABLE articles ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL`);
  tryAlter(db, `ALTER TABLE world_bible_entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);

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

  // M9: name_bank — add gender, social_class, name_component columns
  tryAlter(db, `ALTER TABLE name_bank ADD COLUMN gender TEXT NOT NULL DEFAULT 'neutral'`);
  tryAlter(db, `ALTER TABLE name_bank ADD COLUMN social_class TEXT NOT NULL DEFAULT 'common'`);
  tryAlter(db, `ALTER TABLE name_bank ADD COLUMN name_component TEXT NOT NULL DEFAULT 'full'`);

  // M10: article_versions — add is_published for publish workflow (now in base schema, kept for old DBs)
  tryAlter(db, `ALTER TABLE article_versions ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0`);

  // M11: new tables for entity mentions, article issues
  tryAlter(db, `
    CREATE TABLE IF NOT EXISTS entity_mentions (
      id                TEXT PRIMARY KEY,
      world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      article_id        TEXT REFERENCES articles(id),
      title             TEXT NOT NULL,
      template_type     TEXT NOT NULL DEFAULT 'general',
      summary           TEXT,
      status            TEXT NOT NULL DEFAULT 'created',
      created_at        INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_entity_mentions_world ON entity_mentions(world_id, status)`);

  tryAlter(db, `
    CREATE TABLE IF NOT EXISTS article_issues (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      source      TEXT NOT NULL,
      severity    TEXT NOT NULL,
      code        TEXT NOT NULL,
      excerpt     TEXT,
      explanation TEXT NOT NULL,
      suggestion  TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_article_issues_article ON article_issues(article_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_article_issues_world ON article_issues(world_id, severity, status)`);

  // M12: publish_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS publish_history (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      article_id   TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_id   TEXT REFERENCES article_versions(id),
      published_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_publish_history_world ON publish_history(world_id, published_at DESC)`);

  // M13: world_issues — persistent world-level issues from Auditor and other macro agents
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_issues (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      severity    TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'coherence',
      description TEXT NOT NULL,
      article_ids TEXT NOT NULL DEFAULT '[]',
      source      TEXT NOT NULL DEFAULT 'auditor',
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_world_issues_world ON world_issues(world_id, status)`);

  // M14: article_versions — replace body/summary with introduction/description/chronology
  {
    const hasBody = (db.prepare(
      `SELECT COUNT(*) AS n FROM pragma_table_info('article_versions') WHERE name = 'body'`,
    ).get() as { n: number }).n > 0;

    if (hasBody) {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`CREATE TABLE article_versions_new (
        id                       TEXT PRIMARY KEY,
        article_id               TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        version_number           INTEGER NOT NULL,
        introduction             TEXT NOT NULL DEFAULT '',
        description              TEXT NOT NULL DEFAULT '',
        chronology               TEXT NOT NULL DEFAULT '',
        expansion_params         TEXT,
        proposal_used            TEXT,
        word_count               INTEGER NOT NULL DEFAULT 0,
        is_revert                INTEGER NOT NULL DEFAULT 0,
        is_published             INTEGER NOT NULL DEFAULT 0,
        reverted_from_version_id TEXT,
        created_at               INTEGER NOT NULL
      )`);
      // Migrate: summary → introduction; body content is discarded (test data only)
      db.exec(`INSERT INTO article_versions_new
        (id, article_id, version_number, introduction, description, chronology,
         expansion_params, proposal_used, word_count, is_revert, reverted_from_version_id, created_at)
        SELECT id, article_id, version_number, COALESCE(summary, ''), '', '',
               expansion_params, proposal_used, word_count, is_revert, reverted_from_version_id, created_at
        FROM article_versions`);
      db.exec(`DROP TABLE article_versions`);
      db.exec(`ALTER TABLE article_versions_new RENAME TO article_versions`);
      db.exec(`PRAGMA foreign_keys = ON`);
    }
  }

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
      category_id           TEXT REFERENCES categories(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT PRIMARY KEY,
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_categories_world ON categories(world_id, sort_order);

    CREATE TABLE IF NOT EXISTS article_versions (
      id                       TEXT PRIMARY KEY,
      article_id               TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      version_number           INTEGER NOT NULL,
      introduction             TEXT NOT NULL DEFAULT '',
      description              TEXT NOT NULL DEFAULT '',
      chronology               TEXT NOT NULL DEFAULT '',
      expansion_params         TEXT,
      proposal_used            TEXT,
      word_count               INTEGER NOT NULL DEFAULT 0,
      is_revert                INTEGER NOT NULL DEFAULT 0,
      is_published             INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS name_bank (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      profile_id  TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      source      TEXT NOT NULL DEFAULT 'generated',
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_name_bank_world ON name_bank(world_id, entity_type);

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
