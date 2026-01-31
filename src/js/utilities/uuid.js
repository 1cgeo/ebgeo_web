// Path: js/utilities/uuid.js

/**
 * @fileoverview UUID generation and validation utilities.
 * Uses crypto.randomUUID() for cryptographically secure UUID v4 generation.
 */

/**
 * Generates a UUID v4 using crypto.randomUUID().
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
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // where y is one of 8, 9, a, or b
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(id);
}

/**
 * Detects if an ID is in legacy format (timestamp-random).
 * Legacy format: 13-digit timestamp + hyphen + 9 alphanumeric chars
 * Example: 1706123456789-abc45xy90
 * @param {string} id - ID to check
 * @returns {boolean} True if legacy format
 */
export function isLegacyId(id) {
    if (typeof id !== 'string') return false;
    // Format: 13-digit timestamp (milliseconds since epoch) + '-' + 9 alphanumeric chars
    return /^\d{13}-[a-z0-9]{9}$/.test(id);
}

/**
 * Detects if an ID is a valid identifier (either UUID or legacy format).
 * @param {string} id - ID to check
 * @returns {boolean} True if valid ID in any supported format
 */
export function isValidId(id) {
    return isValidUUID(id) || isLegacyId(id);
}
