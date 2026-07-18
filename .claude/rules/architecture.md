# Architecture Reference

## Project Structure

```
src/js/
├── index.js                 # Entry point
├── map_sig.js               # Map init, control registration
├── config.js / config.helpers.js / config-loader.js
│
├── store/                   # Central data store
│   ├── index.js             # Public barrel (re-exports store.js + services)
│   ├── store.js             # Facade with all operation re-exports
│   ├── services.js          # DI container (initServices, getters)
│   ├── memory-store.js      # In-memory runtime state
│   ├── repository.js        # IndexedDB persistence
│   ├── control.registry.js  # registerControl / getControl
│   ├── store-state-manager.js  # Undo/redo, color tracking
│   ├── store-transaction.js    # Persistence-first transactions
│   ├── store-errors.js         # Error conventions (StoreErrorEvents)
│   ├── feature.operations.js   # Feature CRUD
│   ├── layer.operations.js     # Layer CRUD
│   ├── group.operations.js     # Grouping
│   ├── map.operations.js       # Map CRUD
│   ├── briefing.operations.js  # Briefing CRUD
│   ├── comment.operations.js   # Spatial comments (root/reply/resolve)
│   ├── catalog.operations.js   # External-layer catalog state
│   ├── customIcons.operations.js  # User custom point icons
│   ├── settings.operations.js  # App/user settings
│   ├── cesium3d.operations.js  # 3D operations
│   ├── streetview360.operations.js
│   ├── temporal.operations.js  # Per-map temporal config (temporal_<mapName>); shiftMapTemporalTimes lives in feature.operations.js
│   ├── atlas/               # Atlas entity (top-level project container)
│   ├── repositories/        # Repository abstraction (interface, local, factory)
│   ├── services/             # map-resolver.service.js (name↔UUID with LRU)
│   ├── migration/            # Schema migrations (v1→v2, v2→v2.1, v2.1→v2.2; auto, version-conditional on startup)
│   └── sync/                 # Real-time sync CLIENT (wired, NOT no-op): REST api-client + WebSocket ws-client,
│                             #   sync-engine orchestration, op queue + Lamport, remote-op apply, session/connection state
│
├── events/                  # event_bus.js, event_types.js, event_emitter.js
├── state/                   # state_manager.js (UI state: sidebar, panels)
│
├── tool_manager/            # Base classes + tool orchestration + UI helpers
│   ├── tool_manager.js / ui_manager.js   # Active-tool + attribute-panel orchestration
│   ├── base_control.js / base_geometry.js
│   ├── selection_manager.js / clipboard_manager.js / move_handler.js / group_manager.js
│   ├── helpers/             # Panel building blocks (color-picker, slider, etc.)
│   └── managers/            # profile-panel, selection-highlight
│
├── draw_tools/              # point, line, polygon, circle, ellipse, rectangle,
│                            # sector, text, image, brush (each: control+geometry+panel)
├── military_tools/          # military_symbol, coordination_measure, arrow, boundary,
│                            # occupied_front, declination
├── analysis_tools/          # los_tool, visibility_tool
├── azimuth_distance_tool/   # Azimuth & distance navigation
├── measurement_tool/        # Ephemeral 2D measurements (distance/area/angle)
├── snapping/                # Vertex/edge/endpoint snapping service
├── selection_tools/         # Selection interaction tools
├── vector_info/             # Vector feature info panel
├── temporal/                # Timeline module (per-map): controller, render service,
│                            # pure model, derivation, trajectory-tool (keypoint editing)
│
├── sidebar/                 # Collapsible sidebar (tabs: Maps, Layers, Briefings, Import, Export)
├── toolbar/                 # Grouped tool buttons with popups
├── bottom-controls/         # Feature toggles (terrain, 3D, street view)
├── base-layer-selector/     # Base map picker
├── modals/                  # Modal dialogs
├── search/                  # Global search bar
├── context-menu/            # Right-click menus
├── catalog/                 # External layer catalog
├── comment_tool/            # Spatial comments (overlay + comments panel)
├── attribute_table/         # Data grid with filtering
├── features_tab/            # Layer/feature tree list
│
├── 3d_models_viewer_tool/   # Cesium 3D (lazy loaded)
├── street_view_tool/        # Three.js 360 viewer (lazy loaded)
├── briefing/                # Story Map editor + presenter
├── import_export/           # GeoJSON, KML, CSV, SHP, .ebgeo, PDF
├── processing/              # Geospatial algorithms (Buffer, Voronoi, Convex Hull; registry pattern)
│
├── layers/                  # MapLibre style definitions + layer manager
├── baselayers/              # Base map styles (BDGEx, OSM, satellite, topo)
├── terrain/                 # Terrain/hillshade controls
├── map/                     # map.manager.js, animation.service.js, drag-rotate.handler.js
├── mode/                    # Application mode state machine
├── coordinates/             # Mouse coordinate display
├── grid/                    # UTM grid overlay
├── keyboard/                # Keyboard shortcuts
├── locking/                 # Map lock (controller + locked banner control)
├── deep-link/               # Shareable URL state (deep linking)
├── phone/                   # Mobile/phone-specific UI
├── account/                 # Login + account menu + project-picker entry; sync status light
├── presence/                # Online-users roster + remote cursors + presence store (collaboration)
├── user_data/               # Custom attributes + image management
├── ui/                      # Shared UI utilities
└── utilities/               # Helpers (uuid, deep-utils, toast, event-cleanup, etc.)
```

## UI Architecture

- **StateManager** enforces mutual exclusivity: sidebar and feature panel cannot both be open
- UI components subscribe to `UI_LAYOUT_CHANGED` for position updates
- `selectFeature()` (`state_manager.js`) replaces the active selection set; the feature panel opens/closes via `FEATURE_PANEL_OPENED/CLOSED`, not by `selectFeature` itself

## Measurement Tools

Ephemeral (non-persistent) tools that do NOT follow the 3-file tool pattern. Shared modules: `measurement-geometry.js` (calculations), `measurement-labels.js` (MapLibre layers), `measurement-results-panel.js` (UI). Shortcuts: J (distance), H (area), X (angle). Distance/area can "Salvar como feicao" to persist.

## Point Label

Points can render a text label (`showLabel`) with props `labelText`, `labelColor`, `labelSize`, `labelOutlineColor`, `labelOutlineWidth`, plus zoom-correction props (`labelZoomCorrectionEnabled`, `labelCreatedAtZoom`, `labelCalculatedSize`) that keep the label a constant visual size across zoom. Rendered via `point-label-layer` (alongside `point-layer` + `point-marker-layer`); the panel "Etiqueta" tab is built with `tool_manager/helpers/label-tab.helpers.js`.

## Sync / Real-Time Collaboration

The `store/sync/` client is **fully wired** to an optional backend (`ebgeo_backend`: Express + PostgreSQL + `ws`, JWT auth). The app still runs **anonymous** (nobody logged in) — but NOT without a reachable backend: boot is fail-fast on `GET /api/config` (`src/js/index.js`), with no static fallback. *(This section previously described the layer as "no-op / offline-only / no backend exists" — that is no longer true.)* Operations carry a Lamport clock (advances the local clock only — **not used for conflict resolution**; this is server-authoritative LWW-by-arrival, **not a true CRDT**); queue compaction: CREATE+DELETE=remove both, CREATE+UPDATEs=merge.

**Transport & orchestration**
- `api-client.js` — REST `/api/v1` (login/refresh/logout, `listAtlas`/`createAtlas`/`getAtlas`, sharing, `searchUsers`, `pushOperations`/`pullSync`, images). Tokens in-memory (`_accessToken`/`_refreshToken`).
- `ws-client.js` — real `WebSocket` to `/api/v1/collab?atlasId&token&clientId`; heartbeat (ping/pong), exponential-backoff reconnect, `sync_request` replay, inbound op de-dupe by own `clientId`.
- `sync-engine.js` (`syncEngine`) — lifecycle: `login` → `connect(atlasId,{initialPull})` (snapshot + WS) → `flush`/`pull` → `disconnect`/`logoutAndDisconnect`.
- `sync-flush.js` — outbound flush (1.5s interval + `FLUSH_TRIGGER_EVENTS`), gated on `connectionState.isOnline()`; batches via `apiClient.pushOperations`. `runtime-config.js` resolves base URL; `image-sync.js` syncs image blobs.

**Outbound** — store ops call `logXxxOperation` directly (`operation-dispatcher.js`; feature ops log inside the `runTransaction` deferAsync) → `operation-queue.js` (IndexedDB queue `ebgeo/operation_queue`, compaction, auto-purge) using `operation-factory.js` (Lamport clock + persisted `clientId`). Op types in `operation-types.js`.

**Inbound** — `remote-operation-handler.js` `applyRemoteOperation` routes by entityType, persists via the repo, emits the matching lifecycle event + `REMOTE_OPERATION_APPLIED`. `applyRemoteSnapshot` reshapes the backend snapshot (snake_case→camelCase) on `connect`. 3D/360 inbound **persists** into the per-map cesium3d/streetview360 side-stores (then emits the `*_CHANGED` event) and is LWW-guarded like features — a peer converges on a live 3D/360 op (NOT emit-only; an earlier note here said otherwise — that was wrong).

**Identity / connection / permissions**
- `session-context.js` (`sessionContext`) — OFFLINE/ONLINE; JWT `userId`+role (owner/admin/editor/viewer); offline = anonymous `clientId` with full local perms.
- `connection-state.js` (`connectionState`) — real state machine `OFFLINE→CONNECTING→ONLINE→RECONNECTING`, driven by `ws-client.js`.
- `event-bridges.js` — bridges both singletons to `SESSION_CHANGED` / `CONNECTION_STATE_CHANGED`.
- `permission-guard.js` — role gate (permissive offline). `sync-gateway.js` — inbound relay (early-returns when offline). `sync-scheduler.js` — **now a no-op shell** kept for call-site stability (outbound owned by `sync-flush.js`).

**Entry points & UI** — `account/account.control.js` (login modal → `openProjectPicker` → `clearAllDataStore` → `connect` → `startAutoFlush`; logout → `logoutAndDisconnect`), `account/sync-status.control.js` (connection light, hidden when anonymous), `presence/` (online-users roster + remote cursors + presence store), `modals/{login,project-picker,sharing}.modal.js`, `sidebar/tabs/maps.tab.js` ("Abrir do servidor" + share button).

**Conflict model** — LWW by **server arrival order** (not timestamp); idempotency by `op_id`. Backend entity writes are **sync-only** (no REST write routes for feature/map/layer/group/briefing/slide). Operating model & principles (offline-first, local-vs-remote separation, atlas isolation, network resilience): `docs/wiki/index.md`. Full multi-user action map: `docs/wiki/index.md`.

**Sync — accurate current state (most earlier "gaps" are resolved):**
- Tokens **persist in `localStorage`**; session + last remote atlas **restored on boot/F5** (`restoreSessionFromStorage`, `reconnectLastAtlas`); the refresh-rotation / 401-retry path (`apiClient.refresh`) IS reachable on boot.
- Remote-atlas data is **cleared on logout/disconnect**; the boot guard discards orphan remote data found while logged out. The local↔remote split is the **store-origin marker** (`store-origin.js`), NOT per-atlas namespacing — **multiple named local atlases are a deliberate non-goal** (local = one workspace + `.ebgeo`; named atlases are a server concept; see `docs/wiki/index.md` P12).
- The local default map `Principal` is name-keyed: non-UUID-context ops are dropped pre-flush (anti-leak); on `connect`, `activateAtlasInitialMap` removes non-UUID local strays (so a same-named server map isn't shadowed); `getAllMapNamesStore` resolves UUID keys → names.
- Remote layer/3D/360 ops **and** snapshots persist into their dedicated side-stores and refresh the active-map layer cache (P11 round-trip fidelity).
- Permission role gate applies only to a **connected remote atlas** — the local store is always editable, even logged in.
- **By design, client-driven:** `auth.logout` revokes only the refresh token; the collab socket close + presence teardown happen on the client.

**SyncLedger (sync observability — test/dev only, never prod)** — an additive, env-gated tracing layer that makes the multi-user pipeline visible end-to-end. A `traceId` is minted per user gesture in `runTransaction` (`store-transaction.js`) and stamped onto the op envelope (`operation-factory.js`); typed **spans** are recorded to a ring buffer keyed by `op.id` (the always-works join key). Lives in `store/sync/diag/`: `trace-stages.js` (shared FE/BE stage/outcome/reason contract), `trace-core.js` (`record()` — zero-cost when off — + ring `window.__ebgeoSyncTrace`, Node-safe), `bus-tap.js` (a first-class `EventEmitter.onAny()` tap → `remote.applied` + a `render.source` UI-effect probe). Spans come from `operation-dispatcher.js` (`preflush.drop`/`enqueue`), `sync-engine.js` (`flush.push` + `push.ack` — the previously-dropped ack response is now consumed), `ws-client.js` (`ws.inbound`/`ws.self-echo`/`conn.transition`) and `sync-gateway.js` (`gateway.gate`); installed from `store/services.js` + `index.js`. The backend mirrors the contract (`utils/sync-trace.js` + `GET/DELETE /api/v1/debug/trace`) so Playwright `collectLedger` merges both rings by `op.id`/`traceId`. Gated by `?trace=sync`/`localStorage`/test init script (FE) and `EBGEO_TRACE=1`/`NODE_ENV=test` (BE) — production is a dead branch. Test helpers in `tests/e2e-ui/helpers/{trace-helpers,ledger}.js`. End-to-end sync architecture (transport, op envelope, flows, backend) + SyncLedger as-built: `docs/wiki/index.md`.

## Vite Chunks

Defined in `vite.config.js` `manualChunks`. The composite chunks below list only the headline modules — each pulls in many more (e.g. `core` also includes state, terrain, baselayers, catalog, tool_manager, mode, briefing, snapping, grid, coordinates, measurement_tool):

`core` (store, events, utilities, layers, toolbar, modals, …) | `ui-components` (sidebar, features_tab, search, …) | `draw-tools` (+ azimuth_distance_tool) | `military-tools` | `analysis-tools` | `selection-tools` | `phone-ui` | `cesium-integration` (lazy) | `import-export` (lazy) | `street-view` (lazy).

Unmapped paths (e.g. `keyboard`, `map/map.manager`) fall into the entry bundle.

## Event Types Reference

App events are defined in `events/event_types.js` and accessed via `EventTypes.XXX`. Representative categories (not exhaustive):
- **Entity lifecycle**: `FEATURE_CREATED/MODIFIED/DELETED`, `LAYER_CREATED/MODIFIED/DELETED`, `MAP_CREATED/MODIFIED/DELETED`, `GROUP_CREATED/MODIFIED/DELETED`, `BRIEFING_CREATED/UPDATED/DELETED`. Plus `LAYERS_CHANGED` (active-map layer set changed) and `FEATURE_UPDATED` (feature user-data/attribute/image changes — distinct from `FEATURE_MODIFIED`).
- **UI coordination**: `SIDEBAR_EXPANDED/COLLAPSED`, `SIDEBAR_TAB_CHANGED`, `FEATURE_PANEL_OPENED/CLOSED`, `UI_LAYOUT_CHANGED`, `UI_CLOSE_ALL_POPUPS`, `TOOLBAR_GROUP_OPENED/CLOSED`, `BASE_LAYER_CHANGED`, `MAP_LOCK_CHANGED`
- **Briefing**: `BRIEFING_EDIT_STARTED/ENDED`, `BRIEFING_PRESENT_STARTED/ENDED`, `BRIEFING_SLIDE_CHANGED`
- **Processing**: `PROCESSING_STARTED/COMPLETED/ERROR`
- **Temporal**: `MAP_TEMPORAL_CHANGED` (per-map control toggled), `TEMPORAL_CONFIG_CHANGED` (unit/bounds/origin changed), `TEMPORAL_CURSOR_CHANGED` (cursor moved — emitted per playback frame)
- **Session/Sync**: `SESSION_CHANGED`, `CONNECTION_STATE_CHANGED` (live collaboration state), `REMOTE_OPERATION_APPLIED` (a peer's op was applied to the local store)
- **3D viewer**: `VIEWER_3D_OPENED/CLOSED`, `MARKER_3D_CLICKED`, `VIEWSHED_3D_CLICKED/DESELECTED`, `VIEWSHEDS_3D_CHANGED`
- **360 viewer**: `STREETVIEW_360_OPENED/CLOSED`, `MARKER_360_*`, `ORIENTATION_360_*`

**Store-error events** are separate — defined in `store/store-errors.js` as `StoreErrorEvents` (not `event_types.js`): `STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`.
