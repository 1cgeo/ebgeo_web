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

/**
 * SVG icons for the selector.
 */
export const SELECTOR_ICONS = {
    expand: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`,

    collapse: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,

    layers: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
};

/**
 * Selector dimensions.
 */
export const SELECTOR_DIMENSIONS = {
    thumbnailWidth: 80,
    thumbnailHeight: 56,
    gap: 8,
    padding: 8,
    borderRadius: 8,
};
