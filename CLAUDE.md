# CLAUDE.md - EBGeo Web Project Guide

## Project Overview

EBGeo (Sistema de Informacao Geografica do Exercito Brasileiro) is a web-based Geographic Information System built for the Brazilian Army. It provides 2D/3D map visualization, military symbology, drawing tools, terrain analysis, and azimuth/distance navigation capabilities.

**Current Version**: 2.0 (with automatic migration from v1.x)

## Tech Stack

- **Build Tool**: Vite 5.x with legacy browser support
- **Map Libraries**: MapLibre GL JS 5.x (2D), Cesium 1.138+ (3D)
- **360 Viewer**: Three.js with API-based panoramic service
- **Military Symbols**: milsymbol library with Brazilian extensions
- **Geometry**: Turf.js for geospatial operations
- **Geomagnetic**: geomagnetism library for magnetic declination
- **UI**: Vanilla JS with Quill (rich text), Chart.js, SortableJS
- **Storage**: LocalForage (IndexedDB wrapper) with Repository abstraction
- **Server**: Restify (production server)
- **Import/Export**: JSZip, MGRS, Proj4, ShpJS
- **Testing**: Vitest

## Commands

```bash
npm run dev        # Start dev server (port 3000)
npm run build      # Production build to dist/
npm run preview    # Preview production build (port 4173)
npm start          # Start production server
npm run lint       # Run ESLint + Stylelint
npm run lint:fix   # Auto-fix lint issues
npm run knip       # Dead code detection
npm test           # Run tests (Vitest)
npm run test:watch # Run tests in watch mode
```

## Project Structure

```
src/js/
├── index.js                 # App entry point, loading screen
├── map_sig.js               # Main map initialization, control registration
├── config.js                # App configuration
├── config.helpers.js        # Config helper functions (basemaps, tilesets)
├── config-loader.js         # Dynamic config loading
│
├── store/                   # State management (central data store)
│   ├── index.js             # Public API barrel (re-exports from store.js + services)
│   ├── store.js             # Store facade with all data operation re-exports
│   ├── services.js          # Service container for dependency injection (initServices, getters)
│   ├── store.constants.js   # Store configuration constants
│   ├── store.types.js       # JSDoc type definitions
│   ├── repository.js        # IndexedDB persistence layer
│   ├── repository.utils.js  # Repository utility functions (schema version, data validation)
│   ├── memory-store.js      # In-memory runtime state (separate from IndexedDB)
│   ├── control.registry.js  # Control registry pattern
│   ├── store-state-manager.js  # Map state, undo/redo, color tracking
│   ├── store-transaction.js    # Persistence-first transaction coordination
│   ├── store-errors.js         # Error conventions, StoreErrorEvents, emitStoreError
│   ├── store-error-listener.js # Toast notifications for store errors
│   ├── undo-redo-messages.js   # User-facing undo/redo descriptions (pt-BR)
│   ├── feature.operations.js   # CRUD for features (uses runTransaction)
│   ├── layer.operations.js     # Layer management
│   ├── group.operations.js     # Feature grouping
│   ├── map.operations.js       # Map management
│   ├── settings.operations.js  # App settings
│   ├── cesium3d.operations.js  # Cesium 3D CRUD operations
│   ├── streetview360.operations.js  # Street View 360 operations
│   ├── catalog.operations.js   # Catalog operations
│   ├── briefing.operations.js  # Briefing CRUD operations
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
│   │   ├── map-resolver.service.js  # Map name/ID resolution (with LRU cache)
│   │   └── index.js                 # Service exports
│   │
│   ├── migration/           # Schema migration system
│   │   ├── migration.service.js     # Migration orchestrator
│   │   └── v1-to-v2.migration.js    # v1.x to v2.0 migration
│   │
│   └── sync/                # Sync metadata, operation logging, and real-time sync infrastructure
│       ├── sync-metadata.js         # Sync utilities, deletedAt, serverTimeOffset
│       ├── operation-types.js       # Entity and operation type constants
│       ├── operation-factory.js     # Lamport clock + operation creation
│       ├── operation-queue.js       # IndexedDB-backed queue with compaction
│       ├── operation-dispatcher.js  # Operation logging coordinator
│       ├── session-context.js       # User identity (offline anonymous / online JWT)
│       ├── connection-state.js      # Connection state machine (OFFLINE/CONNECTING/ONLINE/RECONNECTING)
│       ├── permission-guard.js      # Role-based permission validator for operations
│       ├── sync-gateway.js          # Operation transmission abstraction (no-op offline, future WebSocket)
│       ├── event-bridges.js         # Bridges SessionContext/ConnectionState to EventBus
│       ├── remote-operation-handler.js  # Applies remote operations to local store
│       ├── sync-scheduler.js        # Debounced sync via SyncGateway on entity lifecycle events
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
│   ├── helpers/             # UI component helpers for attribute panels
│   │   ├── base-attributes-panel.js      # Shared functions for panel creation
│   │   ├── buttons.helpers.js            # Apply/cancel/reset action buttons
│   │   ├── color-picker.helpers.js       # Color picker with frequent colors
│   │   ├── common-config.helpers.js      # Default UI config constants
│   │   ├── coordinate-editor.helpers.js  # Point coordinate editing modal
│   │   ├── feature-header.helpers.js     # Editable feature name header
│   │   ├── form-controls.helpers.js      # Toggle switch and form controls
│   │   ├── hatch-control.helpers.js      # Hatch pattern selector for polygons
│   │   ├── line-style.helpers.js         # Line dash style selector
│   │   ├── section-divider.helpers.js    # Section dividers with titles
│   │   ├── slider.helpers.js             # Slider with numeric input
│   │   └── text-alignment.helpers.js     # Text alignment selector
│   └── managers/            # Manager classes
│       ├── profile-panel.manager.js      # Line profile panel manager
│       ├── selection-highlight.manager.js # Selection highlight manager
│       └── index.js
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
│   │   ├── multi-selection-actions.js # Batch actions (lock/hide) for multi-selected features
│   │   ├── sidebar-collapsed.js    # Collapsed state UI
│   │   └── sidebar-panel.js        # Panel base component
│   ├── handlers/            # Event handlers for sidebar interactions
│   │   ├── feature-3d-handlers.js  # 3D feature click handlers (markers, measurements, viewsheds)
│   │   └── index.js
│   ├── panels/              # Panel content components
│   │   ├── feature-panel-content.js  # Feature panel content renderer
│   │   ├── notes-panel.js           # Map notes panel
│   │   ├── vector-info-panel.js     # Vector tile info panel
│   │   └── index.js
│   └── tabs/                # Sidebar tab implementations
│       ├── maps.tab.js      # Maps management tab
│       ├── layers.tab.js    # Layers management tab
│       ├── briefings.tab.js # Briefings management tab
│       ├── import.tab.js    # Import options tab (GeoJSON, SHP, KML, GPX, CSV)
│       └── export.tab.js    # Export options tab
│
├── toolbar/                 # Grouped toolbar UI
│   ├── toolbar.control.js   # Main toolbar component
│   ├── toolbar.constants.js # Tool definitions and groupings
│   └── components/          # Toolbar components
│       ├── tool-button.js        # Individual tool button component
│       ├── toolbar-group.js      # Tool group popup
│       └── active-tool-chip.js   # Active tool indicator
│
├── bottom-controls/         # Bottom controls bar
│   ├── bottom-controls.control.js  # Toggle buttons (terrain, 3D, etc.)
│   ├── bottom-controls.constants.js
│   └── components/          # Control components
│       ├── feature-toggle.js     # Feature toggle button with active/disabled states
│       └── nav-button.js         # Navigation icon button component
│
├── base-layer-selector/     # Base layer picker with thumbnails
│   ├── base-layer-selector.control.js
│   └── base-layer-selector.constants.js  # Layer thumbnail configs and metadata
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
│   ├── search-bar.component.js        # Global search bar
│   ├── search-bar.icons.js            # Icon definitions for search bar
│   ├── search-bar.search-providers.js # Search provider implementations
│   ├── search-bar.sidepanel-content.js # Side panel content renderer
│   └── feature-search.control.js      # Feature search control
│
├── context-menu/            # Right-click context menus
│   └── context-menu.control.js
│
├── catalog/                 # External layer catalog
│   ├── catalog.modal.js     # Catalog browser modal
│   ├── catalog.service.js   # Catalog data service
│   ├── catalog.constants.js # Catalog configuration
│   └── components/          # Catalog UI components
│       ├── catalog-card.js       # Individual catalog item card
│       ├── catalog-filters.js    # Filter controls
│       ├── catalog-grid.js       # Grid layout
│       ├── catalog-header.js     # Header with search
│       └── index.js
│
├── attribute_table/         # Attribute table UI
│   ├── attribute-table.control.js  # Main control
│   ├── attribute-table.constants.js # Configuration
│   ├── components/          # Table components (flat structure)
│   │   ├── table-panel.js          # Table panel UI
│   │   ├── table-renderer.js       # Table renderer
│   │   ├── table-filters.js        # Column filtering
│   │   ├── column-context-menu.js  # Column context menu
│   │   └── index.js
│   └── services/            # Table services
│       ├── table-data.service.js   # Data service
│       └── table-config.service.js # Config service
│
├── draw_tools/              # Drawing tools
│   ├── drawing-touch-helpers.js  # Touch input helpers for drawing
│   ├── point_tool/          # Point + Callout annotation mode
│   │   ├── add_point_control.js       # Point control with callout leader line support
│   │   ├── add_point_geometry.js
│   │   ├── point_attributes_panel.js  # Includes callout section (mode, label, offset, leader)
│   │   └── index.js
│   ├── line_tool/
│   │   ├── add_line_control.js
│   │   ├── add_line_geometry.js
│   │   ├── line_attributes_panel.js
│   │   ├── line_measurement.js     # Line measurement functionality
│   │   ├── line_profile.js         # Terrain profile for lines
│   │   └── index.js
│   ├── polygon_tool/
│   ├── circle_tool/
│   ├── ellipse_tool/
│   ├── rectangle_tool/
│   ├── text_tool/
│   ├── image_tool/
│   ├── brush_tool/
│   └── sector_tool/         # Sector (arc) drawing tool
│       ├── add_sector_control.js
│       ├── add_sector_geometry.js
│       └── sector_attributes_panel.js
│
├── azimuth_distance_tool/   # Azimuth & distance navigation tool
│   ├── add_azimuth_distance_control.js   # Main control
│   ├── azimuth_distance_geometry.js      # Geometry calculation logic
│   ├── azimuth_distance_attributes_panel.js # Attributes panel
│   ├── azimuth_distance_panel.js         # Main panel UI
│   ├── azimuth_distance_constants.js     # Angular/distance units, north reference types
│   ├── index.js
│   └── components/          # UI components
│       ├── compass-rose.component.js     # Visual compass rose
│       ├── geometry-preview.component.js # Geometry preview
│       ├── leg-row.component.js          # Individual leg editor
│       ├── reference-point.component.js  # Reference point selector
│       └── index.js
│
├── snapping/                # Geometry snapping system
│   ├── snapping.service.js  # Main snapping service (vertex, edge, endpoint)
│   ├── snapping.constants.js # Snap types, tolerance, indicator styles
│   └── index.js
│
├── measurement_tool/        # Ephemeral 2D measurement tools (distance, area, angle)
│   ├── measurement.constants.js     # Source/layer IDs, units, styles
│   ├── measurement-geometry.js      # Turf.js calculations (distance, area, angle, formatting)
│   ├── measurement-labels.js        # MapLibre source/layer management + setupMeasurementLayers()
│   ├── measurement-distance.control.js  # Distance measurement IControl (J)
│   ├── measurement-area.control.js      # Area measurement IControl (H)
│   ├── measurement-angle.control.js     # 3-click angle measurement IControl (X)
│   ├── measurement-results-panel.js     # Results panel UI (unit toggles, save option)
│   └── index.js
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
│   ├── add_3d_models_viewer_control.js # MapLibre control for 3D toggle
│   ├── map_3d.js            # Cesium viewer setup
│   ├── tools/               # 3D-specific tools
│   │   ├── marker_tool_3d.js         # 3D marker placement on tilesets
│   │   ├── measurement_tool_3d.js    # 3D distance/area measurement
│   │   ├── viewshed_tool_3d.js       # 3D viewshed tool with persistence
│   │   ├── viewshed.js               # Viewshed analysis (add/remove fields)
│   │   ├── mouse_coordinates_3d.js   # Cursor coordinate display in 3D
│   │   └── screenshot_tool.js        # Cesium viewer screenshot capture
│   ├── components/          # 3D UI components
│   │   ├── marker-panel-3d.js      # 3D marker configuration
│   │   ├── measurement-panel-3d.js # 3D measurement display
│   │   └── viewshed-panel-3d.js    # 3D viewshed visualization
│   └── services/
│       ├── keyboard-service-3d.js  # 3D keyboard shortcuts
│       └── cesium-compat.js        # Compatibility patches for Cesium 1.138+
│
├── street_view_tool/        # Street view 360 integration (API-based)
│   ├── index.js                      # Public API with lazy loading exports
│   ├── add_street_view_control.js    # MapLibre control for 2D map integration
│   ├── street_view_viewer.js         # Core Three.js 360 panoramic viewer
│   ├── streetview_markers.js         # Clustered markers on 2D map (PMTiles)
│   ├── saved_photos_markers.js       # Markers for saved photo orientations
│   ├── streetview-api.service.js     # Centralized API client (UUID-based, REST, consumes override_height)
│   ├── navigation/          # Navigation system (Google Street View-like)
│   │   ├── index.js
│   │   ├── constants.js
│   │   ├── hit-tester.js
│   │   ├── minimap-sync.js         # Syncs viewer state with MapLibre minimap
│   │   ├── navigator.js            # Target projection (flat ground + override height)
│   │   ├── projector.js            # Coordinate math (flatten ratio, marker size with heightOffset)
│   │   └── renderer.js
│   ├── components/          # Street view UI components
│   │   ├── marker-panel-360.js     # 360 marker configuration
│   │   └── streetview-sidebar.js   # Sidebar integration
│   ├── services/
│   │   └── keyboard_service_360.js
│   └── tools/
│       ├── marker_tool_360.js
│       └── screenshot_tool_360.js
│
├── briefing/                # Briefing (Story Map) system
│   ├── index.js             # Public exports
│   ├── components/          # UI components
│   │   ├── presentation-text-panel.js   # Right-side panel with content and navigation
│   │   └── presentation-controls.js     # Navigation controls
│   ├── editor/              # Editor mode
│   │   └── briefing-editor.control.js   # Full-screen editor
│   ├── presentation/        # Presentation mode
│   │   ├── briefing-presenter.control.js # Main presenter (lifecycle, preload, state save/restore)
│   │   ├── transition.service.js        # Slide transitions (9-cell matrix, dynamic duration)
│   │   └── tile-preloader.js            # MapLibre tile preloader for smooth transitions
│   ├── services/            # Briefing services
│   │   └── keyboard-service-briefing.js # Keyboard shortcuts
│   └── validation/          # Validation
│       └── reference-validator.js       # Reference validation
│
├── mode/                    # Application mode management
│   └── application-mode.manager.js  # Mode state machine
│
├── baselayers/              # Base map configurations
│   ├── base-layer.control.js    # MapLibre control for base layer switching
│   ├── bdgex_layer.js           # BDGEx (Brazilian Army topographic) WMS style
│   ├── carta_ortoimagem.js      # Orthoimage style definition
│   ├── carta_topografica.js     # Topographic map style
│   ├── imagens_layer.js         # Satellite imagery style
│   └── osm_layer.js             # OpenStreetMap raster style
├── layers/                  # Layer styles and management
│   ├── layer.manager.js     # Layer management logic
│   ├── layer.constants.js   # Layer constants
│   ├── layer_setup.js       # Layer initialization
│   ├── visibility-filter.js # Layer visibility filtering
│   └── styles/              # MapLibre style definitions
│       ├── point.layers.js
│       ├── line.layers.js
│       ├── polygon.layers.js
│       ├── shape.layers.js
│       ├── symbol.layers.js
│       ├── tactical.layers.js
│       ├── content.layers.js
│       └── auxiliary.layers.js
├── features_tab/            # Layer/feature list components
│   ├── features_tab.js      # Main features tab
│   ├── features_tab.constants.js
│   ├── features_tab.icons.js
│   ├── layer-list.component.js
│   ├── layer-container.builder.js
│   ├── feature-item.component.js
│   ├── group-item.component.js
│   ├── analysis-layers.component.js
│   ├── catalog-layers.component.js
│   ├── models3d-section.component.js
│   ├── streetview360-section.component.js
│   ├── collapse-state.manager.js     # Collapse state management
│   ├── feature-organizer.service.js  # Feature organization service
│   └── sortable.handler.js
├── map/                     # Map management and animations
│   ├── map.manager.js       # Map management (registered as 'MapManager')
│   ├── animation.service.js # Map animation service
│   └── drag-rotate.handler.js # Drag-to-rotate handler
├── terrain/                 # Terrain/hillshade
│   ├── terrain.control.js
│   ├── analysis-layers.manager.js
│   └── data-layers.manager.js  # Data layer manager for terrain
├── import_export/           # File I/O (GeoJSON, KML, CSV, .ebgeo, etc.)
│   ├── export-import.service.js
│   ├── import.control.js
│   ├── screenshot.control.js
│   ├── pdf-export.tab.js         # PDF export with cartographic layout options
│   ├── pdf-cartographic-elements.js  # Cartographic layout compositing (title, legend, scale bar, north arrow)
│   ├── drag-drop.handler.js    # Drag and drop file handler
│   └── csv/                 # CSV import with coordinate mapping
│       ├── csv-parser.js            # Lightweight CSV parser (no deps)
│       ├── csv-coordinate-converter.js  # DD, DMS, MGRS, UTM conversion
│       ├── csv-to-geojson.js        # CSV rows to GeoJSON FeatureCollection
│       ├── csv-config-panel.js      # Configuration UI panel
│       └── index.js                 # Barrel file
├── processing/              # Geospatial processing algorithms
│   ├── index.js             # Public exports
│   ├── processing.tab.js    # Processing sidebar tab
│   ├── processing-panel.js  # Algorithm parameter panel
│   ├── processing-runner.js # Algorithm execution runner
│   ├── processing.constants.js # Processing configuration
│   └── algorithms/          # Algorithm implementations
│       ├── algorithm.interface.js  # Algorithm contract
│       ├── buffer.algorithm.js     # Buffer algorithm
│       ├── voronoi.algorithm.js    # Voronoi diagram algorithm
│       └── index.js                # Algorithm registry
├── coordinates/             # Coordinate display/conversion
│   └── mouse-coordinates.control.js  # Cursor coordinate display with format switching and elevation
├── grid/                    # UTM grid overlay
│   ├── grid.control.js             # Grid toggle control with format selection
│   └── grid-layers.config.js       # UTM/latlong grid layer IDs at different scales
├── keyboard/                # Keyboard shortcuts
│   └── keyboard-shortcuts.js       # Centralized 2D keyboard shortcuts (undo/redo, etc.)
├── user_data/               # Feature attributes/images
│   ├── user_data_manager.js         # CRUD for custom attributes and images with compression
│   ├── attributes_tab_renderer.js   # Attributes tab with inline key-value editing
│   └── images_tab_renderer.js       # Images tab with upload, preview, deletion
├── ui/                      # Shared UI utilities
│   ├── ui-visibility.controller.js  # UI element visibility profiles per mode
│   ├── loading-screen.js           # Loading screen fade-out
│   └── index.js
└── utilities/               # Helpers
    ├── coordinate_converter.js  # Coordinate conversions
    ├── uuid.js              # UUID v4 generation
    ├── id_utils.js          # ID utilities (legacy support)
    ├── event-cleanup.js     # Event listener cleanup
    ├── feature_navigation_utils.js  # Feature navigation
    ├── pointer-utils.js     # Pointer event utilities
    ├── image_utils.js       # Image validation/processing
    ├── html-escape.js       # XSS prevention for innerHTML interpolation
    ├── toast_service.js     # Toast notifications (showToast, showWarning, showError)
    ├── debounced-persist.js # Debounced IndexedDB writes with retry
    ├── streetview360-state.js   # Street view state check
    ├── viewer3d-state.js    # 3D viewer state check
    ├── deep-utils.js        # Deep object utilities (clone, equality, path get/set)
    ├── geometry-utils.js    # Geometry calculations (distance, bearing, bbox)
    ├── lru-cache.js         # LRU cache implementation
    ├── maplibre-preload.js  # Tile preloader for smooth map animations
    ├── quill-helpers.js     # Quill.js rich text editor helpers
    └── geomagnetic/         # Geomagnetic calculations
        ├── wmm_calculator.js    # World Magnetic Model calculator
        └── index.js
```

## Architecture Patterns

### Tool Pattern
Each tool follows a consistent three-file pattern:
- `add_*_control.js` - MapLibre control, toolbar button, tool activation
- `add_*_geometry.js` - Geometry creation/editing logic
- `*_attributes_panel.js` - Feature property editor UI

### UI Architecture
The UI is organized into distinct components:
- **SidebarControl** - Collapsible sidebar with tabs (Maps, Layers, Briefings, Import, Export)
- **ToolbarControl** - Grouped tool buttons with popup menus
- **BottomControlsControl** - Feature toggles (terrain, 3D, street view)
- **BaseLayerSelectorControl** - Base map picker with thumbnails
- **FeaturePanel** - Integrated in sidebar for feature attributes
- **AttributeTableControl** - Data grid with filtering and sorting
- **BriefingEditorControl** - Full-screen briefing editor
- **BriefingPresenterControl** - Presentation mode with transitions

UI state is managed by `StateManager` which enforces mutual exclusivity:
- Sidebar and Feature Panel cannot both be open
- Only one toolbar group popup can be open at a time

### Application Modes
The application supports different operational modes via `ApplicationModeManager`:
- `NORMAL` - Default mode for map interaction
- `BRIEFING_EDIT` - Full-screen briefing editor
- `BRIEFING_PRESENT` - Presentation mode with transitions

Mode changes trigger UI visibility profiles that show/hide relevant UI elements.

### Store Pattern
Central state management with:
- Memory store (`memory-store.js`) for runtime data
- IndexedDB persistence via LocalForage with Repository abstraction
- Event-driven updates via EventBus
- Undo/redo support via action history with user-facing descriptions (pt-BR)
- Automatic v1-to-v2 schema migration

### Store Transaction Pattern
Feature operations use a persistence-first coordination pattern via `store-transaction.js`:
```javascript
import { runTransaction } from './store-transaction.js';

await runTransaction(async (tx) => {
    // 1. Prepare data, defer side effects
    tx.deferSync(() => updateColorTracking(feature));
    tx.deferAsync(() => logFeatureOperation(...));

    // 2. Return the persistence function
    return async () => {
        await repo.set(key, data);
    };
});
// Side effects only run AFTER persistence succeeds
// On failure: rollback discards all deferred effects + emits STORE_PERSIST_ERROR
```

### Store Error Handling
Structured error conventions in `store-errors.js`:
- **Invalid argument** (developer bug): `throw new Error(msg)`
- **Expected failure** (locked map): return existing type + emit `STORE_OPERATION_BLOCKED`
- **Background non-critical**: `console.warn`
- **Possible data loss** (IndexedDB): throw + emit `STORE_PERSIST_ERROR`
- **Sync queue failure**: emit `STORE_SYNC_ERROR` + retry

User-facing toast notifications via `store-error-listener.js` with debounce to prevent stacking.

### Debounced Persistence
`DebouncedPersist` class (`utilities/debounced-persist.js`) coalesces rapid writes:
- Per-key debounce timers (typically mapName)
- Retry with exponential backoff (1s, 2s, 4s)
- `flush(key)` for immediate execution, `cancel(key)` for discarding

### Snapping System
Geometry snapping service for drawing tools:
- Vertex, edge, and endpoint snapping with configurable tolerance
- Visual feedback indicators during drawing
- Integrated with draw tools via `snapping.service.js`

### Measurement Tool Pattern
Ephemeral (non-persistent) 2D measurement tools that do NOT follow the standard three-file tool pattern. They use a shared-module architecture: `measurement-geometry.js` (pure calculations), `measurement-labels.js` (MapLibre sources/layers), `measurement-results-panel.js` (UI). Each control (distance, area, angle) composes these modules. Measurements are read-only by default; distance and area offer "Salvar como feição" to persist as `line`/`polygon` features with `measure: true`. Keyboard shortcuts: `J` (distance), `H` (area), `X` (angle). Layers are initialized via `setupMeasurementLayers()` called from `layer_setup.js`.

### Point Callout Mode
Points support a `pointMode` property (`'marker'` | `'callout'`). When set to `'callout'`, additional properties control the annotation: `labelText`, `labelOffsetX/Y`, `labelFontSize`, `labelColor`, `showLeaderLine`, `leaderLineColor`. Two conditional MapLibre layers render callouts:
- `point-callout-label-layer` (symbol) — filtered by `pointMode === 'callout'`
- `point-callout-leader-layer` (line) — from `point-callout-leaders` GeoJSON source

Leader line geometry is computed from pixel offsets in `add_point_control.js` → `updateCalloutSources()`. The callout UI section appears in `point_attributes_panel.js` for single-selection only.

### PDF Cartographic Layout
The PDF export (`pdf-export.tab.js`) supports optional cartographic elements via checkboxes: title, legend, scale bar, and north arrow. When enabled, `pdf-cartographic-elements.js` composites these onto the captured map canvas using Canvas 2D API before GDAL processing. The `composeLayout(mapCanvas, options)` function creates a larger canvas with title above and legend below the map, plus scale bar (bottom-left) and north arrow (top-right of map area). Feature statistics for the legend are collected via `_collectFeatureStats()`.

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
- `BASE_LAYER_CHANGED`, `BASE_LAYER_SELECTOR_OPENED`, `BASE_LAYER_SELECTOR_CLOSED`
- `MAP_NOTES_REQUESTED`, `SEARCH_RESULT_PANEL_REQUESTED`
- `VECTOR_INFO_PANEL_OPENED`

Entity lifecycle events (for sync triggers):
- `FEATURE_CREATED`, `FEATURE_MODIFIED`, `FEATURE_DELETED`
- `LAYER_CREATED`, `LAYER_MODIFIED`, `LAYER_DELETED`
- `GROUP_CREATED`, `GROUP_MODIFIED`, `GROUP_DELETED`
- `MAP_CREATED`, `MAP_MODIFIED`, `MAP_DELETED`
- `MAP_LOCK_CHANGED` - Map read-only state toggle
- `ALL_DATA_CLEARED` - Storage wipe
- `BRIEFING_CREATED`, `BRIEFING_UPDATED`, `BRIEFING_DELETED`
- `BRIEFING_EDIT_STARTED`, `BRIEFING_EDIT_ENDED`
- `BRIEFING_PRESENT_STARTED`, `BRIEFING_PRESENT_ENDED`
- `BRIEFING_SLIDE_CHANGED`

3D viewer events:
- `VIEWER_3D_OPENED`, `VIEWER_3D_CLOSED`
- `MARKER_3D_CLICKED`, `MARKER_3D_DESELECTED`, `MARKERS_3D_CHANGED`
- `MEASUREMENT_3D_CLICKED`, `MEASUREMENT_3D_DESELECTED`, `MEASUREMENTS_3D_CHANGED`
- `VIEWSHED_3D_CLICKED`, `VIEWSHED_3D_DESELECTED`, `VIEWSHEDS_3D_CHANGED`
- `CAMERA_3D_SAVED`

Street View 360 events:
- `STREETVIEW_360_OPENED`, `STREETVIEW_360_CLOSED`, `STREETVIEW_360_PHOTO_CHANGED`
- `ORIENTATION_360_SAVED`, `ORIENTATION_360_CLEARED`
- `MARKER_360_CLICKED`, `MARKER_360_DESELECTED`, `MARKERS_360_CHANGED`
- `MARKER_360_POSITION_CLICKED`

Store error events:
- `STORE_PERSIST_ERROR` - IndexedDB write failure
- `STORE_SYNC_ERROR` - Sync queue write failure
- `STORE_OPERATION_BLOCKED` - Operation blocked by locked map

### Street View 360 Navigation Projection

The navigation system (`street_view_tool/navigation/`) projects target markers onto the 360 viewer canvas:

**Height Model (Flat Ground)** — GPS elevation (`ele`) is present in API responses but **not used** for projection. All targets use a flat ground model:
- **GPS targets**: `y = -cameraHeight` (all at ground level)
- **Override targets**: `y = -cameraHeight + overrideHeight` (manual height via `projectFromOverride()`)
- `override_height` defaults to 0 (ground plane), positive = above ground

**Projector** (`projector.js`):
- `calculateFlattenRatio(horizontalDistance, pitch, heightOffset)` — elliptical marker flattening with `h = cameraHeight - heightOffset`
- `calculateMarkerSize(worldRadius, horizontalDistance, fov, heightOffset)` — physically-based marker sizing using slant distance with `verticalDrop = cameraHeight - heightOffset`
- `heightOffset` defaults to 0; only override targets pass a non-zero value via `overrideHeight`

Both must stay in sync with the calibration counterparts in `ebgeo_360/public/calibration/js/`.

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
import { initServices, getEventBus, getStateManager, getLayerManager,
         getGroupManager, getMapResolver, getSessionContext,
         getConnectionState, getSyncGateway } from './store/services.js';

initServices(); // Must be called before any component
// Runs migrations automatically, initializes sync infrastructure
```

## Key Conventions

### Imports
- Use path aliases: `@js/`, `@store/`, `@utils/`, `@tools/`, `@toolbar/`, `@modals/`, `@sidebar/`, `@layers/`, `@catalog/`, `@ui/`, `@events/`, `@state/`, `@css/`
- Each module folder has an `index.js` barrel file for public exports

### Feature Types
Features are identified by type strings: `'point'`, `'line'`, `'polygon'`, `'circle'`, `'ellipse'`, `'rectangle'`, `'sector'`, `'text'`, `'image'`, `'brush'`, `'arrow'`, `'boundary'`, `'occupied_front'`, `'military_symbol'`, `'coordination_measure'`, `'los'`, `'visibility'`

### Layer System
- Features belong to layers
- Layers have visibility and locked states
- Active layer receives new features
- Layer operations emit `LAYERS_CHANGED` events
- Visibility filtering via `layers/visibility-filter.js`

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
Handles bidirectional name <-> UUID resolution for backward compatibility:
```javascript
import { getMapResolver } from './store/services.js';

const resolver = getMapResolver();
const mapId = resolver.resolveToId('Mapa 1');     // Returns UUID
const mapName = resolver.resolveToName(mapId);    // Returns display name
```

### Geomagnetic Declination
Automatic magnetic declination calculation for azimuth tools:
```javascript
import { calculateDeclination } from 'utilities/geomagnetic';

// Returns magnetic declination in degrees for a given position
const declination = calculateDeclination(lat, lng);
```

## Code Style

- ES Modules (ESM) throughout
- Classes for controls and managers
- JSDoc comments for public APIs
- Event-driven communication between modules
- No framework dependencies (vanilla JS)

## Code Quality Rules

These rules are enforced across the codebase. Follow them when writing new code or modifying existing files.

### Language
- **UI strings** (labels, tooltips, messages, placeholders) MUST be in **Portuguese (pt-BR)** with correct accents
- **Code comments** MUST be in **English** (exception: `config.js` may use Portuguese)
- **JSDoc** MUST be in English

### CSS: No Inline Styles in JavaScript
- Do NOT use `style.cssText`, `style.xxx = '...'`, or inline style objects in JS
- Extract styles to CSS files using BEM class naming (e.g., `.measurement-label`, `.visibility-progress-modal__bar`)
- Use `className` and `classList.toggle/add/remove` instead of inline styles
- CSS files: `base.css` (shared), `panels-2d.css` (2D tools), `panels-3d.css` (3D tools), `panels-360.css` (street view), `sidebar.css`, `features-tab.css`, `attributes-panel.css`, `briefing-editor.css`, `briefing-presentation.css`, `measurement.css`, `pdf-export.css`, and component-specific CSS files in `src/css/`
- **Exception**: Dynamic styles that depend on JS runtime values (e.g., colors from JS constants, computed positions) may use inline styles

### innerHTML and XSS Prevention
- Do NOT use `innerHTML` with user-provided data or dynamic strings
- Use `textContent` for text content, `document.createElement` for DOM structure
- Static SVG icons from constants are acceptable via `innerHTML` (not user data)
- Import `escapeHtml` from `utilities/html-escape.js` when interpolating user data into HTML

### Event Listener Cleanup
- Use `setupCleanup/subscribe/addDomListener/trackTimer/cleanup` from `utilities/event-cleanup.js` for components with EventBus subscriptions and DOM listeners
- MapLibre `map.on()` listeners must have matching `map.off()` in `removeAllEventListeners()` or `onRemove()`
- Cesium `ScreenSpaceEventHandler` must call `.destroy()` in cleanup
- Document-level listeners (`document.addEventListener`) must store handler references and remove them on cleanup
- Context menu / dropdown listeners must be cleaned up in the hide/close function, not just in the event callback
- Debounce/throttle timers (`setTimeout`) must be cleared in cleanup functions

### Utility Usage
- Use `deepClone()` from `utilities/deep-utils.js` instead of `JSON.parse(JSON.stringify(...))`
- Use `showToast(message, type)` from `utilities/index.js` instead of `alert()`
- Use `generateUUID()` from `utilities/uuid.js` for all new IDs
- Use `EventTypes.XXX` constants instead of hardcoded event name strings

### Schema Consistency
- Briefing slides use `modelId` (not `tilesetId`) for 3D model references
- Feature properties use Portuguese field names: `nome`, `descricao`, `visivel`, `bloqueado`
- Sync metadata fields: `createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`

### Dead Code
- Remove unused imports (no `_` prefix aliasing for unused imports)
- Remove commented-out code blocks without explanation
- Remove no-op functions (e.g., `cleanupFunctions.push(() => {})`)

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
- `core` - Store, state, events, utilities, layers, terrain, baselayers, toolbar, modals, catalog, tool_manager, mode, briefing, UI, grid, coordinates, snapping, measurement_tool, config, map/animation.service
- `ui-components` - Sidebar, features_tab, user_data, attribute_table, search, bottom-controls, base-layer-selector, context-menu, vector_info, processing
- `draw-tools` - All drawing tools (including sector_tool) + azimuth_distance_tool
- `military-tools` - Military symbology
- `analysis-tools` - LOS and visibility
- `selection-tools` - Rectangle selection
- `cesium-integration` - 3D viewer: map_3d, tools/, services/ (lazy loaded)
- `import-export` - File handling (lazy loaded)
- `street-view` - Three.js street view (lazy loaded)
- Unmapped modules (keyboard, map/map.manager, map/drag-rotate) go to the main entry bundle

External dependencies loaded via script tags:
- MapLibre GL JS
- Turf.js
- milsymbol
- Cesium (loaded on demand)
- GDAL (for georeferenced PDF export)

## Testing

Vitest is configured for unit testing:
```bash
npm test           # Run tests once
npm run test:watch # Run tests in watch mode
```

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
