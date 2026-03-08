-- Path: src/database/migrations/003_sync.sql
-- Sync infrastructure: operations (CRDT), sessions, resources

-- ============================================================================
-- OPERATIONS (CRDT sync log - append-only)
-- ============================================================================
CREATE SEQUENCE atlas_version_seq;

CREATE TABLE operations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id            UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,

    -- Operation data
    op_type             VARCHAR(20) NOT NULL CHECK (op_type IN ('create', 'update', 'delete')),
    entity_type         VARCHAR(50) NOT NULL,
    entity_id           UUID NOT NULL,
    map_id              UUID,

    -- Payload (mutually exclusive: creates use data, updates use changes)
    changes             JSONB,
    data                JSONB,

    -- Conflict resolution metadata
    client_timestamp    BIGINT NOT NULL,
    client_id           UUID NOT NULL,
    server_version      BIGINT NOT NULL DEFAULT nextval('atlas_version_seq'),

    -- Audit
    user_id             UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary index for incremental sync: "give me all ops after version X for this atlas"
CREATE INDEX idx_operations_atlas_version ON operations(atlas_id, server_version);
CREATE INDEX idx_operations_entity ON operations(entity_type, entity_id);
CREATE INDEX idx_operations_atlas_created ON operations(atlas_id, created_at);

-- Trigger to update atlas.current_version when operations are inserted
CREATE OR REPLACE FUNCTION update_atlas_current_version()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE atlas
  SET current_version = NEW.server_version,
      updated_at = NOW()
  WHERE id = NEW.atlas_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_atlas_version
AFTER INSERT ON operations
FOR EACH ROW
EXECUTE FUNCTION update_atlas_current_version();

-- ============================================================================
-- ACTIVE SESSIONS (WebSocket presence awareness)
-- ============================================================================
CREATE TABLE active_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    atlas_id            UUID NOT NULL REFERENCES atlas(id),
    client_id           UUID NOT NULL,

    connected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Presence data
    cursor_position     JSONB,                        -- { lng, lat }
    current_map_id      UUID,
    selected_features   UUID[] DEFAULT '{}',

    UNIQUE(user_id, atlas_id, client_id)
);

CREATE INDEX idx_sessions_atlas ON active_sessions(atlas_id);
CREATE INDEX idx_sessions_heartbeat ON active_sessions(last_heartbeat);

-- ============================================================================
-- RESOURCES (basemaps, layers, tilesets, etc)
-- ============================================================================
CREATE TABLE resources (
    id VARCHAR(100) PRIMARY KEY,
    category VARCHAR(50) NOT NULL CHECK (category IN (
      'basemap', 'analysis_layer', 'data_layer', 'tileset', 'streetview_marker'
    )),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    config JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_resources_category ON resources(category);
CREATE INDEX idx_resources_active ON resources(category) WHERE active = true;

-- Seed with initial resources
INSERT INTO resources (id, category, name, sort_order) VALUES
  ('carta-topografica', 'basemap', 'Topográfica', 1),
  ('carta-ortoimagem', 'basemap', 'Ortoimagem', 2),
  ('bdgex', 'basemap', 'BDGEx', 3),
  ('osm', 'basemap', 'OSM', 4),
  ('imagens', 'basemap', 'Imagens', 5),
  ('hillshade', 'analysis_layer', 'Sombreamento do Relevo', 1),
  ('PCL', 'tileset', 'Posto de Comando Logístico', 1);
