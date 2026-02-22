import { describe, it, expect, vi } from 'vitest';
import { LRUCache, createLRUCache } from '../../src/js/utilities/lru-cache.js';

// ============================================================================
// Constructor
// ============================================================================

describe('LRUCache constructor', () => {
    it('creates cache with given max size', () => {
        const cache = new LRUCache(10);
        expect(cache.maxSize).toBe(10);
        expect(cache.size).toBe(0);
    });

    it('throws on maxSize < 1', () => {
        expect(() => new LRUCache(0)).toThrow('maxSize must be at least 1');
        expect(() => new LRUCache(-1)).toThrow('maxSize must be at least 1');
    });

    it('works via factory function', () => {
        const cache = createLRUCache({ maxSize: 5 });
        expect(cache).toBeInstanceOf(LRUCache);
        expect(cache.maxSize).toBe(5);
    });
});

// ============================================================================
// Basic operations
// ============================================================================

describe('LRUCache get/set/has/delete', () => {
    it('stores and retrieves values', () => {
        const cache = new LRUCache(3);
        cache.set('a', 1);
        expect(cache.get('a')).toBe(1);
    });

    it('returns undefined for missing keys', () => {
        const cache = new LRUCache(3);
        expect(cache.get('missing')).toBeUndefined();
    });

    it('has() checks existence without updating position', () => {
        const cache = new LRUCache(3);
        cache.set('a', 1);
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
    });

    it('delete() removes entries', () => {
        const cache = new LRUCache(3);
        cache.set('a', 1);
        expect(cache.delete('a')).toBe(true);
        expect(cache.has('a')).toBe(false);
        expect(cache.size).toBe(0);
    });

    it('delete() returns false for missing keys', () => {
        const cache = new LRUCache(3);
        expect(cache.delete('missing')).toBe(false);
    });

    it('clear() removes all entries', () => {
        const cache = new LRUCache(3);
        cache.set('a', 1).set('b', 2).set('c', 3);
        cache.clear();
        expect(cache.size).toBe(0);
        expect(cache.has('a')).toBe(false);
    });
});

// ============================================================================
// Eviction
// ============================================================================

describe('LRUCache eviction', () => {
    it('evicts oldest entry when at capacity', () => {
        const cache = new LRUCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // Should evict 'a'
        expect(cache.has('a')).toBe(false);
        expect(cache.get('b')).toBe(2);
        expect(cache.get('c')).toBe(3);
    });

    it('get() refreshes position (prevents eviction)', () => {
        const cache = new LRUCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // Refresh 'a' — now 'b' is oldest
        cache.set('c', 3); // Should evict 'b'
        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
        expect(cache.has('c')).toBe(true);
    });

    it('set() on existing key refreshes position', () => {
        const cache = new LRUCache(2);
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('a', 10); // Refresh 'a' — now 'b' is oldest
        cache.set('c', 3); // Should evict 'b'
        expect(cache.get('a')).toBe(10);
        expect(cache.has('b')).toBe(false);
    });

    it('maxSize of 1 works correctly', () => {
        const cache = new LRUCache(1);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.has('a')).toBe(false);
        expect(cache.get('b')).toBe(2);
        expect(cache.size).toBe(1);
    });
});

// ============================================================================
// Dispose callback
// ============================================================================

describe('LRUCache dispose callback', () => {
    it('calls onDispose when evicting', () => {
        const disposed = [];
        const cache = new LRUCache(2, (value, key) => disposed.push({ key, value }));
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3); // Evicts 'a'
        expect(disposed).toEqual([{ key: 'a', value: 1 }]);
    });

    it('calls onDispose on delete()', () => {
        const disposed = [];
        const cache = new LRUCache(5, (value, key) => disposed.push({ key, value }));
        cache.set('x', 42);
        cache.delete('x');
        expect(disposed).toEqual([{ key: 'x', value: 42 }]);
    });

    it('calls onDispose for all items on clear()', () => {
        const disposed = [];
        const cache = new LRUCache(5, (value, key) => disposed.push(key));
        cache.set('a', 1).set('b', 2).set('c', 3);
        cache.clear();
        expect(disposed).toEqual(['a', 'b', 'c']);
    });

    it('calls onDispose when replacing value with set()', () => {
        const disposed = [];
        const cache = new LRUCache(5, (value, key) => disposed.push({ key, value }));
        cache.set('a', 'old');
        cache.set('a', 'new');
        expect(disposed).toEqual([{ key: 'a', value: 'old' }]);
    });

    it('does NOT call onDispose when replacing with same value', () => {
        const disposeFn = vi.fn();
        const cache = new LRUCache(5, disposeFn);
        const obj = { x: 1 };
        cache.set('a', obj);
        cache.set('a', obj); // Same reference
        expect(disposeFn).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Iterators
// ============================================================================

describe('LRUCache iterators', () => {
    it('keys() returns in insertion order (oldest first)', () => {
        const cache = new LRUCache(5);
        cache.set('a', 1).set('b', 2).set('c', 3);
        expect([...cache.keys()]).toEqual(['a', 'b', 'c']);
    });

    it('values() returns in insertion order', () => {
        const cache = new LRUCache(5);
        cache.set('a', 1).set('b', 2).set('c', 3);
        expect([...cache.values()]).toEqual([1, 2, 3]);
    });

    it('forEach iterates all entries', () => {
        const cache = new LRUCache(5);
        cache.set('a', 1).set('b', 2);
        const result = [];
        cache.forEach((value, key) => result.push({ key, value }));
        expect(result).toEqual([
            { key: 'a', value: 1 },
            { key: 'b', value: 2 }
        ]);
    });
});

// ============================================================================
// getStats
// ============================================================================

describe('LRUCache getStats', () => {
    it('returns correct statistics', () => {
        const cache = new LRUCache(10);
        cache.set('a', 1).set('b', 2);
        const stats = cache.getStats();
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(10);
        expect(stats.utilization).toBe('20.0%');
    });
});
