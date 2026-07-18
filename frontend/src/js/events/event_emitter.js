// Path: js/events/event_emitter.js

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

/** Default threshold for listener count warning per event */
const DEFAULT_WARNING_THRESHOLD = 50;

/**
 * Base EventEmitter class.
 * Provides pub/sub functionality with automatic cleanup.
 */
export class EventEmitter {
    constructor() {
        /** @type {Map<string, Array<{callback: Function, once: boolean}>>} */
        this._listeners = new Map();
        /** @type {number} */
        this._warningThreshold = DEFAULT_WARNING_THRESHOLD;
        /** @type {Set<string>} */
        this._warnedEvents = new Set();
        /** @type {Set<Function>} Wildcard listeners notified of every emit (event, payload) */
        this._anyListeners = new Set();
    }

    /**
     * Register an event listener.
     * @param {string} event - Event name
     * @param {Function} callback - Listener function receiving payload
     * @param {Object} [options={}] - Options
     * @param {boolean} [options.once=false] - Remove after first call
     * @returns {Function} Unsubscribe function
     * @throws {TypeError} If callback is not a function or event is not a non-empty string
     */
    on(event, callback, options = {}) {
        if (typeof event !== 'string' || event.trim() === '') {
            throw new TypeError('EventEmitter.on: event must be a non-empty string');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('EventEmitter.on: callback must be a function');
        }

        const { once = false } = options;

        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }

        const listeners = this._listeners.get(event);
        listeners.push({ callback, once });

        if (listeners.length > this._warningThreshold && !this._warnedEvents.has(event)) {
            this._warnedEvents.add(event);
            console.warn(
                `[EventEmitter] Possible listener leak: "${event}" has ${listeners.length} listeners (threshold: ${this._warningThreshold})`
            );
        }

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
     * Register a wildcard listener invoked for EVERY emit as `(event, payload)`,
     * including events that have no specific listeners. Used by diagnostic taps
     * (the SyncLedger tracer) to observe the whole bus from one subscription.
     * Wildcard listeners are error-isolated and run before specific listeners.
     * @param {Function} callback - Receives (event, payload).
     * @returns {Function} Unsubscribe function.
     * @throws {TypeError} If callback is not a function.
     */
    onAny(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('EventEmitter.onAny: callback must be a function');
        }
        this._anyListeners.add(callback);
        return () => this._anyListeners.delete(callback);
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
        if (index === -1) return false;

        listeners.splice(index, 1);

        if (this._warnedEvents.has(event) && listeners.length <= this._warningThreshold) {
            this._warnedEvents.delete(event);
        }

        if (listeners.length === 0) {
            this._listeners.delete(event);
        }

        return true;
    }

    /**
     * Remove all listeners for an event, or all listeners entirely.
     * @param {string} [event] - Event name. If omitted, removes all listeners.
     */
    offAll(event) {
        if (event) {
            this._listeners.delete(event);
            this._warnedEvents.delete(event);
        } else {
            this._listeners.clear();
            this._warnedEvents.clear();
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
        // Wildcard listeners fire for EVERY event, even ones with no specific
        // listener — so the early `return false` below must not skip them.
        if (this._anyListeners.size > 0) {
            for (const anyCb of this._anyListeners) {
                try {
                    anyCb(event, payload);
                } catch (error) {
                    console.error(`[EventEmitter] Error in wildcard listener for "${event}":`, error);
                }
            }
        }

        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0) return false;

        // Snapshot to avoid issues if listeners modify the array during iteration
        const snapshot = [...listeners];

        for (const listener of snapshot) {
            try {
                listener.callback(payload);
            } catch (error) {
                console.error(`[EventEmitter] Error in listener for "${event}":`, error);
            }
        }

        // Batch-remove once-listeners by filtering instead of repeated findIndex scans
        const remaining = listeners.filter(l => !l.once);
        if (remaining.length === 0) {
            this._listeners.delete(event);
        } else if (remaining.length < listeners.length) {
            this._listeners.set(event, remaining);
        }

        return true;
    }

    /**
     * Wait for an event using Promise.
     * @param {string} event - Event name
     * @param {number} [timeout=30000] - Timeout in ms. Defaults to 30s to prevent memory leaks.
     * @returns {Promise<*>} Resolves with event payload
     * @throws {Error} If timeout is reached
     */
    waitFor(event, timeout = DEFAULT_WAIT_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout waiting for event "${event}" after ${timeout}ms`));
            }, timeout);

            const unsubscribe = this.once(event, (payload) => {
                clearTimeout(timeoutId);
                resolve(payload);
            });
        });
    }

    /**
     * Check if there are listeners for an event.
     * @param {string} event - Event name
     * @returns {boolean} True if event has listeners
     */
    hasListeners(event) {
        return this._listeners.has(event);
    }

    /**
     * Get the number of listeners for an event.
     * @param {string} event - Event name
     * @returns {number} Listener count
     */
    listenerCount(event) {
        return this._listeners.get(event)?.length ?? 0;
    }

    /**
     * Get all registered event names.
     * @returns {string[]} Array of event names
     */
    eventNames() {
        return [...this._listeners.keys()];
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

    /**
     * Get listener counts for all registered events.
     * Useful for diagnostics and leak detection.
     * @returns {Object<string, number>} Map of event name to listener count
     */
    allListenerCounts() {
        const counts = {};
        for (const [event, listeners] of this._listeners) {
            counts[event] = listeners.length;
        }
        return counts;
    }

    /**
     * Set the warning threshold for listener count per event.
     * @param {number} threshold - New threshold value
     */
    setWarningThreshold(threshold) {
        this._warningThreshold = threshold;
    }
}
