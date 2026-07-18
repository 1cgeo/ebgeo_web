import { describe, it, expect } from 'vitest';
import {
    deepClone,
    deepEqual,
    getByPath,
    setByPath,
    shallowClone
} from '../../src/js/utilities/deep-utils.js';

// ============================================================================
// deepClone
// ============================================================================

describe('deepClone', () => {
    it('returns primitives as-is', () => {
        expect(deepClone(42)).toBe(42);
        expect(deepClone('hello')).toBe('hello');
        expect(deepClone(true)).toBe(true);
        expect(deepClone(null)).toBe(null);
        expect(deepClone(undefined)).toBe(undefined);
    });

    it('clones a Date without sharing reference', () => {
        const original = new Date('2024-01-15');
        const cloned = deepClone(original);
        expect(cloned).toBeInstanceOf(Date);
        expect(cloned.getTime()).toBe(original.getTime());
        expect(cloned).not.toBe(original);
    });

    it('clones an array without sharing reference', () => {
        const original = [1, 2, { a: 3 }];
        const cloned = deepClone(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned[2]).not.toBe(original[2]);
    });

    it('clones nested objects without sharing references', () => {
        const original = { a: { b: { c: 1 } }, d: [1, 2] };
        const cloned = deepClone(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
        expect(cloned.a).not.toBe(original.a);
        expect(cloned.a.b).not.toBe(original.a.b);
        expect(cloned.d).not.toBe(original.d);
    });

    it('handles GeoJSON feature structure (common in EBGeo)', () => {
        const feature = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [-43.2, -22.9]
            },
            properties: {
                nome: 'Ponto A',
                descricao: 'Teste',
                cor: '#ff0000'
            }
        };
        const cloned = deepClone(feature);
        expect(cloned).toEqual(feature);
        cloned.geometry.coordinates[0] = -44.0;
        expect(feature.geometry.coordinates[0]).toBe(-43.2);
    });
});

// ============================================================================
// getByPath
// ============================================================================

describe('getByPath', () => {
    const obj = { a: { b: { c: 42 } }, d: [1, 2, 3] };

    it('retrieves nested values', () => {
        expect(getByPath(obj, 'a.b.c')).toBe(42);
    });

    it('retrieves top-level values', () => {
        expect(getByPath(obj, 'd')).toEqual([1, 2, 3]);
    });

    it('returns undefined for missing paths', () => {
        expect(getByPath(obj, 'a.b.x')).toBeUndefined();
        expect(getByPath(obj, 'x.y.z')).toBeUndefined();
    });

    it('handles null intermediate nodes', () => {
        const withNull = { a: { b: null } };
        expect(getByPath(withNull, 'a.b.c')).toBeUndefined();
    });
});

// ============================================================================
// setByPath
// ============================================================================

describe('setByPath', () => {
    it('sets a nested value immutably', () => {
        const original = { a: { b: 1 } };
        const result = setByPath(original, 'a.b', 2);
        expect(result.a.b).toBe(2);
        expect(original.a.b).toBe(1);
    });

    it('returns a new root object', () => {
        const original = { a: { b: 1 } };
        const result = setByPath(original, 'a.b', 2);
        expect(result).not.toBe(original);
    });

    it('preserves structural sharing for unmodified branches', () => {
        const original = { a: { b: 1 }, c: { d: 2 } };
        const result = setByPath(original, 'a.b', 99);
        // c branch should be the same reference (structural sharing)
        expect(result.c).toBe(original.c);
        // a branch should be a new object
        expect(result.a).not.toBe(original.a);
    });

    it('creates intermediate objects if missing', () => {
        const original = { a: {} };
        const result = setByPath(original, 'a.b.c', 1);
        expect(result.a.b.c).toBe(1);
    });

    it('handles array nodes along the path', () => {
        const original = { a: [1, 2, 3] };
        const result = setByPath(original, 'a.1', 99);
        expect(result.a[1]).toBe(99);
        expect(result.a).not.toBe(original.a);
        // Original not mutated
        expect(original.a[1]).toBe(2);
    });

    it('handles setting top-level property', () => {
        const original = { x: 1 };
        const result = setByPath(original, 'x', 2);
        expect(result.x).toBe(2);
        expect(original.x).toBe(1);
    });
});

// ============================================================================
// deepEqual
// ============================================================================

describe('deepEqual', () => {
    it('returns true for identical primitives', () => {
        expect(deepEqual(1, 1)).toBe(true);
        expect(deepEqual('a', 'a')).toBe(true);
        expect(deepEqual(null, null)).toBe(true);
    });

    it('returns false for different primitives', () => {
        expect(deepEqual(1, 2)).toBe(false);
        expect(deepEqual('a', 'b')).toBe(false);
    });

    it('returns true for equal objects', () => {
        expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns false for objects with different keys', () => {
        expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    it('compares nested objects', () => {
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    });

    it('compares arrays', () => {
        expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
        expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
    });

    it('compares Dates', () => {
        const d1 = new Date('2024-01-15');
        const d2 = new Date('2024-01-15');
        const d3 = new Date('2024-01-16');
        expect(deepEqual(d1, d2)).toBe(true);
        expect(deepEqual(d1, d3)).toBe(false);
    });

    it('returns false for mismatched types (array vs object)', () => {
        expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    });

    it('returns false for null vs object', () => {
        expect(deepEqual(null, {})).toBe(false);
        expect(deepEqual({}, null)).toBe(false);
    });

    it('returns false for Date vs non-Date', () => {
        expect(deepEqual(new Date(), {})).toBe(false);
        expect(deepEqual({}, new Date())).toBe(false);
    });

    it('handles sync metadata comparison (critical for backend conflict detection)', () => {
        const sync1 = { createdAt: 1000, updatedAt: 2000, version: 3, ownerId: null, dirty: true, deleted: false, deletedAt: null };
        const sync2 = { createdAt: 1000, updatedAt: 2000, version: 3, ownerId: null, dirty: true, deleted: false, deletedAt: null };
        const sync3 = { ...sync1, version: 4 };
        expect(deepEqual(sync1, sync2)).toBe(true);
        expect(deepEqual(sync1, sync3)).toBe(false);
    });
});

// ============================================================================
// shallowClone
// ============================================================================

describe('shallowClone', () => {
    it('returns primitives and nullish values as-is', () => {
        expect(shallowClone(42)).toBe(42);
        expect(shallowClone(null)).toBe(null);
        expect(shallowClone(undefined)).toBe(undefined);
    });

    it('creates new array reference', () => {
        const original = [1, 2, 3];
        const cloned = shallowClone(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
    });

    it('creates new object reference', () => {
        const original = { a: 1 };
        const cloned = shallowClone(original);
        expect(cloned).toEqual(original);
        expect(cloned).not.toBe(original);
    });

    it('does NOT clone nested objects (shallow)', () => {
        const nested = { x: 1 };
        const original = { a: nested };
        const cloned = shallowClone(original);
        expect(cloned.a).toBe(nested);
    });
});
