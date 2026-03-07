// Path: js/utilities/uuid.js
/**
 * @fileoverview UUID generation and validation utilities.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ID_REGEX = /^\d{13}-[a-z0-9]{9}$/;

/**
 * Generates a UUID v4.
 * @returns {string} UUID in format xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
export function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Validates if a string is a valid UUID v4.
 * @param {string} id - String to validate
 * @returns {boolean} True if valid UUID v4
 */
export function isValidUUID(id) {
    if (typeof id !== 'string') return false;
    return UUID_V4_REGEX.test(id);
}

/**
 * Detects if an ID is in legacy format (timestamp-random).
 * Example: 1706123456789-abc45xy90
 * @param {string} id - ID to check
 * @returns {boolean} True if legacy format
 */
export function isLegacyId(id) {
    if (typeof id !== 'string') return false;
    return LEGACY_ID_REGEX.test(id);
}

/**
 * Detects if an ID is a valid identifier (either UUID or legacy format).
 * @param {string} id - ID to check
 * @returns {boolean} True if valid ID in any supported format
 */
export function isValidId(id) {
    return isValidUUID(id) || isLegacyId(id);
}
