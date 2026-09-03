// Path: js/military_tools/coordination_line_tool/add_coordination_line_geometry.js

import { BaseGeometry } from '@tools';
import {
    computeCoordinationLineZoomSizes,
    resolveGlyphLayout,
    COORDINATION_LINE_ZOOM_LIMITS,
} from './coordination-line-zoom.model.js';
import { resolveSymbol } from './coordination_line_catalog.js';

/**
 * Coordination Line Geometry Operations
 *
 * Draws the MD33 linear coordination symbols: a polyline carrying a glyph repeated
 * at a regular spacing. Some glyphs INTERRUPT the line (the barrier diamond, the
 * obstacle peak) and the line runs into the glyph and out of it; others ride on an
 * unbroken line (the fences, the concertina). The catalogue decides which.
 *
 * Everything is emitted as ONE MultiLineString: the line (whole, or the pieces that
 * survive the gaps) plus one ring per glyph stroke. A single `line` layer draws the
 * lot, which is why every glyph reads as hollow and why this tool needs no
 * dependent features, no sibling sources, and no fill layer.
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

            const lines = this.buildSegmentsAndGlyphs(line, totalLength, layout, symbol);

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
     * @param {Object} line - Turf lineString feature
     * @param {number} totalLength - Line length in kilometres
     * @param {{count: number, size: number, spacing: number, start: number}} layout - Diamond layout
     * @returns {Array<Array>} Coordinate arrays for the MultiLineString
     */
    buildSegmentsAndGlyphs(line, totalLength, layout, symbol) {
        const { MIN_LENGTH_KM } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const { count, size, spacing, start } = layout;
        const half = size / 2;
        const lines = [];

        // A symbol that rides ON the line needs the line whole underneath it, so
        // the spine goes in once and the walk below only adds glyphs.
        if (!symbol.interrupts) {
            lines.push(this.sliceAlong(line, 0, totalLength));
        }

        let cursor = 0;

        for (let i = 0; i < count; i++) {
            const centre = start + i * spacing;
            const glyphStart = Math.max(0, centre - half);
            const glyphEnd = Math.min(totalLength, centre + half);

            if (symbol.interrupts) {
                if (glyphStart - cursor > MIN_LENGTH_KM) {
                    lines.push(this.sliceAlong(line, cursor, glyphStart));
                }
                cursor = Math.max(cursor, glyphEnd);
            }

            lines.push(...this.glyphRings(line, glyphStart, glyphEnd, symbol));
        }

        if (symbol.interrupts && totalLength - cursor > MIN_LENGTH_KM) {
            lines.push(this.sliceAlong(line, cursor, totalLength));
        }

        return lines.filter(coords => Array.isArray(coords) && coords.length >= 2);
    }

    /**
     * Cut the stretch of line between two distances along it.
     *
     * `turf.lineSliceAlong` and NOT `turf.lineSlice`: the latter takes points and
     * re-projects them onto the line with a planar nearest-point, which disagrees
     * with the great-circle interpolation `turf.along` uses to place the diamond
     * vertices. Measured on 2026-09-03 against the bundled turf, that disagreement
     * left a visible gap between the segment and the diamond it should touch: 1.13 m
     * on a 10 km line and 113.59 m on a 100 km one, against 0.00 m for every case
     * with `lineSliceAlong`.
     *
     * @param {Object} line - Turf lineString feature
     * @param {number} from - Start distance in kilometres
     * @param {number} to - End distance in kilometres
     * @returns {Array} Coordinate array, empty when the slice cannot be built
     */
    sliceAlong(line, from, to) {
        try {
            const slice = turf.lineSliceAlong(line, from, to, { units: 'kilometers' });
            return slice?.geometry?.coordinates ?? [];
        } catch (error) {
            console.warn('Error slicing coordination line:', error);
            return [];
        }
    }

    /**
     * Build one closed diamond whose left and right vertices sit ON the line.
     *
     * Both are read with `turf.along`, the same call the gap boundaries come
     * from, which is what makes the join seamless. The transverse half-diagonal
     * is measured from the CHORD between them rather than from the requested
     * size, so a diamond straddling a bend stays a rhombus instead of stretching.
     *
     * @param {Object} line - Turf lineString feature
     * @param {number} from - Distance along the line of the left vertex
     * @param {number} to - Distance along the line of the right vertex
     * @returns {Array} Closed five-point ring (last point repeats the first)
     */
    glyphRings(line, from, to, symbol) {
        const left = turf.along(line, from, { units: 'kilometers' });
        const right = turf.along(line, to, { units: 'kilometers' });

        // Everything is measured from the CHORD between the two anchors, never
        // from the requested size: on a bend the arc is longer than the chord,
        // and a glyph built from the request would stretch out of shape.
        const bearing = turf.bearing(left, right);
        const centre = turf.midpoint(left, right);
        const half = turf.distance(left, right, { units: 'kilometers' }) / 2;

        if (half <= 0) return [];

        const frame = { line, from, to, left, right, bearing, centre, half };

        switch (symbol.glyph) {
            case 'peak': return this.buildPeak(frame);
            case 'asterisk': return this.buildAsterisk(frame);
            case 'double-asterisk': return this.buildDoubleAsterisk(frame);
            case 'coil': return this.buildCoil(frame);
            case 'diamond':
            default: return this.buildDiamond(frame);
        }
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
    buildDoubleAsterisk({ line, from, to, bearing, half }) {
        const span = to - from;
        const radius = half * 0.45;
        const first = turf.along(line, from + span * 0.27, { units: 'kilometers' });
        const second = turf.along(line, from + span * 0.73, { units: 'kilometers' });

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
        const { COIL_STEPS, COIL_HEIGHT_RATIO } = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
        const alongRadius = half;
        const crossRadius = half * COIL_HEIGHT_RATIO;

        // Lifted by its own height so the loop sits ON the line instead of
        // straddling it.
        const loopCentre = turf.destination(centre, crossRadius, bearing - 90, { units: 'kilometers' });

        const ring = [];
        for (let i = 0; i <= COIL_STEPS; i++) {
            const angle = (2 * Math.PI * i) / COIL_STEPS;
            const alongStep = turf.destination(
                loopCentre, alongRadius * Math.cos(angle), bearing, { units: 'kilometers' },
            );
            ring.push(this.step(alongStep, crossRadius * Math.sin(angle), bearing - 90));
        }

        return [ring];
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
