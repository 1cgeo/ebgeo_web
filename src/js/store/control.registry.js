// Path: js/store/control.registry.js

/**
 * @fileoverview Control Registry for centralized access to tool controls.
 *
 * This module provides a registry pattern to replace the deprecated use of
 * `mapInstance._controls.find()` which no longer works since controls are
 * not added as native MapLibre controls.
 *
 * Usage:
 *   // In map_sig.js - register controls after creation
 *   import { getControlRegistry } from './store';
 *   const registry = getControlRegistry();
 *   registry.register('AddMilitarySymbolControl', militarySymbolControl);
 *
 *   // In layer setup or other modules - get controls by name
 *   const control = registry.get('AddMilitarySymbolControl');
 */

/**
 * @typedef {Object} ControlRegistry
 * @property {function(string, Object): void} register - Register a control
 * @property {function(string): Object|null} get - Get a control by name
 * @property {function(string): boolean} has - Check if control exists
 * @property {function(): string[]} getNames - Get all registered control names
 */

/** @type {Map<string, Object>} */
const controls = new Map();

/**
 * Register a control in the registry.
 * @param {string} name - Control name (e.g., 'AddMilitarySymbolControl')
 * @param {Object} control - Control instance
 */
export function registerControl(name, control) {
    if (!name || typeof name !== 'string') {
        console.warn('ControlRegistry: Invalid control name');
        return;
    }
    if (!control) {
        console.warn(`ControlRegistry: Cannot register null control for "${name}"`);
        return;
    }
    controls.set(name, control);
}

/**
 * Get a control from the registry by name.
 * @param {string} name - Control name
 * @returns {Object|null} Control instance or null if not found
 */
export function getControl(name) {
    return controls.get(name) || null;
}

/**
 * Check if a control is registered.
 * @param {string} name - Control name
 * @returns {boolean}
 */
export function hasControl(name) {
    return controls.has(name);
}

/**
 * Get all registered control names.
 * @returns {string[]}
 */
export function getControlNames() {
    return Array.from(controls.keys());
}

/**
 * Clear all registered controls.
 * Mainly for testing purposes.
 */
export function clearControls() {
    controls.clear();
}

/**
 * Get the control registry object with all methods.
 * @returns {ControlRegistry}
 */
export function getControlRegistry() {
    return {
        register: registerControl,
        get: getControl,
        has: hasControl,
        getNames: getControlNames,
        clear: clearControls
    };
}
