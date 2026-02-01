# CLAUDE.md - EBGeo Web Project Guide

## Project Overview

EBGeo (Sistema de Informacao Geografica do Exercito Brasileiro) is a web-based Geographic Information System built for the Brazilian Army. It provides 2D/3D map visualization, military symbology, drawing tools, and terrain analysis capabilities.

**Current Version**: 2.0 (with automatic migration from v1.x)

## Tech Stack

- **Build Tool**: Vite 5.x with legacy browser support
- **Map Libraries**: MapLibre GL JS (2D), Cesium (3D)
- **Military Symbols**: milsymbol library with Brazilian extensions
- **Geometry**: Turf.js for geospatial operations
- **UI**: Vanilla JS with Quill (rich text), Chart.js, SortableJS
- **Storage**: LocalForage (IndexedDB wrapper) with Repository abstraction
- **Server**: Restify (production server)
- **Import/Export**: JSZip, MGRS, Proj4, ShpJS

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
├── config.helpers.js        # Config helper functions (basemaps, tilesets)
├── config-loader.js         # Dynamic config loading
├── url_router.js            # Deep linking support
│
├── store/                   # State management (central data store)
│   ├── store.js             # Main facade with re-exports
│   ├── store.constants.js   # Store configuration constants
│   ├── store.types.js       # JSDoc type definitions
│   ├── repository.js        # IndexedDB persistence layer
│   ├── control.registry.js  # Control registry pattern
│   ├── store-state-manager.js  # Map state, undo/redo
│   ├── feature.operations.js   # CRUD for features
│   ├── layer.operations.js     # Layer management
│   ├── group.operations.js     # Feature grouping
│   ├── map.operations.js       # Map management
│   ├── settings.operations.js  # App settings
│   ├── cesium3d.operations.js  # Cesium 3D CRUD operations
│   ├── streetview360.operations.js  # Street View 360 operations
│   ├── catalog.operations.js   # Catalog operations
│   │
│   ├── atlas/               # Project management (v2.0)
│   │   └── atlas.entity.js  # Atlas entity (top-level container)
│   │
│   ├── repositories/        # Data persistence abstraction
│   │   ├── repository.interface.js  # Repository contract
│   │   ├── local.repository.js      # LocalForage implementation
│   │   └── index.js                 # Repository factory and compat wrappers
│   │
│   ├── services/            # Store services
│   │   ├── map-resolver.service.js  # Map name/ID resolution
│   │   └── index.js                 # Service exports
│   │
│   ├── migration/           # Schema migration system
│   │   ├── migration.service.js     # Migration orchestrator
│   │   └── v1-to-v2.migration.js    # v1.x to v2.0 migration
│   │
│   └── sync/                # Sync metadata and operation logging
│       ├── sync-metadata.js         # Sync utilities for backend integration
│       ├── operation-types.js       # Entity and operation type constants
│       ├── operation-factory.js     # Operation creation helpers
│       ├── operation-queue.js       # IndexedDB-backed operation queue
│       ├── operation-dispatcher.js  # Operation logging coordinator
│       └── index.js                 # Sync module exports
│
├── state/                   # UI State management
│   └── state_manager.js     # Centralized UI state (sidebar, panels, popups)
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
│   ├── move_handler.js      # Feature move/drag handling
│   ├── tabbed_attribute_panel.js  # Tabbed panel for attributes
│   ├── hatch_config_modal.js      # Hatch pattern configuration
│   ├── hatch_pattern_generator.js # Hatch pattern generation
│   └── helpers/             # UI component helpers
│
├── sidebar/                 # Collapsible sidebar UI
│   ├── sidebar.control.js   # Main sidebar component
│   ├── sidebar.constants.js # Sidebar configuration
│   ├── components/          # Reusable sidebar components
│   │   ├── chips.component.js      # Quick action chips
│   │   ├── feature-panel.js        # Feature attributes panel
│   │   ├── feature-tabs.js         # Feature panel tabs
│   │   ├── feature-identification.js  # Feature identification section
│   │   ├── feature-location-section.js # Feature location display
│   │   ├── feature-photo-gallery.js    # Photo gallery for features
│   │   ├── group-type-selector.js      # Group type selector
│   │   ├── sidebar-collapsed.js    # Collapsed state UI
│   │   └── sidebar-panel.js        # Panel base component
│   └── tabs/                # Sidebar tab implementations
│       ├── maps.tab.js      # Maps management tab
│       ├── layers.tab.js    # Layers management tab
│       ├── import.tab.js    # Import options tab
│       └── export.tab.js    # Export options tab
│
├── toolbar/                 # Grouped toolbar UI
│   ├── toolbar.control.js   # Main toolbar component
│   ├── toolbar.constants.js # Tool definitions and groupings
│   ├── tool-button.js       # Individual tool button component
│   └── components/          # Toolbar components
│       ├── toolbar-group.js      # Tool group popup
│       └── active-tool-chip.js   # Active tool indicator
│
├── bottom-controls/         # Bottom controls bar
│   ├── bottom-controls.control.js  # Toggle buttons (terrain, 3D, etc.)
│   ├── bottom-controls.constants.js
│   └── components/          # Control components
│
├── base-layer-selector/     # Base layer picker with thumbnails
│   └── base-layer-selector.control.js
│
├── modals/                  # Modal dialogs
│   ├── modal.base.js        # Base modal class
│   ├── shortcuts.modal.js   # Keyboard shortcuts modal
│   ├── info.modal.js        # Information/about modal
│   ├── prompt.modal.js      # User prompt modal
│   ├── confirm.modal.js     # Generic confirmation modal
│   ├── combine-maps.modal.js    # Combine maps modal
│   ├── coordinate-edit.modal.js # Coordinate editing modal
│   └── export.modal.js      # Export options modal
│
├── search/                  # Search functionality
│   ├── search-bar.component.js    # Global search bar
│   └── feature-search.control.js  # Feature search control
│
├── context-menu/            # Right-click context menus
│   └── context-menu.control.js
│
├── catalog/                 # External layer catalog
│   ├── catalog.modal.js     # Catalog browser modal
│   ├── catalog.service.js   # Catalog data service
│   └── components/          # Catalog UI components
│
├── attribute_table/         # Attribute table UI
│   ├── attribute-table.control.js  # Main control
│   ├── attribute-table.constants.js # Configuration
│   ├── components/          # Table components
│   │   ├── panel/           # Table panel UI
│   │   ├── renderer/        # Table renderer
│   │   ├── filters/         # Column filtering
│   │   └── context-menu/    # Column context menu
│   └── services/            # Table services
│       ├── table-data.service.js   # Data service
│       └── table-config.service.js # Config service
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
├── selection_tools/         # Selection utilities
│   └── rectangle_selection_control.js
│
├── vector_info/             # Vector tile info display
│   └── vector-info.control.js
│
├── 3d_models_viewer_tool/   # Cesium 3D integration
│   ├── map_3d.js            # Cesium viewer setup
│   ├── tools/               # 3D-specific tools
│   └── components/          # 3D UI components
│       ├── marker-panel-3d.js      # 3D marker configuration
│       ├── measurement-panel-3d.js # 3D measurement display
│       └── viewshed-panel-3d.js    # 3D viewshed visualization
│
├── street_view_tool/        # Street view integration (360)
│   ├── navigation/          # Navigation system
│   │   ├── constants.js
│   │   ├── hit-tester.js
│   │   ├── minimap-sync.js
│   │   ├── navigator.js
│   │   ├── projector.js
│   │   └── renderer.js
│   └── services/            # Street view services
│       └── keyboard_service_360.js
│
├── baselayers/              # Base map configurations
├── layers/                  # Layer styles and management
├── features_tab/            # Layer/feature list components
├── map/                     # Map controls and notes
├── terrain/                 # Terrain/hillshade
├── import_export/           # File I/O (GeoJSON, KML, .ebgeo, etc.)
├── coordinates/             # Coordinate display/conversion
├── grid/                    # UTM grid overlay
├── frame/                   # Map frame/border
├── keyboard/                # Keyboard shortcuts
├── user_data/               # Feature attributes/images
├── ui/                      # Shared UI utilities
└── utilities/               # Helpers
    ├── coordinate_converter.js  # Coordinate conversions
    ├── uuid.js              # UUID v4 generation
    ├── id_utils.js          # ID utilities (legacy support)
    ├── event-cleanup.js     # Event listener cleanup
    ├── feature_navigation_utils.js  # Feature navigation
    ├── pointer-utils.js     # Pointer event utilities
    ├── image_utils.js       # Image validation/processing
    ├── streetview360-state.js   # Street view state check
    └── viewer3d-state.js    # 3D viewer state check
```

## Architecture Patterns

### Tool Pattern
Each tool follows a consistent three-file pattern:
- `add_*_control.js` - MapLibre control, toolbar button, tool activation
- `add_*_geometry.js` - Geometry creation/editing logic
- `*_attributes_panel.js` - Feature property editor UI

### UI Architecture
The UI is organized into distinct components:
- **SidebarControl** - Collapsible sidebar with tabs (Maps, Layers, Import, Export)
- **ToolbarControl** - Grouped tool buttons with popup menus
- **BottomControlsControl** - Feature toggles (terrain, 3D, street view)
- **BaseLayerSelectorControl** - Base map picker with thumbnails
- **FeaturePanel** - Integrated in sidebar for feature attributes
- **AttributeTableControl** - Data grid with filtering and sorting

UI state is managed by `StateManager` which enforces mutual exclusivity:
- Sidebar and Feature Panel cannot both be open
- Only one toolbar group popup can be open at a time

### Store Pattern
Central state management with:
- Memory store for runtime data
- IndexedDB persistence via LocalForage with Repository abstraction
- Event-driven updates via EventBus
- Undo/redo support via action history
- Automatic v1-to-v2 schema migration

### Atlas/Project Structure (v2.0)
- **Atlas**: Top-level container for projects
- **Maps**: Individual map workspaces within an Atlas
- **Layers**: Feature containers within maps
- **Features**: Individual geographic elements
- Projects saved as `.ebgeo` files containing Atlas + Maps

### Repository Pattern
Abstraction layer for data persistence:
```javascript
// Repository interface defines contract
interface Repository {
  get(key): Promise<any>
  set(key, value): Promise<void>
  delete(key): Promise<void>
  keys(): Promise<string[]>
}

// Current implementation uses LocalForage
// Future: RemoteRepository, SyncRepository
```

### Data Migration
Automatic schema migration on startup:
```javascript
// Migration service detects and executes migrations
import { MigrationService } from './store/migration/migration.service.js';

// Migrations run automatically during initServices()
// Supports v1.x to v2.0 with backward compatibility
```

### Event System
```javascript
import { getEventBus } from './store/services.js';
import { EventTypes } from './events/event_types.js';

const eventBus = getEventBus();
eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
eventBus.on(EventTypes.FEATURE_UPDATED, handler);
```

UI events for coordination:
- `SIDEBAR_EXPANDED`, `SIDEBAR_COLLAPSED`, `SIDEBAR_TAB_CHANGED`
- `FEATURE_PANEL_OPENED`, `FEATURE_PANEL_CLOSED`
- `TOOLBAR_GROUP_OPENED`, `TOOLBAR_GROUP_CLOSED`
- `UI_LAYOUT_CHANGED`, `UI_CLOSE_ALL_POPUPS`

Entity lifecycle events (for sync triggers):
- `FEATURE_CREATED`, `FEATURE_MODIFIED`, `FEATURE_DELETED`
- `LAYER_CREATED`, `LAYER_MODIFIED`, `LAYER_DELETED`
- `GROUP_CREATED`, `GROUP_MODIFIED`, `GROUP_DELETED`
- `MAP_CREATED`, `MAP_MODIFIED`, `MAP_DELETED`

### Control Registry Pattern
Centralized access to tool controls:
```javascript
import { getControl, registerControl } from '@store';

// Register a control
registerControl('myTool', controlInstance);

// Access a control
const control = getControl('myTool');
```

### Services Initialization
Services are initialized via dependency injection at startup:
```javascript
import { initServices } from './store/services.js';
initServices(); // Must be called before any component
// Runs migrations automatically
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
Use UUID v4 for all new identifiers:
```javascript
import { generateUUID, isValidUUID, isLegacyId } from 'utilities/uuid.js';

const id = generateUUID(); // Crypto-secure UUID v4
isValidUUID(id);           // Validate UUID format
isLegacyId(id);            // Check for legacy timestamp-based IDs
```

### Sync Metadata
Every persistable entity includes sync metadata for future backend integration:
```javascript
{
  createdAt: timestamp,
  updatedAt: timestamp,
  version: number,
  ownerId: string,
  dirty: boolean,
  deleted: boolean  // Soft delete support
}
```

### Operation Logging Infrastructure
Operations are queued for future CRDT-based sync with backend:
```javascript
import {
  enableOperationLogging,
  logFeatureOperation,
  OperationType
} from './store/sync';

// Enable logging when ready
enableOperationLogging();

// Log operations (queued to IndexedDB)
await logFeatureOperation(OperationType.CREATE, featureId, mapId, featureData);
```

Entity types: `ATLAS`, `MAP`, `FEATURE`, `LAYER`, `GROUP`, `MARKER_3D`, `MEASUREMENT_3D`, `VIEWSHED_3D`, `ORIENTATION_360`, `MARKER_360`, `BRIEFING`

### Map Resolver Service
Handles bidirectional name ↔ UUID resolution for backward compatibility:
```javascript
import { getMapResolver } from './store/services.js';

const resolver = getMapResolver();
const mapId = resolver.resolveToId('Mapa 1');     // Returns UUID
const mapName = resolver.resolveToName(mapId);    // Returns display name
```

## Code Style

- ES Modules (ESM) throughout
- Classes for controls and managers
- JSDoc comments for public APIs
- Event-driven communication between modules
- No framework dependencies (vanilla JS)

## AI-Assisted Development Guidelines

This codebase is optimized for AI-assisted development. Follow these principles:

### Minimize Context Requirements
```javascript
// AVOID: Functions depending on many modules
// PREFER: Functions with explicit, minimal dependencies

// AVOID: Global state scattered across the app
// PREFER: Centralized state via store/ with clear interfaces

// AVOID: Deep inheritance or complex composition
// PREFER: Simple composition and pure functions
```

### Smart Comments (Why, Not What)
```javascript
// BAD - LLM can read code:
// Increments the counter
counter++;

// GOOD - Explains the "why":
// CesiumJS returns radians, MapLibreGL expects degrees
const degreesLat = Cesium.Math.toDegrees(radiansLat);

// GOOD - Business context:
// 10km limit defined by GPS sensor precision requirements
const MAX_TRACKING_RADIUS = 10000;

// GOOD - Integration context:
// Three.js uses Y-up, CesiumJS uses Z-up
const coordTransform = new Matrix4().makeRotationX(-Math.PI / 2);
```

### Naming Conventions
```javascript
// Files: kebab-case
cesium-viewer.js, map-controls.js

// Classes: PascalCase
class FlightPathManager {}

// Functions/Variables: camelCase
function calculateBearing() {}
let currentPosition = null;

// Constants: SCREAMING_SNAKE_CASE
const MAX_ZOOM_LEVEL = 18;

// Events: kebab-case with domain prefix
'cesium:camera-move', 'maplibre:layer-added', 'app:feature-toggled'

// CSS: BEM simplified
.map-panel, .map-panel__header, .map-panel--collapsed
```

### Avoid Over-Engineering
- Don't create abstractions for non-existent problems
- Don't generalize prematurely
- Prefer explicit code over "clever" code
- If a function is used in one place, it may not need extraction

### No Technical Debt
- All code must have clear intent
- No `// TODO: fix later` without justification
- No commented code without explanation
- No workarounds without documenting the original problem

### Module Header Pattern
```javascript
/**
 * @module engines/cesium/cesium-viewer
 * @description CesiumJS Viewer wrapper with standard config
 * @dependencies cesium, config/cesium.config, core/event-bus
 */

import { CESIUM_CONFIG } from '../../config/cesium.config.js';
import { eventBus } from '../../core/event-bus.js';

// ============================================================================
// MODULE STATE
// ============================================================================

let viewer = null;

// ============================================================================
// PUBLIC FUNCTIONS
// ============================================================================

export function initViewer(containerId) { /* ... */ }

// ============================================================================
// PRIVATE FUNCTIONS
// ============================================================================

function setupEventHandlers() { /* ... */ }
```

### Discoverability
- File names must reflect content exactly
- Folder structure must be semantic and predictable
- Each module declares dependencies at the top
- Use consistent naming conventions throughout

## Build Configuration

Vite splits code into chunks:
- `core` - Store, state, events, layers, terrain, toolbar, modals, catalog, UI utilities
- `ui-components` - Sidebar, features_tab, attribute_table
- `draw-tools` - All drawing tools
- `military-tools` - Military symbology
- `analysis-tools` - LOS and visibility
- `selection-tools` - Rectangle selection, vector info
- `cesium-integration` - 3D viewer (lazy loaded)
- `import-export` - File handling (lazy loaded)
- `street-view` - Three.js street view (lazy loaded)

External dependencies loaded via script tags:
- MapLibre GL JS
- Turf.js
- milsymbol
- Cesium (loaded on demand)
- GDAL (for georeferenced PDF export)

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
7. Add tool to `toolbar/toolbar.constants.js` in appropriate group
8. Add to `vite.config.js` manual chunks if large

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

### Working with the Repository
```javascript
import { getRepository } from '@store';

const repo = getRepository();
await repo.get('key');
await repo.set('key', value);
await repo.delete('key');
```

### Adding a Schema Migration
1. Create migration file in `store/migration/` (e.g., `v2-to-v3.migration.js`)
2. Implement migration logic with version detection
3. Register in `migration.service.js`
4. Migration runs automatically on next startup
