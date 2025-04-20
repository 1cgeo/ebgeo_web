// Path: js\index.js
import { } from './map_sig.js'
import {
    handleClickGoTo,
    activeTool,
    stopRendering,
    resumeRendering
} from './map_3d.js'
import { createModelButtons } from './create_model_buttons.js';
import config from './config.js';

var queryMobile = window.matchMedia("(max-width: 650px)")

// Cacheando elementos DOM frequentemente acessados
let $openCloseForm;
let $attributesPanel;
let $mapSig;
let $loadingBackground;
let loadingTimer;

// Read configuration flags
const enableMapSig = config.app.enableMapSig !== false; // Default to true if not set
const enable3D = config.app.enable3D !== false; // Default to true if not set
const defaultMode = config.app.defaultMode || "2d"; // Default to 2d if not specified

// Function to apply application configuration
function applyAppConfig() {
    // Set the browser tab title
    document.title = config.app.title || 'EBGeo';
    
    // Set the subtitle
    const subtitleElement = document.getElementById('app-subtitle');
    if (subtitleElement && config.app.subtitle) {
        subtitleElement.textContent = config.app.subtitle;
    }
    
    // Configure enabled modes
    setupModesBasedOnConfig();
}

// Configure UI based on which modes are enabled
function setupModesBasedOnConfig() {
    const centerButtons = document.querySelector('.bar-center-buttons');
    const sigButton = document.getElementById('sig-button');
    const threeDButton = document.getElementById('3d-button');
    
    // Handle cases where one or both modes are disabled
    if (!enableMapSig && !enable3D) {
        // Neither mode is enabled - this shouldn't happen, but show a message
        console.error('Configuration error: Both MapSig and 3D mode are disabled!');
        document.body.innerHTML = '<div style="text-align:center; margin-top:100px;"><h1>Error: No display modes are enabled</h1><p>Please check the configuration.</p></div>';
        return;
    }
    
    // Hide mode selector if only one mode is enabled
    if (!enableMapSig || !enable3D) {
        if (centerButtons) {
            centerButtons.style.display = 'none';
        }
    }
    
    // Set initial view and button state based on configuration
    if (!enableMapSig && enable3D) {
        // Only 3D mode enabled
        $('#map-sig').hide();
        $('#map-3d-container').show();
        resumeRendering();
        
        // Set 3D button as active if it exists
        if (threeDButton) {
            threeDButton.classList.add('active-button');
            if (sigButton) sigButton.classList.remove('active-button');
        }
    } else if (enableMapSig && !enable3D) {
        // Only 2D mode enabled
        $('#map-3d-container').hide();
        $('#map-sig').show();
        stopRendering();
        
        // Set SIG button as active if it exists
        if (sigButton) {
            sigButton.classList.add('active-button');
            if (threeDButton) threeDButton.classList.remove('active-button');
        }
    } else {
        // Both modes enabled - use the defaultMode setting
        const defaultTo3D = defaultMode.toLowerCase() === "3d";
        
        if (defaultTo3D) {
            $('#map-sig').hide();
            $('#map-3d-container').show();
            resumeRendering();
            if (threeDButton) threeDButton.classList.add('active-button');
            if (sigButton) sigButton.classList.remove('active-button');
        } else {
            $('#map-3d-container').hide();
            $('#map-sig').show();
            stopRendering();
            if (sigButton) sigButton.classList.add('active-button');
            if (threeDButton) threeDButton.classList.remove('active-button');
        }
    }
}

// Initialize model buttons when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Apply application configuration
    applyAppConfig();
    
    // Create model buttons in the desktop and mobile containers if 3D is enabled
    if (enable3D) {
        createModelButtons('locate-3d-container');
        
        // Attach click handlers after creating buttons
        $('#locate-3d-container button').on('click', handleClickGoTo);
    }
    
    // Inicializar cache de elementos DOM
    $openCloseForm = $('#open-close-form');
    $attributesPanel = $('#attributes-panel');
    $mapSig = $('#map-sig');
    $loadingBackground = $('.loading-background');
    
    // Verificar qual modo está ativo inicialmente
    if ($('#map-3d-container').is(":visible")) {
        resumeRendering();
    } else {
        stopRendering();
    }
    
    // Remover loading após 3 segundos
    loadingTimer = setTimeout(() => {
        $loadingBackground.css('display', 'none');
    }, 3000);
    
    // Configurar observer otimizado
    setupPanelObserver();
});

$('#open-close-form').on('click', () => {
    // Atualizar a referência caso ela tenha sido modificada
    $attributesPanel = $('#attributes-panel');
    
    if (!$attributesPanel.length) return;
    $attributesPanel.is(":visible") ? $attributesPanel.hide() : $attributesPanel.show();
})

// Função para configurar um observer otimizado
function setupPanelObserver() {
    // Encontrar o elemento pai que contém os painéis
    const targetNode = document.body;
    
    // Configurar o observer para observar apenas adições/remoções de painéis específicos
    const config = { 
        childList: true,       // Observe apenas adições/remoções diretas 
        subtree: true,         // Necessário para capturar mudanças em toda a árvore
        attributes: false,     // Não observe mudanças de atributos
        characterData: false   // Não observe mudanças de texto
    };
    
    // Função de callback do observer otimizada
    const callback = function(mutationsList) {
        // Verificar se alguma das mutações é relevante para nós
        let panelChanged = false;
        
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                // Verificar apenas se os nós adicionados/removidos são relevantes
                const relevantNodeFound = [...mutation.addedNodes, ...mutation.removedNodes].some(node => {
                    // Verificar apenas elementos DOM, não text nodes
                    return node.nodeType === 1 && 
                           (node.id === 'attributes-panel' || 
                            node.classList?.contains('unified-attributes-panel'));
                });
                
                if (relevantNodeFound) {
                    panelChanged = true;
                    break;
                }
            }
        }
        
        // Se não houver mudanças relevantes, retornar imediatamente
        if (!panelChanged) return;
        
        // Atualizar referência ao painel de atributos (pode ter sido recriado)
        $attributesPanel = $('#attributes-panel');
        
        // Esconder o botão por padrão
        $openCloseForm.css('display', 'none');
        
        // Se o mapa 2D não estiver visível, não fazer mais nada
        if (!$mapSig.is(":visible")) return;
        
        // Mostrar/esconder botões conforme necessário
        if ($attributesPanel.length && queryMobile.matches) {
            $openCloseForm.css('display', 'flex');
            $attributesPanel.hide();
        } else if ($attributesPanel.length) {
            $attributesPanel.show();
        }
    };
    
    // Criar e iniciar o observer
    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    
    // Armazenar o observer para possível limpeza futura
    window.panelObserver = observer;
}

var sigParents = {}
function openMobileMenu(query) {
    // Remove event handlers first to prevent duplicates
    $('.button-tool-3d').off('click', activeTool);

    if (query.matches && $('#map-sig').is(":visible") && enableMapSig) {
        $('#sidebarMenu').empty()

        sigParents['map-list'] = $('#map-list').parent()
        $('#map-list').appendTo('#sidebarMenu');
        $('.extra-bar-buttons button').css('display', 'none');
        $('.sidebarIconToggle').css('display', 'block');
        if ($('#attributes-panel').length) {
            $('#open-close-form').css('display', 'flex')
            $('#attributes-panel').hide()
        }
    } else if (query.matches && $('#map-3d-container').is(":visible") && enable3D) {
        if (sigParents['map-list']) {
            $('#map-list').appendTo(sigParents['map-list']);
            delete sigParents['map-list']
        }
        $('#sidebarMenu').empty()
        
        // Create mobile model list container
        const mobileContainer = document.createElement('div');
        mobileContainer.id = 'model-3d-container';
        mobileContainer.innerHTML = `
            <p><b>Modelos 3D</b></p>
            <hr class="solid">
            <div id="locate-3d-container-mobile"></div>
        `;
        
        $('#sidebarMenu').append(mobileContainer);
        
        // Create model buttons in the mobile container
        createModelButtons('locate-3d-container-mobile');
        
        // Add tutorial button
        $('#sidebarMenu').append(`
            <hr class="solid">
            <button onclick="window.open(
                'doc.html',
                '_blank' // <- This is what makes it open in a new window.
            );" class="tutorial-button pure-material-button-contained">Tutorial</button>
        `);
        
        // Attach click handlers for mobile buttons
        $('#locate-3d-container-mobile button').off('click', handleClickGoTo);
        $('#locate-3d-container-mobile button').on('click', handleClickGoTo);

        $('.extra-bar-buttons button').css('display', 'none');
        $('.sidebarIconToggle').css('display', 'block');
        $('#map-3d-tool-bar').css('display', 'none');
    } else {
        $('.extra-bar-buttons button').css('display', 'block');
        $('.sidebarIconToggle').css('display', 'none');
        $("#openSidebarMenu").prop("checked", false);

        if ($('#map-3d-container').is(":visible") && enable3D) {
            $('#map-3d-tool-bar').css('display', 'block');
        } else if (enableMapSig) {
            if (sigParents['map-list']) {
                $('#map-list').appendTo(sigParents['map-list']);
                delete sigParents['map-list'];
            }
        }
    }

    // Add event handlers back if 3D is enabled
    if (enable3D) {
        $('.button-tool-3d').on('click', activeTool);
    }
}

openMobileMenu(queryMobile);

queryMobile.addEventListener("change", function () {
    openMobileMenu(queryMobile);
});

// Only enable mode switching if both modes are enabled
if (enableMapSig && enable3D) {
    $(".bar-center-buttons a").click(function () {
        $(".bar-center-buttons a").removeClass('active-button')
        $(this).addClass('active-button')
        switch ($(this).attr('id')) {
            case '3d-button':
                $('#map-sig').hide();
                $('.unified-attributes-panel').hide()
                $('#map-3d-container').show();
                resumeRendering(); // Ativa a renderização 3D
                break;
            default:
                $('#map-3d-container').hide();
                $('#map-sig').show();
                $('.unified-attributes-panel').show();
                stopRendering(); // Desativa a renderização 3D
        }
        openMobileMenu(queryMobile);
    });
}

$('#mini-map-street-view').css({
    display: 'none'
});