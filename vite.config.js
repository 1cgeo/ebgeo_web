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
        // Chunks por funcionalidade
        manualChunks: {
          // Separar código do 3D (lazy load)
          'cesium-integration': [
            './src/js/map_3d.js',
            './src/js/control_3d/mouse_coordinates_3d.js',
            './src/js/control_3d/screenshot_tool.js',
            './src/js/control_3d/viewshed.js'
          ],
          // Separar ferramentas militares (grandes)
          'military-tools': [
            './src/js/controls_sig/military_symbol_tool/add_military_symbol_control.js',
            './src/js/controls_sig/military_symbol_tool/military_symbol_generator.js',
            './src/js/controls_sig/military_symbol_tool/brazilian_extension_catalog.js'
          ],
          // Store e utilities
          'core': [
            './src/js/controls_sig/store/store.js',
            './src/js/controls_sig/store/repository.js',
            './src/js/controls_sig/store/map-manager.js'
          ],
          // Ferramentas de análise (LOS e visibilidade)
          'analysis-tools': [
            './src/js/controls_sig/los_tool/add_los_control.js',
            './src/js/controls_sig/los_tool/add_los_geometry.js',
            './src/js/controls_sig/los_tool/los_attributes_panel.js',
            './src/js/controls_sig/visibility_tool/add_visibility_control.js',
            './src/js/controls_sig/visibility_tool/add_visibility_geometry.js',
            './src/js/controls_sig/visibility_tool/visibility_attributes_panel.js'
          ],
          // Ferramentas de medidas de coordenação
          'coordination-tools': [
            './src/js/controls_sig/coordination_measure_tool/add_coordination_measure_control.js',
            './src/js/controls_sig/coordination_measure_tool/add_coordination_measure_geometry.js',
            './src/js/controls_sig/coordination_measure_tool/coordination_measure_attributes_panel.js',
            './src/js/controls_sig/coordination_measure_tool/coordination_measure_generator.js',
            './src/js/controls_sig/coordination_measure_tool/coordination_points_catalog.js',
            './src/js/controls_sig/coordination_measure_tool/coordination_measure_constants.js'
          ],
          // Ferramentas de desenho táticas
          'tactical-tools': [
            './src/js/controls_sig/boundary_tool/add_boundary_control.js',
            './src/js/controls_sig/boundary_tool/add_boundary_geometry.js',
            './src/js/controls_sig/boundary_tool/boundary_attributes_panel.js',
            './src/js/controls_sig/occupied_front_tool/add_occupied_front_control.js',
            './src/js/controls_sig/occupied_front_tool/add_occupied_front_geometry.js',
            './src/js/controls_sig/occupied_front_tool/occupied_front_attributes_panel.js',
            './src/js/controls_sig/arrow_tool/add_arrow_control.js',
            './src/js/controls_sig/arrow_tool/add_arrow_geometry.js',
            './src/js/controls_sig/arrow_tool/arrow_attributes_panel.js'
          ],
          // Ferramentas de formas geométricas
          'shape-tools': [
            './src/js/controls_sig/circle_tool/add_circle_control.js',
            './src/js/controls_sig/circle_tool/add_circle_geometry.js',
            './src/js/controls_sig/circle_tool/circle_attributes_panel.js',
            './src/js/controls_sig/ellipse_tool/add_ellipse_control.js',
            './src/js/controls_sig/ellipse_tool/add_ellipse_geometry.js',
            './src/js/controls_sig/ellipse_tool/ellipse_attributes_panel.js',
            './src/js/controls_sig/rectangle_tool/add_rectangle_control.js',
            './src/js/controls_sig/rectangle_tool/add_rectangle_geometry.js',
            './src/js/controls_sig/rectangle_tool/rectangle_attributes_panel.js',
            './src/js/controls_sig/brush_tool/add_brush_control.js',
            './src/js/controls_sig/brush_tool/add_brush_geometry.js',
            './src/js/controls_sig/brush_tool/brush_attributes_panel.js'
          ],
          // Ferramentas de import/export (carregadas sob demanda)
          'import-export': [
            './src/js/controls_sig/add_import_control.js',
            './src/js/controls_sig/export_import_service.js',
            './src/js/controls_sig/pdf_export_tab.js'
          ],
          // Street view (Three.js - carregado sob demanda)
          'street-view': [
            './src/js/controls_sig/street_view_tool/add_street_view_control.js'
          ]
        },
        // Nomes dos arquivos
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      // Vendors externos (não bundlear)
      external: [
        /cesium/i
      ]
    },

    // Source maps apenas em desenvolvimento
    sourcemap: false,

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
      '@controls': resolve(__dirname, 'src/js/controls_sig'),
      '@store': resolve(__dirname, 'src/js/controls_sig/store'),
      '@utils': resolve(__dirname, 'src/js/controls_sig/utilities'),
      '@tools': resolve(__dirname, 'src/js/controls_sig/tool_manager')
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
      'maplibregl',
      'turf',
      'milsymbol',
      'Cesium'
    ],
    // Pre-bundle dependências npm para dev mais rápido
    include: [
        'feather-icons'
    ]
  },

  // ===== PLUGINS =====
  plugins: [
    // Suporte a browsers antigos
    legacy({
      targets: ['defaults', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      // Gera chunks modernos E legacy
      modernPolyfills: true
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
