# CLAUDE.md - EBGeo Web Project Guide

## Project Overview

EBGeo (Sistema de Informacao Geografica do Exercito Brasileiro) is a web-based Geographic Information System built for the Brazilian Army. It provides 2D/3D map visualization, military symbology, drawing tools, and terrain analysis capabilities.

## Tech Stack

- **Build Tool**: Vite 5.x with legacy browser support
- **Map Libraries**: MapLibre GL JS (2D), Cesium (3D)
- **Military Symbols**: milsymbol library with Brazilian extensions
- **Geometry**: Turf.js for geospatial operations
- **UI**: Vanilla JS with Feather Icons, Quill (rich text), Chart.js, SortableJS
- **Storage**: LocalForage (IndexedDB wrapper)
- **Server**: Restify (production server)

## Commands

```bash
npm run dev        # Start dev server (port 3000)
npm run build      # Production build to dist/
npm run preview    # Preview production build (port 4173)
npm start          # Start production server
npm run lint       # Run ESLint + Stylelint
npm run lint:fix   # Auto-fix lint issues
npm run knip       # Dead code detection
```

## Project Structure

```
src/js/
├── index.js                 # App entry point, loading screen
├── map_sig.js               # Main map initialization, control registration
├── config.js                # App configuration
├── url_router.js            # Deep linking support
│
├── store/                   # State management (central data store)
│   ├── store.js             # Main facade with re-exports
│   ├── repository.js        # IndexedDB persistence layer
│   ├── store-state-manager.js  # Map state, undo/redo
│   ├── feature.operations.js   # CRUD for features
│   ├── layer.operations.js     # Layer management
│   ├── group.operations.js     # Feature grouping
│   ├── map.operations.js       # Map management
│   └── settings.operations.js  # App settings
│
├── events/                  # Event system
│   ├── event_bus.js         # Pub/sub implementation
│   ├── event_emitter.js     # Base emitter class
│   └── event_types.js       # Event constants
│
├── tool_manager/            # Core tool infrastructure
│   ├── tool_manager.js      # Tool state management
│   ├── selection_manager.js # Feature selection
│   ├── ui_manager.js        # UI coordination
│   ├── base_control.js      # Base class for tools
│   ├── base_geometry.js     # Base class for geometries
│   ├── group_manager.js     # Feature grouping logic
│   ├── clipboard_manager.js # Copy/paste
│   └── helpers/             # UI component helpers
│
├── draw_tools/              # Drawing tools
│   ├── point_tool/
│   ├── line_tool/
│   ├── polygon_tool/
│   ├── circle_tool/
│   ├── ellipse_tool/
│   ├── rectangle_tool/
│   ├── text_tool/
│   ├── image_tool/
│   └── brush_tool/
│
├── military_tools/          # Military symbology
│   ├── military_symbol_tool/  # MIL-STD-2525D symbols
│   ├── coordination_measure_tool/  # Tactical graphics
│   ├── arrow_tool/
│   ├── boundary_tool/
│   └── occupied_front_tool/
│
├── analysis_tools/          # Terrain analysis
│   ├── los_tool/            # Line of sight
│   └── visibility_tool/     # Viewshed analysis
│
├── 3d_models_viewer_tool/   # Cesium 3D integration
│   ├── map_3d.js            # Cesium viewer setup
│   └── tools/               # 3D-specific tools
│
├── baselayers/              # Base map configurations
├── layers/                  # Layer styles and management
├── features_tab/            # Layer/feature list UI
├── map/                     # Map controls
├── terrain/                 # Terrain/hillshade
├── import_export/           # File I/O (GeoJSON, KML, etc.)
├── coordinates/             # Coordinate display/conversion
├── grid/                    # UTM grid overlay
├── frame/                   # Map frame/border
├── keyboard/                # Keyboard shortcuts
├── user_data/               # Feature attributes/images
└── utilities/               # Helpers (coordinate converter, etc.)
```

## Architecture Patterns

### Tool Pattern
Each tool follows a consistent three-file pattern:
- `add_*_control.js` - MapLibre control, toolbar button, tool activation
- `add_*_geometry.js` - Geometry creation/editing logic
- `*_attributes_panel.js` - Feature property editor UI

### Store Pattern
Central state management with:
- Memory store for runtime data
- IndexedDB persistence via LocalForage
- Event-driven updates via EventBus
- Undo/redo support via action history

### Event System
```javascript
import { getEventBus } from './store/services.js';
import { EventTypes } from './events/event_types.js';

const eventBus = getEventBus();
eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
eventBus.on(EventTypes.FEATURE_UPDATED, handler);
```

### Services Initialization
Services are initialized via dependency injection at startup:
```javascript
import { initServices } from './store/services.js';
initServices(); // Must be called before any component
```

## Key Conventions

### Imports
- Use path aliases: `@js/`, `@store/`, `@utils/`, `@tools/`
- Each module folder has an `index.js` barrel file for public exports

### Feature Types
Features are identified by type strings: `'point'`, `'line'`, `'polygon'`, `'circle'`, `'ellipse'`, `'rectangle'`, `'text'`, `'image'`, `'brush'`, `'arrow'`, `'boundary'`, `'occupied_front'`, `'military_symbol'`, `'coordination_measure'`, `'los'`, `'visibility'`

### Layer System
- Features belong to layers
- Layers have visibility and locked states
- Active layer receives new features
- Layer operations emit `LAYERS_CHANGED` events

### ID Generation
Use `generateUUID()` from `utilities/id_utils.js` for unique identifiers.

## Code Style

- ES Modules (ESM) throughout
- Classes for controls and managers
- JSDoc comments for public APIs
- Event-driven communication between modules
- No framework dependencies (vanilla JS)

## Build Configuration

Vite splits code into chunks:
- `core` - Store and state management
- `draw-tools` - All drawing tools
- `military-tools` - Military symbology
- `analysis-tools` - LOS and visibility
- `cesium-integration` - 3D viewer (lazy loaded)
- `import-export` - File handling
- `street-view` - Three.js street view

External dependencies loaded via script tags:
- MapLibre GL JS
- Turf.js
- milsymbol
- Cesium (loaded on demand)

## Testing

No automated test framework currently configured. Manual testing via dev server.

## Common Tasks

### Adding a New Tool
1. Create folder in appropriate category (draw_tools/, military_tools/, etc.)
2. Implement `add_*_control.js` extending BaseControl
3. Implement `add_*_geometry.js` extending BaseGeometry
4. Implement `*_attributes_panel.js` for properties
5. Export from folder's `index.js`
6. Register in `map_sig.js`
7. Add to `vite.config.js` manual chunks if large

### Adding a New Event
1. Define in `events/event_types.js`
2. Document emitters and subscribers in comments
3. Use via EventBus from services

### Working with Features
```javascript
import { addFeature, getFeatureById, updateFeature } from '@store';

// Add
await addFeature('polygon', featureData, layerId);

// Read
const feature = await getFeatureById('polygon', featureId);

// Update
await updateFeature('polygon', featureId, newData);
```
