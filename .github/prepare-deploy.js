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
    
    try {
        const configPath = path.join(process.cwd(), 'js', 'config.js');
        const configOriginalPath = path.join(process.cwd(), 'js', 'config-original.js');
        const configBackupPath = path.join(process.cwd(), 'js', 'config-development.js');
        
        // Verificar se o diretório js existe
        if (!fs.existsSync(path.join(process.cwd(), 'js'))) {
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
        const indexPath = path.join(process.cwd(), 'public', 'index.html');
        if (!fs.existsSync(indexPath)) {
            log('Arquivo public/index.html não encontrado na estrutura do projeto', 'warning');
        } else {
            log('✅ public/index.html encontrado', 'success');
        }
        
        // Criar arquivo de status do deploy
        const deployStatusPath = path.join(process.cwd(), '.deploy-status');
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
            const filePath = path.join(process.cwd(), file);
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