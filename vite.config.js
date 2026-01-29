// vite.config.js
import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';
import { resolve } from 'path';

export default defineConfig({
  // ===== ROOT E ESTRUTURA =====
  root: '.',
  publicDir: 'public',

  // ===== CONFIGURAÇÃO DE BUILD =====
  build: {
    outDir: 'dist',
    assetsDir: 'assets',

    // Minificação
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
        // Chunks por funcionalidade (baseado em path matching)
        // IMPORTANTE: A ordem importa! Regras mais específicas devem vir primeiro.
        // Chunks são organizados para evitar dependências circulares:
        //   core (store, state, events, layers, terrain, baselayers, catalog, modals)
        //   -> ui-components (sidebar, toolbar, features_tab, user_data)
        //   -> tools (draw, military, analysis, selection)
        //   -> lazy (3d, street-view, import-export)
        manualChunks(id) {
          // ===== LAZY LOADED CHUNKS (independentes) =====

          // Separar código do 3D (lazy load via dynamic import)
          // NOTA: Apenas map_3d.js e tools/* são lazy-loaded.
          // add_3d_models_viewer_control.js é importado estaticamente,
          // então não vai para este chunk (fica no main).
          // Os painéis (marker-panel-3d, measurement-panel-3d, viewshed-panel-3d)
          // usam dynamic imports para evitar conflitos.
          if (id.includes('3d_models_viewer_tool/map_3d') ||
              id.includes('3d_models_viewer_tool/tools/')) {
            return 'cesium-integration';
          }
          // Street view (Three.js - lazy load)
          if (id.includes('street_view_tool')) {
            return 'street-view';
          }
          // Ferramentas de import/export
          if (id.includes('import_export')) {
            return 'import-export';
          }

          // ===== TOOL CHUNKS =====

          // Separar ferramentas militares (grandes)
          if (id.includes('military_tools')) {
            return 'military-tools';
          }
          // Ferramentas de análise (LOS e visibilidade)
          if (id.includes('analysis_tools')) {
            return 'analysis-tools';
          }
          // Ferramentas de desenho
          if (id.includes('draw_tools')) {
            return 'draw-tools';
          }
          // Ferramentas de seleção
          if (id.includes('selection_tools')) {
            return 'selection-tools';
          }

          // ===== UI COMPONENTS (depende de core) =====
          // Inclui: sidebar, features_tab, user_data, attribute_table, search, bottom-controls, base-layer-selector, context-menu

          // Features tab, user data and attribute table
          if (id.includes('src/js/features_tab/') ||
              id.includes('src/js/user_data/') ||
              id.includes('src/js/attribute_table/')) {
            return 'ui-components';
          }
          // UI components (sidebar, etc. - NÃO inclui toolbar que está em core)
          if (id.includes('src/js/sidebar/') ||
              id.includes('src/js/bottom-controls/') ||
              id.includes('src/js/base-layer-selector/') ||
              id.includes('src/js/context-menu/')) {
            return 'ui-components';
          }
          // Busca e informações de vetores
          if (id.includes('src/js/search/') || id.includes('src/js/vector_info/')) {
            return 'ui-components';
          }

          // ===== CORE CHUNK (base de tudo) =====
          // Inclui: store, state, events, utilities, layers, terrain, baselayers, toolbar, modals, catalog
          // utilities está aqui porque é usado por toolbar, modals e também por cesium-integration
          // toolbar/modals/catalog estão aqui porque:
          //   - store/settings.operations importa de catalog/catalog.constants
          //   - modals/shortcuts.modal importa de toolbar/toolbar.constants
          //   - catalog/catalog.modal importa de modals/modal.base

          // Utilities (base para toolbar, modals, e também usado por cesium-integration)
          // DEVE vir antes de qualquer outro chunk que dependa dele
          if (id.includes('src/js/utilities/')) {
            return 'core';
          }
          // Store e state management
          if (id.includes('src/js/store/') || id.includes('src/js/state/')) {
            return 'core';
          }
          // Events
          if (id.includes('src/js/events/')) {
            return 'core';
          }
          // Layers e baselayers (dependem de store)
          if (id.includes('src/js/layers/') || id.includes('src/js/baselayers/')) {
            return 'core';
          }
          // Terreno (depende de store e layers)
          if (id.includes('src/js/terrain/')) {
            return 'core';
          }
          // Toolbar (dependido por modals/shortcuts.modal)
          if (id.includes('src/js/toolbar/')) {
            return 'core';
          }
          // Modals (depende de toolbar, dependido por catalog)
          if (id.includes('src/js/modals/')) {
            return 'core';
          }
          // Catálogo (depende de modals, dependido por store/settings.operations)
          if (id.includes('src/js/catalog/')) {
            return 'core';
          }
          // UI base components
          if (id.includes('src/js/ui/')) {
            return 'core';
          }
          // Utilitários de mapa (grid, coordinates)
          if (id.includes('src/js/grid/') ||
              id.includes('src/js/coordinates/')) {
            return 'core';
          }
        },
        // Nomes dos arquivos
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      // Vendors externos (não bundlear)
      // CORREÇÃO: Regex específica para excluir apenas o vendor Cesium,
      // não arquivos do projeto como cesium3d.operations.js
      external: [
        // Match exato do módulo 'cesium' (import 'cesium')
        /^cesium$/i,
        // Match subpaths do módulo cesium (import 'cesium/Source/...')
        /^cesium\//i,
        // Match paths de vendors locais do Cesium
        /vendors\/cesium/i,
        // Match paths em node_modules (caso use npm install cesium)
        /node_modules\/cesium/i
      ]
    },

    // Source maps: 'hidden' gera mapas sem expor ao público
    sourcemap: 'hidden',

    // Tamanho máximo de chunk antes de warning
    chunkSizeWarningLimit: 1000
  },

  // ===== SERVIDOR DE DESENVOLVIMENTO =====
  server: {
    port: 3000,
    open: true,
    cors: true,

    // Proxy para APIs (se necessário)
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

  // ===== PREVIEW (produção local) =====
  preview: {
    port: 4173,
    strictPort: false
  },

  // ===== RESOLUÇÃO DE MÓDULOS =====
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

  // ===== OTIMIZAÇÕES =====
  optimizeDeps: {
    // Excluir vendors globais (carregados via script tags)
    exclude: [
      'maplibre-gl',
      '@turf/turf',
      'milsymbol',
      'cesium'
    ]
  },

  // ===== PLUGINS =====
  plugins: [
    // Suporte a browsers antigos
    legacy({
      targets: ['defaults', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      // Não incluir polyfills no bundle moderno
      modernPolyfills: false
    })
  ],

  // ===== DEFINIÇÕES GLOBAIS =====
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },

    // ===== ESBUILD OPTIONS =====
    esbuild: {
        // Mantém nomes de classes/funções para debug
        keepNames: true,
        // Legaliza comentários de licença
        legalComments: 'none'
    }
});