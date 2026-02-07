// Path: js/events/event_bus.js

/**
 * @fileoverview EventBus factory for application-wide events.
 * Creates EventBus instances for cross-component communication.
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

/**
 * EventBus class.
 * Handles cross-component communication.
 * @extends EventEmitter
 */
export class EventBus extends EventEmitter {
    /**
     * Get debug information about EventBus state.
     * @returns {Object} Debug info including listener counts
     */
    debug() {
        const listenersByEvent = {};
        for (const event of this.eventNames()) {
            listenersByEvent[event] = this.listenerCount(event);
        }

        return {
            totalListeners: this.totalListenerCount(),
            listenersByEvent,
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
