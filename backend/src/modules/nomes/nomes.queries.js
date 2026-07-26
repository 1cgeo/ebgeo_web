// Path: src/modules/nomes/nomes.queries.js
//
// NEVER put a backtick in a SQL comment in this file. Every query below is a JS
// template literal, so one backtick closes the string and the whole module becomes a
// SyntaxError, which the test runner reports as a generic "test failed" with no line
// number, far from the cause. This warning used to live on a single comment further
// down and was written after the mistake happened; it happened again on 2026-07-25,
// by an author who never scrolled that far. It belongs here, where it is read first.

// ============================================================================
// BUSCA - ordenacao em TRES CHAVES LEXICOGRAFICAS, nao em soma ponderada.
// ============================================================================
// $1 = term (q), $2 = lat, $3 = lon, $4 = zoom (int, nullable), $5 = userId (uuid|null).
//
// Ate 2026-07-26 isto era uma soma de 7 criterios com pesos somando 1.00, herdada
// verbatim do servico_nomes_geograficos. A troca nao foi opiniao: foi medida contra
// um conjunto dourado de 584 casos em 13 familias (dev/busca-golden.json), com o
// calibrador em dev/tune-busca.mjs. Aprovacao 81,5% -> 92,6%.
//
// A DOUTRINA, declarada: vence a feicao de MAIOR IMPORTANCIA mais PROXIMA do local,
// com a importancia sendo CATEGORICA e nao de entidade. Cidade e muito importante e
// vem primeiro INDEPENDENTE da distancia; nao existe ranking entre cidades. Abaixo
// desse degrau vale a combinacao de proximidade e importancia. E a triade que o
// Google documenta para resultado local (relevancia, distancia, proeminencia).
//
// POR QUE CHAVES E NAO SOMA. Numa soma - e tambem num produto - distancia suficiente
// sempre COMPRA a diferenca de categoria, porque as duas moram na mesma unidade. Nao
// existe peso que torne "cidade" incomparavel: so torna caro. Uma chave lexicografica
// nao se compra. O numero que fecha o caso e a familia H do conjunto dourado (Cidade
// do mesmo nome consultada a ~330 km, que tem de aparecer no topo):
//     soma de 7 criterios, pesos originais ....... 85,7%
//     soma recalibrada no otimizador ............. 85,7%
//     produto multiplicativo com decaimento gauss  47,6%
//     ESTAS TRES CHAVES ......................... 100,0%
// O modelo multiplicativo e o padrao da industria (function_score do Elasticsearch,
// que e como o Pelias faz) e PIORA esse caso, porque decaimento gaussiano a 330 km
// esmaga tudo antes de a categoria votar.
//
// AS TRES CHAVES:
//   1. RELEVANCIA, em faixa. CONTAINMENT CONTA COMO CASAMENTO PLENO: digitar
//      "Altamira" com o mapa em cima de "Altamira do Paraná" e prefixo legitimo, nao
//      erro de digitacao, e o trigrama pune a diferenca de comprimento (1,00 contra
//      ~0,53) jogando os dois em faixas diferentes, onde a categoria nunca vota.
//      Medido: a familia I (colisao de substring) vai de 14% para 77% so com isto.
//   2. CATEGORIA. tipo_peso >= tier_min (hoje 1.0, ou seja, so Cidade) vem primeiro.
//      Baixar o degrau para 0.9 (incluindo Vila e Povoado) mede 90,6%, pior que 92,6%.
//   3. COMBINACAO de importancia e proximidade, dentro do degrau e abaixo dele.
//      importancia^gama vezes decaimento gaussiano com PLATO: dentro do plato a
//      distancia nao penaliza NADA e quem decide e a importancia.
//      gama = 0,3 comprime a importancia, e nao e enfeite: com gama = 1 a
//      multiplicacao por tipo_peso = 0.1 divide por dez quem esta no piso (29% do
//      acervo) e a familia J desabava de 92% para 43%. E o equivalente ao
//      modifier log1p/sqrt do field_value_factor do Elasticsearch.
//   4. DESEMPATE por trigrama cru. Nao melhora ranking nenhum (medido: zero efeito
//      no conjunto dourado); existe por DETERMINISMO. Sem uma ultima chave, dois
//      candidatos identicos nas tres primeiras ordenam pelo que o plano devolver, e
//      plano muda com volume - o mesmo defeito que o "c.id DESC" do CATALOGO_SELECT
//      logo abaixo existe para evitar.
//
// O CAMPO `score` CONTINUA SAINDO, e continua em [0,1]: ele e o contrato congelado do
// frontend. Como a ordem agora e lexicografica e nao um escalar, o score e a tupla
// CODIFICADA numa base que preserva a ordem (faixa domina tier, que domina
// combinacao), de modo que ORDER BY score DESC e exatamente a ordem das chaves.
// Quem consome le um numero decrescente, como antes.
//
// ZOOM: continua opcional e agora afia SO O ESPACO - plato e escala encolhem com
// 2^(10-zoom). O antigo `zoom_factor`, que NEUTRALIZAVA tipo_peso em zoom alto
// (todo tipo virava 0.5), foi REMOVIDO: ele contradiz a chave 2 frontalmente, porque
// zerar a diferenca de categoria e exatamente o que a doutrina proibe. O frontend
// nao envia zoom (frontend/src/js/search/search-bar.search-providers.js), entao o
// caminho real e o dos defaults.
//
// Filtro de acesso EMBUTIDO (defense in depth): nome privado so aparece para admin ou
// para quem tem zona que o contem. Anonimo ($5 null) ve so publico.
export const BUSCA = `
WITH q AS (
  SELECT ng.f_unaccent($1) AS term,
    -- Constantes calibradas. Mexer nelas exige rodar dev/tune-busca.mjs de novo:
    -- elas nao sao gosto, sao o ponto medido sobre dev/busca-golden.json.
    0.15::float8 AS faixa_casamento,   -- largura da faixa de relevancia
    1.0::float8  AS tier_min,          -- degrau de categoria (1.0 = so Cidade)
    0.3::float8  AS gama,              -- compressao da importancia
    CASE WHEN $4::int IS NOT NULL THEN  10.0 * power(2, 10 - $4::int) ELSE  10.0 END AS plato_km,
    CASE WHEN $4::int IS NOT NULL THEN 300.0 * power(2, 10 - $4::int) ELSE 300.0 END AS escala_km
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
pontuado AS (
  SELECT d.nome, d.tipo, d.municipio, d.estado, d.longitude, d.latitude, d.sim,
    -- CHAVE 1: relevancia em faixa. Containment vale casamento PLENO (ver o cabecalho).
    floor(
      (CASE WHEN lower(d.nome_clean) LIKE '%'||lower(q.term)||'%' THEN 1.0 ELSE d.sim END)
      / q.faixa_casamento
    ) AS faixa,
    -- CHAVE 2: categoria. Acima do degrau, vem antes, independente da distancia.
    CASE WHEN COALESCE(d.tipo_peso, 0.1) >= q.tier_min THEN 1 ELSE 0 END AS tier,
    -- CHAVE 3: importancia comprimida vezes decaimento gaussiano com plato.
    -- power(0.5, (excedente/escala)^2) e a gaussiana do Elasticsearch escrita direto:
    -- vale exatamente 0.5 quando o excedente iguala a escala. Dentro do plato o
    -- excedente e zero e o decaimento vale 1, ou seja, a distancia nao vota.
    --
    -- O LEAST(..., 700) NAO e paranoia: o Postgres LANCA ERRO em underflow de float em
    -- vez de saturar em zero. Com zoom 16 a escala cai para 4,7 km, um candidato a
    -- 300 km da expoente 4096, e power(0.5, 4096) derruba a requisicao inteira com
    -- 22003 float_underflow_error. Achado rodando a query real contra o acervo real:
    -- nenhum teste de unidade pegaria, porque so aparece com zoom alto E candidato
    -- distante ao mesmo tempo. 0.5^700 ~ 5e-211 ainda cabe num double.
    (
      power(COALESCE(d.tipo_peso, 0.1), q.gama)
      * power(0.5, LEAST(power(GREATEST(0.0, d.dist / 1000.0 - q.plato_km) / q.escala_km, 2), 700.0))
    ) AS combinacao,
    -- Normalizador derivado da propria faixa, e nao um literal: a maior faixa possivel
    -- e floor(1/faixa_casamento), e cada chave precisa de mais peso que TUDO abaixo
    -- dela (faixa vale 4, e tier 2 + combinacao 1 somam 3 < 4; tier vale 2, e
    -- combinacao 1 < 2). Mudar faixa_casamento sem isto quebraria a dominancia em
    -- silencio, e o sintoma seria ordem errada, nao erro.
    (floor(1.0 / q.faixa_casamento) * 4 + 3) AS teto
  FROM dedup d, q
)
SELECT nome, tipo, municipio, estado, longitude, latitude,
  ((faixa * 4 + tier * 2 + combinacao + sim * 0.001) / (teto + 0.001)) AS score
FROM pontuado
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
