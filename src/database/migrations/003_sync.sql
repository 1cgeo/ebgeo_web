-- Path: src/database/migrations/003_sync.sql
-- Baseline: infra de sync — operations (log CRDT append-only, idempotente por
-- op_id), active_sessions (presença WS) e resources (basemaps/layers/tilesets)
-- com config já preenchida p/ GET /api/v1/config. Consolida 003/005/006/010.
-- client_id é TEXT (clientes geram ids string), não UUID.

-- ============================================================================
-- OPERATIONS (CRDT sync log - append-only)
-- Idempotência: op_id vem do cliente; reenvio colide em (atlas_id, op_id) e é
-- ignorado no push (INSERT ... ON CONFLICT DO NOTHING). op_id NULL fica distinto.
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

    -- Conflict resolution metadata. client_id é TEXT (id string do frontend).
    client_timestamp    BIGINT NOT NULL,
    client_id           TEXT NOT NULL,
    server_version      BIGINT NOT NULL DEFAULT nextval('atlas_version_seq'),

    -- Lamport clock (lógico) carregado pela op do frontend. NÃO decide o vencedor
    -- (LWW é por ordem de chegada ao servidor) — persistido só para ecoar no pull
    -- incremental, deixando o cliente avançar seu Lamport clock a cada op recebida.
    lamport_timestamp   BIGINT,

    -- Idempotência: id da operação fornecido pelo cliente (TEXT, formato livre).
    op_id               TEXT,

    -- Audit
    user_id             UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary index for incremental sync: "give me all ops after version X for this atlas"
CREATE INDEX idx_operations_atlas_version ON operations(atlas_id, server_version);
CREATE INDEX idx_operations_entity ON operations(entity_type, entity_id);
CREATE INDEX idx_operations_atlas_created ON operations(atlas_id, created_at);

-- Uniqueness per atlas para idempotência do push.
CREATE UNIQUE INDEX operations_atlas_op_id_uniq ON operations (atlas_id, op_id);

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
-- ACTIVE SESSIONS (WebSocket presence awareness). client_id TEXT (id do cliente).
-- ============================================================================
CREATE TABLE active_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    atlas_id            UUID NOT NULL REFERENCES atlas(id),
    client_id           TEXT NOT NULL,

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
-- RESOURCES (basemaps, layers, tilesets, etc). config espelha o shape congelado
-- do GET /api/v1/config (config.js) — antes preenchida pela migração 010.
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

-- Seed inicial (config já no shape de GET /api/v1/config).
INSERT INTO resources (id, category, name, sort_order, config) VALUES
  ('carta-topografica', 'basemap', 'Topográfica', 1, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-topografica-thumb.png', 'priority', 1)),
  ('carta-ortoimagem', 'basemap', 'Ortoimagem', 2, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-ortoimagem-thumb.png', 'priority', 2)),
  ('bdgex', 'basemap', 'BDGEx', 3, jsonb_build_object(
    'enabled', true, 'image', './images/layers/bdgex-thumb.png', 'priority', 3)),
  ('osm', 'basemap', 'OSM', 4, jsonb_build_object('enabled', false, 'priority', 4)),
  ('imagens', 'basemap', 'Imagens', 5, jsonb_build_object('enabled', false, 'priority', 5)),
  ('hillshade', 'analysis_layer', 'Sombreamento do Relevo', 1, '{}'::jsonb),
  ('PCL', 'tileset', 'Posto de Comando Logístico', 1, jsonb_build_object(
    'url', '/3d/PCL/tileset.json', 'heightOffset', 35,
    'description', 'Modelo 3D do Posto de Comando Logístico capturado por drone',
    'keywords', jsonb_build_array('PCL', 'posto comando', 'logística', 'drone'),
    'data_captura', '15/03/2024', 'local', 'Resende, RJ',
    'previewVideo', '/3d/videos/preview.webm', 'previewThumbnail', '/3d/videos/thumbnail.jpg',
    'locate', jsonb_build_object('lon', -44.47332385414955, 'lat', -22.43976556982974, 'height', 1000)));
