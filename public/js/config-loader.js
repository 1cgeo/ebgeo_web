// Path: js\config-loader.js

import config from './config.js';

/**
 * Aplica as configurações de app (título e subtítulo) no HTML
 */
export function applyAppConfig() {
    // Aplicar título da página
    if (config.app.title) {
        document.title = config.app.title;
    }
    
    // Aplicar subtítulo na topbar
    applySubtitleToTopbar();
    
    // Criar botões dos tilesets
    // createTilesetButtons(); // DESABILITADO: Modelos 3D agora são acessados por ferramenta
}

/**
 * Aplica o subtítulo na topbar
 */
function applySubtitleToTopbar() {
    const subtitleElement = document.querySelector('.topbar-subtitle');
    if (subtitleElement && config.app.subtitle) {
        subtitleElement.textContent = config.app.subtitle;
    }
}

/**
 * Cria os botões dos tilesets no locate-3d-container
 */
function createTilesetButtons() {
    const container = document.getElementById('locate-3d-container');
    if (!container) return;
    
    // Limpar container
    container.innerHTML = '';
    
    // Se não há tilesets configurados, mostrar mensagem
    if (!config.hasTilesets()) {
        const noModelsMessage = document.createElement('p');
        noModelsMessage.textContent = 'Nenhum modelo 3D configurado';
        noModelsMessage.style.cssText = 'color: #666; font-style: italic; text-align: center; margin: 10px 0;';
        container.appendChild(noModelsMessage);
        return;
    }
    
    // Criar botões para cada tileset configurado
    config.tilesets.forEach(tileset => {
        const button = document.createElement('button');
        button.id = tileset.id.toLowerCase();
        button.className = 'tutorial-button pure-material-button-contained';
        button.textContent = tileset.name;
        container.appendChild(button);
    });
}

/**
 * Função principal para inicializar configurações
 */
export function initializeAppConfig() {
    // Aplicar configurações assim que o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyAppConfig();
        });
    } else {
        applyAppConfig();
    }
}

// Auto-inicializar quando o módulo for carregado
initializeAppConfig();