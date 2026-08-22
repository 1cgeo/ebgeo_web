-- Path: src/database/migrations/007_sv360.sql
-- STREETVIEW 360 (schema sv360): projects, capture_runs, photos, andares, targets,
-- tracks, tombstones e o metadado da pirâmide de tiles. FORA do sync/CRDT/WS do
-- atlas. Os binários WebP vivem em SQLite por projeto ({orgId}__{slug}.db), nunca
-- aqui: este schema guarda metadado e o ponto PostGIS.

-- ============================================================================
-- 1) Extensão e schema
-- ============================================================================
-- O `CREATE EXTENSION` aqui torna este arquivo autossuficiente: sem ele, o domínio
-- dependeria da ordem do gazetteer por um motivo que nada aqui explica.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS sv360;

-- ============================================================================
-- 2) projects
-- ============================================================================
-- FK para public.organizations SEM `ON DELETE`: reatribua antes de qualquer
-- hard-delete (mesma regra de `atlas.owner_id`). `entry_photo_id` é referência
-- LÓGICA a photos.id, porque pode não existir no momento da ingestão.
--
-- `organization_id` JÁ É a OM produtora (o projeto chega por bundle sob um
-- `{orgId}__{slug}.db`, e a coluna faz parte do UNIQUE). Por isso não há
-- `owner_org_id` como nas tabelas de catálogo: seria uma segunda resposta para a
-- mesma pergunta.
--
-- `capture_date` é a data da CAMPANHA e é TEXT de propósito: é o tipo da origem;
-- campanha nem sempre é um dia (há projeto que registra a mais recente entre
-- várias, e projeto que registra a data de PROCESSAMENTO); e TIMESTAMPTZ faria
-- '2026-05-20' virar instante e mudar de dia conforme o fuso da sessão. O contrato
-- público já emite `captureDate` como string.
--
-- `access_level` é ortogonal a `status`, e é por isso que é coluna e não um
-- terceiro valor: `disabled` é "oculto, visível para a OM dona"; `private` é "não
-- é público, visível para a OM dona MAIS quem tem concessão". `enabled` +
-- `private` é o caso que a combinação torna possível.
CREATE TABLE sv360.projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id),
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    center_lat      DOUBLE PRECISION,
    center_long     DOUBLE PRECISION,
    entry_photo_id  TEXT,
    photo_count     INTEGER NOT NULL DEFAULT 0,
    db_filename     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'enabled'
        CHECK (status IN ('enabled','disabled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    capture_date    TEXT,
    access_level    VARCHAR(20) NOT NULL DEFAULT 'public'
                      CHECK (access_level IN ('public','private')),
    UNIQUE (organization_id, slug)
);
CREATE INDEX idx_sv360_projects_org ON sv360.projects(organization_id);
-- Parcial no lado PRIVADO: é o conjunto pequeno, e é ele que a resolução de acesso
-- visita.
CREATE INDEX idx_sv360_projects_private ON sv360.projects(id) WHERE access_level = 'private';

-- ============================================================================
-- 3) capture_runs — as FAIXAS DE COLETA
-- ============================================================================
-- Faixa = uma sessão de gravação (uma corrida contínua do veículo). É a
-- granularidade em que a montagem da câmera não muda, logo a granularidade em que
-- a calibração é constante; as medições que sustentam a escolha estão em
-- docs/wiki/ingestao-projetos-360.md.
--
-- A fronteira vem do identificador de SESSÃO no nome do arquivo, NUNCA de corte
-- por tempo: as fotos disparam por distância, então um veículo parado no semáforo
-- produz um intervalo longo, e um corte temporal partiria a faixa no sinal
-- vermelho. `session_key` é namespaced por origem para não colidir em projeto que
-- mistura os dois padrões de nome.
--
-- `applied_rotation_*` REGISTRA o último default aplicado, para a interface dizer
-- "faixa calibrada em N graus". Não é herança: o lote escreve direto em
-- sv360.photos, que segue sendo a única verdade da calibração.
--
-- Vem antes de `photos` porque `photos.run_id` a referencia.
CREATE TABLE sv360.capture_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    session_key        TEXT NOT NULL,
    label              TEXT NOT NULL,
    -- Só um dos dois padrões de nome carrega a hora; no outro fica NULL.
    started_at         TIMESTAMPTZ,
    -- 1..N. Cronológica quando TODAS as faixas têm started_at; caso contrário por
    -- tamanho decrescente, porque os ids de sessão do equipamento não são cronológicos.
    ordinal            INTEGER NOT NULL,
    photo_count        INTEGER NOT NULL DEFAULT 0,
    applied_rotation_y DOUBLE PRECISION,
    applied_rotation_x DOUBLE PRECISION,
    applied_rotation_z DOUBLE PRECISION,
    UNIQUE (project_id, session_key)
);

CREATE INDEX idx_sv360_capture_runs_project ON sv360.capture_runs(project_id, ordinal);

-- ============================================================================
-- 4) photos
-- ============================================================================
-- `id` é o UUID fornecido pelo cliente (v5 determinístico no estúdio): TEXT, SEM
-- default. O servidor valida o formato e nunca recalcula.
--
-- `capture_date` é o instante desta foto e é a ÚNICA coluna de hora de captura por
-- foto: a origem chama o campo de `captured_at`, e uma segunda coluna com esse
-- nome foi recusada por ser o mesmo parâmetro. Quem porta ETL mapeia lá, não aqui.
--
-- `floor_label` é o rótulo do andar desta foto; num projeto sem andares fica nulo
-- para sempre, que é o correto.
--
-- `calibration_source` diz COMO o ângulo foi obtido: 'sol' (o Sol foi detectado
-- nesta foto), 'imu' (refinada pela rajada do giroscópio), 'manual' (o revisor
-- escreveu, e sobrescreve os outros dois) ou NULL, que significa que NÃO houve
-- medida sobre esta foto: o ângulo veio do bloco da faixa ou de interpolação. Foto
-- sem medida própria é a que mais merece o olho na revisão.
CREATE TABLE sv360.photos (
    id                   TEXT PRIMARY KEY,
    project_id           UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    original_name        TEXT NOT NULL,
    display_name         TEXT,
    sequence_number      INTEGER NOT NULL,
    lat                  DOUBLE PRECISION NOT NULL,
    lon                  DOUBLE PRECISION NOT NULL,
    ele                  DOUBLE PRECISION,
    heading              DOUBLE PRECISION NOT NULL DEFAULT 0,
    camera_height        DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_x      DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_y      DOUBLE PRECISION NOT NULL DEFAULT 0,
    mesh_rotation_z      DOUBLE PRECISION NOT NULL DEFAULT 0,
    distance_scale       DOUBLE PRECISION NOT NULL DEFAULT 1,
    marker_scale         DOUBLE PRECISION NOT NULL DEFAULT 1,
    -- NÍVEL DO ANDAR, a régua que todo consumidor aplica: 0 = TÉRREO (externo,
    -- pátio, campo e todo espaço interno no nível do solo), 1 = primeiro andar
    -- interno, negativo = subsolo. Inteiro ORDENÁVEL porque o seletor empilha os
    -- andares de cima para baixo. O DEFAULT 0 diverge do DEFAULT 1 da origem, e a
    -- divergência se resolve na INGESTÃO: importar o 1 cru rotularia foto de chão
    -- como "1º andar".
    floor_level          INTEGER NOT NULL DEFAULT 0,
    full_size_bytes      BIGINT NOT NULL DEFAULT 0,
    preview_size_bytes   BIGINT NOT NULL DEFAULT 0,
    calibration_reviewed BOOLEAN NOT NULL DEFAULT false,
    capture_date         TIMESTAMPTZ,
    geom                 GEOMETRY(POINT, 4326),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    floor_label          TEXT,
    run_id               UUID REFERENCES sv360.capture_runs(id),
    run_position         INTEGER,
    calibration_source   TEXT,
    UNIQUE (project_id, sequence_number)
);
CREATE INDEX idx_sv360_photos_project       ON sv360.photos(project_id);
CREATE INDEX idx_sv360_photos_geom          ON sv360.photos USING GIST (geom);
CREATE INDEX idx_sv360_photos_original_name ON sv360.photos(original_name);
-- Filtro de andar dentro de um projeto; sem ele o seletor vira varredura sobre
-- todas as fotos do projeto.
CREATE INDEX idx_sv360_photos_floor         ON sv360.photos(project_id, floor_level);
CREATE INDEX idx_sv360_photos_run           ON sv360.photos(run_id, run_position);

-- Mantém geom coerente com lon/lat, porque COPY e ETL não passam pela projeção
-- feita na aplicação.
CREATE FUNCTION sv360.fn_photos_set_geom() RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sv360_photos_geom
  BEFORE INSERT OR UPDATE OF lon, lat ON sv360.photos
  FOR EACH ROW EXECUTE FUNCTION sv360.fn_photos_set_geom();

-- ============================================================================
-- 5) project_floors — os ANDARES
-- ============================================================================
-- Uma tabela, e não uma marca no projeto, porque o andar é propriedade da FOTO: um
-- levantamento tem N andares MAIS áreas externas, e um campo único não descreveria
-- o dado.
--
-- QUEM DECIDE QUE UM PROJETO TEM ANDARES é a EXISTÊNCIA de linhas aqui, nunca o
-- valor de `floor_level`. É o que a interface consulta para desenhar (ou não) o
-- seletor, e o que deixa todo projeto externo já ingerido sem efeito colateral.
--
-- `label` é coluna e não expressão do nível porque dois espaços no MESMO nível
-- podem ter nomes diferentes na tela ('Externo', 'Campo', 'Pátio').
--
-- `plan_coords` é JSONB e não geometria: o conteúdo é uma lista de LineStrings e o
-- consumo é sempre "devolva a planta inteira deste andar", nunca consulta espacial.
CREATE TABLE sv360.project_floors (
    project_id  UUID    NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    level       INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    plan_coords JSONB,
    PRIMARY KEY (project_id, level)
);

-- ============================================================================
-- 6) targets — o grafo dirigido de vizinhança
-- ============================================================================
-- As colunas internas `bearing_deg`/`distance_m` afloram como `bearing`/`distance`
-- no contrato JSON.
CREATE TABLE sv360.targets (
    source_id         TEXT NOT NULL REFERENCES sv360.photos(id) ON DELETE CASCADE,
    target_id         TEXT NOT NULL REFERENCES sv360.photos(id) ON DELETE CASCADE,
    distance_m        DOUBLE PRECISION,
    bearing_deg       DOUBLE PRECISION,
    is_next           BOOLEAN NOT NULL DEFAULT false,
    is_original       BOOLEAN NOT NULL DEFAULT false,
    override_bearing  DOUBLE PRECISION,
    override_distance DOUBLE PRECISION,
    override_height   DOUBLE PRECISION,
    hidden            BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (source_id, target_id)
);
CREATE INDEX idx_sv360_targets_source
  ON sv360.targets(source_id) WHERE hidden = false;

-- O índice do lado NÃO-LÍDER da FK em cascata, por MEDIÇÃO e não por higiene: são
-- duas FKs para sv360.photos(id), ambas ON DELETE CASCADE; `source_id` é coberta
-- pela PK e `target_id` não seria coberta por nada, porque o Postgres não indexa a
-- coluna referenciante. Sem ele, cada linha removida de photos força SEQ SCAN
-- aqui, e como o merge é PURGE + REINSERT toda reingestão paga: no corpus real,
-- um único DELETE ficou preso por mais de dez minutos.
--
-- SEM `WHERE hidden = false`, ao contrário do índice de `source_id`: índice parcial
-- não serve para verificação de FK, que precisa enxergar toda linha referenciante.
CREATE INDEX idx_sv360_targets_target_id ON sv360.targets(target_id);

-- ============================================================================
-- 7) tracks — os TRECHOS DE TRAJETO
-- ============================================================================
-- Uma tabela, e não uma linha derivada das fotos: o dado real traz milhares de
-- trechos separados, e ligar tudo numa polilinha por projeto faz a linha saltar de
-- um percurso ao outro e desenhar um emaranhado que não corresponde a caminho
-- nenhum. Trecho é dado de ORIGEM.
--
-- `source` preserva a proveniência e é informativo. Projeto sem track cai no
-- fallback da query MVT.
CREATE TABLE sv360.tracks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    -- LINESTRING em 4326, o mesmo referencial de sv360.photos.geom.
    geom       GEOMETRY(LINESTRING, 4326) NOT NULL,
    source     TEXT NOT NULL DEFAULT 'geojson',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O tile filtra por bbox (`&&`) e agrupa por projeto: os dois índices da query MVT.
CREATE INDEX idx_sv360_tracks_project ON sv360.tracks(project_id);
CREATE INDEX idx_sv360_tracks_geom    ON sv360.tracks USING GIST (geom);

-- ============================================================================
-- 8) deleted_photos — o tombstone
-- ============================================================================
-- SEM FK, por decisão: o tombstone precisa sobreviver à foto. O preço atravessa o
-- módulo, e está escrito em docs/wiki/ingestao-projetos-360.md: toda rota que
-- remove foto tem de purgar tombstone explicitamente, senão as linhas voltam e
-- ficam invisíveis em toda leitura, que filtram por `NOT EXISTS (deleted_photos)`.
CREATE TABLE sv360.deleted_photos (
    photo_id   TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 9) photo_pyramids — o metadado da pirâmide de tiles
-- ============================================================================
-- Os BYTES ficam em {orgId}__{slug}_tiles.db (SQLite); aqui fica a grade.
--
-- A ESCADA SE LÊ DAQUI, NUNCA SE DEDUZ. A regra de parada morava só no código da
-- origem, e mudá-la reinterpretou em silêncio todo acervo já escrito: 98.854 das
-- 99.035 fotos passaram a ser lidas com uma escada diferente da que as produziu, e
-- o sintoma não é erro, é tile faltando. Por isso `max_level` e `razao` são
-- colunas, e por isso quem monta a grade recebe as duas em vez de recalcular.
CREATE TABLE sv360.photo_pyramids (
    photo_id    TEXT PRIMARY KEY REFERENCES sv360.photos(id) ON DELETE CASCADE,
    tile_size   INTEGER NOT NULL,
    max_level   INTEGER NOT NULL,
    width       INTEGER NOT NULL,
    height      INTEGER NOT NULL,
    quality     INTEGER NOT NULL,
    tile_count  INTEGER NOT NULL,
    total_bytes BIGINT  NOT NULL,
    built_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    razao       REAL NOT NULL DEFAULT 2,
    CONSTRAINT photo_pyramids_tile_size_positivo CHECK (tile_size > 0),
    CONSTRAINT photo_pyramids_dimensoes_positivas CHECK (width > 0 AND height > 0),
    CONSTRAINT photo_pyramids_max_level_nao_negativo CHECK (max_level >= 0),
    CONSTRAINT photo_pyramids_razao_maior_que_um CHECK (razao > 1),
    CONSTRAINT photo_pyramids_contagem_nao_negativa CHECK (tile_count >= 0 AND total_bytes >= 0)
);
CREATE INDEX idx_photo_pyramids_project
    ON sv360.photo_pyramids (photo_id)
    INCLUDE (max_level, tile_size, total_bytes);
COMMENT ON TABLE sv360.photo_pyramids IS
    'Metadado da piramide de tiles de uma foto 360. Os BYTES ficam em {orgId}__{slug}_tiles.db (SQLite), nunca aqui.';
COMMENT ON COLUMN sv360.photo_pyramids.razao IS
    'Razao entre niveis da escada. Contrato: a grade sai de (width, height, tile_size, razao), e reconstruir com outra razao produz tile faltando sem erro.';
COMMENT ON COLUMN sv360.photo_pyramids.max_level IS
    'Nivel mais fino GRAVADO. Leia daqui; recalcular pela regra de hoje sobre banco escrito ontem ja errou 98.854 de 99.035 fotos na origem.';
