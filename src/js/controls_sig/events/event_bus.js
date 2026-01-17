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
         * @type {Array<{timestamp: number, event: string, payload: *}>}
         * @private
         */
        this._eventLog = [];
    }

    /**
     * Emit event with logging.
     * @override
     * @param {string} event - Event name (use EventTypes constants)
     * @param {*} [payload] - Event data
     */
    emit(event, payload) {
        // Log event for debugging
        this._eventLog.push({
            timestamp: Date.now(),
            event,
            payload: payload ? { ...payload } : null,
        });

        // Trim log if exceeds max size
        if (this._eventLog.length > MAX_EVENT_LOG) {
            this._eventLog.shift();
        }

        // Call parent emit (notifies all EventBus listeners)
        super.emit(event, payload);
    }

    /**
     * Get recent events from the log.
     * Useful for debugging event flow.
     * @param {number} [count=20] - Number of events to return
     * @returns {Array<{timestamp: number, event: string, payload: *}>}
     */
    getEventLog(count = 20) {
        return this._eventLog.slice(-count);
    }

    /**
     * Clear the event log.
     */
    clearEventLog() {
        this._eventLog = [];
    }

    /**
     * Get debug information about EventBus state.
     * @returns {Object} Debug info including listener counts and recent events
     */
    debug() {
        return {
            listenerCount: Array.from(this._listeners.values())
                .reduce((sum, arr) => sum + arr.length, 0),
            eventNames: this.eventNames(),
            recentEvents: this.getEventLog(5),
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
