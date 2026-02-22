# Architecture Reference

## Project Structure

```
src/js/
├── index.js                 # Entry point
├── map_sig.js               # Map init, control registration
├── config.js / config.helpers.js / config-loader.js
│
├── store/                   # Central data store
│   ├── index.js             # Public barrel (re-exports store.js + services)
│   ├── store.js             # Facade with all operation re-exports
│   ├── services.js          # DI container (initServices, getters)
│   ├── memory-store.js      # In-memory runtime state
│   ├── repository.js        # IndexedDB persistence
│   ├── store-state-manager.js  # Undo/redo, color tracking
│   ├── store-transaction.js    # Persistence-first transactions
│   ├── store-errors.js         # Error conventions
│   ├── feature.operations.js   # Feature CRUD
│   ├── layer.operations.js     # Layer CRUD
│   ├── group.operations.js     # Grouping
│   ├── map.operations.js       # Map CRUD
│   ├── briefing.operations.js  # Briefing CRUD
│   ├── cesium3d.operations.js  # 3D operations
│   ├── streetview360.operations.js
│   ├── repositories/        # Repository abstraction (interface, local, factory)
│   ├── services/             # map-resolver.service.js (name↔UUID with LRU)
│   ├── migration/            # v1→v2 schema migration (auto on startup)
│   └── sync/                 # Operation queue, Lamport clock, future WebSocket infra
│
├── events/                  # event_bus.js, event_types.js, event_emitter.js
├── state/                   # state_manager.js (UI state: sidebar, panels)
│
├── tool_manager/            # Base classes + UI helpers
│   ├── base_control.js / base_geometry.js
│   ├── selection_manager.js / clipboard_manager.js / move_handler.js
│   ├── helpers/             # Panel building blocks (color-picker, slider, etc.)
│   └── managers/            # profile-panel, selection-highlight
│
├── draw_tools/              # point, line, polygon, circle, ellipse, rectangle,
│                            # sector, text, image, brush (each: control+geometry+panel)
├── military_tools/          # military_symbol, coordination_measure, arrow, boundary, occupied_front
├── analysis_tools/          # los_tool, visibility_tool
├── azimuth_distance_tool/   # Azimuth & distance navigation
├── measurement_tool/        # Ephemeral 2D measurements (distance/area/angle)
├── snapping/                # Vertex/edge/endpoint snapping service
├── selection_tools/         # Selection interaction tools
├── vector_info/             # Vector feature info panel
│
├── sidebar/                 # Collapsible sidebar (tabs: Maps, Layers, Briefings, Import, Export)
├── toolbar/                 # Grouped tool buttons with popups
├── bottom-controls/         # Feature toggles (terrain, 3D, street view)
├── base-layer-selector/     # Base map picker
├── modals/                  # Modal dialogs
├── search/                  # Global search bar
├── context-menu/            # Right-click menus
├── catalog/                 # External layer catalog
├── attribute_table/         # Data grid with filtering
├── features_tab/            # Layer/feature tree list
│
├── 3d_models_viewer_tool/   # Cesium 3D (lazy loaded)
├── street_view_tool/        # Three.js 360 viewer (lazy loaded)
├── briefing/                # Story Map editor + presenter
├── import_export/           # GeoJSON, KML, CSV, SHP, .ebgeo, PDF
├── processing/              # Geospatial algorithms (Buffer, Voronoi, registry pattern)
│
├── layers/                  # MapLibre style definitions + layer manager
├── baselayers/              # Base map styles (BDGEx, OSM, satellite, topo)
├── terrain/                 # Terrain/hillshade controls
├── map/                     # map.manager.js, animation.service.js
├── mode/                    # Application mode state machine
├── coordinates/             # Mouse coordinate display
├── grid/                    # UTM grid overlay
├── keyboard/                # Keyboard shortcuts
├── user_data/               # Custom attributes + image management
├── ui/                      # Shared UI utilities
└── utilities/               # Helpers (uuid, deep-utils, toast, event-cleanup, etc.)
```

## UI Architecture

- **StateManager** enforces mutual exclusivity: sidebar and feature panel cannot both be open
- UI components subscribe to `UI_LAYOUT_CHANGED` for position updates
- `selectFeature()` saves inline + clears selection without closing panel (avoids bounce)

## Measurement Tools

Ephemeral (non-persistent) tools that do NOT follow the 3-file tool pattern. Shared modules: `measurement-geometry.js` (calculations), `measurement-labels.js` (MapLibre layers), `measurement-results-panel.js` (UI). Shortcuts: J (distance), H (area), X (angle). Distance/area can "Salvar como feicao" to persist.

## Point Callout Mode

Points support `pointMode`: `'marker'` | `'callout'`. Callout properties: `labelText`, `labelOffsetX/Y`, `labelFontSize`, `labelColor`, `showLeaderLine`, `leaderLineColor`. Rendered via `point-callout-label-layer` + `point-callout-leader-layer`. Leader geometry computed in `add_point_control.js` → `updateCalloutSources()`.

## Sync Infrastructure

Operation queue with Lamport clock for causal ordering. Queue compaction: CREATE+DELETE=remove both, CREATE+UPDATEs=merge. Real-time sync infra (session-context, connection-state, sync-gateway, sync-scheduler) is wired but no-op offline, ready for future WebSocket backend.

### Multi-User Preparation (NOT yet implemented)

The app is currently **offline-only**. The sync infrastructure exists solely to make a future WebSocket backend transition easy — no backend or multi-user feature exists yet. Full spec: `docs/acoes-interface-multiusuario.md`.

**Future design direction:** no locks (all LWW), JWT auth (Owner/Admin/Editor/Viewer roles), soft-delete, per-user undo.

**Groundwork already laid (client-side only, all no-op today):**
- `operation-queue.js` — IndexedDB queue with compaction
- `operation-factory.js` — Lamport clock for causal ordering
- `session-context.js` — identity abstraction (offline anonymous for now)
- `connection-state.js` — state machine (permanently OFFLINE for now)
- `sync-gateway.js` — transmission abstraction (no-op)
- `sync-scheduler.js` — debounced entity lifecycle listener (queues locally only)

## Vite Chunks

`core` (store, events, utilities, layers, toolbar, modals) | `ui-components` (sidebar, features_tab, search) | `draw-tools` | `military-tools` | `analysis-tools` | `cesium-integration` (lazy) | `import-export` (lazy) | `street-view` (lazy)

## Event Types Reference

All events defined in `events/event_types.js`. Key categories:
- **Entity lifecycle**: `FEATURE_CREATED/MODIFIED/DELETED`, `LAYER_*`, `MAP_*`, `GROUP_*`, `BRIEFING_*`
- **UI coordination**: `SIDEBAR_EXPANDED/COLLAPSED`, `FEATURE_PANEL_OPENED/CLOSED`, `UI_LAYOUT_CHANGED`, `UI_CLOSE_ALL_POPUPS`
- **Briefing**: `BRIEFING_EDIT_STARTED/ENDED`, `BRIEFING_PRESENT_STARTED/ENDED`, `BRIEFING_SLIDE_CHANGED`
- **Processing**: `PROCESSING_STARTED/COMPLETED/ERROR`
- **Session/Sync**: `SESSION_CHANGED`, `CONNECTION_STATE_CHANGED`, `SYNC_STARTED/COMPLETED`, `REMOTE_OPERATION_APPLIED`
- **3D viewer**: `VIEWER_3D_OPENED/CLOSED`, `MARKER_3D_CLICKED`, `VIEWSHED_3D_*`
- **360 viewer**: `STREETVIEW_360_OPENED/CLOSED`, `MARKER_360_*`, `ORIENTATION_360_*`
- **Store errors**: `STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`
