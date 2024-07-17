import { } from './map_sig.js'
import { } from './map_3d.js'

$(".bar-center-buttons a").click(function () {
    $(".bar-center-buttons a").removeClass('active-button')
    $(this).addClass('active-button')

    switch ($(this).attr('id')) {
        case '3d-button':
            $('#map-sig').hide();
            $('#map-3d-container').show();
            break;
        default:
            $('#map-3d-container').hide();
            $('#map-sig').show();
    }
});

$(".bar-center-buttons a").click(function() {
    $(".bar-center-buttons a").removeClass('active-button')
    $(this).addClass('active-button')
});
