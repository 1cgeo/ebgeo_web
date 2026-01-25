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
            if (element) {
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

// ============================================================================
// MIXIN CLASS
// ============================================================================

/**
 * EventCleanupMixin - Class mixin for components.
 * Adds protected methods for event and DOM listener management with automatic cleanup.
 *
 * Usage: class MyClass extends EventCleanupMixin(BaseClass)
 *
 * @param {Function} [Base=class {}] - Base class to extend
 * @returns {Function} Extended class with cleanup methods
 *
 * @example
 * class MySidebar extends EventCleanupMixin() {
 *     constructor(eventBus) {
 *         super();
 *         this._eventBus = eventBus;
 *         this._initEventListeners();
 *     }
 *
 *     _initEventListeners() {
 *         this._subscribe(this._eventBus, EventTypes.UI_LAYOUT_CHANGED, this._handleLayout.bind(this));
 *         this._addDomListener(this._element, 'click', this._handleClick.bind(this));
 *     }
 *
 *     destroy() {
 *         this._cleanup();
 *     }
 * }
 *
 * @example
 * // With a base class
 * class MyControl extends EventCleanupMixin(BaseControl) {
 *     constructor(options) {
 *         super(options);
 *         // Cleanup is already initialized by mixin
 *     }
 * }
 */
export function EventCleanupMixin(Base = class {}) {
    return class extends Base {
        constructor(...args) {
            super(...args);
            this._unsubscribers = [];
            this._domListeners = [];
            this._timers = [];
        }

        /**
         * Subscribe to EventBus event with automatic cleanup tracking.
         * @protected
         * @param {Object} eventBus - The event bus instance
         * @param {string} eventType - Event type constant
         * @param {Function} handler - Event handler function
         */
        _subscribe(eventBus, eventType, handler) {
            subscribe(this, eventBus, eventType, handler);
        }

        /**
         * Add DOM event listener with automatic cleanup tracking.
         * @protected
         * @param {HTMLElement} element - DOM element
         * @param {string} event - Event name (e.g., 'click')
         * @param {Function} handler - Event handler function
         * @param {Object} [options] - addEventListener options
         */
        _addDomListener(element, event, handler, options) {
            addDomListener(this, element, event, handler, options);
        }

        /**
         * Track a timer for cleanup.
         * @protected
         * @param {number} timerId - Timer ID from setTimeout or setInterval
         * @param {string} [type='timeout'] - 'timeout' or 'interval'
         */
        _trackTimer(timerId, type = 'timeout') {
            trackTimer(this, timerId, type);
        }

        /**
         * Cleanup all tracked resources.
         * @protected
         */
        _cleanup() {
            cleanup(this);
        }

        /**
         * Remove a DOM element safely.
         * @protected
         * @param {HTMLElement} element - Element to remove
         */
        _removeElement(element) {
            removeElement(element);
        }

        /**
         * Destroy the component.
         * Override this method and call super.destroy() at the end.
         */
        destroy() {
            this._cleanup();
            if (super.destroy) {
                super.destroy();
            }
        }
    };
}

