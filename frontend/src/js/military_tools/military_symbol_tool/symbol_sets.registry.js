// Path: js/military_tools/military_symbol_tool/symbol_sets.registry.js

/**
 * @fileoverview On-demand registry for the eleven symbol-set tables.
 *
 * The tables only serve the symbol SELECTOR (the comboboxes of the "Configurar
 * Símbolo Militar" modal). The symbol GENERATOR needs none of them: it builds the
 * SIDC from the feature properties and asks the Brazilian catalog
 * (`brazilian_extension_catalog.js`) about extensions. So the tables are loaded by
 * `loadSymbolSets()` when the modal opens, not at boot, and the map keeps drawing
 * the symbols of an already-saved project with the tables never fetched.
 *
 * The accessors are synchronous on purpose (the form builds its comboboxes in one
 * synchronous pass) and THROW when the tables are not loaded yet. Returning an
 * empty list instead would render a modal with silently empty comboboxes, which is
 * the failure mode that hides.
 */

/** @type {Object<string, Object>|null} Loaded tables, keyed by symbol set code. */
let symbolSetTables = null;

/** @type {Promise<Object>|null} In-flight load, shared by concurrent callers. */
let pendingLoad = null;

/**
 * Load the symbol-set tables (idempotent, single in-flight request).
 * @returns {Promise<Object<string, Object>>} Tables keyed by symbol set code
 */
export async function loadSymbolSets() {
    if (symbolSetTables) {
        return symbolSetTables;
    }

    if (!pendingLoad) {
        pendingLoad = import('./data/index.js')
            .then((module) => {
                symbolSetTables = module.SYMBOL_SET_TABLES;
                pendingLoad = null;
                return symbolSetTables;
            })
            .catch((error) => {
                pendingLoad = null;
                throw error;
            });
    }

    return pendingLoad;
}

/**
 * Check whether the tables are already in memory.
 * @returns {boolean} True when `loadSymbolSets()` has resolved
 */
export function areSymbolSetsLoaded() {
    return symbolSetTables !== null;
}

/**
 * @returns {Object<string, Object>} Loaded tables
 * @throws {Error} When the tables were not loaded yet
 */
function requireSymbolSets() {
    if (!symbolSetTables) {
        throw new Error('Symbol set tables not loaded: await loadSymbolSets() before reading them');
    }
    return symbolSetTables;
}

/**
 * Get symbol set data by code
 * @param {string} symbolSetCode - Symbol set code (e.g., "01", "10")
 * @returns {Object|null} Symbol set data or null if not found
 */
export function getSymbolSetData(symbolSetCode) {
    return requireSymbolSets()[symbolSetCode] || null;
}

/**
 * Get main icons for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of main icon objects
 */
export function getMainIcons(symbolSetCode) {
    const symbolSet = requireSymbolSets()[symbolSetCode];
    return symbolSet ? symbolSet["main icon"] : [];
}

/**
 * Get modifier 1 options for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of modifier 1 objects
 */
export function getModifier1(symbolSetCode) {
    const symbolSet = requireSymbolSets()[symbolSetCode];
    return symbolSet ? symbolSet["modifier 1"] : [];
}

/**
 * Get modifier 2 options for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of modifier 2 objects
 */
export function getModifier2(symbolSetCode) {
    const symbolSet = requireSymbolSets()[symbolSetCode];
    return symbolSet ? symbolSet["modifier 2"] : [];
}

/**
 * Check if a symbol set code is valid
 * @param {string} symbolSetCode - Symbol set code to validate
 * @returns {boolean} True if valid
 */
export function isValidSymbolSet(symbolSetCode) {
    return Object.prototype.hasOwnProperty.call(requireSymbolSets(), symbolSetCode);
}

/**
 * Get list of all available symbol set codes
 * @returns {Array<string>} Array of symbol set codes
 */
export function getAllSymbolSetCodes() {
    return Object.keys(requireSymbolSets());
}
