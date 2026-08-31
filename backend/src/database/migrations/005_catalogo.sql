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
-- SÃO QUATRO TABELAS E NÃO CINCO: existiu uma `streetview_markers` que nunca teve
-- consumidor (não alimentava o `/config`, nenhuma tela chamava a rota, nenhum seed a
-- populava). O que ela custava era ambiguidade com o arquivo homônimo do frontend, que é
-- a camada VIVA de marcadores do 360 e lê de `sv360.projects`. Não a recrie por simetria.
--
-- AS QUATRO SÃO ESCRITAS POR EXTENSO, e não clonadas por `LIKE ... INCLUDING ALL` como já
-- foram: `LIKE` não copia FOREIGN KEY em nenhuma de suas opções, e as quatro precisam da
-- FK de `owner_org_id`. O preço é manter a paridade, cobrada por
-- `tests/integration/catalog-tabelas-paridade.test.js` em (nome, tipo, nullable, default).

-- ---------------------------------------------------------------------------
-- O EIXO PÚBLICO/PRIVADO (`access_level`) e a OM PRODUTORA (`owner_org_id`)
-- ---------------------------------------------------------------------------
--
-- `access_level` nasce 'public' em toda linha: a marca cria o vocabulário e não tira
-- nada da tela até um administrador marcar alguma coisa.
--
-- `owner_org_id` NULL = INSTITUCIONAL, estado terminal legítimo e não "sem dono a
-- definir": camada de base vinda do seed não foi produzida por OM nenhuma. O gate de
-- produção compara IGUALDADE, e NULL nunca é igual a nada, então o produtor não alcança
-- essas linhas por construção, sem um ramo `IS NULL` que alguém escreveria errado.
--
-- Os ÍNDICES PARCIAIS ficam nos lados PRIVADO e PRODUZIDO, que são os conjuntos pequenos
-- (o inverso de `ng`, onde o pequeno é o outro). Servem à TELA, não ao gate, que resolve
-- a linha pela PK.

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
-- A FAIXA DE ZOOM É DO MAPA BASE, e o seed a declara nas cinco linhas (decisão do dono,
-- 2026-08-31). A aplicação é fixa em [2, 21] (`MAP2D_BASE`, `config.static.js`) e não é
-- configurável; o mapa base APERTA dentro dela, nunca afrouxa, e o schema de escrita
-- (`catalog.schemas.js`) recusa valor fora de [2, 21] e `minzoom > maxzoom`.
--
-- OS VALORES NÃO SÃO ARBITRÁRIOS: cada `maxzoom` é o da FONTE do estilo daquele mapa base
-- (`config.static.js` e `frontend/src/js/baselayers/`), porque passar dele não trava nada,
-- o MapLibre faz overzoom e escala o último tile, e a pessoa continua dando zoom para ver
-- borrão. Antes desta mudança o teto da aplicação era 17.9, ABAIXO de todas as fontes, e era
-- ele que segurava as cinco; subir o teto para 21 sem declarar estas chaves entregaria
-- borrão em todo mapa base no mesmo dia.
--
-- O PISO É 2 NAS CINCO, por decisão, e não porque alguma fonte o exija.
--
-- `carta-ortoimagem` leva 18 por decisão do dono e não por leitura de fonte: o módulo do
-- cliente (`frontend/src/js/baselayers/carta_ortoimagem.js`) ainda é a URL de demonstração
-- do MapLibre, um placeholder que não declara zoom nenhum.
--
-- CHAVE MINÚSCULA (`minzoom`/`maxzoom`), como em `data_layers` abaixo e como
-- `utils/audit-diff.js` já as lista. Um `minZoom` camelCase ao lado criaria dois
-- vocabulários para a mesma coisa.
INSERT INTO basemaps (id, name, sort_order, config) VALUES
  ('carta-topografica', 'Topográfica', 1, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-topografica-thumb.png', 'priority', 1,
    'minzoom', 2, 'maxzoom', 19)),
  ('carta-ortoimagem', 'Ortoimagem', 2, jsonb_build_object(
    'enabled', true, 'image', './images/layers/carta-ortoimagem-thumb.png', 'priority', 2,
    'minzoom', 2, 'maxzoom', 18)),
  ('bdgex', 'BDGEx', 3, jsonb_build_object(
    'enabled', true, 'image', './images/layers/bdgex-thumb.png', 'priority', 3,
    'minzoom', 2, 'maxzoom', 18)),
  ('osm', 'OpenStreetMaps', 4, jsonb_build_object(
    'enabled', true, 'priority', 4, 'minzoom', 2, 'maxzoom', 19)),
  ('imagens', 'Imagens do Google', 5, jsonb_build_object(
    'enabled', true, 'priority', 5, 'minzoom', 2, 'maxzoom', 20));

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
-- TILESET É CONFIGURADO, NÃO SEMEADO. Houve um registro de demonstração apontando para
-- um asset que nunca esteve no repositório, e toda instalação limpa prometia um modelo
-- que o servidor não serve: o item aparecia listado e clicável no 2D, e abrir o
-- visualizador dava 404, que o cliente captura e devolve para o 2D sem dizer nada.
--
-- A DECISÃO, do dono do produto: o catálogo é ponto de configuração, não lugar de
-- conteúdo de exemplo. Um tileset entra pelo Painel do Administrador ou pelo import de
-- acervo 3D, apontando para uma URL que existe.
--
-- Sem efeito colateral de integridade: não há FK para `tilesets`; as tabelas de 3D
-- guardam `tileset_id` como texto livre.
