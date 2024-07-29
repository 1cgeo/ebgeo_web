
// var { west, south, east, north } = {
//     "west": -0.7760082380444313,
//     "south": -0.39205563332555876,
//     "east": -0.7755774242078299,
//     "north": -0.39180386548072876
// }
// var extent = new Cesium.Rectangle.fromDegrees(west, south, east, north)
// Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
// Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;


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
    globe: false
});

map.scene.skyAtmosphere.show = false;
map.scene.skyBox.show = false;
map.bottomContainer.style.display = "none";

export { map };
