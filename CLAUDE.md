# EBGeo Web

GIS web para o Exército Brasileiro. MapLibre GL JS (2D) + Cesium (3D, lazy) + Three.js (360, lazy). Vanilla JS (ES modules, no framework), Vite, IndexedDB via LocalForage.

Detailed references live in `.claude/rules/` (`architecture.md`, `common-tasks.md`, `testing.md`) and `.claude/skills/` (`new-tool`, `store-op`).

## Non-negotiable

- **NEVER commit.** No `git add` / `git commit` / `git push` — the user reviews and commits manually.
- **Do NOT use preview or browser tools.** The user tests UI manually; verify only via `npm run lint` and `npm test`.
- **Protected files** (a PreToolUse hook blocks edits): `package-lock.json`, `.env`, `deploy/`, `public/vendors/`.

## Commands

```bash
npm run dev          # Dev server (port 3000)
npm run build        # Production build (deploy/deploy.sh)
npm run lint         # ESLint + Stylelint (--max-warnings 0)
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

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` (editor) | `BRIEFING_PRESENT` (presentation). Managed by `ApplicationModeManager` (`mode/application-mode.manager.js`); mode changes drive UI visibility profiles.

## CSS

All CSS in `src/css/` (BEM naming; component files mirror JS module names; `briefing/` subfolder). Use the custom properties in `design-tokens.css` (layout dimensions, colors, z-index, transitions) instead of hardcoded values. Animate with `transform: translateX()`, never `left` (avoids layout thrashing).

## External Dependencies (script tags)

MapLibre GL JS, Turf.js, milsymbol, Cesium (on demand), GDAL (PDF export).
