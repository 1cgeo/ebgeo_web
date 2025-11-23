// Path: js\controls_sig\coordination_measure_tool\add_coordination_measure_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

/**
 * Coordination Measure Geometry Operations
 * Handles geometric calculations for coordination measure features (Point-based with generated symbols)
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
     * Coordination measures don't have edit handles - they're edited through attribute panel
     * @param {Object} feature - Coordination measure feature
     * @returns {Array} Empty array (no handles)
     */
    createHandles(feature) {
        return []; // Coordination measures don't have edit handles
    }

    /**
     * Coordination measures don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null; // Coordination measures don't have edit handles
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
        // Apply size scaling with 62.5% correction factor (same as image tool)
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;
        
        // Calculate expanded dimensions accounting for rotation
        const expandedDimensions = uiManager.calculateExpandedDimensions(scaledWidth, scaledHeight, rotation);
        const padding = 5;
        
        // Use creation zoom level for degree conversion (zoom-invariant)
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
        
        // Ajustar coordenadas baseado na âncora
        let adjustedCoordinates = [...coordinates];
        
        // Calcular offset em graus baseado na âncora
        if (anchor && anchor !== 'center') {
            const heightOffsetDegrees = uiManager.pixelsToDegrees(
                scaledHeight / 2,
                centerLat,
                createdAtZoom
            );
            
            if (anchor.includes('bottom')) {
                // Âncora embaixo: mover selection box para cima
                adjustedCoordinates[1] += heightOffsetDegrees;
            } else if (anchor.includes('top')) {
                // Âncora em cima: mover selection box para baixo
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
                [lng - halfWidth, lat - halfHeight], // bottom-left
                [lng + halfWidth, lat - halfHeight], // bottom-right
                [lng + halfWidth, lat + halfHeight], // top-right
                [lng - halfWidth, lat + halfHeight], // top-left
                [lng - halfWidth, lat - halfHeight]  // close polygon
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
        return Math.min(baseSize * scaleFactor, 10); // Maximum 10x scaling
    }

    /**
     * Get bounding box for coordination measure (for spatial queries)
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width
     * @param {number} height - Symbol height
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        // Approximate bounding box using scaled dimensions
        const scaledWidth = width * size * 0.5;
        const scaledHeight = height * size * 0.5;
        
        // Convert pixels to rough degree approximation
        const widthDegrees = scaledWidth / 111320; // Rough conversion
        const heightDegrees = scaledHeight / 111320;
        
        const halfWidth = widthDegrees / 2;
        const halfHeight = heightDegrees / 2;

        return [
            coordinates[0] - halfWidth, // minLng
            coordinates[1] - halfHeight, // minLat
            coordinates[0] + halfWidth,  // maxLng
            coordinates[1] + halfHeight  // maxLat
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
     * Text modifiers don't affect SIDC but require regeneration to show text
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
     * Check if property affects visual rendering (selection box recalculation needed)
     * @param {string} property - Property name being changed
     * @returns {boolean} True if property affects visual rendering
     */
    affectsVisuals(property) {
        const visualProperties = ['size', 'rotation', 'width', 'height'];
        return visualProperties.includes(property);
    }
}

export default AddCoordinationMeasureGeometry;