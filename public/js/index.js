// Path: js\index.js
import { } from './map_sig.js'
import {
    handleClickGoTo,
    activeTool
} from './map_3d.js'
import { createModelButtons } from './create_model_buttons.js';

var queryMobile = window.matchMedia("(max-width: 650px)")

// Initialize model buttons when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Create model buttons in the desktop and mobile containers
    createModelButtons('locate-3d-container');
    
    // Attach click handlers after creating buttons
    $('#locate-3d-container button').on('click', handleClickGoTo);
});

$('#open-close-form').on('click', () => {
    if (!$('#attributes-panel').length) return
    $('#attributes-panel').is(":visible") ? $('#attributes-panel').hide() : $('#attributes-panel').show()
})

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

var observer = new MutationObserver((mutations) => {
    $('#open-close-form').css('display', 'none')
    if (!$('#map-sig').is(":visible")) return
    if ($('#attributes-panel').length && queryMobile.matches) {
        $('#open-close-form').css('display', 'flex')
        $('#attributes-panel').hide()
    }
    else if ($('#attributes-panel').length) {
        $('#attributes-panel').show()
    }
});

observer.observe(document, { attributes: false, childList: true, characterData: false, subtree: true });


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
            break;
        default:
            $('#map-3d-container').hide();
            $('#map-sig').show();
            $('.unified-attributes-panel').show()
    }
    openMobileMenu(queryMobile);
});


$('#mini-map-street-view').css({
    display: 'none'
});

$(document).ready(() => {
    setTimeout(()=> $('.loading-background').css('display', 'none'), 3000)
})