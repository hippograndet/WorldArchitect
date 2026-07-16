-- Adds an explicit pointer to each world's root article (the one with no
-- incoming 'hierarchical' link), so WorldInfoContext can read {title,
-- introduction} directly instead of every caller re-deriving "the root" via
-- an article_links scan. No REFERENCES constraint, same reasoning as
-- articles.current_version_id/published_version_id: snapshot restore
-- (routes/snapshots.ts) inserts articles before this pointer can be set, and
-- world creation itself sets it in a follow-up UPDATE after the article row
-- exists (see routes/worlds.ts), not in the same INSERT.
ALTER TABLE worlds ADD COLUMN root_article_id TEXT;

-- Backfill existing worlds: per world, the article with no incoming
-- hierarchical link. Ties (shouldn't happen for a well-formed world, but the
-- data predates this constraint being enforced) resolve to the
-- lowest-depth, earliest-created candidate.
UPDATE worlds w
SET root_article_id = (
  SELECT a.id
  FROM articles a
  WHERE a.world_id = w.id
    AND NOT EXISTS (
      SELECT 1 FROM article_links al
      WHERE al.target_article_id = a.id AND al.link_type = 'hierarchical'
    )
  ORDER BY a.depth ASC, a.created_at ASC
  LIMIT 1
)
WHERE root_article_id IS NULL;
