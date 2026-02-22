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

    models3d: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20.5 7.27783L12 12.0001M12 12.0001L3.49997 7.27783M12 12.0001L12 21.5001M21 16.0586V7.94153C21 7.59889 21 7.42757 20.9495 7.27477C20.9049 7.13959 20.8318 7.01551 20.7354 6.91082C20.6263 6.79248 20.4766 6.70928 20.177 6.54288L12.777 2.43177C12.4934 2.27421 12.3516 2.19543 12.2015 2.16454C12.0685 2.13721 11.9315 2.13721 11.7986 2.16454C11.6484 2.19543 11.5066 2.27421 11.223 2.43177L3.82297 6.54288C3.52345 6.70928 3.37369 6.79248 3.26463 6.91082C3.16816 7.01551 3.09515 7.13959 3.05048 7.27477C3 7.42757 3 7.59889 3 7.94153V16.0586C3 16.4013 3 16.5726 3.05048 16.7254C3.09515 16.8606 3.16816 16.9847 3.26463 17.0893C3.37369 17.2077 3.52345 17.2909 3.82297 17.4573L11.223 21.5684C11.5066 21.726 11.6484 21.8047 11.7986 21.8356C11.9315 21.863 12.0685 21.863 12.2015 21.8356C12.3516 21.8047 12.4934 21.726 12.777 21.5684L20.177 17.4573C20.4766 17.2909 20.6263 17.2077 20.7354 17.0893C20.8318 16.9847 20.9049 16.8606 20.9495 16.7254C21 16.5726 21 16.4013 21 16.0586Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    panorama: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 15 15" fill="none"><path d="M4.5 11.5H4C4 11.7761 4.22386 12 4.5 12V11.5ZM10.5 11.5V12C10.7761 12 11 11.7761 11 11.5H10.5ZM4.5 12H10.5V11H4.5V12ZM11 11.5V9.5H10V11.5H11ZM4 9.5V11.5H5V9.5H4ZM7.5 6C5.567 6 4 7.567 4 9.5H5C5 8.11929 6.11929 7 7.5 7V6ZM11 9.5C11 7.567 9.433 6 7.5 6V7C8.88071 7 10 8.11929 10 9.5H11ZM14 11.5C14 11.7451 13.8862 12.0204 13.594 12.3165C13.2997 12.6147 12.8491 12.9061 12.2528 13.1617C11.0619 13.6721 9.3819 14 7.5 14V15C9.48409 15 11.3041 14.6563 12.6467 14.0808C13.3171 13.7935 13.8916 13.4385 14.3058 13.0189C14.722 12.5971 15 12.0833 15 11.5H14ZM7.5 14C5.6181 14 3.93808 13.6721 2.74721 13.1617C2.15089 12.9061 1.70026 12.6147 1.40597 12.3165C1.1138 12.0204 1 11.7451 1 11.5H0C0 12.0833 0.27795 12.5971 0.694221 13.0189C1.10837 13.4385 1.68286 13.7935 2.35329 14.0808C3.69593 14.6563 5.51591 15 7.5 15V14ZM1 11.5C1 11.258 1.1108 10.9868 1.39448 10.6952C1.68043 10.4012 2.11881 10.1128 2.70035 9.85849L2.29965 8.94229C1.644 9.22903 1.08238 9.58178 0.677627 9.99794C0.270611 10.4164 0 10.9245 0 11.5H1ZM12.2996 9.85849C12.8812 10.1128 13.3196 10.4012 13.6055 10.6952C13.8892 10.9868 14 11.258 14 11.5H15C15 10.9245 14.7294 10.4164 14.3224 9.99794C13.9176 9.58178 13.356 9.22903 12.7004 8.94229L12.2996 9.85849ZM7.5 4C6.67157 4 6 3.32843 6 2.5H5C5 3.88071 6.11929 5 7.5 5V4ZM9 2.5C9 3.32843 8.32843 4 7.5 4V5C8.88071 5 10 3.88071 10 2.5H9ZM7.5 1C8.32843 1 9 1.67157 9 2.5H10C10 1.11929 8.88071 0 7.5 0V1ZM7.5 0C6.11929 0 5 1.11929 5 2.5H6C6 1.67157 6.67157 1 7.5 1V0Z" fill="currentColor"/></svg>`,

    // Navigation icons
    zoomIn: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    zoomOut: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,

    fullscreen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

    fullscreenExit: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

    location: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/></svg>`,

    compass: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
        <text x="12" y="5" text-anchor="middle" font-size="5" font-weight="bold" font-family="Arial, sans-serif">N</text>
        <path d="M12 6L16 21L12 17L8 21L12 6Z"/>
    </svg>`,
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
