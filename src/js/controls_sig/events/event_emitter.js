// Path: js/controls_sig/events/event_emitter.js

/**
 * @fileoverview Base EventEmitter class for pub/sub pattern.
 * Can be instantiated by any component for local events.
 *
 * Design decisions:
 * - Unsubscribe function returned from on() enables clean component cleanup
 * - Error isolation prevents one failing handler from breaking event propagation
 * - FIFO execution order preserves registration sequence
 * - Default timeout on waitFor() prevents memory leaks from forgotten promises
 */

/** Default timeout for waitFor() to prevent memory leaks from unresolved promises */
const DEFAULT_WAIT_TIMEOUT_MS = 30000;

/**
 * Base EventEmitter class.
 * Provides pub/sub functionality with automatic cleanup.
 */
export class EventEmitter {
    constructor() {
        /**
         * Map of event names to listener arrays.
         * Each listener is {callback, once}.
         * @type {Map<string, Array<{callback: Function, once: boolean}>>}
         * @private
         */
        this._listeners = new Map();

        /**
         * Debug mode flag for verbose logging.
         * @type {boolean}
         * @private
         */
        this._debugMode = false;
    }

    /**
     * Enable or disable debug logging.
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugMode(enabled) {
        this._debugMode = enabled;
    }

    /**
     * Register an event listener.
     * @param {string} event - Event name
     * @param {Function} callback - Listener function receiving payload
     * @param {Object} [options={}] - Options
     * @param {boolean} [options.once=false] - Remove after first call
     * @returns {Function} Unsubscribe function
     * @throws {TypeError} If callback is not a function
     *
     * @example
     * const unsub = emitter.on('event', (payload) => console.log(payload));
     * // Later: unsub();
     */
    on(event, callback, options = {}) {
        const { once = false } = options;

        if (typeof callback !== 'function') {
            throw new TypeError('EventEmitter.on: callback must be a function');
        }

        if (typeof event !== 'string' || event.trim() === '') {
            throw new TypeError('EventEmitter.on: event must be a non-empty string');
        }

        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }

        const listener = { callback, once };
        this._listeners.get(event).push(listener);

        if (this._debugMode) {
            console.log(`[EventEmitter] Registered listener for "${event}"`);
        }

        // Return unsubscribe function for cleanup
        return () => this.off(event, callback);
    }

    /**
     * Register a one-time event listener.
     * Automatically removed after first invocation.
     * @param {string} event - Event name
     * @param {Function} callback - Listener function
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
        return this.on(event, callback, { once: true });
    }

    /**
     * Remove a specific event listener.
     * @param {string} event - Event name
     * @param {Function} callback - The exact callback reference to remove
     * @returns {boolean} True if listener was found and removed
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return false;

        const index = listeners.findIndex(l => l.callback === callback);
        if (index !== -1) {
            listeners.splice(index, 1);

            // Cleanup empty arrays to prevent unbounded Map growth
            if (listeners.length === 0) {
                this._listeners.delete(event);
            }

            if (this._debugMode) {
                console.log(`[EventEmitter] Removed listener for "${event}"`);
            }
            return true;
        }
        return false;
    }

    /**
     * Remove all listeners for an event, or all listeners entirely.
     * @param {string} [event] - Event name. If omitted, removes all listeners.
     */
    offAll(event) {
        if (event) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
    }

    /**
     * Emit an event to all registered listeners.
     * Listeners are called in registration order (FIFO).
     * Errors in one listener do not prevent other listeners from being called.
     * @param {string} event - Event name
     * @param {*} [payload] - Event data passed to listeners
     * @returns {boolean} True if event had listeners
     */
    emit(event, payload) {
        if (this._debugMode) {
            console.log(`[EventEmitter] Emitting "${event}"`, payload);
        }

        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0) return false;

        // Copy array to avoid issues if listeners modify the array during iteration
        const listenersCopy = [...listeners];
        const toRemove = [];

        for (const listener of listenersCopy) {
            try {
                listener.callback(payload);

                if (listener.once) {
                    toRemove.push(listener);
                }
            } catch (error) {
                // Isolate errors - one failing handler should not break others
                console.error(`[EventEmitter] Error in listener for "${event}":`, error);
            }
        }

        // Remove one-time listeners after all have been called
        for (const listener of toRemove) {
            this.off(event, listener.callback);
        }

        return true;
    }

    /**
     * Wait for an event using Promise.
     * Useful for async/await patterns.
     * @param {string} event - Event name
     * @param {number} [timeout=30000] - Timeout in ms. Defaults to 30s to prevent memory leaks.
     * @returns {Promise<*>} Resolves with event payload
     * @throws {Error} If timeout is reached
     *
     * @example
     * const payload = await emitter.waitFor('ready', 5000);
     */
    waitFor(event, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            let timeoutId = null;
            let unsubscribe = null;

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            unsubscribe = this.once(event, (payload) => {
                cleanup();
                resolve(payload);
            });

            timeoutId = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout waiting for event "${event}" after ${timeout}ms`));
            }, timeout);
        });
    }

    /**
     * Check if there are listeners for an event.
     * @param {string} event - Event name
     * @returns {boolean} True if event has listeners
     */
    hasListeners(event) {
        const listeners = this._listeners.get(event);
        return listeners !== undefined && listeners.length > 0;
    }

    /**
     * Get the number of listeners for an event.
     * @param {string} event - Event name
     * @returns {number} Listener count
     */
    listenerCount(event) {
        const listeners = this._listeners.get(event);
        return listeners ? listeners.length : 0;
    }

    /**
     * Get all registered event names.
     * @returns {string[]} Array of event names
     */
    eventNames() {
        return Array.from(this._listeners.keys());
    }

    /**
     * Get total listener count across all events.
     * @returns {number} Total listener count
     */
    totalListenerCount() {
        let total = 0;
        for (const listeners of this._listeners.values()) {
            total += listeners.length;
        }
        return total;
    }
}
