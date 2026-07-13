-- Persists Forge's already-computed failedItemCount onto the run row so the
-- client can distinguish "items dequeued" from "items that actually succeeded".
ALTER TABLE runs ADD COLUMN IF NOT EXISTS items_failed BIGINT NOT NULL DEFAULT 0;
