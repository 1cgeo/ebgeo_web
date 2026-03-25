// Path: js/store/control.registry.js

/**
 * @fileoverview Centralized registry for tool control instances.
 * Replaces the deprecated `mapInstance._controls.find()` approach.
 */

/** @type {Map<string, Object>} */
const controls = new Map();

/**
 * Register a control instance by name.
 * @param {string} name - Control identifier (e.g., 'AddMilitarySymbolControl')
 * @param {Object} control - Control instance
 */
export function registerControl(name, control) {
    if (typeof name !== 'string' || !name) {
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
 * Retrieve a control instance by name.
 * @param {string} name - Control identifier
 * @returns {Object|null} Control instance or null if not found
 */
export function getControl(name) {
    return controls.get(name) ?? null;
}

