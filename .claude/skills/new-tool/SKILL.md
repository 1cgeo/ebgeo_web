---
name: new-tool
description: Use when creating a new draw or military tool, scaffolding the 3-file pattern with control, geometry, and attributes panel
---

# New Tool Scaffold

Scaffolds a draw or military tool following the project's 3-file pattern.

## Folder Structure

```
frontend/src/js/draw_tools/<name>_tool/       # or military_tools/<name>_tool/
  ├── index.js                       # Barrel exports
  ├── add_<name>_control.js          # Extends BaseControl
  ├── add_<name>_geometry.js         # Extends BaseGeometry
  └── <name>_attributes_panel.js     # Property editor function
```

## Step-by-Step

1. **Create control** extending `BaseControl`:
   ```javascript
   import { BaseControl } from '@tools';   // base classes are re-exported from the @tools barrel
   import { Add<Name>Geometry } from './add_<name>_geometry.js';
   import { addFeature, updateFeature } from '@store';
   import { getEventBus } from '@store/services.js';

   export default class Add<Name>Control extends BaseControl {
     featureType = '<name>';   // class field, before the constructor

     constructor(toolManager) {
       super(toolManager);
       this.geometry = new Add<Name>Geometry();
     }

     static DEFAULT_PROPERTIES = {
       fillColor: '#3388ff', opacity: 1, size: 14,
       source: '<name>',
       nome: '', descricao: '',
       visivel: true, bloqueado: false,
       showLabel: false, labelText: ''
     };
   }
   ```

2. **Create geometry** extending `BaseGeometry`:
   ```javascript
   import { BaseGeometry } from '@tools';

   export default class Add<Name>Geometry extends BaseGeometry {
     generate(coordinates) { /* Return GeoJSON geometry */ }
     createHandles(feature) { /* Return edit handles */ }
     updateFromHandle(handleType, newPosition, feature) { /* Handle drag */ }
     validate(data) { /* Return boolean */ }
   }
   ```

3. **Create attributes panel** (export named function — note the `add` prefix and 6-arg signature):
   ```javascript
   export function add<Name>AttributesToPanel(panel, selectedFeatures, <name>Control, selectionManager, uiManager, options = {}) {
     // Build panel using helpers from @tools/helpers/ (color-picker, slider, text-input)
   }
   ```

4. **Create barrel** `index.js`:
   ```javascript
   export { default as Add<Name>Control } from './add_<name>_control.js';
   export { default as Add<Name>Geometry } from './add_<name>_geometry.js';
   export { add<Name>AttributesToPanel } from './<name>_attributes_panel.js';
   ```

5. **Register in `toolbar/toolbar.constants.js`** — add the icon SVG to `TOOLBAR_ICONS` AND a tool-button entry in the group's `tools` array: `{ id, label (pt-BR), icon, shortcut, controlKey }`. The `controlKey` must match the key used in BOTH `controls:` literals of step 6.

6. **Wire up in `map_sig.js` — FOUR edit sites, not three.** `registerControl()` alone does NOT make a toolbar button work. Instantiate (`new Add<Name>Control(toolManager)`), then add the instance to every one of:

   1. `SELECTION_CONTROLS` (→ `selectionManager.registerControl`);
   2. `CONTROL_REGISTRY` (keyed by class name, e.g. `'Add<Name>Control'`);
   3. the `controls:` literal inside `new KeyboardShortcuts({...})`;
   4. the `controls:` literal inside `new ToolbarControl({...})`.

   **3 and 4 are two SEPARATE object literals**, not one object passed twice. They carry the same controls in a DIFFERENT order and nothing ties them together — no shared constant, no test. Adding your control to one and not the other yields a toolbar button with no shortcut (or a shortcut with no button), with no error anywhere. Both are keyed by `controlKey` (e.g. `<name>Control`), and the toolbar resolves its button via `controlKey` against its own map.

7. **Add the feature type — ONE row, in ONE file.** Since 2026-08-16 a type is born in
   `frontend/src/js/store/feature-type.registry.js`: append a row with `type`, `storage`,
   `label` (pt-BR), `icon`, and the four capability flags. **Do not edit
   `store.constants.js`**: its six type constants are derived from that row, so the icon,
   the display name, the singular/plural mapping, box selection, clipboard and the image
   resource all follow for free. `getAllStorageTypes()` picks it up too.

   Then run `npx vitest run tests/unit/registro-tipos-cobertura.test.js` from `frontend/`.
   It goes RED and hands you the rest of the work: it names, in one message, every list
   that promises to carry all types and has not heard of yours (the empty map shape, the
   live MapLibre sources, the feature tab, the import gate, the KMZ classifier, the
   registries of `map_sig.js`, the feature panel header and the feature dropdown). That
   red list is the checklist; there is no second copy of it to keep in sync here, on
   purpose. If your tool touches a file the census does not know, the same test says so
   and asks for a written reason.

   What the census does NOT cover, and you still have to think about: the z-order of the
   calls in `frontend/src/js/layers/layer_setup.js` (ordered by hand, and the symptom of
   getting it wrong is visual), the snapping targets, and the backend, where a type new to
   the SERVER costs four manual edits across two packages (see
   `frontend/tests/unit/tipos-feicao-paridade-pacotes.test.js`).

8. **Add to `vite.config.js`** manual chunks if tool is large.

## Checklist

- [ ] Portuguese UI strings (`nome`, `descricao`, `visivel`, `bloqueado`)
- [ ] English code comments and JSDoc
- [ ] Import aliases (`@store`, `@tools`, `@utils`) in new code. Be aware this is
      **convention, not enforcement**: there is no `no-restricted-imports` rule, and
      roughly one in ten files under `frontend/src/js/` still imports via `../../`, the
      reference tool below among them. (A proportion, not a count: the absolute number
      here aged twice, since both terms move with every commit.) Copy its structure, not
      its import style.
- [ ] Event cleanup in `onRemove()` (map.off, timers, handlers)
- [ ] XSS: use `textContent`, never `innerHTML` with user data
- [ ] CSS: BEM classes in CSS file, no inline styles
- [ ] Store: use `addFeature()` / `updateFeature()` from `@store`
- [ ] IDs: use `generateUUID()` from `@utils/uuid.js`

## Reference

Look at `frontend/src/js/draw_tools/point_tool/` for a complete working example of the
structure, wiring and panel. One caveat: it predates the alias convention and
imports via `../../store` (`frontend/src/js/draw_tools/point_tool/add_point_control.js:3-7`),
so it is the model for everything **except** import style.
