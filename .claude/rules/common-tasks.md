# Common Tasks

## Adding a New Draw Tool

1. Create folder in `src/js/draw_tools/<tool_name>_tool/`
2. `add_<name>_control.js` extending `BaseControl`
3. `add_<name>_geometry.js` extending `BaseGeometry`
4. `<name>_attributes_panel.js` for property editor
5. Export from `index.js`
6. Register in `map_sig.js`
7. Add to `toolbar/toolbar.constants.js`
8. Add to `vite.config.js` manual chunks if large

## Working with Features

```javascript
import { addFeature, getFeatureById, updateFeature, deleteFeature } from '@store';

await addFeature('polygon', featureData, layerId);
const feature = await getFeatureById('polygon', featureId);
await updateFeature('polygon', featureId, newData);
```

## Adding a New Event

1. Define constant in `events/event_types.js`
2. Emit via `getEventBus().emit(EventTypes.MY_EVENT, payload)`
3. Subscribe via `eventBus.on(EventTypes.MY_EVENT, handler)`

## Adding a Processing Algorithm

1. Create `src/js/processing/algorithms/<name>.algorithm.js`.
2. Build the algorithm definition — required fields: `id`, `name`, `description`,
   `icon`, `category`, `supportedGeometryTypes` (array), `createPanel(deps)`,
   `execute(features, params)`. See `algorithm.interface.js` for the full typedef
   and `buffer.algorithm.js` for a worked example.
3. Call `registerAlgorithm({...})` at module load, then add a side-effect
   `import './<name>.algorithm.js';` to `algorithms/index.js`.
4. Zero changes needed elsewhere.

## Adding a Schema Migration

1. Create `store/migration/v<from>-to-v<to>.migration.js` exporting
   `migrateToV<to>()` (e.g. `v2-to-v3.migration.js` → `migrateToV3()`). Existing
   migrations: `v1-to-v2`, `v2-to-v2.1`.
2. In `migration.service.js`, import it and add a version-conditional call inside
   `safelyMigrate()`: `if (compareVersions(currentVersion, '<to>') < 0) await migrateToV<to>();`.
   Migrations are chained by version number, not a registry.
3. Runs automatically on next startup.

## PDF Export

`pdf-export.tab.js` + `pdf-cartographic-elements.js`. DPI options: 150/200/300. Cartographic elements scale via `uiScale = dpi / 200`. GDAL pre-initialized on tab open.

## Street View 360 Navigation

Flat ground projection model in `street_view_tool/navigation/`. GPS elevation not used for projection. `override_height` defaults to 0 (ground). Projector functions must stay in sync with `ebgeo_360/public/calibration/js/`.
