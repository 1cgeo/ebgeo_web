// Path: js/draw_tools/sector_tool/add_sector_geometry.js

import { BaseGeometry } from '../../tool_manager';

/**
 * Sector Geometry Operations
 * Handles all geometric calculations and handle management for sector features.
 * A sector is a "pie slice" shape defined by center, radius, bearing (central axis), and aperture (opening angle).
 *
 * Angles follow geographic convention: 0 = North, clockwise.
 */
class AddSectorGeometry extends BaseGeometry {
    constructor(properties = {}) {
        super(properties);
    }

    /**
     * Generate sector geometry from center, radius, bearing and aperture.
     * @param {Array} center - Center coordinates [lng, lat]
     * @param {number} radius - Radius in meters
     * @param {number} bearing - Central axis bearing in degrees (0=North, clockwise)
     * @param {number} aperture - Opening angle in degrees (1-359)
     * @returns {Object} GeoJSON Polygon geometry
     */
    generate(center, radius, bearing, aperture) {
        return this.generateSectorGeometry(center, radius, bearing, aperture);
    }

    /**
     * Validate sector parameters.
     * @param {Array} center - Center coordinates
     * @param {number} radius - Radius in meters
     * @param {number} aperture - Aperture in degrees
     * @returns {boolean} True if valid
     */
    validate(center, radius, aperture) {
        if (!center || !Array.isArray(center) || center.length < 2) {
            return false;
        }
        if (typeof radius !== 'number' || radius < 10) {
            return false;
        }
        if (typeof aperture !== 'number' || aperture < 1 || aperture > 359) {
            return false;
        }
        return true;
    }

    /**
     * Normalize center coordinates from various formats.
     * @param {string|Array} center - Center coordinates
     * @returns {Array|null} Normalized center or null if invalid
     */
    normalizeCenter(center) {
        if (typeof center === 'string') {
            try {
                center = JSON.parse(center);
            } catch (e) {
                console.error('Error parsing center:', center, e);
                return null;
            }
        }
        if (!Array.isArray(center) || center.length < 2) {
            console.error('Invalid center:', center);
            return null;
        }
        return center;
    }

    /**
     * Calculate bearing from center to a point (geographic: 0=N, clockwise).
     * @param {Array} center - [lng, lat]
     * @param {Array} point - [lng, lat]
     * @returns {number} Bearing in degrees [0, 360)
     */
    calculateBearing(center, point) {
        const dLng = point[0] - center[0];
        const dLat = point[1] - center[1];
        // atan2 with geographic convention: North = +Y, East = +X
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        const dx = dLng * cosLat;
        const dy = dLat;
        // Geographic bearing: 0=N, 90=E
        let bearing = Math.atan2(dx, dy) * 180 / Math.PI;
        if (bearing < 0) bearing += 360;
        return bearing;
    }

    /**
     * Compute a point at given distance and bearing from center.
     * @param {Array} center - [lng, lat]
     * @param {number} radius - Distance in meters
     * @param {number} bearing - Bearing in degrees (geographic: 0=N, clockwise)
     * @returns {Array} [lng, lat]
     */
    pointAtBearing(center, radius, bearing) {
        const bearingRad = bearing * Math.PI / 180;
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        // dx = east offset, dy = north offset
        const dx = radius * Math.sin(bearingRad);
        const dy = radius * Math.cos(bearingRad);
        const lng = center[0] + (dx / 111320) / cosLat;
        const lat = center[1] + (dy / 111320);
        return [lng, lat];
    }

    /**
     * Generate sector polygon geometry.
     * The polygon is: [center, arcPoint0, arcPoint1, ..., arcPointN, center] (closed ring).
     * Arc sweeps from (bearing - aperture/2) to (bearing + aperture/2).
     * @param {Array} center - [lng, lat]
     * @param {number} radius - Radius in meters
     * @param {number} bearing - Central axis in degrees (0=North, clockwise)
     * @param {number} aperture - Opening angle in degrees
     * @returns {Object} GeoJSON Polygon geometry
     */
    generateSectorGeometry(center, radius, bearing, aperture) {
        // Scale points with aperture, min 16, max 64
        const numArcPoints = Math.max(16, Math.round(64 * aperture / 360));
        const startAngle = bearing - aperture / 2;
        const endAngle = bearing + aperture / 2;

        const coords = [];
        coords.push([center[0], center[1]]);

        for (let i = 0; i <= numArcPoints; i++) {
            const angle = startAngle + (i * (endAngle - startAngle) / numArcPoints);
            const pt = this.pointAtBearing(center, radius, angle);
            coords.push(pt);
        }

        // Close ring back to center
        coords.push([center[0], center[1]]);

        return {
            type: 'Polygon',
            coordinates: [coords]
        };
    }

    /**
     * Create edit handles for sector.
     * Returns 2 handles:
     *  - radius: on the central axis at the edge of the arc
     *  - aperture: at the edge of the arc on one side (bearing + aperture/2)
     * @param {Object} feature - Sector feature
     * @returns {Array} Array of handle features
     */
    createHandles(feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) {
            console.error('Cannot create handles - invalid center');
            return null;
        }

        const { radius, bearing, aperture } = feature.properties;
        const featureId = feature.properties.id;

        // Radius handle: at the tip of the central axis
        const radiusPoint = this.pointAtBearing(center, radius, bearing);
        const radiusHandle = {
            type: 'Feature',
            id: `sector-handle-${featureId}-radius`,
            geometry: { type: 'Point', coordinates: radiusPoint },
            properties: {
                role: 'handle',
                handleType: 'vertex',
                handleId: 'radius',
                featureId,
                mode: 'sector_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        // Aperture handle: at one edge of the arc (bearing + aperture/2)
        const aperturePoint = this.pointAtBearing(center, radius, bearing + aperture / 2);
        const apertureHandle = {
            type: 'Feature',
            id: `sector-handle-${featureId}-aperture`,
            geometry: { type: 'Point', coordinates: aperturePoint },
            properties: {
                role: 'handle',
                handleType: 'eccentricity',
                handleId: 'aperture',
                featureId,
                mode: 'sector_editing',
                meta: 'vertex',
                user_isEditingHandle: true
            }
        };

        return [radiusHandle, apertureHandle];
    }

    /**
     * Update sector geometry based on handle movement.
     * @param {string} handleId - 'radius' or 'aperture'
     * @param {Array} newPosition - New handle position [lng, lat]
     * @param {Object} feature - Sector feature being edited
     * @returns {Object|null} Updated { geometry, radius, bearing, aperture } or null
     */
    updateFromHandle(handleId, newPosition, feature) {
        const center = this.normalizeCenter(feature.properties.center);
        if (!center) return null;

        const { bearing, aperture, radius } = feature.properties;

        if (handleId === 'radius') {
            const newRadius = this.calculateDistance(center, newPosition);
            if (newRadius < 10) return null;
            // Also update bearing to follow the handle direction
            const newBearing = this.calculateBearing(center, newPosition);
            const geometry = this.generateSectorGeometry(center, newRadius, newBearing, aperture);
            return { geometry, radius: newRadius, bearing: newBearing, aperture };
        }

        if (handleId === 'aperture') {
            // Calculate angle from center to new position
            const handleBearing = this.calculateBearing(center, newPosition);
            // The aperture handle is at bearing + aperture/2.
            // New aperture = 2 * angular distance from central axis to handle.
            let angleDiff = handleBearing - bearing;
            // Normalize to [0, 360)
            if (angleDiff < 0) angleDiff += 360;
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            let newAperture = Math.round(angleDiff * 2);
            newAperture = Math.max(1, Math.min(359, newAperture));
            const geometry = this.generateSectorGeometry(center, radius, bearing, newAperture);
            return { geometry, radius, bearing, aperture: newAperture };
        }

        console.warn('Unknown handle type for sector:', handleId);
        return null;
    }

    /**
     * Calculate preview geometry during handle dragging.
     * @param {string} handleId - 'radius' or 'aperture'
     * @param {Array} newPosition - Current mouse position [lng, lat]
     * @param {Object} feature - Sector feature
     * @returns {Object|null} Preview { geometry, handles: [radiusHandle, apertureHandle], radius, bearing, aperture }
     */
    calculatePreview(handleId, newPosition, feature) {
        const result = this.updateFromHandle(handleId, newPosition, feature);
        if (!result) return null;

        const center = this.normalizeCenter(feature.properties.center);
        const { radius, bearing, aperture } = result;

        const radiusPoint = this.pointAtBearing(center, radius, bearing);
        const aperturePoint = this.pointAtBearing(center, radius, bearing + aperture / 2);

        return {
            geometry: result.geometry,
            handles: [radiusPoint, aperturePoint],
            radius,
            bearing,
            aperture
        };
    }

    /**
     * Check if coordinates represent a valid sector center.
     * @param {Array} coordinates - Coordinates to check
     * @returns {boolean} True if valid center
     */
    isValidCenter(coordinates) {
        return coordinates &&
            Array.isArray(coordinates) &&
            coordinates.length >= 2 &&
            typeof coordinates[0] === 'number' &&
            typeof coordinates[1] === 'number' &&
            !isNaN(coordinates[0]) &&
            !isNaN(coordinates[1]);
    }

    /**
     * Get bounding box for sector.
     * @param {Array} center - Sector center
     * @param {number} radius - Radius in meters
     * @returns {Array} Bounding box [minLng, minLat, maxLng, maxLat]
     */
    getBoundingBox(center, radius) {
        const radiusInDegrees = radius / 111320;
        const cosLat = Math.cos(center[1] * Math.PI / 180);
        return [
            center[0] - (radiusInDegrees / cosLat),
            center[1] - radiusInDegrees,
            center[0] + (radiusInDegrees / cosLat),
            center[1] + radiusInDegrees
        ];
    }
}

export default AddSectorGeometry;
