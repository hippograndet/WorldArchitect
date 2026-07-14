-- world_bible_entries duplicated "the article's introduction" alongside
-- article_versions.introduction, with Inception writing only to the former.
-- Reconcile any article where they've diverged, then drop both Bible tables —
-- article_versions.introduction (via articles.current_version_id) is now the
-- single source of truth; the World Bible is a derived read over it.

UPDATE article_versions av
SET introduction = wbe.summary
FROM world_bible_entries wbe, articles a
WHERE a.id = wbe.article_id
  AND a.current_version_id = av.id
  AND av.introduction IS DISTINCT FROM wbe.summary;

DROP TABLE IF EXISTS world_bible_entries;
DROP TABLE IF EXISTS world_bible_meta;
