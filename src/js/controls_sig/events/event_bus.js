// Path: js/controls_sig/events/event_bus.js

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
         * Event log for debugging. Stores recent events with timestamps.
         * Uses safe cloning to prevent memory leaks from large payloads.
         * @type {Array<{timestamp: number, event: string, payload: *, listenerCount: number}>}
         * @private
         */
        this._eventLog = [];
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
        this._eventLog.push({
            timestamp: Date.now(),
            event,
            payload: safeClone(payload),
            listenerCount: this.listenerCount(event),
        });

        // Trim log if exceeds max size
        if (this._eventLog.length > MAX_EVENT_LOG) {
            this._eventLog.shift();
        }

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
        return this._eventLog.slice(-count);
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
        this._eventLog.length = 0;
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
            logSize: this._eventLog.length,
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
