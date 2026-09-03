// Path: js/military_tools/barrier_line_tool/add_barrier_line_geometry.js

import { BaseGeometry } from '@tools';
import {
    computeBarrierLineZoomSizes,
    resolveDiamondLayout,
    BARRIER_LINE_ZOOM_LIMITS,
} from './barrier-line-zoom.model.js';

/**
 * Barrier Line Geometry Operations
 *
 * Draws the "Linha de Barreiras" symbol: a polyline whose course is interrupted
 * at regular intervals by a hollow diamond, so the line runs into the diamond's
 * left vertex and out of its right one.
 *
 * Everything is emitted as ONE MultiLineString: the surviving line segments plus
 * one closed four-point ring per diamond. A single `line` layer draws the lot,
 * which is why the diamond reads as hollow and why this tool needs no dependent
 * features, no sibling sources, and no fill layer.
 *
 * The arithmetic that decides HOW MANY diamonds and WHERE lives in
 * barrier-line-zoom.model.js, which has no imports and is tested in node. This
 * class owns only the turf part.
 */
class AddBarrierLineGeometry extends BaseGeometry {
    static GEOMETRY_CONSTANTS = {
        /** Two clicks closer than this do not add a second vertex. */
        MIN_DISTANCE_METERS: 5,
        /** Shorter than this, a slice is not worth emitting. */
        MIN_LENGTH_KM: 0.001,
    };

    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = AddBarrierLineGeometry.GEOMETRY_CONSTANTS.MIN_DISTANCE_METERS;
    }

    // ========================================================================
    // GEOMETRY GENERATION
    // ========================================================================

    /**
     * Generate the barrier line geometry.
     * @param {Object} properties - Feature properties, including `baseCoordinates`
     * @param {number} [currentZoom] - Current map zoom (omitted = no map)
     * @returns {Object} GeoJSON MultiLineString, or a bare LineString when no
     *   whole diamond fits or the drawing cannot be built
     */
    generate(properties, currentZoom) {
        return this.generateBarrierLineGeometry(properties, currentZoom);
    }

    /**
     * Build the line-with-gaps plus the diamonds.
     * Every failure path degrades to the raw spine rather than to empty geometry:
     * a barrier line that cannot draw its diamonds is still a line the user drew.
     * @param {Object} properties - Feature properties
     * @param {number} [currentZoom] - Current map zoom
     * @returns {Object} GeoJSON geometry
     */
    generateBarrierLineGeometry(properties, currentZoom) {
        const baseCoordinates = this.normalizeBaseCoordinates(properties?.baseCoordinates);

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for barrier line:', properties?.baseCoordinates);
            return { type: 'LineString', coordinates: baseCoordinates || [[0, 0], [0, 0]] };
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });

            const { calculatedSymbolSize, calculatedSymbolSpacing } =
                computeBarrierLineZoomSizes(properties, currentZoom);

            const layout = resolveDiamondLayout(
                totalLength,
                calculatedSymbolSize,
                calculatedSymbolSpacing,
            );

            if (layout.count === 0) {
                return { type: 'LineString', coordinates: baseCoordinates };
            }

            const lines = this.buildSegmentsAndDiamonds(line, totalLength, layout);

            if (lines.length === 0) {
                return { type: 'LineString', coordinates: baseCoordinates };
            }

            return { type: 'MultiLineString', coordinates: lines };
        } catch (error) {
            console.warn('Error generating barrier line geometry:', error);
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
    buildSegmentsAndDiamonds(line, totalLength, layout) {
        const { MIN_LENGTH_KM } = AddBarrierLineGeometry.GEOMETRY_CONSTANTS;
        const { count, size, spacing, start } = layout;
        const half = size / 2;
        const lines = [];
        let cursor = 0;

        for (let i = 0; i < count; i++) {
            const centre = start + i * spacing;
            const gapStart = Math.max(0, centre - half);
            const gapEnd = Math.min(totalLength, centre + half);

            if (gapStart - cursor > MIN_LENGTH_KM) {
                lines.push(this.sliceAlong(line, cursor, gapStart));
            }

            lines.push(this.buildDiamond(line, gapStart, gapEnd));
            cursor = Math.max(cursor, gapEnd);
        }

        if (totalLength - cursor > MIN_LENGTH_KM) {
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
            console.warn('Error slicing barrier line:', error);
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
    buildDiamond(line, from, to) {
        const left = turf.along(line, from, { units: 'kilometers' });
        const right = turf.along(line, to, { units: 'kilometers' });

        const chordBearing = turf.bearing(left, right);
        const midpoint = turf.midpoint(left, right);
        const halfWidth = turf.distance(left, right, { units: 'kilometers' }) / 2;

        const top = turf.destination(midpoint, halfWidth, chordBearing - 90, { units: 'kilometers' });
        const bottom = turf.destination(midpoint, halfWidth, chordBearing + 90, { units: 'kilometers' });

        return [
            left.geometry.coordinates,
            top.geometry.coordinates,
            right.geometry.coordinates,
            bottom.geometry.coordinates,
            left.geometry.coordinates,
        ];
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
            computeBarrierLineZoomSizes(properties, currentZoom);
        const layout = resolveDiamondLayout(totalLength, calculatedSymbolSize, calculatedSymbolSpacing);
        return { count: layout.count, capped: layout.capped };
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
                console.error('Error parsing barrier line baseCoordinates:', coords, error);
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
     * and the `barrier-line-edit-handles-layer` paint expression.
     *
     * @param {Object} feature - Barrier line feature
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
                id: `barrier-line-handle-${featureId}-v${index}`,
                geometry: { type: 'Point', coordinates: coord },
                properties: {
                    role: 'handle',
                    type: 'vertex',
                    index,
                    featureId,
                    mode: 'barrier_line_editing',
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
                id: `barrier-line-handle-${featureId}-m${index}`,
                geometry: { type: 'Point', coordinates: midpoint },
                properties: {
                    role: 'handle',
                    type: 'midpoint',
                    index,
                    featureId,
                    mode: 'barrier_line_editing',
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
     * new vertex between its two neighbours, which is how a barrier line gains
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
            console.warn('Unknown handle type for barrier line:', handleType);
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
    get maxDiamonds() {
        return BARRIER_LINE_ZOOM_LIMITS.MAX_DIAMONDS;
    }
}

export default AddBarrierLineGeometry;
