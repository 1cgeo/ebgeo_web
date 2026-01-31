// Path: js/street_view_tool/navigation/hit-tester.js

/**
 * @fileoverview Hit testing for Street View 360 navigation markers.
 * Detects mouse hover and click interactions with markers.
 */

import { NAV_CONSTANTS } from './constants.js';

/**
 * Tests for interactions with navigation markers.
 */
export class StreetViewHitTester {
    constructor() {
        /** @type {Array} */
        this.markers = [];
    }

    /**
     * Sets the markers available for hit testing
     * @param {Array} markers - Array of marker objects with screen positions
     */
    setMarkers(markers) {
        // Sort by distance (near to far) for proper hit priority
        this.markers = [...markers].sort((a, b) => a.distance - b.distance);
    }

    /**
     * Tests if a point hits any marker
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @returns {Object|null} The hit marker or null
     */
    testPoint(screenX, screenY) {
        for (const marker of this.markers) {
            if (this.isPointInMarker(screenX, screenY, marker)) {
                return marker;
            }
        }
        return null;
    }

    /**
     * Finds the closest marker to a point within a maximum distance
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} maxDistance - Maximum distance in pixels
     * @returns {Object|null} The closest marker or null
     */
    findClosest(screenX, screenY, maxDistance) {
        let closestMarker = null;
        let closestDistance = maxDistance;

        for (const marker of this.markers) {
            const distance = this.getDistanceToMarker(screenX, screenY, marker);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestMarker = marker;
            }
        }

        return closestMarker;
    }

    /**
     * Checks if a point is inside a marker's hit area
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {Object} marker - Marker object
     * @returns {boolean} True if point is inside
     */
    isPointInMarker(screenX, screenY, marker) {
        const { screenX: mx, screenY: my, radius } = marker;

        // Calculate hit area with multiplier (circular hit testing)
        const hitRadius = radius * NAV_CONSTANTS.HIT_RADIUS_MULTIPLIER;

        // Test circular hit (simple distance check)
        const dx = screenX - mx;
        const dy = screenY - my;
        const distanceSquared = dx * dx + dy * dy;

        return distanceSquared <= hitRadius * hitRadius;
    }

    /**
     * Gets the distance from a point to a marker's center
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {Object} marker - Marker object
     * @returns {number} Distance in pixels
     */
    getDistanceToMarker(screenX, screenY, marker) {
        const dx = screenX - marker.screenX;
        const dy = screenY - marker.screenY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Gets all markers within a certain distance from a point
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} maxDistance - Maximum distance in pixels
     * @returns {Array} Array of markers within distance
     */
    getMarkersNear(screenX, screenY, maxDistance) {
        return this.markers.filter(marker => {
            const distance = this.getDistanceToMarker(screenX, screenY, marker);
            return distance <= maxDistance;
        });
    }

    /**
     * Gets all markers that are currently visible
     * @returns {Array} Array of visible markers
     */
    getVisibleMarkers() {
        return this.markers.filter(marker => marker.visible !== false);
    }
}
