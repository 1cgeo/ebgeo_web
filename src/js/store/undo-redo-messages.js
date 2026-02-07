// Path: js/store/undo-redo-messages.js

/**
 * @module store/undo-redo-messages
 * @description Generates user-facing descriptions for undo/redo operations.
 * @dependencies store.constants
 */

import { getFeatureDisplayNameFromStorage } from './store.constants.js';

/**
 * Generates a human-readable description for an undo or redo action.
 *
 * @param {Object} action - The undo/redo action object from the stack
 * @param {'undo'|'redo'} direction - Whether this is an undo or redo
 * @returns {string} Description in Portuguese
 */
export function describeUndoRedoAction(action, direction) {
    const suffix = direction === 'undo' ? 'desfeita' : 'refeita';
    const suffixMasc = direction === 'undo' ? 'desfeito' : 'refeito';

    switch (action.type) {
        case 'add': {
            const typeName = getFeatureDisplayNameFromStorage(action.featureType);
            const label = _labelWithName(typeName, action.feature);
            return `Criação de ${label} ${suffix}`;
        }

        case 'update': {
            const typeName = getFeatureDisplayNameFromStorage(action.featureType);
            const feature = direction === 'undo' ? action.newFeature : action.oldFeature;
            const label = _labelWithName(typeName, feature);
            return `Edição de ${label} ${suffix}`;
        }

        case 'remove': {
            const typeName = getFeatureDisplayNameFromStorage(action.featureType);
            const label = _labelWithName(typeName, action.feature);
            return `Exclusão de ${label} ${suffix}`;
        }

        case 'removeWithProcessed': {
            const typeName = getFeatureDisplayNameFromStorage(action.mainFeatureType);
            const label = _labelWithName(typeName, action.mainFeature);
            return `Exclusão de ${label} ${suffix}`;
        }

        case 'addMultiple': {
            const totalCount = Object.values(action.features)
                .reduce((sum, arr) => sum + arr.length, 0);
            const typeKeys = Object.keys(action.features);
            if (typeKeys.length === 1) {
                const typeName = getFeatureDisplayNameFromStorage(typeKeys[0]);
                return `Criação de ${totalCount} ${typeName}(s) ${suffix}`;
            }
            return `Criação de ${totalCount} feições ${suffix}`;
        }

        case 'moveBetweenMaps': {
            const totalMoved = Object.values(action.movedFeatures)
                .reduce((sum, typeOps) => sum + typeOps.mainFeatures.length, 0);
            return `Mover ${totalMoved} feição(ões) entre mapas ${suffixMasc}`;
        }

        case 'batch': {
            if (action.operations.length === 1) {
                return describeUndoRedoAction(action.operations[0], direction);
            }
            return `${action.operations.length} operações ${suffix}s`;
        }

        default:
            return direction === 'undo' ? 'Ação desfeita' : 'Ação refeita';
    }
}

/**
 * Builds a label including the feature name when available.
 * @param {string} typeName - Display name of the feature type
 * @param {Object} feature - GeoJSON feature (may be null/undefined)
 * @returns {string} Label like 'Ponto "Posto 1"' or just 'Ponto'
 */
function _labelWithName(typeName, feature) {
    const name = feature?.properties?.nome;
    return name ? `${typeName} "${name}"` : typeName;
}
