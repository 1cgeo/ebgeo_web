// Path: js/utilities/deep-utils.js

/**
 * @fileoverview Utilitários de manipulação profunda de objetos.
 * Funções puras para clone, comparação e navegação em objetos aninhados.
 * @module utilities/deep-utils
 */

// ============================================================================
// DEEP CLONE
// ============================================================================

/**
 * Deep clone an object to ensure immutability.
 * Handles primitives, Date, Array, and plain Objects.
 * @param {*} obj - Object to clone
 * @returns {*} Deep cloned object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (obj instanceof Object) {
        const copy = {};
        Object.keys(obj).forEach(key => {
            copy[key] = deepClone(obj[key]);
        });
        return copy;
    }
    return obj;
}

// ============================================================================
// PATH-BASED ACCESS
// ============================================================================

/**
 * Get value at dot-notation path.
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path (e.g., 'sidebar.expanded')
 * @returns {*} Value at path or undefined
 * @example
 * getByPath({ a: { b: 1 } }, 'a.b') // returns 1
 * getByPath({ a: { b: 1 } }, 'a.c') // returns undefined
 */
export function getByPath(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
        if (current === null || current === undefined) return undefined;
        current = current[key];
    }
    return current;
}

/**
 * Set value at dot-notation path, returning new object (immutable).
 * Creates intermediate objects if they don't exist.
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path
 * @param {*} value - Value to set
 * @returns {Object} New object with updated value
 * @example
 * setByPath({ a: { b: 1 } }, 'a.b', 2) // returns { a: { b: 2 } }
 * setByPath({ a: {} }, 'a.b.c', 1) // returns { a: { b: { c: 1 } } }
 */
export function setByPath(obj, path, value) {
    const keys = path.split('.');
    const result = deepClone(obj);
    let current = result;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current[key] === undefined) {
            current[key] = {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = value;
    return result;
}

// ============================================================================
// DEEP EQUALITY
// ============================================================================

/**
 * Deep equality check for objects, arrays, and Dates.
 * Used to prevent unnecessary notifications when values haven't changed.
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} True if deeply equal
 * @example
 * deepEqual({ a: 1 }, { a: 1 }) // returns true
 * deepEqual([1, 2], [1, 2]) // returns true
 * deepEqual({ a: 1 }, { a: 2 }) // returns false
 */
export function deepEqual(a, b) {
    // Identical references or primitives
    if (a === b) return true;

    // Null checks
    if (a === null || b === null) return false;

    // Type mismatch
    if (typeof a !== typeof b) return false;

    // Non-objects (primitives already handled by ===)
    if (typeof a !== 'object') return false;

    // Array-specific comparison
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);

    // One is array, other is not
    if (aIsArray !== bIsArray) return false;

    // Both are arrays
    if (aIsArray) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    // Date comparison
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    // Date vs non-Date
    if (a instanceof Date || b instanceof Date) return false;

    // Plain objects
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }

    return true;
}

// ============================================================================
// SHALLOW CLONE
// ============================================================================

/**
 * Shallow clone an object or array (1 level deep).
 * More performant than deepClone for read-only operations.
 * @param {*} value - Value to clone
 * @returns {*} Shallow cloned value
 * @example
 * shallowClone({ a: 1, b: { c: 2 } }) // returns new object, but b is same reference
 */
export function shallowClone(value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;

    if (Array.isArray(value)) {
        return [...value];
    }
    return { ...value };
}
