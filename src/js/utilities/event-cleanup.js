// Path: js/utilities/event-cleanup.js

/**
 * @fileoverview Event listener cleanup utility.
 * Provides a consistent pattern for managing event subscriptions and DOM listeners.
 *
 * This module offers two usage patterns:
 * 1. Standalone functions for composition-style usage
 * 2. Mixin class for inheritance-based components
 */

// ============================================================================
// STANDALONE FUNCTIONS
// ============================================================================

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
    if (!instance._unsubscribers) {
        console.warn('subscribe called without setupCleanup. Call setupCleanup first.');
        setupCleanup(instance);
    }
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

    if (!instance._domListeners) {
        console.warn('addDomListener called without setupCleanup. Call setupCleanup first.');
        setupCleanup(instance);
    }

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
    if (!instance._timers) {
        console.warn('trackTimer called without setupCleanup. Call setupCleanup first.');
        setupCleanup(instance);
    }
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
    // Cleanup EventBus subscriptions
    if (instance._unsubscribers) {
        instance._unsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') {
                unsub();
            }
        });
        instance._unsubscribers = [];
    }

    // Cleanup DOM listeners
    if (instance._domListeners) {
        instance._domListeners.forEach(({ element, event, handler, options }) => {
            if (element && typeof element.removeEventListener === 'function') {
                element.removeEventListener(event, handler, options);
            }
        });
        instance._domListeners = [];
    }

    // Cleanup timers
    if (instance._timers) {
        instance._timers.forEach(({ id, type }) => {
            if (type === 'interval') {
                clearInterval(id);
            } else {
                clearTimeout(id);
            }
        });
        instance._timers = [];
    }
}

/**
 * Remove DOM element safely.
 * @param {HTMLElement} element - Element to remove
 */
export function removeElement(element) {
    if (element && element.parentNode) {
        element.parentNode.removeChild(element);
    }
}

