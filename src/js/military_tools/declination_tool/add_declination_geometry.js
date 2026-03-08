// Path: js/military_tools/declination_tool/add_declination_geometry.js

/**
 * @fileoverview Geometry operations for magnetic declination diagram features.
 */

import { BaseGeometry } from '@tools';

/**
 * Declination Diagram Geometry Operations
 * Handles geometric calculations for declination diagram features (Point-based).
 */
class AddDeclinationGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry for declination diagram placement.
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return {
            type: 'Point',
            coordinates: [coordinates[0], coordinates[1]]
        };
    }

    /**
     * Declination diagrams don't have edit handles.
     * @returns {Array} Empty array
     */
    createHandles() {
        return [];
    }

    /**
     * Declination diagrams don't support handle-based editing.
     * @returns {null} Always null
     */
    updateFromHandle() {
        return null;
    }

    /**
     * Calculate selection box geometry with zoom-invariant sizing.
     * @param {Array} coordinates - Diagram position [lng, lat]
     * @param {number} width - Diagram width in pixels
     * @param {number} height - Diagram height in pixels
     * @param {number} size - Size multiplier
     * @param {number} _rotation - Unused (diagrams don't rotate)
     * @param {number} createdAtZoom - Zoom level when diagram was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {number} [effectiveZoom] - Optional zoom override (when zoom correction disabled)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, _rotation, createdAtZoom, uiManager, effectiveZoom = null) {
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;

        const padding = 5;
        const centerLat = coordinates[1];
        const zoomForCalculation = effectiveZoom !== null ? effectiveZoom : createdAtZoom;

        const widthDegrees = uiManager.pixelsToDegrees(
            scaledWidth + (padding * 2),
            centerLat,
            zoomForCalculation
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            scaledHeight + (padding * 2),
            centerLat,
            zoomForCalculation
        );

        return this.createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees);
    }

    /**
     * Create selection box polygon from degree measurements.
     * @param {Array} coordinates - Center coordinates [lng, lat]
     * @param {number} widthDegrees - Width in degrees
     * @param {number} heightDegrees - Height in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    createSelectionBoxFromDegrees(coordinates, widthDegrees, heightDegrees) {
        const [lng, lat] = coordinates;
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;

        return {
            type: 'Polygon',
            coordinates: [[
                [lng - halfWidth, lat - halfHeight],
                [lng + halfWidth, lat - halfHeight],
                [lng + halfWidth, lat + halfHeight],
                [lng - halfWidth, lat + halfHeight],
                [lng - halfWidth, lat - halfHeight]
            ]]
        };
    }

}

export default AddDeclinationGeometry;
