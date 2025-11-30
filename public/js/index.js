// Path: js/index.js
import './config-loader.js';
import config from './config.js';
import { } from './map_sig.js';
import { cleanup3DFeatures } from './map_3d.js';

// ===== INITIALIZATION =====
$(document).ready(() => {
    // Performance monitoring (optional)
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }

    // Remove 3D button if disabled in config
    const map3dEnabled = config.features?.map_3d ?? true;
    if (!map3dEnabled) {
        $('#3d-button').remove();
    }
});

// ===== LOADING SCREEN - EXPORTED FOR EXTERNAL USE =====
export function hideLoadingScreen() {
    $('.loading-background').fadeOut(500, function () {
        $(this).remove();
    });

    // Show elements that were hidden during loading
    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });

    // Initialize icons if available
    if (window.feather) {
        feather.replace();
    }
}

// ===== GLOBAL CLEANUP =====
window.addEventListener('beforeunload', () => {
    // Cesium cleanup to prevent memory leaks
    try {
        cleanup3DFeatures();
    } catch (error) {
        console.warn('Warning: Cesium cleanup error:', error);
    }
});

// ===== STREET VIEW SETUP =====
$('#mini-map-street-view').css({ display: 'none' });

// ===== DEBUG HELPERS =====
// Function to force Cesium cleanup if needed (debug/maintenance)
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