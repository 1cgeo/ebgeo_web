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
// $1 = term (q), $2 = lat, $3 = lon, $4 = zoom (int, nullable).
//
// NAO HA PREDICADO DE ACESSO AQUI, e a ausencia e decisao, nao esquecimento. Ate
// 2026-08-19 esta consulta filtrava por `access_level` e por zona geografica, e o
// eixo inteiro foi removido como residuo: o gazetteer e busca de toponimo, e o dono
// definiu que ela nao tem restricao nenhuma. Quem for "endurecer" isto de volta
// esta reintroduzindo um sistema que ja foi medido como morto (as zonas tinham API
// de admin e nenhuma tela, e a tabela de membros de grupo nunca teve escritor).
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
    -- This route kept serving PRIVATE place names to a deactivated account,
    -- contradicting the header of this very file, which assigns the SQL the job of
    -- not leaking private data "even with an app bug". (The two sibling routes that
    -- this paragraph used to compare against, /feicoes and /catalogo3d, were removed
    -- on 2026-08-19 with edificacoes and the second 3D catalog; the liveness check
    -- now rides inside fn_has_global_data_access, which is where it belongs.)
    --
    -- A metade ORGANIZACIONAL da mesma reconciliacao faltava ate 2026-07-25: o caminho
    -- estrito responde 403 "Organization is inactive" (getLiveAuthState, em
    -- utils/org-status.js), enquanto esta rota continuava servindo nome privado a
    -- membro de OM desativada. Mesma regra do org-status.js: linha de organizacao
    -- AUSENTE conta como ativa (anomalia, nao desativacao deliberada), dai o
    -- COALESCE(o.is_active, true).
    -- (No backticks in this comment: the query is a JS template literal.)
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

