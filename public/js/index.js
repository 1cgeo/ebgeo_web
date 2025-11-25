// Path: js\index.js
import './config-loader.js';
import config from './config.js';
import { } from './map_sig.js';
import { cleanup3DFeatures } from './map_3d.js';

// ===== INICIALIZAÇÃO =====
$(document).ready(() => {
    // Performance monitoring (opcional)
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }
    
    // Remover botão 3D se desabilitado na config
    const map3dEnabled = config.features?.map_3d ?? true;
    if (!map3dEnabled) {
        $('#3d-button').remove();
    }
});

// ===== LOADING SCREEN - EXPORTADA PARA USO EXTERNO =====
export function hideLoadingScreen() {
    $('.loading-background').fadeOut(500, function () {
        $(this).remove();
    });

    // Mostra elementos que estavam ocultos durante loading
    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });

    // Inicializa ícones se disponível
    if (window.feather) {
        feather.replace();
    }
}

// ===== CLEANUP GLOBAL =====
window.addEventListener('beforeunload', () => {
    // Cleanup do Cesium para prevenir memory leaks
    try {
        cleanup3DFeatures();
    } catch (error) {
        console.warn('⚠️ Erro no cleanup do Cesium:', error);
    }
});

// ===== STREET VIEW SETUP =====
$('#mini-map-street-view').css({ display: 'none' });

// ===== DEBUG HELPERS =====
// Função para forçar limpeza do Cesium se necessário (debug/manutenção)
if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
    window.forceCesiumCleanup = function () {
        try {
            cleanup3DFeatures();
            console.log('✅ Cleanup manual do Cesium executado');
        } catch (error) {
            console.error('❌ Erro no cleanup manual:', error);
        }
    };
}