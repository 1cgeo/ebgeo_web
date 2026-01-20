// Path: js/toolbar/toolbar.constants.js

/**
 * @fileoverview Toolbar configuration constants.
 * Defines tool groups, icons, and shortcuts.
 */

/**
 * SVG icons for toolbar tools.
 */
export const TOOLBAR_ICONS = {
    // Group icons
    draw: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`,

    military: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,

    analysis: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,

    // Tool icons
    select: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>`,

    point: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg>`,

    line: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>`,

    polygon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>`,

    rectangle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`,

    circle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`,

    ellipse: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>`,

    text: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,

    image: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,

    brush: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>`,

    militarySymbol: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18"/><circle cx="12" cy="12" r="4"/></svg>`,

    coordination: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/></svg>`,

    arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,

    boundary: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3z" stroke-dasharray="4 2"/></svg>`,

    occupiedFront: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18"/><path d="M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`,

    los: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7"/></svg>`,

    visibility: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,

    featureInfo: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
};

/**
 * Tool group configurations.
 */
export const TOOL_GROUPS = {
    draw: {
        id: 'draw',
        label: 'Desenho',
        icon: TOOLBAR_ICONS.draw,
        layout: 'grid', // 3x3 grid (9 tools)
        tools: [
            { id: 'point', label: 'Ponto', icon: TOOLBAR_ICONS.point, shortcut: 'P', controlKey: 'pointControl' },
            { id: 'line', label: 'Linha', icon: TOOLBAR_ICONS.line, shortcut: 'L', controlKey: 'lineControl' },
            { id: 'polygon', label: 'Polígono', icon: TOOLBAR_ICONS.polygon, shortcut: 'A', controlKey: 'polygonControl' },
            { id: 'rectangle', label: 'Retângulo', icon: TOOLBAR_ICONS.rectangle, shortcut: 'R', controlKey: 'rectangleControl' },
            { id: 'circle', label: 'Círculo', icon: TOOLBAR_ICONS.circle, shortcut: 'C', controlKey: 'circleControl' },
            { id: 'ellipse', label: 'Elipse', icon: TOOLBAR_ICONS.ellipse, shortcut: 'E', controlKey: 'ellipseControl' },
            { id: 'text', label: 'Texto', icon: TOOLBAR_ICONS.text, shortcut: 'T', controlKey: 'textControl' },
            { id: 'image', label: 'Imagem', icon: TOOLBAR_ICONS.image, shortcut: 'I', controlKey: 'imageControl' },
            { id: 'brush', label: 'Pincel', icon: TOOLBAR_ICONS.brush, shortcut: 'B', controlKey: 'brushControl' },
        ],
    },
    military: {
        id: 'military',
        label: 'Militar',
        icon: TOOLBAR_ICONS.military,
        layout: 'list',
        tools: [
            { id: 'militarySymbol', label: 'Símbolo Militar', icon: TOOLBAR_ICONS.militarySymbol, shortcut: 'M', controlKey: 'militarySymbolControl' },
            { id: 'coordination', label: 'Medida de Coordenação', icon: TOOLBAR_ICONS.coordination, shortcut: 'K', controlKey: 'coordinationMeasureControl' },
            { id: 'arrow', label: 'Seta', icon: TOOLBAR_ICONS.arrow, shortcut: 'S', controlKey: 'arrowControl' },
            { id: 'boundary', label: 'Linha de Limite', icon: TOOLBAR_ICONS.boundary, shortcut: 'D', controlKey: 'boundaryControl' },
            { id: 'occupiedFront', label: 'Frente Ocupada', icon: TOOLBAR_ICONS.occupiedFront, shortcut: 'F', controlKey: 'occupiedFrontControl' },
        ],
    },
    analysis: {
        id: 'analysis',
        label: 'Análise',
        icon: TOOLBAR_ICONS.analysis,
        layout: 'list',
        tools: [
            { id: 'los', label: 'Linha de Visada', icon: TOOLBAR_ICONS.los, shortcut: 'O', controlKey: 'losControl', requiresTerrain: true },
            { id: 'visibility', label: 'Análise de Visibilidade', icon: TOOLBAR_ICONS.visibility, shortcut: 'V', controlKey: 'visibilityControl', requiresTerrain: true },
        ],
    },
};

/**
 * Standalone tools (not in groups).
 */
export const STANDALONE_TOOLS = [
    { id: 'featureInfo', label: 'Informações da Carta', icon: TOOLBAR_ICONS.featureInfo, shortcut: 'N', controlKey: 'vectorTileInfoControl' },
    { id: 'rectangleSelection', label: 'Selecionar', icon: TOOLBAR_ICONS.select, shortcut: 'Q', controlKey: 'rectangleSelectionControl' },
];
