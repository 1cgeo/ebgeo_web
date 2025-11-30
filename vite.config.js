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
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.info', 'console.debug', 'console.warn']
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
    port: 4173
  },

  // ===== RESOLUÇÃO DE MÓDULOS =====
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@js': resolve(__dirname, 'src/js'),
      '@css': resolve(__dirname, 'src/css'),
      '@controls': resolve(__dirname, 'src/js/controls_sig'),
      '@store': resolve(__dirname, 'src/js/controls_sig/store'),
      '@utils': resolve(__dirname, 'src/js/controls_sig/utilities')
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
      'Cesium',
      'localforage'
    ]
  },

  // ===== PLUGINS =====
  plugins: [
    // Suporte a browsers antigos
    legacy({
      targets: ['defaults', 'not IE 11'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime']
    })
  ],

  // ===== DEFINIÇÕES GLOBAIS =====
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production')
  }
});
