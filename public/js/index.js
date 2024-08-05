import { } from './map_sig.js'
import {
    handleClickGoTo,
    activeTool
} from './map_3d.js'


var queryMobile = window.matchMedia("(max-width: 650px)")


/* 3D MOBILE */
function openMobileMenu3D(query) {
    $('.button-tool-3d').off('click', activeTool);
    if (query.matches && $('#map-3d-container').is(":visible")) {
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
    <div id="tool-3d-container">
        <p><b>Ferramentas</b></p>
        <hr class="solid">
        <div class="tools-3d-bar">
            <div>
                <a id="visualizacao" class="button-tool-3d icon-tool-3d">
                    <img src="./images/viewshed_icon.svg" alt="Viewshed" />
                </a>
            </div>
            <div>
                <a id="distancia" class="button-tool-3d icon-tool-3d">
                    <img src="./images/distance_icon.svg" alt="distance" />
                </a>
            </div>
            <div>
                <a id="area" class="button-tool-3d icon-tool-3d">
                    <img src="./images/area_icon.svg" alt="area" />
                </a>
            </div>
            <div>
                <a id="limpar" href="javascript:;" class="button-tool-3d icon-tool-3d">
                    <img src="./images/clear_icon.svg" alt="clear" />
                </a>
            </div>
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
        $('#map-3d-tool-bar').css('display', 'block');
        $("#openSidebarMenu").prop("checked", false);
    }
    $('.button-tool-3d').on('click', activeTool);
}


/* SIG MOBILE */

$('#open-close-form').on('click', () => {
    if (!$('#attributes-panel').length) return
    $('#attributes-panel').is(":visible") ? $('#attributes-panel').hide() : $('#attributes-panel').show()
})

var sigParents = {}
function openMobileMenuSIG(query) {
    $('.button-tool-3d').off('click', activeTool);
    if (query.matches && $('#map-sig').is(":visible")) {
        sigParents['map-list'] = $('#map-list').parent()
        $('#map-list').appendTo('#sidebarMenu');
        $('.extra-bar-buttons button').css('display', 'none');
        $('.sidebarIconToggle').css('display', 'block');
        if ($('#attributes-panel').length) {
            $('#open-close-form').css('display', 'flex')
            $('#attributes-panel').hide()
        }
    } else {
        $('.extra-bar-buttons button').css('display', 'block');
        $('.sidebarIconToggle').css('display', 'none');
        $("#openSidebarMenu").prop("checked", false);
        $('#map-list').appendTo(sigParents['map-list']);
        delete sigParents['map-list']
    }
    $('.button-tool-3d').on('click', activeTool);
}

var observer = new MutationObserver((mutations) => {
    $('#open-close-form').css('display', 'none')
    if ($('#attributes-panel').length && queryMobile.matches) {
        $('#open-close-form').css('display', 'flex')
        $('#attributes-panel').hide()
    }
    else if ($('#attributes-panel').length) {
        $('#attributes-panel').show()
    }
});

observer.observe(document, { attributes: false, childList: true, characterData: false, subtree: true });


openMobileMenu3D(queryMobile);
openMobileMenuSIG(queryMobile);

queryMobile.addEventListener("change", function () {
    openMobileMenu3D(queryMobile);
    openMobileMenuSIG(queryMobile);
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
    openMobileMenu3D(queryMobile);
});


$('#mini-map-street-view').css({
    display: 'none'
});






