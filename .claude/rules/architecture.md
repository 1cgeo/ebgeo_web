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
│   ├── control.registry.js  # registerControl / getControl
│   ├── store-state-manager.js  # Undo/redo, color tracking
│   ├── store-transaction.js    # Persistence-first transactions
│   ├── store-errors.js         # Error conventions (StoreErrorEvents)
│   ├── feature.operations.js   # Feature CRUD
│   ├── layer.operations.js     # Layer CRUD
│   ├── group.operations.js     # Grouping
│   ├── map.operations.js       # Map CRUD
│   ├── briefing.operations.js  # Briefing CRUD
│   ├── catalog.operations.js   # External-layer catalog state
│   ├── customIcons.operations.js  # User custom point icons
│   ├── settings.operations.js  # App/user settings
│   ├── cesium3d.operations.js  # 3D operations
│   ├── streetview360.operations.js
│   ├── temporal.operations.js  # Per-map temporal config (temporal_<mapName>); shiftMapTemporalTimes
│   ├── atlas/               # Atlas entity (top-level project container)
│   ├── repositories/        # Repository abstraction (interface, local, factory)
│   ├── services/             # map-resolver.service.js (name↔UUID with LRU)
│   ├── migration/            # Schema migrations (v1→v2, v2→v2.1; auto, version-conditional on startup)
│   └── sync/                 # Operation queue, Lamport clock, future WebSocket infra (no-op offline)
│
├── events/                  # event_bus.js, event_types.js, event_emitter.js
├── state/                   # state_manager.js (UI state: sidebar, panels)
│
├── tool_manager/            # Base classes + tool orchestration + UI helpers
│   ├── tool_manager.js / ui_manager.js   # Active-tool + attribute-panel orchestration
│   ├── base_control.js / base_geometry.js
│   ├── selection_manager.js / clipboard_manager.js / move_handler.js / group_manager.js
│   ├── helpers/             # Panel building blocks (color-picker, slider, etc.)
│   └── managers/            # profile-panel, selection-highlight
│
├── draw_tools/              # point, line, polygon, circle, ellipse, rectangle,
│                            # sector, text, image, brush (each: control+geometry+panel)
├── military_tools/          # military_symbol, coordination_measure, arrow, boundary,
│                            # occupied_front, declination
├── analysis_tools/          # los_tool, visibility_tool
├── azimuth_distance_tool/   # Azimuth & distance navigation
├── measurement_tool/        # Ephemeral 2D measurements (distance/area/angle)
├── snapping/                # Vertex/edge/endpoint snapping service
├── selection_tools/         # Selection interaction tools
├── vector_info/             # Vector feature info panel
├── temporal/                # Timeline module (per-map): controller, render service,
│                            # pure model, derivation, trajectory-tool (keypoint editing)
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
├── processing/              # Geospatial algorithms (Buffer, Voronoi, Convex Hull; registry pattern)
│
├── layers/                  # MapLibre style definitions + layer manager
├── baselayers/              # Base map styles (BDGEx, OSM, satellite, topo)
├── terrain/                 # Terrain/hillshade controls
├── map/                     # map.manager.js, animation.service.js, drag-rotate.handler.js
├── mode/                    # Application mode state machine
├── coordinates/             # Mouse coordinate display
├── grid/                    # UTM grid overlay
├── keyboard/                # Keyboard shortcuts
├── deep-link/               # Shareable URL state (deep linking)
├── phone/                   # Mobile/phone-specific UI
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
- `operation-dispatcher.js` / `remote-operation-handler.js` — outbound/inbound op plumbing (idle offline)
- `permission-guard.js` — role-based gate (always permissive offline)
- `event-bridges.js` / `operation-types.js` / `sync-metadata.js` — wiring + shared shapes

## Vite Chunks

Defined in `vite.config.js` `manualChunks`. The composite chunks below list only the headline modules — each pulls in many more (e.g. `core` also includes state, terrain, baselayers, catalog, tool_manager, mode, briefing, snapping, grid, coordinates, measurement_tool):

`core` (store, events, utilities, layers, toolbar, modals, …) | `ui-components` (sidebar, features_tab, search, …) | `draw-tools` (+ azimuth_distance_tool) | `military-tools` | `analysis-tools` | `selection-tools` | `phone-ui` | `cesium-integration` (lazy) | `import-export` (lazy) | `street-view` (lazy).

Unmapped paths (e.g. `keyboard`, `map/map.manager`) fall into the entry bundle.

## Event Types Reference

App events are defined in `events/event_types.js` and accessed via `EventTypes.XXX`. Representative categories (not exhaustive):
- **Entity lifecycle**: `FEATURE_CREATED/MODIFIED/DELETED`, `LAYER_CREATED/MODIFIED/DELETED`, `MAP_CREATED/MODIFIED/DELETED`, `GROUP_CREATED/MODIFIED/DELETED`, `BRIEFING_CREATED/UPDATED/DELETED`. Plus `LAYERS_CHANGED` (active-map layer set changed) and `FEATURE_UPDATED` (feature user-data/attribute/image changes — distinct from `FEATURE_MODIFIED`).
- **UI coordination**: `SIDEBAR_EXPANDED/COLLAPSED`, `SIDEBAR_TAB_CHANGED`, `FEATURE_PANEL_OPENED/CLOSED`, `UI_LAYOUT_CHANGED`, `UI_CLOSE_ALL_POPUPS`, `TOOLBAR_GROUP_OPENED/CLOSED`, `BASE_LAYER_CHANGED`, `MAP_LOCK_CHANGED`
- **Briefing**: `BRIEFING_EDIT_STARTED/ENDED`, `BRIEFING_PRESENT_STARTED/ENDED`, `BRIEFING_SLIDE_CHANGED`
- **Processing**: `PROCESSING_STARTED/COMPLETED/ERROR`
- **Temporal**: `MAP_TEMPORAL_CHANGED` (per-map control toggled), `TEMPORAL_CONFIG_CHANGED` (unit/bounds/origin changed), `TEMPORAL_CURSOR_CHANGED` (cursor moved — emitted per playback frame)
- **Session/Sync** (offline no-op today): `SESSION_CHANGED`, `CONNECTION_STATE_CHANGED`, `REMOTE_OPERATION_APPLIED`
- **3D viewer**: `VIEWER_3D_OPENED/CLOSED`, `MARKER_3D_CLICKED`, `VIEWSHED_3D_CLICKED/DESELECTED`, `VIEWSHEDS_3D_CHANGED`
- **360 viewer**: `STREETVIEW_360_OPENED/CLOSED`, `MARKER_360_*`, `ORIENTATION_360_*`

**Store-error events** are separate — defined in `store/store-errors.js` as `StoreErrorEvents` (not `event_types.js`): `STORE_PERSIST_ERROR`, `STORE_SYNC_ERROR`, `STORE_OPERATION_BLOCKED`.
