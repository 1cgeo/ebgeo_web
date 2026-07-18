// Path: js/grid/grid-layers.config.js
import config from '../config.js';

/**
 * Scale definitions: [suffix, minzoom, maxzoom]
 */
const SCALES = [
    ['25k', 14, 17],
    ['50k', 13, 14],
    ['100k', 12, 13],
    ['250k', 8, 12],
];

/**
 * Coordinate system definitions.
 * @property {string} key - Key used in GRID_LAYERS lookup ('latlong' | 'utm')
 * @property {string} prefix - Used in source/source-layer names ('4326' | 'utm')
 * @property {boolean} labelIncludesPrefix - Whether label layer IDs include the prefix
 */
const COORD_SYSTEMS = [
    { key: 'latlong', prefix: '4326', labelIncludesPrefix: false },
    { key: 'utm', prefix: 'utm', labelIncludesPrefix: true },
];

const DIRECTIONS = ['vertical', 'horizontal'];

const LINE_PAINT = {
    'line-color': '#241f21',
    'line-width': 1.5,
};

const LABEL_PAINT = {
    'text-color': 'rgba(0, 0, 0, 1)',
    'text-halo-color': 'rgba(255, 255, 255, 0.8)',
    'text-halo-width': 7.5,
    'text-halo-blur': 1.5,
};

/**
 * Derives the line layer ID.
 * latlong: grid_vertical_4326_25k | utm: grid_vertical_utm_25k
 */
function lineLayerId(prefix, dir, scale) {
    return `grid_${dir}_${prefix}_${scale}`;
}

/**
 * Derives the label layer ID.
 * latlong: grid_label_vertical_25k (no '4326')
 * utm:     grid_label_vertical_utm_25k
 */
function labelLayerId(prefix, dir, scale, includePrefix) {
    if (includePrefix) {
        return `grid_label_${dir}_${prefix}_${scale}`;
    }
    return `grid_label_${dir}_${scale}`;
}

/**
 * Builds the GRID_LAYERS lookup: { latlong: [...layerIds], utm: [...layerIds] }
 */
function buildGridLayers() {
    const result = { latlong: [], utm: [] };

    for (const sys of COORD_SYSTEMS) {
        for (const [scale] of SCALES) {
            for (const dir of DIRECTIONS) {
                result[sys.key].push(
                    lineLayerId(sys.prefix, dir, scale),
                    labelLayerId(sys.prefix, dir, scale, sys.labelIncludesPrefix),
                );
            }
        }
    }

    return result;
}

export const GRID_LAYERS = buildGridLayers();

/**
 * Builds label layout properties for a direction.
 * @param {string} direction - 'vertical' or 'horizontal'
 * @returns {Object} MapLibre layout properties
 */
function buildLabelLayout(direction) {
    return {
        'text-field': direction === 'vertical' ? '{right}' : '{top}',
        'symbol-placement': 'line',
        'symbol-spacing': direction === 'vertical' ? 700 : 750,
        'text-font': ['Noto Sans Bold'],
        'text-size': 16,
        'symbol-avoid-edges': true,
        'text-rotation-alignment': 'map',
        'text-letter-spacing': 0.15,
        'text-keep-upright': true,
        'visibility': 'none',
    };
}

/**
 * Adds a line + label layer pair to the map if not already present.
 * @param {Object} map - MapLibre map instance
 * @param {Object} params
 */
function addGridLayerPair(map, { lineId, labelId, source, sourceLayer, direction, minzoom, maxzoom }) {
    if (!map.getLayer(lineId)) {
        map.addLayer({
            id: lineId,
            type: 'line',
            source,
            'source-layer': sourceLayer,
            layout: {
                'line-cap': 'round',
                'line-join': 'round',
                'visibility': 'none',
            },
            paint: LINE_PAINT,
            minzoom,
            maxzoom,
        });
    }

    if (!map.getLayer(labelId)) {
        map.addLayer({
            id: labelId,
            type: 'symbol',
            metadata: { 'IHM:overlay': true },
            source,
            'source-layer': sourceLayer,
            layout: buildLabelLayout(direction),
            paint: LABEL_PAINT,
            minzoom,
            maxzoom,
        });
    }
}

/**
 * Initializes all grid sources and layers on the map.
 * @param {Object} map - MapLibre map instance
 */
export function initGridLayers(map) {
    const baseUrl = config.services.tileServerUrl;

    // Add vector tile sources
    for (const sys of COORD_SYSTEMS) {
        for (const [scale] of SCALES) {
            const sourceName = `grid_${sys.prefix}_${scale}`;
            if (!map.getSource(sourceName)) {
                map.addSource(sourceName, {
                    type: 'vector',
                    url: `${baseUrl}/${sourceName}`,
                });
            }
        }
    }

    // Add line + label layer pairs
    for (const sys of COORD_SYSTEMS) {
        for (const [scale, minzoom, maxzoom] of SCALES) {
            const source = `grid_${sys.prefix}_${scale}`;

            for (const dir of DIRECTIONS) {
                const sourceLayer = `grid_linha_${sys.prefix}_${dir}_${scale}`;

                addGridLayerPair(map, {
                    lineId: lineLayerId(sys.prefix, dir, scale),
                    labelId: labelLayerId(sys.prefix, dir, scale, sys.labelIncludesPrefix),
                    source,
                    sourceLayer,
                    direction: dir,
                    minzoom,
                    maxzoom,
                });
            }
        }
    }
}
