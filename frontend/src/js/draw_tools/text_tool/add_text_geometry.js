// Path: js/draw_tools/text_tool/add_text_geometry.js

import { BaseGeometry } from '../../tool_manager';
import { pixelsToDegrees } from '../../utilities/geometry-utils.js';

/**
 * Text Geometry Operations
 * Handles geometric calculations for text features including point-based positioning and measured selection boxes
 */
class AddTextGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);

        this.measurementCanvas = null;
        this.measurementContext = null;
    }

    /**
     * Generate point geometry for text placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Validate text coordinates
     * @param {Array} coordinates - Position coordinates
     * @returns {boolean} True if valid
     */
    validate(coordinates) {
        // Number.isFinite rejects NaN AND +/-Infinity, and it already implies the
        // number type, so a string coordinate is refused too. Matches the guard the
        // circle/line/polygon/ellipse tools use.
        return coordinates &&
               Array.isArray(coordinates) &&
               coordinates.length >= 2 &&
               Number.isFinite(coordinates[0]) &&
               Number.isFinite(coordinates[1]);
    }

    /**
     * Normalize coordinates from various formats
     * @param {string|Array} coordinates - Coordinates to normalize
     * @returns {Array|null} Normalized coordinates or null if invalid
     */
    normalizeCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                coordinates = JSON.parse(coordinates);
            } catch (e) {
                console.error('Error parsing coordinates:', coordinates, e);
                return null;
            }
        }

        if (!Array.isArray(coordinates) || coordinates.length < 2) {
            console.error('Invalid coordinates:', coordinates);
            return null;
        }

        return coordinates;
    }

    /**
     * Generate Point geometry for text
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generatePointGeometry(coordinates) {
        return {
            type: 'Point',
            coordinates: [coordinates[0], coordinates[1]]
        };
    }

    /**
     * Create a single rotation handle positioned above the text center.
     * @param {Object} feature - Text feature
     * @param {number} mapZoom - Current map zoom level
     * @returns {Array} Array with one rotation handle feature
     */
    createHandles(feature, mapZoom) {
        const coordinates = feature.geometry.coordinates;
        if (!this.isValidPosition(coordinates)) return [];

        const handlePosition = this.calculateRotationHandlePosition(feature, mapZoom);
        if (!handlePosition) return [];

        return [{
            type: 'Feature',
            id: `text-handle-${feature.properties.id}-rotation`,
            geometry: {
                type: 'Point',
                coordinates: handlePosition
            },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'rotation',
                featureId: feature.properties.id,
                mode: 'text_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        }];
    }

    /**
     * Calculate rotation handle position to the left of the text center.
     * Offset is half the text width + padding, placed at the selection box edge.
     * @param {Object} feature - Text feature
     * @param {number} mapZoom - Current map zoom level (for non-zoom-corrected text)
     * @returns {Array|null} Handle position [lng, lat] or null
     */
    calculateRotationHandlePosition(feature, mapZoom) {
        const coordinates = feature.geometry.coordinates;
        const rotation = feature.properties.rotation || 0;

        const { width } = this.measureTextSize(
            feature.properties.text,
            feature.properties.size,
            'Arial'
        );

        // Handle sits to the left of text: half width + small padding
        const HANDLE_PADDING_PX = 12;
        const offsetPixels = (width / 2) + HANDLE_PADDING_PX;

        // Always use current map zoom — the handle is a screen-space UI element
        // that must stay at a fixed pixel distance from the text center.
        // Zoom 0 is a legitimate map zoom (the whole world in one tile), so the
        // fallback tests for a finite number and never for truthiness: `|| ` here
        // used to send zoom 0 to createdAtZoom, misplacing the handle by ~4096x.
        const zoom = Number.isFinite(mapZoom) ? mapZoom : feature.properties.createdAtZoom;

        const latitude = coordinates[1];
        const offsetDegrees = pixelsToDegrees(offsetPixels, latitude, zoom);

        // Base bearing for "left" in text frame = 270° (west).
        // When text rotates CW by R, handle bearing = 270 + R.
        const baseBearing = 270;
        const bearingRad = ((baseBearing + rotation) * Math.PI) / 180;
        const dx = offsetDegrees * Math.sin(bearingRad);
        const dy = offsetDegrees * Math.cos(bearingRad);

        return [coordinates[0] + dx, coordinates[1] + dy];
    }

    /**
     * Calculate text rotation from the drag position of the rotation handle.
     * Inverse of calculateRotationHandlePosition.
     * @param {Array} center - Text center coordinates [lng, lat]
     * @param {Array} handlePosition - Handle position [lng, lat]
     * @returns {number} Rotation in degrees (0-360)
     */
    calculateRotationFromHandle(center, handlePosition) {
        // Handle bearing from center: turf.bearing returns -180 to 180
        const bearing = turf.bearing(center, handlePosition);

        // Handle is at bearing = 270 + rotation, so rotation = bearing - 270,
        // which lands in [-450, -90] for the whole turf range. A single `+= 360`
        // only lifted it to [-90, 270]: the last quadrant was unreachable and the
        // handle wrote NEGATIVE rotations into the feature. Modulo wraps any
        // number of turns, and the final `% 360` catches the case where rounding
        // 359.5 or more would reintroduce 360.
        const rotation = (((bearing - 270) % 360) + 360) % 360;

        return Math.round(rotation) % 360;
    }

    /**
     * Update text properties based on rotation handle movement.
     * @param {string} handleType - Handle type ('rotation')
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Text feature being edited
     * @returns {Object|null} Updated rotation value or null
     */
    updateFromHandle(handleType, newPosition, feature) {
        if (handleType !== 'rotation') return null;

        const center = feature.geometry.coordinates;
        const rotation = this.calculateRotationFromHandle(center, newPosition);

        return { rotation };
    }

    /**
     * Measure text dimensions using canvas context
     * @param {string} text - Text content
     * @param {number} fontSize - Font size in pixels
     * @param {string} fontFamily - Font family name
     * @returns {Object} {width, height} dimensions in pixels
     */
    measureTextSize(text, fontSize, fontFamily = 'Arial') {
        if (!this.measurementCanvas) {
            this.measurementCanvas = document.createElement('canvas');
            this.measurementContext = this.measurementCanvas.getContext('2d');
        }

        this.measurementContext.font = `${fontSize}px ${fontFamily}`;
        const lines = text.split('\n');
        const width = Math.max(...lines.map(line => this.measurementContext.measureText(line).width));
        const height = (fontSize - 8) * lines.length;

        return { width, height };
    }

    /**
     * Calculate selection box geometry for text with zoom-invariant sizing and background consideration
     * @param {Array} coordinates - Text position [lng, lat]
     * @param {string} text - Text content
     * @param {number} size - Font size
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when text was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {boolean} showBackground - Whether background box is shown
     * @param {number} backgroundBorderWidth - Border width in pixels (if background is shown)
     * @param {number} [effectiveZoom] - Optional zoom to use for calculations (overrides createdAtZoom when zoom correction is disabled)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, text, size, rotation, createdAtZoom, uiManager, showBackground = false, backgroundBorderWidth = 1, effectiveZoom = null) {
        const { width, height } = this.measureTextSize(text, size, 'Arial');

        let padding = 5;

        if (showBackground && backgroundBorderWidth > 0) {
            padding += backgroundBorderWidth;
        }

        const expandedDimensions = uiManager.calculateExpandedDimensions(width, height, rotation);

        const centerLat = coordinates[1];
        const zoomForCalculation = effectiveZoom !== null ? effectiveZoom : createdAtZoom;
        const widthDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2),
            centerLat,
            zoomForCalculation
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2),
            centerLat,
            zoomForCalculation
        );

        return this.createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees);
    }

    /**
     * Update text position for move operation
     * @param {Array} currentCoordinates - Current position
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @returns {Array} New coordinates
     */
    moveText(currentCoordinates, dx, dy) {
        return [
            currentCoordinates[0] + dx,
            currentCoordinates[1] + dy
        ];
    }

    /**
     * Recalculate selection box for feature
     * @param {Object} feature - Text feature
     * @param {Object} uiManager - UI manager instance
     * @param {number} [currentZoom] - Current map zoom (used when zoom correction is disabled)
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager, currentZoom = null) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? currentZoom : null;
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.text,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager,
            feature.properties.showBackground,
            feature.properties.backgroundBorderWidth,
            effectiveZoom
        );
    }

    /**
     * Calculate zoom-adjusted size
     * @param {number} baseSize - Base font size
     * @param {number} createdAtZoom - Zoom when text was created
     * @param {number} currentZoom - Current zoom level
     * @returns {number} Calculated size with zoom adjustment (max 255px)
     */
    calculateZoomAdjustedSize(baseSize, createdAtZoom, currentZoom) {
        const zoomDifference = currentZoom - createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        return Math.min(baseSize * scaleFactor, 255);
    }

    /**
     * Check if coordinates represent a valid text position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return this.validate(coordinates);
    }

    /**
     * Validate text content
     * @param {string} text - Text content to validate
     * @returns {boolean} True if valid text
     */
    validateText(text) {
        return typeof text === 'string' && text.trim().length > 0;
    }

    /**
     * Get bounding box for text (for spatial queries)
     * @param {Array} coordinates - Text position
     * @param {string} text - Text content
     * @param {number} size - Font size
     * @param {number} rotation - Rotation in degrees
     * @param {boolean} showBackground - Whether background is shown
     * @param {number} backgroundBorderWidth - Border width
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, text, size, rotation = 0, showBackground = false, backgroundBorderWidth = 1) {
        const { width, height } = this.measureTextSize(text, size, 'Arial');

        let maxDimension = rotation === 0 ?
            Math.max(width, height) :
            Math.sqrt(width * width + height * height);

        if (showBackground && backgroundBorderWidth > 0) {
            maxDimension += (backgroundBorderWidth * 2);
        }

        const dimensionDegrees = maxDimension / 111320;
        const halfDimension = dimensionDegrees / 2;

        return [
            coordinates[0] - halfDimension,
            coordinates[1] - halfDimension,
            coordinates[0] + halfDimension,
            coordinates[1] + halfDimension
        ];
    }

    /**
     * Check if property affects visual rendering (selection box recalculation needed)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['text', 'size', 'rotation', 'showBackground', 'backgroundBorderWidth'];
        return visualProperties.includes(property);
    }

    /**
     * Clean up resources when geometry handler is destroyed
     */
    destroy() {
        this.measurementCanvas = null;
        this.measurementContext = null;
    }
}

export default AddTextGeometry;
