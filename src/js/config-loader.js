// Path: js/config-loader.js

import config from './config.js';

/**
 * Apply application configuration (title and subtitle) to HTML
 */
function applyAppConfig() {
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
 * Initialize application configuration on DOM ready
 */
function initializeAppConfig() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyAppConfig();
        });
    } else {
        applyAppConfig();
    }
}

initializeAppConfig();
