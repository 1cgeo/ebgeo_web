# Catálogo 3D (descoberta de modelos)

`GET /api/v1/nomes/catalogo3d` é a fonte única de descoberta dos modelos 3D, metadados, posicionamento/orientação Cesium, `style` (Cesium3DTileStyle) e a URL relativa do binário, com full-text em português, paginação 1-based e envelope próprio `{ total, page, nr_records, data }`.

## O que é (e o que não é)

O catálogo vive na tabela `ng.catalogo_3d` (schema PostGIS isolado `ng`, criado em `backend/src/database/migrations/004_ng.sql:76-102`), junto com o gazetteer de topônimos e edificações ([[gazetteer-nomes-geograficos]]). É um módulo **read-only**: não existe rota de escrita, a carga é externa (job FME / CLI). Portanto:

- **Fora do sync.** Sem CRDT, sem WebSocket, sem `version`, sem snapshot, sem broadcast ([[sintese-modulos-fora-do-sync]]). Nada aqui entra na fila de operações do atlas.
- **Descoberta ≠ distribuição.** Esta rota devolve apenas metadados e o caminho **relativo** do binário. O download do `tileset.json`/`.b3dm`/`.glb`/`.pnts` é outra rota, pública, com ETag/Range/`immutable` ([[assets3d-distribuicao]], [[sintese-cache-http-imutavel]]).
- **Autenticada, estrita.** `router.get('/catalogo3d', auth, nomesAccessLog, validate(...), ctrl.catalogo3d)` em `backend/src/modules/nomes/nomes.routes.js:17`. Sem token é `401` (ao contrário de `/nomes/busca`, que aceita o caminho anônimo, `nomes.routes.js:15`). Ver [[autenticacao-jwt]].

## Contrato de request

Validação Joi na borda (`nomes.schemas.js:20-24`):

| Param | Tipo | Default | Nota |
|---|---|---|---|
| `q` | string ≤ 200, `''` permitido | ausente | full-text `plainto_tsquery('portuguese', q)` |
| `page` | int ≥ 1 | `1` | **1-based** |
| `nr_records` | int 1–100 | `10` | itens por página |

Fora desses limites, `422` (envelope de erro padrão, [[erros-api]] / [[sintese-contrato-erros-http]]).

Armadilha: o schema aceita `q=''`, e o service faz `const qv = q || null` (`nomes.service.js:18`), então string vazia **lista tudo** em vez de buscar por vazio. Um campo de busca que dispara a cada tecla não precisa tratar o caso "limpou o campo" de forma especial.

## Contrato de response (congelado)

```json
{ "total": 23, "page": 1, "nr_records": 10, "data": [ /* ... */ ] }
```

Envelope **próprio**, não o `{ data }` padrão da API. O controller devolve o objeto do service sem embrulhar, e o comentário no topo do arquivo é explícito sobre isso (`nomes.controller.js:2-3,18-21`). Ver [[sintese-contratos-congelados]].

Cada item de `data[]` (colunas selecionadas em `nomes.queries.js:102-108`): `id`, `name`, `description`, `thumbnail`, `url`, `lon`, `lat`, `height`, `heading`, `pitch`, `roll`, `type`, `heightoffset`, `maximumscreenspaceerror`, `data_criacao`, `municipio`, `estado`, `palavras_chave`, `style`, `rank`.

Campos que decidem a cena:

| Campo | Uso |
|---|---|
| `type` | `'Tiles 3D'` \| `'Modelos 3D'` \| `'Nuvem de Pontos'`, escolhe o loader do Cesium. Valores garantidos pelo CHECK da coluna (`004_ng.sql:91`) |
| `url` | caminho **relativo** do binário, resolver contra `assets3dBaseUrl` |
| `lon`/`lat`/`height` + `heightoffset` | origem e ajuste vertical |
| `heading`/`pitch`/`roll` | orientação em graus |
| `maximumscreenspaceerror` | LOD do tileset |
| `style` | JSONB verbatim, vira `new Cesium3DTileStyle(style)`. Pode ser `null` |
| `rank` | `ts_rank` do full-text, **sempre `0` quando não há `q`** (o `CASE` em `nomes.queries.js:106-108`) |

## Ordenação e paginação

`ORDER BY rank DESC, c.data_criacao DESC LIMIT $2 OFFSET $3` (`nomes.queries.js:115-116`). Sem `q`, `rank` é a constante `0` e a ordenação degrada para `data_criacao DESC`, ou seja, o mais recente primeiro. O offset é `(page - 1) * nr_records` (`nomes.service.js:17`): mandar `page=0` é `422`, e uma página além do fim devolve `data: []` com `total` intacto.

Para o front: número de páginas é `Math.ceil(total / nr_records)`. Se a sua UI é 0-based, some 1 antes de enviar, esse é o erro clássico (a página 0 nem chega ao SQL, morre no Joi).

## Filtro de acesso embutido no SQL

O predicado de acesso é parte da query, não da camada de aplicação (defesa em profundidade, o dado privado não vaza nem com bug de controller). Um modelo com `access_level = 'private'` só aparece para:

1. **admin global** (`users.role = 'admin'`), ou
2. quem tem **permissão direta** (`ng.model_permissions`) ou **por grupo** (`ng.model_group_permissions` + `ng.user_groups`) sobre aquele `model_id`.

Ver `nomes.queries.js:88-113`. Detalhe importante: para o catálogo 3D o critério é **permissão por modelo**, **não** zona geográfica. As zonas (`ng.fn_user_zone_geoms`) valem para `nomes_geograficos` e `edificacoes`, não aqui ([[zonas-acesso-geografico]]). Isso é diferente do eixo de papéis por atlas ([[permissao-vs-papel]]) e do papel global do usuário ([[gestao-usuarios]]).

O `COUNT` roda em paralelo com o `SELECT` (`Promise.all` em `nomes.service.js:20-23`) e **duplica verbatim** o mesmo predicado, só trocando o placeholder do `userId` (`$4` no SELECT, `$2` no COUNT). O comentário em `nomes.queries.js:83-87` avisa: o predicado nunca foi extraído para uma função SQL, então **ao editar o filtro de acesso, edite os dois**, senão `total` passa a mentir sobre o que o usuário vê (paginação com páginas fantasma).

## Resolução da `url` (relativa, sempre)

`url` e `thumbnail` são guardados como strings relativas (ex.: `/aman/tileset.json`) e trafegam **verbatim**, sem prefixo, o que é fixado por teste de contrato (`backend/tests/integration/nomes-catalogo3d-gaps.test.js:173`, "url and thumbnail equal the stored relative strings and are NOT prefixed with /api/v1"). A URL final é `assets3dBaseUrl + url`, e `assets3dBaseUrl` vem do `GET /api/config` (`backend/src/modules/config/config.service.js:186`, alimentado por `ASSETS_3D_BASE_URL`, default `/api/v1/assets3d`, `backend/src/config.js:77`).

Nunca hardcode `/api/v1/assets3d` no cliente: o ponto do campo é permitir apontar para um host de estáticos interno sem rebuild e sem reescrever os dados do catálogo ([[config-runtime-urls-relativas]], [[config-dinamico]]).

> [!CONTRADICAO 2026-07-18] `docs/guias/13-nomes-geograficos.md:358-359` mostra `thumbnail`/`url` como URLs absolutas (`https://.../tileset.json`), sugerindo que o campo pode ser absoluto. O contrato real, testado em `backend/tests/integration/nomes-catalogo3d-gaps.test.js:173`, é o caminho relativo armazenado, devolvido sem prefixo, e `docs/guias/14-catalogo3d-assets.md:134-135` o declara congelado como relativo. Trate como relativo.

## O que o frontend faz hoje

O visualizador 3D do EBGeo Web **não consome esta rota**. `src/js/3d_models_viewer_tool/map_3d.js:872` resolve o modelo com `config.tilesets.find(t => t.id === tilesetId)`, ou seja, a lista de modelos vem de `config.tilesets`, servido pelo `/api/config` a partir da tabela de catálogo `tilesets` (`backend/src/modules/config/config.service.js:133-136`, ver [[resources-catalogo]]). Não há nenhuma referência a `catalogo3d` nem a `assets3dBaseUrl` em `src/`.

> [!CONTRADICAO 2026-07-18] `docs/guias/14-catalogo3d-assets.md:12-15` afirma que `/nomes/catalogo3d` é "a fonte única de descoberta" dos modelos 3D. No código atual do cliente, a descoberta é `config.tilesets` (`src/js/3d_models_viewer_tool/map_3d.js:872`), populada pela tabela `tilesets` do catálogo de resources; `ng.catalogo_3d` é um segundo catálogo, com controle de acesso por modelo, ainda não integrado ao visualizador. São duas fontes distintas, com modelos de permissão distintos, e quem for integrar precisa decidir qual manda.

## Erros e observabilidade

| Código | Quando |
|---|---|
| `401` | sem token / token inválido (rota usa `auth` estrito) |
| `422` | `page` < 1, `nr_records` fora de 1–100, `q` > 200 chars |

Todas as três rotas do gazetteer passam por `nomesAccessLog` (`backend/src/middleware/nomes-access-log.js`), que registra `userId`, `ip`, `path` e apenas as **chaves** da query. Os valores (termo buscado, coordenadas) são deliberadamente omitidos: num gazetteer militar o termo de busca é sensível e não deve chegar a agregadores de log. Auditoria em nível de valor é a `audit_trail` ([[auditoria]]).

## Checklist para não errar

- Ler `assets3dBaseUrl` do `/api/config` no boot e concatenar com `m.url`, nunca hardcodar o prefixo.
- Tratar o envelope `{ total, page, nr_records, data }`, não `{ data }`.
- `page` 1-based; usar `total` + `nr_records` para paginar.
- Escolher o loader pelo `type` (3 valores garantidos pelo CHECK).
- Aplicar `style` só quando não for `null`.
- Não assumir que o `total` é global: ele já reflete o filtro de acesso do usuário.
- Ao mexer no filtro de acesso, alterar `CATALOGO_SELECT` **e** `CATALOGO_COUNT`.
- `404` do binário (asset ausente com catálogo apontando para ele) deve ocultar/logar o modelo, não quebrar a cena.

## Fontes

- `docs/guias/13-nomes-geograficos.md`: contrato do endpoint (params, envelope congelado, semântica de `rank`/`total`), posicionamento do módulo como read-only e fora do sync, resumo do acesso filtrado.
- `docs/guias/14-catalogo3d-assets.md`: separação descoberta/distribuição, resolução de `url` contra `assets3dBaseUrl`, campos usados pela cena Cesium, `style` como `Cesium3DTileStyle`, notas de integração.
- `backend/src/modules/nomes/{nomes.routes.js,nomes.controller.js,nomes.service.js,nomes.queries.js,nomes.schemas.js}`: gate de auth, envelope, offset, SQL de full-text, predicado de acesso duplicado SELECT/COUNT.
- `backend/src/database/migrations/004_ng.sql`: schema de `ng.catalogo_3d`, CHECK de `type` e índices.
- `backend/src/modules/config/config.service.js`, `backend/src/config.js`: origem de `assets3dBaseUrl` e da lista `tilesets`.
- `backend/tests/integration/{nomes-catalogo3d-gaps,catalogo3d-access}.test.js`: paginação sem sobreposição, `url`/`thumbnail` relativos, `style` preservado como objeto, casos negativos de acesso.
- `backend/src/middleware/nomes-access-log.js`: log estrutural sem valores de query.
- `src/js/3d_models_viewer_tool/map_3d.js`: fonte real de modelos no cliente hoje (`config.tilesets`).
