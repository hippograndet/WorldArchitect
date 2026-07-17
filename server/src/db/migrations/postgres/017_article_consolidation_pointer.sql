-- Tracks which version of an article was current the last time a Cohere
-- (per-article Consolidate) run completed against it, so Publish can warn
-- "no coherence review since the last edit" with a cheap column comparison
-- instead of scanning the entire runs history on every request. No
-- REFERENCES constraint, same reasoning as articles.current_version_id/
-- published_version_id/root_article_id: this can point at a version that
-- doesn't exist yet at insert time in some flows (snapshot restore).
ALTER TABLE articles ADD COLUMN last_consolidated_version_id TEXT;

-- Backfill: for articles with a completed cohere run whose completion time
-- is at or after their current version's creation, mark that version as
-- reviewed. Articles with no qualifying run keep NULL (never reviewed),
-- which is the correct default for anything this can't establish.
UPDATE articles a
SET last_consolidated_version_id = a.current_version_id
WHERE a.current_version_id IS NOT NULL
  AND a.last_consolidated_version_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM runs r
    JOIN article_versions av ON av.id = a.current_version_id
    WHERE r.world_id = a.world_id
      AND r.owner_id = a.owner_id
      AND r.graph_type = 'consolidate'
      AND r.status = 'completed'
      AND r.run_config::jsonb ->> 'pipelineType' = 'cohere'
      AND r.article_ids::jsonb @> to_jsonb(a.id::text)
      AND r.updated_at >= av.created_at
  );
