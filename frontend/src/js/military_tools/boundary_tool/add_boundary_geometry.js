// Path: js/military_tools/boundary_tool/add_boundary_geometry.js

import { BaseGeometry } from '@tools';

/**
 * Boundary Geometry Operations
 * Handles all geometric calculations for boundary features including:
 * - Complex multi-line geometry with gaps for symbols
 * - Echelon symbols (X, I, o combinations)
 * - Multiple handle types (vertex, midpoint, symbol, size, text distance)
 * - Dependent features (circles, texts)
 */
class AddBoundaryGeometry extends BaseGeometry {
    // ===== GEOMETRY CONSTANTS =====
    static GEOMETRY_CONSTANTS = {
        MIN_DISTANCE_METERS: 5,
        MIN_LENGTH_KM: 0.001,           // Minimum line length for processing
        MIN_SIZE_KM: 0.05,              // Minimum symbol size (matches control)
        SYMBOL_WIDTH_MULTIPLIER: 1.5,   // Symbol width = numSymbols * size * this
        GAP_WIDTH_MULTIPLIER: 1.2,      // Gap width = symbolWidth * this
        SYMBOL_SPACING_MULTIPLIER: 1.5, // Spacing between symbols
        VERTICAL_OFFSET_DIVISOR: 1.5,   // For I symbol positioning
        SYMBOL_POSITION_EPSILON: 0.01,  // Small distance for handle placement
        TEXT_DISTANCE_MIN: 0.1,         // Minimum text distance ratio
        TEXT_DISTANCE_MAX: 3.0,         // Maximum text distance ratio
        POSITION_RATIO_MIN: 0.01,       // Minimum position ratio
        POSITION_RATIO_MAX: 0.99        // Maximum position ratio
    };

    /** Fallback symbol size, the same one `createHandles` and `updateFromHandle` use. */
    static DEFAULT_SYMBOL_SIZE = 2;

    /** Fallback label distance ratio for `generateBoundaryTexts`. */
    static DEFAULT_TEXT_DISTANCE_RATIO = 0.9;

    constructor(properties = {}) {
        super(properties);
        this.MIN_DISTANCE_METERS = AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_DISTANCE_METERS;
    }

    /**
     * Whether a value is a usable coordinate position.
     *
     * `Number.isFinite`, not `!isNaN`: `!isNaN(Infinity)` is false, so the previous
     * hand-written predicate accepted Infinity in every one of the four places it
     * was copied to. This is the single copy those four now share.
     * @param {*} coord - Candidate position
     * @returns {boolean} True when the first two components are finite numbers
     */
    static isFinitePosition(coord) {
        return Array.isArray(coord)
            && coord.length >= 2
            && Number.isFinite(coord[0])
            && Number.isFinite(coord[1]);
    }

    /**
     * Clamp a position ratio to the valid placement range.
     * @param {number} r - Raw ratio
     * @returns {number} Clamped ratio (defaults to 0.5 when not finite)
     */
    clampRatio(r) {
        const { POSITION_RATIO_MIN, POSITION_RATIO_MAX } = AddBoundaryGeometry.GEOMETRY_CONSTANTS;
        if (!Number.isFinite(r)) return 0.5;
        return Math.max(POSITION_RATIO_MIN, Math.min(POSITION_RATIO_MAX, r));
    }

    /**
     * Resolve the echelon symbol instances for a boundary.
     * Each instance has its own position (`ratio`) and label visibility
     * (`showLabels`); the echelon string and symbol size stay shared.
     * Falls back to the legacy single `symbol_position_ratio` for older
     * features and `.ebgeo` files (migration-on-read).
     * @param {Object} properties - Feature properties
     * @returns {Array<{ratio: number, showLabels: boolean}>} Normalized instances (always >= 1)
     */
    getSymbolInstances(properties) {
        const raw = properties?.symbol_instances;
        if (Array.isArray(raw)) {
            // Keep every object entry and let clampRatio coerce a bad/missing ratio
            // to a valid one — dropping entries would shift indices out of sync with
            // the per-instance drag handles (handle index must match array index).
            const normalized = raw
                .filter(inst => inst && typeof inst === 'object')
                .map(inst => ({
                    ratio: this.clampRatio(inst.ratio),
                    showLabels: inst.showLabels !== false
                }));
            if (normalized.length > 0) {
                return normalized;
            }
        }

        const legacyRatio = Number.isFinite(properties?.symbol_position_ratio)
            ? properties.symbol_position_ratio
            : 0.5;
        return [{ ratio: this.clampRatio(legacyRatio), showLabels: true }];
    }

    /**
     * The instance that the shared handles (size, text-distance) anchor to:
     * the spatially leftmost symbol (lowest ratio), so the handles stay on a
     * predictable symbol regardless of array/creation order or later drags.
     * @param {Array<{ratio: number}>} instances - Normalized instances (>= 1)
     * @returns {{ratio: number, showLabels: boolean}} The anchor instance
     */
    getAnchorInstance(instances) {
        return instances.reduce((leftmost, inst) => (inst.ratio < leftmost.ratio ? inst : leftmost), instances[0]);
    }

    /**
     * Generate boundary geometry with symbols and gaps
     * @param {Object} properties - Boundary properties including baseCoordinates
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    generate(properties) {
        return this.generateBoundaryGeometry(properties);
    }

    /**
     * Validate boundary parameters
     * @param {Array} coordinates - Base coordinates array
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        const validCoords = coordinates.filter(AddBoundaryGeometry.isFinitePosition);

        return validCoords.length >= 2;
    }

    /**
     * Normalize base coordinates from various formats
     * @param {string|Array} coords - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeBaseCoordinates(coords) {
        if (!coords) {
            console.warn('baseCoordinates is null or undefined');
            return null;
        }

        if (Array.isArray(coords)) {
            const isValidArray = coords.every(AddBoundaryGeometry.isFinitePosition);

            if (isValidArray) {
                return coords;
            } else {
                console.warn('baseCoordinates array contains invalid coordinates:', coords);
                return null;
            }
        }

        if (typeof coords === 'string') {
            try {
                const parsed = JSON.parse(coords);
                if (Array.isArray(parsed)) {
                    return this.normalizeBaseCoordinates(parsed);
                } else {
                    console.warn('Parsed baseCoordinates is not an array:', parsed);
                    return null;
                }
            } catch (e) {
                console.error('Error parsing baseCoordinates string:', coords, e);
                return null;
            }
        }

        console.warn('baseCoordinates is neither array nor string:', typeof coords, coords);
        return null;
    }

    /**
     * Check if point is too close to existing points
     * @param {Array} newPoint - New point [lng, lat]
     * @param {Array} existingPoints - Array of existing points
     * @returns {boolean} True if too close
     */
    isPointTooClose(newPoint, existingPoints) {
        if (existingPoints.length === 0) return false;

        const lastPoint = existingPoints[existingPoints.length - 1];
        const distance = this.calculateDistance(lastPoint, newPoint);
        return distance < this.MIN_DISTANCE_METERS;
    }

    /**
     * Generate main boundary geometry with gaps for symbols
     * @param {Object} properties - Feature properties
     * @returns {Object} GeoJSON MultiLineString geometry
     */
    generateBoundaryGeometry(properties) {
        let { baseCoordinates, symbol_size, echelon } = properties;

        baseCoordinates = this.normalizeBaseCoordinates(baseCoordinates);

        if (!baseCoordinates || baseCoordinates.length < 2) {
            console.warn('Invalid baseCoordinates for boundary:', baseCoordinates);
            // The empty array is TRUTHY, so `baseCoordinates || [[0,0],[0,0]]` kept it
            // and emitted a LineString with zero positions, which is malformed GeoJSON
            // rather than a degenerate line. Test the LENGTH, not the truthiness.
            return {
                type: 'LineString',
                coordinates: baseCoordinates && baseCoordinates.length > 0
                    ? baseCoordinates
                    : [[0, 0], [0, 0]]
            };
        }

        // (The `[[0,0],[1,1]]` fallback that used to sit here was dead: it was guarded
        // by the very predicate `normalizeBaseCoordinates` already enforces one step
        // earlier, so a coordinate list that failed it was already null above.)

        try {
            const instances = this.getSymbolInstances(properties);
            const lineWithGaps = this.createLineWithGaps(baseCoordinates, instances, symbol_size, echelon);
            const symbolLines = this.createEchelonSymbolLines(baseCoordinates, instances, symbol_size, echelon);
            const allLines = [...lineWithGaps, ...symbolLines];

            if (allLines.length === 0) {
                return {
                    type: 'LineString',
                    coordinates: baseCoordinates
                };
            }

            return {
                type: 'MultiLineString',
                coordinates: allLines
            };

        } catch (error) {
            console.warn('Error generating boundary geometry:', error);
            return {
                type: 'LineString',
                coordinates: baseCoordinates
            };
        }
    }

    /**
     * Create line segments with one gap per symbol instance.
     * Builds a gap interval around each instance position, merges overlapping
     * gaps (when symbols sit close together), then returns the complement
     * segments of the line.
     * @param {Array} coordinates - Base coordinates
     * @param {Array<{ratio: number}>} instances - Symbol instances
     * @param {number} symbolSize - Symbol size
     * @param {string} echelon - Echelon string
     * @returns {Array} Array of line coordinate arrays
     */
    createLineWithGaps(coordinates, instances, symbolSize, echelon) {
        if (coordinates.length < 2) return [];

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for line with gaps');
            return [coordinates];
        }

        try {
            const { MIN_LENGTH_KM, SYMBOL_WIDTH_MULTIPLIER, GAP_WIDTH_MULTIPLIER } = AddBoundaryGeometry.GEOMETRY_CONSTANTS;
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength < MIN_LENGTH_KM) {
                return [validCoords];
            }

            const numSymbols = (echelon && echelon.length > 0) ? echelon.length : 3;
            const symbolWidth = numSymbols * symbolSize * SYMBOL_WIDTH_MULTIPLIER;
            const gapWidth = symbolWidth * GAP_WIDTH_MULTIPLIER;

            // Build a gap interval [start, end] per instance, clamped to the line.
            const gaps = instances
                .map(inst => {
                    const center = totalLength * inst.ratio;
                    return [
                        Math.max(0, center - gapWidth / 2),
                        Math.min(totalLength, center + gapWidth / 2)
                    ];
                })
                .sort((a, b) => a[0] - b[0]);

            // Merge overlapping/adjacent gaps so close symbols share one gap.
            const merged = [];
            for (const gap of gaps) {
                const last = merged[merged.length - 1];
                if (last && gap[0] <= last[1]) {
                    last[1] = Math.max(last[1], gap[1]);
                } else {
                    merged.push([...gap]);
                }
            }

            // Emit the complement segments (the line minus the gaps).
            const segments = [];
            const pushSegment = (from, to) => {
                if (to - from <= MIN_LENGTH_KM) return;
                const fromPoint = from <= 0
                    ? turf.point(validCoords[0])
                    : turf.along(line, from, { units: 'kilometers' });
                const toPoint = to >= totalLength
                    ? turf.point(validCoords[validCoords.length - 1])
                    : turf.along(line, to, { units: 'kilometers' });
                const slice = turf.lineSlice(fromPoint, toPoint, line);
                if (slice.geometry.coordinates.length >= 2) {
                    segments.push(slice.geometry.coordinates);
                }
            };

            let cursor = 0;
            for (const [start, end] of merged) {
                pushSegment(cursor, start);
                cursor = end;
            }
            pushSegment(cursor, totalLength);

            return segments.length > 0 ? segments : [validCoords];
        } catch (error) {
            console.warn('Error creating line with gaps:', error);
            return [validCoords];
        }
    }

    /**
     * Create symbol lines for every echelon instance along the line.
     * @param {Array} coordinates - Base coordinates
     * @param {Array<{ratio: number}>} instances - Symbol instances
     * @param {number} size - Symbol size
     * @param {string} echelon - Echelon string
     * @returns {Array} Array of symbol line coordinate arrays
     */
    createEchelonSymbolLines(coordinates, instances, size, echelon) {
        if (coordinates.length < 2) return [];

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for echelon symbols');
            return [];
        }

        try {
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength < AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_LENGTH_KM) {
                return [];
            }

            const allLines = [];
            for (const inst of instances) {
                const { lines } = this.buildEchelonAtRatio(line, totalLength, inst.ratio, size, echelon);
                allLines.push(...lines);
            }
            return allLines;
        } catch (error) {
            console.warn('Error creating echelon symbol lines:', error);
            return [];
        }
    }

    /**
     * Build the echelon symbol (lines + polygons) at a single position ratio.
     * @param {Object} line - Turf lineString feature
     * @param {number} totalLength - Total line length (km)
     * @param {number} ratio - Position ratio along the line
     * @param {number} size - Symbol size
     * @param {string} echelon - Echelon string
     * @returns {{lines: Array, polygons: Array}} Symbol geometry
     */
    buildEchelonAtRatio(line, totalLength, ratio, size, echelon) {
        const { centerPoint, localBearing } = this.getCenterAndBearing(line, totalLength, ratio);
        return this.createEchelonSymbol(echelon, centerPoint, size, localBearing);
    }

    /**
     * Compute the symbol center point and the local line bearing at a position ratio.
     * Shared by symbol/circle/text/handle placement so the math lives in one spot.
     * @param {Object} line - Turf lineString feature
     * @param {number} totalLength - Total line length (km)
     * @param {number} ratio - Position ratio along the line
     * @returns {{centerPoint: Object, localBearing: number}} Center point feature + bearing (deg)
     */
    getCenterAndBearing(line, totalLength, ratio) {
        const { MIN_LENGTH_KM, SYMBOL_POSITION_EPSILON } = AddBoundaryGeometry.GEOMETRY_CONSTANTS;
        const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });

        const distance1 = Math.max(MIN_LENGTH_KM, totalLength * ratio - SYMBOL_POSITION_EPSILON);
        const distance2 = Math.min(totalLength - MIN_LENGTH_KM, totalLength * ratio + SYMBOL_POSITION_EPSILON);

        const p1 = turf.along(line, distance1, { units: 'kilometers' });
        const p2 = turf.along(line, distance2, { units: 'kilometers' });
        const localBearing = turf.bearing(p1, p2);

        return { centerPoint, localBearing };
    }

    /**
     * Create individual echelon symbol
     * @param {string} echelon - Echelon string (X, I, o combinations)
     * @param {Object} centerPoint - Center point feature
     * @param {number} size - Symbol size
     * @param {number} bearing - Local bearing in degrees
     * @returns {Object} Object with lines and polygons arrays
     */
    createEchelonSymbol(echelon, centerPoint, size, bearing) {
        const symbolLines = [];
        const polygons = [];
        const numSymbols = echelon.length;
        const spacing = size * AddBoundaryGeometry.GEOMETRY_CONSTANTS.SYMBOL_SPACING_MULTIPLIER;
        const totalWidth = (numSymbols - 1) * spacing;
        const firstSymbolBearing = bearing;
        const firstSymbolCenter = turf.destination(centerPoint, -totalWidth / 2, firstSymbolBearing, { units: 'kilometers' });

        for (let i = 0; i < numSymbols; i++) {
            const currentCenter = turf.destination(firstSymbolCenter, i * spacing, firstSymbolBearing, { units: 'kilometers' });
            const symbolType = echelon.charAt(i);

            switch (symbolType) {
                case 'X': {
                    const xAngle1 = 45;
                    const p1_start = turf.destination(currentCenter, size / 2, bearing + xAngle1, { units: 'kilometers' });
                    const p1_end = turf.destination(currentCenter, size / 2, bearing + xAngle1 + 180, { units: 'kilometers' });
                    symbolLines.push([p1_start.geometry.coordinates, p1_end.geometry.coordinates]);

                    const xAngle2 = -45;
                    const p2_start = turf.destination(currentCenter, size / 2, bearing + xAngle2, { units: 'kilometers' });
                    const p2_end = turf.destination(currentCenter, size / 2, bearing + xAngle2 + 180, { units: 'kilometers' });
                    symbolLines.push([p2_start.geometry.coordinates, p2_end.geometry.coordinates]);
                    break;
                }
                case 'I': {
                    const iAngle = bearing - 90;
                    const p_top = turf.destination(currentCenter, size / AddBoundaryGeometry.GEOMETRY_CONSTANTS.VERTICAL_OFFSET_DIVISOR, iAngle, { units: 'kilometers' });
                    const p_bottom = turf.destination(currentCenter, -size / AddBoundaryGeometry.GEOMETRY_CONSTANTS.VERTICAL_OFFSET_DIVISOR, iAngle, { units: 'kilometers' });
                    symbolLines.push([p_top.geometry.coordinates, p_bottom.geometry.coordinates]);
                    break;
                }
                case 'o': {
                    const circle = turf.circle(currentCenter, size / 4, { steps: 32, units: 'kilometers' });
                    polygons.push(circle);
                    break;
                }
            }
        }
        return { lines: symbolLines, polygons: polygons };
    }

    /**
     * Generate circles for 'o' symbols in echelon
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Array} Array of circle features
     */
    generateBoundaryCircles(boundaryFeature) {
        const circles = [];
        const { echelon, symbol_size } = boundaryFeature.properties;

        // Normalize baseCoordinates to handle string format from persistence
        const baseCoordinates = this.normalizeBaseCoordinates(boundaryFeature.properties.baseCoordinates);

        if (!echelon || !echelon.includes('o') || !baseCoordinates || baseCoordinates.length < 2) {
            return circles;
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            const instances = this.getSymbolInstances(boundaryFeature.properties);

            instances.forEach((inst, instanceIndex) => {
                const { polygons } = this.buildEchelonAtRatio(line, totalLength, inst.ratio, symbol_size, echelon);

                polygons.forEach((polygon, polyIndex) => {
                    circles.push({
                        type: 'Feature',
                        id: `${boundaryFeature.properties.id}-circle-${instanceIndex}-${polyIndex}`,
                        geometry: polygon.geometry,
                        properties: {
                            parent: boundaryFeature.properties.id,
                            layerId: boundaryFeature.properties.layerId,
                            color: boundaryFeature.properties.color,
                            opacity: boundaryFeature.properties.opacity,
                            source: 'boundary-circle'
                        }
                    });
                });
            });
        } catch (error) {
            console.warn('Error generating boundary circles:', error);
        }

        return circles;
    }

    /**
     * Generate text features for boundary
     * @param {Object} boundaryFeature - Boundary feature
     * @returns {Array} Array of text features
     */
    generateBoundaryTexts(boundaryFeature) {
        const textFeatures = [];
        const { text_top, text_bottom, text_size, symbol_size, text_distance_ratio } = boundaryFeature.properties;

        // Normalize baseCoordinates to handle string format from persistence
        const baseCoordinates = this.normalizeBaseCoordinates(boundaryFeature.properties.baseCoordinates);

        if ((!text_top && !text_bottom) || !baseCoordinates || baseCoordinates.length < 2) {
            return textFeatures;
        }

        try {
            const line = turf.lineString(baseCoordinates);
            const totalLength = turf.length(line, { units: 'kilometers' });
            // Neither factor may go through `||`: a ratio of 0 ("label glued to the
            // symbol") is a value a persisted or imported boundary can carry, and it
            // used to come back as the 0.9 default; and a MISSING symbol_size made the
            // product NaN, which flowed into `turf.destination` and out into the
            // emitted text feature's coordinates, with no error anywhere.
            const ratio = Number.isFinite(text_distance_ratio)
                ? text_distance_ratio
                : AddBoundaryGeometry.DEFAULT_TEXT_DISTANCE_RATIO;
            const size = Number.isFinite(symbol_size)
                ? symbol_size
                : AddBoundaryGeometry.DEFAULT_SYMBOL_SIZE;
            const labelOffset = size * ratio;
            const instances = this.getSymbolInstances(boundaryFeature.properties);

            // Render the shared labels only at instances that opt in (showLabels).
            instances.forEach((inst, instanceIndex) => {
                if (!inst.showLabels) return;

                const { centerPoint, localBearing } = this.getCenterAndBearing(line, totalLength, inst.ratio);

                const textPlacementBearing = localBearing - 90;
                const textRotation = (localBearing <= 0 || localBearing >= 180) ? localBearing + 90 : localBearing - 90;

                if (text_top) {
                    const pTop = turf.destination(centerPoint, labelOffset, textPlacementBearing, { units: 'kilometers' });
                    textFeatures.push({
                        type: 'Feature',
                        id: `${boundaryFeature.properties.id}-text-top-${instanceIndex}`,
                        geometry: {
                            type: 'Point',
                            coordinates: pTop.geometry.coordinates
                        },
                        properties: {
                            parent: boundaryFeature.properties.id,
                            layerId: boundaryFeature.properties.layerId,
                            text: text_top,
                            rotation: textRotation,
                            text_size: text_size,
                            color: boundaryFeature.properties.color,
                            opacity: boundaryFeature.properties.opacity,
                            source: 'boundary-text'
                        }
                    });
                }

                if (text_bottom) {
                    const pBottom = turf.destination(centerPoint, -labelOffset, textPlacementBearing, { units: 'kilometers' });
                    textFeatures.push({
                        type: 'Feature',
                        id: `${boundaryFeature.properties.id}-text-bottom-${instanceIndex}`,
                        geometry: {
                            type: 'Point',
                            coordinates: pBottom.geometry.coordinates
                        },
                        properties: {
                            parent: boundaryFeature.properties.id,
                            layerId: boundaryFeature.properties.layerId,
                            text: text_bottom,
                            rotation: textRotation,
                            text_size: text_size,
                            color: boundaryFeature.properties.color,
                            opacity: boundaryFeature.properties.opacity,
                            source: 'boundary-text'
                        }
                    });
                }
            });
        } catch (error) {
            console.warn('Error generating boundary texts:', error);
        }

        return textFeatures;
    }

    /**
     * Create edit handles for boundary
     * @param {Object} feature - Boundary feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const handles = [];
        if (!feature || !feature.properties.baseCoordinates) return handles;

        const coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        const id = feature.properties.id;

        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for control points:', coordinates);
            return [];
        }

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) &&
            coord.length >= 2 &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1])
        );

        if (validCoords.length < 2) {
            console.warn('Insufficient valid coordinates for control points');
            return [];
        }

        validCoords.forEach((coord, index) => {
            const handleId = `boundary-handle-${id}-vertex-${index}`;
            handles.push({
                type: 'Feature',
                id: handleId,
                geometry: {
                    type: 'Point',
                    coordinates: coord
                },
                properties: {
                    parent: id,
                    index: index,
                    type: 'vertex',
                    role: 'handle',
                    handleType: 'vertex',
                    featureId: id,
                    mode: 'boundary_editing',
                    meta: 'vertex',
                    user_isEditingHandle: true
                }
            });
        });

        for (let i = 0; i < validCoords.length - 1; i++) {
            try {
                const midpoint = turf.midpoint(turf.point(validCoords[i]), turf.point(validCoords[i + 1]));
                const handleId = `boundary-handle-${id}-midpoint-${i}`;
                handles.push({
                    type: 'Feature',
                    id: handleId,
                    geometry: midpoint.geometry,
                    properties: {
                        parent: id,
                        index: i + 1,
                        type: 'midpoint',
                        role: 'handle',
                        handleType: 'midpoint',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'midpoint',
                        user_isEditingHandle: true
                    }
                });
            } catch (error) {
                console.warn(`Error creating midpoint handle ${i}:`, error);
            }
        }

        try {
            const { MIN_LENGTH_KM } = AddBoundaryGeometry.GEOMETRY_CONSTANTS;
            const instances = this.getSymbolInstances(feature.properties);
            const line = turf.lineString(validCoords);
            const totalLength = turf.length(line, { units: 'kilometers' });

            if (totalLength > MIN_LENGTH_KM) {
                // One draggable symbol handle per instance (index identifies the instance).
                instances.forEach((inst, instanceIndex) => {
                    const point = turf.along(line, totalLength * inst.ratio, { units: 'kilometers' });
                    handles.push({
                        type: 'Feature',
                        id: `boundary-handle-${id}-symbol-${instanceIndex}`,
                        geometry: {
                            type: 'Point',
                            coordinates: point.geometry.coordinates
                        },
                        properties: {
                            parent: id,
                            index: instanceIndex,
                            type: 'symbol_handle',
                            role: 'handle',
                            handleType: 'symbol_handle',
                            featureId: id,
                            mode: 'boundary_editing',
                            meta: 'vertex',
                            user_isEditingHandle: true
                        }
                    });
                });

                // Size + text-distance handles are shared, anchored to the leftmost instance.
                const anchor = this.getAnchorInstance(instances);
                const { centerPoint: symbolPoint, localBearing } = this.getCenterAndBearing(line, totalLength, anchor.ratio);

                const size = feature.properties.symbol_size || 2;
                const sizeHandlePoint = turf.destination(symbolPoint, size / 2, localBearing + 45, { units: 'kilometers' });
                handles.push({
                    type: 'Feature',
                    id: `boundary-handle-${id}-size`,
                    geometry: {
                        type: 'Point',
                        coordinates: sizeHandlePoint.geometry.coordinates
                    },
                    properties: {
                        parent: id,
                        type: 'size_handle',
                        role: 'handle',
                        handleType: 'size_handle',
                        featureId: id,
                        mode: 'boundary_editing',
                        meta: 'vertex',
                        user_isEditingHandle: true
                    }
                });

                // Labels render at every instance that opts in, so show the (single,
                // shared) text-distance handle whenever ANY instance shows labels.
                const hasText = (feature.properties.text_top || feature.properties.text_bottom);
                if (hasText && instances.some(inst => inst.showLabels)) {
                    const textDistanceRatio = feature.properties.text_distance_ratio || 0.8;
                    const textOffset = size * textDistanceRatio;
                    const textPlacementBearing = localBearing - 90;
                    const textDistanceHandlePoint = turf.destination(symbolPoint, textOffset, textPlacementBearing, { units: 'kilometers' });
                    handles.push({
                        type: 'Feature',
                        id: `boundary-handle-${id}-text-distance`,
                        geometry: {
                            type: 'Point',
                            coordinates: textDistanceHandlePoint.geometry.coordinates
                        },
                        properties: {
                            parent: id,
                            type: 'text_distance_handle',
                            role: 'handle',
                            handleType: 'text_distance_handle',
                            featureId: id,
                            mode: 'boundary_editing',
                            meta: 'vertex',
                            user_isEditingHandle: true
                        }
                    });
                }
            }
        } catch (error) {
            console.warn('Error creating symbol handles:', error);
        }

        return handles;
    }

    /**
     * Update boundary geometry from handle interaction
     * @param {string} handleType - Type of handle being moved
     * @param {Array} newPosition - New position [lng, lat]
     * @param {Object} feature - Feature being edited
     * @param {number} handleIndex - Index for vertex/midpoint handles
     * @returns {Object} Updated properties and geometry
     */
    updateFromHandle(handleType, newPosition, feature, handleIndex = null) {
        if (!newPosition || !Array.isArray(newPosition) || newPosition.length < 2 ||
            typeof newPosition[0] !== 'number' || typeof newPosition[1] !== 'number' ||
            isNaN(newPosition[0]) || isNaN(newPosition[1])) {
            console.warn('Invalid newPosition for handle update:', newPosition);
            return null;
        }

        if (!feature || !feature.properties) {
            console.warn('Invalid feature for handle update');
            return null;
        }

        if (!handleType) {
            console.warn('Invalid handleType for boundary update:', handleType);
            return null;
        }

        let coordinates = this.normalizeBaseCoordinates(feature.properties.baseCoordinates);
        if (!coordinates || coordinates.length < 2) {
            console.warn('Invalid coordinates for handle update:', feature.properties.baseCoordinates);
            return null;
        }

        coordinates = [...coordinates];
        const updatedProperties = { ...feature.properties };

        switch (handleType) {
            case 'size_handle': {
                const ratio = this.getAnchorInstance(this.getSymbolInstances(feature.properties)).ratio;
                const line = turf.lineString(coordinates);
                const totalLength = turf.length(line, { units: 'kilometers' });
                const centerPoint = turf.along(line, totalLength * ratio, { units: 'kilometers' });
                const newSize = turf.distance(centerPoint, turf.point(newPosition), { units: 'kilometers' }) * 2;
                updatedProperties.symbol_size = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.MIN_SIZE_KM, newSize);
                break;
            }

            case 'symbol_handle': {
                const symbolLine = turf.lineString(coordinates);
                const pointOnLine = turf.nearestPointOnLine(symbolLine, turf.point(newPosition), { units: 'kilometers' });
                const distance = pointOnLine.properties.location;
                const symbolTotalLength = turf.length(symbolLine, { units: 'kilometers' });
                const newRatio = this.clampRatio(distance / symbolTotalLength);

                // Move only the dragged instance; keep the others untouched.
                const instances = this.getSymbolInstances(feature.properties).map(inst => ({ ...inst }));
                const idx = (handleIndex !== null && handleIndex >= 0 && handleIndex < instances.length)
                    ? handleIndex
                    : 0;
                instances[idx] = { ...instances[idx], ratio: newRatio };
                updatedProperties.symbol_instances = instances;
                // Drop the migrated legacy scalar so storage converges to the array model.
                delete updatedProperties.symbol_position_ratio;
                break;
            }

            case 'text_distance_handle': {
                const textRatio = this.getAnchorInstance(this.getSymbolInstances(feature.properties)).ratio;
                const textLine = turf.lineString(coordinates);
                const textTotalLength = turf.length(textLine, { units: 'kilometers' });
                const textCenterPoint = turf.along(textLine, textTotalLength * textRatio, { units: 'kilometers' });
                const newDistance = turf.distance(textCenterPoint, turf.point(newPosition), { units: 'kilometers' });
                const symbolSize = feature.properties.symbol_size || 2;
                const newRatio = newDistance / symbolSize;
                updatedProperties.text_distance_ratio = Math.max(AddBoundaryGeometry.GEOMETRY_CONSTANTS.TEXT_DISTANCE_MIN, Math.min(AddBoundaryGeometry.GEOMETRY_CONSTANTS.TEXT_DISTANCE_MAX, newRatio));
                break;
            }

            // Both branches need a LOWER bound, and neither had one. A negative index
            // made `vertex` write the non-index key "-1" onto the array (invisible to
            // length and to JSON, so the edit went nowhere) and made `midpoint` splice
            // from the END, inserting before the last vertex.
            case 'vertex':
                if (Number.isInteger(handleIndex) && handleIndex >= 0 && handleIndex < coordinates.length) {
                    coordinates[handleIndex] = newPosition;
                    updatedProperties.baseCoordinates = coordinates;
                }
                break;

            case 'midpoint':
                if (Number.isInteger(handleIndex) && handleIndex >= 0 && handleIndex <= coordinates.length) {
                    coordinates.splice(handleIndex, 0, newPosition);
                    updatedProperties.baseCoordinates = coordinates;
                }
                break;

            default:
                console.warn('Unknown handle type for boundary:', handleType);
                return null;
        }

        const updatedGeometry = this.generateBoundaryGeometry(updatedProperties);

        return {
            properties: updatedProperties,
            geometry: updatedGeometry
        };
    }

    /**
     * Get bounding box for boundary
     * @param {Array} coordinates - Base coordinates
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates) {
        if (!coordinates || coordinates.length === 0) {
            return [0, 0, 0, 0];
        }

        const validCoords = coordinates.filter(coord =>
            Array.isArray(coord) && coord.length >= 2 &&
            !isNaN(coord[0]) && !isNaN(coord[1])
        );

        if (validCoords.length === 0) {
            return [0, 0, 0, 0];
        }

        const lngs = validCoords.map(coord => coord[0]);
        const lats = validCoords.map(coord => coord[1]);

        return [
            Math.min(...lngs),
            Math.min(...lats),
            Math.max(...lngs),
            Math.max(...lats)
        ];
    }

    /**
     * Check if coordinates represent a valid boundary
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid boundary
     */
    isValidBoundary(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        return coordinates.every(AddBoundaryGeometry.isFinitePosition);
    }

    /**
     * Remove vertex at specific index
     * @param {Array} coordinates - Current coordinates
     * @param {number} index - Index to remove
     * @returns {Array|null} New coordinates or null if invalid
     */
    removeVertexAtIndex(coordinates, index) {
        // Same trap as the arrow tool: `NaN < 0` and `NaN >= length` are both false,
        // and `splice` coerces NaN to 0, so a NaN index deleted the first vertex.
        if (!coordinates || !Number.isInteger(index) || index < 0 || index >= coordinates.length) {
            return null;
        }

        const newCoordinates = [...coordinates];
        newCoordinates.splice(index, 1);

        // Boundaries must have at least 2 vertices
        if (newCoordinates.length < 2) {
            return null;
        }

        return newCoordinates;
    }
}

export default AddBoundaryGeometry;
