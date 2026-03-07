// Path: js/military_tools/military_symbol_tool/add_military_symbol_geometry.js

import { BaseGeometry } from '@tools';

/**
 * Military Symbol Geometry Operations
 * Handles geometric calculations for military symbol features (Point-based with SIDC-generated dimensions)
 */
class AddMilitarySymbolGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate point geometry for military symbol placement
     * @param {Array} coordinates - Position coordinates [lng, lat]
     * @returns {Object} GeoJSON Point geometry
     */
    generate(coordinates) {
        return this.generatePointGeometry(coordinates);
    }

    /**
     * Generate Point geometry for military symbol
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
     * Military symbols don't have edit handles - they're edited through attribute panel
     * @param {Object} feature - Military symbol feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(_feature) {
        return [];
    }

    /**
     * Military symbols don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(_handleType, _newPosition, _feature) {
        return null;
    }

    /**
     * Calculate selection box geometry for military symbol with zoom-invariant sizing
     * @param {Array} coordinates - Symbol position [lng, lat]
     * @param {number} width - Symbol width in pixels
     * @param {number} height - Symbol height in pixels
     * @param {number} size - Size multiplier
     * @param {number} rotation - Rotation in degrees
     * @param {number} createdAtZoom - Zoom level when symbol was created
     * @param {Object} uiManager - UI manager for utility functions
     * @param {number} [effectiveZoom] - Optional zoom to use for calculations (overrides createdAtZoom when zoom correction is disabled)
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, rotation, createdAtZoom, uiManager, effectiveZoom = null) {
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;

        const expandedDimensions = uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;

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
     * Update military symbol position for move operation
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
     * @param {Object} feature - Military symbol feature
     * @param {Object} uiManager - UI manager instance
     * @param {number} [currentZoom] - Current map zoom (used when zoom correction is disabled)
     * @returns {Object} Updated selection box geometry
     */
    recalculateSelectionBox(feature, uiManager, currentZoom = null) {
        const effectiveZoom = feature.properties.zoomCorrectionEnabled === false ? currentZoom : null;
        return this.calculateSelectionBoxGeometry(
            feature.geometry.coordinates,
            feature.properties.width,
            feature.properties.height,
            feature.properties.size,
            feature.properties.rotation,
            feature.properties.createdAtZoom,
            uiManager,
            effectiveZoom
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
     * Get bounding box for military symbol (for spatial queries)
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width
     * @param {number} height - Symbol height
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;

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
     * Check if military properties will affect SIDC generation
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects SIDC
     */
    affectsSIDC(property) {
        const sidcProperties = [
            'context', 'standardIdentity', 'status', 'hqTfDummy',
            'echelon', 'mainIcon', 'modifier1', 'modifier2',
            'mainIconExtension', 'modifier1Extension', 'modifier2Extension',
            'specialModifier', 'isCommand', 'symbolSet'
        ];

        return sidcProperties.includes(property);
    }

    /**
     * Check if property is a text modifier (requires symbol regeneration)
     * Text modifiers don't affect SIDC but require regeneration to show text
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property is a text modifier
     */
    affectsTextModifiers(property) {
        const textModifierProperties = [
            'uniqueDesignation',      // C - Designation
            'higherFormation',        // B - Higher Formation
            'quantity',               // C1 - Quantity
            'reinforcedReduced',      // F - Reinforced/Reduced
            'additionalInformation',  // H - Additional Information
            'credibility',            // J - Credibility (combined J+K)
            'type',                   // V - Equipment Type / AIS
            'iffSif',                 // P - IFF Code
            'dateTimeGroup',          // W - Date-Time Group
            'altitudeDepth',          // X - Altitude/Depth
            'equipmentTeardownTime',  // X1 - Equipment Teardown Time
            'location',               // Y - Location
            'speed',                  // Z - Speed
            'specialHeadquarters',    // AA - HQ Type
            'direction',              // Q - Direction/Azimuth
            'engagementBar'
        ];

        return textModifierProperties.includes(property);
    }

    /**
     * Check if property affects visual rendering (selection box recalculation needed)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['size', 'rotation', 'width', 'height'];
        return visualProperties.includes(property);
    }
}

export default AddMilitarySymbolGeometry;
