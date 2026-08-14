// Path: js/utilities/pointer-utils.js
/**
 * Pointer/Touch Utilities
 * Unified support for mouse and touch input.
 */

/**
 * Detects whether the device supports touch input.
 * @returns {boolean}
 */
export function isTouchDevice() {
    return 'ontouchstart' in window
        || navigator.maxTouchPoints > 0
        || window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Returns the pointer position (mouse or touch) relative to a canvas element.
 * @param {PointerEvent|MouseEvent|TouchEvent} event
 * @param {HTMLElement} canvas
 * @returns {{x: number, y: number}}
 */
export function getPointerPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];

    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;

    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

/**
 * Calculates the midpoint between two touches.
 * @param {TouchList} touches
 * @returns {{x: number, y: number}}
 */
export function getTouchesMidpoint(touches) {
    if (touches.length < 2) {
        return { x: touches[0].clientX, y: touches[0].clientY };
    }
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
    };
}

/**
 * Calculates the angle between two touches (for rotation gestures).
 * @param {TouchList} touches
 * @returns {number} Angle in degrees
 */
export function getTouchesAngle(touches) {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.atan2(dy, dx) * (180 / Math.PI);
}

/**
 * Calculates the distance between two touches (for pinch-zoom gestures).
 * @param {TouchList} touches
 * @returns {number}
 */
export function getTouchesDistance(touches) {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.hypot(dx, dy);
}

/**
 * Creates a long-press handler with movement cancellation.
 * @param {HTMLElement} element
 * @param {Function} callback - Called when long-press is detected
 * @param {Object} options
 * @param {number} options.duration - Duration in ms (default: 500)
 * @param {number} options.moveThreshold - Movement pixels to cancel (default: 10)
 * @returns {Function} Cleanup function to remove all listeners
 */
export function createLongPressHandler(element, callback, options = {}) {
    const { duration = 500, moveThreshold = 10 } = options;

    let timer = null;
    let startPos = null;

    function onTouchStart(e) {
        if (e.touches.length !== 1) return;

        startPos = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        };

        timer = setTimeout(() => {
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            callback(e, startPos);
        }, duration);
    }

    function onTouchMove(e) {
        if (!timer || !startPos) return;

        const touch = e.touches[0];
        const dist = Math.hypot(
            touch.clientX - startPos.x,
            touch.clientY - startPos.y
        );

        if (dist > moveThreshold) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function onTouchEnd() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        startPos = null;
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);

    return function cleanup() {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
        if (timer) clearTimeout(timer);
    };
}

/**
 * Creates a handler for two-finger tap gestures.
 * @param {HTMLElement} element
 * @param {Function} callback - Called with (event, midpoint)
 * @param {Object} options
 * @param {number} options.maxDuration - Maximum tap duration in ms (default: 300)
 * @param {number} options.maxDistance - Maximum movement distance in px (default: 20)
 * @returns {Function} Cleanup function to remove all listeners
 */
export function createTwoFingerTapHandler(element, callback, options = {}) {
    const { maxDuration = 300, maxDistance = 20 } = options;

    let twoFingerStart = null;

    function onTouchStart(e) {
        if (e.touches.length === 2) {
            twoFingerStart = {
                time: Date.now(),
                midpoint: getTouchesMidpoint(e.touches),
                distance: getTouchesDistance(e.touches)
            };
        } else {
            twoFingerStart = null;
        }
    }

    function onTouchMove(e) {
        if (!twoFingerStart || e.touches.length !== 2) return;

        const currentMidpoint = getTouchesMidpoint(e.touches);
        const dist = Math.hypot(
            currentMidpoint.x - twoFingerStart.midpoint.x,
            currentMidpoint.y - twoFingerStart.midpoint.y
        );

        if (dist > maxDistance) {
            twoFingerStart = null;
        }
    }

    function onTouchEnd(e) {
        if (!twoFingerStart) return;

        if (e.touches.length === 0) {
            const elapsed = Date.now() - twoFingerStart.time;
            if (elapsed < maxDuration) {
                callback(e, twoFingerStart.midpoint);
            }
        }
        twoFingerStart = null;
    }

    function onTouchCancel() {
        twoFingerStart = null;
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchCancel);

    return function cleanup() {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchCancel);
    };
}

/**
 * Creates a handler for two-finger drag gestures (rotation/pitch).
 * @param {HTMLElement} element
 * @param {Object} callbacks
 * @param {Function} callbacks.onStart - Called with (initialState)
 * @param {Function} callbacks.onMove - Called with (angleDelta, midpointDelta, currentMidpoint)
 * @param {Function} callbacks.onEnd - Called when gesture ends
 * @returns {Function} Cleanup function to remove all listeners
 */
export function createTwoFingerDragHandler(element, callbacks) {
    const { onStart, onMove, onEnd } = callbacks;

    let initialState = null;
    let isActive = false;

    function onTouchStart(e) {
        if (e.touches.length !== 2) return;

        e.preventDefault();
        isActive = true;

        initialState = {
            angle: getTouchesAngle(e.touches),
            midpoint: getTouchesMidpoint(e.touches),
            distance: getTouchesDistance(e.touches)
        };

        onStart?.(initialState);
    }

    function onTouchMove(e) {
        if (!isActive || e.touches.length !== 2 || !initialState) return;

        e.preventDefault();

        const currentAngle = getTouchesAngle(e.touches);
        const currentMidpoint = getTouchesMidpoint(e.touches);

        const angleDelta = currentAngle - initialState.angle;
        const midpointDelta = {
            x: currentMidpoint.x - initialState.midpoint.x,
            y: currentMidpoint.y - initialState.midpoint.y
        };

        onMove?.(angleDelta, midpointDelta, currentMidpoint);
    }

    function onTouchEnd(e) {
        if (!isActive) return;

        if (e.touches.length < 2) {
            isActive = false;
            initialState = null;
            onEnd?.();
        }
    }

    element.addEventListener('touchstart', onTouchStart, { passive: false });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);

    return function cleanup() {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
    };
}

/**
 * Prevents default browser gestures on an element (for drawing surfaces).
 * Uses inline styles since these are runtime-dynamic toggles.
 * @param {HTMLElement} element
 */
export function preventDefaultGestures(element) {
    element.style.touchAction = 'none';
    element.style.userSelect = 'none';
    element.style.webkitUserSelect = 'none';
    element.style.webkitTouchCallout = 'none';
}

/**
 * Restores default browser gestures on an element.
 * @param {HTMLElement} element
 */
export function restoreDefaultGestures(element) {
    element.style.touchAction = '';
    element.style.userSelect = '';
    element.style.webkitUserSelect = '';
    element.style.webkitTouchCallout = '';
}
