// Path: js/store/repository.utils.js

/**
 * @fileoverview Pure utility functions for data manipulation and validation.
 * Re-exported from repository.js for backward compatibility.
 */

/** Legacy schema version (pre-Atlas, v1.3-v1.7). */
export const SCHEMA_VERSION = '1.7';

/**
 * Minimum supported legacy schema version.
 *
 * IT STAYS AT 1.3, and raising it is not a tidy-up: this is the floor under which
 * `checkAndCleanLegacyData` calls `clearLegacyStores()` and DESTROYS the repository instead of
 * migrating it. Real installations sit just above it, because the other product line's data
 * wipe stamps `'1.7'` on a repository whose atlas record is still at 2.4. A floor at 2.0 would
 * delete a full atlas on the first boot after the crossing. Pinned, with its twin
 * `MIN_MIGRATABLE_VERSION`, by `tests/store/pisos-de-migracao.test.js`.
 */
export const MIN_SCHEMA_VERSION = '1.3';

/** Maximum legacy schema version. */
export const MAX_SCHEMA_VERSION = '1.7';

/** Properties internal to MapLibre/Mapbox that should not be persisted. */
const INTERNAL_PROPERTIES = new Set([
    '_vectorTileFeature', '_pbf', '_geometry', '_keys', '_values',
    '_z', '_x', '_y',
    'layer', 'state',
    'extent', 'type'
]);

/**
 * Checks if a property is internal MapLibre/Mapbox metadata.
 * @param {string} key - Property key
 * @returns {boolean} True if internal property
 */
export function isInternalProperty(key) {
    return key.startsWith('_') || INTERNAL_PROPERTIES.has(key);
}

/**
 * Removes internal Mapbox metadata and keeps only essential GeoJSON data.
 * @param {Object} feature - Feature to clean
 * @returns {Object|null} Cleaned feature or null if invalid
 */
export function cleanFeature(feature) {
    if (!feature || !feature.type) {
        console.warn('Invalid feature provided for cleaning:', feature);
        return null;
    }

    let geometry = feature.geometry || feature._geometry;

    // Temporal: a trajectory-displaced feature carries its authoring (home)
    // position in the runtime-only `_temporalHome`. Persist the home position,
    // not the interpolated/displaced one, so editing a moving feature never
    // saves a wrong location. (`_temporalHome` itself is dropped below by the
    // `_`-prefix rule in isInternalProperty.)
    const home = feature.properties?._temporalHome;
    if (Array.isArray(home) && home.length >= 2 && geometry?.type === 'Point') {
        geometry = { ...geometry, coordinates: [home[0], home[1]] };
    }

    const cleanedProperties = {};
    if (feature.properties) {
        for (const [key, value] of Object.entries(feature.properties)) {
            if (!isInternalProperty(key)) {
                cleanedProperties[key] = value;
            }
        }
    }

    return {
        type: feature.type,
        id: feature.id,
        properties: cleanedProperties,
        geometry
    };
}

/**
 * Compares two version strings (format X.Y or X.Y.Z).
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
export function compareVersions(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);
    const maxLen = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLen; i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part < v2Part) return -1;
        if (v1Part > v2Part) return 1;
    }
    return 0;
}

/**
 * Returns empty map data structure.
 * @returns {Object} Empty map data
 */
export function getEmptyMapData() {
    return {
        baseLayer: 'carta-topografica',
        analysisLayers: {},
        features: {
            polygons: [],
            lines: [],
            points: [],
            texts: [],
            images: [],
            los: [],
            visibility: [],
            processed_los: [],
            processed_visibility: [],
            brushes: [],
            rectangles: [],
            circles: [],
            ellipses: [],
            arrows: [],
            boundarys: [],
            occupied_fronts: [],
            coordination_lines: [],
            military_symbols: [],
            setores: [],
            coordenadas: [],
            coordination_measures: [],
            magnetic_declinations: []
        },
        zoom: null,
        center_lat: null,
        center_long: null,
        bearing: null,
        pitch: null
    };
}

/** The feature collection the Coordination Line tool draws into. */
const COORDINATION_LINE_BUCKET = 'coordination_lines';

/** The bucket the v2.2 Barrier Line tool drew into, and the `source` it stamped. */
const LEGACY_BARRIER_BUCKET = 'barrier_lines';
const LEGACY_BARRIER_SOURCE = 'barrier_line';

/** The `source` every feature in the surviving bucket carries. */
const COORDINATION_LINE_SOURCE = 'coordination_line';

/**
 * What a v2.2 Barrier Line is missing to be a Coordination Line, with the values the new
 * tool would have given it.
 *
 * COPIED from `AddCoordinationLineControl.DEFAULT_PROPERTIES`, not imported, and the copy is
 * forced: this module is EAGER on the map page, and `teto-de-peso-da-pagina-do-mapa.test.js`
 * budgets `military_tools/` at ZERO eager modules, so an import of the tool (or of its
 * catalogue, which lives in the same folder) would turn that guard red. A copy without a
 * guard is a copy that goes stale, so `coordination-line-balde.test.js` reads both sources
 * and compares them.
 *
 * The two tables differ by exactly ONE property, measured on 2026-09-07 against
 * `add_barrier_line_control.js:58` at `24b07975` and `add_coordination_line_control.js:110`
 * here: `symbol_code`, which the v2.3 tool added because its combobox picks one of the ten
 * MD33 linear symbols. `290199` IS the barrier line of that catalogue (a hollow diamond
 * interrupting the line), and it is also the new tool's own default, so a v2.2 feature that
 * crosses over draws exactly the symbol it was drawn as. Everything else is name-for-name
 * identical, the zoom contract included, which is why the size, the spacing and the anchor
 * cross UNTOUCHED instead of being recomputed.
 *
 * `calculatedLineWidth`, `calculatedSymbolSize` and `calculatedSymbolSpacing` are absent on
 * purpose: they are DERIVED, and `applyZoomCorrections` rewrites all three on load.
 */
const COORDINATION_LINE_FALLBACKS = Object.freeze({
    symbol_code: '290199',
    symbol_size: 0.5,
    symbol_spacing: 1.5,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
});

/**
 * Turn one v2.2 Barrier Line feature into the Coordination Line it became.
 *
 * WHY `baseCoordinates` IS RECOVERED HERE. The load path runs every stored line through
 * `applyZoomCorrections`, which REGENERATES the geometry from the properties, and
 * `generateCoordinationLineGeometry` with no usable `baseCoordinates` returns
 * `{ LineString, [[0, 0], [0, 0]] }`. So a feature that reaches this bucket without them
 * does not merely draw wrong: it leaves its own place and lands on Null Island, which is
 * worse than the bug this rename fixes. The v2.2 tool always wrote them, so the hole is the
 * hand-edited file (and the forged fixture that found this), and the honest recovery is the
 * feature's own geometry — but ONLY when it is a LineString. A drawn barrier line is a
 * MultiLineString (the interrupted spine plus one ring per diamond) and its authored spine
 * cannot be read back out of it, so that case is left alone rather than guessed at.
 *
 * @param {Object} feature - A feature from the legacy bucket
 * @returns {Object|null} The adopted feature, or null when there is no feature to adopt
 */
function adoptBarrierLine(feature) {
    if (!feature || typeof feature !== 'object') return null;

    const properties = { ...(feature.properties || {}) };

    properties.source = COORDINATION_LINE_SOURCE;
    // `properties.type` is stripped by `cleanFeature` on the way to storage, so it survives
    // only on a feature that never went through it. When it is there, it follows `source`.
    if (properties.type === LEGACY_BARRIER_SOURCE) properties.type = COORDINATION_LINE_SOURCE;

    for (const [key, value] of Object.entries(COORDINATION_LINE_FALLBACKS)) {
        if (properties[key] === undefined || properties[key] === null) properties[key] = value;
    }

    const coordinates = feature.geometry?.type === 'LineString' ? feature.geometry.coordinates : null;
    if (properties.baseCoordinates == null && Array.isArray(coordinates) && coordinates.length >= 2) {
        properties.baseCoordinates = coordinates.map(position => [position[0], position[1]]);
    }

    return { ...feature, properties };
}

/**
 * Bring one map's feature collection to the shape the Coordination Line tool needs.
 *
 * WHY THIS IS NOT A SCHEMA MIGRATION. A map created before the tool existed has no
 * `coordination_lines` key, and that is NOT harmless: `setupCoordinationLineLayers`
 * builds the MapLibre source out of that collection, and every write the tool makes
 * goes through `getSource(...)?.setData`, whose optional chaining swallows the absence.
 * The tool then activates, accepts clicks and draws NOTHING, with no error and no log.
 *
 * The other product line paid a schema bump for exactly this, and its number for it was 2.3.
 * This line did NOT follow, by the decision of 2026-09-03: a shape a read can normalise on its
 * own does not deserve a version. So this runs at READ time, in the three paths a map can enter
 * by (`.ebgeo` import, server snapshot, IndexedDB read), all three calling THIS function so
 * they cannot drift apart.
 *
 * THE VERSION HERE IS NOW 3.0, AND THE PARAGRAPH ABOVE USED TO SAY "stays at 2.3", which is
 * how the same number ended up meaning two different things in the two lines and how a
 * repository from the other one was read as current here. The decision that did NOT change is
 * this one: the bucket stays a read-time normalisation and the 3.0 step transforms no feature.
 * See `migration/v2.x-to-v3.0.migration.js` and `docs/decisions/decisions-2026.md`.
 *
 * IT ALSO ADOPTS THE v2.2 BUCKET, AND THAT IS THE SECOND HALF OF THE SAME STORY. Before the
 * Coordination Line there was the Barrier Line, whose features live in `barrier_lines` with
 * `source: 'barrier_line'`. The other line's 2.2 -> 2.3 migration added the new bucket EMPTY
 * and moved nothing, so those features have been travelling from 2.2 through 2.3, 2.4 and 3.0
 * on disk and inside every `.ebgeo`, while `barrier_lines` appears nowhere in the code of any
 * of the three: no MapLibre source, no layer, no row in the feature tab, no count. Measured on
 * 2026-09-07 with a forged five-line fixture (relatório B2 of that day): 5 features in, 5
 * features out of the `.ebgeo`, 0 drawn. Not lost bytes, lost reach.
 *
 * So the legacy bucket is EMPTIED into the surviving one, its features stamped with the new
 * `source` and with the MD33 code of the barrier line, and the key itself is dropped. Dropping
 * it is what makes the pass idempotent: a second run finds no legacy key and answers null.
 *
 * Returns null when there is nothing to do, which is what keeps a caller from rewriting
 * a document it only read. Idempotent, so a map that already carries the bucket (one
 * written by `main` at 2.3, for instance) passes through untouched.
 *
 * Nothing is INVENTED. A feature only ever gains what the new tool would have given it by
 * default, an empty bucket is the honest reading of "this map has no coordination lines yet",
 * and a coordination line that is already there is neither reordered nor rewritten: the
 * adopted ones are appended after it.
 *
 * @param {Object} features - The map's feature collection
 * @returns {Object|null} New feature collection, or null when already in shape
 */
export function ensureCoordinationLines(features) {
    if (!features || typeof features !== 'object') return null;

    const hasLegacyBucket = Object.prototype.hasOwnProperty.call(features, LEGACY_BARRIER_BUCKET);
    const hasBucket = Array.isArray(features[COORDINATION_LINE_BUCKET]);
    if (hasBucket && !hasLegacyBucket) return null;

    const { [LEGACY_BARRIER_BUCKET]: legacy, ...rest } = features;
    const kept = hasBucket ? features[COORDINATION_LINE_BUCKET] : [];
    // A legacy bucket that is not an array carries nothing recoverable, and dropping the key
    // is still right: it is the shape no reader in this line knows how to read.
    const adopted = Array.isArray(legacy) ? legacy.map(adoptBarrierLine).filter(Boolean) : [];

    return { ...rest, [COORDINATION_LINE_BUCKET]: adopted.length ? [...kept, ...adopted] : kept };
}

/**
 * Return a map document whose feature collection carries every bucket the app expects.
 *
 * The same null contract as `ensureCoordinationLines`, one level up: null means the
 * document is already in shape and the caller should keep the object it has.
 *
 * @param {Object} mapData - A stored map document
 * @returns {Object|null} New map document, or null when nothing changed
 */
export function ensureMapDataShape(mapData) {
    if (!mapData || typeof mapData !== 'object') return null;

    const features = ensureCoordinationLines(mapData.features);
    return features ? { ...mapData, features } : null;
}

/**
 * Returns default layer structure.
 * @returns {Object} Default layer
 */
export function getDefaultLayer() {
    const now = Date.now();
    return {
        id: 'default',
        name: 'Padrão',
        visible: true,
        locked: false,
        opacity: 1,
        order: 0,
        createdAt: now,
        updatedAt: now,
        version: 1
    };
}

/**
 * Returns empty Cesium 3D data structure.
 * @returns {Object} Empty cesium3d data
 */
export function getEmptyCesium3dData() {
    return {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: []
    };
}

/**
 * Returns empty Street View 360 data structure.
 * @returns {Object} Empty streetview360 data
 */
export function getEmptyStreetview360Data() {
    return {
        orientations: {},
        markers: []
    };
}
