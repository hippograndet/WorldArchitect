import type Database from 'better-sqlite3';
import { LOCAL_USER_ID } from '../config.js';

function tryAlter(db: Database.Database, sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!msg.includes('already exists') && !msg.includes('duplicate column name')) throw err;
  }
}

function addOwnerColumn(db: Database.Database, table: string): void {
  tryAlter(db, `ALTER TABLE ${table} ADD COLUMN owner_id TEXT NOT NULL DEFAULT '${LOCAL_USER_ID}'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_owner ON ${table}(owner_id)`);
}

function addWorldOwnerTrigger(db: Database.Database, table: string, keyPredicate: string): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_owner_from_world
    AFTER INSERT ON ${table}
    WHEN NEW.owner_id = '${LOCAL_USER_ID}'
    BEGIN
      UPDATE ${table}
      SET owner_id = COALESCE((SELECT owner_id FROM worlds WHERE id = NEW.world_id), '${LOCAL_USER_ID}')
      WHERE ${keyPredicate};
    END
  `);
}

function addArticleOwnerTrigger(db: Database.Database, table: string, keyPredicate: string): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_${table}_owner_from_article
    AFTER INSERT ON ${table}
    WHEN NEW.owner_id = '${LOCAL_USER_ID}'
    BEGIN
      UPDATE ${table}
      SET owner_id = COALESCE((SELECT owner_id FROM articles WHERE id = NEW.article_id), '${LOCAL_USER_ID}')
      WHERE ${keyPredicate};
    END
  `);
}

function addOwnerColumnsAndTriggers(db: Database.Database): void {
  [
    'worlds',
    'articles',
    'categories',
    'article_versions',
    'article_links',
    'coherence_warnings',
    'world_bible_entries',
    'world_bible_meta',
    'world_snapshots',
    'call_log',
    'pending_drafts',
    'cost_settings',
    'name_bank',
    'auditor_edge_proposals',
    'entity_mentions',
    'article_issues',
    'publish_history',
    'world_issues',
  ].forEach((table) => addOwnerColumn(db, table));

  [
    ['articles', 'id = NEW.id'],
    ['categories', 'id = NEW.id'],
    ['world_bible_entries', 'id = NEW.id'],
    ['world_bible_meta', 'world_id = NEW.world_id'],
    ['world_snapshots', 'id = NEW.id'],
    ['call_log', 'id = NEW.id'],
    ['cost_settings', 'world_id = NEW.world_id'],
    ['name_bank', 'id = NEW.id'],
    ['auditor_edge_proposals', 'id = NEW.id'],
    ['entity_mentions', 'id = NEW.id'],
    ['article_issues', 'id = NEW.id'],
    ['publish_history', 'id = NEW.id'],
    ['world_issues', 'id = NEW.id'],
  ].forEach(([table, predicate]) => addWorldOwnerTrigger(db, table, predicate));

  [
    ['article_versions', 'id = NEW.id'],
    ['pending_drafts', 'id = NEW.id'],
    ['coherence_warnings', 'id = NEW.id'],
  ].forEach(([table, predicate]) => addArticleOwnerTrigger(db, table, predicate));

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_article_links_owner_from_source
    AFTER INSERT ON article_links
    WHEN NEW.owner_id = '${LOCAL_USER_ID}'
    BEGIN
      UPDATE article_links
      SET owner_id = COALESCE((SELECT owner_id FROM articles WHERE id = NEW.source_article_id), '${LOCAL_USER_ID}')
      WHERE source_article_id = NEW.source_article_id AND target_article_id = NEW.target_article_id;
    END
  `);
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

  // M15: hosted multi-tenancy ownership columns and inheritance triggers.
  addOwnerColumnsAndTriggers(db);

  // M16: Runs — server-side LangGraph run tracking + article locking.
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id             TEXT PRIMARY KEY,
      world_id       TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      owner_id       TEXT NOT NULL DEFAULT '${LOCAL_USER_ID}',
      status         TEXT NOT NULL DEFAULT 'pending',
      graph_type     TEXT NOT NULL DEFAULT 'forge',
      checkpoint_id  TEXT NOT NULL,
      article_ids    TEXT NOT NULL DEFAULT '[]',
      budget_used    INTEGER NOT NULL DEFAULT 0,
      budget_limit   INTEGER NOT NULL DEFAULT 200000,
      error_message  TEXT,
      items_completed INTEGER NOT NULL DEFAULT 0,
      items_total    INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_world ON runs(world_id, status)`);
  addWorldOwnerTrigger(db, 'runs', 'id = NEW.id');

  tryAlter(db, `ALTER TABLE articles ADD COLUMN locked_by_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_locked_by_run ON articles(locked_by_run_id)`);

  // M17: Forge migrated server-side — rename the leftover 'spark' graph_type
  // value, drop the now-unused interrupt-review column (Forge has no content
  // review gate), and add a queryable per-run event log replacing the
  // client-only forgeLog array.
  // runs.status values: pending | running | paused | completed | stopped | failed
  db.exec(`UPDATE runs SET graph_type = 'forge' WHERE graph_type = 'spark'`);
  {
    const hasPendingReview = (db.prepare(
      `SELECT COUNT(*) AS n FROM pragma_table_info('runs') WHERE name = 'pending_review'`,
    ).get() as { n: number }).n > 0;
    if (hasPendingReview) db.exec(`ALTER TABLE runs DROP COLUMN pending_review`);
  }
  // Queue progress, surfaced to the client's forgeCompleted/forgeTotal UI —
  // CREATE TABLE IF NOT EXISTS above doesn't retrofit these onto a runs table
  // that already existed before this migration, hence the explicit ALTERs.
  tryAlter(db, `ALTER TABLE runs ADD COLUMN items_completed INTEGER NOT NULL DEFAULT 0`);
  tryAlter(db, `ALTER TABLE runs ADD COLUMN items_total INTEGER NOT NULL DEFAULT 0`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_events (
      id         TEXT PRIMARY KEY,
      run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step       TEXT NOT NULL,
      title      TEXT NOT NULL,
      ok         INTEGER NOT NULL DEFAULT 1,
      message    TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at)`);
  // No owner_id here — run_events has no direct world_id/article_id to derive
  // it from (unlike the tables addWorldOwnerTrigger/addArticleOwnerTrigger
  // handle); every read joins through runs(run_id) for tenant scoping instead.
  // Drop a stray owner-trigger from an earlier draft of this migration that
  // referenced run_events.article_id (a column it never had) — CREATE TRIGGER
  // IF NOT EXISTS never removes triggers a later code change stops creating,
  // so any environment that ran that draft needs this explicit cleanup.
  db.exec(`DROP TRIGGER IF EXISTS trg_run_events_owner_from_article`);

  // M18: call_log — tool-loop iteration count + pipeline-run correlation, so
  // the Usage page can group agent calls by the pipeline invocation they
  // belonged to and compare real vs. expected iteration counts per agent.
  tryAlter(db, `ALTER TABLE call_log ADD COLUMN iterations INTEGER`);
  tryAlter(db, `ALTER TABLE call_log ADD COLUMN pipeline_run_id TEXT`);
  tryAlter(db, `ALTER TABLE call_log ADD COLUMN pipeline_type TEXT`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_call_log_pipeline_run ON call_log(world_id, pipeline_run_id)`);

  // M19: full-text search index for the search_articles tool — a driver-
  // specific side table (mirrored by Postgres migration 005_search_index.sql,
  // tsvector there instead of FTS5), not a column on articles/article_versions,
  // so schemaDrift.test.ts's column-diff check never sees it.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS article_search_fts USING fts5(
      article_id UNINDEXED,
      world_id   UNINDEXED,
      title,
      description
    )
  `);
  // FTS5 virtual tables can't declare a FOREIGN KEY (virtual tables don't
  // support them), so cleanup on article delete needs an explicit trigger
  // rather than ON DELETE CASCADE — Postgres's real table gets cascade instead.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_article_search_fts_delete
    AFTER DELETE ON articles
    BEGIN
      DELETE FROM article_search_fts WHERE article_id = OLD.id;
    END
  `);
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id           TEXT PRIMARY KEY,
      owner_id     TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id              TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id   TEXT NOT NULL DEFAULT 'local-user',
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_categories_world ON categories(world_id, sort_order);

    CREATE TABLE IF NOT EXISTS article_versions (
      id                       TEXT PRIMARY KEY,
      owner_id                 TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id          TEXT NOT NULL DEFAULT 'local-user',
      link_type         TEXT NOT NULL DEFAULT 'references',
      PRIMARY KEY (source_article_id, target_article_id)
    );

    CREATE INDEX IF NOT EXISTS idx_article_links_target ON article_links(target_article_id, link_type);
    CREATE INDEX IF NOT EXISTS idx_article_links_source ON article_links(source_article_id, link_type);

    CREATE TABLE IF NOT EXISTS coherence_warnings (
      id                TEXT PRIMARY KEY,
      owner_id          TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id   TEXT NOT NULL DEFAULT 'local-user',
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      article_id TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
      summary    TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_bible_meta (
      world_id    TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
      owner_id    TEXT NOT NULL DEFAULT 'local-user',
      token_count INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_snapshots (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL DEFAULT 'local-user',
      world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id            TEXT PRIMARY KEY,
      owner_id      TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id          TEXT NOT NULL DEFAULT 'local-user',
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
      owner_id        TEXT NOT NULL DEFAULT 'local-user',
      daily_cap       INTEGER,
      bible_threshold INTEGER NOT NULL DEFAULT 80000
    );

    CREATE TABLE IF NOT EXISTS name_bank (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL DEFAULT 'local-user',
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
