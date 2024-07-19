Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkMzViMDllOS0zMDNhLTRlNjgtODRmYi1iYzQyNmY3ZmEyYWIiLCJpZCI6MjA1ODQ1LCJpYXQiOjE3MTE5ODI0Mzd9.BhKXygD0YSiMuUVD1o7AfOmWKCOlS3lCMQuQMViPQac';
var map = new Cesium.Viewer("map-3d", {
    infoBox: true,
    shouldAnimate: true,
    vrButton: true,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: true,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
});

export { map };
