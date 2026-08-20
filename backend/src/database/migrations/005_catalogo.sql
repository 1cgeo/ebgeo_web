-- Path: src/database/migrations/005_catalogo.sql
-- CATÁLOGO: o que compõe `GET /api/v1/config` — basemaps, data_layers,
-- analysis_layers, tilesets — mais `config_settings`, que é o override do mesmo
-- documento. A coesão aqui é pelo CONSUMIDOR: é exatamente o conjunto que
-- `config.service.js` monta e que `invalidateAppConfigCache()` invalida.
--
-- UMA TABELA DEDICADA POR TIPO, em vez de uma `resources` genérica com coluna
-- `category`: mesma forma (id texto, `config` JSONB no shape de `GET
-- /api/v1/config`), separadas por tipo para clareza e evolução independente.
-- CRUD admin em `/api/v1/<tipo>`; servidas no `/config` público. Alternativa
-- recusada por extenso em docs/wiki/resources-catalogo.md.
--
-- SÃO QUATRO TABELAS E NÃO CINCO, e a ausência da quinta é decisão registrada.
-- Existiu uma `streetview_markers`, nascida de `LIKE basemaps INCLUDING ALL` e
-- que nunca teve consumidor: não alimentava `GET /api/config`, nenhum código do
-- frontend chamava a rota dela, nenhum seed a populava, e as únicas escritas que
-- já existiram foram de teste. O que ela custava era ambiguidade — existe um
-- ARQUIVO homônimo no frontend (`street_view_tool/streetview_markers.js`) que é a
-- camada VIVA de marcadores do 360 no mapa 2D e lê de `sv360.projects`. Não a
-- recrie por simetria. O valor `'STREETVIEW_MARKER'` sobrevive no CHECK de
-- `audit_trail.target_type` como alvo declarado sem escritor, e só por isso.
--
-- AS QUATRO SÃO ESCRITAS POR EXTENSO, e não clonadas por `LIKE ... INCLUDING ALL`
-- como já foram: `LIKE` não copia FOREIGN KEY (nenhuma de suas opções copia), e
-- as quatro precisam da FK própria de `owner_org_id`; e `INCLUDING ALL` copiaria
-- os índices com nome auto-gerado. Escrever as quatro cria a obrigação de mantê-las
-- em paridade, e o guarda dessa paridade é
-- `tests/integration/catalog-tabelas-paridade.test.js`, que exige conjuntos
-- idênticos de (nome, tipo, nullable, default).

-- ---------------------------------------------------------------------------
-- O EIXO PÚBLICO/PRIVADO (`access_level`) e a OM PRODUTORA (`owner_org_id`)
-- ---------------------------------------------------------------------------
--
-- `access_level` nasce 'public' em toda linha: a marca cria o vocabulário, não
-- tira nada da tela até um administrador marcar alguma coisa.
--
-- `owner_org_id` NULL = INSTITUCIONAL, e é um estado terminal legítimo, não "sem
-- dono a definir": as camadas de base que vieram do seed não foram produzidas por
-- nenhuma OM. O gate de produção compara IGUALDADE, e NULL nunca é igual a nada,
-- então o produtor não alcança essas linhas por construção, sem precisar de um
-- ramo `IS NULL` que alguém escreveria errado.
--
-- Os ÍNDICES PARCIAIS ficam no lado PRIVADO e no lado PRODUZIDO, que são os
-- conjuntos pequenos (o inverso do padrão de `ng`, que indexa o lado público
-- porque lá o pequeno é o outro). Eles servem a TELA, não o gate: o gate resolve
-- a linha pela PK e não passa por aqui.

CREATE TABLE basemaps (
    id          VARCHAR(100) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_level VARCHAR(20) NOT NULL DEFAULT 'public'
                  CHECK (access_level IN ('public','private')),
    owner_org_id UUID REFERENCES organizations(id)
);
CREATE INDEX idx_basemaps_private   ON basemaps(id)           WHERE access_level = 'private';
CREATE INDEX idx_basemaps_owner_org ON basemaps(owner_org_id) WHERE owner_org_id IS NOT NULL;

CREATE TABLE data_layers (
    id          VARCHAR(100) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_level VARCHAR(20) NOT NULL DEFAULT 'public'
                  CHECK (access_level IN ('public','private')),
    owner_org_id UUID REFERENCES organizations(id)
);
CREATE INDEX idx_data_layers_private   ON data_layers(id)           WHERE access_level = 'private';
CREATE INDEX idx_data_layers_owner_org ON data_layers(owner_org_id) WHERE owner_org_id IS NOT NULL;

CREATE TABLE analysis_layers (
    id          VARCHAR(100) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_level VARCHAR(20) NOT NULL DEFAULT 'public'
                  CHECK (access_level IN ('public','private')),
    owner_org_id UUID REFERENCES organizations(id)
);
CREATE INDEX idx_analysis_layers_private   ON analysis_layers(id)           WHERE access_level = 'private';
CREATE INDEX idx_analysis_layers_owner_org ON analysis_layers(owner_org_id) WHERE owner_org_id IS NOT NULL;

CREATE TABLE tilesets (
    id          VARCHAR(100) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_level VARCHAR(20) NOT NULL DEFAULT 'public'
                  CHECK (access_level IN ('public','private')),
    owner_org_id UUID REFERENCES organizations(id)
);
CREATE INDEX idx_tilesets_private   ON tilesets(id)           WHERE access_level = 'private';
CREATE INDEX idx_tilesets_owner_org ON tilesets(owner_org_id) WHERE owner_org_id IS NOT NULL;

-- ============================================================================
-- CONFIG SETTINGS (admin overrides for the STATIC/ENV parts of GET /api/v1/config
-- that have no catalog row — app/features/map2d/map3d/service URLs). A single
-- row (key='app_config') holds a PARTIAL config object deep-merged OVER the
-- assembled payload, so an admin can edit those without a redeploy.
-- ============================================================================
CREATE TABLE config_settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- SEED (config já no shape de GET /api/v1/config)
-- ---------------------------------------------------------------------------
INSERT INTO basemaps (id, name, sort_order, config) VALUES
  ('carta-topografica', 'Topográfica', 1, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-topografica-thumb.png', 'priority', 1)),
  ('carta-ortoimagem', 'Ortoimagem', 2, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-ortoimagem-thumb.png', 'priority', 2)),
  ('bdgex', 'BDGEx', 3, jsonb_build_object(
    'enabled', true, 'image', './images/layers/bdgex-thumb.png', 'priority', 3)),
  ('osm', 'OpenStreetMaps', 4, jsonb_build_object('enabled', true, 'priority', 4)),
  ('imagens', 'Imagens do Google', 5, jsonb_build_object('enabled', true, 'priority', 5));

INSERT INTO analysis_layers (id, name, sort_order, config) VALUES
  ('hillshade', 'Sombreamento do Relevo', 1, '{}'::jsonb),
  ('declividade', 'Declividade', 2, jsonb_build_object(
    'description', 'Mapa de declividade do terreno',
    'source', jsonb_build_object('type', 'raster-dem', 'url', 'http://localhost/tiles/dem/{z}/{x}/{y}.png'),
    'bounds', jsonb_build_array(-45, -23, -44, -22),
    'paint', jsonb_build_object('raster-opacity', 0.7))),
  ('hipsometria', 'Hipsometria', 3, jsonb_build_object(
    'description', 'Mapa hipsométrico (altimetria) do terreno',
    'source', jsonb_build_object('type', 'raster-dem', 'url', 'http://localhost/tiles/dem/{z}/{x}/{y}.png'),
    'bounds', jsonb_build_array(-45, -23, -44, -22),
    'paint', jsonb_build_object('raster-opacity', 0.6)));

-- Camadas de DADOS (vetoriais) — restringíveis por atlas (settings.available_data_layers).
-- Troque pelas camadas reais do deploy (as URLs aqui são placeholders).
INSERT INTO data_layers (id, name, sort_order, config) VALUES
  ('rodovias-federais', 'Rodovias Federais', 1, jsonb_build_object(
    'description', 'Malha rodoviária federal',
    'source', jsonb_build_object('type', 'vector', 'url', 'http://localhost/tiles/rodovias'),
    'sourceLayer', 'rodovias', 'minzoom', 4, 'maxzoom', 18,
    'style', jsonb_build_object('border', jsonb_build_object('color', '#E74C3C', 'width', 2, 'opacity', 1)))),
  ('limites-municipais', 'Limites Municipais', 2, jsonb_build_object(
    'description', 'Divisão político-administrativa municipal',
    'source', jsonb_build_object('type', 'vector', 'url', 'http://localhost/tiles/municipios'),
    'sourceLayer', 'municipios', 'minzoom', 4, 'maxzoom', 14,
    'style', jsonb_build_object('border', jsonb_build_object('color', '#6b7280', 'width', 1, 'opacity', 0.8))));

-- ---------------------------------------------------------------------------
-- `tilesets` NASCE VAZIA, E A AUSÊNCIA É A DECISÃO
-- ---------------------------------------------------------------------------
--
-- Não há INSERT de tileset aqui, e não é esquecimento: TILESET É CONFIGURADO,
-- NÃO SEMEADO. Houve um registro de demonstração (`PCL`, Posto de Comando
-- Logístico) apontando para `/3d/PCL/tileset.json`, e o asset NUNCA esteve no
-- repositório: `public/3d/` é ignorado pelo versionamento. Toda instalação limpa
-- prometia um modelo que o servidor não serve, e o sintoma é silencioso do jeito
-- ruim — o item aparece listado e clicável no mapa 2D, e abrir o visualizador 3D
-- dá 404, que o `openViewer` captura e devolve para o 2D sem dizer nada.
--
-- A DECISÃO, do dono do produto: o catálogo é ponto de configuração, não lugar de
-- conteúdo de exemplo. Um tileset entra pelo Painel do Administrador, ou pelo
-- import de acervo 3D, apontando para uma URL que existe. Semear conteúdo numa
-- migração faz o dado nascer errado em toda instalação nova e obriga cada
-- deployment a limpar o que nunca pediu.
--
-- Sem efeito colateral de integridade: NÃO existe chave estrangeira para
-- `tilesets`. As tabelas de 3D guardam `tileset_id` como texto livre.
