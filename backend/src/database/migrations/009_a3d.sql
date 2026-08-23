-- Path: src/database/migrations/009_a3d.sql
-- ACERVO 3D (schema a3d): o registro de PRODUÇÃO do que o serviço 3D publica, mais o
-- histórico das importações. Vem do `index.db` do repositório `ebgeo_3d`, absorvido aqui
-- pelo mesmo caminho que o 360 seguiu na 007: metadado em Postgres, binário fora dele.
--
-- SÃO DUAS FORMAS DE CONTEÚDO, E DUAS FORMAS DE ARMAZENAMENTO, e isso é decisão e não
-- inconsistência:
--
--   MODELO (`a3d.models`) — árvore de 3D Tiles ou GLB isolado, num único arquivo
--     `{slug}.3dtiles` (SQLite). O que ele resolve é a MULTIDÃO: um modelo tem milhares
--     de objetos pequenos (o maior do acervo tem 247.125), e backup, cópia e antivírus
--     cobram por arquivo, não por byte.
--   CENA (`a3d.scenes`) — o interior caminhável em Gaussian splatting, servido como
--     PASTA. Ela tem DEZENAS de arquivos, não milhares, e dois deles são grandes e lidos
--     EM FAIXA pelo visualizador (o octree de colisão). Enfiar isso num BLOB obrigaria o
--     serviço a reconstruir o que o sistema de arquivos já faz melhor, sem comprar nada.
--     E o visualizador dela NÃO é o Cesium: é o motor de caminhada do cliente, que não
--     entende 3D Tiles.
--
-- O QUE AS DUAS COMPARTILHAM é o que importa aqui: a linha de CATÁLOGO em
-- `public.tilesets` (com os dois eixos de acesso), a rota que serve os bytes
-- (`/api/v1/assets3d`), e o gate que decide o regime por CAMINHO.

-- ============================================================================
-- 1) Schema
-- ============================================================================
-- SEM PostGIS. O ponto de navegação do modelo (lon/lat/height) já viaja no `config`
-- JSONB de `tilesets`, que é o documento que o cliente lê, e não há consulta espacial
-- nenhuma sobre ele. Acrescentar geometria aqui criaria uma segunda resposta para
-- "onde está o modelo", e a que o produto usa é a do catálogo.
CREATE SCHEMA IF NOT EXISTS a3d;

-- ============================================================================
-- 2) models — o registro de produção, UM POR LINHA DE `tilesets`
-- ============================================================================
-- POR QUE UM SCHEMA PRÓPRIO E NÃO COLUNAS EM `tilesets`. As quatro tabelas de
-- catálogo são obrigadas a ter colunas IDÊNTICAS (`catalog-tabelas-paridade.test.js`),
-- porque `catalog.service.js` roda a MESMA string de colunas contra as quatro. Uma
-- coluna útil só a `tilesets` custaria a mesma coluna morta em `basemaps`,
-- `data_layers` e `analysis_layers`.
--
-- POR QUE A FK, E O QUE ELA SIGNIFICA. `tilesets` é o CATÁLOGO: é ele que o
-- `/api/config` publica, que a allowlist `available_3d_models` filtra por id, e onde
-- moram os dois eixos de acesso (`access_level`, `owner_org_id`). Esta tabela é o
-- registro de PRODUÇÃO do mesmo id: qual arquivo serve os bytes, com que token de
-- geração, medido em quê. Um modelo sem linha de catálogo seria bytes que ninguém
-- pode pedir; por isso a linha do catálogo vem primeiro e o CASCADE segue a exclusão.
--
-- O QUE ESTA TABELA DELIBERADAMENTE NÃO TEM: `access_level` e `owner_org_id`. Eles já
-- existem em `tilesets`, o gate os lê de lá, e uma segunda cópia aqui seria a lista
-- fechada duplicada que a constituição proíbe — com o agravante de que a cópia
-- desatualizada seria a que decide quem vê o quê.
--
-- `db_filename` é guardado, e não derivado do id, pela mesma razão do 360: renomear o
-- modelo no catálogo não pode obrigar a renomear o arquivo de 500 MB no disco.
--
-- `build_token` é o TOKEN DE GERAÇÃO, e é o que torna `immutable` de um ano seguro.
-- Ele entra na `uri` de todo tile dentro dos `tileset.json` gravados, e é metade do
-- ETag que a rota calcula sem tocar o BLOB. Sem ele, reimportar troca os bytes sem
-- trocar a URL, e o navegador passa um ano compondo tile velho na árvore nova.
--
-- `ground_height` e `min_height` são MEDIDA, nunca ajuste do operador. A primeira é a
-- altura elipsoidal do chão; a segunda, a do ponto mais baixo. O cliente sem terreno
-- vê o modelo flutuar exatamente `ground_height`, e o contorno é publicar
-- `heightOffset = -min_height` (a BASE, não a mediana: com a mediana a parte baixa
-- afunda abaixo do chão liso e as duas superfícies brigam pelo mesmo pixel).
CREATE TABLE a3d.models (
    model_id        VARCHAR(100) PRIMARY KEY REFERENCES public.tilesets(id) ON DELETE CASCADE,

    -- ===== onde os bytes moram =====
    db_filename     TEXT NOT NULL UNIQUE,
    model_type      TEXT NOT NULL DEFAULT '3dtiles' CHECK (model_type IN ('3dtiles','glb')),

    -- ===== o que este arquivo contém =====
    tiles_version   TEXT NOT NULL DEFAULT '1.1',
    geometry_codec  TEXT,
    texture_codec   TEXT,
    texture_quality INTEGER,
    tile_count      INTEGER NOT NULL DEFAULT 0,
    json_count      INTEGER NOT NULL DEFAULT 0,
    total_bytes     BIGINT  NOT NULL DEFAULT 0,
    source_bytes    BIGINT,

    -- ===== proveniência =====
    -- `source` sai de `asset.generator` do glTF de ORIGEM, nunca do nome da pasta, e é
    -- lido do JSON cru: o glTF-Transform sobrescreve esse campo na leitura e devolve
    -- "glTF-Transform v4.x" para todo modelo.
    source          TEXT,
    source_version  TEXT,
    -- TEXT, e não DATE, pela mesma razão de `sv360.projects.capture_date`: é o tipo da
    -- origem, campanha nem sempre é um dia, e o contrato público já emite string.
    captured_at     TEXT,

    -- ===== geração =====
    build_token     TEXT NOT NULL,
    built_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ===== medidas do envelope geodésico =====
    ground_height   DOUBLE PRECISION,
    min_height      DOUBLE PRECISION,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE a3d.models IS
  'Registro de producao de um modelo 3D convertido. O catalogo (o que o cliente ve, '
  'com os dois eixos de acesso) e a linha de mesmo id em public.tilesets.';
COMMENT ON COLUMN a3d.models.build_token IS
  'Token de geracao: entra na uri de todo tile e e metade do ETag. Trocar os bytes '
  'sem trocar o token faz o navegador compor tile velho na arvore nova por um ano.';

-- ============================================================================
-- 3) scenes — o registro de produção da CENA caminhável
-- ============================================================================
-- MESMA FK, MESMA RAZÃO de `models`: o catálogo é a linha de igual id em `tilesets`, e
-- os dois eixos de acesso vivem lá. O que muda é tudo o que descreve o conteúdo, porque
-- uma cena não tem tile, não tem token de geração e não tem árvore.
--
-- `base_path` É O CONTRATO COM O CLIENTE, e é guardado aqui porque ele também vive no
-- `config` JSONB do catálogo: o cliente recebe UM endereço e deriva dele os sete de
-- dentro da pasta. Guardá-lo dos dois lados parece duplicação e não é: o do catálogo é o
-- que o cliente lê, e este é o que a VERIFICAÇÃO usa para achar os bytes sem depender do
-- documento que ela deveria conferir.
--
-- `manifest_sha256` É O QUE DÁ À CENA A PROPRIEDADE QUE O `.3dtiles` GANHA DE GRAÇA. Um
-- modelo carrega no próprio arquivo um cabeçalho `meta` que o identifica; uma pasta não
-- carrega nada. O manifesto é a lista ORDENADA de (caminho relativo, sha256 do arquivo),
-- e o hash dela é a assinatura da cena inteira: com ele, verificar depois é recomputar e
-- comparar, e um arquivo trocado, truncado ou a mais aparece. Sem ele, "a cena está
-- inteira?" só teria resposta na hora da importação, que é justamente quando ninguém
-- pergunta.
CREATE TABLE a3d.scenes (
    scene_id        VARCHAR(100) PRIMARY KEY REFERENCES public.tilesets(id) ON DELETE CASCADE,
    base_path       TEXT NOT NULL,
    file_count      INTEGER NOT NULL DEFAULT 0,
    total_bytes     BIGINT  NOT NULL DEFAULT 0,
    manifest_sha256 TEXT NOT NULL,
    source_path     TEXT,
    imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE a3d.scenes IS
  'Registro de producao de uma cena caminhavel (Gaussian splatting), servida como PASTA. '
  'O catalogo e a linha de mesmo id em public.tilesets, com forma3d = indoor.';
COMMENT ON COLUMN a3d.scenes.manifest_sha256 IS
  'Assinatura da cena: sha256 da lista ordenada de (caminho, sha256 do arquivo). E o que '
  'permite verificar a pasta depois da importacao, que e quando a pergunta aparece.';

-- ============================================================================
-- 4) imports — o histórico
-- ============================================================================
-- SEM FK PARA `models`, e isso é decisão. A importação ABRE o registro antes de
-- converter (é o que permite dizer "rodando" e, depois de uma queda, "falhou"), e
-- nesse instante o modelo pode não existir ainda. Uma FK obrigaria a inverter a
-- ordem, e o que se perderia é justamente o registro das importações que NÃO
-- terminaram, que é a pergunta que este histórico existe para responder.
--
-- ELA SERVE AOS DOIS TIPOS. `model_id` guarda o id do que foi importado, seja modelo ou
-- cena: o histórico responde "quando isto entrou, de onde veio, e o que a conferência
-- disse", e essa pergunta não muda com a forma do conteúdo. Uma segunda tabela de
-- histórico seria a mesma pergunta com duas respostas.
CREATE TABLE a3d.imports (
    id           BIGSERIAL PRIMARY KEY,
    model_id     VARCHAR(100) NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'rodando'
                   CHECK (status IN ('rodando','ok','falhou')),
    source_path  TEXT,
    tiles_in     INTEGER,
    tiles_out    INTEGER,
    textures     INTEGER,
    failures     INTEGER,
    seconds      DOUBLE PRECISION,
    ratio        DOUBLE PRECISION,
    notes        TEXT
);

CREATE INDEX idx_a3d_imports_model ON a3d.imports(model_id, started_at DESC);
