// Path: js/sidebar/panels/vector-info-panel.js

/**
 * @fileoverview Vector tile info panel for displaying feature attributes.
 * Shows properties from vector tile features in a read-only format.
 *
 * @module sidebar/panels/vector-info-panel
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Properties to exclude from display.
 * @constant {string[]}
 */
const PROPERTY_BLACKLIST = [
    'fid', 'id', 'vector_type', 'tilequery',
    'mapbox_clip_start', 'mapbox_clip_end',
    'justificativa_txt_value', 'visivel_value',
    'exibir_linha_rotulo_value', 'suprimir_bandeira_value',
    'posicao_rotulo_value', 'direcao_fixada_value',
    'exibir_ponta_simbologia_value', 'exibir_lado_simbologia_value',
    'label_x', 'label_y', 'length_otf', 'texto_edicao',
    'simb_rot', 'observacao'
];

/**
 * Property suffix patterns to exclude.
 * @constant {string[]}
 */
const BLACKLIST_SUFFIXES = ['_code'];

// ============================================================================
// PROPERTY FORMATTING
// ============================================================================

/**
 * Formats a property key for display.
 *
 * @param {string} key - Property key
 * @returns {string} Formatted key
 */
function formatPropertyKey(key) {
    let displayKey = key.endsWith('_value') ? key.slice(0, -6) : key;
    displayKey = displayKey.replace(/_/g, ' ');
    if (displayKey.startsWith('identificador')) {
        displayKey = displayKey.substring('identificador'.length);
    }
    return displayKey;
}

/**
 * Formats a property value for display.
 *
 * @param {*} value - Property value
 * @returns {string} Formatted value
 */
function formatPropertyValue(value) {
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        const formattedString = value
            .slice(1, -1)
            .replace(/"/g, '')
            .replace(/,/g, ', ');
        return formattedString || '-';
    }
    return value;
}

/**
 * Checks if a property should be excluded from display.
 *
 * @param {string} key - Property key
 * @returns {boolean} True if should be excluded
 */
function shouldExcludeProperty(key) {
    if (PROPERTY_BLACKLIST.includes(key)) {
        return true;
    }
    return BLACKLIST_SUFFIXES.some(suffix => key.endsWith(suffix));
}

// ============================================================================
// PANEL CONTENT CREATION
// ============================================================================

/**
 * Creates vector info panel content.
 *
 * @param {Object} options - Options
 * @param {Object} options.feature - Vector tile feature
 * @param {string} options.title - Display title
 * @returns {{ element: HTMLElement, cleanup: Function, title: string }}
 */
export function createVectorInfoPanelContent({ feature, title }) {
    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'vector-info-panel-content';

    // Build the properties list
    const propertiesList = document.createElement('ul');
    propertiesList.className = 'vector-info-properties';
    propertiesList.style.cssText = `
        list-style: none;
        padding: 0;
        margin: 0;
    `;

    for (const [key, value] of Object.entries(feature.properties)) {
        if (shouldExcludeProperty(key)) {
            continue;
        }

        const displayKey = formatPropertyKey(key);
        const displayValue = formatPropertyValue(value);

        const listItem = document.createElement('li');
        listItem.style.cssText = `
            padding: var(--space-2) 0;
            border-bottom: 1px solid var(--border-color);
            font-size: var(--font-size-sm);
        `;
        listItem.innerHTML = `<strong style="color: var(--gray-600);">${displayKey}:</strong> <span style="color: var(--gray-800);">${displayValue}</span>`;
        propertiesList.appendChild(listItem);
    }

    if (propertiesList.children.length > 0) {
        contentWrapper.appendChild(propertiesList);
    } else {
        const noPropertiesMsg = document.createElement('p');
        noPropertiesMsg.textContent = 'Feição sem atributos';
        noPropertiesMsg.style.cssText = 'color: var(--gray-500); text-align: center; padding: var(--space-4);';
        contentWrapper.appendChild(noPropertiesMsg);
    }

    return {
        element: contentWrapper,
        cleanup: () => {},
        title: `Atributos: ${title}`
    };
}
