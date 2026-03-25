// Path: js/utilities/debounced-persist.js
/**
 * @module utilities/debounced-persist
 * @description Debounced persistence with retry and error propagation.
 *
 * Coalesces rapid writes into a single IndexedDB call after a delay.
 * Each key (typically mapName) has its own independent debounce timer.
 *
 * Features:
 * - **Debounce**: Multiple schedule() calls for the same key coalesce into one write
 * - **Retry**: Failed writes retry with exponential backoff (1s, 2s, 4s)
 * - **Cancel**: cancel(key) discards pending writes (for clearMapLayers)
 * - **Flush**: flush(key) immediately executes pending writes (for loadLayersToMemory)
 * - **Error callback**: After retries exhausted, calls onError for UI notification
 *
 * @example
 * const persist = new DebouncedPersist({
 *     delay: 300,
 *     maxRetries: 3,
 *     onError: (key, err) => console.error(`Failed [${key}]:`, err)
 * });
 *
 * persist.schedule('MapA', async () => {
 *     await saveToIndexedDB('MapA', data);
 * });
 */

const DEFAULT_DELAY = 300;
const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

export class DebouncedPersist {
    /**
     * @param {Object} options
     * @param {number} [options.delay=300] - Debounce delay in ms
     * @param {number} [options.maxRetries=3] - Max retry attempts on failure
     * @param {Function} [options.onError] - Callback when all retries exhausted: (key, error) => void
     */
    constructor({ delay = DEFAULT_DELAY, maxRetries = DEFAULT_MAX_RETRIES, onError = null } = {}) {
        this._delay = delay;
        this._maxRetries = maxRetries;
        this._onError = onError;

        /** @type {Map<string, {timerId: number, persistFn: Function}>} */
        this._pending = new Map();

        /** @type {Map<string, Promise<void>>} In-flight flush promises to avoid double-flush */
        this._flushing = new Map();
    }

    /**
     * Schedule a debounced persistence for the given key.
     * If a previous schedule exists for this key, it is replaced.
     *
     * @param {string} key - Debounce key (typically mapName)
     * @param {Function} persistFn - Async function that performs the IndexedDB write
     */
    schedule(key, persistFn) {
        this.cancel(key);

        const timerId = setTimeout(() => {
            this._execute(key);
        }, this._delay);

        this._pending.set(key, { timerId, persistFn });
    }

    /**
     * Cancel pending persistence for a key without executing.
     * Used when the data is being deleted/cleared anyway.
     *
     * @param {string} key - Debounce key
     */
    cancel(key) {
        const existing = this._pending.get(key);
        if (!existing) return;

        clearTimeout(existing.timerId);
        this._pending.delete(key);
    }

    /**
     * Cancel all pending persists without executing.
     */
    cancelAll() {
        for (const entry of this._pending.values()) {
            clearTimeout(entry.timerId);
        }
        this._pending.clear();
    }

    /**
     * Immediately execute pending persistence for a key.
     * If no pending persist exists for the key, resolves immediately.
     * If a flush is already in progress for this key, returns the existing promise.
     *
     * @param {string} key - Debounce key
     * @returns {Promise<void>}
     */
    async flush(key) {
        const existingFlush = this._flushing.get(key);
        if (existingFlush) return existingFlush;

        const entry = this._pending.get(key);
        if (!entry) return;

        clearTimeout(entry.timerId);
        this._pending.delete(key);

        const promise = this._executeWithRetry(key, entry.persistFn);
        this._flushing.set(key, promise);

        try {
            await promise;
        } finally {
            this._flushing.delete(key);
        }
    }

    /**
     * Flush all pending persists immediately.
     * @returns {Promise<void>}
     */
    async flushAll() {
        const keys = Array.from(this._pending.keys());
        await Promise.all(keys.map(key => this.flush(key)));
    }

    /**
     * Cleanup all timers. Call on destroy/teardown.
     */
    destroy() {
        this.cancelAll();
        this._flushing.clear();
    }

    /**
     * Execute the pending persist for a key (called by debounce timer).
     * @private
     */
    _execute(key) {
        const entry = this._pending.get(key);
        if (!entry) return;

        this._pending.delete(key);
        this._executeWithRetry(key, entry.persistFn);
    }

    /**
     * Execute a persist function with retry and exponential backoff.
     * @private
     * @param {string} key
     * @param {Function} persistFn
     * @returns {Promise<void>}
     */
    async _executeWithRetry(key, persistFn) {
        for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
            try {
                await persistFn();
                return;
            } catch (error) {
                if (attempt < this._maxRetries) {
                    const backoff = BASE_RETRY_DELAY * (2 ** attempt);
                    console.warn(
                        `[DebouncedPersist] Retry ${attempt + 1}/${this._maxRetries} for key "${key}" in ${backoff}ms:`,
                        error
                    );
                    await new Promise(resolve => setTimeout(resolve, backoff));
                } else {
                    console.error(
                        `[DebouncedPersist] All ${this._maxRetries} retries failed for key "${key}":`,
                        error
                    );
                    if (this._onError) {
                        this._onError(key, error);
                    }
                }
            }
        }
    }
}
