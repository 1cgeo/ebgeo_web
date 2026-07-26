-- Path: src/database/migrations/010_sv360_tracks.sql
-- sv360.tracks — os TRECHOS DE TRAJETO capturados de um projeto 360.
--
-- POR QUE UMA TABELA, e não derivar a linha das fotos: até aqui o tile MVT
-- sintetizava `fotos_linha` com ST_MakeLine(geom ORDER BY sequence_number)
-- agrupado por projeto, ou seja, UMA linha por projeto. O dado real não é assim:
-- o index.db legado traz `project_tracks` com 3.236 trechos SEPARADOS (o projeto
-- 1pef sozinho tem 34 percursos distintos para 2.249 fotos). Ligar tudo numa
-- polilinha só faz a linha saltar de um percurso ao outro, e o mapa desenha um
-- emaranhado que atravessa o enquadramento inteiro — geometria que não
-- corresponde a nenhum caminho percorrido. Trecho é dado de origem, não algo
-- derivável da ordem das fotos, então precisa de onde morar.
--
-- `source` preserva a proveniência que o estúdio registra ('geojson' |
-- 'pmtiles-atribuido' no dump atual); é informativo, não muda o desenho.
--
-- Aditiva e forward-only: nada existente é alterado. Projeto sem track continua
-- caindo no comportamento antigo (a query MVT mantém o fallback), então a
-- migração não quebra nenhum projeto já ingerido.

CREATE TABLE sv360.tracks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES sv360.projects(id) ON DELETE CASCADE,
    -- LINESTRING em 4326, igual ao referencial de sv360.photos.geom.
    geom       GEOMETRY(LINESTRING, 4326) NOT NULL,
    source     TEXT NOT NULL DEFAULT 'geojson',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O tile filtra por bbox (`&&`) e agrupa por projeto: os dois índices que a
-- query MVT usa.
CREATE INDEX idx_sv360_tracks_project ON sv360.tracks(project_id);
CREATE INDEX idx_sv360_tracks_geom    ON sv360.tracks USING GIST (geom);
