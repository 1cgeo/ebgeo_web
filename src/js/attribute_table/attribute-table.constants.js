// Path: js/attribute_table/attribute-table.constants.js

/**
 * @fileoverview Constants for the Attribute Table component.
 */

/**
 * Attribute table configuration constants.
 * @constant
 */
export const ATTRIBUTE_TABLE = Object.freeze({
    /** Z-index for the table panel (above floating controls, below modals) */
    Z_INDEX: 48,

    /** Minimum panel height in pixels */
    MIN_HEIGHT: 150,

    /** Maximum panel height as percentage of viewport */
    MAX_HEIGHT_PERCENT: 70,

    /** Default panel height as percentage of viewport */
    DEFAULT_HEIGHT_PERCENT: 35,

    /** Default column widths in pixels */
    COLUMN_WIDTHS: Object.freeze({
        checkbox: 28,
        type: 32,
        name: 150,
        actions: 44,
        attribute: 120,
    }),

    /** Row height in pixels */
    ROW_HEIGHT: 36,

    /** Header height in pixels */
    HEADER_HEIGHT: 44,

    /** Filters bar height in pixels */
    FILTERS_HEIGHT: 40,

    /** Column headers height in pixels */
    COLUMN_HEADERS_HEIGHT: 36,

    /** Debounce time for search input in milliseconds */
    DEBOUNCE_MS: 300,

    /** Debounce time for resize persistence in milliseconds */
    RESIZE_DEBOUNCE_MS: 100,

    /** LocalStorage key prefix for table configurations */
    STORAGE_KEY_PREFIX: 'attributeTable_config_',

    /** Panel states */
    STATES: Object.freeze({
        CLOSED: 'closed',
        MINIMIZED: 'minimized',
        EXPANDED: 'expanded',
    }),

    /** Sort directions */
    SORT_DIRECTIONS: Object.freeze({
        ASC: 'asc',
        DESC: 'desc',
        NONE: null,
    }),

    /** CSS class names */
    CSS_CLASSES: Object.freeze({
        PANEL: 'attribute-table-panel',
        RESIZE_HANDLE: 'attribute-table-resize-handle',
        TOOLBAR: 'attribute-table-toolbar',
        FILTERS: 'attribute-table-filters',
        CONTAINER: 'attribute-table-container',
        TABLE: 'attribute-table',
        HEAD: 'attribute-table-head',
        BODY: 'attribute-table-body',
        ROW: 'attribute-table-row',
        CELL: 'attribute-table-cell',
        CELL_EMPTY: 'attribute-table-cell-empty',
        CELL_EDITING: 'attribute-table-cell-editing',
        SELECTED: 'selected',
        HOVERED: 'hovered',
    }),
});

/**
 * SVG icons used in the attribute table.
 * @constant
 */
export const ATTRIBUTE_TABLE_ICONS = Object.freeze({
    CLOSE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,

    MINIMIZE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,

    MAXIMIZE: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="15 3 21 3 21 9"/>
        <polyline points="9 21 3 21 3 15"/>
        <line x1="21" y1="3" x2="14" y2="10"/>
        <line x1="3" y1="21" x2="10" y2="14"/>
    </svg>`,

    ADD_COLUMN: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,

    ZOOM: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="6"/>
        <path d="m21 21-4.35-4.35"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>`,

    SORT_ASC: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="18 15 12 9 6 15"/>
    </svg>`,

    SORT_DESC: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
    </svg>`,

    DELETE: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>`,

    SEARCH: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`,

    CLEAR: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>`,
});

/**
 * Empty cell placeholder.
 * @constant
 */
export const EMPTY_CELL_PLACEHOLDER = '\u2014'; // Em dash
