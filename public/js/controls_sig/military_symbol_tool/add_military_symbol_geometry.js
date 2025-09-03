// Path: js\controls_sig\military_symbol_tool\add_military_symbol_geometry.js
import BaseGeometry from '../tool_manager/base_geometry.js';

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
     * Validate military symbol coordinates and SIDC
     * @param {Array} coordinates - Position coordinates
     * @param {string} sidc - Symbol Identification Code (20 digits)
     * @returns {boolean} True if valid
     */
    validate(coordinates, sidc = null) {
        // Validate coordinates
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
            return false;
        }

        if (typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
            return false;
        }

        if (isNaN(coordinates[0]) || isNaN(coordinates[1])) {
            return false;
        }

        // Validate SIDC if provided
        if (sidc && !this.validateSIDC(sidc)) {
            return false;
        }

        return true;
    }

    /**
     * Validate SIDC format (20 digits)
     * @param {string} sidc - Symbol Identification Code
     * @returns {boolean} True if valid SIDC format
     */
    validateSIDC(sidc) {
        if (!sidc || typeof sidc !== 'string') {
            return false;
        }

        // Must be exactly 20 digits
        if (sidc.length !== 20) {
            return false;
        }

        // Must contain only numbers
        if (!/^[0-9]{20}$/.test(sidc)) {
            return false;
        }

        // Format ID must be "10"
        const formatId = sidc.substring(0, 2);
        if (formatId !== "10") {
            return false;
        }

        return true;
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
        const scaledWidth = width * size * 0.625;
        const scaledHeight = height * size * 0.625;
        
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
     * Build SIDC from military properties
     * @param {Object} properties - Military symbol properties
     * @returns {string} 20-digit SIDC string
     */
    buildSIDC(properties) {
        const formatId = "10";                                              // A: 2 digits (always "10")
        const context = properties.context || "0";                         // B: 1 digit (0=reality)
        const standardIdentity = properties.standardIdentity || "3";       // C: 1 digit (3=friend)
        const symbolSet = "10";                                            // D: 2 digits (always "10"=land)
        const status = properties.status || "0";                          // E: 1 digit (0=present)
        const hqTfDummy = properties.hqTfDummy || "0";                     // F: 1 digit (0=N/A)
        const echelon = properties.echelon || "16";                       // G: 2 digits (16=battalion)
        const mainIcon = properties.mainIcon || "121100";                 // H: 6 digits (121100=infantry)
        const modifier1 = properties.modifier1 || "00";                   // I: 2 digits
        const modifier2 = properties.modifier2 || "00";                   // J: 2 digits

        return `${formatId}${context}${standardIdentity}${symbolSet}${status}${hqTfDummy}${echelon}${mainIcon}${modifier1}${modifier2}`;
    }

    /**
     * Parse SIDC into component properties
     * @param {string} sidc - 20-digit SIDC string
     * @returns {Object} Parsed properties or null if invalid
     */
    parseSIDC(sidc) {
        if (!this.validateSIDC(sidc)) {
            return null;
        }

        return {
            formatId: sidc.substring(0, 2),        // A: positions 1-2
            context: sidc.substring(2, 3),         // B: position 3
            standardIdentity: sidc.substring(3, 4), // C: position 4
            symbolSet: sidc.substring(4, 6),       // D: positions 5-6
            status: sidc.substring(6, 7),          // E: position 7
            hqTfDummy: sidc.substring(7, 8),       // F: position 8
            echelon: sidc.substring(8, 10),        // G: positions 9-10
            mainIcon: sidc.substring(10, 16),      // H: positions 11-16
            modifier1: sidc.substring(16, 18),     // I: positions 17-18
            modifier2: sidc.substring(18, 20)      // J: positions 19-20
        };
    }

    /**
     * Check if coordinates represent a valid symbol position
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid position
     */
    isValidPosition(coordinates) {
        return coordinates && 
               Array.isArray(coordinates) && 
               coordinates.length >= 2 && 
               typeof coordinates[0] === 'number' && 
               typeof coordinates[1] === 'number' &&
               !isNaN(coordinates[0]) && 
               !isNaN(coordinates[1]);
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
            'echelon', 'mainIcon', 'modifier1', 'modifier2'
        ];
        
        return sidcProperties.includes(property);
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