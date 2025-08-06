// Path: js\control_3d\map.js

// As configurações foram movidas para o map_3d.js para serem executadas
// apenas após o Cesium ser carregado dinamicamente

// Função para inicializar o viewer - será chamada de map_3d.js
export function createCesiumViewer(containerId) {
    if (typeof Cesium === 'undefined') {
        throw new Error('Cesium must be loaded before creating viewer');
    }
    
    // Configuração do extent
    const bounds = {
        "west": -44.449656,
        "south": -22.455922,
        "east": -44.449654,
        "north": -22.455920
    };
    
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    const viewer = new Cesium.Viewer(containerId, {
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

    viewer.scene.globe.baseColor = Cesium.Color.BLACK;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyBox.show = true;
    viewer.bottomContainer.style.display = "none";

    // Setup de posição e orientação inicial
    const position = Cesium.Cartesian3.fromDegrees(
        -44.4481491,
        -22.4546061,
        424.7
    );
    const heading = Cesium.Math.toRadians(164);
    const pitch = Cesium.Math.toRadians(-2);
    const roll = Cesium.Math.toRadians(-1);
    const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
    const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

    return viewer;
}

// Configurações que podem ser acessadas antes do Cesium ser carregado
export const mapConfig = {
    bounds: {
        west: -44.449656,
        south: -22.455922,
        east: -44.449654,
        north: -22.455920
    },
    initialCamera: {
        longitude: -44.4481491,
        latitude: -22.4546061,
        height: 424.7,
        heading: 164,
        pitch: -2,
        roll: -1
    }
};