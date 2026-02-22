# Phone Responsive Design

**Date**: 2026-02-22
**Branch**: feature/tablet-responsive
**Breakpoint**: `@media (max-width: 480px)`
**Approach**: Google Maps clone — full-screen map, draggable bottom sheet, floating controls

## Context

The app has solid tablet responsive support (breakpoints at 1024px, 768px, 600px) with touch-specific handling via `pointer: coarse`. Phone screens (320-480px) need a fundamentally different layout since scaling down the tablet UI doesn't work at this size.

**Scope**: Light editing — view, navigate, search, select features, move features, edit properties. No drawing tools, military tools, analysis, or measurement on phone.

## Design Principles

- Inspired by Google Maps mobile: clean, only the essentials
- Map is the hero — maximize screen real estate
- Bottom sheet is the universal container for all non-map content
- Touch-first interactions (no hover, generous tap targets)
- Progressive disclosure — show less, reveal on demand

## Screen Layout

```
┌─────────────────────────┐
│  ┌───────────────────┐  │  Floating search pill
│  │ 🔍 Pesquisar...   │  │  (top, 16px margins, 48px tall)
│  └───────────────────┘  │
│                         │
│              [📍]       │  FAB: My Location
│              [🗺️]       │  FAB: Base Layer
│                         │
│       FULL SCREEN MAP   │
│                         │
│                         │
├─────────────────────────┤  Bottom sheet (draggable)
│  ━━━                    │  Drag handle
│  Atlas: "Projeto X"     │  Peek state: ~64px
│  2 mapas · 5 camadas    │
└─────────────────────────┘
```

## Components

### 1. Full-Screen Map

- `width: 100vw; height: 100vh` with safe area padding
- No sidebar at all — `display: none` for `.sidebar-container`
- No toolbar — `display: none` for `.toolbar-container`
- No bottom controls — `display: none` for `.bottom-controls-*`
- Map compass overlay (small, top-right, only visible when map is rotated)

### 2. Floating Search Bar

**Default state**: Pill shape, white bg, subtle shadow, 48px height, full width minus 32px margins.

**Active state**: Tapping expands into a full-screen search overlay:
- Top bar: back arrow + input field (active, keyboard opens)
- Below: recent results + search results as scrollable list
- Each result item: 56px min-height (touch target)
- Tap result → map flies to location, overlay closes
- Tap back or swipe → closes, returns to map

**Auto-hide**: Hides during active map pan/zoom gestures. Reappears after 1s of inactivity.

### 3. Bottom Sheet

The central UI container. Uses `touch-action: none` on the handle for drag, CSS `transform: translateY()` for smooth animation.

**Snap points**:
| State | Height | Content |
|-------|--------|---------|
| Peek  | 64px   | Drag handle, map name, layer count, coordinates |
| Half  | 45vh   | Tabs: Visao Geral, Camadas, Mais |
| Full  | 90vh   | Full content with scroll |

**Sheet behavior**:
- Always present (never fully dismisses)
- Swipe up/down transitions between states
- Tap peek → half
- Tap empty map → collapses to peek
- Feature tap → snaps to half with feature detail
- Spring physics for natural feel (CSS `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)`)

**Sheet content tabs** (visible at half and full):

**Visao Geral tab**:
- Current atlas/map name
- Layer count summary
- Quick map switcher (if multiple maps)

**Camadas tab**:
- Layer list with visibility toggles (eye icon)
- Layer lock indicators
- Tap layer → shows contained features
- No layer reordering on phone (too fiddly)

**Mais tab**:
- Base layer selector (grid of 4 thumbnails)
- Coordinate format selector
- Project info

### 4. Feature Selection & Editing

**Selection flow**:
1. User taps feature on map
2. Feature highlights (existing selection manager)
3. Bottom sheet snaps to half height
4. Content switches to feature detail view

**Feature detail view**:
```
┌──────────────────────────┐
│ 🔷 Polígono "Nome"       │  Type icon + feature name
│ Camada: "Camada 1"       │  Parent layer
│ [Editar] [Mover]         │  Action chips (48px height)
├──────────────────────────┤
│ Propriedades              │
│ Cor: ████ #508D4E         │
│ Opacidade: 80%            │
│ Descricao: "texto..."     │
└──────────────────────────┘
```

**Edit mode** (tap "Editar"):
- Sheet expands to full height
- Property fields become editable inputs
- Save button at bottom (sticky, always visible)
- Cancel → reverts, sheet returns to feature view

**Move mode** (tap "Mover"):
- Sheet collapses to peek
- Feature enters drag mode (touch-move on map)
- FABs replaced by [Confirmar] / [Cancelar] action buttons
- Confirm → saves new position, returns to feature view
- Cancel → reverts position

**Deselect**: Tap empty map area → sheet returns to overview content.

### 5. FABs (Floating Action Buttons)

Two buttons, right edge, vertically stacked:

| Button | Icon | Size | Action |
|--------|------|------|--------|
| My Location | 📍 (crosshair) | 48px | Geolocate + fly to user position |
| Base Layer | 🗺️ (layers) | 48px | Tap: cycle base layers. Long-press: picker |

- Position: `right: 16px`, vertically centered between search bar and bottom sheet peek
- White background, border-radius 50%, box-shadow
- 8px gap between them
- Move up when bottom sheet expands past their position

### 6. Coordinates Display

Integrated into the bottom sheet peek bar (right-aligned):
```
┌──────────────────────────────────┐
│ ━━━  Atlas: "Proj"   -23.5, -46.6│
└──────────────────────────────────┘
```
- Small text (12px), muted color
- Shows map center coordinates in current format
- Tap to cycle format (DMS → DD → UTM)

### 7. Context Menu (Long Press)

- Existing long-press handler works at phone size
- Menu items: 48px min-height, 16px font
- Positioned near touch point, constrained to viewport
- Reduced menu items on phone (only relevant actions)

### 8. Toasts & Modals

- Toasts: positioned above bottom sheet peek (bottom: 80px)
- Modals: already full-screen at ≤768px, no changes needed

## Hidden Elements (display: none at ≤480px)

| Element | CSS Selector | Reason |
|---------|-------------|--------|
| Sidebar | `.sidebar-container` | Replaced by bottom sheet |
| Toolbar | `.toolbar-container` | No drawing tools on phone |
| Bottom controls left | `.bottom-controls-left` | Terrain/3D/360 not on phone |
| Bottom controls right | `.bottom-controls-right` | Zoom via pinch, location via FAB |
| Attribute table | `.attribute-table-panel` | Not in phone scope |
| Desktop search bar | `.search-bar` | Replaced by floating pill |
| Drawing touch controls | `.drawing-touch-controls` | No drawing on phone |
| Measurement UI | `.measurement-*` | Not in phone scope |
| Coordinates control | `.coordinates-control` | Integrated into bottom sheet |

## CSS Architecture

### New Breakpoint Token
```css
--breakpoint-phone: 480px
```

### New Phone CSS File
`src/css/phone.css` — dedicated file for phone-only styles (not added to responsive.css to keep separation clean).

### New CSS Components
- `.phone-search-bar` — floating pill + full-screen overlay
- `.phone-bottom-sheet` — draggable sheet with snap points
- `.phone-fab` — floating action buttons
- `.phone-sheet-tabs` — tab navigation inside bottom sheet

### Approach
All phone styles scoped under `@media (max-width: 480px)`. Uses existing design tokens where possible. New tokens for phone-specific dimensions:
```css
--phone-sheet-peek: 64px;
--phone-sheet-half: 45vh;
--phone-sheet-full: 90vh;
--phone-search-height: 48px;
--phone-fab-size: 48px;
```

## JS Architecture

### New Module: `src/js/phone/`
- `phone-bottom-sheet.js` — sheet component with drag, snap, spring animation
- `phone-search-overlay.js` — full-screen search experience
- `phone-layout.js` — orchestrator that hides desktop UI and initializes phone components
- `phone-feature-editor.js` — feature detail/edit view inside bottom sheet

### Integration Points
- `phone-layout.js` checks `window.matchMedia('(max-width: 480px)')` on init
- Listens for resize/orientation change to switch between phone and tablet modes
- Reuses existing store operations, event bus, selection manager, state manager
- Bottom sheet subscribes to `FEATURE_SELECTED`, `LAYERS_CHANGED`, `UI_LAYOUT_CHANGED`

### No Changes to Existing Components
Phone module is additive. Desktop/tablet components are hidden via CSS, phone components are shown. No modifications to sidebar.control.js, toolbar.control.js, etc. — they just become `display: none`.

## Gesture Map

| Gesture | Context | Action |
|---------|---------|--------|
| Tap | Map (empty) | Deselect, collapse sheet to peek |
| Tap | Map (feature) | Select feature, sheet to half |
| Tap | Search pill | Open search overlay |
| Tap | Sheet peek | Expand to half |
| Swipe up | Sheet | Next snap point |
| Swipe down | Sheet | Previous snap point |
| Swipe left | Sheet (feature view) | Deselect feature |
| Long press | Map | Context menu |
| Pinch | Map | Zoom |
| Two-finger rotate | Map | Rotate |
| Drag | Map | Pan |
| Drag | Feature (move mode) | Reposition feature |

## Performance Considerations

- Bottom sheet uses `transform: translateY()` (GPU-accelerated, no layout thrashing)
- `will-change: transform` on sheet during drag
- Search overlay uses `position: fixed` (no reflow)
- FABs use `position: fixed` with `transform` for repositioning
- Feature list in bottom sheet uses virtual scrolling if >50 items
- Touch event handlers use `{ passive: true }` where possible

## Out of Scope (Phone)

- Drawing/creation tools (point, line, polygon, etc.)
- Military symbols and coordination measures
- Analysis tools (LOS, visibility)
- Measurement tools
- Attribute table
- 3D viewer (Cesium)
- 360 viewer (Street View)
- Briefing editor/presenter
- Import/Export (except viewing existing data)
- Processing algorithms
- Terrain toggles
