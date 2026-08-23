// Path: js/3d_models_viewer_tool/marker-features.js

/**
 * @fileoverview The 2D marker layer of the 3D catalog, as PURE data: which catalog row gets a
 * pin, which pin it gets, and which viewer that pin opens.
 *
 * WHY THIS IS A MODULE OF ITS OWN. Two places used to answer "which rows become markers", and
 * they answered it differently: the layer builder took the whole catalog list for the model pins
 * and then ADDED the scenes, while the id lookup searched the whole list first and only fell back
 * to the scenes. Both are the same question, so both live here now, over one partition
 * (`partitionTilesetEntries`), and neither imports the `config` singleton: the caller passes the
 * list. That keeps this file testable in plain node, which is where the regression that produced
 * it is pinned (`tests/unit/marcador-3d-cena-duplicada.repro.test.js`).
 *
 * THE PIN IS THE ROUTING. `kind` is what the popup reads to decide between "Visualizar em 3D"
 * (Cesium) and "Entrar na cena" (walk-through viewer), so a row on the wrong pin is not a cosmetic
 * mistake: it is an id handed to a loader that cannot open it.
 */

import {
    partitionTilesetEntries,
    resolveSceneAssets
} from '@js/first_person_3d_tool/scene-config.service.js';

/** Marker kinds carried by the GeoJSON `kind` property, and by the popup descriptor. */
export const MARKER_KIND = {
    TILESET: 'tileset',
    FIRST_PERSON: 'firstPerson'
};

/**
 * Does this catalog row have a position to draw a pin at?
 *
 * A row with no position is skipped, never defaulted. The catalog `config` column is FREE JSON an
 * admin edits by hand (Painel do Administrador, aba Catálogo), and a row saved without `locate`
 * used to make the builder throw, which took down the whole marker layer: one malformed row
 * disabled the 3D-models toggle for every user, with nothing on screen to say why. A scene may
 * also legitimately have no position, and it still exists in the catalog and in the search.
 *
 * @param {Object} entry - Catalog row
 * @returns {boolean} True when the row can be placed on the 2D map
 */
function hasPosition(entry) {
    return Number.isFinite(entry?.locate?.lon) && Number.isFinite(entry?.locate?.lat);
}

/**
 * The popup fields of a row drawn by Cesium.
 * @param {Object} entry - Catalog row from the Cesium half of the partition
 * @returns {Object} Descriptor without position
 */
function describeTileset(entry) {
    return {
        kind: MARKER_KIND.TILESET,
        markerId: entry.id,
        name: entry.name,
        dataCaptura: entry.data_captura || null,
        previewVideo: entry.previewVideo || null,
        previewThumbnail: entry.previewThumbnail || null
    };
}

/**
 * The popup fields of a walk-through scene.
 * Its two preview addresses are DERIVED from the scene folder, never read off the row.
 * @param {Object} scene - Scene row from the scene half of the partition
 * @returns {Object} Descriptor without position
 */
function describeScene(scene) {
    const assets = resolveSceneAssets(scene);
    return {
        kind: MARKER_KIND.FIRST_PERSON,
        markerId: scene.id,
        name: scene.name,
        dataCaptura: scene.data_captura || null,
        previewVideo: assets?.previewVideo || null,
        previewThumbnail: assets?.previewThumbnail || null
    };
}

/**
 * Wrap a descriptor into a GeoJSON point feature.
 * @param {Object} entry - Catalog row carrying `locate`
 * @param {Object} properties - Feature properties
 * @returns {Object} GeoJSON Feature
 */
function toPointFeature(entry, properties) {
    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [entry.locate.lon, entry.locate.lat]
        },
        properties
    };
}

/**
 * Build the marker features of the 3D catalog: ONE pin per positioned row, and the pin of a
 * walk-through scene routes to the walk-through viewer.
 *
 * @param {Array<Object>|*} entries - A catalog list shaped like `config.tilesets`
 * @param {Map<string, number>} [featureCounts] - Feature count by tileset id. A scene persists
 *   nothing, so it never carries one.
 * @returns {Array<Object>} GeoJSON point features
 */
export function buildMarkerFeatures(entries, featureCounts) {
    const { cesium, scenes } = partitionTilesetEntries(entries);

    const tilesetFeatures = cesium
        .filter(hasPosition)
        .map(tileset => toPointFeature(tileset, {
            ...describeTileset(tileset),
            tilesetId: tileset.id,
            featureCount: featureCounts?.get(tileset.id) || 0
        }));

    const sceneFeatures = scenes
        .filter(hasPosition)
        .map(scene => toPointFeature(scene, {
            ...describeScene(scene),
            sceneId: scene.id,
            featureCount: 0
        }));

    return [...tilesetFeatures, ...sceneFeatures];
}

/**
 * Resolve a marker id into the popup descriptor, over the SAME partition the pins came from.
 *
 * Searching the whole list first (as this lookup used to) answers a scene id with a Cesium
 * descriptor, because a scene IS a row of that list: the caller then flies to the right place and
 * offers the wrong button.
 *
 * @param {Array<Object>|*} entries - A catalog list shaped like `config.tilesets`
 * @param {string} markerId - Tileset id or scene id
 * @returns {Object|null} Descriptor with `coordinates`, or null when there is no pin for that id
 */
export function resolveMarkerDescriptor(entries, markerId) {
    const { cesium, scenes } = partitionTilesetEntries(entries);

    const tileset = cesium.find(t => t.id === markerId);
    if (tileset && hasPosition(tileset)) {
        return { coordinates: [tileset.locate.lon, tileset.locate.lat], ...describeTileset(tileset) };
    }

    const scene = scenes.find(s => s.id === markerId);
    if (scene && hasPosition(scene)) {
        return { coordinates: [scene.locate.lon, scene.locate.lat], ...describeScene(scene) };
    }

    return null;
}
