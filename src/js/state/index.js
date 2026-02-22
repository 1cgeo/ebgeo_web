// Path: js/state/index.js

/**
 * @fileoverview Barrel file for state module.
 * Exports state manager singleton and factory.
 */

export {
    createStateManager,
    getStateManagerInstance,
    _resetForTesting
} from './state_manager.js';
