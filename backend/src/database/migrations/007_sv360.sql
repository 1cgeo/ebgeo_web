-- Path: src/database/migrations/007_sv360.sql
-- STREETVIEW 360 (schema sv360) — metadados de projects/photos/targets/tracks/
-- andares/faixas de coleta, mais tombstones. FORA do sync/CRDT/WS do atlas.
-- Binários WebP vivem em SQLite por projeto ({orgId}__{slug}.db), NÃO aqui: só
-- metadado e o ponto PostGIS.
--
-- `gen_random_uuid()` nas PKs, EXCETO `sv360.photos.id`, que é o UUID v5
-- determinístico fornecido pelo cliente (D9.6) — TEXT e SEM default.

-- ============================================================================
-- 1) Extensão e schema
-- ============================================================================
-- `CREATE EXTENSION IF NOT EXISTS postgis` aqui torna este arquivo AUTOSSUFICIENTE
-- e desfaz uma dependência de ordem que era acidental: enquanto só o gazetteer
-- criava PostGIS, este arquivo precisava vir depois dele por um motivo que nada
-- neste domínio explica. É idempotente, e em teste/dev a extensão já vem
-- pré-criada por superusuário.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS sv360;

-- ============================================================================
-- 2) projects (mission/OM-scoped panorama set)
-- ============================================================================
-- FK para public.organizations SEM `ON DELETE` — reatribua antes de qualquer
-- hard-delete (mesma regra de `atlas.owner_id`). `entry_photo_id` é referência
-- LÓGICA a photos.id (pode não existir no momento da ingestão).
--
-- `organization_id` JÁ É a OM produtora (o projeto é ingerido por bundle, sob um
-- `{orgId}__{slug}.db`, e a coluna faz parte do UNIQUE), por isso este domínio
-- NÃO tem uma coluna `owner_org_id` como as tabelas de catálogo: criar uma
-- segunda coluna daria duas respostas para a mesma pergunta.
--
-- `capture_date` é a DATA DA CAMPANHA do PROJETO, não da foto, e é TEXT por três
-- razões: (1) é o tipo da origem, e a coluna existe para transportar aquele valor
-- sem reinterpretá-lo; (2) campanha nem sempre é um dia — há projeto que registra
-- a campanha mais recente entre várias, e projeto que registra a data de
-- PROCESSAMENTO dos metadados porque as imagens não têm data própria, e um tipo de
-- instante daria precisão que o dado não tem; (3) TIMESTAMPTZ faria '2026-05-20'
-- virar um instante e mudar de dia conforme o fuso da sessão, trocando a data que
-- a tela mostra. O contrato público já emite `captureDate` como string.
--
-- `access_level` é eixo ORTOGONAL a `status`, e é por isso que é coluna e não um
-- terceiro valor de status: `disabled` significa "oculto", visível para a OM dona;
-- `private` significa "não é público", visível para a OM dona MAIS quem tem
-- concessão. `enabled` + `private` é o caso que a combinação torna possível (D6).
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
-- Índice parcial no lado PRIVADO (o conjunto pequeno, e é ele que a resolução
-- de acesso visita).
CREATE INDEX idx_sv360_projects_private ON sv360.projects(id) WHERE access_level = 'private';

-- ============================================================================
-- 3) capture_runs — as FAIXAS DE COLETA de um projeto
-- ============================================================================
-- Faixa de coleta = uma SESSÃO DE GRAVAÇÃO: uma corrida contínua do veículo, do
-- momento em que o operador iniciou a captura até parar.
--
-- POR QUE ESTA GRANULARIDADE: é a granularidade em que a calibração é constante,
-- porque é a granularidade em que a montagem da câmera não muda. As medições que
-- sustentam a escolha (desvio DENTRO da faixa contra desvio ENTRE faixas) estão em
-- docs/wiki/ingestao-projetos-360.md; a conclusão é que "aplicar ao projeto" é
-- grosso demais.
--
-- A FRONTEIRA vem do identificador de SESSÃO gravado pelo equipamento no nome do
-- arquivo, NÃO de um corte por intervalo de tempo: as fotos são disparadas por
-- distância, então um veículo parado num semáforo produz um intervalo longo sem
-- deslocamento nenhum, e um corte temporal partiria a faixa ao meio no sinal
-- vermelho. `session_key` é NAMESPACED por origem para não colidir em projeto que
-- mistura os dois padrões de nome.
--
-- `applied_rotation_*` é REGISTRO do último default aplicado, para a interface
-- poder dizer "faixa calibrada em N graus". NÃO é herança: o lote escreve direto
-- em sv360.photos, que continua sendo a única verdade da calibração.
--
-- Vem ANTES de `photos` porque `photos.run_id` referencia esta tabela.
CREATE TABLE sv360.capture_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    session_key        TEXT NOT NULL,
    label              TEXT NOT NULL,
    -- Início da sessão. Só um dos dois padrões de nome carrega a hora; no outro
    -- fica NULL até o time_img da fonte ser importado.
    started_at         TIMESTAMPTZ,
    -- Posição da faixa na lista do projeto, 1..N. Cronológica quando TODAS as
    -- faixas do projeto têm started_at; caso contrário por tamanho decrescente,
    -- porque os ids de sessão do equipamento não são cronológicos.
    ordinal            INTEGER NOT NULL,
    photo_count        INTEGER NOT NULL DEFAULT 0,
    applied_rotation_y DOUBLE PRECISION,
    applied_rotation_x DOUBLE PRECISION,
    applied_rotation_z DOUBLE PRECISION,
    UNIQUE (project_id, session_key)
);

CREATE INDEX idx_sv360_capture_runs_project ON sv360.capture_runs(project_id, ordinal);

-- ============================================================================
-- 4) photos (per-photo panorama metadata + flat calibration + PostGIS point)
-- ============================================================================
-- `id` é o UUID v5 fornecido pelo cliente: TEXT, SEM `gen_random_uuid()`.
--
-- `capture_date` é o instante em que ESTA foto foi tirada, e é a ÚNICA coluna de
-- hora de captura por foto: a origem chama o campo de `captured_at`, e uma segunda
-- coluna com esse nome foi RECUSADA porque é o mesmo parâmetro. Duas colunas para
-- uma medida só é defeito, não redundância útil. Fica `capture_date` porque é a
-- que já está fiada de ponta a ponta (o upload administrativo a escreve, o
-- manifesto a aceita e a leitura a serve como `captureDate`). Quem porta ETL da
-- origem mapeia `captured_at` para cá; a tradução mora no ETL, não no schema.
--
-- `floor_label` é o rótulo do andar DESTA foto. Entra nulo, e só um projeto com
-- andares o preenche: num projeto externo fica nulo para sempre, que é o correto,
-- porque não há andar para nomear.
--
-- `calibration_source` diz COMO o ângulo daquela foto foi obtido:
--   'sol'     o Sol foi detectado NESTA foto e entrou no ajuste;
--   'imu'     sem sol utilizável, refinada pela rajada do giroscópio;
--   'manual'  o revisor escreveu o ângulo, por foto, faixa ou projeto;
--   NULL      NÃO houve medida SOBRE esta foto: o ângulo veio do bloco da faixa
--             ou de interpolação entre vizinhas.
-- 'manual' sobrescreve os outros dois, porque mão humana derruba a origem
-- automática. A distinção importa na revisão: foto sem medida própria é a que mais
-- merece o olho, porque nada nela foi conferido contra o mundo.
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
    -- NÍVEL DO ANDAR (decisão do chefe, e é a régua que todo consumidor aplica):
    --   nível  0  = TÉRREO (o chão: externo, pátio, campo, e todo espaço interno
    --               no nível do solo);
    --   nível  1  = PRIMEIRO ANDAR INTERNO;
    --   nível <0  = SUBSOLO (-1 é o primeiro subsolo).
    -- É INTEIRO ORDENÁVEL porque o seletor da interface empilha os andares de cima
    -- para baixo. O DEFAULT 0 daqui DIVERGE do DEFAULT 1 da origem, e a divergência
    -- se resolve na INGESTÃO, não no schema: sob a régua comum, importar o 1 cru
    -- rotularia foto de chão como "1º andar".
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
-- Filtro de andar dentro de um projeto (o seletor da interface, e o recorte por
-- andar da consulta de vizinhança). Sem ele o filtro vira varredura sobre todas as
-- fotos do projeto.
CREATE INDEX idx_sv360_photos_floor         ON sv360.photos(project_id, floor_level);
CREATE INDEX idx_sv360_photos_run           ON sv360.photos(run_id, run_position);

-- Keep geom consistent with lon/lat (COPY/ETL bypasses app-side projection).
CREATE FUNCTION sv360.fn_photos_set_geom() RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sv360_photos_geom
  BEFORE INSERT OR UPDATE OF lon, lat ON sv360.photos
  FOR EACH ROW EXECUTE FUNCTION sv360.fn_photos_set_geom();

-- ============================================================================
-- 5) project_floors — os ANDARES de um projeto
-- ============================================================================
-- POR QUE UMA TABELA, e não uma marca no projeto: o andar é propriedade da FOTO,
-- não do projeto. Um mesmo levantamento tem N andares MAIS áreas externas, então
-- um campo único no projeto não descreveria o dado. A tabela guarda a LISTA de
-- andares e a planta de cada um; a foto guarda em que andar ela está
-- (`floor_level`) e como aquele andar se chama na tela (`floor_label`).
--
-- QUEM DECIDE QUE UM PROJETO TEM ANDARES é a EXISTÊNCIA de linhas aqui, NUNCA o
-- valor de `floor_level`. É a única coisa que a interface consulta para decidir se
-- desenha o seletor de andar, o que deixa todo projeto externo já ingerido sem
-- nenhum efeito colateral.
--
-- `label` é COLUNA e não expressão derivada do nível porque dois espaços no MESMO
-- nível podem ter nomes diferentes na tela ('Externo', 'Campo', 'Pátio'). O rótulo
-- padrão de um nível sem nome próprio está em docs/wiki/ingestao-projetos-360.md.
--
-- `plan_coords` é JSONB e não geometria PostGIS: o conteúdo é uma lista de
-- LineStrings ([[[lon,lat],...],...]) e o consumo é sempre "devolva a planta
-- inteira deste andar", nunca consulta espacial sobre os vértices. NULL vale para
-- o nível que existe e não tem planta desenhada (tipicamente o externo).
CREATE TABLE sv360.project_floors (
    project_id  UUID    NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    level       INTEGER NOT NULL,
    label       TEXT    NOT NULL,
    plan_coords JSONB,
    PRIMARY KEY (project_id, level)
);

-- ============================================================================
-- 6) targets (directed photo-to-photo adjacency graph)
-- ============================================================================
-- next/original links com overrides opcionais por aresta + visibilidade. As
-- colunas internas `bearing_deg`/`distance_m` afloram como `bearing`/`distance`
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

-- O índice do lado NÃO-LÍDER da FK em cascata, e ele existe por medição, não por
-- higiene: esta tabela tem DUAS FKs para sv360.photos(id), ambas ON DELETE
-- CASCADE. `source_id` é coberta pela PK; `target_id` não seria coberta por nada,
-- e o Postgres não cria índice para a coluna REFERENCIANTE de uma FK. Sem ele,
-- cada linha removida de sv360.photos força um SEQ SCAN completo aqui. Não é
-- micro-otimização: o merge de um projeto é PURGE + REINSERT ("último upload
-- manda"), então toda REINGESTÃO paga o custo, e no corpus real isso deixou um
-- único DELETE preso por mais de dez minutos.
--
-- SEM `WHERE hidden = false`, ao contrário do índice de `source_id`: índice
-- PARCIAL não serve para verificação de FK, que precisa enxergar toda linha
-- referenciante, inclusive as ocultas.
CREATE INDEX idx_sv360_targets_target_id ON sv360.targets(target_id);

-- ============================================================================
-- 7) tracks — os TRECHOS DE TRAJETO capturados
-- ============================================================================
-- POR QUE UMA TABELA, e não derivar a linha das fotos: o dado real traz MILHARES
-- de trechos separados (um único projeto chega a dezenas de percursos distintos
-- para milhares de fotos). Ligar tudo numa polilinha só, com
-- `ST_MakeLine(geom ORDER BY sequence_number)` agrupado por projeto, faz a linha
-- saltar de um percurso ao outro e o mapa desenhar um emaranhado que atravessa o
-- enquadramento inteiro: geometria que não corresponde a nenhum caminho
-- percorrido. Trecho é dado de ORIGEM, não algo derivável da ordem das fotos.
--
-- `source` preserva a proveniência que o estúdio registra; é informativo e não
-- muda o desenho. Projeto sem track cai no comportamento antigo (a query MVT
-- mantém o fallback).
CREATE TABLE sv360.tracks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    -- LINESTRING em 4326, igual ao referencial de sv360.photos.geom.
    geom       GEOMETRY(LINESTRING, 4326) NOT NULL,
    source     TEXT NOT NULL DEFAULT 'geojson',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O tile filtra por bbox (`&&`) e agrupa por projeto: os dois índices que a query
-- MVT usa.
CREATE INDEX idx_sv360_tracks_project ON sv360.tracks(project_id);
CREATE INDEX idx_sv360_tracks_geom    ON sv360.tracks USING GIST (geom);

-- ============================================================================
-- 8) deleted_photos (tombstone). SEM FK — a linha de photos pode já ter sumido
--    (referência lógica apenas).
-- ============================================================================
CREATE TABLE sv360.deleted_photos (
    photo_id   TEXT PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
