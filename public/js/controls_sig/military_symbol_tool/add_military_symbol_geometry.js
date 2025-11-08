// Path: js\controls_sig\military_symbol_tool\add_military_symbol_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';
import { normalizeSIDC, getBaseSIDC } from './brazilian_sidc_extension.js';

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
    createHandles(feature) {
        return []; // Military symbols don't have edit handles
    }

    /**
     * Military symbols don't support handle-based editing
     * @param {string} handleType - Type of handle
     * @param {Array} newPosition - New position
     * @param {Object} feature - Feature being edited
     * @returns {null} Always null (not supported)
     */
    updateFromHandle(handleType, newPosition, feature) {
        return null; // Military symbols don't have edit handles
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
     * @returns {Object} GeoJSON Polygon geometry for selection box
     */
    calculateSelectionBoxGeometry(coordinates, width, height, size, rotation, createdAtZoom, uiManager) {
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
                [lng - halfWidth, lat - halfHeight], // bottom-left
                [lng + halfWidth, lat - halfHeight], // bottom-right
                [lng + halfWidth, lat + halfHeight], // top-right
                [lng - halfWidth, lat + halfHeight], // top-left
                [lng - halfWidth, lat - halfHeight]  // close polygon
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
     * Get bounding box for military symbol (for spatial queries)
     * @param {Array} coordinates - Symbol position
     * @param {number} width - Symbol width
     * @param {number} height - Symbol height
     * @param {number} size - Size multiplier
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(coordinates, width, height, size) {
        // Approximate bounding box using scaled dimensions
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;
        
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
            'uniqueDesignation',      // C - Designação
            'higherFormation',        // B - Subordinação
            'quantity',               // C1 - Quantidade
            'reinforcedReduced',      // F - Reforço/Redução
            'additionalInformation',  // H - Informações Adicionais
            'credibility',            // J - Credibilidade (combinado J+K)
            'type',                   // V - Tipo de Equipamento / AIS
            'iffSif',                 // P - Código IFF
            'dateTimeGroup',          // W - GDH
            'altitudeDepth',          // X - Altitude/Profundidade
            'equipmentTeardownTime',  // X1 - Tempo de Destruição
            'location',               // Y - Localização
            'speed',                  // Z - Velocidade
            'specialHeadquarters',    // AA - Tipo de PC
            'direction',              // Q - Direção/Azimute
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