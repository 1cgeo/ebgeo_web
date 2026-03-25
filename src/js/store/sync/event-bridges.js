// Path: js/store/sync/event-bridges.js

/**
 * @fileoverview Bridges between observer-pattern singletons and EventBus.
 * SessionContext and ConnectionState use internal observer patterns.
 * This module subscribes to them and re-emits events on the EventBus
 * so that any component can react via the standard event system.
 */

import { sessionContext } from './session-context.js';
import { connectionState } from './connection-state.js';
import { EventTypes } from '../../events/event_types.js';

/**
 * Bridges SessionContext observer to EventBus.
 * Emits SESSION_CHANGED on login/logout transitions.
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function initSessionEventBridge(eventBus) {
    sessionContext.onSessionChanged((snapshot) => {
        eventBus.emit(EventTypes.SESSION_CHANGED, snapshot);
    });
}

/**
 * Bridges ConnectionState observer to EventBus.
 * Emits CONNECTION_STATE_CHANGED on state transitions.
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function initConnectionEventBridge(eventBus) {
    connectionState.onStateChanged(({ previousState, currentState }) => {
        eventBus.emit(EventTypes.CONNECTION_STATE_CHANGED, {
            previousState,
            currentState
        });
    });
}
