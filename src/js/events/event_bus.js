// Path: js/events/event_bus.js

/**
 * @fileoverview EventBus factory for application-wide events.
 * Creates EventBus instances with event logging for debugging.
 *
 * Usage:
 *   import { createEventBus } from './events/event_bus.js';
 *   import { EventTypes } from './events/event_types.js';
 *
 *   const eventBus = createEventBus();
 *
 *   // Emit
 *   eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: 'map1' });
 *
 *   // Subscribe
 *   const unsub = eventBus.on(EventTypes.LAYERS_CHANGED, (payload) => {});
 *
 *   // Cleanup
 *   unsub();
 */

import { EventEmitter } from './event_emitter.js';

/** Maximum events to keep in debug log */
const MAX_EVENT_LOG = 100;

/** Maximum depth for payload cloning to prevent memory issues with nested objects */
const MAX_CLONE_DEPTH = 3;

/**
 * Deep clone with depth limit for safe logging.
 * Prevents memory issues from large nested objects (e.g., GeoJSON coordinates).
 * @param {*} obj - Object to clone
 * @param {number} [depth=0] - Current recursion depth
 * @returns {*} Cloned object or placeholder string
 * @private
 */
function safeClone(obj, depth = 0) {
    if (depth > MAX_CLONE_DEPTH) {
        return '[MAX_DEPTH]';
    }

    if (obj === null || obj === undefined) {
        return obj;
    }

    if (typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj);
    }

    if (Array.isArray(obj)) {
        // Summarize large arrays to prevent logging huge coordinate arrays
        if (obj.length > 10) {
            return `[Array(${obj.length})]`;
        }
        return obj.map(item => safeClone(item, depth + 1));
    }

    // Plain object
    const cloned = {};
    const keys = Object.keys(obj);

    // Summarize objects with many keys
    if (keys.length > 20) {
        return `[Object(${keys.length} keys)]`;
    }

    for (const key of keys) {
        cloned[key] = safeClone(obj[key], depth + 1);
    }

    return cloned;
}

/**
 * EventBus class.
 * Handles cross-component communication with logging.
 * @extends EventEmitter
 */
export class EventBus extends EventEmitter {
    constructor() {
        super();

        /**
         * Event log for debugging using circular buffer.
         * Uses O(1) operations instead of O(n) shift().
         * @type {Array<{timestamp: number, event: string, payload: *, listenerCount: number}|null>}
         * @private
         */
        this._eventLog = new Array(MAX_EVENT_LOG).fill(null);

        /**
         * Current write index in circular buffer.
         * @type {number}
         * @private
         */
        this._logIndex = 0;

        /**
         * Number of events stored (up to MAX_EVENT_LOG).
         * @type {number}
         * @private
         */
        this._logCount = 0;
    }

    /**
     * Emit event with logging.
     * @override
     * @param {string} event - Event name (use EventTypes constants)
     * @param {*} [payload] - Event data
     * @returns {boolean} True if event had listeners
     */
    emit(event, payload) {
        // Log event for debugging with safe cloned payload
        // Circular buffer - O(1) instead of O(n) shift()
        this._eventLog[this._logIndex] = {
            timestamp: Date.now(),
            event,
            payload: safeClone(payload),
            listenerCount: this.listenerCount(event),
        };

        this._logIndex = (this._logIndex + 1) % MAX_EVENT_LOG;
        this._logCount = Math.min(this._logCount + 1, MAX_EVENT_LOG);

        // Call parent emit (notifies all EventBus listeners)
        return super.emit(event, payload);
    }

    /**
     * Get recent events from the log.
     * Useful for debugging event flow.
     * @param {number} [count=20] - Number of events to return
     * @returns {Array<{timestamp: number, event: string, payload: *, listenerCount: number}>}
     */
    getEventLog(count = 20) {
        const actualCount = Math.min(count, this._logCount);
        if (actualCount === 0) return [];

        // Reconstruct array in chronological order from circular buffer
        const result = [];
        const startIndex = this._logCount < MAX_EVENT_LOG
            ? 0
            : this._logIndex;

        for (let i = 0; i < this._logCount; i++) {
            const index = (startIndex + i) % MAX_EVENT_LOG;
            if (this._eventLog[index]) {
                result.push(this._eventLog[index]);
            }
        }

        // Return only the last 'count' events
        return result.slice(-actualCount);
    }

    /**
     * Get events filtered by type.
     * @param {string} eventType - Event type to filter by
     * @param {number} [count=20] - Max events to return
     * @returns {Array<{timestamp: number, event: string, payload: *, listenerCount: number}>}
     */
    getEventLogByType(eventType, count = 20) {
        return this._eventLog
            .filter(entry => entry.event === eventType)
            .slice(-count);
    }

    /**
     * Clear the event log.
     */
    clearEventLog() {
        this._eventLog.fill(null);
        this._logIndex = 0;
        this._logCount = 0;
    }

    /**
     * Get debug information about EventBus state.
     * @returns {Object} Debug info including listener counts and recent events
     */
    debug() {
        const listenersByEvent = {};
        for (const event of this.eventNames()) {
            listenersByEvent[event] = this.listenerCount(event);
        }

        return {
            totalListeners: this.totalListenerCount(),
            listenersByEvent,
            recentEvents: this.getEventLog(10),
            logSize: this._logCount,
        };
    }
}

/**
 * Factory function to create EventBus instance.
 * Use this instead of direct instantiation for better testability.
 * @returns {EventBus} New EventBus instance
 */
export function createEventBus() {
    return new EventBus();
}
