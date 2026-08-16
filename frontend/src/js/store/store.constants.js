// Path: js/store/store.constants.js

/**
 * @fileoverview Store constants and feature type mappings.
 *
 * The six feature-type constants below are DERIVED, one pass each, from
 * `feature-type.registry.js`. They keep the exact names, shapes and key order they had
 * when they were written out by hand, so no consumer changed: what changed is that a type
 * is now born in ONE place. Do not add a type here. Add a row there.
 *
 * The import is relative and the registry has zero imports of its own, which is what keeps
 * this module loadable in plain node with no alias resolution.
 */

import { FEATURE_TYPE_REGISTRY } from './feature-type.registry.js';

/** @constant {string} */
export const DEFAULT_MAP_NAME = 'Principal';

/**
 * Builds a frozen object from the registry rows a predicate accepts. Registry order is
 * preserved, which is what makes the derived key order identical to the hand-written one.
 * @param {(row: Object) => boolean} accepts
 * @param {(row: Object) => *} value
 * @returns {Object}
 */
function mapFromRegistry(accepts, value) {
    const out = {};
    for (const row of FEATURE_TYPE_REGISTRY) {
        if (accepts(row)) out[row.type] = value(row);
    }
    return Object.freeze(out);
}

/**
 * Canonical list of all SELECTABLE feature source types.
 * Order: drawing tools, military tools, analysis tools.
 * Excludes the processing OUTPUT types, which are drawn but never selected by box.
 * @constant {string[]}
 */
const SOURCE_TYPES = Object.freeze(
    FEATURE_TYPE_REGISTRY.filter(row => row.selectable).map(row => row.type)
);

/**
 * Mapping of feature source types to their icon paths.
 * A type with no icon (the processing outputs) is absent, exactly as before.
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_ICONS = mapFromRegistry(row => row.icon !== null, row => row.icon);

/**
 * Mapping of source types (singular) to storage types (plural, and irregular:
 * `sector` -> `setores`, `boundary` -> `boundarys`). The processing OUTPUT types map to
 * the source name verbatim (NOT `source + 's'`): without them, getStorageTypeFromSource
 * fell back to 'processed_loss'/'processed_visibilitys', so a synced processing result
 * landed in a phantom bucket on the receiving peer and never rendered.
 * @constant {Object<string, string>}
 */
export const FEATURE_TYPE_MAPPINGS = mapFromRegistry(() => true, row => row.storage);

/**
 * Display names for feature types (in Portuguese).
 * A type with no label (the processing outputs) is absent, exactly as before: adding one
 * would make the analysis outputs show up in the feature tab, the legend and the selection.
 * @constant {Object<string, string>}
 */
export const FEATURE_DISPLAY_NAMES = mapFromRegistry(row => row.label !== null, row => row.label);

/** @constant {string[]} */
export const UNCOPYABLE_FEATURE_TYPES = Object.freeze(
    FEATURE_TYPE_REGISTRY.filter(row => !row.copiable).map(row => row.type)
);

/** @constant {string[]} */
export const IMAGE_RESOURCE_FEATURE_TYPES = Object.freeze(
    FEATURE_TYPE_REGISTRY.filter(row => row.imageResource).map(row => row.type)
);

// Pre-built reverse lookup: storage type -> source type
const STORAGE_TO_SOURCE = Object.freeze(
    Object.fromEntries(
        Object.entries(FEATURE_TYPE_MAPPINGS).map(([src, storage]) => [storage, src])
    )
);

const ALL_STORAGE_TYPES = Object.freeze(Object.values(FEATURE_TYPE_MAPPINGS));

// ===== UTILITY FUNCTIONS =====

/**
 * Gets the storage type (plural) for a feature source type.
 * @param {string} sourceType - e.g. 'point'
 * @returns {string} e.g. 'points'
 */
export function getStorageTypeFromSource(sourceType) {
    return FEATURE_TYPE_MAPPINGS[sourceType] || `${sourceType}s`;
}

/**
 * Gets the source type (singular) from a storage type.
 * @param {string} storageType - e.g. 'points'
 * @returns {string} e.g. 'point'
 */
export function getSourceTypeFromStorage(storageType) {
    return STORAGE_TO_SOURCE[storageType]
        || (storageType.endsWith('s') ? storageType.slice(0, -1) : storageType);
}

/** @param {string} sourceType @returns {string|undefined} */
export function getFeatureIcon(sourceType) {
    return FEATURE_TYPE_ICONS[sourceType];
}

/** @param {string} sourceType @returns {string} */
export function getFeatureDisplayName(sourceType) {
    return FEATURE_DISPLAY_NAMES[sourceType] || 'Feição';
}

/** @param {string} storageType @returns {string} */
export function getFeatureDisplayNameFromStorage(storageType) {
    return getFeatureDisplayName(getSourceTypeFromStorage(storageType));
}

/** @param {string} storageType @returns {string|undefined} */
export function getFeatureIconFromStorage(storageType) {
    return getFeatureIcon(getSourceTypeFromStorage(storageType));
}

/** @returns {string[]} */
export function getAllStorageTypes() {
    return ALL_STORAGE_TYPES;
}

/** @param {string} sourceType @returns {boolean} */
export function isUncopyableFeatureType(sourceType) {
    return UNCOPYABLE_FEATURE_TYPES.includes(sourceType);
}

/** @param {string} sourceType @returns {boolean} */
export function hasImageResource(sourceType) {
    return IMAGE_RESOURCE_FEATURE_TYPES.includes(sourceType);
}

/** @returns {Object} Selection control configuration for all feature types. */
export function getSelectionControlConfig() {
    const config = {};
    for (const sourceType of SOURCE_TYPES) {
        config[sourceType] = {
            sourceNames: [getStorageTypeFromSource(sourceType)]
        };
    }
    return config;
}
