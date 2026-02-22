// Path: js/sidebar/sidebar.constants.js

/**
 * @fileoverview Constants for the sidebar component.
 * Includes dimensions, tab configuration, and SVG icons.
 */

/** Sidebar dimension constants */
export const SIDEBAR_DIMENSIONS = {
    COLLAPSED_WIDTH: 56,
    PANEL_WIDTH: 320,
    TOTAL_EXPANDED_WIDTH: 376, // 56 + 320
    LOGO_SIZE: 40,
    NAV_BUTTON_SIZE: 40,
    RECENT_MAP_SIZE: 40,
};

/** Tab identifiers */
export const SIDEBAR_TABS = {
    MAPAS: 'mapas',
    CAMADAS: 'camadas',
    BRIEFINGS: 'briefings',
    PROCESSAMENTO: 'processamento',
    IMPORTAR: 'importar',
    EXPORTAR: 'exportar',
};

/** Tab configuration with labels and icons */
export const TAB_CONFIG = {
    [SIDEBAR_TABS.MAPAS]: {
        id: SIDEBAR_TABS.MAPAS,
        label: 'Mapas',
        title: 'EBGeo - Mapas',
    },
    [SIDEBAR_TABS.CAMADAS]: {
        id: SIDEBAR_TABS.CAMADAS,
        label: 'Camadas',
        title: 'EBGeo - Camadas',
    },
    [SIDEBAR_TABS.IMPORTAR]: {
        id: SIDEBAR_TABS.IMPORTAR,
        label: 'Importar',
        title: 'EBGeo - Importar',
    },
    [SIDEBAR_TABS.EXPORTAR]: {
        id: SIDEBAR_TABS.EXPORTAR,
        label: 'Exportar',
        title: 'EBGeo - Exportar',
    },
    [SIDEBAR_TABS.BRIEFINGS]: {
        id: SIDEBAR_TABS.BRIEFINGS,
        label: 'Briefings',
        title: 'EBGeo - Briefings',
    },
    [SIDEBAR_TABS.PROCESSAMENTO]: {
        id: SIDEBAR_TABS.PROCESSAMENTO,
        label: 'Análise',
        title: 'EBGeo - Análise',
    },
};

/**
 * SVG icons used in the sidebar.
 * All icons are 20x20 viewBox for consistency.
 */
export const SIDEBAR_ICONS = {
    // Navigation icons
    map: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,

    layers: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,

    upload: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,

    download: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,

    presentation: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,

    processing: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,

    // Panel icons
    chevronLeft: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,

    // Action icons
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};
