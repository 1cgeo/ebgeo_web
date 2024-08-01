import { } from './map_sig.js'
import { } from './map_3d.js'


function openMobileMenu3D(query) {
    if (query.matches && $('#map-3d-container').is(":visible")) {
        $('.extra-bar-buttons button').css('display', 'none');
        $('.sidebarIconToggle').css('display', 'block');
        $('#map-3d-tool-bar').css('display', 'none');
    } else {
        $('.extra-bar-buttons button').css('display', 'block');
        $('.sidebarIconToggle').css('display', 'none');
        $('#map-3d-tool-bar').css('display', 'block');
        $("#openSidebarMenu").prop("checked", false);
    }
}

var queryMobile = window.matchMedia("(max-width: 650px)")

openMobileMenu3D(queryMobile);

queryMobile.addEventListener("change", function () {
    openMobileMenu3D(queryMobile);
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





