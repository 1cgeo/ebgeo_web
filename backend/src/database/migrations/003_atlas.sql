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
    --
    -- NÃO HÁ ZOOM DE ATLAS, e a ausência é a decisão (do dono, 2026-08-31). Existiram aqui
    -- `min_zoom` e `max_zoom`: validados por `atlas.schemas.js`, persistidos, clonados e
    -- cobertos por teste, e LIDOS POR NINGUÉM: `grep min_zoom frontend/src` não devolvia uma
    -- linha. Eram contrato reservado que nunca virou comportamento, e o preço de mantê-los era
    -- um relato de "o limite de zoom do atlas não funciona" que não seria bug.
    --
    -- A faixa de zoom passou a ter DOIS níveis e só um deles é configurável: a aplicação é fixa
    -- em [2, 21] (`config.static.js`, `MAP2D_BASE`), e o MAPA BASE aperta dentro dela por
    -- `config.minzoom`/`config.maxzoom` da linha de `basemaps`. Não recrie estas duas chaves
    -- por simetria com `bounds_2d`: quem restringe zoom é o mapa base, não o atlas.
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
-- O ALVO É UMA PESSOA OU UM GRUPO, NUNCA OS DOIS, pelo mesmo `num_nonnulls` de
-- `resource_grants`: gate ou tela que assuma `user_id` não-nulo ignora o
-- compartilhamento coletivo sem erro nenhum. Quem resolve "qual permissão este usuário
-- tem neste atlas" somando os dois caminhos é `fn_user_atlas_shares` (008), e não uma
-- segunda cópia da regra em JavaScript.
CREATE TABLE atlas_shares (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id        UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    permission      VARCHAR(10) NOT NULL CHECK (permission IN ('read', 'comment', 'write', 'manage')),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by        UUID REFERENCES users(id),
    -- POR ULTIMO, e nao ao lado de `user_id`: a coluna nasceu num `ADD COLUMN` e a ordem
    -- das colunas e observavel.
    group_id        UUID REFERENCES access_groups(id) ON DELETE CASCADE,

    CONSTRAINT atlas_shares_alvo_unico_check CHECK (num_nonnulls(user_id, group_id) = 1),
    UNIQUE(atlas_id, user_id),
    CONSTRAINT atlas_shares_atlas_id_group_id_key UNIQUE (atlas_id, group_id)
);

CREATE INDEX idx_atlas_shares_atlas ON atlas_shares(atlas_id);
CREATE INDEX idx_atlas_shares_user ON atlas_shares(user_id);
CREATE INDEX idx_atlas_shares_group ON atlas_shares (group_id) WHERE group_id IS NOT NULL;

-- ============================================================================
-- ATLAS COVERS — a imagem que substitui as duas letras sobre cor no cartão da
-- tela "Seus atlas".
-- ============================================================================
--
-- TABELA À PARTE, e não coluna em `atlas`: as consultas de atlas e o snapshot fazem
-- `SELECT a.*`, e quatro telas chamam `listAtlas()`. Uma coluna de imagem viajaria nas
-- quatro por acidente; aqui a capa só sai quando alguém a pede.
--
-- BYTEA, não a data URI que o cliente manda: o serviço decodifica na borda e confere o
-- número mágico contra o mime declarado. Base64 seria 33% maior e guardaria sem conferir.
--
-- Sem soft-delete: capa é atributo de apresentação, recriável em dois cliques.
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
-- NÃO EXISTE COLUNA `catalog_layers` AQUI, e a ausência é decisão. A camada de
-- catálogo mora em UM lugar só, a tabela dedicada mais abaixo. Enquanto a coluna existiu
-- em paralelo, era uma segunda cópia sem leitor, servida CRUA por três saídas que não
-- passam pela reidratação do snapshot, URL de recurso privado inclusive. Filtrar as três
-- protegeria as rotas que alguém lembrou; sem leitor, o dado não precisa de filtro,
-- precisa não existir. O import continua aceitando `map.catalog_layers` no payload.
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
    -- SEM "REFERENCES layers(id)", E E DELIBERADO: as irmas deste arquivo TEM a FK
    -- (groups.parent_id, group_features.group_id), entao a ausencia parece esquecimento.
    -- Acrescenta-la e regressao de SYNC, nao higiene de schema. As operacoes chegam por
    -- ordem de chegada num log, nunca em ordem topologica, e uma feicao pode referenciar
    -- camada cujo CREATE ainda nao chegou ou foi eliminado pela compactacao da fila
    -- (CREATE+DELETE some do par). Com FK isso vira 23503, ENVENENA o lote inteiro e trava
    -- a fila daquele cliente para sempre; sem FK vira referencia pendurada, que o cliente
    -- degrada mostrando a feicao fora de camada. Ver docs/wiki/atlas-modelo-de-dados.md.
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
-- COMMENTS — comentário espacial. Raiz (parent_id NULL, com lng/lat) e respostas.
-- Sincroniza pelo pipeline de ops e NÃO é transmitido a conexões de nível 'read' (filtro
-- no snapshot e no broadcast). Resposta é entidade própria, e não item dentro da raiz,
-- para não haver clobber LWW.
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
-- `id` É TEXT PORQUE VEM DO CLIENTE, que monta ids literais ('hillshade',
-- `analysis-<id>`, `3d-<id>`, `360-<id>`). Com a coluna tipada UUID o INSERT levantava
-- 22P02, e como todo o push roda num `tx()` o LOTE abortava junto, feições incluídas,
-- ficando na fila do IndexedDB para falhar igual no flush seguinte: poison pill que
-- matava a sincronização daquele cliente. Mesmo raciocínio em `operations.client_id`,
-- `operations.op_id` e `sv360.photos.id`.
--
-- A PK É `(map_id, id)` por consequência: o id do cliente é uma CONSTANTE do catálogo e
-- não é globalmente único (todo mapa com "Sombreamento do Relevo" usa `hillshade`). Com
-- `PRIMARY KEY (id)` o primeiro mapa ficava com a linha e os outros caíam num
-- `ON CONFLICT DO NOTHING` silencioso, com o push ainda acked como sucesso. Não aparecia
-- porque a suíte usava `randomUUID()` como id. Regressão em
-- tests/integration/sync-catalog-layer.test.js, "real catalog ids (non-UUID) round-trip".
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
