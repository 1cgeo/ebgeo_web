
const load3dTileset = (map, tilesetSetup) => {
    var tileset = new Cesium.Cesium3DTileset({
        url: tilesetSetup.url,
        maximumScreenSpaceError: 16,
        maximumMemoryUsage: 512,
        preferLeaves: true,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 4.0,
        dynamicScreenSpaceErrorHeightFalloff: 0.25
    })
    var tilesets = map.scene.primitives.add(tileset);

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
            // map.flyTo(tileset, {
            //     offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 0)
            // });
            const { lat, lon, height } = tilesetSetup.locate
            map.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            });
        }



    }).otherwise(function (error) {
        // Handle loading errors here
        console.error("Error loading tileset:", error);
    });
    return tileset
}

Cesium.RequestScheduler.maximumRequestsPerServer = 36;


export { load3dTileset };