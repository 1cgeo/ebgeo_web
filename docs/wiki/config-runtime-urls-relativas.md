# URLs relativas resolvidas por /api/config

Os subsistemas 3D e 360 gravam caminhos relativos e o cliente os resolve contra bases publicadas pelo `GET /api/config`. A regra não é uniforme: quatro campos vizinhos usam quatro convenções diferentes, e o 3D não usa a base que a documentação antiga prometia.

## Por que a base fica no config e não no dado

Um `tileset.json` ou uma thumbnail 360 são servidos de hosts diferentes em dev, homologação e rede interna do EB. Gravar o caminho absoluto no banco tornaria a troca de ambiente um UPDATE em massa; hardcodar no bundle exigiria rebuild. Grava-se o relativo no dado e a base em env var (`ASSETS_3D_BASE_URL`, `SV360_SERVICE_URL`), montadas no payload como `assets3dBaseUrl` e `streetView360.serviceUrl` (`backend/src/modules/config/config.service.js`). Ancorado por símbolo de propósito: as duas citações por número que moravam aqui derivaram e passaram a apontar para o SQL de outra função, e o guarda de integridade valida o caminho, nunca a linha. Ver [[config-dinamico]] e [[deploy-backend]].

## O objeto config é mutado in place, nunca substituído

`frontend/src/js/config.js` é uma casca: só defaults estruturais e `tilesets: []` / `streetView360: {}` vazios. `applyRuntimeConfig()` (`frontend/src/js/store/sync/runtime-config.js`) faz deep-merge **dentro** do objeto importado por todo o app.

- **Nunca capture um valor de config em constante de módulo.** No topo do módulo você lê a casca vazia. Por isso `frontend/src/js/street_view_tool/streetview-api.service.js` encapsula em `getServiceUrl()`, relido a cada chamada.
- Arrays são sobrescritos inteiros, nunca concatenados (`frontend/src/js/store/sync/runtime-config.js`). Um `/api/config` parcial preserva as chaves que omite.
- O módulo em si é fail-safe (retorna `{applied:false}`), mas o boot é fail-fast: `frontend/src/js/index.js` tenta 3 vezes com 1 s de intervalo e, falhando todas, mostra a tela "EBGeo indisponível" e não roda. Não existe modo "config estático de fallback".

## Quatro convenções coexistindo

Não há regra única. Ao gravar metadata de catálogo, grave na convenção que o consumidor daquele campo espera:

| Campo | Convenção |
|---|---|
| `previewThumbnail` de foto 360 | relativo, concatenado com `serviceUrl` pelo cliente |
| `streetView360.pointsSource` / `linesSource` | template já **absoluto**, montado no backend, passado direto ao `map.addSource` |
| `tilesets[].url` | entregue **verbatim** ao Cesium, resolvido pelo navegador contra a origem da página |
| thumbnail de tileset | **data URL** embutida no recurso, teto de 256 KB para não inflar o `/api/config` (`frontend/src/js/admin/catalog-tab.js`) |

Ou seja: 360 concatena, 3D embute. Ver [[resources-catalogo]].

## O backend publica assets3dBaseUrl e o web app não o lê

O campo existe do lado do servidor: `getAppConfig` emite `assets3dBaseUrl` (`backend/src/modules/config/config.service.js`) e o schema admin o valida (`backend/src/modules/config/config.admin.schemas.js`). Do lado do cliente, `grep` em `frontend/src/` não retorna uma única ocorrência, e o `url` de `config.tilesets` vai sem prefixo algum ao Cesium (`frontend/src/js/3d_models_viewer_tool/map_3d.js`).

É contrato publicado sem consumidor, e o engano tem duas direções: quem audita só o backend acha que o cliente concatena, quem audita só o frontend acha que o campo não existe. A regra "concatene `assets3dBaseUrl + url`" valeria para um cliente de descoberta que recebesse o caminho cru, e não há um: ninguém a executa neste repositório.

Como interpretar sem errar: `assets3dBaseUrl` é o prefixo que um cliente de DESCOBERTA concatenaria antes de pedir o binário, e hoje **ninguém concatena**: o web app recebe os modelos já em `config.tilesets`, hidratado da tabela de catálogo, e o backend não reescreve a `url`. A rota que seria a consumidora natural do campo era a do segundo catálogo 3D, e ela saiu do sistema ([[resources-catalogo]]). Então, ao editar o catálogo pelo painel admin, grave a `url` já servível a partir da origem (ex.: `/api/v1/assets3d/aman/tileset.json`) ou absoluta, porque ninguém vai prefixá-la. Ver [[assets3d-distribuicao]].

## Armadilha: o shape de /sv360/projects

A rota **não** devolve a linha crua do Postgres, e essa distinção já custou caro nos dois sentidos. Ela devolve uma view de allowlist (`publicProjectView`, `backend/src/modules/streetview360/sv360.service.js`), em camelCase, com as coordenadas **aninhadas** em `center: { lat, lon }` e com `previewThumbnail`, que é o shape legado que os três consumidores do cliente esperam. Enquanto a linha saía crua, o efeito não era erro, era sumiço: o acesso a `p.center.lon` lançava dentro do `.map()` de `loadMarkers()` e era engolido pelo `try/catch` de `frontend/src/js/street_view_tool/streetview_markers.js`, e em `frontend/src/js/catalog/catalog.service.js` o guarda `p.center ? ... : null` degradava para item sem localização.

Reformar em vez de apagar campos foi o que também fechou um vazamento: a rota é `flexibleAuth`, e a linha crua entregava `db_filename` e `organization_id` a chamador anônimo, que juntos soletram o caminho do arquivo sob `SV360_DB_DIR`. Uma allowlist não vaza coluna que não nomeia. Os extras de admin são **aditivos sobre o mesmo shape**, nunca um shape diferente: devolver a linha crua ao admin quebrava a camada 360 do mapa só para ele, que é o pior tipo de bug por papel.

Antes de "consertar a concatenação do `previewThumbnail`", confirme de qual payload o campo veio: o relativo (sem prefixo `/api/v1`) existe nos dois, e o do **metadado da foto** (`/photos/:uuid`) é o que o viewer usa.

Outra armadilha do mesmo módulo: se `streetView360.serviceUrl` não vier no config, `frontend/src/js/map_sig.js` desliga `features.imagens_panoramicas` **antes** do preflight. Config faltando parece feature desabilitada, sem erro visível. Ver [[streetview-360]] e [[ingestao-projetos-360]].

## Regras que não seguem do código

- Não hardcode `/api/v1/assets3d` nem `/api/v1/sv360`. Use `resolveBackendBaseUrl()` (`frontend/src/js/store/sync/runtime-config.js`), que honra o override `globalThis.__EBGEO_BACKEND_URL__` dos testes E2E. Hardcodar quebra o E2E, não a produção, então a falha aparece tarde.
- Trocar a base **não** invalida cache do navegador do caminho antigo: os binários são imutáveis com cache de 1 ano e ETag/304/Range ([[sintese-cache-http-imutavel]]). A troca só muda o caminho.
- Nenhum desses caminhos trafega pelo sync do atlas: 3D e 360 são módulos REST fora do WebSocket ([[sintese-modulos-fora-do-sync]]). Depois de uma escrita de calibração, recarregue o metadado; não espere evento ([[calibracao-e-grafo-360]]).
- O envelope do `sv360` é **nu** (objeto/array) e o erro é plano `{error: "msg"}`, diferente do resto da API ([[erros-api]], [[sintese-contratos-congelados]]).
- A restrição por atlas (quais modelos 3D e quais projetos 360 aparecem) é aplicada **depois** da resolução de URL, filtrando o catálogo ([[atlas-settings]]).
