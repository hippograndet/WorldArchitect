-- Grow's internal naming was split three ways (expand/forge/spark) for one
-- feature; the app now calls it Forge everywhere. This backfills the two
-- stored string values that predate the rename so old rows read correctly
-- through the same code paths as new ones (dev-docs/reference/glossary.md's
-- Forge row has the full naming history). run_config's embedded JSON
-- pipelineType is deliberately left alone — nothing reads it back out, only
-- the dedicated pipeline_type/run_type columns matter at read time.
UPDATE runs
SET graph_type = 'forge'
WHERE graph_type = 'expand';

UPDATE pending_drafts
SET run_type = 'expand_description'
WHERE run_type = 'forge_expand';
