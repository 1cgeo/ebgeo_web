// Path: js\index.js
import './config-loader.js'; // Aplica as configurações automaticamente
import config from './config.js';

import { } from './map_sig.js'
import {
    activeTool,
    init3DFeatures,
    cleanup3DFeatures,
    loadCesiumAndInit,
    pauseRendering,
    resumeRendering
} from './map_3d.js'

// ===== GESTÃO DE ESTADO DA APLICAÇÃO =====
const appState = {
    currentMode: 'sig', // 'sig' ou '3d'
    cesiumState: 'unloaded', // 'unloaded', 'loading', 'loaded', 'error'
    loadingTimeout: null
};

// ===== INICIALIZAÇÃO =====
$(document).ready(() => {
    // Setup inicial
    setupEventListeners();

    // Performance monitoring (opcional)
    if (window.performance && window.performance.mark) {
        window.performance.mark('app-init');
    }
});

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Form toggle
    $('#open-close-form').on('click', toggleAttributesPanel);

    // Verificar se modo 3D está habilitado
    const map3dEnabled = config.features?.map_3d ?? true;
    if (!map3dEnabled) {
        // Remove completamente o botão 3D se desabilitado
        $('#3d-button').remove();
    } else {
        // Mode switching (otimizado) - apenas se 3D estiver habilitado
        // DESABILITADO: Agora 3D é ativado por ferramenta, não por botão
        //         $(".bar-center-buttons a").off('click').on('click', handleModeSwitch);
    }
}

function handleModeSwitch(event) {
    event.preventDefault();
    const targetMode = $(this).attr('id') === '3d-button' ? '3d' : 'sig';

    if (targetMode === appState.currentMode) return;

    // Update UI state immediately
    $(".bar-center-buttons a").removeClass('active-button');
    $(this).addClass('active-button');

    if (targetMode === '3d') {
        switchTo3D();
    } else {
        switchTo2D();
    }
}

// ===== MODE SWITCHING =====
async function switchTo3D() {
    if (appState.currentMode === '3d') return;

    try {
        // Pausa 2D primeiro
        hideUIElements();

        // Mostra container 3D
        $('#map-3d-container').show();

        if (appState.cesiumState === 'unloaded') {
            await initializeCesium();
        } else if (appState.cesiumState === 'loaded') {
            // Apenas retoma renderização
            resumeRendering();
            init3DFeatures();
        }

        appState.currentMode = '3d';
        $('.button-tool-3d').on('click', activeTool);

    } catch (error) {
        console.error('Erro ao alternar para 3D:', error);
        showError('Falha ao carregar o mapa 3D. Tente novamente.');

        // Fallback para 2D
        switchTo2D();
    }
}

// ===== FUNÇÃO MODIFICADA - SEM DESTRUIÇÃO DO CESIUM =====
function switchTo2D() {
    if (appState.currentMode === 'sig') return;

    // APENAS PAUSA RENDERIZAÇÃO - NÃO DESTRÓI
    if (appState.cesiumState === 'loaded') {
        pauseRendering();
    }

    // Hide 3D, show 2D
    $('#map-3d-container').hide();
    showUIElements();

    appState.currentMode = 'sig';
}

async function initializeCesium() {
    if (appState.cesiumState === 'loading') return;

    appState.cesiumState = 'loading';

    // Mostra loading com timeout
    showLoadingIndicator();

    appState.loadingTimeout = setTimeout(() => {
        if (appState.cesiumState === 'loading') {
            console.warn('Timeout no carregamento do Cesium');
            showError('Tempo limite excedido. Verifique sua conexão.');
        }
    }, 30000); // 30s timeout

    try {
        await loadCesiumAndInit();

        clearTimeout(appState.loadingTimeout);
        hideLoadingIndicator();

        // Inicializa ferramentas
        init3DFeatures();
        resumeRendering();

        appState.cesiumState = 'loaded';

    } catch (error) {
        clearTimeout(appState.loadingTimeout);
        appState.cesiumState = 'error';
        hideLoadingIndicator();
        throw error;
    }
}

// ===== UI MANAGEMENT =====
function hideUIElements() {
    $('#map-sig').hide();
    $('.unified-attributes-panel').hide();
}

function showUIElements() {
    $('#map-sig').show();
    $('.unified-attributes-panel').show();
}

function showLoadingIndicator() {
    const loadingHTML = `
    <div class="cesium-loading-overlay" style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(80, 141, 78, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    ">
        <img src="./images/logo_ebgeo.png" alt="EBGeo" style="width: 300px; height: auto;">
        <div style="width: 200px; height: 4px; background: rgba(255,255,255,0.3); border-radius: 2px; margin-top: 20px;">
            <div style="
                height: 100%;
                background: #B4E380;
                width: 0%;
                border-radius: 2px;
                animation: loadingProgress 15s linear infinite;
            "></div>
        </div>
    </div>
    <style>
        @keyframes loadingProgress {
            0% { width: 0%; }
            70% { width: 85%; }
            100% { width: 100%; }
        }
    </style>
`;

    if (!$('#map-3d').length) {
        $('#map-3d-container').html('<div id="map-3d"></div>');
    }
    $('#map-3d-container').append(loadingHTML);
}

function hideLoadingIndicator() {
    $('.cesium-loading-overlay').fadeOut(300, function () {
        $(this).remove();
    });
}

function showError(message) {
    const errorHTML = `
        <div class="cesium-error-overlay" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(211, 47, 47, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            color: white;
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
        ">
            <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
            <h3>Erro ao Carregar Mapa 3D</h3>
            <p style="max-width: 400px; line-height: 1.5;">${message}</p>
            <button id="retry-cesium" style="
                margin-top: 20px;
                padding: 10px 20px;
                background: white;
                color: #d32f2f;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
            ">
                Tentar Novamente
            </button>
        </div>
    `;

    $('#map-3d-container').html(errorHTML);

    $('#retry-cesium').on('click', () => {
        appState.cesiumState = 'unloaded';
        switchTo3D();
    });
}


// ===== ATTRIBUTES PANEL MANAGEMENT =====
function toggleAttributesPanel() {
    if (!$('#attributes-panel').length) return;
    $('#attributes-panel').is(":visible") ? $('#attributes-panel').hide() : $('#attributes-panel').show();
}

// Observer para mudanças no DOM (otimizado)
const attributesPanelObserver = new MutationObserver(
    debounce((mutations) => {
        $('#open-close-form').css('display', 'none');

        if (!$('#map-sig').is(":visible")) return;

        if ($('#attributes-panel').length) {
            $('#attributes-panel').show();
        }
    }, 100)
);

attributesPanelObserver.observe(document, {
    attributes: false,
    childList: true,
    characterData: false,
    subtree: true
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

// ===== UTILITIES =====
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== CLEANUP MODIFICADO - APENAS EM CASOS EXTREMOS =====
window.addEventListener('beforeunload', () => {
    // ✅ MODIFICADO: Cleanup apenas ao sair da aplicação completa
    if (appState.cesiumState === 'loaded') {
        try {
            cleanup3DFeatures();
        } catch (error) {
            console.warn('⚠️ Erro no cleanup final (ignorado):', error);
        }
    }

    attributesPanelObserver.disconnect();
});

// ===== STREET VIEW SETUP =====
$('#mini-map-street-view').css({ display: 'none' });

// ===== FUNÇÃO ADICIONAL PARA CLEANUP MANUAL (SE NECESSÁRIO) =====
// Função para forçar limpeza do Cesium se necessário (debug/manutenção)
window.forceCesiumCleanup = function () {
    if (appState.cesiumState === 'loaded') {
        try {
            cleanup3DFeatures();
            appState.cesiumState = 'unloaded';
        } catch (error) {
            console.error('Erro no cleanup manual:', error);
        }
    }
};

// ===== EXPORTS PARA COMPATIBILIDADE =====
window.appState = appState; // Para debug