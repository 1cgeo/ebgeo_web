# Phone Responsive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Google Maps-inspired phone layout (<=480px) with full-screen map, draggable bottom sheet, floating search, and FABs — scoped to light editing (view, navigate, select, move, edit properties).

**Architecture:** CSS-first hiding of desktop/tablet UI at <=480px. New `src/js/phone/` module with bottom sheet, search overlay, and layout orchestrator. Phone components are additive — no modifications to existing sidebar, toolbar, or bottom controls JS. Reuses store, event bus, selection manager, state manager.

**Tech Stack:** Vanilla JS, CSS custom properties, `matchMedia` for phone detection, touch events for drag gestures, `transform: translateY()` for GPU-accelerated sheet animation.

**Design doc:** `docs/plans/2026-02-22-phone-responsive-design.md`

---

### Task 1: CSS Foundation — Design Tokens & Phone Breakpoint

**Files:**
- Modify: `src/css/design-tokens.css` (add phone tokens after line 38)
- Modify: `src/css/responsive.css` (add phone section hiding desktop UI)
- Create: `src/css/phone.css` (phone-specific component styles)
- Modify: `src/css/style.css` (import phone.css)

**Step 1: Add phone tokens to design-tokens.css**

After the existing breakpoint tokens (`--breakpoint-desktop: 1024px;` around line 38), add:

```css
--breakpoint-phone: 480px;

/* Phone layout dimensions */
--phone-sheet-peek: 64px;
--phone-sheet-half: 45vh;
--phone-sheet-full: 90vh;
--phone-search-height: 48px;
--phone-fab-size: 48px;
--phone-spacing: 16px;
```

**Step 2: Add phone hiding rules to responsive.css**

After the `@media (width <= 768px)` section (around line 509), before landscape rules, add a new section:

```css
/* =========================================================================
   PHONE BREAKPOINT (<=480px)
   Full-screen map with bottom sheet, floating search, FABs.
   Desktop/tablet UI hidden entirely — replaced by phone/ JS module.
   ========================================================================= */

@media (width <= 480px) {
    /* Hide desktop/tablet UI */
    .sidebar-container {
        display: none !important;
    }

    .toolbar-container {
        display: none !important;
    }

    .bottom-controls-left,
    .bottom-controls-right {
        display: none !important;
    }

    .search-bar {
        display: none !important;
    }

    .coordinates-control {
        display: none !important;
    }

    .drawing-touch-controls {
        display: none !important;
    }

    .attribute-table-panel {
        display: none !important;
    }

    .base-layer-selector {
        display: none !important;
    }

    /* Full-screen map */
    #map-sig {
        width: 100vw !important;
        height: 100vh !important;
        left: 0 !important;
    }

    /* MapLibre controls cleanup */
    .maplibregl-ctrl-top-left,
    .maplibregl-ctrl-bottom-left,
    .maplibregl-ctrl-bottom-right {
        display: none !important;
    }

    /* Keep compass only, position top-right */
    .maplibregl-ctrl-top-right {
        top: calc(var(--phone-search-height) + var(--safe-area-top) + 24px);
        right: var(--phone-spacing);
    }
}
```

**Step 3: Create phone.css with component placeholders**

Create `src/css/phone.css`:

```css
/* =========================================================================
   PHONE UI COMPONENTS
   Only rendered at <=480px via phone/ JS module.
   ========================================================================= */

/* ---------- Phone Search Bar ---------- */

.phone-search-bar {
    display: none;
}

@media (width <= 480px) {
    .phone-search-bar {
        display: flex;
        position: fixed;
        top: calc(var(--safe-area-top, 0px) + 12px);
        left: var(--phone-spacing);
        right: var(--phone-spacing);
        height: var(--phone-search-height);
        background: var(--white);
        border-radius: 28px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        align-items: center;
        padding: 0 16px;
        gap: 12px;
        z-index: var(--z-search);
        transition: opacity 0.2s ease;
        cursor: pointer;
    }

    .phone-search-bar--hidden {
        opacity: 0;
        pointer-events: none;
    }

    .phone-search-bar__icon {
        width: 20px;
        height: 20px;
        color: var(--gray-500);
        flex-shrink: 0;
    }

    .phone-search-bar__placeholder {
        font-size: 16px;
        color: var(--gray-400);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}

/* ---------- Phone Search Overlay ---------- */

.phone-search-overlay {
    display: none;
}

@media (width <= 480px) {
    .phone-search-overlay {
        position: fixed;
        inset: 0;
        background: var(--white);
        z-index: var(--z-modal);
        flex-direction: column;
    }

    .phone-search-overlay--active {
        display: flex;
    }

    .phone-search-overlay__header {
        display: flex;
        align-items: center;
        padding: calc(var(--safe-area-top, 0px) + 8px) 8px 8px;
        gap: 4px;
        border-bottom: 1px solid var(--gray-100);
    }

    .phone-search-overlay__back {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--gray-700);
        cursor: pointer;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .phone-search-overlay__back:active {
        background: var(--gray-100);
    }

    .phone-search-overlay__input {
        flex: 1;
        height: 48px;
        border: none;
        outline: none;
        font-size: 16px;
        color: var(--gray-900);
        background: transparent;
    }

    .phone-search-overlay__results {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
    }

    .phone-search-overlay__result-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        min-height: 56px;
        cursor: pointer;
        border-bottom: 1px solid var(--gray-50);
    }

    .phone-search-overlay__result-item:active {
        background: var(--gray-50);
    }

    .phone-search-overlay__result-icon {
        width: 24px;
        height: 24px;
        color: var(--gray-400);
        flex-shrink: 0;
    }

    .phone-search-overlay__result-text {
        font-size: 15px;
        color: var(--gray-800);
    }

    .phone-search-overlay__result-subtitle {
        font-size: 13px;
        color: var(--gray-400);
        margin-top: 2px;
    }

    .phone-search-overlay__section-title {
        padding: 16px 16px 8px;
        font-size: 12px;
        font-weight: 600;
        color: var(--gray-400);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
}

/* ---------- Phone Bottom Sheet ---------- */

.phone-bottom-sheet {
    display: none;
}

@media (width <= 480px) {
    .phone-bottom-sheet {
        display: flex;
        flex-direction: column;
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: var(--phone-sheet-full);
        background: var(--white);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.12);
        z-index: var(--z-panel);
        transform: translateY(calc(var(--phone-sheet-full) - var(--phone-sheet-peek)));
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform;
        overflow: hidden;
    }

    .phone-bottom-sheet--dragging {
        transition: none;
    }

    .phone-bottom-sheet--half {
        transform: translateY(calc(var(--phone-sheet-full) - var(--phone-sheet-half)));
    }

    .phone-bottom-sheet--full {
        transform: translateY(0);
        border-radius: 0;
    }

    .phone-bottom-sheet__handle-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 16px 4px;
        cursor: grab;
        touch-action: none;
        user-select: none;
        flex-shrink: 0;
    }

    .phone-bottom-sheet__handle {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: var(--gray-300);
    }

    .phone-bottom-sheet__peek-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px 12px;
        flex-shrink: 0;
    }

    .phone-bottom-sheet__peek-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--gray-900);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .phone-bottom-sheet__peek-subtitle {
        font-size: 12px;
        color: var(--gray-400);
        margin-top: 2px;
    }

    .phone-bottom-sheet__peek-coords {
        font-size: 11px;
        color: var(--gray-400);
        font-family: monospace;
        flex-shrink: 0;
        cursor: pointer;
    }

    .phone-bottom-sheet__tabs {
        display: flex;
        border-bottom: 1px solid var(--gray-100);
        padding: 0 16px;
        flex-shrink: 0;
    }

    .phone-bottom-sheet__tab {
        flex: 1;
        padding: 12px 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--gray-400);
        text-align: center;
        border: none;
        background: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.15s, border-color 0.15s;
    }

    .phone-bottom-sheet__tab--active {
        color: var(--primary-600, #508D4E);
        border-bottom-color: var(--primary-600, #508D4E);
    }

    .phone-bottom-sheet__tab:active {
        background: var(--gray-50);
    }

    .phone-bottom-sheet__content {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        padding: 16px;
    }

    /* Layer list inside sheet */
    .phone-layer-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 0;
        min-height: 48px;
        border-bottom: 1px solid var(--gray-50);
    }

    .phone-layer-item__name {
        flex: 1;
        font-size: 15px;
        color: var(--gray-800);
    }

    .phone-layer-item__toggle {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--gray-500);
        cursor: pointer;
        border-radius: 50%;
    }

    .phone-layer-item__toggle--visible {
        color: var(--primary-600, #508D4E);
    }

    .phone-layer-item__toggle:active {
        background: var(--gray-100);
    }

    /* Feature detail inside sheet */
    .phone-feature-detail {
        padding: 0;
    }

    .phone-feature-detail__header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--gray-100);
    }

    .phone-feature-detail__icon {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .phone-feature-detail__name {
        font-size: 17px;
        font-weight: 600;
        color: var(--gray-900);
    }

    .phone-feature-detail__layer {
        font-size: 13px;
        color: var(--gray-400);
        margin-top: 2px;
    }

    .phone-feature-detail__actions {
        display: flex;
        gap: 8px;
        padding: 12px 0;
    }

    .phone-feature-detail__action-btn {
        flex: 1;
        height: 44px;
        border-radius: 22px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--gray-200);
        background: var(--white);
        color: var(--gray-700);
        transition: background 0.15s;
    }

    .phone-feature-detail__action-btn:active {
        background: var(--gray-100);
    }

    .phone-feature-detail__action-btn--primary {
        background: var(--primary-600, #508D4E);
        color: var(--white);
        border-color: var(--primary-600, #508D4E);
    }

    .phone-feature-detail__action-btn--primary:active {
        background: var(--primary-700, #3d6e3b);
    }

    .phone-feature-detail__props {
        padding-top: 12px;
    }

    .phone-feature-detail__prop-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid var(--gray-50);
        min-height: 44px;
    }

    .phone-feature-detail__prop-label {
        font-size: 14px;
        color: var(--gray-500);
    }

    .phone-feature-detail__prop-value {
        font-size: 14px;
        color: var(--gray-900);
        text-align: right;
    }
}

/* ---------- Phone FABs ---------- */

.phone-fab-container {
    display: none;
}

@media (width <= 480px) {
    .phone-fab-container {
        display: flex;
        flex-direction: column;
        position: fixed;
        right: var(--phone-spacing);
        bottom: calc(var(--phone-sheet-peek) + 16px + var(--safe-area-bottom, 0px));
        gap: 8px;
        z-index: var(--z-controls);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .phone-fab-container--shifted {
        transform: translateY(calc(-1 * (var(--phone-sheet-half) - var(--phone-sheet-peek) - 16px)));
    }

    .phone-fab {
        width: var(--phone-fab-size);
        height: var(--phone-fab-size);
        border-radius: 50%;
        background: var(--white);
        border: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: var(--gray-700);
        transition: transform 0.15s;
    }

    .phone-fab:active {
        transform: scale(0.92);
    }

    .phone-fab__icon {
        width: 22px;
        height: 22px;
    }

    /* Move mode action buttons */
    .phone-move-actions {
        display: none;
    }

    .phone-move-actions--active {
        display: flex;
        position: fixed;
        bottom: calc(var(--phone-sheet-peek) + 16px + var(--safe-area-bottom, 0px));
        left: var(--phone-spacing);
        right: var(--phone-spacing);
        gap: 12px;
        z-index: var(--z-controls);
    }

    .phone-move-actions__btn {
        flex: 1;
        height: 48px;
        border-radius: 24px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        border: none;
    }

    .phone-move-actions__btn--confirm {
        background: var(--primary-600, #508D4E);
        color: var(--white);
    }

    .phone-move-actions__btn--cancel {
        background: var(--gray-200);
        color: var(--gray-700);
    }
}
```

**Step 4: Import phone.css in style.css**

Find the CSS imports in `src/css/style.css` and add at the end:

```css
@import './phone.css';
```

**Step 5: Run lint**

Run: `npm run lint`
Expected: Pass with 0 warnings (or only the pre-existing `bottom-controls.control.js` warning)

**Step 6: Commit**

```bash
git add src/css/design-tokens.css src/css/responsive.css src/css/phone.css src/css/style.css
git commit -m "feat(phone): add CSS foundation — tokens, hide rules, phone component styles"
```

---

### Task 2: Phone Bottom Sheet Component

**Files:**
- Create: `src/js/phone/phone-bottom-sheet.js`

**Step 1: Implement the bottom sheet**

Create `src/js/phone/phone-bottom-sheet.js` — a self-contained component that manages:
- DOM creation (handle, peek content, tabs, scrollable content area)
- Touch drag gesture with velocity-based snap (peek/half/full)
- State transitions via `transform: translateY()`
- Coordinates display in peek bar (subscribes to map `moveend`)
- Tab switching (Visao Geral / Camadas / Mais)
- Feature detail view (when a feature is selected)
- Integration with EventBus for `FEATURE_PANEL_OPENED`, `LAYERS_CHANGED`, `UI_LAYOUT_CHANGED`

Key implementation details:
- `touch-action: none` on handle for drag control
- Velocity tracking: record last 3 touch positions, compute velocity on `touchend`
- If velocity > threshold, snap in swipe direction; otherwise snap to nearest point
- `translateY` values: peek = `sheetHeight - 64px`, half = `sheetHeight - 45vh`, full = `0`
- During drag: remove CSS transition (class `--dragging`), apply transform directly
- On release: re-add transition, snap to target
- Map name/layer count from store: `import { getAllMaps, getLayersByMap } from '@store'`
- Coordinates: listen to `map.on('moveend')` and read `map.getCenter()`

```javascript
import { setupCleanup, subscribe, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';

const SNAP_VELOCITY_THRESHOLD = 0.5;
const SNAP_POINTS = { PEEK: 'peek', HALF: 'half', FULL: 'full' };

export class PhoneBottomSheet {
    constructor({ map, store }) {
        this._map = map;
        this._store = store;
        this._state = SNAP_POINTS.PEEK;
        this._container = null;
        this._dragStartY = 0;
        this._dragCurrentY = 0;
        this._isDragging = false;
        this._touchHistory = [];
        this._activeTab = 'overview';
        this._selectedFeature = null;
        this._cleanupFns = [];
        setupCleanup(this);
    }

    // ... full implementation
}
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: Pass

**Step 3: Commit**

```bash
git add src/js/phone/phone-bottom-sheet.js
git commit -m "feat(phone): add bottom sheet component with drag, snap, tabs"
```

---

### Task 3: Phone Search Overlay Component

**Files:**
- Create: `src/js/phone/phone-search-overlay.js`

**Step 1: Implement search overlay**

Create `src/js/phone/phone-search-overlay.js` — manages:
- Floating search pill (default state)
- Full-screen search overlay (active state)
- Reuses existing search logic from `src/js/search/feature-search.control.js` (imports search functions)
- Auto-hide during map pan/zoom (listen to `map.on('movestart')` / `map.on('moveend')`)
- Result tap → `map.flyTo()` + close overlay

Key pattern:
- Pill tap → create/show overlay, focus input, open keyboard
- Back button or swipe → close overlay, blur input
- Result tap → emit selection event, fly to coordinates, close

```javascript
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';

export class PhoneSearchOverlay {
    constructor({ map, searchService }) {
        this._map = map;
        this._searchService = searchService;
        this._pillElement = null;
        this._overlayElement = null;
        this._isActive = false;
        this._isHidden = false;
        this._cleanupFns = [];
        setupCleanup(this);
    }

    // ... full implementation
}
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: Pass

**Step 3: Commit**

```bash
git add src/js/phone/phone-search-overlay.js
git commit -m "feat(phone): add search overlay with pill and full-screen mode"
```

---

### Task 4: Phone FABs Component

**Files:**
- Create: `src/js/phone/phone-fabs.js`

**Step 1: Implement FABs**

Create `src/js/phone/phone-fabs.js` — two floating action buttons:
- My Location: uses `navigator.geolocation.getCurrentPosition()` + `map.flyTo()`
- Base Layer: tap cycles through base layers, long-press opens picker
- Repositions when bottom sheet expands (listens to sheet state changes)

```javascript
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { showToast } from '@utils';

export class PhoneFabs {
    constructor({ map, baseLayerControl }) {
        this._map = map;
        this._baseLayerControl = baseLayerControl;
        this._container = null;
        this._cleanupFns = [];
        setupCleanup(this);
    }

    // ... full implementation
}
```

**Step 2: Run lint & commit**

```bash
git add src/js/phone/phone-fabs.js
git commit -m "feat(phone): add FAB buttons for location and base layer"
```

---

### Task 5: Phone Feature Editor Component

**Files:**
- Create: `src/js/phone/phone-feature-editor.js`

**Step 1: Implement feature detail/edit view**

Renders inside the bottom sheet when a feature is selected:
- Feature header (type icon, name, layer)
- Action chips: Editar, Mover
- Property list (read-only by default)
- Edit mode: inputs for properties, sticky save button
- Move mode: collapses sheet, enters drag mode, shows confirm/cancel
- Subscribes to `FEATURE_SELECTED` / `FEATURE_MODIFIED` / `FEATURE_PANEL_CLOSED`
- Uses existing `updateFeature()` from `@store` for saves

```javascript
import { getFeatureById, updateFeature } from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, subscribe, cleanup } from '@utils/event-cleanup.js';

export class PhoneFeatureEditor {
    constructor({ map, bottomSheet }) {
        this._map = map;
        this._bottomSheet = bottomSheet;
        this._currentFeature = null;
        this._isEditing = false;
        this._isMoving = false;
        this._cleanupFns = [];
        setupCleanup(this);
    }

    // ... full implementation
}
```

**Step 2: Run lint & commit**

```bash
git add src/js/phone/phone-feature-editor.js
git commit -m "feat(phone): add feature editor component for detail/edit/move"
```

---

### Task 6: Phone Layout Orchestrator

**Files:**
- Create: `src/js/phone/phone-layout.js`
- Create: `src/js/phone/index.js` (barrel export)
- Modify: `src/js/index.js` (conditionally init phone layout)

**Step 1: Implement layout orchestrator**

`phone-layout.js` is the entry point that:
- Checks `window.matchMedia('(max-width: 480px)')`
- If phone: creates and mounts all phone components (bottom sheet, search, FABs, feature editor)
- Listens for `matchMedia` change events to handle orientation/resize transitions
- Manages lifecycle: init on phone, destroy on tablet/desktop transition

```javascript
import { PhoneBottomSheet } from './phone-bottom-sheet.js';
import { PhoneSearchOverlay } from './phone-search-overlay.js';
import { PhoneFabs } from './phone-fabs.js';
import { PhoneFeatureEditor } from './phone-feature-editor.js';

const PHONE_QUERY = '(max-width: 480px)';

export class PhoneLayout {
    constructor({ map, store, searchService, baseLayerControl }) {
        this._map = map;
        this._deps = { map, store, searchService, baseLayerControl };
        this._isPhone = false;
        this._components = {};
        this._mediaQuery = window.matchMedia(PHONE_QUERY);
    }

    init() {
        this._handleMediaChange(this._mediaQuery);
        this._mediaQuery.addEventListener('change', (e) => this._handleMediaChange(e));
    }

    _handleMediaChange(mq) {
        const matches = mq.matches ?? mq;
        if (matches && !this._isPhone) {
            this._activatePhoneMode();
        } else if (!matches && this._isPhone) {
            this._deactivatePhoneMode();
        }
    }

    _activatePhoneMode() {
        this._isPhone = true;
        // Create and mount phone components
        this._components.bottomSheet = new PhoneBottomSheet(this._deps);
        this._components.search = new PhoneSearchOverlay(this._deps);
        this._components.fabs = new PhoneFabs(this._deps);
        this._components.featureEditor = new PhoneFeatureEditor({
            ...this._deps,
            bottomSheet: this._components.bottomSheet,
        });

        // Mount to body
        Object.values(this._components).forEach(c => c.mount(document.body));
    }

    _deactivatePhoneMode() {
        this._isPhone = false;
        // Destroy all phone components
        Object.values(this._components).forEach(c => c.destroy());
        this._components = {};
    }

    destroy() {
        this._deactivatePhoneMode();
        this._mediaQuery.removeEventListener('change', this._handleMediaChange);
    }
}
```

**Step 2: Create barrel export**

Create `src/js/phone/index.js`:

```javascript
export { PhoneLayout } from './phone-layout.js';
```

**Step 3: Integrate in app initialization**

In `src/js/index.js`, after `createControls()` (around line 43), add phone layout initialization:

```javascript
import { PhoneLayout } from './phone/phone-layout.js';
```

Then in the init flow, after controls are created:

```javascript
// Phone responsive layout
const phoneLayout = new PhoneLayout({
    map: mapInstance,
    store,
    searchService: getControl('featureSearch'),
    baseLayerControl: getControl('baseLayerSelector'),
});
phoneLayout.init();
```

Note: Exact integration point depends on how `createControls` returns/exposes the map instance and controls. Check `map_sig.js` for the return values.

**Step 4: Run lint & build**

Run: `npm run lint && npm run build`
Expected: Both pass

**Step 5: Commit**

```bash
git add src/js/phone/ src/js/index.js
git commit -m "feat(phone): add layout orchestrator and wire into app init"
```

---

### Task 7: Vite Chunk Configuration

**Files:**
- Modify: `vite.config.js`

**Step 1: Add phone chunk**

In `vite.config.js`, inside the `manualChunks(id)` function (around line 50), add a rule before the existing chunk assignments:

```javascript
// Phone UI (lazy via matchMedia)
if (id.includes('/phone/')) {
    return 'phone-ui';
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds, `phone-ui` chunk appears in output

**Step 3: Commit**

```bash
git add vite.config.js
git commit -m "feat(phone): add phone-ui chunk to Vite config"
```

---

### Task 8: Visual Testing & Polish

**Step 1: Test at phone viewport (375x812)**

Use browser DevTools or preview tool to verify:
- [ ] Desktop UI elements are hidden
- [ ] Bottom sheet renders with peek state (64px)
- [ ] Search pill visible at top
- [ ] FABs visible on right side
- [ ] Map fills full viewport

**Step 2: Test bottom sheet interactions**

- [ ] Drag handle expands sheet from peek → half → full
- [ ] Swipe down collapses full → half → peek
- [ ] Tap peek expands to half
- [ ] Tabs switch between Visao Geral / Camadas / Mais
- [ ] Layer visibility toggles work

**Step 3: Test search**

- [ ] Tap search pill opens full-screen overlay
- [ ] Input focuses and keyboard opens
- [ ] Results appear as user types
- [ ] Tap result flies to location
- [ ] Back button closes overlay

**Step 4: Test feature selection**

- [ ] Tap feature on map highlights it
- [ ] Bottom sheet shows feature detail
- [ ] Edit mode shows editable fields
- [ ] Move mode allows dragging feature
- [ ] Confirm/cancel work correctly

**Step 5: Test FABs**

- [ ] My Location button geolocates
- [ ] Base layer button cycles layers
- [ ] FABs reposition when sheet expands

**Step 6: Test transitions**

- [ ] Rotate phone to landscape — UI adapts
- [ ] Resize from phone to tablet — phone UI destroys, tablet UI shows
- [ ] Resize from tablet to phone — tablet UI hides, phone UI creates

**Step 7: Final lint & build**

Run: `npm run lint && npm run build`
Expected: Both pass with no new warnings

**Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix(phone): polish responsive layout and fix visual issues"
```

---

## Task Dependency Graph

```
Task 1 (CSS Foundation)
    ├── Task 2 (Bottom Sheet)
    ├── Task 3 (Search Overlay)
    ├── Task 4 (FABs)
    └── Task 5 (Feature Editor) ── depends on Task 2
              │
              v
        Task 6 (Layout Orchestrator) ── depends on Tasks 2-5
              │
              v
        Task 7 (Vite Chunks)
              │
              v
        Task 8 (Testing & Polish)
```

Tasks 2, 3, 4 can be implemented in parallel after Task 1.
Task 5 depends on Task 2 (bottom sheet reference).
Task 6 integrates everything.
Task 7 is independent but logical after Task 6.
Task 8 is final verification.
