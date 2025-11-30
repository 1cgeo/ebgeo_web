// Path: js/index.js
import './config-loader.js';
import config from './config.js';
import { } from './map_sig.js';
import { cleanup3DFeatures } from './map_3d.js';

// ===== INITIALIZATION =====
$(document).ready(() => {
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }

    const map3dEnabled = config.features?.map_3d ?? true;
    if (!map3dEnabled) {
        $('#3d-button').remove();
    }
});

// ===== LOADING SCREEN =====

/**
 * Hides the loading screen with fade-out animation
 * Shows elements marked with 'loading-hidden' class and initializes Feather icons
 */
export function hideLoadingScreen() {
    $('.loading-background').fadeOut(500, function () {
        $(this).remove();
    });

    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });

    if (window.feather) {
        feather.replace();
    }
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
$('#mini-map-street-view').css({ display: 'none' });

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