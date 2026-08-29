-- O BANCO DE DADOS VETORIAIS que o Martin publica. Ele NÃO é o `ebgeo_zero`: aquele
-- é o banco de CONFIGURAÇÃO (catálogo, contas, atlas), e os dados que viram tile
-- moram noutro lugar. A separação está reproduzida aqui de propósito.
--
-- POR QUE SINTÉTICO, E POR QUE ESTES DOIS NOMES. As duas linhas de `data_layers` do
-- `ebgeo_zero` endereçam `http://localhost/tiles/rodovias` e
-- `http://localhost/tiles/municipios`, com `sourceLayer` `rodovias` e `municipios`.
-- Duas tabelas com esses nomes exatos fazem o catálogo REAL funcionar sem que uma
-- linha dele seja editada, e é o dado do catálogo que este ambiente precisa medir.
-- A geometria em si não é o sujeito da medição: o sujeito é quem alcança os bytes.
--
-- A ÁREA é a mesma das camadas de análise do catálogo (bounds -45,-23 a -44,-22),
-- para que tudo caia no mesmo enquadramento.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------------
-- rodovias: uma malha de linhas leste-oeste e norte-sul
-- ---------------------------------------------------------------------------
CREATE TABLE rodovias (
    id    SERIAL PRIMARY KEY,
    sigla TEXT NOT NULL,
    nome  TEXT NOT NULL,
    geom  GEOMETRY(LineString, 4326) NOT NULL
);

INSERT INTO rodovias (sigla, nome, geom)
SELECT
    'BR-' || (100 + i * 10)::text,
    'Rodovia sintética ' || i::text,
    ST_SetSRID(
        ST_MakeLine(
            ST_MakePoint(-45.0, -23.0 + i * 0.1),
            ST_MakePoint(-44.0, -23.0 + i * 0.1 + 0.05)
        ), 4326)
FROM generate_series(1, 9) AS i;

INSERT INTO rodovias (sigla, nome, geom)
SELECT
    'RJ-' || (200 + i * 5)::text,
    'Vicinal sintética ' || i::text,
    ST_SetSRID(
        ST_MakeLine(
            ST_MakePoint(-45.0 + i * 0.1, -23.0),
            ST_MakePoint(-45.0 + i * 0.1 + 0.05, -22.0)
        ), 4326)
FROM generate_series(1, 9) AS i;

CREATE INDEX idx_rodovias_geom ON rodovias USING GIST (geom);

-- ---------------------------------------------------------------------------
-- municipios: uma grade 5x5 de polígonos contíguos
-- ---------------------------------------------------------------------------
CREATE TABLE municipios (
    id       SERIAL PRIMARY KEY,
    nome     TEXT NOT NULL,
    codigo   TEXT NOT NULL,
    geom     GEOMETRY(Polygon, 4326) NOT NULL
);

INSERT INTO municipios (nome, codigo, geom)
SELECT
    'Município ' || lx::text || '-' || ly::text,
    lpad(((lx * 10) + ly)::text, 7, '3'),
    ST_SetSRID(ST_MakeEnvelope(
        -45.0 + lx * 0.2, -23.0 + ly * 0.2,
        -45.0 + lx * 0.2 + 0.2, -23.0 + ly * 0.2 + 0.2
    ), 4326)
FROM generate_series(0, 4) AS lx, generate_series(0, 4) AS ly;

CREATE INDEX idx_municipios_geom ON municipios USING GIST (geom);
