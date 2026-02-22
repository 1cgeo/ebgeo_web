import { describe, it, expect } from 'vitest';
import {
    generateUUID,
    isValidUUID,
    isLegacyId,
    isValidId
} from '../../src/js/utilities/uuid.js';

// ============================================================================
// generateUUID
// ============================================================================

describe('generateUUID', () => {
    it('generates a valid UUID v4', () => {
        const uuid = generateUUID();
        expect(isValidUUID(uuid)).toBe(true);
    });

    it('generates unique UUIDs', () => {
        const uuids = new Set();
        for (let i = 0; i < 100; i++) {
            uuids.add(generateUUID());
        }
        expect(uuids.size).toBe(100);
    });

    it('follows UUID v4 format', () => {
        const uuid = generateUUID();
        const parts = uuid.split('-');
        expect(parts).toHaveLength(5);
        expect(parts[0]).toHaveLength(8);
        expect(parts[1]).toHaveLength(4);
        expect(parts[2]).toHaveLength(4);
        expect(parts[3]).toHaveLength(4);
        expect(parts[4]).toHaveLength(12);
        // Version 4 indicator
        expect(parts[2][0]).toBe('4');
    });
});

// ============================================================================
// isValidUUID
// ============================================================================

describe('isValidUUID', () => {
    it('validates correct UUID v4', () => {
        expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
        expect(isValidUUID('6ba7b810-9dad-41d0-80b4-00c04fd430c8')).toBe(true);
    });

    it('rejects non-v4 UUIDs (version digit not 4)', () => {
        // UUID v1
        expect(isValidUUID('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
        // UUID v5
        expect(isValidUUID('550e8400-e29b-51d4-a716-446655440000')).toBe(false);
    });

    it('rejects invalid variant bits', () => {
        // Variant digit must be 8, 9, a, or b
        expect(isValidUUID('550e8400-e29b-41d4-0716-446655440000')).toBe(false);
        expect(isValidUUID('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
    });

    it('rejects non-string inputs', () => {
        expect(isValidUUID(123)).toBe(false);
        expect(isValidUUID(null)).toBe(false);
        expect(isValidUUID(undefined)).toBe(false);
        expect(isValidUUID({})).toBe(false);
    });

    it('rejects malformed strings', () => {
        expect(isValidUUID('')).toBe(false);
        expect(isValidUUID('not-a-uuid')).toBe(false);
        expect(isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
        expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
    });

    it('is case insensitive', () => {
        expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });
});

// ============================================================================
// isLegacyId
// ============================================================================

describe('isLegacyId', () => {
    it('recognizes legacy timestamp-random format', () => {
        expect(isLegacyId('1706123456789-abc45xy90')).toBe(true);
    });

    it('rejects UUIDs', () => {
        expect(isLegacyId('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('rejects wrong timestamp length', () => {
        expect(isLegacyId('170612345678-abc45xy90')).toBe(false);  // 12 digits
        expect(isLegacyId('17061234567890-abc45xy90')).toBe(false); // 14 digits
    });

    it('rejects wrong random part length', () => {
        expect(isLegacyId('1706123456789-abc45xy9')).toBe(false);  // 8 chars
        expect(isLegacyId('1706123456789-abc45xy900')).toBe(false); // 10 chars
    });

    it('rejects non-string inputs', () => {
        expect(isLegacyId(null)).toBe(false);
        expect(isLegacyId(123)).toBe(false);
    });
});

// ============================================================================
// isValidId
// ============================================================================

describe('isValidId', () => {
    it('accepts UUID v4', () => {
        expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('accepts legacy format', () => {
        expect(isValidId('1706123456789-abc45xy90')).toBe(true);
    });

    it('rejects invalid formats', () => {
        expect(isValidId('invalid')).toBe(false);
        expect(isValidId('')).toBe(false);
    });
});
