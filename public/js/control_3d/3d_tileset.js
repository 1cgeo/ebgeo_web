// Path: js\control_3d\3d_tileset.js

export const load3dTileset = (viewer, tilesetSetup) => {
    // Verifica se Cesium está disponível
    if (typeof Cesium === 'undefined') {
        console.error('Cesium must be loaded before loading tilesets');
        return null;
    }
    
    if (!viewer || viewer.isDestroyed()) {
        console.error('Valid Cesium viewer required');
        return null;
    }
    
    const tileset = new Cesium.Cesium3DTileset({
        url: tilesetSetup.url,
        maximumScreenSpaceError: 16,
        maximumMemoryUsage: 512,
        preferLeaves: true,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 4.0,
        dynamicScreenSpaceErrorHeightFalloff: 0.25
    });

    viewer.scene.primitives.add(tileset);

    tileset.readyPromise.then(function (tileset) {
        const heightOffset = tilesetSetup.heightOffset;
        const modelMatrix = tileset.modelMatrix;
        const boundingSphere = tileset.boundingSphere;
        const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
        const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
        const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
        const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
        tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
        
        if (tilesetSetup.default) {
            const { lat, lon, height } = tilesetSetup.locate;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            });
        }
    }).otherwise(function (error) {
        console.error("Error loading tileset:", error);
    });
    
    return tileset;
};

// Função para configurar o RequestScheduler (movida de map_3d.js)
export const configureCesiumRequests = () => {
    if (typeof Cesium !== 'undefined' && Cesium.RequestScheduler) {
        Cesium.RequestScheduler.maximumRequestsPerServer = 36;
    }
};