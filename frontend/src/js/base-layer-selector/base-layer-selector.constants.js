// Path: js/base-layer-selector/base-layer-selector.constants.js

/**
 * @fileoverview Constants for base layer selector.
 * Layer configurations and thumbnail paths.
 */

/**
 * Layer thumbnail configurations.
 * Thumbnails should be ~80x60px preview images of each layer style.
 */
export const LAYER_THUMBNAILS = {
    'carta-topografica': {
        id: 'carta-topografica',
        label: 'Topográfica',
        shortLabel: 'Topo',
        thumbnail: './images/layers/carta-topografica-thumb.webp',
        // Fallback gradient if image not available
        fallbackGradient: 'linear-gradient(135deg, #f5f5dc 0%, #ddd8c4 100%)',
    },
    'carta-ortoimagem': {
        id: 'carta-ortoimagem',
        label: 'Ortoimagem',
        shortLabel: 'Orto',
        thumbnail: './images/layers/carta-ortoimagem-thumb.webp',
        fallbackGradient: 'linear-gradient(135deg, #4a7c4e 0%, #2d5a3d 100%)',
    },
    'osm': {
        id: 'osm',
        label: 'OpenStreetMap',
        shortLabel: 'OSM',
        thumbnail: './images/layers/osm-thumb.webp',
        fallbackGradient: 'linear-gradient(135deg, #f2efe9 0%, #d4d0c8 100%)',
    },
    'imagens': {
        id: 'imagens',
        label: 'Satélite',
        shortLabel: 'Satélite',
        thumbnail: './images/layers/imagens-thumb.webp',
        fallbackGradient: 'linear-gradient(135deg, #1a3a1a 0%, #0d1f0d 100%)',
    },
    'bdgex': {
        id: 'bdgex',
        label: 'BDGEx',
        shortLabel: 'BDGEx',
        thumbnail: './images/layers/bdgex-thumb.webp',
        fallbackGradient: 'linear-gradient(135deg, #e8e4d8 0%, #c9c5b9 100%)',
    },
};

