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

    switch (action.type) {
        case 'add':
            return _describeSimple('Criação', action.featureType, action.feature, suffix);

        case 'update':
            return _describeSimple('Edição', action.featureType, _pickFeature(action, direction), suffix);

        case 'remove':
            return _describeSimple('Exclusão', action.featureType, action.feature, suffix);

        case 'removeWithProcessed':
            return _describeSimple('Exclusão', action.mainFeatureType, action.mainFeature, suffix);

        case 'updateWithProcessed':
            return _describeSimple('Edição', action.mainFeatureType, _pickFeature(action, direction), suffix);

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
            const suffixMasc = direction === 'undo' ? 'desfeito' : 'refeito';
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
 * Builds a description string for single-feature operations.
 * @param {string} verb - Action verb (e.g. 'Criação', 'Edição', 'Exclusão')
 * @param {string} featureType - Storage type key for display name lookup
 * @param {Object} feature - GeoJSON feature (may be null/undefined)
 * @param {string} suffix - Gender-appropriate suffix ('desfeita'/'refeita')
 * @returns {string} e.g. 'Criação de Ponto "Posto 1" desfeita'
 */
function _describeSimple(verb, featureType, feature, suffix) {
    const typeName = getFeatureDisplayNameFromStorage(featureType);
    const name = feature?.properties?.nome;
    const label = name ? `${typeName} "${name}"` : typeName;
    return `${verb} de ${label} ${suffix}`;
}

/**
 * Selects the relevant feature snapshot for update actions based on direction.
 * On undo we show the feature being reverted (newFeature),
 * on redo we show the feature being restored (oldFeature).
 * @param {Object} action - The update action
 * @param {'undo'|'redo'} direction
 * @returns {Object} The appropriate feature snapshot
 */
function _pickFeature(action, direction) {
    return direction === 'undo' ? action.newFeature : action.oldFeature;
}
