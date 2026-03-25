// Path: js/utilities/lru-cache.js
/**
 * @fileoverview LRU (Least Recently Used) cache implementation.
 * Provides a memory-efficient cache with automatic eviction of oldest entries.
 * Supports optional dispose callbacks for proper resource cleanup (e.g., Three.js textures).
 */

/**
 * LRU Cache implementation using Map for O(1) operations.
 * Maintains insertion order and evicts least recently used items when full.
 *
 * @example
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
     * @returns {number}
     */
    get size() {
        return this._cache.size;
    }

    /**
     * Gets the maximum capacity of the cache.
     * @returns {number}
     */
    get maxSize() {
        return this._maxSize;
    }

    /**
     * Checks if a key exists in the cache.
     * Does NOT update the item's position (use get() for that).
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this._cache.has(key);
    }

    /**
     * Gets a value from the cache and marks it as recently used.
     * @param {string} key
     * @returns {*} Cached value or undefined if not found
     */
    get(key) {
        const value = this._cache.get(key);
        if (value === undefined && !this._cache.has(key)) {
            return undefined;
        }

        this._cache.delete(key);
        this._cache.set(key, value);
        return value;
    }

    /**
     * Sets a value in the cache.
     * If the cache is full, evicts the least recently used item.
     * @param {string} key
     * @param {*} value
     * @returns {LRUCache} This cache instance for chaining
     */
    set(key, value) {
        if (this._cache.has(key)) {
            const oldValue = this._cache.get(key);
            this._cache.delete(key);

            if (oldValue !== value && this._onDispose) {
                this._onDispose(oldValue, key);
            }
        } else if (this._cache.size >= this._maxSize) {
            this._evictOldest();
        }

        this._cache.set(key, value);
        return this;
    }

    /**
     * Deletes a key from the cache.
     * @param {string} key
     * @returns {boolean} True if key was deleted
     */
    delete(key) {
        const value = this._cache.get(key);
        if (value === undefined && !this._cache.has(key)) {
            return false;
        }

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
     * @returns {IterableIterator<string>}
     */
    keys() {
        return this._cache.keys();
    }

    /**
     * Gets all values in the cache (oldest to newest).
     * @returns {IterableIterator<*>}
     */
    values() {
        return this._cache.values();
    }

    /**
     * Gets all entries in the cache (oldest to newest).
     * @returns {IterableIterator<[string, *]>}
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
     * Returns cache statistics for debugging.
     * @returns {{ size: number, maxSize: number, utilization: string }}
     */
    getStats() {
        return {
            size: this._cache.size,
            maxSize: this._maxSize,
            utilization: (this._cache.size / this._maxSize * 100).toFixed(1) + '%'
        };
    }

    /**
     * Evicts the oldest (least recently used) item from the cache.
     * @private
     */
    _evictOldest() {
        const oldestKey = this._cache.keys().next().value;
        const value = this._cache.get(oldestKey);

        if (this._onDispose) {
            this._onDispose(value, oldestKey);
        }

        this._cache.delete(oldestKey);
    }
}
