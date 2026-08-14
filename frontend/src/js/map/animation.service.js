// Path: js/map/animation.service.js

/**
 * @fileoverview Map animation service for flyTo transitions.
 * Provides centralized, Promise-based animation control for MapLibre.
 *
 * @module map/animation.service
 */

/** Animation duration presets in milliseconds. */
export const ANIMATION_DURATION = Object.freeze({
    INSTANT: 0,
    FAST: 500,
    NORMAL: 1000,
    SLOW: 2000,
    BRIEFING_TRANSITION: 3000
});

const DEFAULT_DURATION = ANIMATION_DURATION.NORMAL;

/**
 * Returns a Promise that resolves on the next `event` fired by `map`.
 * The listener removes itself after firing once.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} event - Event name to wait for
 * @returns {Promise<void>}
 */
function waitForEvent(map, event) {
    return new Promise((resolve) => {
        function handler() {
            map.off(event, handler);
            resolve();
        }
        map.on(event, handler);
    });
}

/**
 * Validates that `map` exists and `lng`/`lat` are numbers.
 * Returns an Error if invalid, or null if valid.
 *
 * @param {Object} map
 * @param {number} lng
 * @param {number} lat
 * @returns {Error|null}
 */
function validateMapAndCoords(map, lng, lat) {
    if (!map) return new Error('Map instance is required');
    if (typeof lng !== 'number' || typeof lat !== 'number') return new Error('lng and lat are required');
    return null;
}

/**
 * Assigns numeric-typed optional fields from `source` onto `target`.
 *
 * @param {Object} target
 * @param {Object} source
 * @param {string[]} keys
 */
function assignOptionalNumbers(target, source, keys) {
    for (const key of keys) {
        if (typeof source[key] === 'number') {
            target[key] = source[key];
        }
    }
}

/**
 * Shared implementation for flyTo / easeTo transitions.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} method - 'flyTo' or 'easeTo'
 * @param {Object} options - Animation options
 * @param {string[]} [extraNumericKeys] - Additional numeric fields to copy (e.g. curve, minZoom)
 * @returns {Promise<void>}
 */
function animateTo(map, method, options, extraNumericKeys = []) {
    const { lng, lat, bearing = 0, pitch = 0, duration = DEFAULT_DURATION } = options;

    const error = validateMapAndCoords(map, lng, lat);
    if (error) return Promise.reject(error);

    const animOptions = { center: [lng, lat], bearing, pitch, duration, essential: true };
    assignOptionalNumbers(animOptions, options, ['zoom', ...extraNumericKeys]);

    if (duration === 0) {
        map.jumpTo(animOptions);
        return Promise.resolve();
    }

    map[method](animOptions);
    return waitForEvent(map, 'moveend');
}

/**
 * Performs a flyTo animation with Promise support.
 * Uses jumpTo if duration is 0.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - Animation options
 * @param {number} options.lng - Target longitude
 * @param {number} options.lat - Target latitude
 * @param {number} [options.zoom] - Target zoom level
 * @param {number} [options.bearing=0] - Target bearing
 * @param {number} [options.pitch=0] - Target pitch
 * @param {number} [options.duration=1000] - Animation duration in ms
 * @param {number} [options.curve] - Zoom curve factor (lower = shallower arc)
 * @param {number} [options.minZoom] - Minimum zoom during animation
 * @returns {Promise<void>}
 */
export function flyTo(map, options) {
    return animateTo(map, 'flyTo', options, ['curve', 'minZoom']);
}

/**
 * Fits the map to specified bounds with animation.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Array} bounds - [[west, south], [east, north]]
 * @param {Object} [options] - Animation and padding options
 * @param {number} [options.duration=1000] - Animation duration in ms
 * @param {number} [options.padding=50] - Padding in pixels
 * @param {number} [options.maxZoom=18] - Maximum zoom level
 * @returns {Promise<void>}
 */
export function fitBounds(map, bounds, options = {}) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const { duration = DEFAULT_DURATION, padding = 50, maxZoom = 18 } = options;

    const fitOptions = { padding, maxZoom, duration, essential: true };

    if (duration === 0) {
        map.fitBounds(bounds, { ...fitOptions, duration: 0 });
        return Promise.resolve();
    }

    map.fitBounds(bounds, fitOptions);
    return waitForEvent(map, 'moveend');
}

