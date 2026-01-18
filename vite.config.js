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
        manualChunks(id) {
          // Separar código do 3D (lazy load)
          if (id.includes('3d_models_viewer_tool')) {
            return 'cesium-integration';
          }
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
          // Ferramentas de import/export
          if (id.includes('import_export')) {
            return 'import-export';
          }
          // Street view (Three.js)
          if (id.includes('street_view_tool')) {
            return 'street-view';
          }
          // Store e state management
          if (id.includes('src/js/store/')) {
            return 'core';
          }
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
      '@utils': resolve(__dirname, 'src/js/utilities'),
      '@tools': resolve(__dirname, 'src/js/tool_manager')
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
