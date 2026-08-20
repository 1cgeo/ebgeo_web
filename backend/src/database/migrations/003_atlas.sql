-- Path: src/database/migrations/003_atlas.sql
-- ATLAS: a árvore da entidade colaborativa — atlas, atlas_shares, atlas_covers,
-- maps, layers, groups, features, group_features, comments, catalog_layers,
-- cesium3d_data, streetview360_data, images, briefings, slides.
--
-- Geometria do atlas é JSONB (mesmo formato do IndexedDB); SEM PostGIS no schema
-- public do atlas. O dado espacial de referência mora em `ng`, e o do 360 em
-- `sv360`, os dois em schema próprio e fora do CRDT.

-- ============================================================================
-- ATLAS
-- ============================================================================
CREATE TABLE atlas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id),

    -- Ordered map IDs (UUID array preserves insertion order)
    map_order       UUID[] NOT NULL DEFAULT '{}',

    -- Flexible settings: controls which app-level resources are available in this atlas.
    settings        JSONB NOT NULL DEFAULT '{
        "features": {
            "map_3d": true,
            "panoramic_images": true,
            "terrain_3d": true,
            "data_layers": true,
            "analysis_layers": true
        },
        "basemaps": [],
        "default_basemap": null,
        "bounds_2d": null,
        "min_zoom": null,
        "max_zoom": null,
        "available_analysis_layers": [],
        "available_data_layers": [],
        "available_3d_models": [],
        "available_360_views": []
    }'::jsonb,

    -- Public sharing
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    public_link     VARCHAR(100) UNIQUE,

    -- Sync metadata (hybrid sync support)
    version         INTEGER NOT NULL DEFAULT 1,
    min_version     BIGINT NOT NULL DEFAULT 0,
    current_version BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_atlas_owner ON atlas(owner_id);
CREATE INDEX idx_atlas_public_link ON atlas(public_link) WHERE public_link IS NOT NULL;
CREATE INDEX idx_atlas_not_deleted ON atlas(id) WHERE deleted_at IS NULL;

-- ============================================================================
-- ATLAS SHARES (per-user access control)
-- ============================================================================
CREATE TABLE atlas_shares (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission      VARCHAR(10) NOT NULL CHECK (permission IN ('read', 'comment', 'write', 'manage')),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by        UUID REFERENCES users(id),

    UNIQUE(atlas_id, user_id)
);

CREATE INDEX idx_atlas_shares_atlas ON atlas_shares(atlas_id);
CREATE INDEX idx_atlas_shares_user ON atlas_shares(user_id);

-- ============================================================================
-- ATLAS COVERS — a imagem que substitui as duas letras sobre cor no cartão da
-- tela "Seus atlas".
-- ============================================================================
--
-- TABELA À PARTE, e não coluna em `atlas`, por uma razão medida: `LIST_USER_ATLAS`,
-- `FIND_ATLAS_BY_ID` e o snapshot de sync fazem `SELECT a.*`, e quatro telas do cliente
-- chamam `listAtlas()` (o controle de conta, a aba Mapas, o nome do atlas e esta tela).
-- Uma coluna de imagem viajaria nas quatro por acidente. Aqui a capa só sai quando
-- alguém a pede.
--
-- BYTEA, não a data URI que o cliente manda: o serviço decodifica na borda, confere o
-- número mágico contra o mime declarado (mesma regra do upload de imagem: png/jpeg/webp,
-- SEM svg) e guarda os bytes. Base64 no banco seria 33% maior e guardaria sem conferir.
--
-- Sem soft-delete: "Remover imagem" apaga a linha. A regra de nunca apagar de verdade
-- vale para entidade principal, e capa é atributo de apresentação, recriável em dois
-- cliques.
CREATE TABLE atlas_covers (
    atlas_id    UUID PRIMARY KEY REFERENCES atlas(id) ON DELETE CASCADE,
    mime_type   VARCHAR(20) NOT NULL
                  CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    bytes       BYTEA NOT NULL,
    width       INTEGER,
    height      INTEGER,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID REFERENCES users(id)
);

COMMENT ON TABLE atlas_covers IS
    'Capa (thumbnail) de um atlas. Uma linha por atlas, no máximo. O cliente reduz a imagem antes '
    'de enviar; o servidor limita o tamanho no schema Joi da rota.';

-- ============================================================================
-- MAPS
-- ============================================================================
--
-- NÃO EXISTE COLUNA `catalog_layers` AQUI, e a ausência é decisão, não lacuna. A
-- camada de catálogo de um mapa mora em UM lugar só: a tabela dedicada
-- `catalog_layers`, mais abaixo. Enquanto a coluna existiu em paralelo, ela era
-- uma SEGUNDA cópia sem leitor, servida crua por três saídas que não passam pela
-- reidratação do snapshot (`GET /atlas/:id/maps`, `GET /atlas/:id/maps/:id` e
-- `POST /maps/:id/duplicate`), URL de recurso privado inclusive. Filtrar a
-- resposta das três protegeria as rotas que alguém LEMBROU; sem leitor, o dado não
-- precisa de filtro, precisa não existir. `POST /atlas/import` continua ACEITANDO
-- `map.catalog_layers` no payload e materializa direto na tabela.
CREATE TABLE maps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,

    -- Viewport state
    base_layer      VARCHAR(100) NOT NULL DEFAULT 'carta-topografica',
    center_lat      DOUBLE PRECISION,
    center_long     DOUBLE PRECISION,
    zoom            DOUBLE PRECISION,
    bearing         DOUBLE PRECISION NOT NULL DEFAULT 0,
    pitch           DOUBLE PRECISION NOT NULL DEFAULT 0,
    locked          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Map notes
    notes_title     TEXT,
    notes_description TEXT,

    -- Complex nested data stored as JSONB
    analysis_layers JSONB NOT NULL DEFAULT '{}',
    grid_style      JSONB NOT NULL DEFAULT '{}',
    temporal_config JSONB NOT NULL DEFAULT '{}',

    -- Sync metadata
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_maps_atlas ON maps(atlas_id);
CREATE INDEX idx_maps_not_deleted ON maps(id) WHERE deleted_at IS NULL;

-- ============================================================================
-- LAYERS
-- ============================================================================
CREATE TABLE layers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    visible         BOOLEAN NOT NULL DEFAULT TRUE,
    locked          BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    style           JSONB NOT NULL DEFAULT '{}',
    opacity         DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT layers_opacity_range CHECK (opacity >= 0 AND opacity <= 1)
);

CREATE INDEX idx_layers_map ON layers(map_id);
CREATE INDEX idx_layers_not_deleted ON layers(id) WHERE deleted_at IS NULL;

-- ============================================================================
-- GROUPS
-- ============================================================================
CREATE TABLE groups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    visible         BOOLEAN NOT NULL DEFAULT TRUE,
    locked          BOOLEAN NOT NULL DEFAULT FALSE,
    style           JSONB NOT NULL DEFAULT '{}',
    parent_id       UUID REFERENCES groups(id) ON DELETE SET NULL,

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_groups_map ON groups(map_id);
CREATE INDEX idx_groups_not_deleted ON groups(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_groups_parent ON groups(parent_id) WHERE parent_id IS NOT NULL;

-- ============================================================================
-- FEATURES
-- Geometry is stored as JSONB (same format as IndexedDB/frontend).
-- No PostGIS dependency — the app loads all features per map, so spatial
-- queries on the server are unnecessary.
-- ============================================================================
CREATE TABLE features (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,

    feature_type    VARCHAR(50) NOT NULL,

    -- Geometry stored as-is from the frontend (coordinates, type, etc.)
    geometry        JSONB NOT NULL DEFAULT '{}',

    -- All style, attribute, and type-specific properties
    properties      JSONB NOT NULL DEFAULT '{}',

    -- Organizational layer reference.
    --
    -- SEM "REFERENCES layers(id)", E ISSO E DELIBERADO. Repare que as irmas deste mesmo
    -- arquivo TEM a FK (groups.parent_id, group_features.group_id), entao a ausencia aqui
    -- parece esquecimento e nao e: acrescentar a FK e uma regressao de sync, nao higiene
    -- de schema.
    --
    -- O motivo: as operacoes chegam por ordem de chegada num log, nao numa ordem
    -- topologica. Uma feicao pode referenciar uma camada cujo CREATE ainda nao chegou, ou
    -- cujo CREATE foi eliminado pela compactacao da fila de saida do cliente
    -- (CREATE+DELETE some do par). Com FK, esses casos viram 23503 e ENVENENAM o lote
    -- inteiro, travando a fila daquele cliente para sempre. Sem FK, viram uma referencia
    -- pendurada, que o cliente degrada mostrando a feicao fora de camada.
    --
    -- Integridade referencial nao e imponivel num log de aplicacao por ordem de chegada.
    -- Registrado em docs/wiki/atlas-modelo-de-dados.md.
    layer_id        UUID,

    -- Sync metadata
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    CONSTRAINT valid_feature_type CHECK (feature_type IN (
        'point', 'line', 'polygon', 'text', 'image',
        'circle', 'rectangle', 'ellipse', 'brush', 'sector',
        'arrow', 'boundary', 'occupied_front',
        'military_symbol', 'coordination_measure', 'magnetic_declination',
        'los', 'visibility',
        'processed_los', 'processed_visibility'
    ))
);

CREATE INDEX idx_features_map ON features(map_id);
CREATE INDEX idx_features_type ON features(feature_type);
CREATE INDEX idx_features_layer ON features(layer_id) WHERE layer_id IS NOT NULL;
CREATE INDEX idx_features_not_deleted ON features(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_features_properties ON features USING GIN(properties);

-- ============================================================================
-- GROUP_FEATURES (junction table: many-to-many between groups and features)
-- ============================================================================
CREATE TABLE group_features (
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, feature_id)
);

CREATE INDEX idx_group_features_feature ON group_features(feature_id);

-- ============================================================================
-- COMMENTS (comentário espacial — ver docs/visao-e-principios.md §11 no frontend)
-- Raiz (parent_id NULL, com lng/lat → pin no mapa) e respostas (parent_id → raiz).
-- Sincroniza pelo pipeline de ops (entityType 'comment'). NÃO é enviado a conexões
-- de nível 'read' (Visualizador/anônimo) — filtro de transmissão no snapshot/broadcast.
-- Respostas são entidades próprias (parent_id) para não haver clobber LWW (P10).
-- ============================================================================
CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    parent_id       UUID REFERENCES comments(id) ON DELETE CASCADE,
    author_id       UUID REFERENCES users(id),

    -- Pin coordinate (root only; NULL for replies)
    lng             DOUBLE PRECISION,
    lat             DOUBLE PRECISION,
    status          VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),

    -- Full comment payload as-is from the frontend (text, authorInitials, authorColor, ...)
    data            JSONB NOT NULL DEFAULT '{}',

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_comments_atlas ON comments(atlas_id);
CREATE INDEX idx_comments_map ON comments(map_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;

-- ============================================================================
-- CATALOG LAYERS — a entidade por-camada de catálogo de um mapa. Espelha o
-- domínio de sync (soft-delete + version).
-- ============================================================================
--
-- `id` É TEXT, E NUNCA FOI UUID. O cliente é a autoridade sobre esse id e o
-- `CatalogService` monta ids literais (`frontend/src/js/catalog/catalog.service.js`):
--
--     'hillshade' | `analysis-${layer.id}` | `data-${layer.id}`
--     `3d-${tileset.id}` | `360-${p.id}`
--
-- Esse valor vira o id da camada no store e viaja como entityId da operação de
-- sync, e o handler inbound do cliente indexa `mapData.catalogLayers` por ele.
-- Com a coluna tipada UUID o INSERT levantava 22P02 (que a borda traduz em 400);
-- como todo o push roda num único `tx()`, o lote INTEIRO abortava, inclusive as
-- feições que viajavam junto, e a operação permanecia na fila do IndexedDB: todo
-- flush seguinte remontava o mesmo lote e falhava igual. Era um poison pill que
-- matava a sincronização daquele cliente em definitivo. O mesmo raciocínio vale
-- onde o id também vem do cliente: `operations.client_id`, `operations.op_id` e
-- `sv360.photos.id` são TEXT.
--
-- A PK É `(map_id, id)`, e é consequência direta do acima. O id do cliente NÃO é
-- globalmente único: ele é uma CONSTANTE do catálogo. Todo mapa que adicionar
-- "Sombreamento do Relevo" usa o mesmo id `hillshade`. Com `PRIMARY KEY (id)`, o
-- primeiro mapa ficava com a linha e todos os outros caíam no
-- `ON CONFLICT (id) DO NOTHING` em silêncio: a camada sumia do segundo mapa em
-- diante, sem erro, e o push ainda era acked como sucesso. Isso nunca apareceu
-- porque toda a suíte usava `randomUUID()` como id de camada, e UUID é
-- globalmente único por construção. O escopo real da unicidade sempre foi
-- (map_id, id), que é como as queries de update e delete deste módulo já filtram.
--
-- Regressão: tests/integration/sync-catalog-layer.test.js, bloco "real catalog
-- ids (non-UUID) round-trip".
CREATE TABLE catalog_layers (
    id          TEXT NOT NULL,               -- layer id comes from the client
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    data        JSONB NOT NULL DEFAULT '{}',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,

    CONSTRAINT catalog_layers_pkey PRIMARY KEY (map_id, id)
);

CREATE INDEX idx_catalog_layers_map ON catalog_layers(map_id) WHERE deleted_at IS NULL;

-- ============================================================================
-- CESIUM 3D DATA
-- ============================================================================
CREATE TABLE cesium3d_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    data_type       VARCHAR(50) NOT NULL CHECK (data_type IN (
                        'marker', 'measurement', 'viewshed', 'camera_position'
                    )),
    tileset_id      VARCHAR(100),
    data            JSONB NOT NULL,

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_cesium3d_map ON cesium3d_data(map_id);
CREATE INDEX idx_cesium3d_type ON cesium3d_data(data_type);
CREATE INDEX idx_cesium3d_tileset ON cesium3d_data(tileset_id) WHERE tileset_id IS NOT NULL;

-- ============================================================================
-- STREETVIEW 360 DATA (orientação/marcadores 360 DENTRO do atlas/sync; distinto
-- do schema sv360, que é read-only e fora do CRDT — ver 007_sv360.sql)
-- ============================================================================
CREATE TABLE streetview360_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    data_type       VARCHAR(50) NOT NULL CHECK (data_type IN ('orientation', 'marker')),
    photo_name      VARCHAR(255),
    data            JSONB NOT NULL,

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_streetview360_map ON streetview360_data(map_id);
CREATE INDEX idx_streetview360_type ON streetview360_data(data_type);

-- ============================================================================
-- IMAGES
-- mime_type alinhado à allowlist da app (png/jpeg/webp; SEM svg → anti-XSS).
-- ============================================================================
CREATE TABLE images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL CHECK (mime_type IN (
                        'image/png', 'image/jpeg', 'image/webp'
                    )),
    size_bytes      INTEGER,
    storage_path    VARCHAR(500) NOT NULL,
    uploaded_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_images_atlas ON images(atlas_id);

-- ============================================================================
-- BRIEFINGS
-- ============================================================================
CREATE TABLE briefings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    settings        JSONB NOT NULL DEFAULT '{
        "panelPosition": "left",
        "panelWidth": 350,
        "panelBackgroundColor": "rgba(255, 255, 255, 0.95)"
    }'::jsonb,
    slide_order     UUID[] NOT NULL DEFAULT '{}',

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_briefings_atlas ON briefings(atlas_id);
CREATE INDEX idx_briefings_not_deleted ON briefings(id) WHERE deleted_at IS NULL;

-- ============================================================================
-- SLIDES
-- ============================================================================
CREATE TABLE slides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    briefing_id     UUID NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
    title           VARCHAR(500),
    content         TEXT,
    mode            VARCHAR(10) NOT NULL DEFAULT '2d' CHECK (mode IN ('2d', '3d', '360')),
    map_id          UUID REFERENCES maps(id) ON DELETE SET NULL,
    model_id        VARCHAR(100),
    photo_id        VARCHAR(100),
    position        JSONB NOT NULL DEFAULT '{"longitude":null,"latitude":null,"zoom":null,"altitude":null}',
    orientation     JSONB NOT NULL DEFAULT '{"bearing":0,"pitch":0,"heading":null}',
    -- Cursor temporal do slide 2D (v2.2; §29). NULL = sem cursor salvo.
    temporal_cursor JSONB,
    is_broken       BOOLEAN NOT NULL DEFAULT FALSE,
    broken_reason   VARCHAR(50),

    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_slides_briefing ON slides(briefing_id);
CREATE INDEX idx_slides_map ON slides(map_id) WHERE map_id IS NOT NULL;
CREATE INDEX idx_slides_not_deleted ON slides(id) WHERE deleted_at IS NULL;

-- When a map is soft-deleted, mark referencing slides as broken
CREATE FUNCTION mark_slides_broken_on_map_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE slides
        SET is_broken = TRUE,
            broken_reason = 'map_deleted',
            updated_at = NOW(),
            version = version + 1
        WHERE map_id = NEW.id AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mark_slides_broken
AFTER UPDATE OF deleted_at ON maps
FOR EACH ROW
EXECUTE FUNCTION mark_slides_broken_on_map_delete();
