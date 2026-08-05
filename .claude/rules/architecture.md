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

Tipos de feição: `point`, `line`, `polygon`, `circle`, `ellipse`, `rectangle`, `sector`, `text`, `image`, `brush`, `arrow`, `boundary`, `occupied_front`, `military_symbol`, `coordination_measure`, `magnetic_declination`, `los`, `visibility`.

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` | `BRIEFING_PRESENT`, geridos por `ApplicationModeManager` (`mode/application-mode.manager.js`); a troca de modo dirige perfis de visibilidade da UI.

## Temporal Module

Controle de linha do tempo por mapa (`temporal/`): `temporal-controller.js` (playback/cursor) + `temporal-render.service.js` (filtros + posição na trajetória) + `temporal-model.js` (matemática pura, testável em node) + `temporal-derivation.service.js` + `trajectory-tool/`.

- **Config por mapa** sob `temporal_<mapName>` (appStore, como o map-lock), shape `{ ativo, modo, unidade, inicio, fim, origem }`. Ops em `store/temporal.operations.js`. Emite `MAP_TEMPORAL_CHANGED` (no flip de `ativo`), `TEMPORAL_CONFIG_CHANGED` e `TEMPORAL_CURSOR_CHANGED`.
- **Modelo de lente pura:** o epoch ms absoluto é canônico; `modo` (absoluto/relativo D+N), `unidade` e `origem` são lentes de exibição que **nunca** mutam o tempo da feição. Mover feição no tempo é só a ação explícita "Reagendar" (`shiftMapTemporalTimes` + `shiftSourcesTemporal`), que desloca `temporalInicio`/`temporalFim` e todo `t` de trajetória, e re-deriva o DTG automático.
- **Hot path (playback)** roda a cada rAF: apply é coalescido (guarda de in-flight); filtros show/hide são quantizados ao passo da timeline em `layers/visibility-filter.js` (rebuild só na fronteira do passo); interpolação de trajetória normaliza uma vez por feição por frame. `resetTrajectoryCache()` no resync.
- **Derivação é só imagem:** direção/velocidade/DTG automáticos em símbolo militar regeneram o PNG do símbolo e **não podem** escrever a source GeoJSON nem o store — isso competiria com a passada de geometria por frame. Rotação fica manual, nunca automática.

## Measurement Tools

Ephemeral (non-persistent) tools that do NOT follow the 3-file tool pattern. Shared modules: `measurement-geometry.js` (calculations), `measurement-labels.js` (MapLibre layers), `measurement-results-panel.js` (UI). Shortcuts: J (distance), H (area), X (angle). Distance/area can "Salvar como feicao" to persist.

## Point Label

Points can render a text label (`showLabel`) with props `labelText`, `labelColor`, `labelSize`, `labelOutlineColor`, `labelOutlineWidth`, plus zoom-correction props (`labelZoomCorrectionEnabled`, `labelCreatedAtZoom`, `labelCalculatedSize`) that keep the label a constant visual size across zoom. Rendered via `point-label-layer` (alongside `point-layer` + `point-marker-layer`); the panel "Etiqueta" tab is built with `tool_manager/helpers/label-tab.helpers.js`.

## Sync / Real-Time Collaboration

The `store/sync/` client is **fully wired** to an optional backend (`ebgeo_backend`: Express + PostgreSQL + `ws`, JWT auth). The app still runs **anonymous** (nobody logged in) — but NOT without a reachable backend: boot is fail-fast on `GET /api/config` (`frontend/src/js/index.js`), with no static fallback. *(This section previously described the layer as "no-op / offline-only / no backend exists" — that is no longer true.)* Operations carry a Lamport clock (advances the local clock only — **not used for conflict resolution**; this is server-authoritative LWW-by-arrival, **not a true CRDT**); queue compaction: CREATE+DELETE=remove both, CREATE+UPDATEs=merge.

**Transport & orchestration**
- `api-client.js` — REST `/api/v1` (login/refresh/logout, `listAtlas`/`createAtlas`/`getAtlas`, sharing, `searchUsers`, `pushOperations`/`pullSync`, images). Tokens **persist in `localStorage`** via `_persistTokens` (`api-client.js:185-192`), so a session survives F5.
- `ws-client.js` — real `WebSocket` to `/api/v1/collab?atlasId&token&clientId`; heartbeat (ping/pong), exponential-backoff reconnect, `sync_request` replay, inbound op de-dupe by own `clientId`.
- `sync-engine.js` (`syncEngine`) — lifecycle: `login` → `connect(atlasId,{initialPull})` (snapshot + WS) → `flush`/`pull` → `disconnect`/`logoutAndDisconnect`.
- `sync-flush.js` — outbound flush (1.5s interval + `FLUSH_TRIGGER_EVENTS`), gated on `connectionState.isOnline()`; batches via `apiClient.pushOperations`. `runtime-config.js` resolves base URL; `image-sync.js` syncs image blobs.

**Outbound** — store ops call `logXxxOperation` directly (`operation-dispatcher.js`; feature ops log inside the `runTransaction` deferAsync) → `operation-queue.js` (IndexedDB queue `ebgeo/operation_queue`, compaction, auto-purge) using `operation-factory.js` (Lamport clock + persisted `clientId`). Op types in `operation-types.js`.

**Inbound** — `remote-operation-handler.js` `applyRemoteOperation` routes by entityType, persists via the repo, emits the matching lifecycle event + `REMOTE_OPERATION_APPLIED`. `applyRemoteSnapshot` reshapes the backend snapshot (snake_case→camelCase) on `connect`. 3D/360 inbound **persists** into the per-map cesium3d/streetview360 side-stores (then emits the `*_CHANGED` event) and is LWW-guarded like features — a peer converges on a live 3D/360 op (NOT emit-only; an earlier note here said otherwise — that was wrong).

**Identity / connection / permissions**
- `session-context.js` (`sessionContext`) — OFFLINE/ONLINE; JWT `userId` + role. **São SEIS papéis**, não quatro: `owner`, `admin`, `manager`, `editor`, `commenter`, `viewer` (`session-context.js:29-36`, permissões em `:60-78`). Esta linha já listou quatro, omitindo `manager` e `commenter`: é a mesma lista fechada que a constituição proíbe e que já causou bug real duas vezes. Gate pela hierarquia, nunca por igualdade. Offline = `clientId` anônimo com permissão local total.
- `connection-state.js` (`connectionState`) — real state machine `OFFLINE→CONNECTING→ONLINE→RECONNECTING`, driven by `ws-client.js`.
- `event-bridges.js` — bridges both singletons to `SESSION_CHANGED` / `CONNECTION_STATE_CHANGED`.
- `permission-guard.js` — role gate (permissive offline). `sync-gateway.js` — inbound relay (early-returns when offline). `sync-scheduler.js` — **now a no-op shell** kept for call-site stability (outbound owned by `sync-flush.js`).

**Entry points & UI** — `account/account.control.js` (login modal; `openProjectPicker` NAVEGA para `projetos.html`; logout → `logoutAndDisconnect`), `account/open-atlas.service.js` (**o único** pipeline de abertura: pergunta o que fazer com trabalho local → `clearAllDataStore` → `markStoreRemote` → `connect` → `startAutoFlush`), `account/sync-status.control.js` (connection light, hidden when anonymous), `presence/` (online-users roster + remote cursors + presence store), `projects/atlas-drive.js` (seletor, corpo de `projetos.html`), `modals/{login,sharing}.modal.js`, `sidebar/tabs/maps.tab.js` ("Abrir do servidor" + share button).

**Conflict model** — LWW by **server arrival order** (not timestamp); idempotency by `op_id`. Backend entity writes are **sync-only** (no REST write routes for feature/map/layer/group/briefing/slide). Operating model & principles (offline-first, local-vs-remote separation, atlas isolation, network resilience): `docs/wiki/index.md`. Full multi-user action map: `docs/wiki/index.md`.

**Sync — accurate current state (most earlier "gaps" are resolved):**
- Tokens **persist in `localStorage`** and a login survives F5 (`restoreSessionFromStorage`, `frontend/src/js/index.js:251`); the refresh-rotation / 401-retry path (`apiClient.refresh`) IS reachable on boot. What does **not** happen: the boot does not reopen the last remote atlas. This line used to promise "last remote atlas restored on boot/F5" and cited a `reconnectLastAtlas` that has **zero occurrences** in `frontend/src/`. What actually runs is `openAtlasChooserOnBoot` (`frontend/src/js/index.js:273`), which DISCARDS orphan remote data and opens the Atlas Drive, because the address bar is the source of truth: `/?atlas=<uuid>` loads that atlas, a bare `/` must let the user choose. The wrong version was the more expensive kind of wrong, because this file is loaded as instruction in every agent session and planning from it produces reconnection code that duplicates the Atlas Drive. Registered in [[sessao-boot-e-ciclo-de-vida]].
- Remote-atlas data is **cleared on logout/disconnect**; the boot guard discards orphan remote data found while logged out. The local↔remote split is the **store-origin marker** (`store-origin.js`), NOT per-atlas namespacing — **multiple named local atlases are a deliberate non-goal** (local = one workspace + `.ebgeo`; named atlases are a server concept; see `docs/wiki/index.md` P12).
- The local default map `Principal` is name-keyed: non-UUID-context ops are dropped pre-flush (anti-leak); on `connect`, `activateAtlasInitialMap` removes non-UUID local strays (so a same-named server map isn't shadowed); `getAllMapNamesStore` resolves UUID keys → names.
- Remote layer/3D/360 ops **and** snapshots persist into their dedicated side-stores and refresh the active-map layer cache (P11 round-trip fidelity).
- Permission role gate applies only to a **connected remote atlas** — the local store is always editable, even logged in.
- **By design, client-driven:** `auth.logout` revokes only the refresh token; the collab socket close + presence teardown happen on the client.

**SyncLedger (sync observability — test/dev only, never prod)** — an additive, env-gated tracing layer that makes the multi-user pipeline visible end-to-end. A `traceId` is minted per user gesture in `runTransaction` (`store-transaction.js`) and stamped onto the op envelope (`operation-factory.js`); typed **spans** are recorded to a ring buffer keyed by `op.id` (the always-works join key). Lives in `store/sync/diag/`: `trace-stages.js` (shared FE/BE stage/outcome/reason contract), `trace-core.js` (`record()` — zero-cost when off — + ring `window.__ebgeoSyncTrace`, Node-safe), `bus-tap.js` (a first-class `EventEmitter.onAny()` tap → `remote.applied` + a `render.source` UI-effect probe). Spans come from `operation-dispatcher.js` (`preflush.drop`/`enqueue`), `sync-engine.js` (`flush.push` + `push.ack` — the previously-dropped ack response is now consumed), `ws-client.js` (`ws.inbound`/`ws.self-echo`/`conn.transition`) and `sync-gateway.js` (`gateway.gate`); installed from `store/services.js` + `index.js`. The backend mirrors the contract (`utils/sync-trace.js` + `GET/DELETE /api/v1/debug/trace`) so Playwright `collectLedger` merges both rings by `op.id`/`traceId`. Gated by `?trace=sync`/`localStorage`/test init script (FE) and `EBGEO_TRACE=1`/`NODE_ENV=test` (BE) — production is a dead branch. Test helpers in `tests/e2e-ui/helpers/{trace-helpers,ledger}.js`. End-to-end sync architecture (transport, op envelope, flows, backend) + SyncLedger as-built: `docs/wiki/index.md`.

## Páginas e chunks (Vite)

**Três páginas HTML**, três entries em `vite.config.js` → `rollupOptions.input`:

| página | entry | CSS | conteúdo |
|---|---|---|---|
| `index.html` | `src/js/index.js` | `style.css` | o mapa |
| `projetos.html` | `src/js/projects/projects-page.js` | `projects-page.css` | seletor de atlas (`projects/atlas-drive.js`) |
| `admin.html` | `src/js/admin/admin-page.js` | `admin-page.css` | Administração |

As duas páginas sem mapa **não carregam o mapa**: nada de MapLibre/Turf/Cesium/GDAL, nada de `@store` nem `initServices()` — só `api-client`, `session-context`, config e os primitivos de dialog/toast. Importar o barrel `@utils` ou `@modals` delas arrasta a store de volta pelo caminho transitivo (`@utils` → `feature_navigation_utils` → `@store`); importe o módulo direto. Payload eager medido: ~140 kB cada, contra ~3,3 MB do mapa.

Elas compartilham a barra superior (`ui/app-bar.js` + `css/app-bar.css`) porque `AccountControl` é `IControl` do MapLibre e só existe dentro de um mapa. Página nova = usar `createAppBar`, não crescer um header próprio.

Os grupos de chunk são definidos em `codeSplitting.groups` (API do Rolldown), **não** no `manualChunks` depreciado, e com `entriesAware: true` — sem isso as páginas sem mapa baixam o chunk inteiro em que suas folhas compartilhadas caíram. Detalhe medido no comentário do próprio `vite.config.js`. Os nomes dos arquivos gerados são rótulos do grupo, não do conteúdo: um chunk subdividido herda o nome de um dos grupos fundidos, então a página do admin carrega arquivos chamados `analysis-tools-*`/`cesium-integration-*` que não contêm nem um nem outro — confira o sourcemap antes de acreditar no nome.

Grupos (só os módulos-cabeçalho; cada um puxa muitos outros — `core` inclui também state, terrain, baselayers, catalog, tool_manager, mode, briefing, snapping, grid, coordinates, measurement_tool):

`core` (store, events, utilities, layers, toolbar, modals, …) | `ui-components` (sidebar, features_tab, search, …) | `draw-tools` (+ azimuth_distance_tool) | `military-tools` | `analysis-tools` | `selection-tools` | `phone-ui` | `cesium-integration` (lazy) | `import-export` (lazy) | `street-view` (lazy).

Caminhos não mapeados (ex. `keyboard`, `map/map.manager`) caem no bundle do entry.

## Event Types Reference

A lista canônica é `frontend/src/js/events/event_types.js`, acessada por `EventTypes.XXX` (nunca string literal). A cópia parcial que morava aqui se anunciava "não exaustiva", o que a impedia de servir como contrato e deixava só o efeito de apodrecer. Ficam os dois pares que o nome não distingue:

- **`FEATURE_MODIFIED` vs `FEATURE_UPDATED`** — o primeiro é mudança de geometria/estilo; o segundo é mudança de user-data, atributo ou imagem. Assinar o errado é bug silencioso.
- **`StoreErrorEvents` não vive em `event_types.js`** — os três (`STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`) são definidos em `frontend/src/js/store/store-errors.js`. Procurar no arquivo errado dá a impressão de que não existem.
