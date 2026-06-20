-- Path: src/database/migrations/006_operations_idempotency.sql
-- Idempotency for the CRDT operations log.
-- The operation id comes from the client (op.id). Resending the same operation
-- must NOT duplicate the log row nor re-apply its effect.

-- Client-provided operation id (TEXT: clients may use any stable id format).
ALTER TABLE operations ADD COLUMN IF NOT EXISTS op_id TEXT;

-- Defensive backfill for pre-existing rows: use the server PK as a stable op_id
-- so the unique index below can be built without collisions.
UPDATE operations SET op_id = id::text WHERE op_id IS NULL;

-- Uniqueness per atlas. The same op resent collides and is ignored on push
-- (INSERT ... ON CONFLICT (atlas_id, op_id) DO NOTHING). NULL op_ids remain
-- distinct (legacy/edge ops without an id are simply not de-duplicated).
CREATE UNIQUE INDEX IF NOT EXISTS operations_atlas_op_id_uniq
  ON operations (atlas_id, op_id);
