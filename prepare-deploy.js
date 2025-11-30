#!/usr/bin/env node
/**
 * Script de preparação para deploy no GitHub Pages
 * Substitui automaticamente o config.js pela versão simplificada
 * Compatível com estrutura Vite (src/js/config.js)
 */

const fs = require('fs');
const path = require('path');

// Configuração simplificada para GitHub Pages
const GITHUB_PAGES_CONFIG = `// ===== CONFIGURAÇÃO AUTOMÁTICA PARA GITHUB PAGES =====
// Este arquivo foi gerado automaticamente pelo script de deploy
// NÃO EDITE MANUALMENTE - Use o config original para desenvolvimento

const config = {
  // ===== CONFIGURAÇÕES GERAIS DA APLICAÇÃO =====
  app: {
    title: "EBGeo",        // Título exibido na interface
    subtitle: ""                // Subtítulo da aplicação
  },

  // ===== FEATURES DESABILITADAS PARA GITHUB PAGES =====
  features: {
    imagens_panoramicas: false,    // Desabilitado (requer APIs)
    vector_info: false,           // Desabilitado para simplicidade
    map_3d: false,               // Desabilitado (sem modelos 3D)
    grid: false,
    frame: false,
  },

  url_paths: {
    url: '',
    prefix_name: ''
  },

  // ===== BUSCA DESABILITADA =====
  search: {
    enabled: false,              // Desabilitada (requer servidor)
    apiUrl: ""                   // Vazio - não usado
  },

  // ===== EXPORT PDF DESABILITADO =====
  export: {
    enabled: false,              // Desabilitado (requer servidor)
    pdfApiUrl: ""               // Vazio - não usado
  },

  // ===== CONFIGURAÇÃO DE BASEMAPS - SOMENTE BDGEX =====
  basemaps: {
    'bdgex': {
      enabled: true,
      name: 'BDGEx',
      icon: './images/dsg_symbol.svg',
      priority: 1
    },
    // Todos os outros basemaps desabilitados para GitHub Pages
    'carta-topografica': {
      enabled: false,
      name: 'Topográfica',
      icon: './images/dsg_symbol.svg',
      priority: 2
    },
    'carta-ortoimagem': {
      enabled: false,
      name: 'Ortoimagem',
      icon: './images/dsg_symbol.svg',
      priority: 3
    },
    'osm': {
      enabled: false,
      name: 'OSM',
      icon: '',
      priority: 4
    },
    'imagens': {
      enabled: false,
      name: 'Imagens',
      icon: '',
      priority: 5
    }
  },

  // ===== CONFIGURAÇÕES DO MAPA 2D =====
  map2d: {
    // ----- Configurações Básicas do Mapa -----
    bounds: [
      [-44.4633992903047, -22.46265178239199],   // [longitude_min, latitude_min]
      [-44.439695820515325, -22.444666254876367] // [longitude_max, latitude_max]
    ],
    minZoom: 1,              // Zoom mínimo permitido
    maxZoom: 17.9,           // Zoom máximo permitido
    maxPitch: 65,            // Inclinação máxima da câmera (0-60 graus)

    // Configurações avançadas de carregamento de tiles
    sourceTileLodParams: [5, 6.0],  // [threshold, factor] para otimização de tiles

    // ===== CONFIGURAÇÃO DO TERRAIN SOURCE =====
    terrainSource: {
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE SOURCE =====
    hillshadeSource: {
    },

    // ===== CONFIGURAÇÃO DO TERRENO 3D =====
    terrain: {
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE =====
    hillshade: {
      enabled: false,
      layer: {
      },
    },
  },

  // ===== ANALYSIS LAYERS DESABILITADAS =====
  analysisLayers: {
    enabled: false,              // Feature flag global desabilitado
    layers: []                   // Array vazio - nenhuma layer de análise
  },

  // ===== MAP3D COMPLETAMENTE DESABILITADO =====
  map3d: {
    enabled: false,              // Modo 3D desabilitado
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
  tilesets: []
};

// ===== FUNÇÕES AUXILIARES MANTIDAS =====

// Verifica se há tilesets configurados (sempre false para GitHub Pages)
config.hasTilesets = () => false;

// Validação para não deixar todos os basemaps desabilitados
config.validateBasemapsConfig = () => {
  const enabled = Object.values(config.basemaps).filter(b => b.enabled);
  if (enabled.length === 0) {
    console.warn('Todos basemaps desabilitados! Habilitando bdgex como fallback');
    config.basemaps['bdgex'].enabled = true;
  }
};

// Obter basemaps habilitados ordenados por prioridade
config.getEnabledBasemaps = () => {
  return Object.entries(config.basemaps)
    .filter(([id, basemapConfig]) => basemapConfig.enabled)
    .sort(([,a], [,b]) => a.priority - b.priority);
};

// Determinar layout CSS baseado na quantidade de basemaps
config.getBasemapLayoutClass = (count) => {
  return 'base-layer-grid-1x1';
};

// Obter fallback válido para basemap
config.getValidBasemapFallback = (currentBasemap = null) => {
  const enabled = config.getEnabledBasemaps();
  if (enabled.length === 0) return 'bdgex';

  if (currentBasemap && config.basemaps[currentBasemap]?.enabled) {
    return currentBasemap;
  }

  return enabled[0][0];
};

// Helpers para 3D desabilitados (retornam false/vazio)
config.createImageryProvider = () => false;
config.createTerrainProvider = () => ({ provider: 'EllipsoidTerrainProvider' });

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
        console.log('- Config modificado para GitHub Pages');
        console.log('- Features desabilitadas: map_3d, street_view, vector_info, search, export_pdf');
        console.log('- Basemaps: somente BDGEx habilitado');
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
