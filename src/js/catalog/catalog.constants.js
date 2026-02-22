// Path: js/catalog/catalog.constants.js

/**
 * @fileoverview Constants and configuration for the Catalog feature.
 * Defines item types, display configurations, and default values.
 */

/**
 * Catalog item types.
 * @readonly
 * @enum {string}
 */
export const CATALOG_ITEM_TYPES = Object.freeze({
    MODEL_3D: 'model_3d',
    PANORAMIC_360: 'panoramic_360',
    HILLSHADE: 'hillshade',
    ANALYSIS_LAYER: 'analysis_layer',
    DATA_LAYER: 'data_layer'
});

/**
 * Icons for each catalog item type.
 * @readonly
 */
export const CATALOG_ICONS = Object.freeze({
    // 3D Model - cube icon
    [CATALOG_ITEM_TYPES.MODEL_3D]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,

    // Panoramic 360 - aperture icon
    [CATALOG_ITEM_TYPES.PANORAMIC_360]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/></svg>`,

    // Hillshade - mountain icon
    [CATALOG_ITEM_TYPES.HILLSHADE]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,

    // Analysis Layer - layers icon
    [CATALOG_ITEM_TYPES.ANALYSIS_LAYER]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,

    // Data Layer - database/grid icon
    [CATALOG_ITEM_TYPES.DATA_LAYER]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`
});

/**
 * Display configuration for each catalog item type.
 * @readonly
 */
export const CATALOG_TYPE_CONFIG = Object.freeze({
    [CATALOG_ITEM_TYPES.MODEL_3D]: {
        label: 'Modelos 3D',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.MODEL_3D],
        color: '#508D4E',
        hasDate: true,
        hasLocation: true
    },
    [CATALOG_ITEM_TYPES.PANORAMIC_360]: {
        label: 'Imagens 360°',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.PANORAMIC_360],
        color: '#508D4E',
        hasDate: true,
        hasLocation: true
    },
    [CATALOG_ITEM_TYPES.HILLSHADE]: {
        label: 'Sombreamento',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.HILLSHADE],
        color: '#508D4E',
        hasDate: false,
        hasLocation: false,
        // Hillshade will be shown in the Analysis filter in the modal
        showInFilter: false
    },
    [CATALOG_ITEM_TYPES.ANALYSIS_LAYER]: {
        label: 'Análise',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.ANALYSIS_LAYER],
        color: '#508D4E',
        hasDate: false,
        hasLocation: true,
        // This filter includes both analysis layers AND hillshade
        includesHillshade: true
    },
    [CATALOG_ITEM_TYPES.DATA_LAYER]: {
        label: 'Dados',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.DATA_LAYER],
        color: '#508D4E',
        hasDate: false,
        hasLocation: false
    }
});

/**
 * Filter types shown in the modal sidebar.
 * Hillshade is hidden but grouped with Analysis.
 * @readonly
 */
export const CATALOG_MODAL_FILTERS = Object.freeze([
    CATALOG_ITEM_TYPES.MODEL_3D,
    CATALOG_ITEM_TYPES.PANORAMIC_360,
    CATALOG_ITEM_TYPES.ANALYSIS_LAYER,
    CATALOG_ITEM_TYPES.DATA_LAYER
]);

/**
 * Placeholder SVG data URIs for missing thumbnails.
 * @readonly
 */
export const DEFAULT_THUMBNAILS = Object.freeze({
    [CATALOG_ITEM_TYPES.MODEL_3D]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <path d="M100 30 L130 50 L130 80 L100 100 L70 80 L70 50 Z" fill="none" stroke="#508D4E" stroke-width="2"/>
            <path d="M100 30 L100 60 L70 50" fill="none" stroke="#508D4E" stroke-width="2"/>
            <path d="M100 60 L130 50" fill="none" stroke="#508D4E" stroke-width="2"/>
            <path d="M100 60 L100 100" fill="none" stroke="#508D4E" stroke-width="2"/>
        </svg>
    `),
    [CATALOG_ITEM_TYPES.PANORAMIC_360]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <circle cx="100" cy="60" r="35" fill="none" stroke="#0d6efd" stroke-width="2"/>
            <line x1="100" y1="25" x2="100" y2="95" stroke="#0d6efd" stroke-width="1"/>
            <line x1="65" y1="60" x2="135" y2="60" stroke="#0d6efd" stroke-width="1"/>
            <ellipse cx="100" cy="60" rx="35" ry="15" fill="none" stroke="#0d6efd" stroke-width="1"/>
        </svg>
    `),
    [CATALOG_ITEM_TYPES.HILLSHADE]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <path d="M30 90 L70 40 L90 60 L130 25 L170 90 Z" fill="none" stroke="#6b7280" stroke-width="2"/>
            <circle cx="160" cy="30" r="12" fill="none" stroke="#6b7280" stroke-width="2"/>
        </svg>
    `),
    [CATALOG_ITEM_TYPES.ANALYSIS_LAYER]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <polygon points="100,25 150,45 100,65 50,45" fill="none" stroke="#f59e0b" stroke-width="2"/>
            <polygon points="100,45 150,65 100,85 50,65" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.7"/>
            <polygon points="100,65 150,85 100,105 50,85" fill="none" stroke="#f59e0b" stroke-width="2" opacity="0.4"/>
        </svg>
    `),
    [CATALOG_ITEM_TYPES.DATA_LAYER]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <rect x="40" y="25" width="120" height="70" fill="none" stroke="#508D4E" stroke-width="2" rx="4"/>
            <line x1="40" y1="48" x2="160" y2="48" stroke="#508D4E" stroke-width="1.5"/>
            <line x1="40" y1="72" x2="160" y2="72" stroke="#508D4E" stroke-width="1.5"/>
            <line x1="80" y1="25" x2="80" y2="95" stroke="#508D4E" stroke-width="1.5"/>
            <line x1="120" y1="25" x2="120" y2="95" stroke="#508D4E" stroke-width="1.5"/>
        </svg>
    `)
});

/**
 * Catalog modal icon SVG.
 * @readonly
 */
export const CATALOG_MODAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;

/**
 * Chip configuration for catalog button.
 * @readonly
 */
export const CATALOG_CHIP_CONFIG = Object.freeze({
    id: 'catalog',
    label: 'Catálogo',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`
});

/**
 * Additional icons used in catalog components.
 * @readonly
 */
export const CATALOG_UI_ICONS = Object.freeze({
    SEARCH: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    CALENDAR: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    MAP_PIN: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    CHEVRON_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    VISIBLE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    HIDDEN: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    REMOVE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    EMPTY: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
});
