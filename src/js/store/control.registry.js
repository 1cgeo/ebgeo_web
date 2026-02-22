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
 *   import { registerControl } from './store';
 *   registerControl('AddMilitarySymbolControl', militarySymbolControl);
 *
 *   // In layer setup or other modules - get controls by name
 *   import { getControl } from './store';
 *   const control = getControl('AddMilitarySymbolControl');
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

