#!/usr/bin/env node
/**
 * Script de preparação para deploy no GitHub Pages
 * Substitui automaticamente o config.js pela versão simplificada
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
    imagens_panoramicas: false,    // ❌ Desabilitado (requer APIs)
    vector_info: false,           // ❌ Desabilitado para simplicidade  
    map_3d: false,               // ❌ Desabilitado (sem modelos 3D)
  },
  
  // ===== BUSCA DESABILITADA =====
  search: {
    enabled: false,              // ❌ Desabilitada (requer servidor)
    apiUrl: ""                   // Vazio - não usado
  },

  // ===== EXPORT PDF DESABILITADO =====
  export: {
    enabled: false,              // ❌ Desabilitado (requer servidor)
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
      icon: '🌐',
      priority: 4 
    },
    'imagens': { 
      enabled: false, 
      name: 'Imagens', 
      icon: '🌐',
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
    
    // Limites geográficos opcionais (descomente para ativar)
    // maxBounds: [
    //   [-45.82515, -22.69950],  // [lng_min, lat_min] - sudoeste
    //   [-43.92333, -21.30216]   // [lng_max, lat_max] - nordeste
    // ],

    // ===== CONFIGURAÇÃO DO TERRAIN SOURCE =====
    // Source usado para consultas de elevação e terreno 3D
    terrainSource: {
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE SOURCE =====
    // Source separado para o efeito visual de relevo (pode ser o mesmo que terrain)
    hillshadeSource: {
    },

    // ===== CONFIGURAÇÃO DO TERRENO 3D =====
    // Controla a visualização 3D do terreno (toggle on/off)
    terrain: {
    },

    // ===== CONFIGURAÇÃO DO HILLSHADE =====
    // Efeito visual de sombreamento do relevo
    hillshade: {
      enabled: false,                                        // true = ativa hillshade | false = desativa
      
      // Configuração da camada hillshade
      layer: {
      },
    },
  },

  // ===== ANALYSIS LAYERS DESABILITADAS =====
  analysisLayers: {
    enabled: false,              // ❌ Feature flag global desabilitado
    layers: []                   // Array vazio - nenhuma layer de análise
  },

  // ===== MAP3D COMPLETAMENTE DESABILITADO =====
  map3d: {
    enabled: false,              // ❌ Modo 3D desabilitado
    providers: {
      imagery: {
        enabled: false,          // ❌ Imagery provider desabilitado
        type: '',
        url: '',
        options: {}
      },
      terrain: {
        enabled: false,          // ❌ Terrain provider desabilitado  
        type: 'Ellipsoid',       // Usar ellipsoid simples se necessário
        url: '',
        options: {}
      }
    }
  },

  // ===== TILESETS 3D REMOVIDOS =====
  tilesets: []                   // Array vazio - nenhum modelo 3D
};

// ===== FUNÇÕES AUXILIARES MANTIDAS =====
// Mantendo as funções necessárias para o funcionamento básico

// Verifica se há tilesets configurados (sempre false para GitHub Pages)
config.hasTilesets = () => false;

// Validação para não deixar todos os basemaps desabilitados
config.validateBasemapsConfig = () => {
  const enabled = Object.values(config.basemaps).filter(b => b.enabled);
  if (enabled.length === 0) {
    console.warn('⚠️ Todos basemaps desabilitados! Habilitando bdgex como fallback');
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
  // Para GitHub Pages, sempre será 1 basemap (bdgex)
  return 'base-layer-grid-1x1';
};

// Obter fallback válido para basemap
config.getValidBasemapFallback = (currentBasemap = null) => {
  const enabled = config.getEnabledBasemaps();
  if (enabled.length === 0) return 'bdgex';
  
  // Se o atual estiver habilitado, manter
  if (currentBasemap && config.basemaps[currentBasemap]?.enabled) {
    return currentBasemap;
  }
  
  // Senão, primeiro da lista ordenada (sempre será bdgex)
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
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    };
    
    console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

function main() {
    log('🚀 Iniciando preparação para deploy no GitHub Pages...');
    let mainpath = path.join(process.cwd(), 'public')
    try {
        const configPath = path.join(mainpath, 'js', 'config.js');
        const configOriginalPath = path.join(mainpath, 'js', 'config-original.js');
        const configBackupPath = path.join(mainpath, 'js', 'config-development.js');
        
        // Verificar se o diretório js existe
        if (!fs.existsSync(path.join(mainpath, 'js'))) {
            throw new Error('Diretório js/ não encontrado. Execute o script na raiz do projeto.');
        }
        
        // Verificar se config.js existe
        if (!fs.existsSync(configPath)) {
            throw new Error('Arquivo js/config.js não encontrado.');
        }
        
        // Fazer backup do config original se não existir
        if (!fs.existsSync(configOriginalPath) && !fs.existsSync(configBackupPath)) {
            log('📦 Fazendo backup do config original...');
            fs.copyFileSync(configPath, configOriginalPath);
            fs.copyFileSync(configPath, configBackupPath);
            log('Backup salvo como js/config-original.js e js/config-development.js', 'success');
        } else {
            log('Backup já existe, pulando...', 'warning');
        }
        
        // Substituir pelo config do GitHub Pages
        log('🔧 Aplicando configuração para GitHub Pages...');
        fs.writeFileSync(configPath, GITHUB_PAGES_CONFIG, 'utf8');
        log('Configuração aplicada com sucesso!', 'success');
        
        // Verificar se index.html existe
        const indexPath = path.join(mainpath, 'index.html');
        if (!fs.existsSync(indexPath)) {
            log('Arquivo public/index.html não encontrado na estrutura do projeto', 'warning');
        } else {
            log('✅ public/index.html encontrado', 'success');
        }
        
        // Criar arquivo de status do deploy
        const deployStatusPath = path.join(mainpath, '.deploy-status');
        const deployStatus = {
            timestamp: new Date().toISOString(),
            mode: 'github-pages',
            config_modified: true,
            backup_created: true
        };
        fs.writeFileSync(deployStatusPath, JSON.stringify(deployStatus, null, 2));
        
        // Listar arquivos importantes
        log('📁 Verificando estrutura do projeto...');
        
        const importantFiles = [
            'index.html',
            'js/config.js',
            'js/config-original.js',
            'css/style.css',
            'images/'
        ];
        
        importantFiles.forEach(file => {
            const filePath = path.join(mainpath, file);
            if (fs.existsSync(filePath)) {
                log(`✅ ${file}`, 'success');
            } else {
                log(`❌ ${file} (não encontrado)`, 'error');
            }
        });
        
        log('🎉 Preparação concluída com sucesso!');
        log('📝 Próximos passos:');
        log('   1. Commit e push das alterações');
        log('   2. GitHub Actions fará o deploy automaticamente');
        log('   3. Site estará disponível em: https://seu-usuario.github.io/seu-repo');
        
        // Informações adicionais
        console.log('\n📊 Resumo das alterações:');
        console.log('• Config modificado para GitHub Pages');
        console.log('• Features desabilitadas: map_3d, street_view, vector_info, search, export_pdf');
        console.log('• Basemaps: somente BDGEx habilitado');
        console.log('• Analysis layers: desabilitadas');
        console.log('• Tilesets 3D: removidos');
        
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