// Path: js/utilities/toast_service.js

/**
 * @fileoverview Toast notification service.
 * Styles defined in src/css/toast.css using BEM classes and design tokens.
 */

/** @type {number} */
const DEFAULT_DURATION = 3000;

/** @type {string} */
const DEFAULT_POSITION = 'top-center';

/** @type {number} Spacing between stacked toasts in pixels */
const TOAST_STACK_GAP = 60;

/** @type {number} Base offset for top-center position */
const TOP_CENTER_BASE = 80;

/** @type {number} Base offset for other positions */
const EDGE_BASE = 20;

/** @type {number} CSS transition duration in ms (must match --transition-slow) */
const TRANSITION_MS = 300;

/** @type {Set<HTMLElement>} */
const activeToasts = new Set();

/** @type {Map<string, HTMLElement>} */
const channelToasts = new Map();

/**
 * Applies vertical position to a toast element based on its stack index.
 * @param {HTMLElement} toast - Toast element
 * @param {string} position - Position identifier
 * @param {number} stackIndex - Index in the active toast stack
 */
function applyPosition(toast, position, stackIndex) {
    const offset = stackIndex * TOAST_STACK_GAP;
    const isTop = position.startsWith('top');
    const prop = isTop ? 'top' : 'bottom';
    const base = (position === 'top-center') ? TOP_CENTER_BASE : EDGE_BASE;

    toast.style[prop] = `${base + offset}px`;

    if (position.endsWith('right')) {
        toast.style.right = `${EDGE_BASE}px`;
    } else if (position.endsWith('left')) {
        toast.style.left = `${EDGE_BASE}px`;
    }
}

/**
 * Builds CSS class list for a toast element.
 * @param {string} type - Toast type (success, error, info, warning)
 * @param {string} position - Position identifier
 * @returns {string[]} Array of CSS class names
 */
function buildClassList(type, position) {
    const classes = ['toast', `toast--${type}`];
    const isTop = position.startsWith('top');

    classes.push(isTop ? 'toast--top' : 'toast--bottom');

    if (position.endsWith('center')) {
        classes.push('toast--center');
    }

    return classes;
}

/**
 * Creates toast DOM element.
 * @param {string} message - Message to display
 * @param {string} type - Toast type
 * @param {Object} config - Toast configuration
 * @returns {HTMLElement} Toast element
 */
function createToastElement(message, type, config) {
    const toast = document.createElement('div');
    toast.className = buildClassList(type, config.position).join(' ');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const content = document.createElement('div');
    content.className = 'toast__content';

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    content.appendChild(messageSpan);

    if (config.closable) {
        const closeButton = document.createElement('button');
        closeButton.className = 'toast__close';
        closeButton.textContent = '\u00D7';
        closeButton.addEventListener('click', () => hideToast(toast));
        content.appendChild(closeButton);
    }

    toast.appendChild(content);
    return toast;
}

/**
 * Repositions all active toasts after one is removed.
 */
function repositionActiveToasts() {
    let index = 0;
    for (const toast of activeToasts) {
        const position = toast.dataset.position;
        const isTop = position.startsWith('top');
        const prop = isTop ? 'top' : 'bottom';
        const base = (position === 'top-center') ? TOP_CENTER_BASE : EDGE_BASE;

        toast.style[prop] = `${base + index * TOAST_STACK_GAP}px`;
        index++;
    }
}

/**
 * Hides a specific toast with exit animation.
 * @param {HTMLElement} toast - Toast element to hide
 */
function hideToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.classList.remove('toast--visible');

    setTimeout(() => {
        toast.remove();
        activeToasts.delete(toast);
        repositionActiveToasts();
    }, TRANSITION_MS);
}

/**
 * Displays a toast notification.
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type (success, error, info, warning)
 * @param {Object} [options] - Additional options
 * @param {number} [options.duration] - Duration in ms (0 = infinite)
 * @param {string} [options.position] - Toast position
 * @param {boolean} [options.closable] - Whether manually closable
 * @returns {HTMLElement} Toast element
 */
function showToast(message, type = 'info', options = {}) {
    const config = {
        duration: options.duration ?? DEFAULT_DURATION,
        position: options.position ?? DEFAULT_POSITION,
        closable: options.closable ?? false,
    };

    const toast = createToastElement(message, type, config);
    toast.dataset.position = config.position;

    applyPosition(toast, config.position, activeToasts.size);
    document.body.appendChild(toast);
    activeToasts.add(toast);

    requestAnimationFrame(() => {
        toast.classList.add('toast--visible');
    });

    if (config.duration > 0) {
        setTimeout(() => hideToast(toast), config.duration);
    }

    return toast;
}

/**
 * Displays a success toast.
 * @param {string} message - Success message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showSuccess(message, options = {}) {
    return showToast(message, 'success', options);
}

/**
 * Displays an error toast with extended duration.
 * @param {string} message - Error message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showError(message, options = {}) {
    return showToast(message, 'error', { duration: 4000, ...options });
}

/**
 * Displays a warning toast.
 * @param {string} message - Warning message
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showWarning(message, options = {}) {
    return showToast(message, 'warning', options);
}

/**
 * Shows a toast in a named channel, replacing any existing toast in that channel
 * immediately (no fade-out delay). Prevents stacking on rapid repeated calls.
 *
 * @param {string} channel - Channel name (e.g., 'undo-redo')
 * @param {string} message - Message to display
 * @param {string} [type='info'] - Toast type
 * @param {Object} [options] - Additional options
 * @returns {HTMLElement} Toast element
 */
function showInChannel(channel, message, type = 'info', options = {}) {
    const existing = channelToasts.get(channel);
    if (existing && existing.parentNode) {
        existing.remove();
        activeToasts.delete(existing);
        repositionActiveToasts();
    }

    const toast = showToast(message, type, options);
    channelToasts.set(channel, toast);
    return toast;
}

export { showToast, showSuccess, showError, showWarning, showInChannel };

export default {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInChannel,
};
