// Path: js/utilities/lru-cache.js

/**
 * @fileoverview LRU (Least Recently Used) cache implementation.
 * Provides a memory-efficient cache with automatic eviction of oldest entries.
 * Supports optional dispose callbacks for proper resource cleanup (e.g., Three.js textures).
 *
 * @module utilities/lru-cache
 */

/**
 * LRU Cache implementation using Map for O(1) operations.
 * Maintains insertion order and evicts least recently used items when full.
 *
 * @example
 * // Basic usage
 * const cache = new LRUCache(100);
 * cache.set('key1', 'value1');
 * const value = cache.get('key1');
 *
 * @example
 * // With dispose callback for Three.js textures
 * const textureCache = new LRUCache(50, (texture) => {
 *     texture.dispose();
 * });
 */
export class LRUCache {
    /**
     * Creates an LRU cache instance.
     * @param {number} maxSize - Maximum number of items to store
     * @param {Function} [onDispose] - Optional callback when item is evicted or cleared
     */
    constructor(maxSize, onDispose = null) {
        if (maxSize < 1) {
            throw new Error('LRUCache maxSize must be at least 1');
        }

        this._maxSize = maxSize;
        this._cache = new Map();
        this._onDispose = onDispose;
    }

    /**
     * Gets the current number of items in the cache.
     * @returns {number} Current cache size
     */
    get size() {
        return this._cache.size;
    }

    /**
     * Gets the maximum capacity of the cache.
     * @returns {number} Maximum cache size
     */
    get maxSize() {
        return this._maxSize;
    }

    /**
     * Checks if a key exists in the cache.
     * Does NOT update the item's position (use get() for that).
     * @param {string} key - Cache key
     * @returns {boolean} True if key exists
     */
    has(key) {
        return this._cache.has(key);
    }

    /**
     * Gets a value from the cache and marks it as recently used.
     * @param {string} key - Cache key
     * @returns {*} Cached value or undefined if not found
     */
    get(key) {
        if (!this._cache.has(key)) {
            return undefined;
        }

        // Move to end (most recently used) by re-inserting
        const value = this._cache.get(key);
        this._cache.delete(key);
        this._cache.set(key, value);

        return value;
    }

    /**
     * Sets a value in the cache.
     * If the cache is full, evicts the least recently used item.
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @returns {LRUCache} This cache instance for chaining
     */
    set(key, value) {
        // If key exists, delete first to update position
        if (this._cache.has(key)) {
            const oldValue = this._cache.get(key);
            this._cache.delete(key);

            // Dispose old value if different
            if (oldValue !== value && this._onDispose) {
                this._onDispose(oldValue, key);
            }
        }

        // Evict oldest if at capacity
        if (this._cache.size >= this._maxSize) {
            this._evictOldest();
        }

        this._cache.set(key, value);
        return this;
    }

    /**
     * Deletes a key from the cache.
     * @param {string} key - Cache key
     * @returns {boolean} True if key was deleted
     */
    delete(key) {
        if (!this._cache.has(key)) {
            return false;
        }

        const value = this._cache.get(key);

        if (this._onDispose) {
            this._onDispose(value, key);
        }

        return this._cache.delete(key);
    }

    /**
     * Clears all items from the cache.
     * Calls onDispose for each item if provided.
     */
    clear() {
        if (this._onDispose) {
            this._cache.forEach((value, key) => {
                this._onDispose(value, key);
            });
        }

        this._cache.clear();
    }

    /**
     * Gets all keys in the cache (oldest to newest).
     * @returns {IterableIterator<string>} Iterator of keys
     */
    keys() {
        return this._cache.keys();
    }

    /**
     * Gets all values in the cache (oldest to newest).
     * @returns {IterableIterator<*>} Iterator of values
     */
    values() {
        return this._cache.values();
    }

    /**
     * Gets all entries in the cache (oldest to newest).
     * @returns {IterableIterator<[string, *]>} Iterator of [key, value] pairs
     */
    entries() {
        return this._cache.entries();
    }

    /**
     * Iterates over cache entries.
     * @param {Function} callback - Function called with (value, key, cache)
     */
    forEach(callback) {
        this._cache.forEach((value, key) => {
            callback(value, key, this);
        });
    }

    /**
     * Evicts the oldest (least recently used) item from the cache.
     * @private
     */
    _evictOldest() {
        // Map maintains insertion order, so first key is oldest
        const oldestKey = this._cache.keys().next().value;

        if (oldestKey !== undefined) {
            const value = this._cache.get(oldestKey);

            if (this._onDispose) {
                this._onDispose(value, oldestKey);
            }

            this._cache.delete(oldestKey);
        }
    }

    /**
     * Returns cache statistics for debugging.
     * @returns {Object} Cache statistics
     */
    getStats() {
        return {
            size: this._cache.size,
            maxSize: this._maxSize,
            utilization: (this._cache.size / this._maxSize * 100).toFixed(1) + '%'
        };
    }
}

/**
 * Creates an LRU cache with the specified options.
 * Factory function for convenience.
 *
 * @param {Object} options - Cache options
 * @param {number} options.maxSize - Maximum number of items
 * @param {Function} [options.onDispose] - Dispose callback
 * @returns {LRUCache} New cache instance
 */
export function createLRUCache(options) {
    return new LRUCache(options.maxSize, options.onDispose);
}
