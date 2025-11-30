// Path: js/config-loader.js

import config from './config.js';

/**
 * Apply application configuration (title and subtitle) to HTML
 */
export function applyAppConfig() {
    if (config.app.title) {
        document.title = config.app.title;
    }

    applySubtitleToTopbar();
}

/**
 * Apply subtitle to topbar element
 */
function applySubtitleToTopbar() {
    const subtitleElement = document.querySelector('.topbar-subtitle');
    if (subtitleElement && config.app.subtitle) {
        subtitleElement.textContent = config.app.subtitle;
    }
}

/**
 * Create tileset buttons in locate-3d-container
 */
function createTilesetButtons() {
    const container = document.getElementById('locate-3d-container');
    if (!container) return;

    container.innerHTML = '';

    if (!config.hasTilesets()) {
        const noModelsMessage = document.createElement('p');
        noModelsMessage.textContent = 'Nenhum modelo 3D configurado';
        noModelsMessage.style.cssText = 'color: #666; font-style: italic; text-align: center; margin: 10px 0;';
        container.appendChild(noModelsMessage);
        return;
    }

    config.tilesets.forEach(tileset => {
        const button = document.createElement('button');
        button.id = tileset.id.toLowerCase();
        button.className = 'tutorial-button pure-material-button-contained';
        button.textContent = tileset.name;
        container.appendChild(button);
    });
}

/**
 * Initialize application configuration on DOM ready
 */
export function initializeAppConfig() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyAppConfig();
        });
    } else {
        applyAppConfig();
    }
}

initializeAppConfig();
