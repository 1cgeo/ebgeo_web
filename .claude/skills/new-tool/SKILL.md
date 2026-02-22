---
name: new-tool
description: Use when creating a new draw or military tool, scaffolding the 3-file pattern with control, geometry, and attributes panel
---

# New Tool Scaffold

Scaffolds a draw or military tool following the project's 3-file pattern.

## Folder Structure

```
src/js/draw_tools/<name>_tool/       # or military_tools/<name>_tool/
  ├── index.js                       # Barrel exports
  ├── add_<name>_control.js          # Extends BaseControl
  ├── add_<name>_geometry.js         # Extends BaseGeometry
  └── <name>_attributes_panel.js     # Property editor function
```

## Step-by-Step

1. **Create control** extending `BaseControl`:
   ```javascript
   import { BaseControl } from '@tools/base_control.js';
   import { Add<Name>Geometry } from './add_<name>_geometry.js';
   import { addFeature, updateFeature } from '@store';
   import { getEventBus } from '@store/services.js';

   export default class Add<Name>Control extends BaseControl {
     constructor(toolManager) {
       super(toolManager);
       this.featureType = '<name>';
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
   import { BaseGeometry } from '@tools/base_geometry.js';

   export default class Add<Name>Geometry extends BaseGeometry {
     generate(coordinates) { /* Return GeoJSON geometry */ }
     createHandles(feature) { /* Return edit handles */ }
     updateFromHandle(handleType, newPosition, feature) { /* Handle drag */ }
     validate(data) { /* Return boolean */ }
   }
   ```

3. **Create attributes panel** (export named function):
   ```javascript
   export function <name>AttributesToPanel(feature, options) {
     // Build panel using helpers from @tools/helpers/
     // Use color-picker, slider, text-input helpers
   }
   ```

4. **Create barrel** `index.js`:
   ```javascript
   export { default as Add<Name>Control } from './add_<name>_control.js';
   export { default as Add<Name>Geometry } from './add_<name>_geometry.js';
   export { <name>AttributesToPanel } from './<name>_attributes_panel.js';
   ```

5. **Register in `toolbar/toolbar.constants.js`** — add icon SVG entry.

6. **Register in `map_sig.js`** — instantiate and add via `registerControl()`.

7. **Add feature type** to `store` if new type (feature.operations.js mappings).

8. **Add to `vite.config.js`** manual chunks if tool is large.

## Checklist

- [ ] Portuguese UI strings (`nome`, `descricao`, `visivel`, `bloqueado`)
- [ ] English code comments and JSDoc
- [ ] Import aliases (`@store`, `@tools`, `@utils`) — no relative `../../`
- [ ] Event cleanup in `onRemove()` (map.off, timers, handlers)
- [ ] XSS: use `textContent`, never `innerHTML` with user data
- [ ] CSS: BEM classes in CSS file, no inline styles
- [ ] Store: use `addFeature()` / `updateFeature()` from `@store`
- [ ] IDs: use `generateUUID()` from `@utils/uuid.js`

## Reference

Look at `src/js/draw_tools/point_tool/` for a complete working example.
