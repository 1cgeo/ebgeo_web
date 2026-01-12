// Path: js/index.js
import feather from 'feather-icons';
import './config-loader.js';
import config from './config.js';
import { URLRouter } from './url_router.js';
import { } from './map_sig.js';
import { cleanup3DFeatures } from './map_3d.js';

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }

    // Parse URL parameters early for deep linking
    URLRouter.parse();
});

// ===== LOADING SCREEN =====

/**
 * Hides the loading screen with fade-out animation
 * Shows elements marked with 'loading-hidden' class and initializes Feather icons
 */
export function hideLoadingScreen() {
    const loadingBg = document.querySelector('.loading-background');
    if (loadingBg) {
        loadingBg.style.transition = 'opacity 0.5s';
        loadingBg.style.opacity = '0';
        setTimeout(() => loadingBg.remove(), 500);
    }

    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });

    feather.replace();
}

// ===== GLOBAL CLEANUP =====
window.addEventListener('beforeunload', () => {
    try {
        cleanup3DFeatures();
    } catch (error) {
        console.warn('Cesium cleanup error:', error);
    }
});

// ===== STREET VIEW SETUP =====
const miniMapStreetView = document.getElementById('mini-map-street-view');
if (miniMapStreetView) miniMapStreetView.style.display = 'none';

// ===== DEBUG HELPERS =====
if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
    window.forceCesiumCleanup = function () {
        try {
            cleanup3DFeatures();
            console.log('Manual Cesium cleanup executed');
        } catch (error) {
            console.error('Error in manual cleanup:', error);
        }
    };
}
