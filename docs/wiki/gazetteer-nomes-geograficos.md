# Gazetteer de Nomes Geográficos (schema ng)

Subsistema read-only sobre PostGIS no schema isolado `ng`, alimentado por carga externa (FME), com autorização embutida no SQL e três contratos de resposta congelados. Código em `src/modules/nomes/`.

## Por que está fora do sync

Nenhuma rota de escrita, nenhum `version`, nenhuma operação, nenhum broadcast. O dado entra por job FME direto no banco; a API só lê. Quem procurar aqui um caminho de edição de topônimo não vai achar, e isso é por projeto: ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]].

Corolário operacional: não há push de invalidação. Trocou de usuário ou mudou permissão de zona, refaça as consultas.

## Contratos congelados

Duas das três rotas fogem do envelope padrão da API, e isso está marcado no código (`backend/src/modules/nomes/nomes.controller.js:2-3`, `:7`, `:18`):

- `/busca` devolve **array nu** de até 5 itens.
- `/catalogo3d` devolve envelope próprio `{ total, page, nr_records, data }`.
- `/feicoes` responde **200 sempre**: o objeto do prédio **ou** `{ message: 'Nenhuma edificação encontrada...' }` (`backend/src/modules/nomes/nomes.controller.js:15`). Não é 404, não é array vazio. O cliente distingue os dois casos pela presença de `id`.

Não envolva nada disso em `{ data }` para "padronizar": quebra o frontend. Ver [[sintese-contratos-congelados]]; para o envelope do resto da API, [[erros-api]] e [[api-rest-atlas]].

## A armadilha nº 1: a busca roda anônima mesmo logado

`/busca` **não** usa o middleware `auth`; `/feicoes` e `/catalogo3d` usam (`backend/src/modules/nomes/nomes.routes.js:15-17`). Isso é deliberado, para o caminho anônimo funcionar: o `flexibleAuth` global popula `req.user` quando há credencial e o controller passa `req.user?.id` adiante (`backend/src/modules/nomes/nomes.controller.js:9`); sem credencial vai `null` e o filtro embutido no SQL devolve só o público. Ver [[auth-flexivel]] e [[autenticacao-jwt]].

O que morde: os dois call sites do cliente web fazem `fetch` **sem header `Authorization`** (`frontend/src/js/search/search-bar.search-providers.js:281`, `frontend/src/js/search/feature-search.control.js:182`). Ou seja, mesmo com usuário logado, a busca de topônimos hoje enxerga apenas `access_level = 'public'`. Se alguém reclamar que "não acho o nome privado da minha zona", a causa é essa, não o SQL.

Nenhum código do web consome hoje `/feicoes` nem `/catalogo3d` (grep por `nomes/feicoes` e `catalogo3d` em `src/` não retorna nada). São capacidades servidas para outros consumidores 3D.

A URL da busca não é mais configurável: deriva da base da API (`frontend/src/js/search/gazetteer-url.js:24-26`), para funcionar em dev (proxy `/api` do Vite), produção (mesma origem) e E2E. O antigo `SEARCH_API_URL` tinha default apontando para um serviço que nunca existiu, e como os dois call sites toleram erro, a busca falhava **em silêncio** (`frontend/src/js/search/gazetteer-url.js:6-16`). Ver [[config-runtime-urls-relativas]].

## Ranking e busca: o que surpreende

Os pesos dos 7 critérios somam 1.00, foram portados verbatim do serviço de origem e são congelados (`backend/src/modules/nomes/nomes.queries.js:2-3`, `:38-51`). Não altere sem regressão contra dados reais. Detalhe critério a critério em [[ranking-busca-toponimos]].

- **O corte acontece antes do score.** A CTE `candidatos` pré-filtra por `similarity(...) > 0.25` e corta em `LIMIT 500` ordenado por `sim DESC, dist ASC` (`backend/src/modules/nomes/nomes.queries.js:21`, `:27-28`). Os 7 critérios só são aplicados **depois** desse corte. Um nome pertinho do usuário, mas com similaridade textual medíocre, pode nunca chegar ao score se houver 500 candidatos textualmente melhores.
- **Sem `zoom`, o raio é 50 km.** O decaimento é `50000 * 2^(10 - zoom)` metros, e `zoom_factor` neutraliza o peso por tipo em zoom alto (`backend/src/modules/nomes/nomes.queries.js:12-13`). **Nenhum dos dois call sites do web envia `zoom`**, então na prática o app opera sempre no modo padrão: 50 km e peso por tipo em força total.
- **`lat`/`lon` são limitados no Joi por causa do PostGIS**, não por preciosismo: as queries fazem cast para `::geography`, que estoura 500 com coordenada fora de faixa; a borda converte em 422 (`backend/src/modules/nomes/nomes.schemas.js:4-6`). Ver [[sintese-contrato-erros-http]]. Do lado do cliente, `map.getCenter()` devolve longitude não normalizada e passa de ±180 depois do antimeridiano, por isso ambos os call sites aplicam `wrapLongitude`/`clampLatitude` antes do fetch.

## Armadilha de SRID

`ng.nomes_geograficos` é `POINT, 4674` (SIRGAS 2000) e `ng.edificacoes` é `POLYGON, 4326` (`backend/src/database/migrations/004_ng.sql:37`, `:62`). A diferença é deliberada e coberta por teste (`backend/tests/integration/nomes.test.js:62-67`). Por isso `/busca` constrói o ponto em 4674 e `/feicoes` em 4326, e o filtro de zona de `/feicoes` precisa de `ST_Transform(uz.geom, 4326)`, já que as zonas são 4674 (`backend/src/modules/nomes/nomes.queries.js:64`, `:71`).

Ao mexer em qualquer query aqui, confira o SRID antes de copiar-colar de uma rota para a outra.

## Autorização embutida no SQL

As três rotas embutem a autorização no `WHERE`, não numa camada de aplicação: linha privada não chega ao Node para ser filtrada. É defesa em profundidade, e é o motivo de o filtro estar replicado em cada query. Corolário para o cliente: não filtre registros privados no frontend, eles não chegam. Ver [[zonas-acesso-geografico]], [[sintese-eixos-de-permissao]] e [[hardening-borda-api]].

Duas escolhas que valem o byte:

- **Admin é reconferido no banco**, com `EXISTS (SELECT 1 FROM users WHERE id = $N AND role = 'admin')` (`backend/src/modules/nomes/nomes.queries.js:24`, `:69`, `:90`, `:122`), e não pela claim do JWT. Um token antigo com `role` desatualizado não vira acesso indevido aqui. Ver [[permissoes-atlas]].
- **`fn_user_zone_geoms(NULL)` devolve vazio por construção** (`backend/src/database/migrations/004_ng.sql:246-256`), então o caminho anônimo degrada para "só público" mesmo se alguém remover o guard `$N::uuid IS NOT NULL` da aplicação.

Assimetria proposital: `catalogo_3d` tem permissão linha a linha (direta ou por grupo), mas **nenhum ramo espacial de zona**. O comentário em `backend/src/modules/nomes/nomes.queries.js:79-81` deixa o gancho para adicioná-lo sem reescrever a query.

**A armadilha mais cara do módulo:** o predicado de acesso do catálogo (CTEs `user_role` + `user_model_permissions`) está **duplicado verbatim** entre `CATALOGO_SELECT` e `CATALOGO_COUNT`, mudando só o placeholder do `userId` (`$4` no select, `$2` no count). Nunca foi extraído para uma função SQL. Os dois rodam em `Promise.all` justamente para que `total` não minta sobre o que o usuário pode ver (`backend/src/modules/nomes/nomes.service.js:20-23`); ao editar o filtro, edite **os dois**, ou a contagem passa a divergir da listagem (`backend/src/modules/nomes/nomes.queries.js:83-87`, `:119`).

Metadados e distribuição dos assets estão fora daqui: ver [[catalogo-3d]] e [[assets3d-distribuicao]]. `/api/v1/assets3d` serve o binário sem auth (imutável, Range/ETag) e a descoberta é que fica gated pelo catálogo autenticado (`backend/src/app.js:93-95`); ver [[sintese-cache-http-imutavel]].

## Log sem valores, por decisão

Todas as três rotas passam por `nomesAccessLog`, que loga `userId`, `ip`, `path` e apenas as **chaves** da query string, nunca os valores (`backend/src/middleware/nomes-access-log.js:12-19`). Num gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem parar num agregador de logs. Auditoria a nível de valor, se um dia for exigida, é assunto da trilha de auditoria: ver [[auditoria]].

## O passo pós-carga que ninguém pode esquecer

A carga é externa (FME), fora da API. Depois de **cada** carga de nomes é obrigatório rodar:

```sql
SELECT ng.refresh_busca();
```

**Nenhum trigger calcula `cluster_id`**: `refresh_busca` é a única fonte desse campo (`backend/src/database/migrations/004_ng.sql:154-169`, via `ng.recomputar_clusters()` com `ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)` particionado por `nome, tipo`). Esquecer o passo não gera erro: degrada em silêncio. Ver [[deploy-backend]].

> **Nota histórica.** O guia *13-nomes-geograficos* (absorvido):452-454 diz que pular `ng.refresh_busca()` produz "duplicatas no resultado"; o efeito real do código é o **oposto**. A dedup é `SELECT DISTINCT ON (nome, tipo, cluster_id)` (`backend/src/modules/nomes/nomes.queries.js:31`), e `DISTINCT ON` no PostgreSQL trata NULLs como iguais. Com `cluster_id` NULL em toda a tabela, todas as ocorrências de um mesmo `nome`+`tipo` colapsam em **uma única linha** (a mais próxima), inclusive homônimos legítimos a centenas de quilômetros de distância, que somem do resultado. O sintoma é resultado faltando, não duplicado.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] A migração justificava o `UPDATE tipo = tipo` de `ng.refresh_busca()` dizendo que "COPY bypasses BEFORE INSERT triggers". **Medido contra o PostgreSQL desta instalação: COPY DISPARA o trigger BEFORE INSERT de linha** (com INSERT de controle provando que o trigger existia). O que COPY não dispara são RULES. O comentário foi corrigido: o re-fire é defensivo/idempotente e o passo continua obrigatório pelos CLUSTERS, que nada mais recomputa. A migração é forward-only — só o comentário mudou.

## Fontes

- guias *13-nomes-geograficos* e *15-acesso-geografico* (absorvidos): escopo read-only, contratos congelados, semântica de `z_distance`/`xy_distance` e raio de 3 m, passo `refresh_busca()`, modelo de acesso por zona-polígono e garantia de que `total` conta só o visível.
- `backend/src/modules/nomes/*`, `backend/src/database/migrations/004_ng.sql`, `backend/src/middleware/nomes-access-log.js`, `backend/tests/integration/nomes.test.js`.
- `frontend/src/js/search/{gazetteer-url,search-bar.search-providers,feature-search.control}.js`: derivação da URL e o fato de o cliente chamar sem token e sem `zoom`.
