-- Replace the non-exclusive article_versions.is_published flag (nothing ever
-- cleared it on republish, so two versions of the same article could both
-- carry is_published=1) with a single articles.published_version_id pointer
-- to the one official version. Editing an article no longer needs to be
-- blocked to protect "published" content — the published pointer is simply
-- never touched by ordinary edits, only by the Publish action itself.
-- No REFERENCES constraint, same as the pre-existing current_version_id column:
-- snapshot restore (routes/snapshots.ts) inserts articles before their
-- article_versions rows exist, so this pointer can't be FK-enforced.
ALTER TABLE articles ADD COLUMN published_version_id TEXT;

UPDATE articles a
SET published_version_id = (
  SELECT av.id FROM article_versions av
  WHERE av.article_id = a.id AND av.is_published = 1
  ORDER BY av.version_number DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM article_versions av WHERE av.article_id = a.id AND av.is_published = 1
);

ALTER TABLE article_versions DROP COLUMN is_published;

-- Edges stay unversioned (always resolve live to whatever's current), but
-- record which version of each endpoint was current at the moment the edge
-- was set, for historical/audit purposes only.
ALTER TABLE article_links ADD COLUMN source_version_id TEXT REFERENCES article_versions(id) ON DELETE SET NULL;
ALTER TABLE article_links ADD COLUMN target_version_id TEXT REFERENCES article_versions(id) ON DELETE SET NULL;
