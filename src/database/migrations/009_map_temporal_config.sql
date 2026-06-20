-- Path: src/database/migrations/009_map_temporal_config.sql
-- Temporal config per map (§29 items 1, 8-11). Shared map state (broadcast +
-- LWW). GATED: the frontend is currently local-only (EventBus, no sync op yet);
-- the backend persists it once the frontend starts emitting the `mapTemporal` op.
ALTER TABLE maps
  ADD COLUMN IF NOT EXISTS temporal_config JSONB NOT NULL DEFAULT '{}';
