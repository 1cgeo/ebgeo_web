// Path: js/tool_manager/clipboard-offset.js

/**
 * @fileoverview Where a paste LANDS, as pure arithmetic: the reference point of a copied
 * set, the delta from it to a clicked position, and the position-bearing properties that
 * have to travel with the geometry.
 *
 * "Colar Aqui" needs ONE `{dx, dy}` in degrees, because that is the whole interface the
 * tools expose: each control's `prepareForPaste(feature, offset)` does its own per-type
 * translation. So anchoring is two steps — find a single reference for the copied set, then
 * measure from it to the click.
 *
 * THE REFERENCE IS THE CENTRE OF THE BOUNDING BOX of the union of the copied geometries.
 * It is cheap, type-agnostic (no turf, no centroid-by-area) and it is what a person means
 * by "the middle of what I copied". A centroid would drift toward whichever part carries
 * the most vertices, which for a copied set is an accident of authoring.
 *
 * THE ANTIMERIDIAN IS NOT AN EDGE CASE HERE, it is the reason two of these three functions
 * exist. A plain `(min + max) / 2` over longitudes turns a set straddling the date line
 * into the centre of the WHOLE WORLD, mirrored, so the paste lands on the far side of the
 * planet. The span comes from {@link antimeridianSafeLngSpan} (largest empty arc) and the
 * delta from {@link wrapLongitude}, which makes `wrapLongitude(to - from)` the SHORTEST
 * signed delta: copying at 179.9 and pasting at -179.9 moves 0.2 degrees east, never 359.8
 * west. No new arithmetic is invented here; both pieces were already in the house and are
 * imported rather than re-derived, which is the whole point of this module being thin.
 *
 * ZERO STORE, ZERO DOM, ZERO MAP: one import of `@utils/geometry-utils.js`, so it is
 * node-testable and stays in the `core` chunk with the rest of `tool_manager/`.
 */

import {
    flattenPositions,
    antimeridianSafeLngSpan,
    wrapLongitude,
    translateKeypoints,
} from '@utils/geometry-utils.js';

/**
 * Accepts both `{lng, lat}` (what MapLibre's `unproject` returns) and `[lng, lat]`.
 * @param {*} value
 * @returns {Array<number>|null} `[lng, lat]`, or null when either half is not finite
 */
function toLngLatPair(value) {
    if (!value || typeof value !== 'object') return null;
    const lng = Array.isArray(value) ? value[0] : value.lng;
    const lat = Array.isArray(value) ? value[1] : value.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
}

/**
 * The single reference point of a copied set: the centre of the bounding box of the union
 * of its geometries.
 *
 * NON-FINITE COORDINATES ARE SKIPPED, NOT FATAL, and one usable position is enough. A
 * feature whose geometry is missing or malformed contributes nothing and the rest still
 * anchor; only a set with NO usable position at all returns null, which is the caller's
 * signal to fall back to the legacy nudge instead of pasting at NaN.
 *
 * @param {Array<Object>} features - GeoJSON features (or anything shaped `{geometry}`)
 * @returns {Array<number>|null} `[lng, lat]` with the longitude wrapped into [-180, 180),
 *   or null when nothing in the set carries a usable position
 */
export function pasteAnchor(features) {
    if (!Array.isArray(features) || features.length === 0) return null;

    const lngs = [];
    let minLat = Infinity;
    let maxLat = -Infinity;

    for (const feature of features) {
        for (const position of flattenPositions(feature?.geometry)) {
            if (!Array.isArray(position)) continue;
            const lng = position[0];
            const lat = position[1];
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

            lngs.push(lng);
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    }

    if (lngs.length === 0) return null;

    const [west, east] = antimeridianSafeLngSpan(lngs);
    const centre = (west + east) / 2;

    // WRAP ONLY WHEN THERE IS SOMETHING TO WRAP. `antimeridianSafeLngSpan` expresses a span
    // that crosses the date line with an `east` beyond 180, so the midpoint CAN leave the
    // range and has to come back. But `wrapLongitude` works modulo 360 through a +180/-180
    // round trip, and running it on a value already in range costs a bit of precision for
    // nothing: a single point copied at -43.2 came back as -43.19999999999999, so the anchor
    // of one point was not that point. Harmless on the map, and exactly the kind of drift
    // that makes a later equality test look flaky instead of wrong.
    const lng = (centre >= -180 && centre < 180) ? centre : wrapLongitude(centre);

    return [lng, (minLat + maxLat) / 2];
}

/**
 * The offset that moves `anchor` onto `target`.
 *
 * The longitude half is the SHORTEST signed delta, so a paste never travels the long way
 * round the globe. Exactly opposite meridians resolve to -180, matching `wrapLongitude`
 * (and MapLibre's own `LngLat.wrap`), which is arbitrary but has to be decided somewhere.
 *
 * @param {Array<number>|null} anchor - `[lng, lat]`, typically from {@link pasteAnchor}
 * @param {{lng: number, lat: number}|Array<number>|null} target - Where it should land
 * @returns {{dx: number, dy: number}|null} Null when either point is unusable
 */
export function offsetToTarget(anchor, target) {
    const from = toLngLatPair(anchor);
    const to = toLngLatPair(target);
    if (!from || !to) return null;

    return {
        dx: wrapLongitude(to[0] - from[0]),
        dy: to[1] - from[1],
    };
}

/**
 * The property patch a pasted feature needs so that everything carrying a POSITION travels
 * with its geometry.
 *
 * TWO PROPERTIES, AND NEITHER IS COSMETIC:
 *
 *  - `trajetoria`. A feature with a trajectory is positioned BY the trajectory during
 *    playback, so a copy whose geometry moved and whose route did not is a copy that jumps
 *    back to the original's path on the next frame.
 *  - `_temporalHome`. This is the one that loses data silently. `cleanFeature`
 *    (`store/repository.utils.js`) rewrites a Point's geometry FROM `_temporalHome` on the
 *    way into the repository, precisely so that editing a temporally displaced feature does
 *    not persist the interpolated position. Copy during playback and the pasted feature
 *    carries the ORIGINAL home, so the translated geometry is thrown away at persist time
 *    and the copy lands on top of the original. No error, no warning, and the paste toast
 *    still says it worked.
 *
 * `center` and `baseCoordinates` are deliberately NOT here: they belong to the controls,
 * whose `prepareForPaste` already regenerates them from the moved geometry. Patching them
 * from here would translate them twice.
 *
 * A NON-FINITE OFFSET YIELDS AN EMPTY PATCH rather than a route full of NaN: a broken
 * offset degrades to "pasted in place", never to a trajectory that can no longer be drawn.
 * One unusable keypoint refuses the WHOLE trajectory (the contract of
 * {@link translateKeypoints}), and the refusal here means "leave it as it was", because a
 * half-moved route is worse than an unmoved one.
 *
 * @param {Object|null|undefined} properties - Properties of the ALREADY-PASTED feature
 * @param {number} dx - Longitude delta in degrees
 * @param {number} dy - Latitude delta in degrees
 * @returns {Object} A patch to merge over the properties. Always an object, possibly empty.
 */
export function translatePositionProperties(properties, dx, dy) {
    const patch = {};
    if (!properties || typeof properties !== 'object') return patch;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return patch;

    // An EMPTY trajectory is left out on purpose: `translateKeypoints` returns `[]` for it
    // (nothing to refuse), and writing that back would replace the original array with a
    // fresh one for no gain, which is churn a diff of the pasted feature would show.
    const trajetoria = translateKeypoints(properties.trajetoria, dx, dy);
    if (trajetoria && trajetoria.length > 0) patch.trajetoria = trajetoria;

    const home = toLngLatPair(properties._temporalHome);
    if (home) patch._temporalHome = [home[0] + dx, home[1] + dy];

    return patch;
}
