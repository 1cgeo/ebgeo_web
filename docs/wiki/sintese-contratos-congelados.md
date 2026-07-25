# Síntese: contratos congelados e envelopes divergentes

O backend serve quatro formatos de resposta simultâneos, e o envelope é propriedade da rota, não da API. Esta página existe porque essa divergência não está declarada em nenhum arquivo isolado.

## Por que existem envelopes divergentes

Nenhuma divergência é acidente de estilo. Gazetteer, catálogo 3D e sv360 foram portados de serviços que já tinham clientes em produção (campo de busca, galeria 3D, viewer Three.js). Congelar o shape saiu mais barato que reescrever os consumidores. A alternativa rejeitada foi unificar tudo em `{ data }`, o que teria quebrado clientes fora deste repositório.

Corolário: um cliente HTTP genérico que assume `{ data }` em tudo quebra em silêncio.

| Superfície | Sucesso | Erro |
|---|---|---|
| REST padrão (atlas, zones, users, config admin) | `{ data }` | `{ error: { code, message } }` |
| `GET /nomes/busca` | array nu, máx. 5 | envelope padrão |
| `GET /nomes/feicoes` | objeto nu, `200` mesmo sem achar | envelope padrão |
| `GET /nomes/catalogo3d` | `{ total, page, nr_records, data }` | envelope padrão |
| Todo `/sv360/**` | objeto/array nu | **`{ error: "mensagem" }` plano** |
| `GET /api/config` | `{ data }` (envelope padrão) | envelope padrão |

Detalhe por superfície em [[gazetteer-nomes-geograficos]], [[catalogo-3d]], [[assets3d-distribuicao]], [[streetview-360]]; envelope canônico em [[erros-api]] e [[sintese-contrato-erros-http]].

**`GET /api/config` não é contrato nu**, e esta tabela afirmou que era até 2026-07-25. O controller responde `res.json({ data })` (`backend/src/modules/config/config.controller.js:10`) como qualquer rota REST padrão; o que é congelado nele é o SHAPE do objeto de config, não o transporte. A confusão nasce de o `ApiClient` esconder a diferença: `_unwrap` desembrulha e o app nunca vê o envelope. Quem morde é o consumidor que não passa por ele, um health check de deploy ou um `fetch` cru: lê `cfg.basemaps`, recebe `undefined`, e o servidor respondeu 200. O guarda do shape é `frontend/tests/e2e/config-contract.e2e.test.js`, que consulta pelo `ApiClient` e por isso não pega essa ponta.

## A armadilha do unwrap

`ApiClient._unwrap` (`frontend/src/js/store/sync/api-client.js:264-282`) desembrulha qualquer objeto que tenha a chave `data`. Isso salva os contratos nus por acidente feliz (array e objeto sem `data` passam direto), mas **destrói `/nomes/catalogo3d`**: o envelope tem `data`, então o unwrap devolve só o array e joga fora `total`/`page`/`nr_records`, sem erro. Hoje nenhum call site sofre porque o frontend não chama essa rota (ver contradição abaixo), mas quem chamar precisa de um caminho que não passe pelo unwrap.

O gazetteer contorna isso não usando o `ApiClient`: `frontend/src/js/search/gazetteer-url.js` deriva a URL da mesma base e os dois call sites fazem `fetch` cru validando com `Array.isArray(data) ? ... : []` (`frontend/src/js/search/search-bar.search-providers.js:287`, `frontend/src/js/search/feature-search.control.js:185`). Esse é o padrão a copiar para contrato nu.

## Shapes que não podem mudar

- **`/nomes/busca`**: os 7 pesos do ranking somam 1.00. Mexer neles reordena uma lista que o usuário já memorizou ([[ranking-busca-toponimos]]).
- **`/nomes/feicoes`**: "não achou" é `200` com `{ message }`, nunca `404` nem array vazio. O cliente distingue pela presença de `id`.
- **`/nomes/catalogo3d`**: `total` conta apenas o visível, pelo mesmo predicado de acesso do `data`. Trocar por um `COUNT(*)` cru vazaria a existência de modelos ocultos ([[zonas-acesso-geografico]]).
- **Metadado de foto 360**: campos de `camera` são planos, nunca aninhar em `position`/`orientation`. Em `targets`, a **leitura** usa `bearing`/`distance` e a **escrita** usa `bearing_deg`/`distance_m`. Assimetria intencional, e a fonte de bug mais provável de quem escreve o editor de grafo ([[calibracao-e-grafo-360]]).
- **Caminhos relativos**: `url`/`thumbnail` do catálogo 3D e `previewThumbnail` do 360 vêm sem prefixo. Hardcodar `/api/v1/assets3d` quebra qualquer deploy com host de estáticos separado ([[config-runtime-urls-relativas]], [[config-dinamico]]).
- **Predicado de acesso no SQL**: a autorização está no `WHERE`, defesa em profundidade. O cliente não deve filtrar nada nem assumir que recebe privados para esconder ([[sintese-eixos-de-permissao]]).
- **ETag de binários**: ver [[sintese-cache-http-imutavel]].

## Divergências verificadas contra o código

**Dois contratos 3D vivos ao mesmo tempo.** A descoberta documentada é `GET /nomes/catalogo3d` mais `assets3dBaseUrl + m.url`; nenhum arquivo de `frontend/src/` chama essa rota ou lê `assets3dBaseUrl`, embora o backend publique o campo (`backend/src/modules/config/config.service.js:217`). O ebgeo_web descobre modelos por `config.tilesets`, populado pelo `/api/config`: `frontend/src/js/3d_models_viewer_tool/map_3d.js:872-880` faz `config.tilesets.find(t => t.id === tilesetId)` e decide o loader por `type === 'glb'`. O shape é outro (`{ id, name, type, locate: { lon, lat, height }, … }`, não o `{ type: 'Tiles 3D', lon, lat, heightoffset, … }` do catálogo). São dois contratos 3D vivos ao mesmo tempo, não um.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] Três rotas admin do 360 passam pelo cliente genérico (`frontend/src/js/store/sync/api-client.js:516`, `:526`, `:535`), e o parser de erro lia `parsed.error?.message`: com o envelope **plano** do sv360, `parsed.error` é string e `.message` é `undefined`, então `frontend/src/js/admin/catalog-tab.js:466`, `:534` e `:549` exibiam "HTTP 404" no lugar de "Project not found". O parser passou a aceitar os **dois** envelopes (`api-client.js:235-243`), com dois casos em `frontend/tests/integration/api-client.test.js` — um para o envelope plano e um afirmando que o fallback `HTTP <status>` sobrevive para corpo sem erro utilizável. O `code` segue `undefined` no envelope plano, porque o sv360 não emite código.

> [!CONTRADICAO 2026-07-18 — RESOLVIDO 2026-07-24] O id da foto é UUID **v5** (o backend valida com `.guid({ version: ['uuidv5'] })` em três schemas), mas `streetview-api.service.js:20` prendia o nibble de versão em `4`, então `isUUID()` era `false` para todo id real: `getPhotoDisplayName` desistia sem consultar a API e devolvia o UUID cru como nome exibido — o que o editor de briefing (`briefing-editor.control.js:1433`) e a aba de feições 360 (`streetview360-section.component.js:86`) mostravam ao operador. A regex passou a casar a **forma** canônica em qualquer versão, que é o que discrimina UUID de nome de arquivo legado. Controle negativo em `frontend/tests/unit/streetview-photo-id.repro.test.js`: 7/7 com o fix, 3 falham com a regex v4.

**Armadilha, `zoom` nunca é enviado.** O guia 13 recomenda mandar `zoom` para calibrar o decaimento por distância. Nenhum call site manda (`frontend/src/js/search/search-bar.search-providers.js:279`, `frontend/src/js/search/feature-search.control.js:182` montam a query só com `q`, `lat`, `lon`). O backend cai no raio padrão de 50 km e desliga o ajuste por tipo, então em zoom alto a busca não prioriza o que está perto. Não é bug de contrato, é qualidade deixada na mesa.

**Robustez, não contrato.** `normalizeProjects` (`frontend/src/js/street_view_tool/streetview-api.service.js:155-157`) aceita array nu e um legado `{ projects: [...] }`. Barato e defensivo, mas só o array nu é as-built. Não escreva código novo contra o legado.

## Regras operacionais

1. Nunca passe rota de contrato congelado pelo unwrap genérico sem checar o guard. `catalogo3d` perde dados em silêncio.
2. Para o sv360, use um caminho que leia `parsed.error` como string. Não tente unificar com [[erros-api]].
3. Trate `200 + { message }` no `/nomes/feicoes` como vazio, não como sucesso com dados.
4. Concatene sempre com a base do `/api/config`, nunca hardcode prefixo de asset.
5. Esses módulos estão fora do sync do atlas: sem `version`, sem snapshot, sem broadcast WS. Depois de calibrar uma foto ou ingerir um bundle, recarregue em vez de esperar evento ([[sintese-modulos-fora-do-sync]], [[ingestao-projetos-360]], [[sintese-rest-vs-sync]], [[envelope-operacao]]).
6. A visibilidade depende de quem está logado e não há push de invalidação: trocar de conta invalida resultados de busca e catálogo, refaça as consultas ([[autenticacao-jwt]], [[auth-flexivel]]).
7. `/nomes/busca`, `/assets3d/*` e a leitura do sv360 são alcançáveis anonimamente e **precisam** continuar sendo. Endurecer a borda sem preservar o caminho anônimo derruba busca e galeria ([[hardening-borda-api]]). Rotas de atlas seguem o padrão em [[api-rest-atlas]].
