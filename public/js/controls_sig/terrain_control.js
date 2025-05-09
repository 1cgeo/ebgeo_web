// Path: js\controls_sig\terrain_control.js
export async function getTerrainElevation(map, coordinates, options = { exaggerated: false }) {
    // Fixed reference point outside the DEM
    const fixedPoint = [0, 0];
    const fixedPointElevation = await map.queryTerrainElevation(fixedPoint, options) || 0;

    // Get the elevation at the given coordinates
    const sceneElevation = await map.queryTerrainElevation(coordinates, options) || 0;
    const altitude = sceneElevation - fixedPointElevation;

    return altitude/1.5;
}