#!/usr/bin/env node
/* global require, module */
/**
 * Script de preparação para deploy no GitHub Pages
 * Substitui automaticamente o config.js pela versão simplificada
 * Compatível com estrutura Vite (src/js/config.js)
 */

const fs = require('fs');
const path = require('path');

// Configuração simplificada para GitHub Pages
const GITHUB_PAGES_CONFIG = `// Path: js/config.js
// ===== CONFIGURAÇÃO AUTOMÁTICA PARA GITHUB PAGES =====
// Este arquivo foi gerado automaticamente pelo script de deploy
// NÃO EDITE MANUALMENTE - Use o config original para desenvolvimento

const config = {
  // ===== CONFIGURAÇÕES GERAIS DA APLICAÇÃO =====
  app: {
    title: "EBGeo",
    tutorialUrl: './docs/doc.html'
  },

  // ===== FEATURES DESABILITADAS PARA GITHUB PAGES =====
  features: {
    imagens_panoramicas: false,
    map_3d: false,
    apisearch: false,
    grid: false,
  },

  // ===== SERVICES =====
  services: {
    tileServerUrl: ''
  },

  // ===== BUSCA DESABILITADA =====
  search: {
    apiUrl: ''
  },

  // ===== BASEMAPS - BDGEX, OSM E IMAGENS =====
  // 'carta-topografica' e 'carta-ortoimagem' ficam de fora: a primeira e uma
  // copia identica do estilo do OSM e a segunda aponta para o style.json de
  // demonstracao do MapLibre, entao nenhuma das duas acrescenta um mapa real.
  basemaps: {
    'bdgex': {
      enabled: true,
      name: 'BDGEx',
      image: './images/layers/bdgex-thumb.webp',
      priority: 1
    },
    'osm': {
      enabled: true,
      name: 'OSM',
      image: './images/layers/osm-thumb.webp',
      priority: 2
    },
    'imagens': {
      enabled: true,
      name: 'Imagens',
      image: './images/layers/carta-ortoimagem-thumb.webp',
      priority: 3
    },
    'carta-topografica': {
      enabled: false,
      name: 'Topográfica',
      image: './images/layers/carta-topografica-thumb.webp',
      priority: 4
    },
    'carta-ortoimagem': {
      enabled: false,
      name: 'Ortoimagem',
      image: './images/layers/carta-ortoimagem-thumb.webp',
      priority: 5
    }
  },

  // ===== ANALYSIS LAYERS DESABILITADAS =====
  analysisLayers: {
    enabled: false,
    layers: []
  },

  // ===== DATA LAYERS DESABILITADAS =====
  dataLayers: {
    enabled: false,
    layers: []
  },

  // ===== CONFIGURAÇÕES DO MAPA 2D =====
  map2d: {
    bounds: [
      [-73.99, -33.75],
      [-34.79, 5.27]
    ],
    minZoom: 1,
    maxZoom: 17.9,
    maxPitch: 65,
    globe_projection: true,
    sourceTileLodParams: [5, 6.0],

    terrainSource: null,
    hillshadeSource: null,
    hillshade: {
      enabled: false,
      layer: {},
    },
  },

  // ===== MAP3D COMPLETAMENTE DESABILITADO =====
  map3d: {
    enabled: false,
    bounds: { west: -73.99, south: -33.75, east: -34.79, north: 5.27 },
    viewer: {},
    providers: {
      imagery: {
        enabled: false,
        type: '',
        url: '',
        options: {}
      },
      terrain: {
        enabled: false,
        type: 'Ellipsoid',
        url: '',
        options: {}
      }
    }
  },

  // ===== TILESETS 3D REMOVIDOS =====
  tilesets: [],

  // ===== STREETVIEW 360 DESABILITADO =====
  streetView360: {
    serviceUrl: '',
    pointsSource: null,
    pointsSourceLayer: '',
    linesSource: null,
    linesSourceLayer: '',
  }
};

export default config;`;

function log(message, type = 'info') {
    const colors = {
        info: '\x1b[36m',    // cyan
        success: '\x1b[32m', // green
        warning: '\x1b[33m', // yellow
        error: '\x1b[31m',   // red
        reset: '\x1b[0m'     // reset
    };

    const prefix = {
        info: 'i',
        success: '+',
        warning: '!',
        error: 'x'
    };

    console.log(`${colors[type]}[${prefix[type]}] ${message}${colors.reset}`);
}

function main() {
    log('Iniciando preparação para deploy no GitHub Pages...');

    // Nova estrutura Vite: src/js/config.js
    const srcPath = path.join(process.cwd(), 'src');
    const jsPath = path.join(srcPath, 'js');

    try {
        const configPath = path.join(jsPath, 'config.js');
        const configBackupPath = path.join(jsPath, 'config-development.js');

        // Verificar se o diretório src/js existe
        if (!fs.existsSync(jsPath)) {
            throw new Error('Diretório src/js/ não encontrado. Verifique a estrutura do projeto.');
        }

        // Verificar se config.js existe
        if (!fs.existsSync(configPath)) {
            throw new Error('Arquivo src/js/config.js não encontrado.');
        }

        // Fazer backup do config original se não existir
        if (!fs.existsSync(configBackupPath)) {
            log('Fazendo backup do config original...');
            fs.copyFileSync(configPath, configBackupPath);
            log('Backup salvo como src/js/config-development.js', 'success');
        } else {
            log('Backup já existe, pulando...', 'warning');
        }

        // Substituir pelo config do GitHub Pages
        log('Aplicando configuração para GitHub Pages...');
        fs.writeFileSync(configPath, GITHUB_PAGES_CONFIG, 'utf8');
        log('Configuração aplicada com sucesso!', 'success');

        // Verificar estrutura do projeto
        log('Verificando estrutura do projeto...');

        const importantFiles = [
            { path: 'index.html', required: true },
            { path: 'src/js/config.js', required: true },
            { path: 'src/js/index.js', required: true },
            { path: 'src/css/style.css', required: true },
            { path: 'public/images', required: true },
            { path: 'public/vendors', required: true },
            { path: 'vite.config.js', required: true },
            { path: 'package.json', required: true },
        ];

        let allOk = true;
        importantFiles.forEach(file => {
            const filePath = path.join(process.cwd(), file.path);
            if (fs.existsSync(filePath)) {
                log(`${file.path}`, 'success');
            } else if (file.required) {
                log(`${file.path} (não encontrado)`, 'error');
                allOk = false;
            } else {
                log(`${file.path} (opcional, não encontrado)`, 'warning');
            }
        });

        if (!allOk) {
            throw new Error('Arquivos obrigatórios não encontrados.');
        }

        log('Preparação concluída com sucesso!', 'success');
        log('Próximo passo: npm run build');

        // Resumo das alterações
        console.log('\nResumo das alterações:');
        console.log('- Config modificado para GitHub Pages (site estático)');
        console.log('- Features desabilitadas: map_3d, street_view_360, busca geográfica');
        console.log('- Basemaps habilitados: BDGEx, OSM, Imagens');
        console.log('- O Vite fará o build para dist/');

        process.exit(0);

    } catch (error) {
        log(`Erro durante a preparação: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = { main, log };
