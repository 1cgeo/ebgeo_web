// Path: js/tool_manager/clipboard-offset.js

/**
 * @fileoverview Pure geometry helpers that anchor a clipboard paste at a chosen
 * map position (the "Colar Aqui" of the context menu).
 *
 * The clipboard paste applies ONE `{dx, dy}` in degrees to every copied feature
 * (each tool's `prepareForPaste` does the per-type translation), so anchoring is
 * a two-step problem: find a single reference point for the copied set, then
 * compute the delta from it to the click.
 *
 * The reference point is the CENTER OF THE BOUNDING BOX of the union of the
 * copied geometries. It is cheap, type-agnostic (no turf, no centroid area math)
 * and matches what the user sees as "the middle of what I copied".
 *
 * Antimeridian: longitudes are unwrapped around the first valid one before the
 * bbox is taken, and the resulting delta is the SHORTEST signed one, so copying
 * at 179.9 and pasting at -179.9 moves 0.2 degrees east, not 359.8 west.
 *
 * No DOM, no map, no store: node-testable.
 */

/**
 * Shortest signed delta in degrees from `from` to `to`, in (-180, 180].
 * Exactly-opposite meridians resolve to -180.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function shortestLngDelta(from, to) {
    return ((((to - from + 540) % 360) + 360) % 360) - 180;
}

/**
 * Normalize a longitude into [-180, 180).
 * @param {number} lng
 * @returns {number}
 */
function normalizeLng(lng) {
    return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Flat list of `[lng, lat]` pairs from any GeoJSON geometry (nested rings,
 * multi-parts and GeometryCollection included).
 * @param {Object|null|undefined} geometry - GeoJSON geometry.
 * @returns {Array<Array<number>>} Coordinate pairs (possibly empty).
 */
export function extractGeometryCoordinates(geometry) {
    if (!geometry || typeof geometry !== 'object') return [];

    if (geometry.type === 'GeometryCollection') {
        if (!Array.isArray(geometry.geometries)) return [];
        return geometry.geometries.flatMap(g => extractGeometryCoordinates(g));
    }

    const coordinates = geometry.coordinates;
    if (!Array.isArray(coordinates)) return [];

    switch (geometry.type) {
        case 'Point':
            return [coordinates];
        case 'MultiPoint':
        case 'LineString':
            return coordinates;
        case 'MultiLineString':
        case 'Polygon':
            return coordinates.flat();
        case 'MultiPolygon':
            return coordinates.flat(2);
        default:
            return [];
    }
}

/**
 * Center of the bounding box of the union of the given features' geometries.
 *
 * Non-finite coordinates are ignored; a set with no usable coordinate yields
 * `null` so the caller can fall back to the legacy offset instead of pasting at
 * NaN.
 *
 * @param {Array<Object>} features - GeoJSON features (or `{geometry}` shapes).
 * @returns {Array<number>|null} `[lng, lat]` or null.
 */
export function computePasteAnchor(features) {
    if (!Array.isArray(features) || features.length === 0) return null;

    let reference = null;
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    for (const feature of features) {
        const pairs = extractGeometryCoordinates(feature?.geometry);
        for (const pair of pairs) {
            if (!Array.isArray(pair)) continue;
            const lng = pair[0];
            const lat = pair[1];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

            // Unwrap around the first valid longitude so a set straddling the
            // antimeridian keeps a contiguous span instead of spanning the globe.
            if (reference === null) reference = lng;
            const unwrapped = reference + shortestLngDelta(reference, lng);

            if (unwrapped < minLng) minLng = unwrapped;
            if (unwrapped > maxLng) maxLng = unwrapped;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    }

    if (reference === null) return null;

    return [normalizeLng((minLng + maxLng) / 2), (minLat + maxLat) / 2];
}

/**
 * Offset in degrees that moves `anchor` onto `target`.
 * @param {Array<number>|null} anchor - `[lng, lat]`.
 * @param {Array<number>|null} target - `[lng, lat]`.
 * @returns {{dx: number, dy: number}|null} Null when either point is unusable.
 */
export function calculateOffsetToTarget(anchor, target) {
    if (!Array.isArray(anchor) || !Array.isArray(target)) return null;
    if (!Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) return null;
    if (!Number.isFinite(target[0]) || !Number.isFinite(target[1])) return null;

    return {
        dx: shortestLngDelta(anchor[0], target[0]),
        dy: target[1] - anchor[1]
    };
}
