# Architecture Reference

## Project Structure

Um `ls frontend/src/js/` conta a estrutura melhor que qualquer árvore aqui, e a árvore que morava nesta seção provou o ponto: ficou 92 linhas desatualizadas, omitindo `admin/` e `session/` inteiros. O que segue é só o que a listagem NÃO conta.

- **Entrada**: `index.js` (boot, fail-fast em `GET /api/config`) e `map_sig.js` (init do mapa e registro de controles). Toda ferramenta nova passa por `map_sig.js` em **três** registries distintos, não um: ver a skill `new-tool`.
- **`store/`** é o núcleo. `store.js` é fachada que reexporta as `*.operations.js`; `services.js` é o container de DI e precisa de `initServices()` antes de qualquer componente. Dois arquivos que a árvore antiga omitia e são load-bearing: `store.constants.js` (`SOURCE_TYPES` + `FEATURE_TYPE_MAPPINGS`, editado a cada ferramenta nova) e `store-origin.js` (o marcador que separa local de remoto, base de quase todo comportamento de sync).
- **Barrel por pasta**: cada pasta de módulo expõe `index.js`, e é por ele que os aliases resolvem.
- **Colocações que surpreendem** (a pasta não sugere o chunk): `measurement_tool` e `keyboard-service-3d` caem em `core`, não nos seus chunks óbvios. A ordem das regras dentro de `codeSplitting.groups[0].name` (`vite.config.js`) existe para evitar ciclo e está comentada lá, que é onde a explicação pertence.
- **Páginas sem mapa**: `projects/` e `admin/` são entries HTML próprios (`projetos.html`, `admin.html`), não telas do mapa — ver §Páginas e chunks antes de importar qualquer coisa delas.
- **Lazy**: `3d_models_viewer_tool/` (Cesium), `street_view_tool/` (Three.js) e `import_export/` só carregam sob demanda.

## UI Architecture

- **StateManager** enforces mutual exclusivity: sidebar and feature panel cannot both be open
- UI components subscribe to `UI_LAYOUT_CHANGED` for position updates
- `selectFeature()` (`state_manager.js`) replaces the active selection set; the feature panel opens/closes via `FEATURE_PANEL_OPENED/CLOSED`, not by `selectFeature` itself

## Data Model

**Atlas** (container de projeto) → **Maps** (workspaces) → **Layers** (contêiner de feições, com `visivel`/`bloqueado`) → **Features**.

O metadado de sync **não é uniforme entre entidades**, e tratá-lo como uniforme é erro fácil: Atlas/Map/Group carregam os seis campos (`createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`), enquanto **feição carrega só três** (`createdAt`, `updatedAt`, `version`), postos por `addCreatedTimestamp` (`frontend/src/js/store/feature.operations.js:29-41`). A divisão está declarada em `frontend/src/js/store/sync/index.js:11-15`.

- A camada ativa recebe feições novas; camadas emitem `LAYERS_CHANGED`.
- Projetos salvam como `.ebgeo`.
- Slide de briefing referencia modelo 3D por `modelId` (não `tilesetId`).
- **Comentário espacial** (colaboração): threads root/reply/resolve em `store/comment.operations.js`; `Shift+C` alterna a colocação.
- **Dado temporal** (opcional, por feição): `temporalInicio`/`temporalFim` (janela de validade em epoch ms; ausente = permanente) e `trajetoria` (keypoints `{t, lng, lat}`; point/military_symbol/coordination_measure). A config temporal por mapa é persistida à parte.

A lista de tipos de feição é `SOURCE_TYPES` (`frontend/src/js/store/store.constants.js`). Ela morava copiada aqui; a cópia estava certa e mesmo assim saiu, porque a skill `new-tool` manda editar aquela constante a cada ferramenta nova e nada mandava editar esta linha. Lista duplicada só espera a próxima ferramenta para ficar errada.

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` | `BRIEFING_PRESENT`, geridos por `ApplicationModeManager` (`mode/application-mode.manager.js`); a troca de modo dirige perfis de visibilidade da UI.

## Temporal Module

Controle de linha do tempo por mapa (`temporal/`): `temporal-controller.js` (playback/cursor) + `temporal-render.service.js` (filtros + posição na trajetória) + `temporal-model.js` (matemática pura, testável em node) + `temporal-derivation.service.js` + `trajectory-tool/`.

- **Config por mapa** sob `temporal_<mapName>` (appStore, como o map-lock), shape `{ ativo, modo, unidade, inicio, fim, origem }`. Ops em `store/temporal.operations.js`. Emite `MAP_TEMPORAL_CHANGED` (no flip de `ativo`), `TEMPORAL_CONFIG_CHANGED` e `TEMPORAL_CURSOR_CHANGED`.
- **Modelo de lente pura:** o epoch ms absoluto é canônico; `modo` (absoluto/relativo D+N), `unidade` e `origem` são lentes de exibição que **nunca** mutam o tempo da feição. Mover feição no tempo é só a ação explícita "Reagendar" (`shiftMapTemporalTimes` + `shiftSourcesTemporal`), que desloca `temporalInicio`/`temporalFim` e todo `t` de trajetória, e re-deriva o DTG automático.
- **Hot path (playback)** roda a cada rAF: apply é coalescido (guarda de in-flight); filtros show/hide são quantizados ao passo da timeline em `layers/visibility-filter.js` (rebuild só na fronteira do passo); interpolação de trajetória normaliza uma vez por feição por frame. `resetTrajectoryCache()` no resync.
- **Derivação é só imagem:** direção/velocidade/DTG automáticos em símbolo militar regeneram o PNG do símbolo e **não podem** escrever a source GeoJSON nem o store — isso competiria com a passada de geometria por frame. Rotação fica manual, nunca automática.

## Measurement Tools

`measurement_tool/` é a exceção ao padrão de 3 arquivos: as ferramentas de medição são EFÊMERAS (não persistem no store), então não têm `add_*_control` + geometria + painel de atributos. Não use a skill `new-tool` para elas. Distância e área ganham um "Salvar como feição" que é o único caminho até o store.

## Point Label

O que não se deduz lendo as props: a etiqueta de ponto tem correção de zoom (`labelZoomCorrectionEnabled`, `labelCreatedAtZoom`, `labelCalculatedSize`), cujo objetivo é manter o tamanho VISUAL constante enquanto o zoom muda. Mexer em tamanho de etiqueta sem entender isso produz texto que cresce junto com o mapa. A aba "Etiqueta" é montada por `tool_manager/helpers/label-tab.helpers.js`, compartilhada, não copiada por ferramenta.

## Sync / Real-Time Collaboration

The `store/sync/` client is **fully wired** to an optional backend (`ebgeo_backend`: Express + PostgreSQL + `ws`, JWT auth). The app still runs **anonymous** (nobody logged in) — but NOT without a reachable backend: boot is fail-fast on `GET /api/config` (`frontend/src/js/index.js`), with no static fallback. *(This section previously described the layer as "no-op / offline-only / no backend exists" — that is no longer true.)* Operations carry a Lamport clock (advances the local clock only — **not used for conflict resolution**; this is server-authoritative LWW-by-arrival, **not a true CRDT**); queue compaction: CREATE+DELETE=remove both, CREATE+UPDATEs=merge.

**Transport & orchestration**
- `api-client.js` — REST `/api/v1` (login/refresh/logout, `listAtlas`/`createAtlas`/`getAtlas`, sharing, `searchUsers`, `pushOperations`/`pullSync`, images). Tokens **persist in `localStorage`** via `_persistTokens`, so a session survives F5.
- `ws-client.js` — real `WebSocket` to `/api/v1/collab?atlasId&token&clientId`; heartbeat (ping/pong), exponential-backoff reconnect, `sync_request` replay, inbound op de-dupe by own `clientId`.
- `sync-engine.js` (`syncEngine`) — lifecycle: `login` → `connect(atlasId,{initialPull})` (snapshot + WS) → `flush`/`pull` → `disconnect`/`logoutAndDisconnect`.
- `sync-flush.js` — outbound flush (1.5s interval + `FLUSH_TRIGGER_EVENTS`), gated on `connectionState.isOnline()`; batches via `apiClient.pushOperations`. `runtime-config.js` resolves base URL; `image-sync.js` syncs image blobs.

**Outbound** — store ops call `logXxxOperation` directly (`operation-dispatcher.js`; feature ops log inside the `runTransaction` deferAsync) → `operation-queue.js` (IndexedDB queue in the object store `operation_queue`, one database PER ATLAS since 2026-08-15, with compaction and auto-purge) using `operation-factory.js` (Lamport clock + persisted `clientId`, plus the `scopeSuffix`/`atlasId` stamp of the scope the op was born in). Op types in `operation-types.js`.

**Inbound** — `remote-operation-handler.js` `applyRemoteOperation` routes by entityType, persists via the repo, emits the matching lifecycle event + `REMOTE_OPERATION_APPLIED`. `applyRemoteSnapshot` reshapes the backend snapshot (snake_case→camelCase) on `connect`. 3D/360 inbound **persists** into the per-map cesium3d/streetview360 side-stores (then emits the `*_CHANGED` event) and is LWW-guarded like features — a peer converges on a live 3D/360 op (NOT emit-only; an earlier note here said otherwise — that was wrong).

**Identity / connection / permissions**
- `session-context.js` (`sessionContext`) — OFFLINE/ONLINE; JWT `userId` + role. **São SEIS papéis**, não quatro: `owner`, `admin`, `manager`, `editor`, `commenter`, `viewer` (`UserRole` e `ROLE_PERMISSIONS` em `session-context.js`). Esta linha já listou quatro, omitindo `manager` e `commenter`: é a mesma lista fechada que a constituição proíbe e que já causou bug real duas vezes. Gate pela hierarquia, nunca por igualdade. Repare que `canDeleteMap` é flag SEPARADA de `canDelete`, e essa separação é contrato com o servidor (`operationDenialReason`): juntá-las fazia o cliente oferecer um botão que o servidor recusava, e a op recusada congelava a fila de saída inteira. Offline = `clientId` anônimo com permissão local total.
- `connection-state.js` (`connectionState`) — real state machine `OFFLINE→CONNECTING→ONLINE→RECONNECTING`, driven by `ws-client.js`.
- `event-bridges.js` — bridges both singletons to `SESSION_CHANGED` / `CONNECTION_STATE_CHANGED`.
- `permission-guard.js` — role gate (permissive offline). `sync-gateway.js` — inbound relay (early-returns when offline). `sync-scheduler.js` — **now a no-op shell** kept for call-site stability (outbound owned by `sync-flush.js`).

**Entry points & UI** — `account/account.control.js` (login modal; `openProjectPicker` NAVEGA para `projetos.html`; logout → `logoutAndDisconnect`, e quando a sessão cai SEM gesto do usuário com op na fila, ou com contagem desconhecida (`shouldPreserveLocalWork`), o trabalho é resgatado antes por `preserveUnsyncedWorkAsLocal`, que adota o namespace remoto como atlas local e só marca a origem LOCAL depois de reler o registro DO DISCO; falhando, ela não marca, devolve falso e o aviso ao usuário diz que o resgate falhou, em vez do toast incondicional que prometia trabalho salvo), `account/open-atlas.service.js` (**o único** pipeline de abertura, e a ordem é contrato: `claimRemoteAtlas` (tab-lock) → pergunta o que fazer com trabalho local → `disconnect` do anterior → `activateRemoteAtlas` (namespace) → `clearAllDataStore` → `markStoreRemote` → `connect` → `startAutoFlush`; o claim e a ativação de escopo vêm ANTES do wipe porque o wipe esvazia o escopo ATIVO, e sob namespace por atlas isso pode ser o dado vivo de outra aba), `account/sync-status.control.js` (connection light, hidden when anonymous), `presence/` (online-users roster + remote cursors + presence store), `projects/atlas-drive.js` (seletor, corpo de `projetos.html`), `modals/{login,sharing}.modal.js`, `sidebar/tabs/maps.tab.js` ("Abrir do servidor" + share button).

**Conflict model** — LWW by **server arrival order** (not timestamp); idempotency by `op_id`. Backend entity writes are **sync-only** (no REST write routes for feature/map/layer/group/briefing/slide). Operating model & principles (offline-first, local-vs-remote separation, atlas isolation, network resilience): `docs/wiki/index.md`. Full multi-user action map: `docs/wiki/index.md`.

**Sync — accurate current state (most earlier "gaps" are resolved):**
- Tokens **persist in `localStorage`** and a login survives F5 (`restoreSessionFromStorage`); the refresh-rotation / 401-retry path (`apiClient.refresh`) IS reachable on boot. What does **not** happen: **the boot never reopens the last remote atlas.** The address bar is the source of truth. Planning from the opposite belief produces reconnection code that duplicates the Atlas Drive, which is why the wrong version of this line was expensive: the file is loaded as instruction in every agent session. (It cited a `reconnectLastAtlas` with zero occurrences in `frontend/src/`; the symbol rule of `docs-integridade` now catches that class. Registered in [[sessao-boot-e-ciclo-de-vida]].)
- **Roteamento do boot, em ordem** (`index.js`, e a ordem É o contrato): antes de tudo, um visitante COM sessão numa URL nua vai para `projetos.html` por `window.location.replace` (`shouldRouteToProjects`), e só ele; depois, já no mapa, a cadeia é `openPublicAtlasFromUrl` (`?atlasPublico=`) → `openAtlasFromUrl` (`?atlas=`) → `enterLocalMapOnBoot` ("Mapa local") → `openAtlasChooserOnBoot`. Cada uma retorna cedo se assumiu o boot. Anônimo fica no mapa de propósito: o mapa É o produto para quem não entrou. `?verify=` (confirmação de e-mail) é consumido antes da cadeia, e `#view=3d/360` tem precedência absoluta no caminho de load do mapa.
- Remote-atlas data is **cleared on logout/disconnect**; the boot guard discards orphan remote data found while logged out. The local↔remote split is still the **store-origin marker** (`store-origin.js`), and it is now ALSO per-atlas namespacing: see §Atlas, namespace e tab-lock below. Esta linha dizia "múltiplos atlas locais nomeados são um não-objetivo deliberado (P12)", e essa decisão foi **superada em 2026-08-15** ([`docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md)); enquanto ela disse o contrário do produto, a próxima sessão de agente tratava o código existente como violação.
- The local default map `Principal` is name-keyed: non-UUID-context ops are dropped pre-flush (anti-leak); on `connect`, `activateAtlasInitialMap` removes non-UUID local strays (so a same-named server map isn't shadowed); `getAllMapNamesStore` resolves UUID keys → names.
- Remote layer/3D/360 ops **and** snapshots persist into their dedicated side-stores and refresh the active-map layer cache (P11 round-trip fidelity).
- Permission role gate applies only to a **connected remote atlas** — the local store is always editable, even logged in.
- **By design, client-driven:** `auth.logout` revokes only the refresh token; the collab socket close + presence teardown happen on the client.

**SyncLedger (observabilidade do sync, só test/dev, nunca produção)** vive em `store/sync/diag/`, e um `ls` daquela pasta conta os arquivos melhor que uma lista aqui. O que a leitura NÃO entrega:

- **A chave de junção é `op.id`, não o `traceId`.** O `traceId` é cunhado por gesto do usuário em `runTransaction` e carimbado no envelope, mas um gesto vira N ops; o `op.id` é o que sempre casa dos dois lados. Juntar por `traceId` funciona nos testes de uma op só e mente no resto.
- **O contrato de estágios é COMPARTILHADO com o backend**: `trace-stages.js` é a fonte e `backend/src/utils/sync-trace.js` é um ESPELHO que precisa andar junto. Estágio novo entra nos dois no mesmo commit. Aqui o desenho foi feito para não falhar calado: o merger valida o `stage` de cada span contra o enum e SINALIZA o desconhecido em vez de descartar.
- **Produção é ramo morto**, por gate de env (`?trace=sync`/localStorage no front, `EBGEO_TRACE=1`/`NODE_ENV=test` no backend). Não é feature flag de runtime; não escreva código que dependa de trace ligado.

Para esperar em teste de collab, prefira os helpers de trace ao polling de store: no timeout eles dizem QUAL estágio foi o último alcançado, que é a informação que transforma um flake em diagnóstico. Arquitetura completa do sync e o as-built do SyncLedger: `docs/wiki/index.md`.

## Atlas, namespace e tab-lock

Desde 2026-08-15 **cada atlas tem seus próprios bancos**, local e remoto igualmente (decisão em [`docs/decisions/decisions-2026.md`](../../docs/decisions/decisions-2026.md), que supera o antigo P12 da wiki). O `fileoverview` de `frontend/src/js/store/atlas-namespace.js` é a fonte, com as decisões numeradas e as medições; o que segue é só o que morde quem escreve código sem ler aquele arquivo.

- **Nunca chame `localforage.createInstance`.** A fábrica é `atlas-namespace.js`, e todo acesso é `getStore(StoreName.X)`, resolvido contra o escopo ATIVO. Guardar um handle no load do módulo é o defeito que a fase inteira existe para impedir: ele fica preso ao atlas que estava montado no import e segue escrevendo lá depois da troca, sem erro. Um teste ESTRUTURAL reprova chamador novo (`frontend/tests/unit/repository-namespace.test.js`), com allowlist das quatro migrações antigas, que precisam abrir os nomes pré-namespace.
- **O namespace vai no NOME DO BANCO**, nunca num object store novo dentro de banco compartilhado: object store novo é upgrade de versão, dispara `versionchange` e fica pendente enquanto qualquer aba segurar.
- **O que NÃO é por atlas** (errar aqui apaga a identidade do usuário ao trocar de atlas): só `ebgeo_global` (registro local, ponteiro de atlas corrente e o marcador de origem). O marcador de origem é lido antes de qualquer escopo existir, então namespaceá-lo seria escolher um namespace para descobrir qual namespace escolher. Esta linha listava também `ebgeo`/`operation_queue`, e deixou de valer: a fila de saída é `perAtlas: true` desde 2026-08-15.
- **A fila de saída é por atlas SEM ser dado do atlas** (`atlasData: false`), e a distinção decide duas listas: o wipe de entrada (`clearAllAtlasStores`) NÃO a alcança, porque `openRemoteAtlas` monta o namespace do atlas que abre e esvazia três linhas depois; a destruição de namespace (`clearAtlasDatabases`/`dropAtlasDatabases`) alcança, porque op carrega payload e fila de pé pós-logout é dado de servidor legível. Esvaziá-la num wipe é decisão do chamador (`clearQueue`). Detalhe em [`docs/wiki/namespace-por-atlas.md`](../../docs/wiki/namespace-por-atlas.md).
- **Remoto: registre antes de escrever.** `activateRemoteAtlas` (`store/remote-atlas.api.js`) é o único caminho legal: ele grava a entrada do registro e só então aponta os stores. Escrever num namespace não registrado produz dado que nenhum expurgo acha. O expurgo é DERIVADO do registro (`purgeAllRemoteAtlases`), e destrói em duas etapas: esvaziar (carrega o invariante, não precisa de acesso exclusivo) e só depois apagar (higiene, com prazo, e pode voltar `blocked` sem risco).
- **O expurgo POUPA o namespace que outro cliente vivo tem montado**, arbitrado por Web Lock de montagem (`atlasMountLockName`), e o perdão expira (`SPARE_GRACE_MS`). Ele é chamado POR NOME nos dois caminhos que significam "a sessão acabou" (guarda de boot e logout), nunca como efeito colateral de um wipe: pendurá-lo num `!isAuthenticated` dentro de `clearAllDataStore` fazia o visitante de link público destruir o namespace que acabara de registrar.
- **Antes de destruir, AVISE, e o aviso não é endereçado por colisão.** No logout, `announceRemoteTeardown` (`account/account.control.js`) manda a lista de `dbSuffix` condenados para TODA aba viva (`announceTeardown`, protocolo v3), e cada receptor decide comparando com o endereço que tem MONTADO (`applyTeardownFreeze`, `store/sync/tab-lock-sync-brake.js`), porque o par que o aviso precisa alcançar (quem sai da conta e a irmã num atlas de servidor) NÃO colide por chave. Três invariantes: o ack sai depois de o freio terminar, o freio SOLTA o lock de montagem (senão o namespace seguiria poupado até o prazo), e o silêncio degrada para poupar. A aba freada não volta; só recarregar.
- **O resgate cria um híbrido, e ele é intencional:** `adoptRemoteAtlasAsLocal` preserva trabalho não sincronizado no logout movendo a reivindicação entre registros e ZERO bytes entre bancos, então um slot LOCAL pode carregar sufixo `remote-<atlasId>` e ser literalmente os mesmos dez bancos de um atlas de servidor.
- **Tab-lock (`utilities/tab-lock.js`), regra do dono:** duas abas colidem quando, e só quando, seguram o MESMO endereço de bancos; local ou remoto não muda a regra, e página sem mapa nunca colide. O predicado compara ENDEREÇO (`claimAddress`), não o par (kind, id), que é o que faz o slot adotado acima colidir com o atlas de servidor de origem. **Não há mais exceção:** a retenção que fazia QUALQUER par de atlas de servidor colidir saiu em 2026-08-15, depois de os quatro defeitos que ela cobria terem sido fechados por nome (a lista está no comentário de `keysCollide`, e `frontend/tests/integration/namespace-remoto-fiacao.test.js` é quem afirma que dois atlas de servidor são dois blocos de bancos). Esta linha afirmou o contrário por uma revisão, e é o tipo de afirmação que se propaga: o arquivo é carregado como instrução em toda sessão. Importe `tab-lock.js` **direto**, nunca pelo barrel `@utils`: as três páginas sem mapa o usam, e o barrel arrasta a store.
- **Boot:** `activateBootAtlasScope` (`store/store.js`) chama `initLocalAtlases` com origem persistida e sessão viva, e vem DEPOIS da guarda de deslogado, de propósito, porque a guarda ainda precisa mirar os bancos sem sufixo no caso pré-namespace.

## Páginas e chunks (Vite)

**QUATRO páginas HTML**, quatro entries em `vite.config.js` → `rollupOptions.input`:

| página | entry | conteúdo |
|---|---|---|
| `index.html` | `src/js/index.js` | o mapa |
| `projetos.html` | `src/js/projects/projects-page.js` | seletor de atlas (`projects/atlas-drive.js`) |
| `admin.html` | `src/js/admin/admin-page.js` | Administração |
| `calibracao.html` | `src/js/calibration/calibracao-page.js` | estúdio de calibração 360 |

A calibração veio do `ebgeo_360`, onde era estático solto; aqui ela passa pelo chunking e é alvo do ESLint e do Stylelint da casa como qualquer outra página. Esta seção disse "três páginas" por tempo suficiente para a contagem virar premissa (a constituição repete o número), e um contador errado é o tipo de afirmação que nenhum guarda pega: `docs-integridade` valida caminho e símbolo, nunca aritmética.

Nenhuma das outras três **carrega a aplicação do mapa**: nada de `@store`, nada de `initServices()`, nada de ferramenta de desenho. Repare que "sem o app do mapa" não é "sem MapLibre": `calibracao.html` carrega MapLibre por `<script>` de vendor para desenhar seu mapa de projeto e seu minimapa. Quem não toca MapLibre é `projetos` e `admin`.

A armadilha é de import, não de página: importar o barrel `@utils` ou `@modals` fora do mapa arrasta a store de volta pelo caminho transitivo (`@utils` → `feature_navigation_utils` → `@store`); importe o módulo direto. Payload eager medido em `projetos`/`admin`: ~140 kB cada, contra ~3,3 MB do mapa.

`projetos` e `admin` compartilham a barra superior (`ui/app-bar.js` + `css/app-bar.css`) porque `AccountControl` é `IControl` do MapLibre e só existe dentro de um mapa. Página nova dessas duas = usar `createAppBar`, não crescer um header próprio. A calibração não usa a barra e não é uma página de usuário: ela é gateada por `isAdmin()` (papel `admin` global, não `owner` de atlas) e manda todo o resto para o mapa.

Os grupos de chunk são definidos em `codeSplitting.groups` (API do Rolldown), **não** no `manualChunks` depreciado, e com `entriesAware: true`, sem o qual as páginas sem mapa baixam o chunk inteiro em que suas folhas compartilhadas caíram. Detalhe medido no comentário do próprio `vite.config.js`. Os nomes dos arquivos gerados são rótulos do grupo, não do conteúdo: um chunk subdividido herda o nome de um dos grupos fundidos, então a página do admin carrega arquivos chamados `analysis-tools-*`/`cesium-integration-*` que não contêm nem um nem outro. Confira o sourcemap antes de acreditar no nome.

Grupos (só os módulos-cabeçalho; cada um puxa muitos outros, e `core` inclui também state, terrain, baselayers, catalog, tool_manager, mode, briefing, snapping, grid, coordinates, measurement_tool):

`core` | `ui-components` | `draw-tools` | `military-tools` | `analysis-tools` | `selection-tools` | `phone-ui` | `calibration` | `cesium-integration` (lazy) | `import-export` (lazy) | `street-view` (lazy) | `first-person-3d` (lazy).

Dois casos que a pasta não prediz e o `vite.config.js` explica no comentário: `keyboard-service-3d` mora sob `3d_models_viewer_tool/services/` e vai para `core` (é import estático, e mandá-lo para `cesium-integration` cria ciclo de chunk no Linux), e `import_export/export-utils` também vai para `core` pelo mesmo motivo. O `src/vendor/three/` fica FORA do grupo `calibration` de propósito: o Three.js também serve o `street_view_tool` do mapa.

Terceiro caso, pela mesma razão e com quatro arquivos: de `first_person_3d_tool/` só o viewer, `components/`, `tools/` e `walk/walk-mode` vão para o grupo lazy. `scene-config.service`, `walk/voxel-collision`, `walk/constants` e `services/keyboard-service-fp` são fixados em `core`, porque o primeiro é import estático do controle de modelos 3D (entry), do catálogo (core) e da busca (ui-components), os dois seguintes vêm atrás dele, e o último é importado por `map_sig.js` como o `keyboard-service-3d`. O barrel `first_person_3d_tool/index.js` fica DE FORA de qualquer regra, no bundle do entry, que é onde os wrappers de `import()` pertencem. Duas notas medidas no comentário do `vite.config.js` e que contrariam a intuição: casar a pasta inteira NÃO vazaria o motor para o payload eager (com `entriesAware` o grupo se subdivide), e o `first-person-3d` **estoura o `chunkSizeWarningLimit` de propósito**, então `npm run build` passa a emitir um aviso esperado, e só um.

Sobre a dependência do grupo, `@manycore/aholo-viewer` (pinada em versão EXATA, não com acento circunflexo): ela **vendoriza `semver` e `fflate` dentro do bundle publicado**, sem declará-las como transitivas. Um CVE em qualquer das duas deixa o `npm audit` verde com o código vulnerável embarcado, e não há guarda aqui para isso.

Caminhos não mapeados (ex. `keyboard`, `map/map.manager`) caem no bundle do entry.

## Event Types Reference

A lista canônica é `frontend/src/js/events/event_types.js`, acessada por `EventTypes.XXX` (nunca string literal). A cópia parcial que morava aqui se anunciava "não exaustiva", o que a impedia de servir como contrato e deixava só o efeito de apodrecer. Ficam os dois pares que o nome não distingue:

- **`FEATURE_MODIFIED` vs `FEATURE_UPDATED`** — o primeiro é mudança de geometria/estilo; o segundo é mudança de user-data, atributo ou imagem. Assinar o errado é bug silencioso.
- **`StoreErrorEvents` não vive em `event_types.js`** — os três (`STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`) são definidos em `frontend/src/js/store/store-errors.js`. Procurar no arquivo errado dá a impressão de que não existem.
