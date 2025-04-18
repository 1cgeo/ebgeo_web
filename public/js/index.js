// Path: js\index.js
import { } from './map_sig.js'
import {
    handleClickGoTo,
    activeTool
} from './map_3d.js'


var queryMobile = window.matchMedia("(max-width: 650px)")


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
        $('#sidebarMenu').append(`
        <div id="model-3d-container">
                <p><b>Modelos 3D</b></p>
                <hr class="solid">
                <!-- <button id="btnAMAN" class="tools">AMAN</button>
            <button id="btnPCL" class="tools">PCL</button>
            <button id="btnESA" class="tools">ESA</button> -->
                <div id="locate-3d-container-mobile">
                    <button id="aman" class="tutorial-button pure-material-button-contained">AMAN</button>
                    <button id="aman-pcl" class="tutorial-button pure-material-button-contained">AMAN PCL</button>
                    <button id="esa" class="tutorial-button pure-material-button-contained">ESA</button>
                </div>
            </div>
            <hr class="solid">
            <button onclick="window.open(
                'doc.html',
                '_blank' // <- This is what makes it open in a new window.
            );" class="tutorial-button pure-material-button-contained">Tutorial</button>
        `)
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