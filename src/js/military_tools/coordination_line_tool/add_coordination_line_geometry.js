// Path: js/military_tools/coordination_line_tool/add_coordination_line_geometry.js

import { BaseGeometry } from '@tools';
import {
    computeCoordinationLineZoomSizes,
    resolveGlyphLayout,
    resolveContinuousLayout,
    COORDINATION_LINE_ZOOM_LIMITS,
} from './coordination-line-zoom.model.js';
import { resolveSymbol } from './coordination_line_catalog.js';

/**
 * Coordination Line Geometry Operations
 *
 * Draws the MD33 linear coordination symbols. Most are a polyline carrying a glyph
 * repeated at a regular spacing: some glyphs INTERRUPT the line (the 290199 diamond,
 * the obstacle peak) and the line runs into the glyph and out of it; others ride on
 * an unbroken line (the fences, the concertinas), and the double and triple
 * concertinas add a second CONTINUOUS rail beside it. Three symbols are not marks
 * along a line at all: the sap, the trench and the anti-tank ditch are a repeating
 * tooth that IS the course of the line, with no spine of their own, and they take
 * the `continuous` path below. The catalogue decides which.
 *
 * Almost everything is emitted as ONE MultiLineString: the line (whole, or the
 * pieces that survive the gaps), the parallel rails when the symbol has them, plus
 * one ring per glyph stroke. A single `line` layer draws the lot, which is why every
 * glyph reads as HOLLOW.
 *
 * The exception is a `filled` symbol, which comes out as a MultiPolygon for the fill
 * layer to paint, one polygon per tooth. That layer is FILTERED to the filled codes,
 * and the filter is not tidiness: measured in the browser on 2026-09-03, MapLibre's
 * fill layer closes and paints whatever line it is handed, so an unfiltered one over
 * this source painted the inside of the 290199 diamond, of every concertina loop,
 * and even the area between an open bent spine and its chord. Putting the spine and
 * the teeth in one feature does not help either: the same measurement showed a
 * GeometryCollection's MultiLineString painted just as solidly as its MultiPolygon.
 * That is why the filled symbol has NO spine to begin with, which is also how the
 * manual draws it: the teeth are adjacent and their bases are the line.
 *
 * The arithmetic that decides HOW MANY diamonds and WHERE lives in
 * coordination-line-zoom.model.js, which has no imports and is tested in node. This
 * class owns only the turf part.
 */
class AddCoordinationLineGeometry extends BaseGeometry {
    static GEOMETRY_CONSTANTS = {
        /** Two clicks closer than this do not add a second vertex. */
        MIN_DISTANCE_METERS: 5,
        /** Shorter than this, a slice is not worth emitting. */
        MIN_LENGTH_KM: 0.001,
        /** Vertices around the concertina loop. Enough to read as a curve at any zoom. */
        COIL_STEPS: 16,
        /** The loop is taller than it is wide, as the catalogue draws it. */
        COIL_HEIGHT_RATIO: 1.4,
        /**
         * Double concertina (290308): the loop stands on the spine and overtops
         * the second rail, which is what separates it from the triple. Measured
         * off the plate: rails 7 px apart inside a 19 px band, loop 18 px tall,
         * so the loop is 2.6 rail-gaps high.
         */
        COIL_DOUBLE_HEIGHT_RATIO: 2.6,
        /**
         * Triple concertina (290309): the loop is CONTAINED between the two
         * rails, touching both. Measured off the plate: a 20 px band with the
         * rails on its edges and the loop spanning exactly the gap.
         */
        COIL_TRIPLE_HEIGHT_RATIO: 1,
        /**
         * Ceiling on the miter that keeps a rail its distance from both segments
         * at a bend. The factor is `1 / cos(half the turn)`, which diverges as the
         * bend closes on a hairpin; past this the rail cuts the corner instead of
         * shooting off the map.
         */
        MITER_LIMIT: 4,
        /**
         * Below this, two points count as the SAME point and the bearing between
         * them is meaningless. A millimetre, and not `MIN_LENGTH_KM`: that one is a
         * metre, which is the shortest stretch of line worth emitting, and reusing
         * it here would throw away real teeth. Measured on 2026-09-03, a metre
         * threshold dropped the single tooth of a 1.2 m trench, because half a
         * tooth there is 0.6 m.
         */
        COINCIDENT_KM: 1e-6,
    };

    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS.MIN_DISTANCE_METERS;
    }

    // ========================================================================
    // GEOMETRY GENERATION
    // ========================================================================

    /**
     * Generate the coordination line geometry.
     * @param {Object} properties - Feature properties, including `baseCoordinates`
     * @param {number} [currentZoom] - Current map zoom (omitted = no map)
     * @returns {Object} GeoJSON MultiLineString, or a bare LineString when no
     *   whole diamond fits or the drawing cannot be built
     */
    generate(properties, currentZoom) {
        return this.generateCoordinationLineGeometry(properties, currentZoom);
    }

    /**
     * Build the line-with-gaps plus the diamonds.
     * Every failure path degrades to the raw spine rather than to empty geometry:
     * a coordination line that cannot draw its diamonds is still a line the user drew.
     * @param {Object} properties - Feature properties
     * @param {number} [currentZoom] - Current map zoom
     * @returns {Object} GeoJSON geometry
     */
    generateCoordinationLineGeometry(properties, currentZoom) {
        const baseCoordinates = this.normalizeBaseCoordinates(properties?.baseCoordinates);

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for coordination line:', properties?.baseCoordinates);
            return { type: 'LineString', coordinates: baseCoordinates || [[0, 0], [0, 0]] };
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });

            const { calculatedSymbolSize, calculatedSymbolSpacing } =
                computeCoordinationLineZoomSizes(properties, currentZoom);

            const symbol = resolveSymbol(properties?.symbol_code);

            // A continuous symbol has no spacing to reconcile: `symbol_size` is
            // the period of one tooth, and the pattern runs end to end.
            if (symbol.continuous) {
                const pattern = resolveContinuousLayout(totalLength, calculatedSymbolSize);
                if (pattern.count === 0) {
                    return { type: 'LineString', coordinates: baseCoordinates };
                }
                const teeth = this.buildContinuousPattern(this.prepareSpine(line), pattern, symbol);
                if (teeth.length === 0) {
                    return { type: 'LineString', coordinates: baseCoordinates };
                }
                // A solid symbol has to reach the fill layer, and a fill layer only
                // paints polygons. One polygon per tooth, never one polygon holding
                // them all: adjacent teeth share a corner, and a single ring
                // through every corner would self-intersect there.
                return symbol.filled
                    ? { type: 'MultiPolygon', coordinates: teeth.map(ring => [ring]) }
                    : { type: 'MultiLineString', coordinates: teeth };
            }

            // The layout is asked for the glyph's real FOOTPRINT, not for the
            // authored size: a wide glyph on a narrow spacing would overlap its
            // neighbour, and the model's `size <= MAX_GAP_FRACTION * spacing`
            // only protects what it is given.
            const layout = resolveGlyphLayout(
                totalLength,
                calculatedSymbolSize * symbol.spanRatio,
                calculatedSymbolSpacing,
            );

            if (layout.count === 0) {
                // No whole glyph fits. An interrupting symbol degrades to the bare
                // spine; a symbol that rides on the line has a line to show either
                // way, so both land on the same LineString.
                return { type: 'LineString', coordinates: baseCoordinates };
            }

            // The spine is read ONCE here and handed down, instead of every glyph
            // walking it again from the first vertex. See `prepareSpine`.
            const lines = this.buildSegmentsAndGlyphs(
                this.prepareSpine(line), totalLength, layout, symbol,
            );

            if (lines.length === 0) {
                return { type: 'LineString', coordinates: baseCoordinates };
            }

            return { type: 'MultiLineString', coordinates: lines };
        } catch (error) {
            console.warn('Error generating coordination line geometry:', error);
            return { type: 'LineString', coordinates: baseCoordinates };
        }
    }

    /**
     * Walk the line once, emitting the segment before each diamond, then the
     * diamond, and finally the tail.
     *
     * The cursor never moves backwards, so diamonds that would overlap simply
     * share the stretch of line they consume instead of emitting reversed
     * segments. Overlap should not happen (the layout enforces
     * `size <= MAX_GAP_FRACTION * spacing`), but the cursor is what makes the
     * walk total rather than conditional on that invariant holding.
     *
     * @param {Object} spine - Prepared spine, or a bare turf lineString feature
     * @param {number} totalLength - Line length in kilometres
     * @param {{count: number, size: number, spacing: number, start: number}} layout - Diamond layout
     * @returns {Array<Array>} Coordinate arrays for the MultiLineString
     */
    buildSegmentsAndGlyphs(spine, totalLength, layout, symbol) {
        const { MIN_LENGTH_KM } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const { count, size, spacing, start } = layout;
        const half = size / 2;
        const prepared = this.spineOf(spine);
        const lines = [];

        // A symbol that rides ON the line needs the line whole underneath it, so
        // the spine goes in once and the walk below only adds glyphs.
        if (!symbol.interrupts) {
            lines.push(this.sliceAlong(prepared, 0, totalLength));
        }

        // The concertina rails are CONTINUOUS, so they are laid once for the whole
        // line rather than per glyph: a rail cut into per-glyph pieces would read
        // as a dashed line, which is a different symbol.
        lines.push(...this.buildRails(prepared.line, size, symbol));

        let cursor = 0;

        for (let i = 0; i < count; i++) {
            const centre = start + i * spacing;
            const glyphStart = Math.max(0, centre - half);
            const glyphEnd = Math.min(totalLength, centre + half);

            if (symbol.interrupts) {
                if (glyphStart - cursor > MIN_LENGTH_KM) {
                    lines.push(this.sliceAlong(prepared, cursor, glyphStart));
                }
                cursor = Math.max(cursor, glyphEnd);
            }

            lines.push(...this.glyphRings(prepared, glyphStart, glyphEnd, symbol, size));
        }

        if (symbol.interrupts && totalLength - cursor > MIN_LENGTH_KM) {
            lines.push(this.sliceAlong(prepared, cursor, totalLength));
        }

        return lines.filter(coords => Array.isArray(coords) && coords.length >= 2);
    }

    // ========================================================================
    // THE PREPARED SPINE
    // ========================================================================

    /**
     * Read the spine ONCE per `generate`, so the glyphs stop re-reading it.
     *
     * `turf.along` and `turf.lineSliceAlong` both find their place by adding up
     * every segment from the first vertex, which is O(V) per call. The glyph walk
     * makes two `along` calls plus a slice per glyph, so a frame cost the PRODUCT
     * `glyphs x vertices`. Measured in node on 2026-09-04 against the vendored
     * turf, one 120-glyph feature on a 150 km line: the 290199 diamond cost
     * 0.22 ms at 2 vertices, 0.83 ms at 50 and 5.22 ms at 400, and the 290309
     * triple concertina 0.64, 1.08 and 4.06 ms, with 30 screen-pinned features
     * regenerated per frame against a 16.7 ms budget. Prepared, the same six
     * measurements are 0.15, 0.17, 0.26 and 0.60, 0.64, 0.81 ms: what is left
     * grows with the vertices ONCE, in the pass below, and not per glyph.
     *
     * `cumulative[i]` is the distance in kilometres from the start to vertex `i`,
     * accumulated in the SAME order and with the same `turf.distance` call turf
     * makes itself, so a binary search over it lands on the same segment with the
     * same remainder, bit for bit. `backBearings[i]` is the direction turf reads
     * at vertex `i` (the bearing back to `i - 1`, turned around), which is the
     * only other per-call work there was.
     *
     * @param {Object} line - Turf lineString feature or geometry
     * @returns {{line: Object, coords: Array, cumulative: Array<number>, backBearings: Array<number>}}
     *   The prepared spine
     */
    prepareSpine(line) {
        const coords = line.geometry ? line.geometry.coordinates : line.coordinates;
        const cumulative = new Array(coords.length);
        const backBearings = new Array(coords.length);

        cumulative[0] = 0;
        let travelled = 0;

        for (let i = 1; i < coords.length; i++) {
            travelled += turf.distance(coords[i - 1], coords[i], { units: 'kilometers' });
            cumulative[i] = travelled;
            backBearings[i] = turf.bearing(coords[i], coords[i - 1]) - 180;
        }

        return { line, coords, cumulative, backBearings };
    }

    /**
     * Accept either a prepared spine or the bare turf line the older callers and
     * the tests still hand in, and never prepare the same line twice.
     * @param {Object} spine - Prepared spine or turf lineString feature
     * @returns {Object} Prepared spine
     */
    spineOf(spine) {
        return spine && spine.cumulative ? spine : this.prepareSpine(spine);
    }

    /**
     * Index of the first vertex whose running distance reaches `d`, by binary
     * search, or -1 when the line ends short of it.
     *
     * This is the one thing turf does by walking, and the only reason its cost
     * grows with the vertex count.
     *
     * @param {Array<number>} cumulative - Running distances, non-decreasing
     * @param {number} d - Distance in kilometres
     * @returns {number} Vertex index, or -1
     */
    firstVertexAtLeast(cumulative, d) {
        let lo = 0;
        let hi = cumulative.length - 1;

        if (cumulative[hi] < d) return -1;

        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cumulative[mid] >= d) hi = mid;
            else lo = mid + 1;
        }

        return lo;
    }

    /**
     * The direction turf steps in when it lands inside the segment ending at
     * vertex `i`: the bearing back to `i - 1`, turned around.
     * @param {Object} prepared - Prepared spine
     * @param {number} i - Vertex index
     * @returns {number} Bearing in degrees
     */
    backBearing(prepared, i) {
        const cached = prepared.backBearings[i];
        if (cached !== undefined) return cached;

        // Vertex 0 has nothing before it. Turf reaches here only for a NEGATIVE
        // distance and throws on the missing coordinate, and the callers already
        // catch that throw, so it is reproduced rather than smoothed over.
        return turf.bearing(prepared.coords[i], prepared.coords[i - 1]) - 180;
    }

    /**
     * `turf.along` on a prepared spine: the same arithmetic without the walk.
     *
     * Bit for bit the same point, which is a requirement and not a hope. The
     * glyph anchors and the ends of the gaps around them both come from this
     * call, so a rewrite that moved a point by one rounding step would open the
     * very seam the symbol is drawn to close.
     *
     * @param {Object} prepared - Prepared spine
     * @param {number} d - Distance along the line, in kilometres
     * @returns {Object} Turf point feature
     */
    alongPrepared(prepared, d) {
        const { coords, cumulative } = prepared;

        // A distance that is not a number never reaches here from the layout, and
        // if one ever did, turf's own walk is the reference for what it means.
        if (!Number.isFinite(d)) return turf.along(prepared.line, d, { units: 'kilometers' });

        const i = this.firstVertexAtLeast(cumulative, d);
        if (i < 0) return turf.point(coords[coords.length - 1]);

        const overshot = d - cumulative[i];
        if (!overshot) return turf.point(coords[i]);

        return turf.destination(
            coords[i], overshot, this.backBearing(prepared, i), { units: 'kilometers' },
        );
    }

    /**
     * `turf.lineSliceAlong` on a prepared spine, coordinates only.
     *
     * Turf walks from the first vertex and emits nothing until it reaches the
     * slice, so the walk is replaced by a jump straight to the first vertex that
     * can emit anything; from there the loop below is turf's own, check for
     * check, and it runs once per vertex the slice actually keeps.
     *
     * It THROWS where turf throws, on a start past the end of the line and on a
     * slice that comes out with fewer than two points, because `sliceAlong` turns
     * both into an empty slice and the drawing depends on that.
     *
     * @param {Object} prepared - Prepared spine
     * @param {number} startDist - Start distance in kilometres
     * @param {number} stopDist - End distance in kilometres
     * @returns {Array} Coordinate array
     */
    slicePrepared(prepared, startDist, stopDist) {
        const { coords, cumulative } = prepared;

        if (!Number.isFinite(startDist) || !Number.isFinite(stopDist)) {
            return turf.lineSliceAlong(
                prepared.line, startDist, stopDist, { units: 'kilometers' },
            ).geometry.coordinates;
        }

        const last = coords.length - 1;
        const slice = [];

        // Every vertex before this one fails all four of the tests below and
        // emits nothing, which is what makes the skip safe. Both ends are
        // consulted because a caller may hand in a stop BEFORE the start, and
        // turf answers that on the stop.
        const atStart = this.firstVertexAtLeast(cumulative, startDist);
        const atStop = this.firstVertexAtLeast(cumulative, stopDist);
        let i = Math.min(atStart < 0 ? last : atStart, atStop < 0 ? last : atStop);

        for (; i <= last; i++) {
            const travelled = cumulative[i];

            if (startDist >= travelled && i === last) break;

            if (travelled > startDist && slice.length === 0) {
                const overshot = startDist - travelled;
                if (!overshot) {
                    slice.push(coords[i]);
                    return this.closeSlice(slice);
                }
                slice.push(this.stepBack(prepared, i, overshot));
            }

            if (travelled >= stopDist) {
                const overshot = stopDist - travelled;
                if (overshot) slice.push(this.stepBack(prepared, i, overshot));
                else slice.push(coords[i]);
                return this.closeSlice(slice);
            }

            if (travelled >= startDist) slice.push(coords[i]);

            if (i === last) return this.closeSlice(slice);
        }

        if (cumulative[last] < startDist) throw new Error('Start position is beyond line');

        return [coords[last], coords[last]];
    }

    /**
     * The interpolated coordinate turf drops inside the segment ending at vertex
     * `i`, `overshot` kilometres back from it (the overshot is negative).
     * @param {Object} prepared - Prepared spine
     * @param {number} i - Vertex index
     * @param {number} overshot - Signed distance back from the vertex, in kilometres
     * @returns {Array} `[lng, lat]`
     */
    stepBack(prepared, i, overshot) {
        return turf.destination(
            prepared.coords[i], overshot, this.backBearing(prepared, i), { units: 'kilometers' },
        ).geometry.coordinates;
    }

    /**
     * Hand back a finished slice, refusing the one-point slice.
     *
     * `turf.lineSliceAlong` finishes with `turf.lineString`, which throws on
     * fewer than two positions; `sliceAlong` catches that and draws nothing, so
     * the refusal has to survive the rewrite.
     *
     * @param {Array} slice - Coordinates gathered so far
     * @returns {Array} The same coordinates
     */
    closeSlice(slice) {
        if (slice.length < 2) {
            throw new Error('coordinates must be an array of two or more positions');
        }
        return slice;
    }

    /**
     * Cut the stretch of line between two distances along it.
     *
     * The semantics of `turf.lineSliceAlong` and NOT of `turf.lineSlice`: the
     * latter takes points and re-projects them onto the line with a planar
     * nearest-point, which disagrees with the great-circle interpolation `along`
     * uses to place the diamond vertices. Measured on 2026-09-03 against the
     * bundled turf, that disagreement left a visible gap between the segment and
     * the diamond it should touch: 1.13 m on a 10 km line and 113.59 m on a
     * 100 km one, against 0.00 m for every case with `lineSliceAlong`.
     *
     * @param {Object} spine - Prepared spine, or a bare turf lineString feature
     * @param {number} from - Start distance in kilometres
     * @param {number} to - End distance in kilometres
     * @returns {Array} Coordinate array, empty when the slice cannot be built
     */
    sliceAlong(spine, from, to) {
        try {
            return this.slicePrepared(this.spineOf(spine), from, to) ?? [];
        } catch (error) {
            console.warn('Error slicing coordination line:', error);
            return [];
        }
    }

    /**
     * Build one closed diamond whose left and right vertices sit ON the line.
     *
     * Both are read with `alongPrepared`, the same call the gap boundaries come
     * from, which is what makes the join seamless. The transverse half-diagonal
     * is measured from the CHORD between them rather than from the requested
     * size, so a diamond straddling a bend stays a rhombus instead of stretching.
     *
     * @param {Object} spine - Prepared spine, or a bare turf lineString feature
     * @param {number} from - Distance along the line of the left vertex
     * @param {number} to - Distance along the line of the right vertex
     * @returns {Array} Closed five-point ring (last point repeats the first)
     */
    glyphRings(spine, from, to, symbol, size) {
        const prepared = this.spineOf(spine);
        const left = this.alongPrepared(prepared, from);
        const right = this.alongPrepared(prepared, to);

        // Everything is measured from the CHORD between the two anchors, never
        // from the requested size: on a bend the arc is longer than the chord,
        // and a glyph built from the request would stretch out of shape.
        const bearing = turf.bearing(left, right);
        const centre = turf.midpoint(left, right);
        const half = turf.distance(left, right, { units: 'kilometers' }) / 2;

        if (half <= 0) return [];

        // `size` is the glyph's along-line footprint as the LAYOUT settled it,
        // which the concertinas need because their rail gap is measured off it and
        // has to agree with the rails `buildRails` already laid from the same
        // number. `half` cannot stand in for it: on a bend the chord is shorter
        // than the arc, and a rail gap derived from the chord would drift away
        // from the rail it is supposed to reach.
        const frame = { spine: prepared, from, to, left, right, bearing, centre, half, size };

        switch (symbol.glyph) {
            case 'peak': return this.buildPeak(frame);
            case 'asterisk': return this.buildAsterisk(frame);
            case 'double-asterisk': return this.buildDoubleAsterisk(frame);
            case 'coil': return this.buildCoil(frame);
            case 'coil-double': return this.buildCoilDouble(frame, symbol);
            case 'coil-triple': return this.buildCoilTriple(frame, symbol);
            case 'diamond':
            default: return this.buildDiamond(frame);
        }
    }

    /**
     * The continuous rails that run beside the spine, for the symbols that have
     * them (the double and triple concertinas).
     *
     * NOT `turf.lineOffset`, which offsets in DEGREE space and so lays the rail at
     * `gap * cos(latitude)` on the ground for any line that is not east-west.
     * Measured against the bundled turf on 2026-09-03, asking for 675 m: 675.00 m
     * east-west, but 584.57 m on a north-south line at 30 S and 387.16 m at 55 S.
     * The error is not cosmetic. The ONLY thing separating the triple concertina
     * from the double is that the triple's loop stays inside its rails, so a rail
     * pulled 90 m in makes the loop overtop it, and at every Brazilian latitude a
     * north-south 290309 would draw as a 290308.
     *
     * Stepping each vertex with `turf.destination` is geodesic, and the bend is
     * handled by the bisector: at an interior vertex the step follows the average
     * of the two bearings, lengthened by `1 / cos(half the turn)` so the rail keeps
     * its distance from BOTH segments rather than cutting the corner. The
     * lengthening is capped, because a hairpin sends that factor to infinity.
     *
     * @param {Object} line - Turf lineString feature
     * @param {number} sizeKm - The glyph size the layout settled on, in kilometres
     * @param {{rails?: number, railGapRatio?: number}} symbol - Catalogue entry
     * @returns {Array<Array>} One coordinate array per rail, empty when there are none
     */
    buildRails(line, sizeKm, symbol) {
        if (!symbol.rails) return [];

        const gap = sizeKm * (symbol.railGapRatio ?? 1);
        if (!Number.isFinite(gap) || gap <= 0) return [];

        const rails = [];
        for (let i = 1; i <= symbol.rails; i++) {
            const coords = this.offsetGeodesic(line, gap * i);
            if (coords.length >= 2) rails.push(coords);
        }
        return rails;
    }

    /**
     * Walk a line and step every vertex the same distance to its LEFT, geodesically.
     *
     * Left is `bearing - 90`, the side every glyph is built on, so the loops and the
     * rail they cross stay on one side of the spine.
     *
     * @param {Object} line - Turf lineString feature
     * @param {number} distanceKm - Distance from the spine, in kilometres
     * @returns {Array} Coordinate array, empty when the offset cannot be built
     */
    offsetGeodesic(line, distanceKm) {
        const { MITER_LIMIT } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;

        try {
            const coords = line.geometry.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return [];

            const bearings = [];
            for (let i = 0; i < coords.length - 1; i++) {
                bearings.push(turf.bearing(turf.point(coords[i]), turf.point(coords[i + 1])));
            }

            return coords.map((coord, i) => {
                const entra = bearings[i - 1] ?? bearings[0];
                const sai = bearings[i] ?? bearings[bearings.length - 1];

                // Half the turn, wrapped into (-180, 180] so a bend across due
                // north averages the short way round instead of the long way.
                const virada = (((sai - entra) + 540) % 360) - 180;
                const rumo = entra + virada / 2;
                const esticar = Math.min(1 / Math.cos((virada / 2) * Math.PI / 180), MITER_LIMIT);

                return this.step(turf.point(coord), distanceKm * esticar, rumo - 90);
            });
        } catch (error) {
            console.warn('Error offsetting coordination line rail:', error);
            return [];
        }
    }

    /**
     * Walk a CONTINUOUS pattern from one end of the line to the other.
     *
     * Unlike the glyph walk, nothing here emits a stretch of plain spine: the
     * pattern replaces the line entirely, so a sap that also drew its spine would
     * be a zigzag with a chord through it.
     *
     * @param {Object} spine - Prepared spine, or a bare turf lineString feature
     * @param {{count: number, period: number}} pattern - Continuous layout
     * @param {Object} symbol - Catalogue entry
     * @returns {Array<Array>} Coordinate arrays for the MultiLineString
     */
    buildContinuousPattern(spine, pattern, symbol) {
        const { count, period } = pattern;
        const prepared = this.spineOf(spine);
        const teeth = [];

        for (let i = 0; i < count; i++) {
            const from = i * period;
            const to = from + period;
            teeth.push(...this.zigzagTooth(prepared, from, to, symbol));
        }

        return teeth.filter(coords => Array.isArray(coords) && coords.length >= 2);
    }

    /**
     * The bearing of the first pair of points that are far enough apart to have one.
     *
     * `turf.bearing` answers 0 for two coincident points, which is a real bearing
     * (due north) and so passes every finiteness check downstream while pointing
     * somewhere the geometry never meant.
     *
     * @param {...Array<Object>} pairs - Candidate `[from, to]` turf points, in order
     * @returns {number|null} Bearing in degrees, or null when every pair collapses
     */
    firstFiniteBearing(...pairs) {
        const { COINCIDENT_KM } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;

        for (const [from, to] of pairs) {
            if (turf.distance(from, to, { units: 'kilometers' }) > COINCIDENT_KM) {
                return turf.bearing(from, to);
            }
        }
        return null;
    }

    /**
     * One tooth of the sap (290999/01) or the trench (290999/02): an optional flat
     * run along the line, then a V dropping off it and climbing back.
     *
     * The two symbols share a code and this builder, and differ ONLY in the two
     * ratios the catalogue gives them. Measured off the manual plates on
     * 2026-09-03: the sap is a bare V, 46 px of period against 28 px of depth and
     * no flat at all (its 3 to 5 px of level pixels are the stroke width at the
     * apex); the trench carries a flat of 18 px on a 44 px period, 41% of it, with
     * a 31 px depth. Draw them with the same flat and they become the same symbol.
     *
     * @param {Object} spine - Prepared spine, or a bare turf lineString feature
     * @param {number} from - Distance along the line where the tooth starts
     * @param {number} to - Distance along the line where it ends
     * @param {{depthRatio?: number, flatRatio?: number}} symbol - Catalogue entry
     * @returns {Array<Array>} One open polyline for the tooth
     */
    zigzagTooth(spine, from, to, symbol) {
        const period = to - from;
        if (!(period > 0)) return [];

        const flat = period * Math.min(Math.max(symbol.flatRatio ?? 0, 0), 0.9);
        const vStart = from + flat;
        const vMid = from + flat + (period - flat) / 2;

        const prepared = this.spineOf(spine);
        const startPt = this.alongPrepared(prepared, from);
        const cornerPt = this.alongPrepared(prepared, vStart);
        const midPt = this.alongPrepared(prepared, vMid);
        const endPt = this.alongPrepared(prepared, to);

        // The apex hangs off the FIRST HALF of the V, and deliberately not off the
        // chord from corner to end.
        //
        // On a line that doubles back on itself (A -> B -> A, which the user draws
        // by mistake more often than one would think) the tooth sitting on the turn
        // has its two feet at the SAME point: the walk out and the walk home are
        // the same ground. `turf.bearing` of two coincident points is 0, due north,
        // so the apex went out at 90, ALONG the line instead of across it. Measured
        // on 2026-09-03 with `[[-53,-30],[-52.95,-30],[-53,-30]]` at 500 m: one
        // tooth of the nineteen came out with a 0 m chord and a 669 m spike against
        // the 487 m of its neighbours, on all three continuous symbols.
        //
        // Half a tooth cannot collapse on a doubling-back line, because the turn
        // falls on the midpoint, not inside the leg. The fallbacks below cover the
        // turn landing somewhere else, and a tooth with no usable bearing at all is
        // dropped rather than drawn as a spike.
        const bearing = this.firstFiniteBearing(
            [cornerPt, midPt],
            [startPt, midPt],
            [cornerPt, endPt],
        );
        if (bearing === null) return [];

        const depth = period * (symbol.depthRatio ?? 0.6);
        const apex = this.step(midPt, depth, bearing + 90);

        const tooth = [startPt.geometry.coordinates];
        if (flat > 0) tooth.push(cornerPt.geometry.coordinates);
        tooth.push(apex, endPt.geometry.coordinates);

        // A solid tooth is a RING, so it closes back on its first point. The sap
        // and the trench stay open: closing them would draw a chord across every
        // V, which is the one line the symbol must not have.
        if (symbol.filled) tooth.push(startPt.geometry.coordinates);

        return [tooth];
    }

    /**
     * Move from a point by a distance and a bearing, returning bare coordinates.
     * @param {Object} origin - Turf point feature
     * @param {number} distance - Distance in kilometres
     * @param {number} bearing - Bearing in degrees
     * @returns {Array} `[lng, lat]`
     */
    step(origin, distance, bearing) {
        return turf.destination(origin, distance, bearing, { units: 'kilometers' }).geometry.coordinates;
    }

    /**
     * Coordination line (290199): a closed rhombus whose left and right vertices sit
     * on the line, so the interrupted line runs into it and out of it.
     * @param {Object} frame - Shared glyph frame
     * @returns {Array<Array>} One closed ring
     */
    buildDiamond({ left, right, bearing, centre, half }) {
        return [[
            left.geometry.coordinates,
            this.step(centre, half, bearing - 90),
            right.geometry.coordinates,
            this.step(centre, half, bearing + 90),
            left.geometry.coordinates,
        ]];
    }

    /**
     * Obstacle line (290100): a triangular peak rising from the line, open at the
     * bottom because the interrupted line already closes it.
     * @param {Object} frame - Shared glyph frame
     * @returns {Array<Array>} One open ring
     */
    buildPeak({ left, right, bearing, centre, half }) {
        return [[
            left.geometry.coordinates,
            this.step(centre, half, bearing - 90),
            right.geometry.coordinates,
        ]];
    }

    /**
     * Wire fence (290302): three crossing strokes centred ON the line, which is
     * not interrupted underneath them.
     * @param {Object} frame - Shared glyph frame
     * @returns {Array<Array>} Three two-point strokes
     */
    buildAsterisk({ bearing, centre, half }) {
        return this.asteriskAt(centre, bearing, half);
    }

    /**
     * Double wire fence (290303): the same star twice, side by side along the
     * line, each half the width so the pair occupies the glyph's span.
     * @param {Object} frame - Shared glyph frame
     * @returns {Array<Array>} Six two-point strokes
     */
    buildDoubleAsterisk({ spine, from, to, bearing, half }) {
        const span = to - from;
        const radius = half * 0.45;
        const first = this.alongPrepared(spine, from + span * 0.27);
        const second = this.alongPrepared(spine, from + span * 0.73);

        return [
            ...this.asteriskAt(first, bearing, radius),
            ...this.asteriskAt(second, bearing, radius),
        ];
    }

    /**
     * The three strokes of one star, at 0, 60 and 120 degrees from the line.
     * @param {Object} centre - Turf point feature
     * @param {number} bearing - Local line bearing
     * @param {number} radius - Half length of each stroke, in kilometres
     * @returns {Array<Array>} Three two-point strokes
     */
    asteriskAt(centre, bearing, radius) {
        return [0, 60, 120].map(offset => ([
            this.step(centre, radius, bearing + offset),
            this.step(centre, radius, bearing + offset + 180),
        ]));
    }

    /**
     * Concertina (290307): a closed loop standing on the line, drawn as an
     * ellipse whose lowest point touches the (unbroken) line.
     * @param {Object} frame - Shared glyph frame
     * @returns {Array<Array>} One closed ring
     */
    buildCoil({ bearing, centre, half }) {
        const { COIL_HEIGHT_RATIO } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const crossRadius = half * COIL_HEIGHT_RATIO;

        // Lifted by its own height so the loop sits ON the line instead of
        // straddling it.
        const loopCentre = turf.destination(centre, crossRadius, bearing - 90, { units: 'kilometers' });

        return [this.ellipseRing(loopCentre, bearing, half, crossRadius)];
    }

    /**
     * Double concertina (290308): two rails a short way apart, with a loop that
     * stands on the spine and OVERTOPS the far rail.
     *
     * The overtopping is the whole difference from the triple, which contains its
     * loop between the rails. Measured off the manual plate on 2026-09-03: a 19 px
     * band, rails 7 px apart, loop 18 px tall, so the loop clears the far rail by
     * more than the gap itself.
     *
     * @param {Object} frame - Shared glyph frame
     * @param {Object} symbol - Catalogue entry, for the rail gap
     * @returns {Array<Array>} One closed ring
     */
    buildCoilDouble({ bearing, centre, half, size }, symbol) {
        const { COIL_DOUBLE_HEIGHT_RATIO } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const gap = size * (symbol.railGapRatio ?? 1);
        const crossRadius = (gap * COIL_DOUBLE_HEIGHT_RATIO) / 2;

        const loopCentre = turf.destination(centre, crossRadius, bearing - 90, { units: 'kilometers' });

        return [this.ellipseRing(loopCentre, bearing, half, crossRadius)];
    }

    /**
     * Triple concertina (290309): two rails far apart, with the loop CONTAINED
     * between them, touching both.
     *
     * @param {Object} frame - Shared glyph frame
     * @param {Object} symbol - Catalogue entry, for the rail gap
     * @returns {Array<Array>} One closed ring
     */
    buildCoilTriple({ bearing, centre, half, size }, symbol) {
        const { COIL_TRIPLE_HEIGHT_RATIO } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const gap = size * (symbol.railGapRatio ?? 1);
        const crossRadius = (gap * COIL_TRIPLE_HEIGHT_RATIO) / 2;

        // Centred BETWEEN the two rails, not lifted off the spine: the loop has to
        // touch both, and the rails sit at 0 and `gap` off the line.
        const loopCentre = turf.destination(centre, gap / 2, bearing - 90, { units: 'kilometers' });

        return [this.ellipseRing(loopCentre, bearing, half, crossRadius)];
    }

    /**
     * A closed ellipse, its long axis along the line and its short one across.
     * Shared by all three concertinas, which differ only in where the centre sits
     * and how tall the loop is.
     *
     * @param {Object} loopCentre - Turf point at the ellipse centre
     * @param {number} bearing - Local line bearing
     * @param {number} alongRadius - Semi-axis along the line, in kilometres
     * @param {number} crossRadius - Semi-axis across the line, in kilometres
     * @returns {Array} Closed ring (last point repeats the first)
     */
    ellipseRing(loopCentre, bearing, alongRadius, crossRadius) {
        const { COIL_STEPS } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const ring = [];

        for (let i = 0; i <= COIL_STEPS; i++) {
            const angle = (2 * Math.PI * i) / COIL_STEPS;
            const alongStep = turf.destination(
                loopCentre, alongRadius * Math.cos(angle), bearing, { units: 'kilometers' },
            );
            ring.push(this.step(alongStep, crossRadius * Math.sin(angle), bearing - 90));
        }

        return ring;
    }

    /**
     * Length of the spine in kilometres, or NaN when it cannot be measured.
     * @param {Array} coordinates - Already-normalized base coordinates
     * @returns {number} Length in kilometres
     */
    measureLengthKm(coordinates) {
        try {
            if (!Array.isArray(coordinates) || coordinates.length < 2) return NaN;
            return turf.length(turf.lineString(coordinates), { units: 'kilometers' });
        } catch {
            return NaN;
        }
    }

    /**
     * How many diamonds a feature draws at a given zoom, and whether the cap fired.
     * Used by the attributes panel to tell the user what the sliders bought them.
     * @param {Object} properties - Feature properties
     * @param {number} [currentZoom] - Current map zoom
     * @returns {{count: number, capped: boolean}} Diamond count and cap flag
     */
    describeLayout(properties, currentZoom) {
        const coordinates = this.normalizeBaseCoordinates(properties?.baseCoordinates);
        const totalLength = this.measureLengthKm(coordinates);
        const { calculatedSymbolSize, calculatedSymbolSpacing } =
            computeCoordinationLineZoomSizes(properties, currentZoom);
        const symbol = resolveSymbol(properties?.symbol_code);

        // The panel has to read the count off the SAME layout the drawing used, or
        // it reports a number the line does not have. A continuous symbol never
        // passes through resolveGlyphLayout, so neither does its count.
        if (symbol.continuous) {
            const pattern = resolveContinuousLayout(totalLength, calculatedSymbolSize);
            return { count: pattern.count, capped: pattern.capped, symbol };
        }

        // The same footprint the geometry lays out, or the panel would report a
        // count the drawing does not have.
        const layout = resolveGlyphLayout(
            totalLength,
            calculatedSymbolSize * symbol.spanRatio,
            calculatedSymbolSpacing,
        );
        return { count: layout.count, capped: layout.capped, symbol };
    }

    // ========================================================================
    // VALIDATION AND NORMALIZATION
    // ========================================================================

    /**
     * Validate the drawn spine.
     * @param {Array} coordinates - Base coordinates array
     * @returns {boolean} True when at least two usable coordinates are present
     */
    validate(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return false;
        return coordinates.filter(coord => this.isUsableCoordinate(coord)).length >= 2;
    }

    /**
     * Whether a value is a usable `[lng, lat]` pair.
     * @param {*} coord - Candidate coordinate
     * @returns {boolean} True when both members are finite numbers
     */
    isUsableCoordinate(coord) {
        return Array.isArray(coord)
            && coord.length >= 2
            && Number.isFinite(coord[0])
            && Number.isFinite(coord[1]);
    }

    /**
     * Normalize base coordinates, which reach here as an array or as the JSON
     * string a MapLibre source round-trip leaves behind.
     * @param {string|Array} coords - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates, or null when unusable
     */
    normalizeBaseCoordinates(coords) {
        if (!coords) return null;

        if (Array.isArray(coords)) {
            return coords.every(coord => this.isUsableCoordinate(coord)) ? coords : null;
        }

        if (typeof coords === 'string') {
            try {
                const parsed = JSON.parse(coords);
                return Array.isArray(parsed) ? this.normalizeBaseCoordinates(parsed) : null;
            } catch (error) {
                console.error('Error parsing coordination line baseCoordinates:', coords, error);
                return null;
            }
        }

        return null;
    }

    /**
     * Whether a new point lands on top of the previous one.
     * @param {Array} newPoint - Candidate point [lng, lat]
     * @param {Array} existingPoints - Points drawn so far
     * @returns {boolean} True when the point is closer than the minimum
     */
    isPointTooClose(newPoint, existingPoints) {
        if (!Array.isArray(existingPoints) || existingPoints.length === 0) return false;
        const lastPoint = existingPoints[existingPoints.length - 1];
        return this.calculateDistance(lastPoint, newPoint) < this.MIN_DISTANCE_METERS;
    }

    // ========================================================================
    // EDIT HANDLES
    // ========================================================================

    /**
     * Build the edit handles: one per vertex, plus one at the midpoint of every
     * segment for inserting a vertex.
     *
     * The handle kind travels in `properties.type`, matching the boundary tool
     * and the `coordination-line-edit-handles-layer` paint expression.
     *
     * @param {Object} feature - Coordination line feature
     * @returns {Array} Handle point features
     */
    createHandles(feature) {
        const coords = this.normalizeBaseCoordinates(feature?.properties?.baseCoordinates);
        if (!coords || coords.length < 2) return [];

        const featureId = feature.properties.id;
        const handles = [];

        coords.forEach((coord, index) => {
            handles.push({
                type: 'Feature',
                id: `coordination-line-handle-${featureId}-v${index}`,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    type: 'vertex',
                    index,
                    featureId,
                    mode: 'coordination_line_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true,
                },
            });
        });

        for (let index = 0; index < coords.length - 1; index++) {
            const midpoint = [
                (coords[index][0] + coords[index + 1][0]) / 2,
                (coords[index][1] + coords[index + 1][1]) / 2,
            ];
            handles.push({
                type: 'Feature',
                id: `coordination-line-handle-${featureId}-m${index}`,
                geometry: { type: 'Point', coordinates: midpoint },
                properties: {
                    role: 'handle',
                    type: 'midpoint',
                    index,
                    featureId,
                    mode: 'coordination_line_editing',
                    meta: 'midpoint',
                    user_isEditingHandle: true,
                },
            });
        }

        return handles;
    }

    /**
     * Apply a handle drag.
     *
     * A vertex handle moves the vertex it sits on. A midpoint handle INSERTS a
     * new vertex between its two neighbours, which is how a coordination line gains
     * detail without being redrawn.
     *
     * @param {string} handleType - `'vertex'` or `'midpoint'`
     * @param {Array} newPosition - New position [lng, lat]
     * @param {Object} feature - Feature being edited
     * @param {number} [handleIndex] - Index carried by the handle
     * @param {number} [currentZoom] - Current map zoom
     * @returns {{geometry: Object, properties: Object, baseCoordinates: Array}|null}
     *   Null when the drag cannot be applied, which leaves the feature untouched
     */
    updateFromHandle(handleType, newPosition, feature, handleIndex = null, currentZoom) {
        if (!['vertex', 'midpoint'].includes(handleType)) {
            console.warn('Unknown handle type for coordination line:', handleType);
            return null;
        }
        if (!this.isUsableCoordinate(newPosition)) return null;

        const coords = this.normalizeBaseCoordinates(feature?.properties?.baseCoordinates);
        if (!coords || coords.length < 2) return null;

        const index = Number.isInteger(handleIndex) ? handleIndex : Number(handleIndex);
        if (!Number.isInteger(index) || index < 0) return null;

        const newCoords = [...coords];

        if (handleType === 'vertex') {
            if (index >= newCoords.length) return null;
            newCoords[index] = newPosition;
        } else {
            if (index >= newCoords.length - 1) return null;
            newCoords.splice(index + 1, 0, newPosition);
        }

        const properties = { ...feature.properties, baseCoordinates: newCoords };

        return {
            geometry: this.generate(properties, currentZoom),
            properties,
            baseCoordinates: newCoords,
        };
    }

    /**
     * Remove a vertex, keeping the minimum of two.
     * @param {Array} coordinates - Current base coordinates
     * @param {number} index - Vertex index to remove
     * @returns {Array|null} New coordinates, or null when the removal is refused
     */
    removeVertexAtIndex(coordinates, index) {
        const coords = this.normalizeBaseCoordinates(coordinates);
        if (!coords || coords.length <= 2) return null;
        if (!Number.isInteger(index) || index < 0 || index >= coords.length) return null;

        const newCoords = [...coords];
        newCoords.splice(index, 1);
        return newCoords;
    }

    // ========================================================================
    // BOUNDS AND MOVEMENT
    // ========================================================================

    /**
     * Bounding box of the spine.
     * @param {Array} coordinates - Base coordinates
     * @returns {Array|null} `[minLng, minLat, maxLng, maxLat]`, or null
     */
    getBoundingBox(coordinates) {
        const coords = this.normalizeBaseCoordinates(coordinates);
        if (!coords || coords.length === 0) return null;

        const lngs = coords.map(coord => coord[0]);
        const lats = coords.map(coord => coord[1]);

        return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    }

    /**
     * Reference point for move operations: the first vertex.
     * @param {Array} coordinates - Base coordinates
     * @returns {Array|null} `[lng, lat]`, or null
     */
    calculateCenter(coordinates) {
        const coords = this.normalizeBaseCoordinates(coordinates);
        return coords && coords.length > 0 ? coords[0] : null;
    }

    /**
     * The diamond ceiling, re-exported so the control and the panel do not have
     * to import the model just to name it.
     * @returns {number} Maximum diamonds per feature
     */
    get maxGlyphs() {
        return COORDINATION_LINE_ZOOM_LIMITS.MAX_GLYPHS;
    }
}

export default AddCoordinationLineGeometry;
