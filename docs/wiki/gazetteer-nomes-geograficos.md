# Gazetteer de Nomes Geográficos (schema ng)

Subsistema read-only do backend, sobre PostGIS no schema isolado `ng`, que entrega busca de topônimos, identify de edificação 3D e catálogo 3D, alimentado por carga externa (FME) e sem qualquer rota de escrita.

## O que é (e o que não é)

Três rotas de leitura, montadas em `/api/v1/nomes` (`src/app.js:107`):

| Rota | Auth | Contrato de resposta |
|------|------|----------------------|
| `GET /api/v1/nomes/busca` | anônima (sem `auth` estrito) | **array nu** de até 5 itens |
| `GET /api/v1/nomes/feicoes` | `auth` estrito (401 sem token) | objeto do prédio **ou** `{ message }`, sempre 200 |
| `GET /api/v1/nomes/catalogo3d` | `auth` estrito | envelope próprio `{ total, page, nr_records, data }` |

O que este módulo **não** tem, e é o ponto de decisão arquitetural: nenhuma rota de escrita, nenhum `version`, nenhuma operação, nenhum broadcast. Ele não participa do pipeline de sync do atlas (ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]]). O dado entra por job FME direto no banco; a API só lê. Quem procurar aqui um caminho de edição de topônimo não vai achar, e isso é por projeto.

Os dois contratos "estranhos" (array nu em `/busca`, envelope próprio em `/catalogo3d`) são **congelados** e explicitamente marcados como tal no código (`src/modules/nomes/nomes.controller.js:2-3`, `:7`, `:18`). Não envolva em `{ data }` para "padronizar": quebra o frontend. Ver [[sintese-contratos-congelados]] e, para o envelope padrão do resto da API, [[erros-api]] e [[api-rest-atlas]].

## Autenticação assimétrica (a armadilha nº 1)

`/busca` **não** usa o middleware `auth`; `/feicoes` e `/catalogo3d` usam (`src/modules/nomes/nomes.routes.js:15-17`). O `flexibleAuth` global popula `req.user` quando há credencial, e o controller passa `req.user?.id` adiante (`nomes.controller.js:9`); sem credencial vai `null`, e o filtro embutido no SQL devolve só o público. Ver [[auth-flexivel]] e [[autenticacao-jwt]].

Consequência prática que morde: no cliente web, os dois call sites de busca fazem `fetch` **sem header `Authorization`** (`src/js/search/search-bar.search-providers.js:281` e `src/js/search/feature-search.control.js:182`). Ou seja, mesmo com o usuário logado, a busca de topônimos hoje roda anônima e enxerga apenas `access_level = 'public'`. Se alguém reclamar que "não acho o nome privado da minha zona", a causa é essa, não o SQL.

A URL não é mais configurável: é derivada da base da API em `src/js/search/gazetteer-url.js:24-26`, exatamente para funcionar em dev (proxy `/api` do Vite), produção (mesma origem) e E2E. O antigo `SEARCH_API_URL` apontava para um serviço que nunca existiu e falhava em silêncio (`gazetteer-url.js:6-16`). Ver [[config-runtime-urls-relativas]].

## Busca de topônimos

Validação Joi em `src/modules/nomes/nomes.schemas.js:7-12`: `q` (3 a 200, obrigatório), `lat` (-90..90, obrigatório), `lon` (-180..180, obrigatório), `zoom` (int 1..20, opcional). Os limites de lat/lon existem porque a query faz cast para `::geography`, e o PostGIS estouraria 500 com coordenada fora de faixa; a borda converte isso em 422 (`nomes.schemas.js:4-6`). Ver [[sintese-contrato-erros-http]].

O ranking é uma soma ponderada de 7 critérios com pesos somando 1.00, portada verbatim do serviço de origem e congelada (`src/modules/nomes/nomes.queries.js:2-3`, `:38-51`). Detalhe critério a critério em [[ranking-busca-toponimos]].

Dois pontos do pipeline que costumam surpreender:

- **Corte antes do score.** A CTE `candidatos` pré-filtra por `similarity(...) > 0.25` e corta em `LIMIT 500` ordenado por `sim DESC, dist ASC` (`nomes.queries.js:21`, `:27-28`). O score final de 7 critérios é aplicado **depois** desse corte. Um nome pertinho do usuário, mas com similaridade textual medíocre, pode nunca chegar ao score se houver 500 candidatos textualmente melhores.
- **Decaimento por zoom.** Raio de relevância `50000 * 2^(10 - zoom)` metros e `zoom_factor` que neutraliza o peso por tipo em zoom alto (`nomes.queries.js:12-13`). Sem `zoom`, o backend cai em 50 km e `zoom_factor = 0` (peso por tipo em força total). Note que **nenhum dos dois call sites do web envia `zoom`** (só `q`, `lat`, `lon`), então na prática o app opera hoje no modo padrão de 50 km.

## Identify de edificação 3D

`GET /nomes/feicoes?lat&lon&z`. Busca a edificação dentro de **3 metros** do clique (`ST_DWithin` em `geography`), calcula `z_distance` (0 se `z` está entre `altitude_base` e `altitude_topo`, senão a distância vertical até a faixa) e ordena por `z_distance ASC, xy_distance ASC` com `LIMIT 1` (`nomes.queries.js:57-75`). É o desempate de prédios empilhados.

Contrato congelado: quando não acha nada, o controller responde **200** com `{ message: 'Nenhuma edificação encontrada nas proximidades.' }`, não 404 e não array (`nomes.controller.js:13-16`, com `rows[0] ?? null` em `nomes.service.js:13`). O cliente tem que distinguir `id` de `message` dentro do mesmo 200.

**Armadilha de SRID:** `ng.nomes_geograficos` é `POINT, 4674` (SIRGAS 2000) e `ng.edificacoes` é `POLYGON, 4326` (`src/database/migrations/004_ng.sql:37`, `:62`), diferença deliberada e coberta por teste (`tests/integration/nomes.test.js:62-67`). Por isso `/busca` constrói o ponto em 4674 e `/feicoes` em 4326, e o filtro de zona de `/feicoes` precisa de `ST_Transform(uz.geom, 4326)` porque as zonas são 4674 (`nomes.queries.js:64`, `:71`). Ao mexer em qualquer query aqui, confira o SRID antes de copiar-colar de uma para a outra.

Nenhum código do frontend web consome hoje `/feicoes` nem `/catalogo3d` (busca por `nomes/feicoes` e `catalogo3d` em `src/` não retorna nada). São capacidades servidas para outros consumidores 3D.

## Catálogo 3D

Full-text em português sobre `search_vector` (`plainto_tsquery('portuguese', q)`), paginação **1-based**, `nr_records` de 1 a 100 com default 10 e `page` default 1 (`nomes.schemas.js:20-24`; offset calculado em `nomes.service.js:17`). Com `q` ausente/vazio, o serviço passa `null` e a query lista tudo com `rank = 0`, caindo efetivamente em `data_criacao DESC` (`nomes.queries.js:106-115`).

`SELECT` e `COUNT` rodam em `Promise.all` (`nomes.service.js:20-23`), cada um com o **mesmo predicado de acesso**, para que `total` não minta sobre o que o usuário pode ver. E aqui está a armadilha mais cara do módulo, documentada no próprio arquivo: o predicado (CTEs `user_role` + `user_model_permissions`) está **duplicado verbatim** entre `CATALOGO_SELECT` e `CATALOGO_COUNT`, mudando só o placeholder do `userId` (`$4` no select, `$2` no count). Nunca foi extraído para uma função SQL. Ao editar o filtro, edite **os dois**, ou a contagem passa a divergir da listagem (`nomes.queries.js:83-87`, `:119`).

Metadados e distribuição dos assets em si estão fora daqui: ver [[catalogo-3d]] e [[assets3d-distribuicao]]. A rota `/api/v1/assets3d` serve o binário sem auth (imutável, Range/ETag) e a descoberta é que fica gated pelo catálogo autenticado (`src/app.js:93-95`); ver [[sintese-cache-http-imutavel]].

## Controle de acesso embutido no SQL

As três rotas embutem a autorização no `WHERE`, não numa camada de aplicação: linha privada não chega ao Node para ser filtrada. É defesa em profundidade, e o motivo de o filtro estar replicado em cada query. Ver [[zonas-acesso-geografico]], [[sintese-eixos-de-permissao]] e [[hardening-borda-api]].

Ramos de acesso, por tabela:

- `ng.nomes_geograficos` e `ng.edificacoes`: `access_level = 'public'` **OU** (`userId` não nulo **E** (admin **OU** geometria contida numa zona do usuário via `ng.fn_user_zone_geoms`)) (`nomes.queries.js:22-26`, `:67-72`).
- `ng.catalogo_3d`: `public` **OU** (`userId` não nulo **E** (admin **OU** permissão direta/por grupo sobre o modelo)). **Não há ramo espacial de zona no catálogo 3D**, apenas permissão linha a linha; o comentário em `nomes.queries.js:79-81` deixa o gancho para adicioná-lo sem reescrever a query.

Dois detalhes que valem o byte:

- **Admin é reconferido no banco**, com `EXISTS (SELECT 1 FROM users WHERE id = $N AND role = 'admin')` (`nomes.queries.js:24`, `:69`, `:90`, `:122`), e não pela claim do JWT. Um token antigo com `role` desatualizado não vira acesso indevido aqui. Ver [[permissoes-atlas]].
- **`fn_user_zone_geoms(NULL)` devolve vazio por construção** (`004_ng.sql:246-256`), então o caminho anônimo degrada para "só público" mesmo se alguém remover o guard `$N::uuid IS NOT NULL` da aplicação.

Não há push de invalidação: trocou de usuário ou mudou permissão de zona, refaça as consultas.

## Observabilidade e log

Todas as três rotas passam por `nomesAccessLog` (`nomes.routes.js:15-17`). O middleware loga `userId`, `ip`, `path` e apenas as **chaves** da query string, nunca os valores (`src/middleware/nomes-access-log.js:12-19`): num gazetteer militar, o termo buscado e a coordenada clicada são sensíveis e não devem parar num agregador de logs. Auditoria a nível de valor, se um dia for exigida, é assunto da trilha de auditoria (ver [[auditoria]]).

## Carga de dados e o passo obrigatório pós-carga

A carga é externa (FME), fora da API. Depois de **cada** carga de nomes é obrigatório rodar:

```sql
SELECT ng.refresh_busca();
```

A função faz `UPDATE ng.nomes_geograficos SET tipo = tipo` (re-dispara o trigger de `tipo_peso`) e chama `ng.recomputar_clusters()`, que é um `ST_ClusterDBSCAN(geom, eps := 0.045, minpoints := 1)` particionado por `nome, tipo` (`004_ng.sql:154-169`). **Nenhum trigger calcula `cluster_id`**: `refresh_busca` é a única fonte desse campo. Esquecer o passo não gera erro, degrada em silêncio. Ver [[deploy-backend]].

> **Nota histórica.** guia *13-nomes-geograficos* (absorvido):452-454` diz que pular `ng.refresh_busca()` produz "duplicatas no resultado"; o efeito real do código é o oposto. A dedup é `SELECT DISTINCT ON (nome, tipo, cluster_id)` (`src/modules/nomes/nomes.queries.js:31`), e `DISTINCT ON` no PostgreSQL trata NULLs como iguais. Com `cluster_id` NULL em toda a tabela, todas as ocorrências de um mesmo `nome`+`tipo` colapsam em **uma única linha** (a mais próxima), inclusive homônimos legítimos a centenas de quilômetros de distância, que somem do resultado. O sintoma é sub-dedup invertida (resultados faltando), não duplicatas.

> [!CONTRADICAO 2026-07-18] `src/database/migrations/004_ng.sql:163-164` justifica o `UPDATE tipo = tipo` afirmando que "COPY bypasses BEFORE INSERT triggers"; no PostgreSQL, `COPY` **dispara** triggers de linha `BEFORE INSERT` (só regras e triggers de statement ficam de fora), e além disso `tipo_peso` tem `DEFAULT 0.1` (`004_ng.sql:36`) e a query usa `COALESCE(d.tipo_peso, 0.1)` (`nomes.queries.js:46`). A metade `tipo_peso` do racional é frágil; a metade `cluster_id` é incondicionalmente verdadeira e sozinha já torna `refresh_busca()` obrigatório. Não remova a chamada com base na primeira metade.

## Checklist para não errar

- Tratar `/busca` como array nu; nada de `{ data }`.
- Tratar `/feicoes` como 200 sempre: checar `id` vs `message`.
- `page` é 1-based; usar `total` + `nr_records` para paginar.
- Ao tocar no filtro de acesso do catálogo 3D, alterar `CATALOGO_SELECT` **e** `CATALOGO_COUNT`.
- Não alterar os pesos do ranking sem regressão contra dados reais (contrato congelado).
- Conferir SRID (4674 para nomes/zonas, 4326 para edificações) antes de copiar query entre rotas.
- Rodar `SELECT ng.refresh_busca()` depois de cada carga FME.
- Não filtrar registros privados no cliente: eles não chegam.


## Contrato de request/response de `/nomes/feicoes`

## Contrato de request/response de `/nomes/feicoes`

`GET /api/v1/nomes/feicoes` — `Authorization: Bearer <accessToken>` obrigatório.

### Query params

| Param | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `lat` | number | sim | Latitude do clique. |
| `lon` | number | sim | Longitude do clique. |
| `z` | number | sim | Altitude do clique, usada para desempatar prédios sobrepostos. |

```
GET /api/v1/nomes/feicoes?lat=-22.9068&lon=-43.1729&z=15
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Response 200 — edificação encontrada

Campos exatos devolvidos (objeto nu, sem envelope `{ data }`):

```json
{
  "id": "a3f1c8e0-1234-4abc-9def-0123456789ab",
  "nome": "Edifício Central",
  "municipio": "Rio de Janeiro",
  "estado": "RJ",
  "tipo": "edificacao",
  "altitude_base": 0,
  "altitude_topo": 42,
  "z_distance": 0,
  "xy_distance": 1.27
}
```

| Campo | Descrição |
|-------|-----------|
| `z_distance` | `0` se `z` está dentro de `[altitude_base, altitude_topo]`; senão a distância vertical até a faixa. Chave primária de desempate. |
| `xy_distance` | Distância horizontal em metros do clique à geometria, sempre ≤ 3 m (raio do `ST_DWithin`). Desempate secundário. |

### Response 200 — nada encontrado (contrato congelado)

```json
{ "message": "Nenhuma edificação encontrada nas proximidades." }
```

Não é `404`, não é array vazio. O cliente distingue os dois casos pela presença de `id`.

### Erros

| Código | Quando | Corpo |
|--------|--------|-------|
| `401` | Sem token / token inválido (rota usa `auth` estrito). | envelope de erro padrão |
| `422` | `lat`, `lon` ou `z` ausentes/não numéricos (ou `lat`/`lon` fora de ±90/±180). | `{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [...] } }` |

```javascript
async function feicaoNoClique(lat, lon, z) {
  const params = new URLSearchParams({ lat, lon, z });
  const res = await fetch(`/api/v1/nomes/feicoes?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('feicoes falhou');

  const result = await res.json();
  if (result.message) return null;   // nada encontrado (200 com { message })
  return result;                     // { id, nome, ..., z_distance, xy_distance }
}
```

## Fontes

- guia *13-nomes-geograficos* (absorvido): escopo read-only do gazetteer, as três rotas e seus contratos congelados, tabela de pesos do ranking, semântica de `z_distance`/`xy_distance` e raio de 3 m, envelope do catálogo 3D, passo obrigatório `refresh_busca()`.
- guia *15-acesso-geografico* (absorvido): modelo de acesso por zona-polígono, ordem dos ramos (admin, permissão direta de modelo, `ST_Contains` de zona), efeito por endpoint e a garantia de que `total` conta só o visível.
- `ebgeo_backend/src/modules/nomes/*` (routes, schemas, controller, service, queries): auth assimétrica, limites Joi de lat/lon, corte `LIMIT 500` antes do score, SRIDs, duplicação do predicado select/count.
- `ebgeo_backend/src/database/migrations/004_ng.sql`: DDL do schema `ng`, triggers de `tipo_peso` e `search_vector`, DBSCAN, `fn_user_zone_geoms`, tabelas de zona e de permissão de modelo.
- `ebgeo_backend/src/middleware/nomes-access-log.js` e `src/app.js`: log estruturado sem valores e montagem das rotas.
- `ebgeo_web/src/js/search/gazetteer-url.js`, `search-bar.search-providers.js`, `feature-search.control.js`: derivação da URL a partir da base da API e o fato de o cliente chamar sem token e sem `zoom`.
- `ebgeo_backend/tests/integration/nomes.test.js`: confirmação dos SRIDs, do array nu, do acesso anônimo e da dedup por cluster.
