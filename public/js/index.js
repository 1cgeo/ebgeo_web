// Path: js\index.js
import { } from './map_sig.js'
import {
    handleClickGoTo,
    activeTool,
    stopRendering,
    resumeRendering
} from './map_3d.js'
import { createModelButtons } from './create_model_buttons.js';

var queryMobile = window.matchMedia("(max-width: 650px)")

// Cacheando elementos DOM frequentemente acessados
let $openCloseForm;
let $attributesPanel;
let $mapSig;
let $loadingBackground;
let loadingTimer;

// Initialize model buttons when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Create model buttons in the desktop and mobile containers
    createModelButtons('locate-3d-container');
    
    // Attach click handlers after creating buttons
    $('#locate-3d-container button').on('click', handleClickGoTo);
    
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
    $('.button-tool-3d').off('click', activeTool);

    if (query.matches && $('#map-sig').is(":visible")) {
        $('#sidebarMenu').empty()

        sigParents['map-list'] = $('#map-list').parent()
        $('#map-list').appendTo('#sidebarMenu');
        $('.extra-bar-buttons button').css('display', 'none');
        $('.sidebarIconToggle').css('display', 'block');
        if ($('#attributes-panel').length) {
            $('#open-close-form').css('display', 'flex')
            $('#attributes-panel').hide()
        }
    } else if (query.matches && $('#map-3d-container').is(":visible")) {
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

        if ($('#map-3d-container').is(":visible")) {
            $('#map-3d-tool-bar').css('display', 'block');

        } else {
            $('#map-list').appendTo(sigParents['map-list']);
            delete sigParents['map-list']
        }
    }

    $('.button-tool-3d').on('click', activeTool);
}

openMobileMenu(queryMobile);

queryMobile.addEventListener("change", function () {
    openMobileMenu(queryMobile);
});

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


$('#mini-map-street-view').css({
    display: 'none'
});