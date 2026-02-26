# EBGeo Web

GIS web para o Exercito Brasileiro. MapLibre GL JS (2D) + Cesium (3D) + Three.js (360). Vanilla JS, Vite, IndexedDB via LocalForage.

## Commands

```bash
npm run dev          # Dev server (port 3000)
npm run build        # Production build via deploy/deploy.sh
npm run lint         # ESLint + Stylelint (--max-warnings 0)
npm run lint:fix     # Auto-fix lint issues
npm test             # Vitest
npm run test:watch   # Vitest watch mode
npm run knip         # Dead code detection
npm run preview      # Preview production build
npm run clean        # Clean build artifacts
```

## Imports

Use path aliases — never relative `../../`:
`@/` (src root), `@js/`, `@store/`, `@utils/`, `@tools/`, `@toolbar/`, `@modals/`, `@sidebar/`, `@layers/`, `@catalog/`, `@ui/`, `@events/`, `@state/`, `@css/`

Each module folder has an `index.js` barrel for public exports.

## Language Rules

- **UI strings** (labels, tooltips, messages): Portuguese (pt-BR) with correct accents
- **Code comments and JSDoc**: English
- Feature properties use Portuguese: `nome`, `descricao`, `visivel`, `bloqueado`

## Code Quality

### No Inline Styles in JS
Use CSS files with BEM classes (`className`, `classList.add/remove`). Never `style.cssText` or `style.xxx = '...'`.
**Exception**: dynamic values computed at runtime (colors from JS, calculated positions).

### XSS Prevention
Never `innerHTML` with user data. Use `textContent` or `document.createElement`. Static SVG icons are OK.
Import `escapeHtml` from `@utils/html-escape.js` when interpolating user data into HTML.

### Event Listener Cleanup
Use `setupCleanup/subscribe/addDomListener/trackTimer/cleanup` from `@utils/event-cleanup.js`.
- MapLibre `map.on()` → matching `map.off()` in `onRemove()`
- Cesium handlers → `.destroy()` in cleanup
- `setTimeout` → cleared in cleanup
- Context menu listeners → cleaned in hide/close function

### Required Utilities
- `deepClone()` from `@utils/deep-utils.js` (not `JSON.parse(JSON.stringify(...))`)
- `showToast(msg, type)` from `@utils` (not `alert()`)
- `generateUUID()` from `@utils/uuid.js` for all IDs
- `EventTypes.XXX` constants (not hardcoded strings)

### Dead Code
Remove unused imports, commented-out code, and no-op functions. No `_` prefix aliasing.

## Key Patterns

### Tool Pattern (3 files)
Each draw/military tool: `add_*_control.js` (MapLibre IControl) + `add_*_geometry.js` (geometry logic) + `*_attributes_panel.js` (property editor).

### Store Transaction Pattern
Feature operations use persistence-first coordination. Side effects only run after IndexedDB succeeds:
```javascript
await runTransaction(async (tx) => {
    tx.deferSync(() => updateColorTracking(feature));
    tx.deferAsync(() => logFeatureOperation(...));
    return async () => { await repo.set(key, data); };
});
```

### Store Error Conventions
- Invalid argument (bug): `throw new Error(msg)`
- Expected failure (locked map): return + emit `STORE_OPERATION_BLOCKED`
- Possible data loss (IndexedDB): throw + emit `STORE_PERSIST_ERROR`

### Event System
```javascript
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
eventBus.on(EventTypes.FEATURE_UPDATED, handler);
eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
```

### Services Initialization
```javascript
import { initServices, getEventBus, getStateManager, getLayerManager } from '@store/services.js';
initServices(); // Must be called before any component
```

### Control Registry
```javascript
import { getControl, registerControl } from '@store';
registerControl('myTool', instance);
const ctrl = getControl('myTool');
```

## Feature Types

`'point'`, `'line'`, `'polygon'`, `'circle'`, `'ellipse'`, `'rectangle'`, `'sector'`, `'text'`, `'image'`, `'brush'`, `'arrow'`, `'boundary'`, `'occupied_front'`, `'military_symbol'`, `'coordination_measure'`, `'los'`, `'visibility'`

## Data Model

- **Atlas** → top-level project container
- **Maps** → workspaces within Atlas
- **Layers** → feature containers (visibility + locked states)
- **Features** → geographic elements with sync metadata (`createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`)
- Active layer receives new features. Layers emit `LAYERS_CHANGED`.
- Projects saved as `.ebgeo` files.
- Briefing slides use `modelId` (not `tilesetId`) for 3D references.

## Application Modes

`NORMAL` (default) | `BRIEFING_EDIT` (editor) | `BRIEFING_PRESENT` (presentation). Mode changes trigger UI visibility profiles via `ApplicationModeManager`.

## CSS Files

All CSS in `src/css/` (~27 files, plus `briefing/` subfolder). `design-tokens.css` defines CSS custom properties (layout dimensions, colors, z-index, transitions) — use tokens instead of hardcoded values. Component CSS uses BEM naming and matches JS module names.

## Preview

**Do NOT use preview tools.** The user tests UI changes manually. Verify code changes via `npm run lint` and `npm test` only.

## Git

**NEVER commit.** The user reviews all changes and commits manually. Do not run `git add`, `git commit`, or `git push`.

## External Dependencies (script tags)

MapLibre GL JS, Turf.js, milsymbol, Cesium (on demand), GDAL (PDF export).
