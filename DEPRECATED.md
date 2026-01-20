# Deprecated Files - EBGeo UI Redesign

This document lists components and code paths deprecated after the Phase 1-11 UI redesign.
These items can be safely removed after confirming the new implementation is stable.

## Overview

The UI redesign introduced:
- **Collapsible sidebar** with 4 tabs (Maps, Layers, Import, Export)
- **Reorganized toolbar** with grouped drawing, military, and analysis tools
- **Bottom controls** with feature toggles and navigation buttons
- **Base layer selector** with thumbnail previews
- **New modals** for shortcuts and information
- **Chips component** for quick actions

## CSS Files

### Hidden via CSS (in `map-controls.css`)

The following controls are hidden via CSS because their functionality is now provided by new components:

#### BottomControlsControl replaces:
- `.terrain-control.controls-column-left`
- `.models3d-view-control.controls-bottom-left`
- `.street-view-control.controls-bottom-left`

#### ToolbarControl replaces:
- `.point-control.controls-column-right`
- `.line-control.controls-column-right`
- `.polygon-control.controls-column-right`
- `.text-control.controls-column-right`
- `.image-control.controls-column-right`
- `.rectangle-control.controls-column-right`
- `.circle-control.controls-column-right`
- `.ellipse-control.controls-column-right`
- `.brush-control.controls-column-right`
- `.arrow-control.controls-column-right`
- `.boundary-control.controls-column-right`
- `.occupied-front-control.controls-column-right`
- `.military-symbol-control.controls-column-right`
- `.coordination-measure-control.controls-column-right`
- `.los-control.controls-column-left`
- `.visibility-control.controls-column-left`
- `.vector-info-control.controls-column-left`
- `.rectangle-selection-control.controls-column-left`

#### Sidebar replaces:
- `.import-control.controls-column-left`
- `.screenshot-control.controls-column-left`

### CSS Files to Monitor

Old positioning styles in `map-controls.css` can be removed after full migration:
- `.controls-column-left` positioning rules
- `.controls-column-right` positioning rules
- `.controls-bottom-left` positioning rules

## JavaScript Components

### Old Modal System

The legacy modal system (`KeyboardShortcuts.initModal()`, `SuggestionsModal`) is still functional
but new modals are now created by `ChipsComponent`:

- **Legacy:** `KeyboardShortcuts.showModal()` (in `keyboard/keyboard_shortcuts.js`)
- **New:** `ShortcutsModal` (in `modals/shortcuts.modal.js`)

- **Legacy:** `SuggestionsModal` (in `ui/suggestions_modal.js`)
- **New:** `InfoModal` (in `modals/info.modal.js`)

### Control Button Rendering

Old controls still render their buttons but they are hidden via CSS. The controls themselves
remain functional for:
- Keyboard shortcuts (each tool has an associated shortcut)
- Selection manager integration
- Internal tool logic

The new `ToolbarControl` calls the same `activate()` method on controls when a tool is selected.

## HTML Elements

### Elements to Review

Check `index.html` for old elements that may no longer be needed:
- Old modal containers (if any exist outside of dynamic creation)
- Static toolbar button containers

## Removal Timeline

**Recommended approach:**

1. **Week 1-2:** Monitor new UI for issues in development
2. **Week 3:** Deploy to staging environment
3. **Week 4:** User acceptance testing
4. **After 2 weeks of stability:** Begin code cleanup

### Safe to Remove After Validation

1. Old CSS positioning rules for hidden controls
2. Legacy modal HTML (if static in `index.html`)
3. Duplicate functionality code paths

### Keep Indefinitely

1. Core control classes (`AddPointControl`, etc.) - still used for tool logic
2. `SelectionManager`, `ToolManager`, `UIManager` - core infrastructure
3. Event system (`EventBus`, `EventTypes`)
4. State management (`StateManager`)

## Feature Flags

For quick rollback, add to `config.js`:

```javascript
features: {
    newUI: true  // Set to false for legacy UI
}
```

Then in `map_sig.js`:

```javascript
if (config.features?.newUI !== false) {
    // Initialize new UI components
    sidebarControl.init(document.body);
    toolbarControl.init(document.body);
    // ...
}
```

## New Components Reference

| Component | Location | Purpose |
|-----------|----------|---------|
| `SidebarControl` | `js/sidebar/sidebar.control.js` | Collapsible sidebar |
| `ChipsComponent` | `js/sidebar/components/chips.component.js` | Quick action chips |
| `ToolbarControl` | `js/toolbar/toolbar.control.js` | Tool groups |
| `BottomControlsControl` | `js/bottom-controls/bottom-controls.control.js` | Feature toggles + nav |
| `BaseLayerSelectorControl` | `js/base-layer-selector/base-layer-selector.control.js` | Base layer picker |
| `SearchBarComponent` | `js/search/search-bar.component.js` | Repositioned search |
| `ShortcutsModal` | `js/modals/shortcuts.modal.js` | Keyboard shortcuts |
| `InfoModal` | `js/modals/info.modal.js` | Information/about |

## Architecture Changes

### State Management

All UI state now flows through `StateManager`:
- `sidebar.expanded`, `sidebar.activeTab`
- `ui.featurePanelOpen`
- `ui.activeToolbarGroup`
- `ui.baseLayerSelectorOpen`

### Event Flow

UI coordination uses `EventBus`:
- `SIDEBAR_EXPANDED`, `SIDEBAR_COLLAPSED`, `SIDEBAR_TAB_CHANGED`
- `FEATURE_PANEL_OPENED`, `FEATURE_PANEL_CLOSED`
- `TOOLBAR_GROUP_OPENED`, `TOOLBAR_GROUP_CLOSED`
- `BASE_LAYER_SELECTOR_OPENED`, `BASE_LAYER_SELECTOR_CLOSED`
- `UI_LAYOUT_CHANGED`, `UI_CLOSE_ALL_POPUPS`

### Mutual Exclusivity

`StateManager` enforces mutual exclusivity:
- Sidebar and Feature Panel cannot both be open
- Only one toolbar group popup can be open at a time
- `closeAllPopups()` method for atomic cleanup

---

**Last Updated:** Phase 11 Integration & Cleanup
