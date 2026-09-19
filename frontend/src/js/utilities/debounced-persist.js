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
     * @param {boolean} [options.warnBeforeUnload=false] - Warn while user edits are not yet saved.
     * @param {boolean} [options.retainOnError=false] - Keep failed edits for an explicit retry.
     */
    constructor({ delay = DEFAULT_DELAY, maxRetries = DEFAULT_MAX_RETRIES, onError = null, warnBeforeUnload = false, retainOnError = false } = {}) {
        this._delay = delay;
        this._maxRetries = maxRetries;
        this._onError = onError;
        this._warnBeforeUnload = warnBeforeUnload;
        this._retainOnError = retainOnError;
        this._failed = new Map();
        this._unloadAttached = false;
        this._beforeUnload = event => {
            event.preventDefault();
            event.returnValue = '';
        };

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
        this._syncUnloadWarning();
    }

    /**
     * Cancel pending persistence for a key without executing.
     * Used when the data is being deleted/cleared anyway.
     *
     * @param {string} key - Debounce key
     */
    cancel(key) {
        const existing = this._pending.get(key);
        if (existing) clearTimeout(existing.timerId);
        this._pending.delete(key);
        this._failed.delete(key);
        this._syncUnloadWarning();
    }

    /**
     * Cancel all pending persists without executing.
     */
    cancelAll() {
        for (const entry of this._pending.values()) {
            clearTimeout(entry.timerId);
        }
        this._pending.clear();
        this._failed.clear();
        this._syncUnloadWarning();
    }

    /**
     * Immediately execute pending persistence for a key.
     * If no pending persist exists for the key, resolves immediately.
     * If a flush is already in progress for this key, returns the existing promise.
     *
     * @param {string} key - Debounce key
     * @returns {Promise<boolean>} Whether the latest requested value was saved.
     */
    async flush(key) {
        const existingFlush = this._flushing.get(key);
        if (existingFlush) return existingFlush;

        const entry = this._pending.get(key) || this._failed.get(key);
        if (!entry) return true;

        clearTimeout(entry.timerId);
        this._pending.delete(key);
        this._failed.delete(key);

        // Timer saves and explicit flushes share one ordered writer per key. An older
        // save (including its retries) must finish before a newer value is persisted.
        const promise = Promise.resolve().then(async () => {
            let current = entry;
            let saved = true;
            while (current) {
                saved = await this._executeWithRetry(key, current.persistFn);
                this._failed.delete(key);
                if (!saved && this._retainOnError) this._failed.set(key, current);
                current = this._pending.get(key);
                if (current) {
                    clearTimeout(current.timerId);
                    this._pending.delete(key);
                }
            }
            return saved;
        });
        this._flushing.set(key, promise);

        try {
            return await promise;
        } finally {
            this._flushing.delete(key);
            this._syncUnloadWarning();
        }
    }

    /**
     * Flush all pending persists immediately.
     * @returns {Promise<boolean>} Whether every key's latest value was saved.
     */
    async flushAll() {
        const keys = [...new Set([...this._pending.keys(), ...this._flushing.keys(), ...this._failed.keys()])];
        return (await Promise.all(keys.map(key => this.flush(key)))).every(Boolean);
    }

    /**
     * Cleanup all timers. Call on destroy/teardown.
     */
    destroy() {
        // Closing a panel immediately after flush() must not cancel the latest value
        // that the in-flight save is draining. Other scheduled work is still cancelled.
        for (const key of this._pending.keys()) {
            if (!this._flushing.has(key)) this.cancel(key);
        }
    }

    _syncUnloadWarning() {
        const dirty = this._warnBeforeUnload && (this._pending.size > 0 || this._flushing.size > 0 || this._failed.size > 0);
        if (dirty && !this._unloadAttached) {
            globalThis.addEventListener?.('beforeunload', this._beforeUnload);
            this._unloadAttached = true;
        } else if (!dirty && this._unloadAttached) {
            globalThis.removeEventListener?.('beforeunload', this._beforeUnload);
            this._unloadAttached = false;
        }
    }

    /**
     * Execute the pending persist for a key (called by debounce timer).
     * @private
     */
    _execute(key) {
        this.flush(key);
    }

    /**
     * Execute a persist function with retry and exponential backoff.
     * @private
     * @param {string} key
     * @param {Function} persistFn
     * @returns {Promise<boolean>}
     */
    async _executeWithRetry(key, persistFn) {
        for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
            try {
                // A guarded write may refuse explicitly without throwing. It is
                // still unsaved work, not a successful commit.
                return await persistFn() !== false;
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
        return false;
    }
}
