# EBGeo Web

GIS web para o Exército Brasileiro. MapLibre GL JS (2D) + Cesium (3D, lazy) + Three.js (360, lazy). Vanilla JS (ES modules, no framework), Vite, IndexedDB via LocalForage. Runs fully **offline/anonymous** by default; an **optional backend** (`ebgeo_backend` — Express + PostgreSQL + `ws`) adds login, server-hosted atlases, sharing, and **real-time multi-user collaboration** (see *Backend & Real-Time Sync*).

Detailed references live in `.claude/rules/` (`architecture.md`, `common-tasks.md`, `testing.md`) and `.claude/skills/` (`new-tool`, `store-op`).

## Non-negotiable

- **NEVER commit.** No `git add` / `git commit` / `git push` — the user reviews and commits manually.
- **Do NOT use preview or browser tools.** The user tests UI manually; verify only via `npm run lint` and `npm test`.
- **Protected files** (a PreToolUse hook blocks edits): `package-lock.json`, `.env`, `deploy/`, `public/vendors/`.

## Commands

```bash
npm run dev          # Dev server (port 3000)
npm run build        # Production build (deploy/deploy.sh)
npm run lint         # ESLint (--max-warnings 0) + Stylelint
npm run lint:fix     # Auto-fix lint issues
npm test             # Vitest (single run)
npm run test:watch   # Vitest watch mode
npm run test:coverage# Coverage report (no blocking threshold)
npm run knip         # Dead-code detection
npm run preview      # Preview production build
npm run clean        # Clean build artifacts
```

Edited `.js`/`.css` files are auto-linted by a PostToolUse hook — expect lint output after each write.

## Imports

Path aliases only — never relative `../../`:
`@/` (src root), `@js/`, `@store/`, `@utils/`, `@tools/`, `@toolbar/`, `@modals/`, `@sidebar/`, `@layers/`, `@catalog/`, `@ui/`, `@events/`, `@state/`, `@css/`.
Each module folder exposes a public `index.js` barrel.

## Language

- **UI strings** (labels, tooltips, messages): Portuguese (pt-BR), correct accents.
- **Code comments / JSDoc**: English.
- **Feature properties**: Portuguese — `nome`, `descricao`, `visivel`, `bloqueado`.

## Code Quality

- **No inline styles in JS.** Use BEM classes in CSS files (`className`, `classList.add/remove`), never `style.cssText` or `style.xxx = '...'`. Exception: runtime-computed values (colors from JS, calculated positions).
- **XSS:** never `innerHTML` with user data — use `textContent` or `document.createElement`. Import `escapeHtml` from `@utils/html-escape.js` when interpolating user data into HTML. Static SVG icons are OK.
- **Event/resource cleanup:** use `setupCleanup/subscribe/addDomListener/trackTimer/cleanup` from `@utils/event-cleanup.js`. Pair every MapLibre `map.on()` with `map.off()` in `onRemove()`; `.destroy()` Cesium handlers in cleanup; clear `setTimeout`/`setInterval`; clean context-menu listeners on hide/close.
- **Required utilities:** `deepClone()` (`@utils/deep-utils.js`, not `JSON.parse(JSON.stringify(...))`); `showToast(msg, type)` (`@utils`, not `alert()`); `generateUUID()` (`@utils/uuid.js`) for all IDs; `EventTypes.XXX` constants, never hardcoded event strings.
- **File path comment** on line 1 of every JS file, relative to `src/`: `// Path: js/draw_tools/point_tool/add_point_control.js`. Never remove it.
- **Dead code:** remove unused imports, commented-out code, and no-op functions. No `_`-prefix aliasing.

## Key Patterns

**Tool (3 files)** — each draw/military tool: `add_*_control.js` (MapLibre IControl) + `add_*_geometry.js` (geometry logic) + `*_attributes_panel.js` (property editor). Scaffold with the `new-tool` skill.

**Store transaction** — mutations are persistence-first; side effects run only after IndexedDB succeeds:
```javascript
await runTransaction(async (tx) => {
    tx.deferSync(() => updateColorTracking(feature));  // UI / color tracking
    tx.deferAsync(() => logFeatureOperation(...));      // logging / sync queue
    return async () => { await repo.set(key, data); };  // persistence — runs FIRST
});
```
Order: persistence → deferSync → deferAsync. If persistence throws, no side effects run. Details in the `store-op` skill.

**Store errors** — invalid argument (bug): `throw new Error(msg)`; expected failure (locked map): `return` + emit `STORE_OPERATION_BLOCKED`; data-loss risk (IndexedDB): `throw` + emit `STORE_PERSIST_ERROR`. Store-error events come from `StoreErrorEvents` in `store/store-errors.js`.

**Events**
```javascript
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
getEventBus().on(EventTypes.FEATURE_UPDATED, handler);
getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: null });
```

**Services** — call `initServices()` (from `@store/services.js`) before any component, then use `getEventBus()` / `getStateManager()` / `getLayerManager()`.

**Control registry** — `registerControl('myTool', instance)` / `getControl('myTool')` from `@store`.

## Feature Types

`point`, `line`, `polygon`, `circle`, `ellipse`, `rectangle`, `sector`, `text`, `image`, `brush`, `arrow`, `boundary`, `occupied_front`, `military_symbol`, `coordination_measure`, `magnetic_declination`, `los`, `visibility`.

## Data Model

- **Atlas** (top-level project container) → **Maps** (workspaces) → **Layers** (feature containers with visibility + locked states) → **Features** (geographic elements with sync metadata: `createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`).
- The active layer receives new features; layers emit `LAYERS_CHANGED`.
- Projects are saved as `.ebgeo` files.
- Briefing slides reference 3D models via `modelId` (not `tilesetId`).
- **Temporal data** (optional, per feature): `temporalInicio`/`temporalFim` (validity window, epoch ms — absent = permanent) and `trajetoria` (moving-feature keypoints `{t, lng, lat}`, epoch ms; point/military_symbol/coordination_measure). Per-map temporal config is stored separately (see Temporal Module).

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` (editor) | `BRIEFING_PRESENT` (presentation). Managed by `ApplicationModeManager` (`mode/application-mode.manager.js`); mode changes drive UI visibility profiles.

## Backend & Real-Time Sync

> The `store/sync/` layer is **fully wired** to an optional backend (`ebgeo_backend`). It is **not** a no-op — earlier docs that called it "offline-only / future infra" were stale. The app still runs fully offline/anonymous when nobody logs in. **Operating model & principles** (offline-first, local-vs-remote separation, atlas isolation, migration safety, network resilience): `docs/visao-e-principios.md`.

- **Transport** — `api-client.js` (REST `/api/v1`: `login`/`refresh`/`logout`, `listAtlas`/`createAtlas`/`getAtlas`, sharing, `searchUsers`, `pushOperations`/`pullSync`, images) + `ws-client.js` (real `WebSocket` to `/api/v1/collab`; heartbeat, backoff reconnect, replay). `runtime-config.js` resolves the base URL; `image-sync.js` syncs image blobs.
- **Orchestration** — `sync-engine.js` (singleton `syncEngine`): `login` → `connect(atlasId, {initialPull})` (snapshot pull + WS) → `flush`/`pull` → `disconnect`/`logoutAndDisconnect`. Outbound flushing in `sync-flush.js` (1.5s interval **and** `FLUSH_TRIGGER_EVENTS`), gated on `connectionState.isOnline()`.
- **Outbound** — store mutations call `logXxxOperation` directly (`operation-dispatcher.js`; feature ops log inside the `runTransaction` deferAsync) → `operation-queue.js` (IndexedDB queue, compaction, Lamport via `operation-factory.js`) → `apiClient.pushOperations` (`POST /atlas/:id/sync`). Op envelope `{id, entityType, operationType, entityId, mapId, data, lamportTimestamp, clientId}`; types in `operation-types.js`.
- **Inbound** — `remote-operation-handler.js` `applyRemoteOperation` persists to the repo + emits the matching lifecycle event (`FEATURE_CREATED`/`MAP_CREATED`/`LAYERS_CHANGED`/…) then `REMOTE_OPERATION_APPLIED`. `applyRemoteSnapshot` reshapes the backend snapshot (snake_case→camelCase) on connect. (3D/360 inbound is emit-only.)
- **Identity/state** — `session-context.js` (`sessionContext`: OFFLINE/ONLINE; JWT `userId`+role owner/admin/editor/viewer; offline = anonymous `clientId`, full local perms) + `connection-state.js` (`connectionState`: real state machine `OFFLINE→CONNECTING→ONLINE→RECONNECTING`, driven by `ws-client.js`). Bridged to the EventBus by `event-bridges.js` as `SESSION_CHANGED` / `CONNECTION_STATE_CHANGED`. `permission-guard.js` gates store ops (permissive offline). `sync-scheduler.js` is now a **no-op shell** (outbound is owned by `sync-flush.js`).
- **UI** — login + account menu + project picker in `account/account.control.js`; connection light in `account/sync-status.control.js` (hidden when anonymous); presence (online-users roster, remote cursors) in `presence/`; sharing in `modals/sharing.modal.js`; "Abrir do servidor" + share button in `sidebar/tabs/maps.tab.js`.
- **Conflict model** — LWW by **server arrival order** (not timestamp); idempotency by `op_id`. Backend entity writes are **sync-only** (no REST write routes for feature/map/layer/group/briefing/slide).

**Sync — accurate current state (this area moved fast; the old "known gaps" are mostly resolved):** JWT tokens **persist in `localStorage`**, and the session + last remote atlas are **restored on boot/F5** (`restoreSessionFromStorage`, `reconnectLastAtlas`; the 401-refresh rotation path is reachable on boot). Remote-atlas data is **cleared on logout/disconnect**, and the boot guard discards orphan remote data found while logged out (`store-origin.js` + `clearAllDataStore`). The local↔remote split is the **store-origin marker**, NOT per-atlas IndexedDB namespacing — **multiple named local atlases are a deliberate non-goal** (local = one workspace + `.ebgeo`; named atlases are a server concept; see `docs/visao-e-principios.md` P12). The local default map `Principal` is name-keyed: ops with a non-UUID context `mapId` are dropped before the flush queue (anti-leak), on `connect` `activateAtlasInitialMap` removes non-UUID local strays so a same-named server map isn't shadowed, and `getAllMapNamesStore` resolves UUID keys → names. Remote layer/3D/360 ops **and** snapshots persist into their dedicated side-stores and refresh the active-map layer cache (P11 round-trip fidelity). The permission role gate applies only to a **connected remote atlas** — the local store is always editable, even when logged in. **By design, client-driven:** `auth.logout` revokes only the refresh token, so the collab socket close + presence teardown happen on the client.

## Temporal Module

Timeline control per map (`temporal/`). Lives in `temporal-controller.js` (playback/cursor) + `temporal-render.service.js` (filters + trajectory positions) + `temporal-model.js` (pure math, node-testable) + `temporal-derivation.service.js` (auto symbol attrs) + `trajectory-tool/` (line-tool-style keypoint editing).

- **Per-map config** persisted under `temporal_<mapName>` (appStore, like map-lock), shape `{ ativo, modo, unidade, inicio, fim, origem }`. Ops in `store/temporal.operations.js` (`getMapTemporalConfigSync` for hot paths, `setMapTemporalConfig`, `toggleMapTemporal`). Emits `MAP_TEMPORAL_CHANGED` (on `ativo` flip) + `TEMPORAL_CONFIG_CHANGED`; cursor moves emit `TEMPORAL_CURSOR_CHANGED`.
- **Pure-lens model:** absolute epoch ms is canonical; `modo` (absoluto/relativo D+N), `unidade`, and `origem` (D-origin) are display lenses that NEVER mutate feature times. Moving features in time is the explicit "Reagendar" action only: `shiftMapTemporalTimes` (store) + `shiftSourcesTemporal` (live source) — it shifts `temporalInicio`/`temporalFim` + every trajectory `t` and re-derives auto DTG.
- **Hot path (playback):** runs every rAF — keep it lean. Apply is coalesced (in-flight guard); show/hide filters are quantized to the timeline step in `layers/visibility-filter.js` (rebuild only on step boundaries); trajectory interpolation normalizes once per feature per frame. Reset trajectory caches via `resetTrajectoryCache()` on resync.
- **Derivation is image-only:** auto direction/speed/DTG on military symbols regenerate the symbol PNG (`generateSymbolBlob` + `loadImageToMap`) and MUST NOT write the GeoJSON source or store — that would race the per-frame geometry pass. Rotation is left fully manual (never auto-driven).

## CSS

All CSS in `src/css/` (BEM naming; component files mirror JS module names; `briefing/` subfolder). Use the custom properties in `design-tokens.css` (layout dimensions, colors, z-index, transitions) instead of hardcoded values. Animate with `transform: translateX()`, never `left` (avoids layout thrashing).

## External Dependencies (script tags)

MapLibre GL JS, Turf.js, milsymbol, Cesium (on demand), GDAL (PDF export).
