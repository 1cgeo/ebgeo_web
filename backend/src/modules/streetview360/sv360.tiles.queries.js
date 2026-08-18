// Path: src/modules/streetview360/sv360.tiles.queries.js
import { sv360AccessPredicate } from './sv360.queries.js';
// Vector-tile (MVT) SQL for the StreetView 360 module (Fase 9, Tarefa 7).
// PostGIS generates the protobuf tile server-side (ST_AsMVT + ST_AsMVTGeom +
// ST_TileEnvelope). The frontend consumes this as a MapLibre VECTOR source — it
// replaces the legacy GeoJSON-as-source / PMTiles idea (descontinuados).
//
// A single tile carries TWO layers, concatenated (`layer_fotos || layer_linha`):
//   - 'fotos'       : POINTS — one per readable photo.
//   - 'fotos_linha' : LINES  — the per-project TRAJECTORY (the route a viewer
//     walks). DEFINITION CHOICE (documented): fotos_linha is the trajectory that
//     connects a project's photos in `sequence_number` order via ST_MakeLine,
//     grouped by project_id. Rationale: the "lines source" overlay on the map
//     draws the PATH/route through a project's panoramas (the original
//     `fotos_linha.geojson`), one clean LineString per project — not the directed
//     navigation graph (sv360.targets), which would emit overlapping bidirectional
//     segments and is already exposed per-photo via the `targets` adjacency in the
//     photo metadata shape. So the map line == the capture trajectory.
//
// ACCESS CONTROL (CRITICAL — embedded in the SQL, defense in depth; the 360 data
// has leaked twice in other routes when access lived only in the app layer): the
// SAME predicate as TILES_PHOTOS, e agora LITERALMENTE o mesmo — `sv360AccessPredicate`
// (sv360.queries.js) é uma definição só, importada aqui. Ele gateia AS DUAS
// camadas, porque a CTE `visible` alimenta pontos e linhas: um filtro aplicado só
// nos pontos deixaria a trajetória do projeto invisível desenhada no mapa, que é o
// negativo que `sv360-mvt.test.js` já cobrava.
//
// O primeiro termo deixou de ser um booleano do JS: `$isAdmin` valia TRUE e
// curto-circuitava a disjunção inteira, então um erro no cálculo não errava, ABRIA.
// Agora o SQL resolve o papel a partir do UUID, e o termo da OM resolve o ESCOPO DE
// PRODUÇÃO (a lotação auto-declarada deixou de autorizar). Tombstoned photos
// continuam excluídas via NOT EXISTS sv360.deleted_photos, e um chamador anônimo
// (userId=null) NUNCA vê projeto disabled nem privado.
//
// PERFORMANCE: the bbox is computed ONCE in 4326 (ST_Transform of the tile
// envelope) and used with the `&&` operator against p.geom so the GiST index on
// sv360.photos(geom) is used to prune rows BEFORE ST_AsMVTGeom transforms the
// survivors to 3857. Param order: $1=z, $2=x, $3=y, $4=userId, $5=atlasId.
//
// ZOOM FLOOR for the 'fotos' layer only. Below this zoom the tile still carries
// 'fotos_linha' and simply omits the points.
//
// MEASURED on the live acervo (29 projects, 99.040 photos), tile over Alegrete,
// bytes on the wire from GET /sv360/tiles/:z/:x/:y.pbf:
//
//   z0  10.352.008 B (~420 ms)   z6  6.372.081 B     z10 1.144.264 B
//   z11    697.171 B (~195 ms)   z12   253.568 B     z14    23.770 B
//
// Of the 10,3 MB at z0, 10.350.579 B are the 'fotos' layer (99.035 points) and
// 1.429 B are 'fotos_linha' (68 lines). The whole low-zoom cost IS the points
// layer, so gating the points is the entire fix: the same z0 tile drops to 1.429
// bytes and ~122 ms, and every tile at z >= 11 is byte-identical to before.
//
// WHY 11, and why NOT a 400 like the origin (ebgeo_360 refuses z outside 11..12):
// a 400 rejects the WHOLE tile, and this frontend asks for the same tile at low
// zoom for the LINES. The main map (map_sig.js, map2d.minZoom = 1) mounts
// 'street-view-lines' and 'street-view-lines-hit' over the trajectory layer with
// NO layer minzoom, so it legitimately requests z1..z10 tiles; rejecting them
// would erase the trajectory from the main map. The points layer has exactly ONE
// consumer, the minimap (add_street_view_control.js), and that map is built with
// minZoom: 11, so 11 is the lowest zoom at which anything ever draws a point.
// A floor of 12 would blank the minimap at its own minimum zoom.
export const FOTOS_MIN_ZOOM = 11;

// Returns a single row with one `tile` column (bytea = the concatenated MVT). An
// empty tile (no features) is still a valid, returnable buffer.
//
// A FORMA DESTA CONSULTA MUDOU NA FASE F9, E A MUDANÇA É DE LATÊNCIA, NÃO DE REGRA.
//
// O QUE ERA. Uma CTE `visible` sozinha juntava fotos e projetos, aplicava o predicado
// de acesso e NÃO tinha filtro espacial; o bbox só entrava depois, nos consumidores.
// Como `visible` era referenciada quatro vezes, o Postgres a MATERIALIZAVA, e o plano
// medido no acervo real (29 projetos, 99.040 fotos) era um `Seq Scan on photos` de
// 99.040 linhas com `Storage: Disk, Maximum Storage: 13690kB`, seguido de
// `Rows Removed by Join Filter: 98.796` para 239 sobreviventes. O índice GiST
// `idx_sv360_photos_geom` NUNCA era usado. Consequência: a latência crescia com o
// ACERVO INTEIRO e não com o que cabe no tile — um tile VAZIO custava ~290 ms, e a
// curva era plana de z0 a z14.
//
// O QUE É. Três CTEs no lugar de uma, e a separação é o conserto:
//   `visible_projects` — o predicado de acesso roda UMA VEZ POR PROJETO (29 linhas),
//     e não uma vez por foto. É também onde mora a exigência de o projeto ter ao
//     menos uma foto viva com geometria, que a `visible` antiga implicava por
//     construção (`tracked` e `trajectories` liam dela).
//   `visible` — as fotos DAQUELES projetos DENTRO do tile. É aqui que o bbox entra, e
//     o `&&` é servido pelo GiST. Ela alimenta a camada de PONTOS e mais nada, então
//     o piso de zoom entra junto: abaixo dele a CTE inteira não produz linha nenhuma.
//   `synthesized` — a trajetória sintetizada, que NÃO pode ser podada pelo bbox: ela
//     é `ST_MakeLine` sobre TODAS as fotos do projeto, e construí-la a partir das
//     fotos podadas encurtaria a linha na borda do tile. Ela é barata porque só
//     alcança projeto SEM track (2 de 29 no acervo, 427 fotos somadas).
//
// EQUIVALÊNCIA, e ela é por construção e não por sorte: os mesmos projetos, as mesmas
// fotos, as mesmas linhas. O que muda é a ORDEM das feições dentro de `ST_AsMVT`, que
// nunca teve `ORDER BY` — então os BYTES do tile podem diferir com o mesmo conjunto de
// feições, e nenhum teste pode afirmar bytes literais. `sv360-mvt-bbox.test.js` compara
// conjunto DECODIFICADO, que é a única comparação que significa alguma coisa aqui.
//
// A ARMADILHA QUE A MEDIÇÃO ACHOU, e em que uma implementação ingênua cai: empurrar o
// bbox para dentro da `visible` ANTIGA (uma CTE só, sem separar projetos) REGRIDE em
// zoom baixo — 5,4 s em z0 e 1,9 s em z6 contra ~200 ms de então, porque com o
// envelope do mundo o filtro não poda nada e ainda desmonta o plano. Quem mexer aqui
// precisa medir z0 e z6, não só os zooms de trabalho.
export const MVT_TILE = `
  WITH bounds AS (
    SELECT
      ST_TileEnvelope($1, $2, $3) AS env3857,
      ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS env4326
  ),
  -- O PREDICADO DE ACESSO, UMA VEZ POR PROJETO. fn_can_produce_resource e
  -- fn_granted_resource_ids são STABLE e eram avaliadas por linha de PROJETO dentro de
  -- um join com 99.040 fotos; aqui elas veem 29 linhas.
  --
  -- O EXISTS não é otimização, é EQUIVALÊNCIA: na forma antiga tracked e a trajetória
  -- liam da CTE de FOTOS, então um projeto sem nenhuma foto viva com geometria não
  -- produzia linha nenhuma. Sem esta condição, um projeto cujas fotos foram todas
  -- apagadas passaria a desenhar a track no mapa.
  visible_projects AS (
    SELECT pr.id, pr.slug
    FROM sv360.projects pr
    WHERE ${sv360AccessPredicate(4, 5, 'pr.')}
      AND EXISTS (
        SELECT 1 FROM sv360.photos p
         WHERE p.project_id = pr.id
           AND p.geom IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id
           )
      )
  ),
  -- As fotos daqueles projetos DENTRO do tile. Único consumidor: a camada de pontos.
  -- Por isso o piso de zoom mora aqui: abaixo dele nada é lido, nada é transformado.
  visible AS (
    SELECT p.id, p.geom, p.original_name, p.sequence_number,
           p.floor_level, p.floor_label,
           pj.slug AS project_slug
    FROM sv360.photos p
    JOIN visible_projects pj ON pj.id = p.project_id
    CROSS JOIN bounds b
    WHERE $1 >= ${FOTOS_MIN_ZOOM}
      AND p.geom IS NOT NULL
      AND p.geom && b.env4326
      AND NOT EXISTS (
        SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id
      )
  ),
  fotos AS (
    SELECT ST_AsMVT(t, 'fotos', 4096, 'geom') AS mvt
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(v.geom, 3857), b.env3857, 4096, 64, true) AS geom,
        v.id,
        v.project_slug AS "projectSlug",
        v.original_name AS img,
        v.sequence_number,
        -- The photo's FLOOR. Both are ADDITIVE: id, projectSlug, img and
        -- sequence_number above are what the current client reads, and renaming
        -- or dropping any of them breaks the 2D layer. (No backticks in here:
        -- this SQL is a JS template literal.)
        --
        -- floor_level is NOT NULL in sv360.photos, so every point carries it and a
        -- MapLibre filter on the floor selector is always decidable. floor_label
        -- IS nullable (a flat project has no floor to name), and ST_AsMVT simply
        -- OMITS a null attribute from that feature: the client must treat an
        -- absent floor_label as null, never as an error.
        v.floor_level,
        v.floor_label
      FROM visible v, bounds b
    ) t
  ),
  -- The project's REAL capture segments (sv360.tracks), one row per run. Only for
  -- projects the visible_projects CTE already admitted, so the access filter still
  -- lives in one place. O && aqui é o MESMO predicado que a camada de linha aplica no
  -- fim, antecipado para que o GiST de sv360.tracks(geom) pode as 3.236 linhas do
  -- acervo antes do ST_AsMVTGeom. (No backticks in here: this SQL is a JS template
  -- literal.)
  tracked AS (
    SELECT pj.id AS project_id, pj.slug AS project_slug, tk.geom AS line
    FROM sv360.tracks tk
    JOIN visible_projects pj ON pj.id = tk.project_id
    CROSS JOIN bounds b
    WHERE tk.geom && b.env4326
  ),
  -- Prefer the imported tracks; synthesize only for a project that has none.
  --
  -- The synthesized form is ONE LineString per project joining its photos in
  -- sequence order, and it is a poor stand-in whenever a project was captured in
  -- more than one run: the line teleports between runs and the map draws a
  -- criss-cross that matches no path anyone walked (1pef: 34 real segments
  -- collapsed into 1). It stays as the fallback because it is what every project
  -- ingested before sv360.tracks existed still has, and a project with a single
  -- run renders identically either way. A project with one photo yields no line
  -- (ST_MakeLine of 1 point is degenerate — filtered by ST_NumPoints >= 2).
  --
  -- SEM FILTRO DE BBOX, DE PROPÓSITO: a linha é feita de TODAS as fotos do projeto, e
  -- montá-la a partir das fotos que caem no tile a cortaria na borda — o segmento que
  -- entra vindo de fora sumiria. O custo é contido porque o NOT EXISTS sobre
  -- sv360.tracks deixa aqui só projeto que nunca teve track derivada.
  synthesized AS (
    SELECT pj.id AS project_id, pj.slug AS project_slug,
           ST_MakeLine(p.geom ORDER BY p.sequence_number) AS line
    FROM sv360.photos p
    JOIN visible_projects pj ON pj.id = p.project_id
    WHERE p.geom IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sv360.tracks t WHERE t.project_id = pj.id
      )
    GROUP BY pj.id, pj.slug
  ),
  trajectories AS (
    SELECT project_id, project_slug, line FROM tracked
    UNION ALL
    SELECT project_id, project_slug, line FROM synthesized
  ),
  linha AS (
    SELECT ST_AsMVT(t, 'fotos_linha', 4096, 'geom') AS mvt
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(tr.line, 3857), b.env3857, 4096, 64, true) AS geom,
        tr.project_slug AS "projectSlug"
      FROM trajectories tr, bounds b
      WHERE ST_NumPoints(tr.line) >= 2
        AND tr.line && b.env4326
    ) t
    WHERE t.geom IS NOT NULL
  )
  SELECT COALESCE(fotos.mvt, ''::bytea) || COALESCE(linha.mvt, ''::bytea) AS tile
  FROM fotos, linha
`;
