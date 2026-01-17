// Path: js/controls_sig/events/event_emitter.js

/**
 * @fileoverview Base EventEmitter class for pub/sub pattern.
 * Can be instantiated by any component for local events.
 *
 * Design decisions:
 * - Unsubscribe function returned from on() enables clean component cleanup
 * - Error isolation prevents one failing handler from breaking event propagation
 * - FIFO execution order preserves registration sequence
 */

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
     */
    off(event, callback) {
        const listeners = this._listeners.get(event);
        if (!listeners) return;

        const index = listeners.findIndex(l => l.callback === callback);
        if (index !== -1) {
            listeners.splice(index, 1);

            if (this._debugMode) {
                console.log(`[EventEmitter] Removed listener for "${event}"`);
            }
        }
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
     */
    emit(event, payload) {
        if (this._debugMode) {
            console.log(`[EventEmitter] Emitting "${event}"`, payload);
        }

        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0) return;

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
    }

    /**
     * Wait for an event using Promise.
     * Useful for async/await patterns.
     * @param {string} event - Event name
     * @param {number} [timeout] - Timeout in milliseconds (optional)
     * @returns {Promise<*>} Resolves with event payload
     * @throws {Error} If timeout is reached
     *
     * @example
     * const payload = await emitter.waitFor('ready', 5000);
     */
    waitFor(event, timeout) {
        return new Promise((resolve, reject) => {
            let timeoutId;

            const unsubscribe = this.once(event, (payload) => {
                if (timeoutId) clearTimeout(timeoutId);
                resolve(payload);
            });

            if (timeout) {
                timeoutId = setTimeout(() => {
                    unsubscribe();
                    reject(new Error(`Timeout waiting for event "${event}"`));
                }, timeout);
            }
        });
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
}
