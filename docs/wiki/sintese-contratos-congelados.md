# Síntese: contratos congelados e envelopes divergentes

Quadro comparativo dos formatos de resposta do backend, `{ data }` padrão, array nu em `/nomes/busca`, envelope `{ total, page, nr_records, data }` no catálogo 3D, objetos nus com erro plano `{ error }` no sv360, e dos shapes que não podem mudar sem quebrar clientes.

## Por que existem envelopes divergentes

Nenhuma das divergências é acidente de estilo. Três módulos (gazetteer, catálogo 3D, sv360) foram **portados de serviços que já existiam** com clientes em produção: o campo de busca do mapa, a galeria 3D e o viewer Three.js. Congelar o shape foi mais barato que reescrever os consumidores, então o backend carrega hoje quatro formatos de resposta simultâneos. O corolário prático: **o envelope é propriedade da rota, não da API**. Um cliente HTTP genérico que assume `{ data }` em tudo vai silenciosamente quebrar em pelo menos três lugares (e já quebra em um, ver §Armadilhas).

## Quadro comparativo

| Superfície | Sucesso | Erro | Auth |
|---|---|---|---|
| REST padrão (atlas, zones, users, config admin) | `{ "data": ... }` | `{ "error": { "code", "message" } }` | estrita |
| `GET /nomes/busca` | **array nu**, máx. 5 itens | envelope padrão (`422`) | **opcional** (anônimo, só público) |
| `GET /nomes/feicoes` | **objeto nu** (`{id,...}` ou `{ message }`, ambos `200`) | envelope padrão | estrita |
| `GET /nomes/catalogo3d` | **`{ total, page, nr_records, data }`** | envelope padrão | estrita |
| `GET /assets3d/*` | binário + ETag/304/206/416 | sem corpo JSON | pública |
| Todo o `/sv360/**` | **objeto/array nu** | **`{ "error": "mensagem" }` plano** | opcional na leitura, estrita na escrita |
| `GET /api/config` (e alias `/api/v1/config`) | **objeto nu** (sem `data`) | envelope padrão | pública |

O backend deixa isso explícito no próprio código: `nomes.controller.js:2-3` e `:7`/`:18` marcam os dois contratos congelados e proíbem o wrap; `sv360-error.js:19-36` monta o envelope plano (`res.status(status).json({ error: message })`) em vez do global.

Detalhe de cada superfície em [[gazetteer-nomes-geograficos]], [[catalogo-3d]], [[assets3d-distribuicao]], [[streetview-360]]. O envelope de erro canônico está em [[erros-api]] e [[sintese-contrato-erros-http]].

## Como o cliente lida com isso hoje

`ApiClient._unwrap` (`src/js/store/sync/api-client.js:260-265`) resolve o caso geral com uma heurística de três guardas:

```js
if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed) return parsed.data;
return parsed;
```

Consequências que importam:

- **Array nu passa direto** (guarda `!Array.isArray`), então `/nomes/busca` e `/sv360/projects` sobrevivem.
- **Objeto nu sem `data` passa direto**, então `/api/config` e o metadado de foto sobrevivem.
- **`/nomes/catalogo3d` seria destruído** se passasse por aqui: o envelope tem `data`, logo `_unwrap` devolveria só o array e jogaria fora `total`/`page`/`nr_records`. Na prática o frontend não chama essa rota pelo `ApiClient` (ver §Divergências), mas quem for chamar precisa de um caminho que **não** passe pelo unwrap.

O gazetteer não usa o `ApiClient`: `gazetteer-url.js:24-26` deriva a URL da mesma base (`resolveBackendBaseUrl()`, `runtime-config.js:22-24`) e os dois call sites fazem `fetch` cru, validando o array explicitamente (`search-bar.search-providers.js:287-288` e `feature-search.control.js:185-186`, ambos com `Array.isArray(data) ? ... : []`). Isso está correto e é o padrão a copiar para contratos nus.

## Shapes que não podem mudar

**`/nomes/busca`**: os campos `{tipo, nome, municipio, estado, longitude, latitude}` mais `score` auxiliar. Os 7 pesos do ranking somam 1.00 e são fixos, mexer neles reordena a lista que o usuário já conhece ([[ranking-busca-toponimos]]).

**`/nomes/feicoes`**: "não achou" é `200` com `{ message }`, **não** `404` nem array vazio. O cliente distingue por presença de `id`.

**`/nomes/catalogo3d`**: `total` conta **apenas o visível** pelo mesmo predicado de acesso do `data`, então a paginação nunca vaza a existência de modelos ocultos ([[zonas-acesso-geografico]]).

**Metadado de foto 360** (`GET /sv360/photos/:uuid`): campos de `camera` são **planos** (nunca aninhar em `position`/`orientation`), nomes exatos `mesh_rotation_y/x/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`. Em `targets`, a **leitura** usa `bearing`/`distance`, mas a **escrita** de criação de link usa os nomes internos `bearing_deg`/`distance_m`. Essa assimetria é intencional e é a fonte de bug mais provável de quem escreve o editor de grafo ([[calibracao-e-grafo-360]]).

**Cache de binários**: ETag `"{uuid}-{quality}-{sizeBytes}"` no sv360, `"{size}-{mtimeMs}"` nos assets 3D, com `immutable` + 304/206/416. Consumido pelo Cesium e pelo viewer, ver [[sintese-cache-http-imutavel]].

**Caminhos relativos**: `url`/`thumbnail` do catálogo 3D e `previewThumbnail` do metadado 360 vêm **sem prefixo**, resolvidos contra `assets3dBaseUrl` e `streetView360.serviceUrl` do `/api/config` ([[config-runtime-urls-relativas]], [[config-dinamico]]). Hardcodar `/api/v1/assets3d` quebra o deploy em qualquer ambiente com host de estáticos separado.

**Predicado de acesso no SQL**: os três endpoints do gazetteer embutem a autorização no `WHERE`, defesa em profundidade. O cliente **não** deve filtrar nada nem assumir que recebe privados para esconder ([[zonas-acesso-geografico]], [[sintese-eixos-de-permissao]]).

## Divergências verificadas contra o código

> [!CONTRADICAO 2026-07-18] O guia 14 (§2, §5) descreve a descoberta 3D como `GET /nomes/catalogo3d` mais `assets3dBaseUrl + m.url`. Nenhum arquivo de `src/` chama `/nomes/catalogo3d` ou lê `assets3dBaseUrl`. O ebgeo_web descobre modelos 3D por `config.tilesets`, populado pelo `/api/config` a partir do catálogo de resources: `src/js/3d_models_viewer_tool/map_3d.js:872-880` faz `config.tilesets.find(t => t.id === tilesetId)` e decide o loader por `tilesetConfig.type === 'glb'`; `add_3d_models_viewer_control.js:277-291` posiciona por `tileset.locate.{lon,lat}`. O shape é **outro**: `{ id, name, type: 'glb'|…, locate: { lon, lat, height }, data_captura, previewVideo, previewThumbnail }`, e não o `{ type: 'Tiles 3D', lon, lat, height, heightoffset, maximumscreenspaceerror, style }` do catálogo. São dois contratos 3D vivos ao mesmo tempo, não um.

> [!CONTRADICAO 2026-07-18] O guia 16 (checklist) manda tratar erros do sv360 como plano `{error:"msg"}` e o módulo como caso à parte do cliente HTTP. Três rotas admin do 360 passam pelo cliente genérico (`api-client.js:516`, `:526`, `:535`), cujo parser de erro faz `parsed.error?.message` (`api-client.js:235-239`). Com o envelope plano, `parsed.error` é uma **string**, `.message` é `undefined`, e o erro vira `HTTP 403` com `code` `undefined`. O `showError(err?.message || …)` em `admin/catalog-tab.js:466`, `:534` e `:549` exibe "HTTP 404" no lugar de "Project not found".

> [!CONTRADICAO 2026-07-18] O guia 16 (§4) diz que o id da foto é **UUID v5**. `street_view_tool/streetview-api.service.js:20` usa uma regex de **UUID v4** (`4[0-9a-f]{3}` no nibble de versão). Logo `isUUID()` retorna `false` para ids v5 reais: `getPhotoDisplayName` (`:127`) desiste sem consultar a API e devolve o UUID cru como nome exibido, e `resolveToUUID` (`:109`) cairia no fallback `/photos/by-name/<uuid>`.

**Armadilha, `zoom` nunca é enviado.** O guia 13 recomenda mandar `zoom` para calibrar o decaimento por distância. Nenhum dos dois call sites manda: `search-bar.search-providers.js:279` e `feature-search.control.js:182` montam a query só com `q`, `lat`, `lon`. Efeito: o backend usa o raio padrão de 50 km e **desliga** o ajuste por tipo, então em zoom alto a busca não prioriza o que está perto. Não é bug de contrato, é qualidade de resultado deixada na mesa.

**Nota de robustez, não de erro.** `normalizeProjects` (`streetview-api.service.js:155-157`) aceita tanto o array nu quanto um legado `{ projects: [...] }`. Defensivo e barato, mas só o array nu é o contrato as-built.

## Regras operacionais

1. **Nunca** passe uma rota de contrato congelado pelo unwrap genérico sem verificar o guard. `catalogo3d` é o caso que perde dados em silêncio.
2. Para o `sv360`, use um caminho de cliente próprio que leia `parsed.error` como string. Não tente unificar com [[erros-api]].
3. Ao consumir array nu, valide com `Array.isArray` e degrade para `[]`. Os dois call sites do gazetteer já fazem isso, copie o padrão.
4. Trate `200 + { message }` como "vazio" no `/nomes/feicoes`, não como sucesso com dados.
5. Concatene sempre com a base vinda do `/api/config`, nunca hardcode prefixo de asset.
6. Esses módulos estão **fora** do sync do atlas: sem `version`, sem snapshot, sem broadcast WS. Depois de calibrar uma foto ou ingerir um bundle, **recarregue** em vez de esperar evento ([[sintese-modulos-fora-do-sync]], [[ingestao-projetos-360]], [[sintese-rest-vs-sync]], [[envelope-operacao]]).
7. A visibilidade depende de quem está logado ([[autenticacao-jwt]], [[auth-flexivel]]). Trocar de conta invalida resultados de busca/catálogo, e não há push de invalidação: refaça as consultas.
8. `/nomes/busca` e `/assets3d/*` e a leitura do sv360 são alcançáveis anonimamente. Ao endurecer a borda, lembre que essas rotas **precisam** do caminho anônimo ([[hardening-borda-api]]). Rotas de atlas seguem o padrão em [[api-rest-atlas]].

## Fontes

- guia *13-nomes-geograficos* (absorvido): array nu do `/busca`, os 7 pesos do ranking, contrato `200 + { message }` do `/feicoes`, envelope `{ total, page, nr_records, data }` do catálogo, política de auth por rota.
- guia *14-catalogo3d-assets* (absorvido): campos do item de catálogo, resolução relativa contra `assets3dBaseUrl`, contrato de cache/Range/ETag do `/assets3d/*`, round-trip verbatim de `style`.
- guia *15-acesso-geografico* (absorvido): predicado de acesso embutido no SQL, garantia de que `total` só conta o visível, replace-set de permissões de zona.
- guia *16-streetview-360* (absorvido): envelope nu + erro plano, shape congelado do metadado de foto, assimetria `bearing`/`bearing_deg`, ETag `{uuid}-{quality}-{size}`, escada 404→403 na escrita.
- Código (manda sobre a prosa): `src/js/store/sync/api-client.js` (unwrap e parser de erro), `src/js/search/gazetteer-url.js` + `search-bar.search-providers.js` + `feature-search.control.js` (consumo do array nu, ausência de `zoom`), `src/js/street_view_tool/streetview-api.service.js` (regex v4, normalizeProjects), `src/js/3d_models_viewer_tool/{map_3d.js,add_3d_models_viewer_control.js}` (descoberta 3D real via `config.tilesets`), `src/js/admin/catalog-tab.js` (perda da mensagem de erro do sv360), e no backend `src/modules/nomes/{nomes.controller.js,nomes.routes.js}`, `src/modules/streetview360/sv360-error.js`, `src/app.js:90-91`.
