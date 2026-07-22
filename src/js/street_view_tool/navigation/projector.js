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
     * @param {number} y - Y position in meters (vertical)
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
     * How much a target shrinks for being the Nth in its direction.
     * A constant fraction per rank, so the decay is relative: the second icon is
     * always the same fraction of the first, whether the corridor is 3 m or 300.
     *
     * @param {number} rank - 0 for the first target in a direction
     * @returns {number} Multiplier in (0, 1]
     */
    rankRatio(rank) {
        return Math.pow(NAV_CONSTANTS.HORIZON_RANK_DECAY, Math.max(0, rank));
    }

    /**
     * The rank actually used for size and height: the position in the queue of a
     * direction, nudged by where the target sits in the distance ORDER of the
     * whole photo.
     *
     * Fractional on purpose. The queue position alone would draw a lone target
     * 80 m away exactly like a lone target 3 m away, and the operator would lose
     * every cue of depth. The nudge is bounded by HORIZON_DISTANCE_RANK_WEIGHT,
     * so the farthest target of the photo is at most that fraction of one rank
     * smaller and higher than its queue position asks for.
     *
     * @param {number} queueRank - Position along the direction, 0 = first
     * @param {number} distanceRatio - Place in the photo's distance order, 0 = nearest, 1 = farthest
     * @returns {number} Effective rank, possibly fractional
     */
    effectiveRank(queueRank, distanceRatio) {
        return queueRank
            + NAV_CONSTANTS.HORIZON_DISTANCE_RANK_WEIGHT * Math.min(1, Math.max(0, distanceRatio));
    }

    /**
     * Projects the point on the CAMERA HORIZON that lies at a given bearing.
     *
     * This is the only geometry the marker needs from the world: a direction.
     * Distance never reaches the screen; it only decides the order along the
     * direction, and the layout above the horizon is computed from the icons'
     * own sizes. Camera height, terrain, distance_scale and the old per-target
     * overrides are not merely unused, they are gone.
     *
     * The horizon here is the CORRECTED one: the sphere is levelled by
     * mesh_rotation_x/z before anything is drawn, so the camera's horizontal
     * plane is the image's true horizon.
     *
     * @param {number} bearingDeg - World bearing of the target (0 = North, 90 = East)
     * @param {number} yaw - Camera yaw in radians
     * @param {number} pitch - Camera pitch in radians
     * @param {number} fov - Camera vertical FOV in degrees
     * @returns {{screenX: number, screenY: number, visible: boolean, azimuthRelDeg: number}}
     */
    projectOnHorizon(bearingDeg, yaw, pitch, fov, elevationDeg = 0) {
        // A point at an arbitrary radius: only the angles matter, the
        // perspective divide cancels the radius out.
        const R = 10;
        const bearingRad = (bearingDeg * Math.PI) / 180;
        const projected = this.metersToScreen(
            Math.sin(bearingRad) * R,
            R * Math.tan((elevationDeg * Math.PI) / 180),
            -Math.cos(bearingRad) * R,
            yaw, pitch, fov
        );

        const yawDeg = -(yaw * 180) / Math.PI;
        const azimuthRelDeg = ((bearingDeg - yawDeg + 540) % 360) - 180;

        return {
            screenX: projected.screenX,
            screenY: projected.screenY,
            visible: projected.visible,
            azimuthRelDeg
        };
    }

    /**
     * Marker radius in pixels: a fixed angular size for the first target in a
     * direction, shrinking by a constant fraction for each one behind it.
     *
     * Kept angular rather than in pixels so zooming into the photograph grows
     * the icons along with the scene.
     *
     * @param {number} rank - Position in the queue along this direction, 0 = first
     * @param {number} fov - Camera vertical FOV in degrees
     * @returns {number} Radius in pixels
     */
    angularMarkerRadius(rank, fov) {
        const radius = this.focalLength(fov)
            * Math.tan((this.angularRadiusDeg(rank) * Math.PI) / 180);

        const max = this.canvasHeight * NAV_CONSTANTS.HORIZON_MAX_SIZE_REL;
        return Math.min(max, radius);
    }

    /**
     * Angular radius of the icon at a given rank, in degrees.
     *
     * NOT floored: flooring it would break the guarantee that every centre falls
     * outside the disc in front, because the gap keeps shrinking while a floored
     * radius would not. A queue ends by not being drawn (see angularRadiusDeg
     * against HORIZON_MIN_ANGULAR_DRAW), never by being clamped.
     *
     * @param {number} rank - 0 for the first target in a direction
     * @returns {number} Angular radius in degrees
     */
    angularRadiusDeg(rank) {
        return NAV_CONSTANTS.HORIZON_ANGULAR_NEAR * this.rankRatio(rank);
    }

    /**
     * Height of the icon at a given rank, in degrees above the corrected horizon.
     * Negative means below it, which is where the first icon of a queue sits.
     *
     * Approaches HORIZON_CEILING_ELEVATION_DEG asymptotically, so no queue, of
     * any length, ever climbs past the ceiling.
     *
     * @param {number} rank - 0 for the first target in a direction
     * @returns {number} Elevation in degrees (positive = above the horizon)
     */
    elevationDeg(rank) {
        const base = NAV_CONSTANTS.HORIZON_BASE_DEPRESSION_DEG;
        const ceiling = NAV_CONSTANTS.HORIZON_CEILING_ELEVATION_DEG;
        const band = base + ceiling;

        // O teto e limite, nao aproximacao: sem este clamp o arredondamento de
        // ponto flutuante deixa a fila profunda alguns milionesimos de grau
        // acima dele.
        return Math.min(ceiling, -base + band * (1 - this.rankRatio(rank)));
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

}
