// Path: src/modules/nomes/nomes.queries.js
// SQL ported VERBATIM from servico_nomes_geograficos (origin/main). Do not
// rewrite the ranking logic — the 7-criteria weights sum to 1.00 and are frozen.

// 7-criteria search with EMBEDDED access filter (defense in depth).
// $1 = term (q), $2 = lat, $3 = lon, $4 = zoom (int, nullable), $5 = userId (uuid|null).
// A private name only surfaces if the user is admin or it is inside one of the
// user's zones (ST_Contains). Anonymous ($5 null) sees only public names.
export const BUSCA = `
WITH q AS (
  SELECT ng.f_unaccent($1) AS term,
    CASE WHEN $4::int IS NOT NULL THEN 50000.0 * power(2, 10 - $4::int) ELSE 50000.0 END AS decay_dist,
    CASE WHEN $4::int IS NOT NULL THEN GREATEST(0.0, LEAST(($4::int - 4.0)/14.0, 1.0)) ELSE 0.0 END AS zoom_factor
),
candidatos AS (
  SELECT n.nome, n.tipo, n.municipio, n.estado, n.geom, n.tipo_peso, n.cluster_id,
    ng.f_unaccent(n.nome) AS nome_clean,
    similarity(ng.f_unaccent(n.nome), q.term) AS sim,
    ST_Distance(n.geom::geography, ST_SetSRID(ST_MakePoint($3, $2), 4674)::geography) AS dist
  FROM ng.nomes_geograficos n, q
  WHERE similarity(ng.f_unaccent(n.nome), q.term) > 0.25
    AND ( n.access_level = 'public'
          OR ($5::uuid IS NOT NULL AND (
                EXISTS (SELECT 1 FROM users WHERE id = $5 AND role = 'admin')
                OR EXISTS (SELECT 1 FROM ng.fn_user_zone_geoms($5) uz WHERE ST_Contains(uz.geom, n.geom))
          )) )
  ORDER BY sim DESC, dist ASC
  LIMIT 500
),
dedup AS (
  SELECT DISTINCT ON (nome, tipo, cluster_id)
    nome, tipo, municipio, estado, sim, dist, tipo_peso, nome_clean,
    ST_X(geom) AS longitude, ST_Y(geom) AS latitude
  FROM candidatos
  ORDER BY nome, tipo, cluster_id, dist ASC
),
q_ref AS (SELECT term, decay_dist, zoom_factor FROM q)
SELECT d.nome, d.tipo, d.municipio, d.estado, d.longitude, d.latitude,
  (
      CASE WHEN lower(d.nome_clean) = lower(q_ref.term)              THEN 1.0 ELSE 0.0 END * 0.20
    + CASE WHEN lower(d.nome_clean) LIKE lower(q_ref.term)||'%'      THEN 1.0 ELSE 0.0 END * 0.10
    + CASE WHEN lower(d.nome_clean) LIKE '%'||lower(q_ref.term)||'%' THEN 1.0 ELSE 0.0 END * 0.15
    + d.sim * 0.10
    + (1.0 - abs(length(q_ref.term) - length(d.nome_clean))::float
            / GREATEST(length(q_ref.term), length(d.nome_clean), 1)) * 0.15
    + (COALESCE(d.tipo_peso,0.1) * (1.0 - q_ref.zoom_factor) + 0.5 * q_ref.zoom_factor) * 0.10
    + (1.0 / (1.0 + d.dist / q_ref.decay_dist)) * 0.20
  ) AS score
FROM dedup d, q_ref
ORDER BY score DESC
LIMIT 5
`;

// /feicoes (3D building click) with EMBEDDED access filter.
// $1 = lon, $2 = lat, $3 = z, $4 = userId (uuid|null). edificacoes is SRID 4326;
// zones are 4674, so the zone is transformed to 4326 for ST_Contains.
export const FEICOES = `
SELECT e.id, e.nome, e.municipio, e.estado, e.tipo, e.altitude_base, e.altitude_topo,
  CASE
    WHEN $3 BETWEEN e.altitude_base AND e.altitude_topo THEN 0
    WHEN $3 < e.altitude_base THEN e.altitude_base - $3
    ELSE $3 - e.altitude_topo
  END AS z_distance,
  ST_Distance(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS xy_distance
FROM ng.edificacoes e
WHERE ST_DWithin(e.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 3)
  AND ( e.access_level = 'public'
        OR ($4::uuid IS NOT NULL AND (
              EXISTS (SELECT 1 FROM users WHERE id = $4 AND role = 'admin')
              OR EXISTS (SELECT 1 FROM ng.fn_user_zone_geoms($4) uz
                         WHERE ST_Contains(ST_Transform(uz.geom, 4326), e.geom))
        )) )
ORDER BY z_distance ASC, xy_distance ASC
LIMIT 1
`;

// /catalogo3d — full-text + pagination + access filter EMBEDDED in SQL (defense
// in depth). $1 = q (nullable), $2 = limit, $3 = offset, $4 = userId (uuid|null).
// The WHERE is a disjunction of access branches so fase-6 only ADDS the spatial
// zone branch (LEFT JOIN user_zones ON ST_Contains(...) OR uz.id IS NOT NULL)
// without rewriting this query.
export const CATALOGO_SELECT = `
WITH user_role AS (
  SELECT EXISTS (SELECT 1 FROM users WHERE id = $4::uuid AND role = 'admin') AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $4::uuid
    UNION
    SELECT mgp.model_id
      FROM ng.model_group_permissions mgp
      JOIN ng.user_groups ug ON mgp.group_id = ug.group_id
     WHERE ug.user_id = $4::uuid
  ) perms
)
SELECT c.id, c.name, c.description, c.thumbnail, c.url,
       c.lon, c.lat, c.height, c.heading, c.pitch, c.roll,
       c.type, c.heightoffset, c.maximumscreenspaceerror,
       c.data_criacao, c.municipio, c.estado, c.palavras_chave, c.style,
       CASE WHEN $1::text IS NOT NULL
            THEN ts_rank(c.search_vector, plainto_tsquery('portuguese', $1))
            ELSE 0 END AS rank
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($4::uuid IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR c.search_vector @@ plainto_tsquery('portuguese', $1))
ORDER BY rank DESC, c.data_criacao DESC
LIMIT $2 OFFSET $3
`;

// COUNT with the EXACT same access predicate (count must not lie). $1 = q, $2 = userId.
export const CATALOGO_COUNT = `
WITH user_role AS (
  SELECT EXISTS (SELECT 1 FROM users WHERE id = $2::uuid AND role = 'admin') AS is_admin
),
user_model_permissions AS (
  SELECT DISTINCT model_id FROM (
    SELECT model_id FROM ng.model_permissions WHERE user_id = $2::uuid
    UNION
    SELECT mgp.model_id
      FROM ng.model_group_permissions mgp
      JOIN ng.user_groups ug ON mgp.group_id = ug.group_id
     WHERE ug.user_id = $2::uuid
  ) perms
)
SELECT COUNT(*)::int AS total
FROM ng.catalogo_3d c
CROSS JOIN user_role ur
LEFT JOIN user_model_permissions ump ON ump.model_id = c.id
WHERE ( c.access_level = 'public'
        OR ($2::uuid IS NOT NULL AND (ur.is_admin OR ump.model_id IS NOT NULL)) )
  AND ($1::text IS NULL OR c.search_vector @@ plainto_tsquery('portuguese', $1))
`;
