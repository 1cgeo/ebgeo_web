-- Path: src/database/migrations/008_catalog_layers.sql
-- catalogLayer per-layer entity (§19 item 4; §2). The frontend emits one op
-- per catalog layer (entityId = layer id). A dedicated table mirrors the rest
-- of the sync domain (soft-delete + version), instead of trying to fit a
-- per-layer payload into the legacy `maps.catalog_layers` array column (which
-- is kept for backward compatibility / clone / import / whole-array clients).
CREATE TABLE IF NOT EXISTS catalog_layers (
    id          UUID PRIMARY KEY,            -- layer id comes from the client
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    data        JSONB NOT NULL DEFAULT '{}',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catalog_layers_map
  ON catalog_layers(map_id) WHERE deleted_at IS NULL;
