// Path: js/layers/styles/content.layers.js

/**
 * @fileoverview Content layer styles (text, image, arrow).
 */

import { getControl } from '../../store';
import { writeWholeCollection } from '../geojson-dispatcher.js';
import { zoomScaledExpression } from './zoom-expression.js';

// GPU-side zoom scaling (zoom-expression.js); `calculatedSize` is refreshed by
// the tools at the end of a gesture for the consumers that read it.
const TEXT_SIZE = { base: ['coalesce', ['get', 'size'], 16], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 255 };
const IMAGE_SIZE = { base: ['coalesce', ['get', 'size'], 1], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 10 };

const EMPTY_COLLECTION = { type: 'FeatureCollection', features: [] };

/**
 * Creates a FeatureCollection from an array of features.
 * @param {Array} features
 * @returns {Object}
 */
function featureCollection(features) {
    return { type: 'FeatureCollection', features };
}

/**
 * Adds a new source or updates an existing one with the given features.
 *
 * `promoteId: 'id'` is declared HERE, not at the call sites: `setStyle()` (base-layer switch)
 * destroys and recreates every custom source, and a promoteId set anywhere else would be gone
 * after the first base-layer change, making every later `updateData` throw. It is also the
 * precondition for diffing at all: without a resolvable, unique key per feature MapLibre refuses
 * the diff with "Cannot update existing geojson data in <source>".
 *
 * Sources created here (texts, text-backgrounds, images, arrows) all carry a unique
 * `properties.id`: a UUID for the first three, `<idDoTexto>_bg` for text-backgrounds.
 *
 * Measured risk, and why it is not a risk: promoteId changes what MapLibre reports as
 * `feature.id`, from the integer `geoJsonId` to the UUID. Nothing in `src/` reads `feature.id`
 * off one of our GeoJSON sources (the single read, `vector-info.control.js`, is filtered down to
 * `edgv_` vector tiles). `setFeatureState` has one caller on these sources
 * (`attribute_table/attribute-table.control.js`, `{ tableHover }`) which today either throws into
 * a swallowed `console.debug` or writes state nobody reads, since no paint expression reads
 * `['feature-state','tableHover']`; with promoteId it starts matching and stays unread. Visible
 * change: none. Precedent in this repository: `calibration/project-map.js` (pmap-photos).
 *
 * The update branch goes through `writeWholeCollection` because two of the four sources it serves
 * (`images` and `arrows`) are owned by a dispatcher: a raw `setData` here would drop a queued diff
 * without any error. The other two (`texts`, `text-backgrounds`) have no dispatcher, and the helper
 * writes them raw, which keeps this redraw from claiming ownership of a source the text tool still
 * writes directly.
 * @param {Object} map - MapLibre map instance
 * @param {string} name - Source name
 * @param {Array} features - GeoJSON features
 */
function setSourceData(map, name, features) {
    const data = featureCollection(features);
    const source = map.getSource(name);
    if (source) {
        writeWholeCollection(map, name, data);
    } else {
        map.addSource(name, { type: 'geojson', data, promoteId: 'id' });
    }
}

/**
 * Adds an empty GeoJSON source if it does not already exist.
 *
 * DELIBERATELY WITHOUT `promoteId`. Every source created here is ephemeral (text-edit-handles,
 * arrow-feedback, arrow-edit-handles): drawing preview and drag handles, rebuilt on mousemove,
 * whose features carry `handleType`/`role` and no `properties.id`. With promoteId their key would
 * resolve to null, which makes the source permanently non-diffable anyway, and they are not
 * candidates for the diff dispatcher: a handful of features per frame, where `setData` is already
 * cheap and a lost frame is a visibly stuck rubber band.
 * @param {Object} map - MapLibre map instance
 * @param {string} name - Source name
 */
function addEmptySource(map, name) {
    if (!map.getSource(name)) {
        map.addSource(name, { type: 'geojson', data: EMPTY_COLLECTION });
    }
}

/**
 * Adds a layer only if it does not already exist on the map.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full layer definition including `id`
 */
function addLayerOnce(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * Extracts background polygon features from text features that have
 * `showBackground` enabled and a `selectionBox` geometry.
 *
 * The optional chain is load-bearing, not defensive style. A text feature with no
 * `properties` (one that arrived over sync, or a half-written import) threw here,
 * and the throw escapes BEFORE the four `addLayerOnce` calls below, so the cost
 * was not the one missing background: no text layer was created at all and every
 * text disappeared from the map.
 *
 * @param {Array} texts - Text GeoJSON features
 * @returns {Array}
 */
function toBackgroundFeatures(texts) {
    return texts
        .filter(f => f?.properties?.showBackground && f.properties.selectionBox)
        .map(f => ({
            type: 'Feature',
            properties: { ...f.properties, id: f.properties.id + '_bg' },
            geometry: f.properties.selectionBox
        }));
}

/**
 * Applies zoom corrections if a control is available, otherwise returns features unchanged.
 * @param {Object|undefined} control - Tool control instance
 * @param {Array} features - GeoJSON features
 * @returns {Array}
 */
function applyCorrections(control, features) {
    return control ? control.applyZoomCorrections(features) : features;
}

// -- Visibility filter reused across text background layers --
const TEXT_BG_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['==', ['get', 'showBackground'], true]
];

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

/**
 * Sets up text layers on the map.
 * @param {Object} features - Feature collection with texts
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupTextLayers(features, mapInstance) {
    const textControl = getControl('AddTextControl');
    const correctedTexts = applyCorrections(textControl, features.texts);

    setSourceData(mapInstance, 'texts', correctedTexts);
    setSourceData(mapInstance, 'text-backgrounds', toBackgroundFeatures(correctedTexts));

    addLayerOnce(mapInstance, {
        id: 'text-background-fill-layer',
        type: 'fill',
        source: 'text-backgrounds',
        paint: {
            'fill-color': ['get', 'backgroundFillColor'],
            'fill-opacity': ['get', 'backgroundFillOpacity']
        },
        filter: TEXT_BG_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'text-background-border-layer',
        type: 'line',
        source: 'text-backgrounds',
        paint: {
            'line-color': ['get', 'backgroundBorderColor'],
            'line-width': ['get', 'backgroundBorderWidth'],
            'line-opacity': ['get', 'backgroundBorderOpacity']
        },
        filter: TEXT_BG_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'text-layer',
        type: 'symbol',
        source: 'texts',
        layout: {
            'text-field': ['get', 'text'],
            'text-size': zoomScaledExpression(TEXT_SIZE),
            'text-justify': ['get', 'justify'],
            'text-anchor': 'center',
            'text-rotate': ['get', 'rotation'],
            'text-ignore-placement': true,
            'text-allow-overlap': true
        },
        paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': ['get', 'backgroundColor'],
            'text-halo-width': ['get', 'textHaloWidth'],
            'text-opacity': 1
        },
        filter: VISIBLE_FILTER
    });

    addEmptySource(mapInstance, 'text-edit-handles');

    addLayerOnce(mapInstance, {
        id: 'text-edit-handles-layer',
        type: 'circle',
        source: 'text-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': '#0066ff',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
        },
        filter: ['==', '$type', 'Point']
    });

    // Mirror every write to the 'texts' source into 'text-backgrounds'. The "already patched" mark
    // lives on the SOURCE, not on the control: `setStyle()` (base-layer switch) destroys and
    // recreates every custom source, while the control is a session-long singleton — a mark on the
    // control would stay true and leave the brand-new source unpatched for the rest of the session.
    const textsSource = mapInstance.getSource('texts');
    if (textsSource && !textsSource.__ebgeoBgPatch) {
        // The backgrounds are derived from the collection JUST WRITTEN, so there is no worker
        // round trip (`getData`) and no deferred timer here: the previous shape paid one
        // `getData` per write to `texts`, and the zoom pass wrote once per frame of a gesture.
        const originalSetData = textsSource.setData.bind(textsSource);
        textsSource.setData = function (data) {
            originalSetData(data);
            const features = Array.isArray(data?.features) ? data.features : [];
            mapInstance.getSource('text-backgrounds')?.setData(
                featureCollection(toBackgroundFeatures(features))
            );
            return this;
        };
        textsSource.__ebgeoBgPatch = true;
    }
}

/**
 * Sets up image layers on the map.
 * @param {Object} features - Feature collection with images
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupImageLayers(features, mapInstance) {
    const imageControl = getControl('AddImageControl');
    const correctedImages = applyCorrections(imageControl, features.images);

    setSourceData(mapInstance, 'images', correctedImages);

    addLayerOnce(mapInstance, {
        id: 'image-layer',
        type: 'symbol',
        source: 'images',
        paint: {
            'icon-opacity': ['get', 'opacity']
        },
        layout: {
            'icon-image': ['get', 'id'],
            'icon-size': zoomScaledExpression(IMAGE_SIZE),
            'icon-rotate': ['get', 'rotation'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        filter: VISIBLE_FILTER
    });
}

/**
 * Sets up arrow layers on the map.
 * @param {Object} features - Feature collection with arrows
 * @param {Object} mapInstance - MapLibre map instance
 */
export function setupArrowLayers(features, mapInstance) {
    setSourceData(mapInstance, 'arrows', features.arrows);
    addEmptySource(mapInstance, 'arrow-feedback');
    addEmptySource(mapInstance, 'arrow-edit-handles');

    addLayerOnce(mapInstance, {
        id: 'arrow-feedback-layer',
        type: 'line',
        source: 'arrow-feedback',
        paint: {
            'line-color': '#ff0000',
            'line-width': 4,
            'line-dasharray': [3, 3],
            'line-opacity': 0.8
        }
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-fill-layer',
        type: 'fill',
        source: 'arrows',
        paint: {
            'fill-color': ['get', 'fillColor'],
            'fill-opacity': ['get', 'fillOpacity']
        },
        filter: VISIBLE_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-layer',
        type: 'line',
        source: 'arrows',
        paint: {
            'line-color': ['get', 'lineColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'lineOpacity']
        },
        filter: VISIBLE_FILTER
    });

    addLayerOnce(mapInstance, {
        id: 'arrow-edit-handles-layer',
        type: 'circle',
        source: 'arrow-edit-handles',
        paint: {
            'circle-radius': 8,
            'circle-color': [
                'case',
                ['==', ['get', 'handleType'], 'vertex'], '#ff0000',
                ['==', ['get', 'handleType'], 'midpoint'], '#ffaa00',
                ['==', ['get', 'handleType'], 'width'], '#0066ff',
                ['==', ['get', 'handleType'], 'headLength'], '#00aa00',
                ['==', ['get', 'handleType'], 'airmobile'], '#aa00aa',
                '#000000'
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': [
                'case',
                ['==', ['get', 'handleType'], 'midpoint'], 0.6,
                1.0
            ]
        },
        filter: ['==', '$type', 'Point']
    });
}
