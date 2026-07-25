// Path: src/modules/nomes/nomes.queries.js
// SQL ported VERBATIM from servico_nomes_geograficos (origin/main). Do not
// rewrite the ranking logic — the 7-criteria weights sum to 1.00 and are frozen.
//
// NEVER put a backtick in a SQL comment in this file. Every query below is a JS
// template literal, so one backtick closes the string and the whole module becomes a
// SyntaxError, which the test runner reports as a generic "test failed" with no line
// number, far from the cause. This warning used to live on a single comment further
// down and was written after the mistake happened; it happened again on 2026-07-25,
// by an author who never scrolled that far. It belongs here, where it is read first.

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
  -- OPERADOR de similaridade, não a chamada similarity(...) > 0.25. O pg_trgm só alcança o
  -- índice GIN pelo operador; uma chamada de função é opaca ao planner e força
  -- Seq Scan sobre a ng.nomes_geograficos inteira, avaliando f_unaccent() e
  -- similarity() linha a linha e depois ST_Distance() sobre cada candidato. O
  -- índice que resolve isso já existia e estava ocioso desde a migração 004
  -- (idx_ng_nome_unaccent_trgm, GIN sobre ng.f_unaccent(nome)).
  --
  -- O limiar de 0.25 é preservado por SET LOCAL pg_trgm.similarity_threshold
  -- no service, e NÃO pelo default da extensão, que é 0.3: trocar o predicado
  -- sem fixar o limiar deixaria de fora os resultados entre 0.25 e 0.3, o que
  -- seria mudança silenciosa de comportamento de busca.
  --
  -- O termo vem do PARÂMETRO, não de q.term, e isso é load-bearing: a CTE q é
  -- referenciada mais de uma vez (aqui e no cálculo do score), então o Postgres a
  -- MATERIALIZA, e q.term deixa de ser constante para o planner. Medido com
  -- EXPLAIN: com q.term o operador aparece como "Join Filter" e o índice segue
  -- ocioso mesmo com enable_seqscan=off; com o parâmetro direto vira Index Cond.
  -- Trocar o operador sem tirar a CTE do predicado não conserta nada.
  WHERE ng.f_unaccent(n.nome) % ng.f_unaccent($1)
    -- Liveness is part of the ACCESS FILTER, not a nicety. flexibleAuth only
    -- reconciles against the DB in the last 5 minutes of a token's life, so between a
    -- deactivation and that window a disabled account still carries a valid JWT. The
    -- sibling routes (/feicoes, /catalogo3d) refuse it at once; this one kept serving
    -- PRIVATE place names, contradicting the header of this very file, which assigns
    -- the SQL the job of not leaking private data "even with an app bug".
    --
    -- A metade ORGANIZACIONAL da mesma reconciliacao faltava ate 2026-07-25: o caminho
    -- estrito responde 403 "Organization is inactive" (getLiveAuthState, em
    -- utils/org-status.js), enquanto esta rota continuava servindo nome privado a
    -- membro de OM desativada. Mesma regra do org-status.js: linha de organizacao
    -- AUSENTE conta como ativa (anomalia, nao desativacao deliberada), dai o
    -- COALESCE(o.is_active, true).
    -- (No backticks in this comment: the query is a JS template literal.)
    AND ( n.access_level = 'public'
          OR ($5::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
                 WHERE u.id = $5 AND u.is_active = true AND COALESCE(o.is_active, true) = true
              ) AND (
                EXISTS (SELECT 1 FROM users WHERE id = $5 AND role = 'admin' AND is_active = true)
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
  -- O dist ASC daqui e REDUNDANTE na forma atual da query, e saber disso importa para quem
  -- for reescrever o CTE. O candidatos acima ja entrega ordenado por dist, entao remover
  -- este dist ASC nao muda resultado nenhum e nenhum teste fica vermelho; a mutacao que
  -- discrimina e trocar por dist DESC. Ou seja, ele nao esta protegido por construcao: se o
  -- ORDER BY do candidatos mudar ou sumir, este vira load-bearing em silencio, e e ele que
  -- decide QUAL linha do cluster representa o grupo. Medido em 2026-07-25 (item 121 de
  -- testes-backend.md). (Sem crase neste comentario: a query e um template literal de JS.)
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
//
// ⚠️ O predicado de acesso (CTEs `user_role` + `user_model_permissions`) é
// DUPLICADO VERBATIM em CATALOGO_COUNT logo abaixo — só muda o placeholder do
// userId ($4 aqui, $2 lá). Nunca foi extraído para uma função SQL
// (`fn_user_can_see_model`); ao editar o filtro de acesso, altere OS DOIS ou a
// contagem passa a divergir da listagem.
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
-- c.id como ULTIMO criterio nao e enfeite: sem um desempate UNICO, a ordem de
-- linhas empatadas em (rank, data_criacao) fica a criterio do plano, e o plano
-- MUDA conforme o OFFSET cresce. O resultado e paginacao que repete e perde
-- linhas ao mesmo tempo. Medido no Postgres com linhas empatadas: 80 linhas -> 2
-- duplicadas e 2 perdidas; 120 -> 4/4; 200 -> 8/8; 1000 -> 48/48.
--
-- Abaixo de ~40 linhas um unico plano serve todas as paginas e o defeito nao
-- aparece — que e exatamente por que o teste antigo, com poucas linhas E com
-- data_criacao fabricada distinta por linha, passava com e sem desempate.
ORDER BY rank DESC, c.data_criacao DESC, c.id DESC
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
