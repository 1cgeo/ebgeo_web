// Path: src/modules/streetview360/sv360.queries.js
// Named SQL constants for the read-only StreetView 360 module (Fase 9, stage 1).
// Metadata lives in Postgres (schema `sv360`); only the WebP BLOBs stay in the
// per-project {slug}.db SQLite. Geometry is `sv360.photos.geom` (POINT/4326);
// lon/lat are exposed via ST_X(geom)/ST_Y(geom) so callers never read the column
// directly. Tombstoned photos (sv360.deleted_photos) are excluded everywhere.

/**
 * O PREDICADO DE LEITURA DO 360, numa definição só.
 *
 * Ele já vivia dentro do SQL — o cabeçalho de `sv360.tiles.queries.js` chama isso
 * de "defense in depth", e diz por quê: o dado do 360 já vazou duas vezes por
 * rotas em que o acesso morava só na camada de aplicação. O que mudou na fase F6
 * foi a FORMA do primeiro termo, e a mudança é de segurança:
 *
 *   ANTES  `$1::boolean` — um `isAdmin` calculado no JS. `TRUE` curto-circuita a
 *          disjunção INTEIRA, então um erro naquele cálculo não erra: ele ABRE. E
 *          `flexibleAuth` (que autentica este caminho) não reconcilia contra o
 *          banco, então um admin rebaixado carregava o papel por até 15 min.
 *   DEPOIS `fn_has_global_data_access($U::uuid)` — o SQL resolve o papel a partir
 *          do UUID. A janela some por construção, e o CREDENCIADO entra no mesmo
 *          passo. (Esta linha dizia "curador": aquele valor foi substituído por
 *          `credenciado` antes de qualquer banco aplicá-lo, e o CHECK de `users.role`
 *          o recusa hoje.)
 *
 * A SEGUNDA MUDANÇA DE FORMA, e ela é da mesma família: o termo da OM era
 * `organization_id = $orgId`, com o `$orgId` vindo de `users.organization_id` — uma
 * LOTAÇÃO auto-declarada no auto-cadastro (`POST /auth/register` aceita qualquer OM
 * ativa e a conta sem e-mail nasce ativa na hora). Ou seja, escolher a OM na tela de
 * cadastro abria todo projeto oculto e privado daquela OM. O termo passa a ser
 * `fn_can_produce_resource`, o escopo de PRODUÇÃO, que só um administrador concede.
 * O eixo de OM não sumiu: mudou de auto-declarado para concedido.
 *
 * TRÊS PROPRIEDADES PRESERVADAS DE PROPÓSITO (D6):
 *   - a OM PRODUTORA continua vendo o próprio projeto, inclusive privado e inclusive
 *     desabilitado: privacidade restringe quem está de FORA, não quem produz o dado;
 *   - `status = 'disabled'` continua ocultando de todo mundo fora dela, e também de
 *     quem tem concessão — os dois eixos são ORTOGONAIS;
 *   - `enabled + public` continua sendo público para o anônimo.
 *
 * Escrito como FUNÇÃO e não como constante porque o número do placeholder muda por
 * consulta. Uma segunda cópia do predicado é a dívida que o schema `ng` já paga.
 *
 * @param {number} pUser - Índice do parâmetro do userId (uuid, nullable).
 * @param {number} pAtlas - Índice do parâmetro do atlas em foco (uuid, nullable).
 * @param {string} [alias=''] - Prefixo da tabela de projetos (ex.: 'pr.').
 * @returns {string} Fragmento de WHERE, já entre parênteses.
 */
export const sv360AccessPredicate = (pUser, pAtlas, alias = '') => `(
        fn_has_global_data_access($${pUser}::uuid)
        OR fn_can_produce_resource($${pUser}::uuid, 'sv360_project', ${alias}id::text)
        OR ( ${alias}status = 'enabled'
             AND ( ${alias}access_level = 'public'
                   OR ${alias}id::text IN (SELECT resource_id
                                    FROM fn_granted_resource_ids($${pUser}::uuid, $${pAtlas}::uuid, 'sv360_project')) ) )
      )`;

// List projects. `enabled` is always public; disabled projects are visible only
// to a global admin/credenciado or to the PRODUCING organization.
//   $1 = userId (uuid, nullable), $2 = atlasId (uuid, nullable)
export const LIST_PROJECTS = `
  SELECT id, slug, name, center_lat, center_long, entry_photo_id, photo_count, status,
         capture_date, preview_video
  FROM sv360.projects
  WHERE ${sv360AccessPredicate(1, 2)}
  ORDER BY name
`;

// Single project by slug, with the ACCESS FILTER EMBEDDED (a slug is UNIQUE only
// per organization, so a cross-org collision must be resolved here, not with a
// non-deterministic rows[0]). Anon ($2 null, $3 null) matches only enabled+public.
//   $1 = slug, $2 = userId (uuid, nullable), $3 = atlasId (uuid, nullable),
//   $4 = OM PREFERIDA do chamador (uuid, nullable) — SÓ para o ORDER BY
//
// O `access_level` viaja no SELECT porque `isProjectReadable` (o cinto de
// seguranca na camada de aplicacao) precisa do eixo novo, e sem a coluna ele
// decidiria por dois eixos onde existem tres.
//
// O ORDER BY E O DESEMPATE CROSS-ORG, e nao enfeite: um slug e UNIQUE so POR
// ORGANIZACAO, entao duas OMs podem ter o mesmo, e sem esta ordenacao o `rows[0]`
// seria nao-deterministico — o que ja seria vazamento de miniatura entre OMs.
// Reescrever o WHERE e exatamente quando um ORDER BY vizinho se perde, e foi o que
// quase aconteceu aqui: o `$3` que a preferencia usava era o `orgId` do chamador,
// que SAIU do WHERE junto com o eixo auto-declarado. Se ele tivesse ficado, passaria
// a apontar para o `atlasId` e a comparacao seria sempre falsa, com a ordenacao
// virando arbitrária em silêncio. Por isso a preferência ganhou PARAMETRO PROPRIO,
// que NAO APARECE NO WHERE: ela e ordenacao, nunca autorizacao, e o `$4` isolado e o
// que torna essa distincao visivel para quem editar a consulta depois.
export const GET_PROJECT_BY_SLUG = `
  SELECT id, organization_id, slug, name, center_lat, center_long,
         entry_photo_id, photo_count, db_filename, status, capture_date, access_level,
         preview_video
  FROM sv360.projects
  WHERE slug = $1
    AND ${sv360AccessPredicate(2, 3)}
  ORDER BY (organization_id = $4::uuid) DESC, (status = 'enabled') DESC, organization_id
  LIMIT 1
`;

// O PREDICADO ENTROU NAS QUATRO CONSULTAS DE FOTO NA FASE F9, e a ausência dele era o
// buraco mais fundo do módulo. Elas decidiam por `isProjectReadable`, que só conhece o
// eixo de `status`, então um projeto `enabled + private` entregava metadado, imagem e
// vizinhança a QUALQUER UM que soubesse o uuid ou o `original_name` — e `/photos/nearest`
// os entregava por COORDENADA, sem precisar de identificador nenhum. O censo de
// superfícies (`tests/unit/superficies-de-recurso-censo.test.js`) nasceu com a classe
// que nomeava essas quatro; hoje elas são SQL-COMPLETO como as irmãs.

// One photo by id, joined to its project (slug/db_filename/org/status for the
// readability + ETag + BLOB path). lon/lat are derived from geom; ele is kept as
// the stored column. Excludes tombstoned photos.
//   $1 = photo id (TEXT uuid v5), $2 = userId (uuid, nullable),
//   $3 = atlasId (uuid, nullable)
export const GET_PHOTO_BY_ID = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, p.ele,
         p.heading, p.camera_height,
         p.mesh_rotation_x, p.mesh_rotation_y, p.mesh_rotation_z,
         p.distance_scale, p.marker_scale, p.floor_level, p.floor_label,
         p.full_size_bytes, p.preview_size_bytes,
         p.calibration_reviewed, p.capture_date,
         pr.slug AS project_slug, pr.db_filename, pr.organization_id,
         pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND ${sv360AccessPredicate(2, 3, 'pr.')}
`;

// One photo by its original filename. A name may collide across projects, so an
// Tie-break for a name shared by several projects (L10). The CALLER'S OWN ORG
// wins first, then an enabled project. Ordering by status alone made the pick
// arbitrary among disabled projects: a member whose org genuinely holds the photo
// could receive another org's row and then be 404'd by the readability gate — a
// false negative on data they own. Excludes tombstoned photos.
//   $1 = original_name
//   $2 = OM PREFERIDA do chamador (nullable; anônimo simplesmente perde a
//        preferência). Como no GET_PROJECT_BY_SLUG, é ORDENAÇÃO e não autorização:
//        quem autoriza é o predicado abaixo, e o desempate só escolhe entre as linhas
//        que ele já deixou passar.
//   $3 = userId (uuid, nullable), $4 = atlasId (uuid, nullable)
export const GET_PHOTO_BY_NAME = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         ST_Y(p.geom) AS lat, ST_X(p.geom) AS lon, p.ele,
         p.heading, p.camera_height,
         p.mesh_rotation_x, p.mesh_rotation_y, p.mesh_rotation_z,
         p.distance_scale, p.marker_scale, p.floor_level, p.floor_label,
         p.full_size_bytes, p.preview_size_bytes,
         p.calibration_reviewed, p.capture_date,
         pr.slug AS project_slug, pr.db_filename, pr.organization_id,
         pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.original_name = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND ${sv360AccessPredicate(3, 4, 'pr.')}
  ORDER BY (pr.organization_id = $2) DESC, (pr.status = 'enabled') DESC
  LIMIT 1
`;

// O(1) ETag source: sizes + project context, no BLOB read. Excludes tombstoned
// photos so a soft-deleted photo's blob is never served (same rule as
// GET_PHOTO_BY_ID / GET_PHOTO_BY_NAME).
//
// `access_level` viaja junto DESDE A FASE F9, e não é enfeite: o controller decidia o
// ESCOPO DE CACHE da imagem só por `status`, então a foto de um projeto
// `enabled + private` saía com `public, max-age=1ano, immutable` — um recurso de acesso
// restrito entregue a um cache compartilhado para repor a qualquer um pelo ano
// seguinte. Sem esta coluna a decisão teria dois eixos e um dado.
//   $1 = photo id (TEXT uuid v5), $2 = userId (uuid, nullable),
//   $3 = atlasId (uuid, nullable)
export const GET_PHOTO_SIZES = `
  SELECT p.full_size_bytes, p.preview_size_bytes,
         pr.db_filename, pr.organization_id, pr.status AS project_status,
         pr.access_level
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE p.id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND ${sv360AccessPredicate(2, 3, 'pr.')}
`;

// Directed adjacency for a photo (visible links only), joined to the target
// photo for its name/display_name/lon/lat/ele. Internal columns bearing_deg /
// distance_m are mapped to bearing / distance in the JSON contract by the
// service. Excludes links pointing at tombstoned photos. `is_next` first, then
// nearest.
//
// The TARGET's floor (floor_level + floor_label) travels with the link because
// the viewer decides on the LINK, not on the photo: a marker that leaves the
// current floor is drawn differently (a staircase, not an arrow). Without the
// target's level the client has nothing to compare the current one against and
// falls back to "same floor", so the floor-change marker silently never appears
// The failure mode is a missing pixel, never an error.
//   $1 = source photo id (TEXT uuid v5)
export const GET_TARGETS_FOR_PHOTO = `
  SELECT t.target_id, t.distance_m, t.bearing_deg, t.is_next, t.is_original,
         t.override_bearing, t.override_distance, t.override_height,
         tp.original_name AS target_name, tp.display_name AS target_display_name,
         ST_X(tp.geom) AS target_lon, ST_Y(tp.geom) AS target_lat, tp.ele AS target_ele,
         tp.floor_level AS target_floor_level, tp.floor_label AS target_floor_label
  FROM sv360.targets t
  JOIN sv360.photos tp ON tp.id = t.target_id
  WHERE t.source_id = $1
    AND t.hidden = false
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = t.target_id)
  ORDER BY t.is_next DESC, t.distance_m ASC
`;

// Nearby photos within a radius (true meters via ::geography). Excludes
// tombstoned photos. lon/lat exposed from geom; distance returned in meters.
//
// floor_level / floor_label travel with the row because the CALLER decides on the
// floor: GET /photos/nearest opens the photo the user clicked, and in an indoor
// survey the photos stack vertically (91 of the Beira-Rio's 350 have a photo of
// ANOTHER floor closer than 5 m in plan). Without the level the answer is "the
// nearest point on the map", which is not the same thing as "the nearest photo the
// user can be standing in", and nothing on screen says which floor was opened.
//   $1 = lon, $2 = lat, $3 = radiusMeters, $4 = limit,
//   $5 = userId (uuid, nullable), $6 = atlasId (uuid, nullable)
export const NEARBY_PHOTOS = `
  SELECT p.id, p.project_id, p.original_name, p.display_name, p.sequence_number,
         p.floor_level, p.floor_label,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         ST_Distance(
           p.geom::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS distance_m,
         pr.slug AS project_slug, pr.organization_id, pr.status AS project_status
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE ST_DWithin(
          p.geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND ${sv360AccessPredicate(5, 6, 'pr.')}
  ORDER BY distance_m ASC
  LIMIT $4
`;

// Tiles feed: readable photos as GeoJSON-ready rows (lon/lat from geom).
// Read access is EMBEDDED IN THE SQL (defense in depth, like the gazetteer BUSCA):
// an `enabled` project is public; a `disabled` project is visible only to a global
// admin ($1) or to a member of the owning organization ($2). Tombstoned photos are
// excluded. The controller wraps each row into a GeoJSON Feature.
//
// BOUNDED (achado 65): an OPTIONAL bbox ($3..$6, all-or-nothing — the schema parses
// and range-checks it) plus a MANDATORY LIMIT ($7, capped by
// TILES_GEOJSON_MAX_FEATURES). Without them one anonymous request scanned and
// materialized the whole table, holding a pool connection for the duration. The `&&`
// operator is index-backed by idx_sv360_photos_geom (GiST).
//   $1 = userId (uuid, nullable),
//   $2..$5 = minLon/minLat/maxLon/maxLat (double precision, nullable),
//   $6 = limit (int), $7 = atlasId (uuid, nullable)
export const TILES_PHOTOS = `
  SELECT p.id, ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         p.original_name, p.display_name, p.sequence_number, p.heading,
         pr.slug AS project_slug
  FROM sv360.photos p
  JOIN sv360.projects pr ON pr.id = p.project_id
  WHERE ${sv360AccessPredicate(1, 7, 'pr.')}
    AND p.geom IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    AND (
      $2::double precision IS NULL
      OR p.geom && ST_MakeEnvelope($2::double precision, $3::double precision,
                                   $4::double precision, $5::double precision, 4326)
    )
  ORDER BY pr.slug, p.sequence_number
  LIMIT $6::int
`;

// The ANDARES of a project, one row per level, with the number of VISIBLE photos
// standing on each. Feeds GET /projects/:slug/floors (the floor selector).
//
// The LEFT JOIN is deliberate: `sv360.project_floors` is what DECIDES a project
// has floors, so a declared level with zero photos must still be
// listed: it is a real floor of the building whose panoramas have not been
// captured (or were all tombstoned). An INNER JOIN would make the selector lose
// entries as photos are deleted, which reads as data loss on screen.
//
// The count runs over `photos.floor_level`, NOT over the label: the Beira-Rio's
// level 0 carries two labels in the field vocabulary ('Externo', 'Campo') and
// they are ONE floor. Counting by label would split level 0 in two.
//
// NO access filter here: the caller is the service, which already resolved the
// project through GET_PROJECT_BY_SLUG (access embedded in SQL) and ran
// enforceProjectReadable. The parameter is the project's UUID, never the slug.
//   $1 = project id (uuid)
export const LIST_PROJECT_FLOORS = `
  SELECT f.level, f.label, f.plan_coords, COALESCE(pc.n, 0)::int AS photo_count
  FROM sv360.project_floors f
  LEFT JOIN (
    SELECT p.floor_level AS level, count(*) AS n
    FROM sv360.photos p
    WHERE p.project_id = $1::uuid
      AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
    GROUP BY p.floor_level
  ) pc ON pc.level = f.level
  WHERE f.project_id = $1::uuid
  ORDER BY f.level ASC
`;

// All photos of a project (ordered by sequence). lon/lat from geom; excludes
// tombstoned photos.
//   $1 = project id (uuid)
export const LIST_PHOTOS_BY_PROJECT = `
  SELECT p.id, p.original_name, p.display_name, p.sequence_number,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         p.heading, p.camera_height, p.floor_level,
         p.full_size_bytes, p.preview_size_bytes, p.calibration_reviewed
  FROM sv360.photos p
  WHERE p.project_id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY p.sequence_number ASC
`;

// --- calibration reads (stage 2b) ------------------------------------------
// The queries below feed the calibration workspace. They are READS, so they live
// here next to their siblings; the access rule is applied by the service, which
// resolves the project through GET_PROJECT_BY_SLUG first (the one exception is
// REVIEW_STATS_ALL_PROJECTS, which has no slug to resolve and therefore carries
// the filter itself).

// Same directed adjacency as GET_TARGETS_FOR_PHOTO, but WITHOUT the
// `hidden = false` filter and WITH the flag itself — the source of
// `GET /photos/:uuid?include_hidden=true`.
//
// A SEPARATE constant rather than a parameter on the other one: the visible read
// is the hot path of the viewer and it is served by
// idx_sv360_targets_source, a PARTIAL index on `hidden = false`. A
// `($2 OR t.hidden = false)` predicate cannot use a partial index, so folding the
// two together would slow every panorama in the archive to spare one SQL constant.
// Tombstoned destinations stay excluded here too: a link to a deleted photo is
// unusable whether it is hidden or not.
//   $1 = source photo id (TEXT uuid v5)
export const GET_ALL_TARGETS_FOR_PHOTO = `
  SELECT t.target_id, t.distance_m, t.bearing_deg, t.is_next, t.is_original,
         t.override_bearing, t.override_distance, t.override_height, t.hidden,
         tp.original_name AS target_name, tp.display_name AS target_display_name,
         ST_X(tp.geom) AS target_lon, ST_Y(tp.geom) AS target_lat, tp.ele AS target_ele,
         tp.floor_level AS target_floor_level, tp.floor_label AS target_floor_label
  FROM sv360.targets t
  JOIN sv360.photos tp ON tp.id = t.target_id
  WHERE t.source_id = $1
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = t.target_id)
  ORDER BY t.is_next DESC, t.distance_m ASC
`;

// Photos of the SAME project near a source photo and NOT yet linked to it — the
// candidate list of the "connect this photo to that one" tool.
//
// Distance and bearing come from PostGIS (::geography = true meters, ST_Azimuth =
// true forward azimuth), NOT from a hand-written haversine: the origin computes
// both in JavaScript because SQLite has no geography type, and this house does.
// ST_Azimuth is NULL for two coincident points (an exactly duplicated position),
// where a bearing has no meaning; COALESCE keeps the column a number so the caller
// never has to special-case it, exactly like the origin's atan2(0, 0) = 0.
//
// The floor filter is NOT cosmetic. The GiST index is 2D and an indoor survey
// stacks photos vertically: in the Beira-Rio, 91 of 350 photos have a photo of
// ANOTHER floor closer than 5 m in plan, the nearest at 0.7 m, against an 8 to 13 m
// step inside the floor itself. Without it the tool offers the 5th floor to an
// operator standing on the ground, and the link created from there crosses the
// building. `$3 IS NULL` disables it, which is what a flat project wants.
//   $1 = source photo id, $2 = radius meters, $3 = floor level (int, nullable)
export const NEARBY_UNLINKED_PHOTOS = `
  SELECT p.id, p.original_name, p.display_name, p.sequence_number,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat, p.ele,
         p.floor_level, p.floor_label,
         ST_Distance(p.geom::geography, src.geom::geography) AS distance_m,
         COALESCE(degrees(ST_Azimuth(src.geom, p.geom)), 0) AS bearing_deg
  FROM sv360.photos src
  JOIN sv360.photos p
    ON p.project_id = src.project_id
   AND p.id <> src.id
  WHERE src.id = $1
    AND ST_DWithin(p.geom::geography, src.geom::geography, $2)
    AND ($3::int IS NULL OR p.floor_level = $3::int)
    AND NOT EXISTS (
      SELECT 1 FROM sv360.targets t WHERE t.source_id = src.id AND t.target_id = p.id
    )
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY distance_m ASC
`;

// Every photo of a project as the calibration LIST sees it: what to review, in
// what order, and how far the review got.
//
// run_id / run_position travel with each photo so the client can build the
// per-run navigation in memory instead of one request per run. They are filled by
// the run derivation ETL (scripts/sv360-derive-runs.js, `npm run
// sv360:derive-runs`), which is run per project and is NOT part of ingestion, so
// they stay NULL until it runs over that project; a NULL there means "this project
// has no runs", which is the pre-run behaviour, not an error.
//   $1 = project id (uuid)
export const PROJECT_CALIBRATION_PHOTOS = `
  SELECT p.id, p.original_name, p.display_name, p.sequence_number,
         p.calibration_reviewed, p.run_id, p.run_position,
         p.calibration_source, p.capture_date,
         p.floor_level, p.floor_label
  FROM sv360.photos p
  WHERE p.project_id = $1::uuid
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY p.sequence_number ASC
`;

// Review counters of ONE project (the progress bar of the calibration header).
//   $1 = project id (uuid)
export const REVIEW_STATS_BY_PROJECT = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE p.calibration_reviewed)::int AS reviewed
  FROM sv360.photos p
  WHERE p.project_id = $1::uuid
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
`;

// Review counters of EVERY readable project, in ONE scan.
//
// The project picker draws a progress bar per project and nothing else. Getting
// those two numbers from /projects/:slug/photos, one call per project, pulled the
// whole archive (99.040 photos) across the wire to add up 29 pairs of integers.
//
// The access rule is EMBEDDED HERE (defense in depth) because there is no slug for
// the service to resolve first: an `enabled` project is public, a `disabled` one
// only reaches its owning org or a global admin.
//
// GROUPED BY SLUG, not by project id: the response is an object keyed by slug, and
// a slug is UNIQUE ONLY PER ORGANIZATION. Two orgs sharing a slug would otherwise
// produce two rows for one key and the second would silently overwrite the first.
// Adding them keeps the number honest about everything the caller can see; it is
// also the only case where this endpoint and GET /projects/:slug (which prefers the
// caller's own org) describe different sets, and there is no cross-org slug
// collision in the current corpus.
//   $1 = userId (uuid, nullable), $2 = atlasId (uuid, nullable)
export const REVIEW_STATS_ALL_PROJECTS = `
  SELECT pr.slug,
         COUNT(p.id)::int AS total,
         COUNT(p.id) FILTER (WHERE p.calibration_reviewed)::int AS reviewed
  FROM sv360.projects pr
  LEFT JOIN sv360.photos p
    ON p.project_id = pr.id
   AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  WHERE ${sv360AccessPredicate(1, 2, 'pr.')}
  GROUP BY pr.slug
  ORDER BY pr.slug
`;

// Everything the calibration MAP draws, one row per photo: position, review state
// and the three angles, so the operator sees the parameters without opening the
// photo.
//
// floor_level travels along because without it the Beira-Rio map draws 6 floors
// stacked on the same point and the operator cannot tell which one is being
// clicked.
//   $1 = project id (uuid)
export const MAP_PHOTOS_BY_PROJECT = `
  SELECT p.id, p.display_name, p.sequence_number,
         ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
         p.heading, p.mesh_rotation_y, p.mesh_rotation_x, p.mesh_rotation_z,
         p.calibration_reviewed, p.floor_level, p.floor_label
  FROM sv360.photos p
  WHERE p.project_id = $1::uuid
    AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  ORDER BY p.sequence_number ASC
`;

// The capture TRACK of a project, one array of [lon, lat] per LineString.
//
// `sv360.tracks` holds the SEPARATE stretches the survey actually drove (3.236 of
// them in the archive; the `1pef` project alone has 34). They are returned as
// separate arrays and never joined: a single polyline jumps from the end of one
// stretch to the start of the next and draws a path nobody travelled.
//   $1 = project id (uuid)
export const TRACKS_BY_PROJECT = `
  SELECT ST_AsGeoJSON(t.geom)::json -> 'coordinates' AS coords
  FROM sv360.tracks t
  WHERE t.project_id = $1::uuid
  ORDER BY t.id
`;

// The capture RUNS of a project, with per-run review progress in one scan.
//
// The LEFT JOIN is deliberate: a run whose photos were all soft-deleted still has
// to appear, otherwise the ordinals show a hole the interface cannot explain.
//
// A PROJECT ANSWERS EMPTY UNTIL THE DERIVATION RUNS OVER IT. `sv360.capture_runs`
// is populated by scripts/sv360-derive-runs.js (`npm run
// sv360:derive-runs`, one project with --slug or every project), which groups the
// photos by the session id in original_name (sv360.capture-runs.js) and links
// sv360.photos.run_id / run_position. Ingestion does not call it, so a project it
// never touched has no runs. An empty list is the honest answer for "this project
// has no runs" and is exactly what the pre-run interface expects.
//   $1 = project id (uuid)
export const RUNS_BY_PROJECT = `
  SELECT cr.id, cr.session_key, cr.label, cr.started_at, cr.ordinal,
         cr.applied_rotation_y, cr.applied_rotation_x, cr.applied_rotation_z,
         COUNT(p.id)::int AS total,
         COUNT(p.id) FILTER (WHERE p.calibration_reviewed)::int AS reviewed
  FROM sv360.capture_runs cr
  LEFT JOIN sv360.photos p
    ON p.run_id = cr.id
   AND NOT EXISTS (SELECT 1 FROM sv360.deleted_photos d WHERE d.photo_id = p.id)
  WHERE cr.project_id = $1::uuid
  GROUP BY cr.id
  ORDER BY cr.ordinal ASC
`;
