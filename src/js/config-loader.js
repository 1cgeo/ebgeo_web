// Path: js/config-loader.js

import config from './config.js';

/**
 * Apply application configuration (title) to HTML
 */
function applyAppConfig() {
    if (config.app.title) {
        document.title = config.app.title;
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

// Exported for explicit initialization in index.js
export { initializeAppConfig };
