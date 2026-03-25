// Path: js/events/event_bus.js
/**
 * @fileoverview EventBus factory for application-wide events.
 * Creates EventBus instances for cross-component communication.
 */

import { EventEmitter } from './event_emitter.js';

/**
 * EventBus for cross-component communication.
 * @extends EventEmitter
 */
export class EventBus extends EventEmitter {
    /**
     * Get debug information about EventBus state.
     * @returns {{ totalListeners: number, listenersByEvent: Object<string, number> }}
     */
    debug() {
        return {
            totalListeners: this.totalListenerCount(),
            listenersByEvent: this.allListenerCounts(),
        };
    }
}

/**
 * Factory function to create EventBus instance.
 * @returns {EventBus}
 */
export function createEventBus() {
    return new EventBus();
}
