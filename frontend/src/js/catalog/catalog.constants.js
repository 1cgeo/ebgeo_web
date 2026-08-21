// Path: js/catalog/catalog.constants.js

/**
 * @fileoverview Constants and configuration for the Catalog feature.
 * Defines item types, display configurations, and default values.
 */

import { Forma3D } from './forma-3d.js';

/**
 * Catalog item types.
 * @readonly
 * @enum {string}
 */
export const CATALOG_ITEM_TYPES = Object.freeze({
    MODEL_3D: 'model_3d',
    // Walk-through (Gaussian splatting) scene. A `tilesets` row carrying the
    // discriminator `viewer: 'firstPerson'`, so it is 3D collection for every
    // gate that matters (the "Mapa 3D" switch, the per-atlas allowlist) while
    // getting its own card badge and its own viewer.
    FIRST_PERSON_SCENE: 'first_person_scene',
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

    // First-person scene - walking figure, the same glyph the purple map pin carries
    [CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11.5" cy="4" r="2.5"/><path d="M11.5 7.5 13.5 13 17 21"/><path d="M13.5 13 7 20"/><path d="M12 8.5 6.5 14"/><path d="M12 8.5 17.5 7"/></svg>`,

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
        hasLocation: true,
        // This filter includes both Cesium tilesets AND first-person scenes
        includesFirstPerson: true
    },
    [CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE]: {
        label: 'Cenas 3D',
        icon: CATALOG_ICONS[CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE],
        color: '#508D4E',
        hasDate: true,
        hasLocation: true,
        // Scenes are shown under the "Modelos 3D" filter (same reasoning as
        // hillshade under "Análise"): a scene is 3D collection, and the Gestor's
        // "Mapa 3D" switch already governs the whole of it.
        showInFilter: false
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
 * Label per 3D SHAPE (`config.forma3d`), which is a FINER axis than the item type above.
 *
 * The two axes answer different questions and neither replaces the other: `CATALOG_ITEM_TYPES`
 * says which section of the catalog an item belongs to (and therefore which allowlist and which
 * filter govern it), while this one says what the item IS. Three shapes share the type
 * `MODEL_3D` and the fourth is `FIRST_PERSON_SCENE`.
 *
 * These are the labels the census requires: a shape added to `FORMAS_3D` with no entry here
 * turns `forma-3d-censo.test.js` red.
 * @readonly
 */
export const FORMA_3D_LABELS = Object.freeze({
    [Forma3D.TILES3D]: 'Tiles 3D',
    [Forma3D.GLB]: 'Modelo isolado',
    [Forma3D.POINTCLOUD]: 'Nuvem de pontos',
    [Forma3D.INDOOR]: 'Cena indoor'
});

/**
 * Icon per 3D shape. Same census rule as the labels above.
 *
 * The point cloud gets a scatter of dots and NOT a variant of the cube: it is drawn by the same
 * loader as a tileset, so a near-identical glyph would leave the two indistinguishable on the
 * card, which is the exact loss this axis exists to repair.
 * @readonly
 */
export const FORMA_3D_ICONS = Object.freeze({
    // Tiles 3D — the cube, the historical 3D glyph
    [Forma3D.TILES3D]: CATALOG_ICONS[CATALOG_ITEM_TYPES.MODEL_3D],

    // Isolated model — a single object on a base plane
    [Forma3D.GLB]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 6 6.5v7L12 17l6-3.5v-7L12 3z"/><path d="M6 6.5 12 10l6-3.5M12 10v7"/><line x1="3" y1="21" x2="21" y2="21"/></svg>`,

    // Point cloud — a scatter of points
    [Forma3D.POINTCLOUD]: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="7" r="1.4"/><circle cx="10" cy="4.5" r="1.4"/><circle cx="15.5" cy="7" r="1.4"/><circle cx="20" cy="10" r="1.4"/><circle cx="4" cy="12.5" r="1.4"/><circle cx="9" cy="11" r="1.4"/><circle cx="14" cy="13" r="1.4"/><circle cx="19" cy="16" r="1.4"/><circle cx="6" cy="18" r="1.4"/><circle cx="11.5" cy="17.5" r="1.4"/><circle cx="16" cy="20" r="1.4"/></svg>`,

    // Indoor scene — the walking figure, the same glyph the scene card already carries
    [Forma3D.INDOOR]: CATALOG_ICONS[CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE]
});

/**
 * Filter types shown in the modal sidebar.
 * Hillshade is hidden but grouped with Analysis; first-person scenes are hidden
 * but grouped with 3D models.
 *
 * The list is also read by the atlas-config "Catálogo" tab
 * (`modals/atlas-settings.modal.js`), which builds one tab per entry from the
 * four `available_*` allowlists. A type added here with no allowlist behind it
 * shows up there as an empty tab, which is why the two grouped types stay out.
 * @readonly
 */
export const CATALOG_MODAL_FILTERS = Object.freeze([
    CATALOG_ITEM_TYPES.MODEL_3D,
    CATALOG_ITEM_TYPES.PANORAMIC_360,
    CATALOG_ITEM_TYPES.ANALYSIS_LAYER,
    CATALOG_ITEM_TYPES.DATA_LAYER
]);

/**
 * Ponte entre o vocabulário do CATÁLOGO e o do eixo de ACESSO A RECURSO.
 *
 * São dois vocabulários distintos e a tradução tem de morar em um lugar só:
 *   - `grupo` é a chave do payload aditivo (`GET /resource-access/visible`), que
 *     é também a chave dos arrays de `config` onde a soma aterrissa;
 *   - `tipo` é o valor do `CHECK` de `resource_grants.resource_type` e o que vai
 *     na URL das rotas de concessão.
 *
 * DUAS AUSÊNCIAS SÃO DELIBERADAS, e nenhuma é esquecimento:
 *   - `HILLSHADE` não é linha de catálogo nenhuma (vem de `config.map2d`), então
 *     não tem marca de acesso e nunca terá cartão privado;
 *   - `FIRST_PERSON_SCENE` está presente e aponta para `tileset` porque uma cena
 *     É uma linha de `tilesets`, distinguida só pelo discriminador `viewer`. O
 *     eixo de acesso enxerga a tabela, não o visualizador.
 * @readonly
 */
export const RESOURCE_ACCESS_BY_CATALOG_TYPE = Object.freeze({
    [CATALOG_ITEM_TYPES.MODEL_3D]: { grupo: 'tilesets', tipo: 'tileset' },
    [CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE]: { grupo: 'tilesets', tipo: 'tileset' },
    [CATALOG_ITEM_TYPES.PANORAMIC_360]: { grupo: 'views360', tipo: 'sv360_project' },
    [CATALOG_ITEM_TYPES.ANALYSIS_LAYER]: { grupo: 'analysisLayers', tipo: 'analysis_layer' },
    [CATALOG_ITEM_TYPES.DATA_LAYER]: { grupo: 'dataLayers', tipo: 'data_layer' },
});

/**
 * Rótulos dos dois níveis de concessão (`resource_grants.grant_level`).
 *
 * A ordem é ASCENDENTE e o primeiro é o padrão do modal: a permissão padrão
 * abaixa, nunca eleva. Dar poder de repassar adiante é um ato explícito.
 * @readonly
 */
export const GRANT_LEVELS = Object.freeze([
    { value: 'view', label: 'Ver' },
    { value: 'view_share', label: 'Ver e compartilhar' },
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
    [CATALOG_ITEM_TYPES.FIRST_PERSON_SCENE]: 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
            <rect fill="#f3f4f6" width="200" height="120"/>
            <rect x="40" y="20" width="120" height="80" fill="none" stroke="#508D4E" stroke-width="2"/>
            <rect x="80" y="45" width="40" height="35" fill="none" stroke="#508D4E" stroke-width="2"/>
            <path d="M40 20 L80 45 M160 20 L120 45 M40 100 L80 80 M160 100 L120 80" fill="none" stroke="#508D4E" stroke-width="1.5"/>
            <circle cx="100" cy="57" r="4" fill="none" stroke="#508D4E" stroke-width="2"/>
            <path d="M100 61 L100 69 L104 77 M100 69 L96 77 M96 65 L104 65" fill="none" stroke="#508D4E" stroke-width="2"/>
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
    EMPTY: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    LOCK: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    SHARE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    PLAY: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
});
