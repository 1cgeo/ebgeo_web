// vite.config.js
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode: _mode }) => ({
  // ===== ROOT E ESTRUTURA =====
  root: '.',
  publicDir: 'public',
  // base: _mode === 'production' ? '/cms/' : '/',

  // ===== BUILD CONFIGURATION =====
  build: {
    outDir: 'dist',
    assetsDir: 'assets',

    // Minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: false,
        passes: 2
      },
      mangle: {
        safari10: true
      },
      format: {
        comments: false
      }
    },

    // Code splitting
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        // Chunks by functionality (path-based matching)
        // IMPORTANT: Order matters! More specific rules must come first.
        // Chunks are organized to avoid circular dependencies:
        //   core (store, state, events, utilities, layers, terrain, baselayers, catalog,
        //         modals, toolbar, tool_manager, mode, briefing, ui, config, snapping,
        //         map/animation, grid, coordinates)
        //   -> ui-components (sidebar, features_tab, user_data, attribute_table, search,
        //                     bottom-controls, base-layer-selector, context-menu, vector_info, processing)
        //   -> tools (draw, military, analysis, selection)
        //   -> lazy (cesium-integration, street-view, first-person-3d, import-export)
        // Unmapped (falls to main entry bundle): keyboard, map/map.manager, map/drag-rotate,
        //                                        first_person_3d_tool/index (barrel)
        manualChunks(id) {
          // ===== STATICALLY-IMPORTED SERVICES (must resolve before lazy chunks) =====

          // keyboard-service-3d is statically imported by sig.js (entry point)
          // and depends on modals + store (both in core). Despite living under
          // 3d_models_viewer_tool/services/, it is NOT lazy-loaded.
          // Assigning it to cesium-integration creates a core <-> cesium-integration
          // circular chunk on Linux where Rollup strictly respects manualChunks.
          // Placing it in core follows the same pattern as keyboard-service-briefing.
          if (id.includes('3d_models_viewer_tool/services/keyboard-service-3d')) {
            return 'core';
          }

          // scene-config.service reads the firstPerson3d config section and is
          // statically imported by add_3d_models_viewer_control (main entry),
          // catalog/catalog.service (core) and search/* (ui-components).
          // Leaving it inside first-person-3d would make core AND ui-components
          // statically depend on a lazy chunk that itself depends on core — the
          // circular chunk pair that produces the TDZ "Cannot access 'X' before
          // initialization" crash. It belongs in core, like config.js.
          // walk/voxel-collision and walk/constants ride along: the service
          // instantiates a VoxelCollision in loadSceneCollision(), and both are
          // pure leaves (no DOM, no @manycore/aholo-viewer, a couple of kB), so
          // pinning them to core removes the same core -> first-person-3d edge
          // instead of pulling the splatting runtime in. walk-mode.js does NOT
          // ride along — it imports aholo-viewer and stays lazy.
          if (id.includes('first_person_3d_tool/scene-config.service') ||
              id.includes('first_person_3d_tool/walk/voxel-collision') ||
              id.includes('first_person_3d_tool/walk/constants')) {
            return 'core';
          }

          // keyboard-service-fp is statically imported by map_sig.js (entry) to
          // receive the global KeyboardShortcuts instance, and depends only on
          // core. Same reasoning as keyboard-service-3d above: from inside the
          // lazy chunk it would drag first-person-3d — and with it the whole
          // splatting runtime — into the startup path, defeating the lazy load.
          if (id.includes('first_person_3d_tool/services/keyboard-service-fp')) {
            return 'core';
          }

          // ===== LAZY LOADED CHUNKS (independentes) =====

          // 3D code split (lazy load via dynamic import)
          // NOTE: Only map_3d.js, tools/* and services/cesium-compat.js are lazy-loaded.
          // add_3d_models_viewer_control.js is statically imported,
          // so it stays in main bundle.
          // Panels (marker-panel-3d, measurement-panel-3d, viewshed-panel-3d)
          // use dynamic imports to avoid conflicts.
          if (id.includes('3d_models_viewer_tool/map_3d') ||
              id.includes('3d_models_viewer_tool/tools/') ||
              id.includes('3d_models_viewer_tool/services/')) {
            return 'cesium-integration';
          }
          // Street view (Three.js - lazy load)
          if (id.includes('street_view_tool')) {
            return 'street-view';
          }
          // First-person 3D scene (Gaussian splatting / @manycore/aholo-viewer - lazy load)
          // NOTE: matched by explicit subpaths, not by the folder name. The barrel
          // first_person_3d_tool/index.js must NOT land here: it is statically
          // imported by src/js/index.js (beforeunload cleanup) and holds only async
          // wrappers, so it belongs in the entry bundle — exactly like
          // 3d_models_viewer_tool/index.js. A folder-wide match would put the barrel
          // in this chunk and make the entry bundle load the splatting runtime on
          // startup. scene-config.service, walk/voxel-collision, walk/constants and
          // services/keyboard-service-fp were already routed to core above.
          if (id.includes('first_person_3d_tool/first_person_viewer') ||
              id.includes('first_person_3d_tool/components/') ||
              id.includes('first_person_3d_tool/tools/') ||
              id.includes('first_person_3d_tool/walk/walk-mode')) {
            return 'first-person-3d';
          }
          // Import/export tools
          // export-utils.js is shared between import_export (import-export chunk)
          // and briefing/export (core chunk). Placing it in core breaks the cycle.
          if (id.includes('import_export/export-utils')) {
            return 'core';
          }
          if (id.includes('import_export')) {
            return 'import-export';
          }

          // ===== TOOL CHUNKS =====

          // boundary-zoom.model.js is a zero-import leaf (pure zoom math for the
          // boundary tool). It lives under military_tools/ but is statically imported
          // by layers/styles/tactical.layers and import_export/export-utils (both core),
          // so leaving it in military-tools would recreate the core <-> military-tools
          // cycle. Same pattern as keyboard-service-3d above.
          if (id.includes('boundary_tool/boundary-zoom.model')) {
            return 'core';
          }
          // coordination-line-zoom.model.js is the same shape and joins core for the
          // same reason: a zero-import leaf under military_tools/ that
          // layers/styles/tactical.layers imports statically to build its
          // line-width expression.
          if (id.includes('coordination_line_tool/coordination-line-zoom.model')) {
            return 'core';
          }
          // boundary-split.model.js is a pure leaf too (cut eligibility plus the
          // echelon-ratio remap; its only import is tool_manager/helpers/
          // linear-conversion.model, which is core). It lives under
          // military_tools/ but the context menu (ui-components) imports it
          // statically to gate its "Cortar Linha de Limite" entry, so it follows
          // boundary-zoom.model into core for the same reason.
          if (id.includes('boundary_tool/boundary-split.model')) {
            return 'core';
          }
          // Military tools (large bundle)
          if (id.includes('military_tools')) {
            return 'military-tools';
          }
          // Analysis tools (LOS and visibility)
          if (id.includes('analysis_tools')) {
             return 'analysis-tools';
          }
          // point-marker-symbols.js is a leaf module (symbol definitions +
          // canvas helpers, zero draw_tools imports). It lives under draw_tools/
          // but is consumed by tool_manager/helpers/marker-symbol-picker (core).
          // Routing it to core breaks the draw-tools <-> core cycle.
          if (id.includes('draw_tools/point_tool/point-marker-symbols')) {
            return 'core';
          }
          // point-custom-icons.js is also a leaf module (custom-icon runtime
          // helpers; imports only @utils/store/events — all core, zero draw_tools
          // imports). It is consumed by core modules (tool_manager/clipboard_manager,
          // tool_manager/helpers/marker-symbol-picker, layers/layer_setup), so it
          // must live in core too — otherwise core statically depends on the
          // draw-tools chunk and recreates the draw-tools <-> core cycle (TDZ
          // "Cannot access 'X' before initialization" at runtime).
          if (id.includes('draw_tools/point_tool/point-custom-icons')) {
            return 'core';
          }
          // drawing-touch-helpers.js is a shared leaf module (touch finish/remove
          // helpers; imports only utilities/pointer-utils — core). Although it lives
          // under draw_tools/, it is consumed by military-tools (arrow/boundary) and
          // by temporal/trajectory-tool. Leaving it in the draw-tools chunk creates a
          // military-tools -> draw-tools edge (and a temporal -> draw-tools edge),
          // which feed the import-export -> ui-components -> military-tools ->
          // draw-tools cycle. Routing it to core removes those cross-tool edges.
          if (id.includes('draw_tools/drawing-touch-helpers')) {
            return 'core';
          }
          // Drawing tools
          if (id.includes('draw_tools')) {
            return 'draw-tools';
          }
          // Selection tools
          if (id.includes('selection_tools')) {
            return 'selection-tools';
          }
          // Azimuth Distance tool (utility tool)
          if (id.includes('azimuth_distance_tool')) {
            return 'draw-tools';
          }
          // Measurement tools (ephemeral distance/area/angle)
          // In core because layer_setup.js (core) imports setupMeasurementLayers
          if (id.includes('measurement_tool')) {
            return 'core';
          }
          // Temporal module (timeline, trajectory, model, derivation).
          // Mutually entangled with core's store layer: store/feature.operations
          // and store/temporal.operations import temporal.utils/temporal.constants,
          // while temporal depends only on core (store/utils/events/layers/
          // tool_manager + drawing-touch-helpers, now also core). It is consumed by
          // draw-tools, military-tools, import-export, ui-components and 3D/360.
          // Without an explicit rule, Rollup scatters temporal modules across those
          // chunks, landing shared ones in import-export and creating a phantom
          // draw-tools -> import-export edge. Pinning it to core makes placement
          // deterministic and cycle-free.
          if (id.includes('src/js/temporal/')) {
            return 'core';
          }

          // ===== PHONE UI (standalone, depends on core + ui-components) =====
          if (id.includes('/phone/')) {
            return 'phone-ui';
          }

          // ===== UI COMPONENTS (depends on core) =====
          // Includes: sidebar, features_tab, user_data, attribute_table, search, bottom-controls, base-layer-selector, context-menu

          // Features tab, user data and attribute table
          if (id.includes('src/js/features_tab/') ||
              id.includes('src/js/user_data/') ||
              id.includes('src/js/attribute_table/')) {
            return 'ui-components';
          }
          // UI components (sidebar, processing, etc. - toolbar is in core, NOT here)
          if (id.includes('src/js/sidebar/') ||
              id.includes('src/js/processing/') ||
              id.includes('src/js/bottom-controls/') ||
              id.includes('src/js/base-layer-selector/') ||
              id.includes('src/js/context-menu/')) {
            return 'ui-components';
          }
          // Search and vector info
          if (id.includes('src/js/search/') || id.includes('src/js/vector_info/')) {
            return 'ui-components';
          }

          // ===== CORE CHUNK (foundation for everything) =====
          // Includes: store, state, events, utilities, layers, terrain, baselayers,
          //           toolbar, modals, catalog, tool_manager, mode, briefing,
          //           config, snapping, map/animation.service
          //
          // utilities is here because toolbar, modals, and cesium-integration depend on it
          // toolbar/modals/catalog are here because:
          //   - store/settings.operations imports from catalog/catalog.constants
          //   - modals/shortcuts.modal imports from toolbar/toolbar.constants
          //   - catalog/catalog.modal imports from modals/modal.base
          // tool_manager is here because:
          //   - Contains shared managers (selection, ui, clipboard, etc.)
          //   - Base for all drawing tools
          // mode is here because:
          //   - ApplicationModeManager is used across the entire application
          // briefing is here because:
          //   - Keyboard service is loaded alongside other services

          // Application config (leaf module with zero imports).
          // Consumed by core (store, baselayers, layers, terrain, catalog,
          // coordinates, briefing) AND ui-components (search, sidebar,
          // features_tab, bottom-controls, base-layer-selector, vector_info).
          // Must live in core; otherwise it lands in the main entry chunk and
          // creates main <-> core / main <-> ui-components circular deps.
          // endsWith avoids false matches on unrelated *config* filenames.
          if (id.endsWith('src/js/config.js') ||
              id.endsWith('src/js/config-loader.js') ||
              id.endsWith('src/js/config.helpers.js')) {
            return 'core';
          }

          // Map animation service (leaf module with zero imports).
          // Consumed by core (briefing/transition_service) and ui-components
          // (context-menu). Same rationale as config.js above.
          if (id.includes('src/js/map/animation')) {
            return 'core';
          }

          // Snapping service (leaf module with zero imports).
          // Consumed by draw-tools and analysis-tools. Without this rule,
          // it lands in main and creates main <-> draw-tools / main <->
          // analysis-tools circular deps.
          if (id.includes('src/js/snapping/')) {
            return 'core';
          }

          // Utilities (base for toolbar, modals, and also used by cesium-integration)
          // MUST come before any other chunk that depends on it
          if (id.includes('src/js/utilities/')) {
            return 'core';
          }
          // Tool manager (base for all tools)
          if (id.includes('src/js/tool_manager/')) {
            return 'core';
          }
          // Store and state management
          if (id.includes('src/js/store/') || id.includes('src/js/state/')) {
            return 'core';
          }
          // Events
          if (id.includes('src/js/events/')) {
            return 'core';
          }
          // Application mode management
          if (id.includes('src/js/mode/')) {
            return 'core';
          }
          // Briefing infrastructure (keyboard service, etc.)
          if (id.includes('src/js/briefing/')) {
            return 'core';
          }
          // Layers and baselayers (depend on store)
          if (id.includes('src/js/layers/') || id.includes('src/js/baselayers/')) {
            return 'core';
          }
          // Terrain (depends on store and layers)
          if (id.includes('src/js/terrain/')) {
            return 'core';
          }
          // Toolbar (depended on by modals/shortcuts.modal)
          if (id.includes('src/js/toolbar/')) {
            return 'core';
          }
          // Modals (depends on toolbar, depended on by catalog)
          if (id.includes('src/js/modals/')) {
            return 'core';
          }
          // Catalog (depends on modals, depended on by store/settings.operations)
          if (id.includes('src/js/catalog/')) {
            return 'core';
          }
          // UI base components
          if (id.includes('src/js/ui/')) {
            return 'core';
          }
          // Map utilities (grid, coordinates)
          if (id.includes('src/js/grid/') ||
              id.includes('src/js/coordinates/')) {
            return 'core';
          }
        },
        // Output file names
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      // External vendors (not bundled)
      // Specific regex to exclude only the Cesium vendor,
      // not project files like cesium3d.operations.js
      external: [
        // Exact match of 'cesium' module (import 'cesium')
        /^cesium$/i,
        // Match cesium subpaths (import 'cesium/Source/...')
        /^cesium\//i,
        // Match local Cesium vendor paths
        /vendors\/cesium/i,
        // Match node_modules paths (if cesium installed via npm)
        /node_modules\/cesium/i
      ]
    },

    // Source maps: 'hidden' generates maps without exposing them publicly
    sourcemap: 'hidden',

    // Maximum chunk size before warning.
    // core sits at ~1105 kB minified (~340 kB gzip) by design: it is the shared
    // foundation chunk (store, tool_manager, briefing, modals, catalog, temporal, ...)
    // and cannot be split further without circular chunk dependencies. The temporal
    // module lives here because it is mutually entangled with the store layer
    // (store/feature.operations + store/temporal.operations import temporal helpers),
    // so it cannot be hoisted to a separate chunk without a core <-> temporal cycle.
    //
    // first-person-3d trips this warning on purpose (~1.9 MB minified): it is almost
    // entirely the @manycore/aholo-viewer splatting runtime, which cannot be split.
    // The limit stays at 1200 so it keeps guarding core's growth — raising it to
    // silence one lazy chunk would blind the only chunk that loads on startup.
    chunkSizeWarningLimit: 1200
  },

  // ===== DEVELOPMENT SERVER =====
  server: {
    port: 3000,
    open: true,
    cors: true,

    // API proxy (if needed)
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/busca': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },

  // ===== PREVIEW (local production) =====
  preview: {
    port: 4173,
    strictPort: false
  },

  // ===== MODULE RESOLUTION =====
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@js': resolve(__dirname, 'src/js'),
      '@css': resolve(__dirname, 'src/css'),
      '@store': resolve(__dirname, 'src/js/store'),
      '@state': resolve(__dirname, 'src/js/state'),
      '@utils': resolve(__dirname, 'src/js/utilities'),
      '@tools': resolve(__dirname, 'src/js/tool_manager'),
      '@toolbar': resolve(__dirname, 'src/js/toolbar'),
      '@modals': resolve(__dirname, 'src/js/modals'),
      '@sidebar': resolve(__dirname, 'src/js/sidebar'),
      '@layers': resolve(__dirname, 'src/js/layers'),
      '@catalog': resolve(__dirname, 'src/js/catalog'),
      '@ui': resolve(__dirname, 'src/js/ui'),
      '@events': resolve(__dirname, 'src/js/events')
    }
  },

  // ===== CSS =====
  css: {
    devSourcemap: true
  },

  // ===== OPTIMIZATIONS =====
  optimizeDeps: {
    // Exclude global vendors (loaded via script tags)
    exclude: [
      'maplibre-gl',
      '@turf/turf',
      'milsymbol',
      'cesium'
    ]
  },

  // ===== PLUGINS =====
  plugins: [
    // Legacy browser support
    legacy({
      targets: ['defaults', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      // Do not include polyfills in modern bundle
      modernPolyfills: false
    })
  ],

  // ===== GLOBAL DEFINITIONS =====
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },

    // ===== ESBUILD OPTIONS =====
    esbuild: {
        // Mantém nomes de classes/funções para debug
        keepNames: true,
        // Legaliza comentários de licença
        legalComments: 'none'
    }
}));
