# EBGeo — monorepo

GIS web para o Exército Brasileiro. **Um repositório, dois pacotes:**

| Pacote | Onde | O quê |
|--------|------|-------|
| **web** (este arquivo) | raiz (`src/`, `tests/`) | SPA local-first: MapLibre GL JS (2D) + Cesium (3D, lazy) + Three.js (360, lazy). Vanilla JS (ES modules, sem framework), Vite, IndexedDB via LocalForage. |
| **backend** | [`backend/`](backend/) | Express + PostgreSQL/PostGIS + `ws`. Login, atlas hospedados, compartilhamento e colaboração em tempo real. **Tem CLAUDE.md próprio** — leia [`backend/CLAUDE.md`](backend/CLAUDE.md) antes de mexer lá. |

**LOGIN é opcional; o SERVIDOR não é.** O app roda **anônimo** (sem login) — dados no IndexedDB, `.ebgeo`, sync inerte — e nenhuma mudança pode quebrar esse caminho. Mas o boot é **fail-fast em `GET /api/config`** (`src/js/index.js`): sem backend alcançável, 3 tentativas e a tela "EBGeo indisponível"; o app não roda. `config.js` é só o *shape* que o servidor hidrata — **não há fallback estático**. Depois do boot, toda a edição segue local-first (ver *Backend & Real-Time Sync*).

Detailed references live in `.claude/rules/` (`architecture.md`, `common-tasks.md`, `testing.md`) and `.claude/skills/` (`new-tool`, `store-op`).

> **Mudança que cruza os dois pacotes** (envelope de sync, `GET /api/config`, permissões, contratos congelados) precisa ser verificada **dos dois lados no mesmo commit** — é justamente o que o monorepo passou a permitir. O E2E (`npm run test:e2e:ui`) sobe o backend real a partir de `backend/` e é o guarda dessa fronteira.

## Non-negotiable

- **Do NOT use preview or browser tools.** The user tests UI manually; verify only via `npm run lint` and `npm test`.
- **Protected files** (a PreToolUse hook blocks edits): `package-lock.json`, `.env`, `deploy/`, `public/vendors/`.

## Commands

**Só o frontend** (não precisa de Postgres):

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

**Monorepo** (backend exige PostgreSQL + PostGIS + superusuário para os testes):

```bash
npm run install:all  # instala os dois pacotes
npm run dev:all      # sobe backend + frontend juntos
npm run dev:backend  # só o backend (node --watch)
npm run test:all     # suíte dos dois
npm run test:backend # só o backend (cria/dropa ebgeo_test)
npm run lint:all     # lint dos dois
npm run test:e2e:ui  # Playwright: sobe o backend REAL de backend/ e dirige o browser
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
- **Spatial comments** (collaboration): root/reply/resolve threads via `store/comment.operations.js` (overlay + panel in `comment_tool/`); `Shift+C` toggles placement.
- **Temporal data** (optional, per feature): `temporalInicio`/`temporalFim` (validity window, epoch ms — absent = permanent) and `trajetoria` (moving-feature keypoints `{t, lng, lat}`, epoch ms; point/military_symbol/coordination_measure). Per-map temporal config is stored separately (see Temporal Module).

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` (editor) | `BRIEFING_PRESENT` (presentation). Managed by `ApplicationModeManager` (`mode/application-mode.manager.js`); mode changes drive UI visibility profiles.

## Backend & Real-Time Sync

> The `store/sync/` layer is **fully wired** to the optional `ebgeo_backend` (REST + real `WebSocket`); the app still runs **anonymous** (no login) when nobody logs in — but NOT without a reachable backend: boot is fail-fast on `GET /api/config`. **Full detail (transport, op envelope, boot/restore, Principal name-keying) lives in `.claude/rules/architecture.md` §Sync; operating principles in `docs/wiki/index.md`.** Below are only the non-negotiables.

- **Transport/orchestration** — `api-client.js` (REST `/api/v1`) + `ws-client.js` (`WebSocket` `/api/v1/collab`), driven by `sync-engine.js`; outbound flush in `sync-flush.js` (gated on `connectionState.isOnline()`), inbound apply in `remote-operation-handler.js`. 3D/360 inbound **persists** into the cesium3d/streetview360 side-stores (and emits), so peers converge on live 3D/360 ops.
- **Backend entity writes are sync-only** — no REST write routes for feature/map/layer/group/briefing/slide; mutations travel as operations (`operation-dispatcher.js` → `operation-queue.js`; types in `operation-types.js`).
- **Conflict = LWW by server arrival order** (not timestamp); idempotency by `op_id`. Server-authoritative, **not a true CRDT** — the server defines total order; the Lamport clock is recorded but never decides conflicts. LWW granularity is the **whole feature**, not per-property.
- **Local↔remote split is the store-origin marker** (`store-origin.js`), NOT per-atlas IndexedDB namespacing — multiple named local atlases are a deliberate non-goal (local = one workspace + `.ebgeo`; `docs/wiki/index.md` P12). Remote-atlas data is cleared on logout/disconnect; the role gate applies only to a **connected remote atlas** (the local store is always editable).
- **Identity/state** — `session-context.js` (OFFLINE/ONLINE + JWT role) + `connection-state.js` (state machine), bridged as `SESSION_CHANGED`/`CONNECTION_STATE_CHANGED`; `permission-guard.js` gates ops (permissive offline). `sync-scheduler.js` is a **no-op shell** (outbound owned by `sync-flush.js`). UI: `account/`, `presence/`, `modals/sharing.modal.js`, `sidebar/tabs/maps.tab.js`.
- **Client-driven socket lifecycle** — `auth.logout` revokes only the refresh token; the collab socket close + presence teardown happen on the client.
- **SyncLedger** (sync observability, **test/dev only**, gated) — `store/sync/diag/` stamps a `traceId` per gesture and records correlated spans (keyed by `op.id`) to `window.__ebgeoSyncTrace` via `EventEmitter.onAny`; merges with the backend ring (`/api/v1/debug/trace`) in Playwright. Detail in `.claude/rules/architecture.md` §Sync; end-to-end sync architecture + SyncLedger as-built in `docs/wiki/index.md`.

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
