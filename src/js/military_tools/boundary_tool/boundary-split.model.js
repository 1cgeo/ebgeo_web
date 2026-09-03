// Path: js/military_tools/boundary_tool/boundary-split.model.js

/**
 * @fileoverview Pure model behind CUTTING a boundary in two. No DOM, no store,
 * no map and no turf, so it is node-testable and safe to import from anywhere
 * (the context menu imports `canSplitBoundary` from here to gate its entry).
 *
 * WHY A MODEL AT ALL. `line-split.js` gets away with `{ ...originalProps }`
 * because a line carries nothing that depends on its own length. A boundary
 * does: every echelon symbol is stored as a `ratio` of the TOTAL length, so
 * copying the ratios into both halves duplicates each symbol and puts neither
 * copy where the user drew it. A symbol at `ratio` 0.5 of a 36 km boundary cut
 * at 40% sits at km 18.4, which is km 3.7 of the second half, `ratio` 0.167 —
 * and the first half then has no symbol at all. That remapping is the reason
 * this file exists instead of a spread at the call site.
 *
 * THE GEOMETRIC TRUTH IS `properties.baseCoordinates`, NEVER `geometry`, for
 * the reason `linear-conversion.model.js` states: a boundary persists a
 * MultiLineString that mixes the line's own segments with the strokes of the
 * echelon symbols. Reading `geometry.coordinates.length` there measures the
 * number of PARTS, not of vertices, so it answers a question nobody asked.
 *
 * WHAT THIS MODEL DOES NOT DECIDE. The authored `symbol_size` and
 * `text_distance_ratio` are copied unchanged into both halves. Shortening the
 * line lowers the cap `maxSymbolSizeForLine` imposes, so a symbol may DRAW
 * smaller after a cut without any property having changed. That is the same
 * behaviour a vertex drag or a continuation already produces, and reauthoring
 * the size here would invent a rule the tool has nowhere else.
 */

import { resolveSpineCoordinates } from '@tools/helpers/linear-conversion.model.js';

/**
 * How far from an end (and from an existing vertex) a cut must land, in metres.
 * It is the boundary's own minimum vertex spacing, not a second number: a cut
 * closer than this to a vertex is snapped ONTO it by the caller, and a cut that
 * close to an end has no half to give.
 * @constant {number}
 */
export const MIN_SPLIT_DISTANCE_METERS = 5;

/**
 * Placement range of a symbol instance. Duplicated from
 * `AddBoundaryGeometry.GEOMETRY_CONSTANTS` on purpose: importing the geometry
 * class would drag the `@tools` barrel into a model the context menu loads.
 * `boundary-split-model.test.js` asserts the two agree.
 * @constant {number}
 */
export const SPLIT_RATIO_MIN = 0.01;

/** @constant {number} */
export const SPLIT_RATIO_MAX = 0.99;

/**
 * Clamp a remapped ratio into the placement range. A symbol sitting exactly on
 * the cut maps to 1 of the first half (or 0 of the second), which would draw
 * its gap off the end of the line.
 * @param {number} ratio - Raw ratio
 * @returns {number} Ratio inside the placement range (0.5 when not finite)
 */
function clampRatio(ratio) {
    if (!Number.isFinite(ratio)) return 0.5;
    return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}

/**
 * @param {*} point - Candidate coordinate
 * @returns {boolean} True when it is a usable `[lng, lat]` pair
 */
function isUsablePoint(point) {
    return Array.isArray(point)
        && point.length >= 2
        && Number.isFinite(point[0])
        && Number.isFinite(point[1]);
}

/**
 * @param {*} a - First coordinate
 * @param {*} b - Second coordinate
 * @returns {boolean} True when both name the same position
 */
function samePoint(a, b) {
    return isUsablePoint(a) && isUsablePoint(b) && a[0] === b[0] && a[1] === b[1];
}

/**
 * Whether the current selection can be cut.
 *
 * Kept here, and not as a fourth private copy inside the context menu, because
 * the reason it refuses is the sentence the user reads.
 *
 * @param {Array} selectedFeatures - Currently selected features
 * @returns {{ canSplit: boolean, reason?: string }} Verdict and why not
 */
export function canSplitBoundary(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) {
        return { canSplit: false, reason: 'Selecione exatamente 1 linha de limite' };
    }

    const feature = selectedFeatures[0];

    if (feature?.properties?.source !== 'boundary') {
        return { canSplit: false, reason: 'Feição selecionada não é uma linha de limite' };
    }

    const spine = resolveSpineCoordinates(feature);
    if (!spine || spine.length < 2) {
        return { canSplit: false, reason: 'Linha de limite sem coordenadas suficientes' };
    }

    if (feature.properties?.bloqueado) {
        return { canSplit: false, reason: 'Linha de limite está bloqueada' };
    }

    return { canSplit: true };
}

/**
 * Cut a spine in two at a point lying on segment `segmentIndex`.
 *
 * The cut coordinate is repeated: it closes the first half and opens the second,
 * which is what makes the two drawings meet. When it coincides EXACTLY with the
 * vertex on either side of the seam (the caller snaps a near-vertex cut onto the
 * vertex first) the repeat is dropped instead, because a zero-length segment has
 * no bearing and every symbol and label the boundary draws is placed by one.
 *
 * @param {Array<Array<number>>} coordinates - The spine, already resolved
 * @param {number} segmentIndex - Index of the vertex that OPENS the cut segment
 * @param {Array<number>} splitCoord - The cut position `[lng, lat]`
 * @returns {{first: Array<Array<number>>, second: Array<Array<number>>}|null}
 *   The two halves, or null when the cut cannot produce two usable lines
 */
export function splitSpineAtPoint(coordinates, segmentIndex, splitCoord) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    if (!Number.isInteger(segmentIndex)) return null;
    if (segmentIndex < 0 || segmentIndex > coordinates.length - 2) return null;
    if (!isUsablePoint(splitCoord)) return null;

    const cut = [splitCoord[0], splitCoord[1]];
    const before = coordinates.slice(0, segmentIndex + 1).map(point => [...point]);
    const after = coordinates.slice(segmentIndex + 1).map(point => [...point]);

    if (samePoint(before[before.length - 1], cut)) before.pop();
    if (samePoint(after[0], cut)) after.shift();

    const first = [...before, [...cut]];
    const second = [[...cut], ...after];

    if (first.length < 2 || second.length < 2) return null;
    return { first, second };
}

/**
 * The `showLabels` a half with no symbol of its own should inherit: the one of
 * the symbol nearest to it, which is the leftmost instance for the first half
 * and the rightmost for the second.
 *
 * @param {Array<{ratio: number, showLabels: boolean}>} instances - Normalized instances
 * @param {string} side - 'first' or 'second'
 * @returns {boolean} Label visibility for the fallback instance
 */
function inheritedShowLabels(instances, side) {
    if (!instances.length) return true;

    const nearest = instances.reduce((best, inst) => {
        if (side === 'first') return inst.ratio < best.ratio ? inst : best;
        return inst.ratio > best.ratio ? inst : best;
    }, instances[0]);

    return nearest.showLabels !== false;
}

/**
 * Remap the echelon instances of a cut boundary onto its two halves.
 *
 * Each `ratio` is read as an absolute distance along the ORIGINAL line, and the
 * half that contains that distance keeps the symbol, re-expressed as a fraction
 * of its own length. A half that ends up with no symbol gets one centred, with
 * the label visibility of the nearest original: `getSymbolInstances` refuses an
 * empty array and falls back to exactly that, so writing it down is the
 * difference between storing what the map draws and storing a lie.
 *
 * @param {Array<{ratio: number, showLabels: boolean}>} instances - Instances of
 *   the original, already normalized by `AddBoundaryGeometry.getSymbolInstances`
 * @param {Object} lengths - Measured lengths, in the same unit
 * @param {number} lengths.totalLength - Length of the original spine
 * @param {number} lengths.firstLength - Length of the first half
 * @param {number} lengths.secondLength - Length of the second half
 * @returns {{first: Array<Object>, second: Array<Object>}} Instances per half,
 *   each array holding at least one
 */
export function splitSymbolInstances(instances, lengths) {
    const list = (Array.isArray(instances) ? instances : [])
        .filter(inst => inst && typeof inst === 'object')
        .map(inst => ({
            ratio: Number.isFinite(inst.ratio) ? inst.ratio : 0.5,
            showLabels: inst.showLabels !== false,
        }));

    const { totalLength, firstLength, secondLength } = lengths || {};
    const measurable = [totalLength, firstLength, secondLength]
        .every(value => Number.isFinite(value) && value > 0);

    const first = [];
    const second = [];

    if (measurable) {
        for (const inst of list) {
            const distance = inst.ratio * totalLength;
            if (distance <= firstLength) {
                first.push({ ratio: clampRatio(distance / firstLength), showLabels: inst.showLabels });
            } else {
                second.push({
                    ratio: clampRatio((distance - firstLength) / secondLength),
                    showLabels: inst.showLabels,
                });
            }
        }
    }

    return {
        first: first.length > 0
            ? first
            : [{ ratio: 0.5, showLabels: inheritedShowLabels(list, 'first') }],
        second: second.length > 0
            ? second
            : [{ ratio: 0.5, showLabels: inheritedShowLabels(list, 'second') }],
    };
}
