// Path: src/js/controls_sig/coordination_measure_tool/add_coordination_measure_geometry.js

import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Coordination Measure Geometry Operations
 * Handles geometric calculations for coordination measure features
 */
class AddCoordinationMeasureGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry for coordination measure placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Generate Point geometry for coordination measure
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
     * Create edit handles (not supported for coordination measures)
     * @param {Object} feature - Coordination measure feature
     * @returns {Array} Empty array
     */
    createHandles(feature) {
        return [];
    }

    /**
     * Update feature from handle (not supported for coordination measures)
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null;
    }

    /**
     * Calculate selection box geometry for coordination measure with zoom-invariant sizing
     * @param {Array} coordinates - Symbol position [lng, lat]
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @param {number} size - Size multiplier
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when symbol was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {string} anchor - Icon anchor position (default: 'center')
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, rotation, createdAtZoom, uiManager, anchor = 'center') {
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;

        const expandedDimensions = uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;

        const centerLat = coordinates[1];
        const widthDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.width + (padding * 2),
            centerLat,
            createdAtZoom
        );
        const heightDegrees = uiManager.pixelsToDegrees(
            expandedDimensions.height + (padding * 2),
            centerLat,
            createdAtZoom
        );

        let adjustedCoordinates = [...coordinates];

        if (anchor && anchor !== 'center') {
            const heightOffsetDegrees = uiManager.pixelsToDegrees(
                scaledHeight / 2,
                centerLat,
                createdAtZoom
            );

            if (anchor.includes('bottom')) {
                adjustedCoordinates[1] += heightOffsetDegrees;
            } else if (anchor.includes('top')) {
                adjustedCoordinates[1] -= heightOffsetDegrees;
            }
        }

        return this.createSelectionBoxFromDegrees(adjustedCoordinates, widthDegrees, heightDegrees);
    }

    /**
     * Create selection box polygon from degree measurements
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

    /**
     * Update coordination measure position for move operation
     * @param {Array} currentCoordinates - Current position
     * @param {number} dx - Delta X in geographic coordinates
     * @param {number} dy - Delta Y in geographic coordinates
     * @returns {Array} New coordinates
     */
    moveSymbol(currentCoordinates, dx, dy) {
        return [
            currentCoordinates[0] + dx,
            currentCoordinates[1] + dy
        ];
    }

    /**
     * Recalculate selection box for feature
     * @param {Object} feature - Coordination measure feature
     * @param {Object} uiManager - UI manager instance
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager) {
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager
        );
    }

    /**
     * Calculate zoom-adjusted size
     * @param {number} baseSize - Base size multiplier
     * @param {number} createdAtZoom - Zoom when symbol was created
     * @param {number} currentZoom - Current zoom level
     * @returns {number} Calculated size with zoom adjustment (max 10x)
     */
    calculateZoomAdjustedSize(baseSize, createdAtZoom, currentZoom) {
        const zoomDifference = currentZoom - createdAtZoom;
        const scaleFactor = Math.pow(2, zoomDifference);
        return Math.min(baseSize * scaleFactor, 10);
    }

    /**
     * Get bounding box for coordination measure
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width
     * @param {number} height - Symbol height
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;

        const widthDegrees = scaledWidth / 111320;
        const heightDegrees = scaledHeight / 111320;

        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;

        return [
            coordinates[0] - halfWidth,
            coordinates[1] - halfHeight,
            coordinates[0] + halfWidth,
            coordinates[1] + halfHeight
        ];
    }

    /**
     * Check if coordination measure properties will affect symbol generation
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects symbol generation
     */
    affectsSIDC(property) {
        const sidcProperties = [
            'pointCode',
            'echelonCode'
        ];

        return sidcProperties.includes(property);
    }

    /**
     * Check if property is a text modifier (requires symbol regeneration)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property is a text modifier
     */
    affectsTextModifiers(property) {
        const textModifierProperties = [
            'tipo',                  // V - Tipo
            'identificacao',         // T - Identificação
            'gdhIni',               // W - GDH Inicial
            'gdhFim',               // W1 - GDH Final
            'numero',               // M - Número
            'classeSuprimento',     // Classe de Suprimento
            'status',               // Status
            'numeroConcentracao',   // Número de Concentração
            'altitude',             // X - Altitude
            'fillColor'             // Cor personalizada
        ];

        return textModifierProperties.includes(property);
    }

    /**
     * Check if property affects visual rendering
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['size', 'rotation', 'width', 'height'];
        return visualProperties.includes(property);
    }
}

export default AddCoordinationMeasureGeometry;
