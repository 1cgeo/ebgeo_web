var { west, south, east, north } = {
    "west": -44.449656,
    "south": -22.455922,
    "east": -44.449654,
    "north": -22.455920
}
var extent = new Cesium.Rectangle.fromDegrees(west, south, east, north)
Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

var map = new Cesium.Viewer("map-3d", {
    infoBox: false,
    shouldAnimate: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: true,
    animation: false,
    timeline: false,
    fullscreenButton: false
});
map.scene.globe.baseColor=Cesium.Color.BLACK;
map.scene.skyAtmosphere.show = true;
map.scene.skyBox.show = true;
map.bottomContainer.style.display = "none";

const position = Cesium.Cartesian3.fromDegrees(
    -44.4481491,
    -22.4546061,
    424.7
);
const heading = Cesium.Math.toRadians(164);
const pitch =  Cesium.Math.toRadians(-2);
const roll = Cesium.Math.toRadians(-1);
const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    hpr
);

// const entity = map.entities.add({
//     name: '3d/estatua.glb',
//     position: position,
//     orientation: orientation,
//     model: {
//     uri: '3d/estatua.glb',
//     },
// });

export { map };
