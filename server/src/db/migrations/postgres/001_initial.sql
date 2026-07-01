CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  tone TEXT NOT NULL DEFAULT 'narrative',
  origin_point TEXT,
  style_config TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_world ON categories(owner_id, world_id, sort_order);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stub',
  template_type TEXT NOT NULL DEFAULT 'general',
  temporal_anchor_start TEXT,
  temporal_anchor_end TEXT,
  is_fixed_point INTEGER NOT NULL DEFAULT 0,
  current_version_id TEXT,
  depth INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_world ON articles(owner_id, world_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  introduction TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  chronology TEXT NOT NULL DEFAULT '',
  expansion_params TEXT,
  proposal_used TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  is_revert INTEGER NOT NULL DEFAULT 0,
  is_published INTEGER NOT NULL DEFAULT 0,
  reverted_from_version_id TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_links (
  source_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  target_article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'references',
  PRIMARY KEY (source_article_id, target_article_id)
);

CREATE TABLE IF NOT EXISTS world_bible_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_bible_meta (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_settings (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  daily_cap INTEGER,
  bible_threshold INTEGER NOT NULL DEFAULT 80000
);

CREATE TABLE IF NOT EXISTS provider_settings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'none',
  config TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS call_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  article_id TEXT REFERENCES articles(id),
  tokens_in INTEGER,
  tokens_out INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_call_log_world ON call_log(owner_id, world_id, created_at DESC);
