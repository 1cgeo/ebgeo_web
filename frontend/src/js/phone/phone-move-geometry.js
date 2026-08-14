// Path: js/phone/phone-move-geometry.js

/**
 * @fileoverview Pure geometry translation for the phone "move feature" mode.
 *
 * The phone move gesture pans the MAP under a fixed feature; on confirm the
 * feature is translated by the delta between the map centre where the gesture
 * started and where it ended. This module owns that translation and nothing
 * else: no DOM, no MapLibre, no store — so it is testable in plain node.
 *
 * Two things here are easy to get wrong and are the reason this is a module of
 * its own:
 *
 * 1. `coordinates` nests to a different DEPTH per geometry type (Point is one
 *    position, LineString/MultiPoint a list, Polygon/MultiLineString a list of
 *    lists, MultiPolygon one deeper, and a Polygon's holes are extra rings at
 *    the same depth as its exterior ring). The walk is therefore recursive and
 *    depth-agnostic: it descends until it finds a position (an array whose
 *    first element is a number) and translates that.
 *
 * 2. The ANTIMERIDIAN. `map.getCenter()` returns an unwrapped longitude, so the
 *    delta itself is continuous across ±180 — but the translated coordinates
 *    can land outside [-180, 180]. Wrapping each vertex on its own would tear a
 *    shape that straddles the antimeridian into two halves on opposite edges of
 *    the world. Instead one single shift (a whole multiple of 360) is chosen so
 *    that the feature's FIRST position lands back in range, and that same shift
 *    is applied to every vertex. The shape is preserved, and for anything that
 *    does not straddle the antimeridian the result is identical to wrapping
 *    each vertex.
 *
 * Latitude is clamped to [-90, 90] rather than wrapped: there is no meaningful
 * "over the pole" translation, and a wrap would mirror the shape.
 */

import { wrapLongitude, clampLatitude } from '@utils/geometry-utils.js';

// ============================================================================
// HELPERS (module-private)
// ============================================================================

/**
 * True when `value` is a GeoJSON position (`[lng, lat]`, optionally with an
 * altitude), as opposed to a nested list of positions.
 * @param {*} value
 * @returns {boolean}
 */
function isPosition(value) {
    return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number';
}

/**
 * Depth-first search for the first position inside a `coordinates` tree.
 * @param {*} coordinates - A position or an arbitrarily nested list of them
 * @returns {number[]|null} The position, or null when there is none
 */
function firstPositionOfCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
    if (isPosition(coordinates)) return coordinates;
    return firstPositionOfCoordinates(coordinates[0]);
}

/**
 * The single longitude shift (a whole multiple of 360) that brings the
 * translated anchor back into [-180, 180]. Applied to EVERY vertex so the shape
 * survives an antimeridian crossing intact.
 * @param {number} anchorLng - Longitude of the feature's first position
 * @param {number} deltaLng - Requested longitude delta
 * @returns {number} 0, or a multiple of ±360
 */
function longitudeShiftFor(anchorLng, deltaLng) {
    const raw = anchorLng + deltaLng;
    const wrapped = wrapLongitude(raw);
    if (!Number.isFinite(wrapped)) return 0;
    // Rounding keeps the shift an EXACT multiple of 360: wrapLongitude works
    // modulo 360 in floating point and its result is off by ~1e-13, which would
    // otherwise leak into every vertex.
    return Math.round((wrapped - raw) / 360) * 360;
}

/**
 * Translate one position, preserving any third (altitude) element.
 * @param {number[]} position
 * @param {number} deltaLng
 * @param {number} deltaLat
 * @param {number} lngShift
 * @returns {number[]|null} New position, or null when the input is not finite
 */
function translatePosition(position, deltaLng, deltaLat, lngShift) {
    const lng = position[0];
    const lat = position[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

    const moved = position.slice();
    moved[0] = lng + deltaLng + lngShift;
    moved[1] = clampLatitude(lat + deltaLat);
    return moved;
}

/**
 * Recursively translate a `coordinates` tree of any depth.
 * @param {*} coordinates
 * @param {number} deltaLng
 * @param {number} deltaLat
 * @param {number} lngShift
 * @returns {*|null} New tree, or null when any position is unusable
 */
function translateCoordinates(coordinates, deltaLng, deltaLat, lngShift) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
    if (isPosition(coordinates)) return translatePosition(coordinates, deltaLng, deltaLat, lngShift);

    const moved = [];
    for (const child of coordinates) {
        const translated = translateCoordinates(child, deltaLng, deltaLat, lngShift);
        if (!translated) return null;
        moved.push(translated);
    }
    return moved;
}

/**
 * Translate a geometry with an already-decided longitude shift.
 * @param {Object} geometry
 * @param {number} deltaLng
 * @param {number} deltaLat
 * @param {number} lngShift
 * @returns {Object|null}
 */
function translateGeometryWithShift(geometry, deltaLng, deltaLat, lngShift) {
    if (!geometry || typeof geometry !== 'object') return null;

    if (geometry.type === 'GeometryCollection') {
        const geometries = [];
        for (const child of geometry.geometries || []) {
            const translated = translateGeometryWithShift(child, deltaLng, deltaLat, lngShift);
            if (!translated) return null;
            geometries.push(translated);
        }
        if (geometries.length === 0) return null;
        return { ...geometry, geometries };
    }

    const coordinates = translateCoordinates(geometry.coordinates, deltaLng, deltaLat, lngShift);
    if (!coordinates) return null;
    return { ...geometry, coordinates };
}

/**
 * Translate the `center` property (circle, ellipse, rectangle, sector,
 * visibility). It is authored as `[lng, lat]` but the tools also accept a JSON
 * string, so the stored shape is preserved on the way out. Leaving it stale
 * would snap the feature back to its old place the next time a radius or axis
 * is edited, because those regenerate the geometry FROM the centre.
 * @param {number[]|string} center
 * @param {number} deltaLng
 * @param {number} deltaLat
 * @param {number} lngShift
 * @returns {{value: number[]|string}|null} Wrapper (so a valid result is never
 *   confused with "absent"), or null when the centre cannot be translated
 */
function translateCenterProperty(center, deltaLng, deltaLat, lngShift) {
    const wasString = typeof center === 'string';
    let parsed = center;

    if (wasString) {
        try {
            parsed = JSON.parse(center);
        } catch {
            return null;
        }
    }

    if (!isPosition(parsed)) return null;
    const moved = translatePosition(parsed, deltaLng, deltaLat, lngShift);
    if (!moved) return null;

    return { value: wasString ? JSON.stringify(moved) : moved };
}

/**
 * Translate the temporal trajectory keypoints (`{ t, lng, lat }`). A feature
 * with a trajectory is positioned by the trajectory during playback, so moving
 * only the geometry would leave it jumping back on the next frame.
 * @param {Array<Object>} trajetoria
 * @param {number} deltaLng
 * @param {number} deltaLat
 * @param {number} lngShift
 * @returns {Array<Object>|null}
 */
function translateTrajectory(trajetoria, deltaLng, deltaLat, lngShift) {
    if (!Array.isArray(trajetoria)) return null;

    const moved = [];
    for (const keypoint of trajetoria) {
        if (!keypoint || !Number.isFinite(keypoint.lng) || !Number.isFinite(keypoint.lat)) return null;
        moved.push({
            ...keypoint,
            lng: keypoint.lng + deltaLng + lngShift,
            lat: clampLatitude(keypoint.lat + deltaLat),
        });
    }
    return moved;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Properties that carry a position and therefore travel with the geometry.
 * Exported so the caller can mirror exactly these onto the live MapLibre source
 * without re-deriving the list.
 * @type {ReadonlyArray<string>}
 */
export const POSITION_PROPERTIES = Object.freeze(['center', 'trajetoria']);

/**
 * The first position of a geometry, at whatever depth it lives.
 * @param {Object} geometry - GeoJSON geometry
 * @returns {number[]|null} `[lng, lat]` (possibly with altitude), or null
 */
export function firstPosition(geometry) {
    if (!geometry || typeof geometry !== 'object') return null;

    if (geometry.type === 'GeometryCollection') {
        for (const child of geometry.geometries || []) {
            const found = firstPosition(child);
            if (found) return found;
        }
        return null;
    }

    return firstPositionOfCoordinates(geometry.coordinates);
}

/**
 * Translate a GeoJSON geometry of any type by a lng/lat delta.
 * @param {Object} geometry - GeoJSON geometry (any type, any nesting depth)
 * @param {number} deltaLng - Longitude delta in degrees
 * @param {number} deltaLat - Latitude delta in degrees
 * @returns {Object|null} A new geometry, or null when it cannot be translated
 *   (missing/empty coordinates, or a non-finite value anywhere)
 */
export function translateGeometry(geometry, deltaLng, deltaLat) {
    if (!Number.isFinite(deltaLng) || !Number.isFinite(deltaLat)) return null;

    const anchor = firstPosition(geometry);
    if (!anchor) return null;

    const lngShift = longitudeShiftFor(anchor[0], deltaLng);
    return translateGeometryWithShift(geometry, deltaLng, deltaLat, lngShift);
}

/**
 * Translate a whole feature: its geometry plus every position-bearing property
 * (`center`, `trajetoria`), all by the same shift so they stay consistent.
 *
 * Returns null instead of a half-moved feature whenever anything is unusable,
 * so the caller can refuse the move out loud rather than persisting a feature
 * whose centre disagrees with its geometry.
 *
 * @param {Object} feature - GeoJSON feature straight from the store
 * @param {number} deltaLng - Longitude delta in degrees
 * @param {number} deltaLat - Latitude delta in degrees
 * @returns {Object|null} A new feature (input untouched), or null
 */
export function translateFeature(feature, deltaLng, deltaLat) {
    if (!feature || typeof feature !== 'object') return null;
    if (!Number.isFinite(deltaLng) || !Number.isFinite(deltaLat)) return null;

    const anchor = firstPosition(feature.geometry);
    if (!anchor) return null;

    const lngShift = longitudeShiftFor(anchor[0], deltaLng);

    const geometry = translateGeometryWithShift(feature.geometry, deltaLng, deltaLat, lngShift);
    if (!geometry) return null;

    const properties = { ...(feature.properties || {}) };

    if (properties.center !== undefined && properties.center !== null) {
        const center = translateCenterProperty(properties.center, deltaLng, deltaLat, lngShift);
        if (!center) return null;
        properties.center = center.value;
    }

    if (properties.trajetoria !== undefined && properties.trajetoria !== null) {
        const trajetoria = translateTrajectory(properties.trajetoria, deltaLng, deltaLat, lngShift);
        if (!trajetoria) return null;
        properties.trajetoria = trajetoria;
    }

    return { ...feature, geometry, properties };
}
