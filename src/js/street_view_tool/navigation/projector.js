// Path: js/street_view_tool/navigation/projector.js

/**
 * @fileoverview Coordinate projection utilities for Street View 360 navigation.
 * Handles conversions between geographic, 3D world, and screen coordinates.
 */

import { NAV_CONSTANTS } from './constants.js';

/**
 * Projects geographic and 3D coordinates to screen space for the 360 viewer.
 */
export class StreetViewProjector {
    /**
     * @param {number} canvasWidth - Canvas width in pixels
     * @param {number} canvasHeight - Canvas height in pixels
     */
    constructor(canvasWidth, canvasHeight) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.cameraConfig = null;
    }

    /**
     * Updates the projector dimensions
     * @param {number} width - New canvas width
     * @param {number} height - New canvas height
     */
    resize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    /**
     * Sets the camera configuration for projections
     * @param {Object} cameraConfig - Camera metadata from JSON
     */
    setCameraConfig(cameraConfig) {
        this.cameraConfig = cameraConfig;
    }

    /**
     * Converts geographic coordinates to meters relative to camera position
     * @param {number} lon - Target longitude
     * @param {number} lat - Target latitude
     * @param {number} cameraLon - Camera longitude
     * @param {number} cameraLat - Camera latitude
     * @returns {{x: number, z: number}} Position in meters (x = east, z = north)
     */
    lonLatToMeters(lon, lat, cameraLon, cameraLat) {
        // Use Turf.js for accurate distance calculations
        const cameraPoint = turf.point([cameraLon, cameraLat]);

        // Calculate X distance (east-west)
        const xDest = turf.point([lon, cameraLat]);
        let x = turf.distance(cameraPoint, xDest, { units: 'meters' });
        x *= lon > cameraLon ? 1 : -1;

        // Calculate Z distance (north-south)
        const zDest = turf.point([cameraLon, lat]);
        let z = turf.distance(cameraPoint, zDest, { units: 'meters' });
        z *= lat > cameraLat ? -1 : 1; // Invert for 3D coordinate system

        return { x, z };
    }

    /**
     * Projects a 3D point to screen coordinates
     * @param {number} x - X position in meters
     * @param {number} y - Y position in meters (elevation)
     * @param {number} z - Z position in meters
     * @param {number} yaw - Camera yaw rotation in radians
     * @param {number} pitch - Camera pitch rotation in radians
     * @param {number} fov - Camera field of view in degrees
     * @returns {{screenX: number, screenY: number, distance: number, visible: boolean}}
     */
    metersToScreen(x, y, z, yaw, pitch, fov) {
        // Apply camera rotation (yaw) - rotate world into camera space
        // When camera yaws right (positive), world appears to move left
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        const rotatedX = x * cosYaw - z * sinYaw;
        const rotatedZ = x * sinYaw + z * cosYaw;

        // Check if point is behind camera (in camera space, forward is -Z)
        if (rotatedZ >= 0) {
            return { screenX: 0, screenY: 0, distance: 0, visible: false };
        }

        // Calculate distance from camera
        const distance = Math.sqrt(x * x + y * y + z * z);

        // Apply pitch rotation - rotate around X axis
        // When camera pitches up (positive), world appears to move down
        const cosPitch = Math.cos(-pitch);
        const sinPitch = Math.sin(-pitch);
        const rotatedY = y * cosPitch - rotatedZ * sinPitch;
        const finalZ = y * sinPitch + rotatedZ * cosPitch;

        // Perspective projection
        const fovRad = (fov * Math.PI) / 180;
        const aspectRatio = this.canvasWidth / this.canvasHeight;
        const tanHalfFov = Math.tan(fovRad / 2);

        // Project to normalized device coordinates
        const ndcX = rotatedX / (-finalZ * tanHalfFov * aspectRatio);
        const ndcY = rotatedY / (-finalZ * tanHalfFov);

        // Check if point is within FOV
        const margin = NAV_CONSTANTS.FOV_MARGIN / fov;
        if (Math.abs(ndcX) > 1 + margin || Math.abs(ndcY) > 1 + margin) {
            return { screenX: 0, screenY: 0, distance, visible: false };
        }

        // Convert to screen coordinates
        const screenX = (ndcX + 1) * 0.5 * this.canvasWidth;
        const screenY = (1 - ndcY) * 0.5 * this.canvasHeight;

        return { screenX, screenY, distance, visible: true };
    }

    /**
     * Converts screen coordinates to a point on the ground plane
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} yaw - Camera yaw rotation in radians
     * @param {number} pitch - Camera pitch rotation in radians
     * @param {number} fov - Camera field of view in degrees
     * @returns {{x: number, z: number}|null} Ground position in meters, or null if not hitting ground
     */
    screenToGround(screenX, screenY, yaw, pitch, fov) {
        const cameraHeight = this.cameraConfig?.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT;

        // Convert screen to normalized device coordinates
        const ndcX = (screenX / this.canvasWidth) * 2 - 1;
        const ndcY = 1 - (screenY / this.canvasHeight) * 2;

        // Calculate ray direction in camera space (looking at -Z)
        const fovRad = (fov * Math.PI) / 180;
        const aspectRatio = this.canvasWidth / this.canvasHeight;
        const tanHalfFov = Math.tan(fovRad / 2);

        let rayX = ndcX * tanHalfFov * aspectRatio;
        let rayY = ndcY * tanHalfFov;
        let rayZ = -1;

        // Apply inverse pitch rotation (undo the camera pitch)
        // metersToScreen uses: y' = y*cos(-p) - z*sin(-p), z' = y*sin(-p) + z*cos(-p)
        // Inverse: y' = y*cos(-p) + z*sin(-p), z' = -y*sin(-p) + z*cos(-p)
        // Which simplifies to: y' = y*cos(p) - z*sin(p), z' = y*sin(p) + z*cos(p)
        const cosPitch = Math.cos(pitch);
        const sinPitch = Math.sin(pitch);
        const tempY = rayY * cosPitch - rayZ * sinPitch;
        const tempZ1 = rayY * sinPitch + rayZ * cosPitch;
        rayY = tempY;
        rayZ = tempZ1;

        // Apply inverse yaw rotation (undo the camera yaw)
        // metersToScreen uses: x' = x*cos(y) - z*sin(y), z' = x*sin(y) + z*cos(y)
        // Inverse: x' = x*cos(y) + z*sin(y), z' = -x*sin(y) + z*cos(y)
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        const tempX = rayX * cosYaw + rayZ * sinYaw;
        const tempZ2 = -rayX * sinYaw + rayZ * cosYaw;
        rayX = tempX;
        rayZ = tempZ2;

        // Check if ray points upward (won't hit ground)
        if (rayY >= 0) {
            return null;
        }

        // Calculate intersection with ground plane (y = -cameraHeight)
        const t = -cameraHeight / rayY;

        if (t < 0) {
            return null;
        }

        return {
            x: rayX * t,
            z: rayZ * t
        };
    }

    /**
     * Converts screen coordinates to spherical coordinates (heading/pitch)
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} yaw - Camera yaw rotation in radians
     * @param {number} pitch - Camera pitch rotation in radians
     * @param {number} fov - Camera field of view in degrees
     * @returns {{heading: number, pitch: number, distance: number}}
     */
    screenToSpherical(screenX, screenY, yaw, pitch, fov) {
        // Convert screen to normalized device coordinates
        const ndcX = (screenX / this.canvasWidth) * 2 - 1;
        const ndcY = 1 - (screenY / this.canvasHeight) * 2;

        // Calculate ray direction in camera space
        const fovRad = (fov * Math.PI) / 180;
        const aspectRatio = this.canvasWidth / this.canvasHeight;
        const tanHalfFov = Math.tan(fovRad / 2);

        let rayX = ndcX * tanHalfFov * aspectRatio;
        let rayY = ndcY * tanHalfFov;
        let rayZ = -1;

        // Normalize ray
        const length = Math.sqrt(rayX * rayX + rayY * rayY + rayZ * rayZ);
        rayX /= length;
        rayY /= length;
        rayZ /= length;

        // Apply inverse pitch rotation (same as screenToGround)
        const cosPitch = Math.cos(pitch);
        const sinPitch = Math.sin(pitch);
        const tempY = rayY * cosPitch - rayZ * sinPitch;
        const tempZ1 = rayY * sinPitch + rayZ * cosPitch;
        rayY = tempY;
        rayZ = tempZ1;

        // Apply inverse yaw rotation (same as screenToGround)
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        const tempX = rayX * cosYaw + rayZ * sinYaw;
        const tempZ2 = -rayX * sinYaw + rayZ * cosYaw;
        rayX = tempX;
        rayZ = tempZ2;

        // Convert to spherical coordinates
        const heading = Math.atan2(rayX, -rayZ);
        const rayPitch = Math.asin(rayY);

        // Convert heading to degrees (0-360)
        let headingDegrees = (heading * 180) / Math.PI;
        if (headingDegrees < 0) {
            headingDegrees += 360;
        }

        return {
            heading: headingDegrees,
            pitch: rayPitch,
            distance: 5 // Default distance for new markers
        };
    }

    /**
     * Calculates the flattening ratio for elliptical markers based on camera height and distance.
     * Uses perspective-correct formula: flattenRatio = h / sqrt(h² + d²)
     * where h = camera height and d = horizontal distance to marker.
     *
     * @param {number} distance - Distance from camera in meters
     * @param {number} _pitch - Camera pitch in radians (unused, kept for API compatibility)
     * @returns {number} Flatten ratio (0-1), where lower values are flatter
     */
    calculateFlattenRatio(horizontalDistance, pitch) {
        const cameraHeight = this.cameraConfig?.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT;

        // Base flattening: a circle on the ground viewed from height h at
        // horizontal distance d appears compressed by h / sqrt(h² + d²).
        const h = cameraHeight;
        const d = Math.max(0.1, horizontalDistance);
        const baseFlatten = h / Math.sqrt(h * h + d * d);

        // Pitch correction: looking straight down (pitch = -90°) → markers
        // appear circular (flatten → 1). Looking horizontally (pitch = 0°) →
        // maximum flattening. Use cos(pitch) as interpolation factor since
        // pitch=0 → cos=1 (full flatten) and pitch=±90° → cos=0 (circle).
        const pitchFactor = Math.abs(Math.cos(pitch));
        const flattenRatio = 1 - pitchFactor * (1 - baseFlatten);

        return Math.max(0.15, Math.min(0.9, flattenRatio));
    }

    /**
     * Checks if a screen position is within the camera's field of view
     * @param {number} screenX - Screen X coordinate
     * @param {number} screenY - Screen Y coordinate
     * @param {number} margin - Additional margin in pixels
     * @returns {boolean} True if within FOV
     */
    isInFOV(screenX, screenY, margin = 0) {
        return (
            screenX >= -margin &&
            screenX <= this.canvasWidth + margin &&
            screenY >= -margin &&
            screenY <= this.canvasHeight + margin
        );
    }

    /**
     * Calculates the focal length (in pixels) for the current canvas and FOV.
     * focal = (canvasHeight / 2) / tan(fov / 2)
     *
     * @param {number} fov - Vertical field of view in degrees
     * @returns {number} Focal length in pixels
     */
    focalLength(fov) {
        const fovRad = (fov * Math.PI) / 180;
        return (this.canvasHeight / 2) / Math.tan(fovRad / 2);
    }

    /**
     * Physically-based marker size: a disk of `worldRadius` meters at
     * `horizontalDistance` meters away projects to
     * `worldRadius * focalLength / horizontalDistance` pixels.
     *
     * Uses horizontal distance (not camera-space depth) so that markers
     * at the same real-world distance have the same size regardless of
     * viewing direction.  This matches the cursor behavior, which is
     * sized the same way via screenToGround distance.
     *
     * @param {number} worldRadius - Physical radius on the ground (meters)
     * @param {number} horizontalDistance - Horizontal distance from camera (meters)
     * @param {number} fov - Vertical FOV in degrees
     * @returns {number} Marker radius in pixels
     */
    calculateMarkerSize(worldRadius, horizontalDistance, fov) {
        const cameraHeight = this.cameraConfig?.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT;
        const markerScale = this.cameraConfig?.marker_scale ?? 1.0;
        const slant = Math.sqrt(horizontalDistance * horizontalDistance + cameraHeight * cameraHeight);
        const d = Math.max(0.5, slant);
        const f = this.focalLength(fov);
        const size = (worldRadius * markerScale) * f / d;

        return Math.max(NAV_CONSTANTS.MARKER_MIN_SIZE, Math.min(NAV_CONSTANTS.MARKER_MAX_SIZE, size));
    }
}
