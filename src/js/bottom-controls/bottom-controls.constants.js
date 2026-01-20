// Path: js/bottom-controls/bottom-controls.constants.js

/**
 * @fileoverview Constants for bottom controls.
 * Defines icons and configurations for feature toggles and navigation.
 */

/**
 * SVG icons for bottom controls.
 */
export const BOTTOM_CONTROL_ICONS = {
    // Feature toggle icons
    terrain: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`,

    models3d: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,

    panorama: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`,

    // Navigation icons
    zoomIn: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    zoomOut: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    fullscreen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

    fullscreenExit: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

    location: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>`,

    compass: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
};

/**
 * Feature toggle configurations.
 * Order: Modelos 3D, Imagens 360°, Terreno (top to bottom on right side)
 */
export const FEATURE_TOGGLES = {
    models3d: {
        id: 'models3d',
        label: 'Modelos 3D',
        icon: BOTTOM_CONTROL_ICONS.models3d,
        configKey: 'features.map_3d',
        controlKey: 'modelsViewerControl',
    },
    panorama: {
        id: 'panorama',
        label: 'Imagens 360°',
        icon: BOTTOM_CONTROL_ICONS.panorama,
        configKey: 'features.imagens_panoramicas',
        controlKey: 'streetViewControl',
    },
    terrain: {
        id: 'terrain',
        label: 'Terreno',
        icon: BOTTOM_CONTROL_ICONS.terrain,
        configKey: 'map2d.terrainSource', // Check config for availability
        controlKey: 'terrainControl',
    },
};

/**
 * Navigation button configurations.
 */
export const NAV_BUTTONS = {
    zoomIn: {
        id: 'zoom-in',
        label: 'Aproximar',
        icon: BOTTOM_CONTROL_ICONS.zoomIn,
        action: 'zoomIn',
    },
    zoomOut: {
        id: 'zoom-out',
        label: 'Afastar',
        icon: BOTTOM_CONTROL_ICONS.zoomOut,
        action: 'zoomOut',
    },
    fullscreen: {
        id: 'fullscreen',
        label: 'Tela cheia',
        icon: BOTTOM_CONTROL_ICONS.fullscreen,
        iconActive: BOTTOM_CONTROL_ICONS.fullscreenExit,
        action: 'toggleFullscreen',
    },
    location: {
        id: 'location',
        label: 'Minha localização',
        icon: BOTTOM_CONTROL_ICONS.location,
        action: 'geolocate',
    },
    compass: {
        id: 'compass',
        label: 'Resetar norte',
        icon: BOTTOM_CONTROL_ICONS.compass,
        action: 'resetNorth',
    },
};
