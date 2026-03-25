// Path: js/utilities/event-cleanup.js
/**
 * @fileoverview Event listener cleanup utility.
 * Provides composition-style functions for managing event subscriptions,
 * DOM listeners, and timers with automatic cleanup.
 */

/**
 * Ensure cleanup arrays exist on instance, warning if setupCleanup was missed.
 * @param {Object} instance - The component instance
 * @param {string} callerName - Name of the calling function for the warning
 */
function ensureSetup(instance, callerName) {
    if (!instance._unsubscribers) {
        console.warn(`${callerName} called without setupCleanup. Call setupCleanup first.`);
        setupCleanup(instance);
    }
}

/**
 * Initialize cleanup tracking arrays on an instance.
 * Call this in the constructor of any component that needs cleanup.
 * @param {Object} instance - The component instance
 *
 * @example
 * class MyComponent {
 *     constructor() {
 *         setupCleanup(this);
 *         this._initEventListeners();
 *     }
 * }
 */
export function setupCleanup(instance) {
    instance._unsubscribers = [];
    instance._domListeners = [];
    instance._timers = [];
}

/**
 * Subscribe to an EventBus event with automatic cleanup tracking.
 * @param {Object} instance - The component instance
 * @param {Object} eventBus - The event bus instance
 * @param {string} eventType - Event type constant
 * @param {Function} handler - Event handler function
 *
 * @example
 * subscribe(this, eventBus, EventTypes.UI_LAYOUT_CHANGED, this._handleLayoutChanged.bind(this));
 */
export function subscribe(instance, eventBus, eventType, handler) {
    ensureSetup(instance, 'subscribe');
    const unsubscribe = eventBus.on(eventType, handler);
    instance._unsubscribers.push(unsubscribe);
}

/**
 * Add a DOM event listener with automatic cleanup tracking.
 * @param {Object} instance - The component instance
 * @param {HTMLElement} element - DOM element
 * @param {string} event - Event name (e.g., 'click')
 * @param {Function} handler - Event handler function
 * @param {Object} [options] - addEventListener options
 *
 * @example
 * addDomListener(this, this._button, 'click', this._handleClick.bind(this));
 */
export function addDomListener(instance, element, event, handler, options = {}) {
    if (!element) {
        console.warn('addDomListener called with null element');
        return;
    }

    ensureSetup(instance, 'addDomListener');
    element.addEventListener(event, handler, options);
    instance._domListeners.push({ element, event, handler, options });
}

/**
 * Track a timer for cleanup.
 * @param {Object} instance - The component instance
 * @param {number} timerId - Timer ID from setTimeout or setInterval
 * @param {string} [type='timeout'] - 'timeout' or 'interval'
 *
 * @example
 * const timerId = setTimeout(() => doSomething(), 1000);
 * trackTimer(this, timerId, 'timeout');
 */
export function trackTimer(instance, timerId, type = 'timeout') {
    ensureSetup(instance, 'trackTimer');
    instance._timers.push({ id: timerId, type });
}

/**
 * Perform full cleanup of all tracked resources.
 * Call this in the destroy() method of components.
 * @param {Object} instance - The component instance
 *
 * @example
 * destroy() {
 *     cleanup(this);
 *     // ... other cleanup code
 * }
 */
export function cleanup(instance) {
    if (instance._unsubscribers) {
        for (const unsub of instance._unsubscribers) {
            if (typeof unsub === 'function') {
                unsub();
            }
        }
        instance._unsubscribers = [];
    }

    if (instance._domListeners) {
        for (const { element, event, handler, options } of instance._domListeners) {
            element?.removeEventListener(event, handler, options);
        }
        instance._domListeners = [];
    }

    if (instance._timers) {
        for (const { id, type } of instance._timers) {
            if (type === 'interval') {
                clearInterval(id);
            } else {
                clearTimeout(id);
            }
        }
        instance._timers = [];
    }
}

/**
 * Remove DOM element safely.
 * @param {HTMLElement} element - Element to remove
 */
export function removeElement(element) {
    element?.remove();
}
