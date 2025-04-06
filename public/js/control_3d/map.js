// Path: js\control_3d\map.js
import config from '../config.js';

// Get extent from config
const { west, south, east, north } = config.map3d.defaultExtent;
const extent = new Cesium.Rectangle.fromDegrees(west, south, east, north);
Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

// Create viewer with configuration
var map = new Cesium.Viewer("map-3d", config.map3d.viewer);
map.scene.globe.baseColor = Cesium.Color.BLACK;
map.scene.skyAtmosphere.show = true;
map.scene.skyBox.show = true;
map.bottomContainer.style.display = "none";

// Set camera position from config
const { longitude, latitude, height } = config.map3d.defaultCamera.position;
const position = Cesium.Cartesian3.fromDegrees(
    longitude,
    latitude,
    height
);
const heading = Cesium.Math.toRadians(config.map3d.defaultCamera.heading);
const pitch = Cesium.Math.toRadians(config.map3d.defaultCamera.pitch);
const roll = Cesium.Math.toRadians(config.map3d.defaultCamera.roll);
const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
const orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    hpr
);

export { map };