// vite.config.js
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve } from 'path';

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
        //   -> lazy (cesium-integration, street-view, import-export)
        // Unmapped (falls to main entry bundle): keyboard, map/map.manager, map/drag-rotate
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
          // Import/export tools
          if (id.includes('import_export')) {
            return 'import-export';
          }

          // ===== TOOL CHUNKS =====

          // Military tools (large bundle)
          if (id.includes('military_tools')) {
            return 'military-tools';
          }
          // Analysis tools (LOS and visibility)
          if (id.includes('analysis_tools')) {
             return 'analysis-tools';
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

    // Maximum chunk size before warning
    chunkSizeWarningLimit: 1000
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
