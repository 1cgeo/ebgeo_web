// Path: js/map/animation.service.js

/**
 * @fileoverview Map animation service for flyTo transitions.
 * Provides centralized, Promise-based animation control for MapLibre.
 *
 * @module map/animation.service
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Animation duration presets in milliseconds.
 * @type {Object}
 */
export const ANIMATION_DURATION = Object.freeze({
    /** No animation, instant transition */
    INSTANT: 0,
    /** Fast transition (500ms) */
    FAST: 500,
    /** Normal transition (1000ms) */
    NORMAL: 1000,
    /** Slow transition (2000ms) */
    SLOW: 2000,
    /** Briefing slide transition (3000ms) */
    BRIEFING_TRANSITION: 3000
});

/**
 * Default animation options.
 * @type {Object}
 */
const DEFAULT_OPTIONS = {
    duration: ANIMATION_DURATION.NORMAL,
    essential: true
};

// ============================================================================
// POSITION CAPTURE
// ============================================================================

/**
 * Captures the current map position.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {Object} Position object with { lng, lat, zoom, bearing, pitch }
 */
export function capturePosition(map) {
    if (!map) {
        throw new Error('Map instance is required');
    }

    const center = map.getCenter();
    return {
        lng: center.lng,
        lat: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch()
    };
}

/**
 * Captures position with optional altitude for 3D context.
 * Useful for coordinating with Cesium viewer.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} [altitude] - Optional altitude in meters
 * @returns {Object} Extended position object
 */
export function capturePositionExtended(map, altitude = null) {
    const position = capturePosition(map);
    return {
        ...position,
        altitude
    };
}

// ============================================================================
// FLY TO ANIMATION
// ============================================================================

/**
 * Performs a flyTo animation with Promise support.
 * Uses jumpTo if duration is 0.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - Animation options
 * @param {number} options.lng - Target longitude
 * @param {number} options.lat - Target latitude
 * @param {number} [options.zoom] - Target zoom level
 * @param {number} [options.bearing=0] - Target bearing (rotation)
 * @param {number} [options.pitch=0] - Target pitch (tilt)
 * @param {number} [options.duration=1000] - Animation duration in ms
 * @param {number} [options.curve] - Zoom curve factor (default 1.42). Lower = shallower arc.
 * @param {number} [options.minZoom] - Minimum zoom during animation (prevents extreme zoom-out)
 * @returns {Promise<void>} Resolves when animation completes
 */
export function flyTo(map, options) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const {
        lng,
        lat,
        zoom,
        bearing = 0,
        pitch = 0,
        duration = DEFAULT_OPTIONS.duration,
        curve,
        minZoom
    } = options;

    // Validate required parameters
    if (typeof lng !== 'number' || typeof lat !== 'number') {
        return Promise.reject(new Error('lng and lat are required'));
    }

    // Build flyTo options
    const flyToOptions = {
        center: [lng, lat],
        bearing,
        pitch,
        duration,
        essential: true
    };

    // Only add zoom if provided
    if (typeof zoom === 'number') {
        flyToOptions.zoom = zoom;
    }

    // Curve controls how much the map zooms out during the arc (lower = shallower)
    if (typeof curve === 'number') {
        flyToOptions.curve = curve;
    }

    // Prevent zooming out below this level during animation
    if (typeof minZoom === 'number') {
        flyToOptions.minZoom = minZoom;
    }

    // Instant transition (no animation)
    if (duration === 0) {
        map.jumpTo(flyToOptions);
        return Promise.resolve();
    }

    // Animated transition
    return new Promise((resolve) => {
        const onMoveEnd = () => {
            map.off('moveend', onMoveEnd);
            resolve();
        };

        map.on('moveend', onMoveEnd);
        map.flyTo(flyToOptions);
    });
}

/**
 * Restores a previously captured position.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} position - Position object from capturePosition
 * @param {Object} [options] - Animation options
 * @param {number} [options.duration=1000] - Animation duration in ms
 * @returns {Promise<void>} Resolves when animation completes
 */
export function restorePosition(map, position, options = {}) {
    if (!position) {
        return Promise.reject(new Error('Position is required'));
    }

    return flyTo(map, {
        lng: position.lng,
        lat: position.lat,
        zoom: position.zoom,
        bearing: position.bearing || 0,
        pitch: position.pitch || 0,
        duration: options.duration ?? DEFAULT_OPTIONS.duration
    });
}

// ============================================================================
// EASE TO ANIMATION
// ============================================================================

/**
 * Performs an easeTo animation with Promise support.
 * Similar to flyTo but with different easing for shorter distances.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - Animation options (same as flyTo)
 * @returns {Promise<void>} Resolves when animation completes
 */
export function easeTo(map, options) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const {
        lng,
        lat,
        zoom,
        bearing = 0,
        pitch = 0,
        duration = DEFAULT_OPTIONS.duration
    } = options;

    // Validate required parameters
    if (typeof lng !== 'number' || typeof lat !== 'number') {
        return Promise.reject(new Error('lng and lat are required'));
    }

    // Build easeTo options
    const easeToOptions = {
        center: [lng, lat],
        bearing,
        pitch,
        duration,
        essential: true
    };

    // Only add zoom if provided
    if (typeof zoom === 'number') {
        easeToOptions.zoom = zoom;
    }

    // Instant transition (no animation)
    if (duration === 0) {
        map.jumpTo(easeToOptions);
        return Promise.resolve();
    }

    // Animated transition
    return new Promise((resolve) => {
        const onMoveEnd = () => {
            map.off('moveend', onMoveEnd);
            resolve();
        };

        map.on('moveend', onMoveEnd);
        map.easeTo(easeToOptions);
    });
}

// ============================================================================
// ZOOM ANIMATIONS
// ============================================================================

/**
 * Zooms to a specific level with animation.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} zoom - Target zoom level
 * @param {Object} [options] - Animation options
 * @param {number} [options.duration=500] - Animation duration in ms
 * @returns {Promise<void>} Resolves when animation completes
 */
export function zoomTo(map, zoom, options = {}) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const duration = options.duration ?? ANIMATION_DURATION.FAST;

    if (duration === 0) {
        map.setZoom(zoom);
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const onZoomEnd = () => {
            map.off('zoomend', onZoomEnd);
            resolve();
        };

        map.on('zoomend', onZoomEnd);
        map.zoomTo(zoom, { duration });
    });
}

/**
 * Zooms in by a specified amount.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} [amount=1] - Zoom levels to increase
 * @param {Object} [options] - Animation options
 * @returns {Promise<void>} Resolves when animation completes
 */
export function zoomIn(map, amount = 1, options = {}) {
    const currentZoom = map.getZoom();
    return zoomTo(map, currentZoom + amount, options);
}

/**
 * Zooms out by a specified amount.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} [amount=1] - Zoom levels to decrease
 * @param {Object} [options] - Animation options
 * @returns {Promise<void>} Resolves when animation completes
 */
export function zoomOut(map, amount = 1, options = {}) {
    const currentZoom = map.getZoom();
    return zoomTo(map, currentZoom - amount, options);
}

// ============================================================================
// FIT BOUNDS ANIMATION
// ============================================================================

/**
 * Fits the map to specified bounds with animation.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Array} bounds - [[west, south], [east, north]] bounds
 * @param {Object} [options] - Animation and padding options
 * @param {number} [options.duration=1000] - Animation duration in ms
 * @param {number} [options.padding=50] - Padding in pixels
 * @param {number} [options.maxZoom=18] - Maximum zoom level
 * @returns {Promise<void>} Resolves when animation completes
 */
export function fitBounds(map, bounds, options = {}) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const {
        duration = DEFAULT_OPTIONS.duration,
        padding = 50,
        maxZoom = 18
    } = options;

    const fitOptions = {
        padding,
        maxZoom,
        duration,
        essential: true
    };

    if (duration === 0) {
        map.fitBounds(bounds, { ...fitOptions, duration: 0 });
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const onMoveEnd = () => {
            map.off('moveend', onMoveEnd);
            resolve();
        };

        map.on('moveend', onMoveEnd);
        map.fitBounds(bounds, fitOptions);
    });
}

// ============================================================================
// ROTATION ANIMATIONS
// ============================================================================

/**
 * Rotates the map to a specific bearing with animation.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} bearing - Target bearing in degrees
 * @param {Object} [options] - Animation options
 * @param {number} [options.duration=500] - Animation duration in ms
 * @returns {Promise<void>} Resolves when animation completes
 */
export function rotateTo(map, bearing, options = {}) {
    if (!map) {
        return Promise.reject(new Error('Map instance is required'));
    }

    const duration = options.duration ?? ANIMATION_DURATION.FAST;
    const center = map.getCenter();

    return easeTo(map, {
        lng: center.lng,
        lat: center.lat,
        bearing,
        pitch: map.getPitch(),
        duration
    });
}

/**
 * Resets the map bearing to north (0 degrees).
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} [options] - Animation options
 * @returns {Promise<void>} Resolves when animation completes
 */
export function resetNorth(map, options = {}) {
    return rotateTo(map, 0, options);
}
