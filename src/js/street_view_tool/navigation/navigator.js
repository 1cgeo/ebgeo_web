// Path: js/street_view_tool/navigation/navigator.js

/**
 * @fileoverview Main orchestrator for Street View 360 navigation system.
 * Coordinates the projector, renderer, hit tester, and minimap sync.
 * Implements Google Street View-like navigation behavior with ground cursor.
 */

import { NAV_CONSTANTS } from './constants.js';
import { StreetViewProjector } from './projector.js';
import { StreetViewRenderer } from './renderer.js';
import { StreetViewHitTester } from './hit-tester.js';
import { StreetViewMinimapSync } from './minimap-sync.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { showToast } from '@utils';

// Threshold in pixels to distinguish drag from click
const DRAG_THRESHOLD = 5;

/**
 * Main navigation system for the 360 viewer.
 * Manages navigation targets, POIs, and user interactions.
 */
export class StreetViewNavigator {
    /**
     * @param {HTMLElement} container - Container element for the 360 viewer
     * @param {maplibregl.Map} minimap - MapLibre minimap instance
     * @param {Function} getCameraFn - Function to get the current Three.js camera
     */
    constructor(container, minimap, getCameraFn) {
        this.container = container;
        this.minimap = minimap;
        this.getCamera = getCameraFn;

        // Create canvas overlay
        this.canvas = null;
        this.projector = null;
        this.renderer = null;
        this.hitTester = null;
        this.minimapSync = null;

        // State
        this.targets = [];
        this.pois = [];
        this.cameraConfig = null;
        this.mousePosition = { x: 0, y: 0 };
        this.selectedPOIId = null;
        this.markerToolActive = false;
        this.nearestTargetId = null;
        this.cursorNearestTargetId = null; // Dynamically calculated based on cursor position

        // Drag detection state
        this.pointerDownPos = null;
        this.isDragging = false;

        // Bound event handlers
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleResize = this.handleResize.bind(this);

        this.initialized = false;
    }

    /**
     * Initializes the navigation system
     */
    async initialize() {
        if (this.initialized) return;

        // Create canvas overlay
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'streetview-nav-canvas';
        this.canvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        `;

        // Set canvas size based on container (accounts for sidebar offset)
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = this.container.clientHeight;

        // Add to container
        this.container.appendChild(this.canvas);

        // Create subcomponents
        this.projector = new StreetViewProjector(this.canvas.width, this.canvas.height);
        this.renderer = new StreetViewRenderer(this.canvas);
        this.hitTester = new StreetViewHitTester();

        // Initialize minimap sync
        if (this.minimap) {
            this.minimapSync = new StreetViewMinimapSync(this.minimap);
            await this.minimapSync.initialize();
        }

        // Add event listeners
        this.container.addEventListener('mousemove', this.handleMouseMove);
        this.container.addEventListener('pointerdown', this.handlePointerDown);
        this.container.addEventListener('pointerup', this.handlePointerUp);
        window.addEventListener('resize', this.handleResize);

        // Enable pointer events on canvas for hit testing
        this.canvas.style.pointerEvents = 'auto';

        this.initialized = true;
    }

    /**
     * Sets the current photo's camera configuration and targets
     * @param {Object} cameraConfig - Camera metadata
     * @param {Array} targets - Navigation targets
     */
    setPhoto(cameraConfig, targets) {
        this.cameraConfig = cameraConfig;
        this.targets = targets || [];

        // Update projector with camera config
        this.projector.setCameraConfig(cameraConfig);

        // Find the nearest target
        this.updateNearestTarget();

        // Update minimap
        if (this.minimapSync) {
            this.minimapSync.setCameraPosition(
                cameraConfig.lon,
                cameraConfig.lat,
                cameraConfig.heading
            );
        }
    }

    /**
     * Updates which target is the nearest (for highlighting)
     */
    updateNearestTarget() {
        if (!this.targets || this.targets.length === 0) {
            this.nearestTargetId = null;
            return;
        }

        let nearestId = null;
        let nearestDist = Infinity;

        for (const target of this.targets) {
            // Calculate distance in meters using lon/lat
            const { x, z } = this.projector.lonLatToMeters(
                target.lon,
                target.lat,
                this.cameraConfig.lon,
                this.cameraConfig.lat
            );
            const dist = Math.sqrt(x * x + z * z);

            if (dist < nearestDist) {
                nearestDist = dist;
                nearestId = target.id;
            }
        }

        this.nearestTargetId = nearestId;
    }

    /**
     * Sets the POIs (360 markers) to display
     * @param {Array} pois - Array of POI objects
     */
    setPOIs(pois) {
        this.pois = pois || [];
    }

    /**
     * Renders a single frame of navigation elements
     * @param {number} lonDeg - Camera longitude (horizontal rotation) in degrees
     * @param {number} latDeg - Camera latitude (vertical rotation) in degrees
     * @param {number} fov - Camera FOV in degrees
     */
    render(lonDeg, latDeg, fov) {
        if (!this.initialized) return;

        // lon=0 means looking at imageHeading direction
        // Drag right → lon decreases → looking left (counter-clockwise)
        // Drag left → lon increases → looking right (clockwise)
        // worldHeading = imageHeading + lon
        const imageHeading = this.cameraConfig?.heading ?? 0;
        const worldHeadingDeg = imageHeading + lonDeg;

        // Convert to radians for projection
        // In our projection system:
        // - Targets at north (heading=0) should be at -Z in world space
        // - yaw=0 means camera looking at -Z (north)
        // - positive yaw rotates camera counter-clockwise (looking more west)
        // Since worldHeading is measured clockwise from north (0=N, 90=E),
        // we need yaw = -worldHeading to convert properly
        const yaw = -(worldHeadingDeg * Math.PI) / 180;
        const pitch = (latDeg * Math.PI) / 180;

        // Store for use in updateMinimapCursor and ground cursor
        this.currentYaw = yaw;
        this.currentPitch = pitch;
        this.currentFov = fov;

        const markers = [];

        // Check FOV for visibility
        const shouldShowMarkers = fov > NAV_CONSTANTS.HIDE_ARROWS_FOV;
        const scaleFactor = fov <= NAV_CONSTANTS.SCALE_ARROWS_FOV
            ? (fov - NAV_CONSTANTS.HIDE_ARROWS_FOV) / (NAV_CONSTANTS.SCALE_ARROWS_FOV - NAV_CONSTANTS.HIDE_ARROWS_FOV)
            : 1;

        // Project navigation targets
        if (shouldShowMarkers) {
            for (const target of this.targets) {
                const projected = this.projectTarget(target, yaw, pitch, fov);
                if (projected) {
                    projected.radius *= scaleFactor;
                    projected.type = 'navigation';
                    projected.data = target;
                    markers.push(projected);
                }
            }
        }

        // Project POIs (always visible)
        for (const poi of this.pois) {
            const projected = this.projectPOI(poi, yaw, pitch, fov);
            if (projected) {
                projected.type = 'poi';
                projected.data = poi;
                markers.push(projected);
            }
        }

        // Update hit tester
        this.hitTester.setMarkers(markers);

        // Update renderer
        this.renderer.setMarkers(markers);
        this.renderer.setSelectedMarker(this.selectedPOIId);
        this.renderer.setNearestMarker(this.nearestTargetId);

        // Update ground cursor (calculates cursorNearestTargetId)
        this.updateGroundCursor(yaw, pitch, fov);

        // Set cursor nearest marker after updateGroundCursor updates cursorNearestTargetId
        this.renderer.setCursorNearestMarker(this.cursorNearestTargetId);

        // Render
        this.renderer.render();
    }

    /**
     * Updates the ground cursor that follows the mouse
     * @param {number} yaw - Camera yaw in radians
     * @param {number} pitch - Camera pitch in radians
     * @param {number} fov - Camera FOV in degrees
     */
    updateGroundCursor(yaw, pitch, fov) {
        // Don't show cursor if marker tool is active or if hovering a marker
        if (this.markerToolActive || this.renderer.hoveredMarkerId) {
            this.renderer.setGroundCursor(null);
            this.cursorNearestTargetId = null;
            this.renderer.setCursorNearestMarker(null);
            return;
        }

        // Project mouse position to ground
        const ground = this.projector.screenToGround(
            this.mousePosition.x,
            this.mousePosition.y,
            yaw,
            pitch,
            fov
        );

        if (!ground) {
            this.renderer.setGroundCursor(null);
            this.cursorNearestTargetId = null;
            this.renderer.setCursorNearestMarker(null);
            return;
        }

        // Calculate flatten ratio for the cursor position
        const cursorDistance = Math.sqrt(ground.x * ground.x + ground.z * ground.z);
        const flattenY = this.projector.calculateFlattenRatio(cursorDistance, pitch);

        // Find the nearest target to the cursor position (dynamically)
        const nearestTarget = this.findNearestTargetToCursor(ground);
        this.cursorNearestTargetId = nearestTarget?.id || null;

        // Calculate arrow angle pointing to nearest marker using screen coordinates
        let arrowAngle = null;
        if (nearestTarget) {
            // Find the projected marker to get its screen position
            const projectedMarker = this.renderer.markers.find(m => m.id === nearestTarget.id);
            if (projectedMarker) {
                arrowAngle = this.calculateArrowAngleToScreen(
                    this.mousePosition.x,
                    this.mousePosition.y,
                    projectedMarker.screenX,
                    projectedMarker.screenY
                );
            }
        }

        // Set ground cursor data (fov needed for physically-based sizing)
        this.renderer.setGroundCursor({
            screenX: this.mousePosition.x,
            screenY: this.mousePosition.y,
            flattenY,
            arrowAngle,
            distance: cursorDistance,
            fov
        });
    }

    /**
     * Finds the nearest navigation target to the cursor position on the ground
     * @param {Object} cursorGround - Cursor position on ground { x, z } in meters
     * @returns {Object|null} The nearest target or null
     */
    findNearestTargetToCursor(cursorGround) {
        if (!this.targets || this.targets.length === 0 || !this.cameraConfig) {
            return null;
        }

        let nearestTarget = null;
        let nearestDist = Infinity;

        for (const target of this.targets) {
            // Get target position in meters relative to camera
            const { x: targetX, z: targetZ } = this.projector.lonLatToMeters(
                target.lon,
                target.lat,
                this.cameraConfig.lon,
                this.cameraConfig.lat
            );

            // Calculate distance from cursor to this target
            const dx = targetX - cursorGround.x;
            const dz = targetZ - cursorGround.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < nearestDist) {
                nearestDist = dist;
                nearestTarget = target;
            }
        }

        return nearestTarget;
    }

    /**
     * Calculates the arrow angle from cursor to target using screen coordinates
     * This is much more accurate than world-space calculations
     * @param {number} cursorX - Cursor screen X
     * @param {number} cursorY - Cursor screen Y
     * @param {number} targetX - Target marker screen X
     * @param {number} targetY - Target marker screen Y
     * @returns {number} Angle in radians (0 = pointing up on screen)
     */
    calculateArrowAngleToScreen(cursorX, cursorY, targetX, targetY) {
        // Vector from cursor to target in screen space
        const dx = targetX - cursorX;
        const dy = targetY - cursorY;

        // Calculate angle where 0 = pointing up (negative Y direction in screen space)
        // atan2(x, -y) gives us angle from north (up) clockwise
        return Math.atan2(dx, -dy);
    }

    /**
     * Projects a navigation target to screen coordinates
     * @param {Object} target - Target object with lon/lat
     * @param {number} yaw - Camera yaw
     * @param {number} pitch - Camera pitch
     * @param {number} fov - Camera FOV
     * @returns {Object|null} Projected marker data or null
     */
    projectTarget(target, yaw, pitch, fov) {
        if (!this.cameraConfig) return null;

        // If target has a manual override, project from bearing + ground distance.
        if (target.override_bearing != null) {
            return this.projectFromOverride(
                target.override_bearing,
                target.override_distance ?? 5,
                target, yaw, pitch, fov,
                target.override_height ?? 0
            );
        }

        // Convert lon/lat to meters, then apply distance_scale
        let { x, z } = this.projector.lonLatToMeters(
            target.lon,
            target.lat,
            this.cameraConfig.lon,
            this.cameraConfig.lat
        );
        const distanceScale = this.cameraConfig.distance_scale ?? 1.0;
        x *= distanceScale;
        z *= distanceScale;

        const cameraHeight = this.cameraConfig.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT;
        const y = -cameraHeight;

        const horizontalDistance = Math.sqrt(x * x + z * z);

        const projected = this.projector.metersToScreen(x, y, z, yaw, pitch, fov);

        if (!projected.visible) return null;

        const radius = this.projector.calculateMarkerSize(
            NAV_CONSTANTS.MARKER_WORLD_RADIUS, horizontalDistance, fov
        );
        const flattenY = this.projector.calculateFlattenRatio(horizontalDistance, pitch);

        return {
            id: target.id,
            screenX: projected.screenX,
            screenY: projected.screenY,
            distance: projected.distance,
            radius,
            flattenY
        };
    }

    /**
     * Projects a target from bearing + ground distance + height offset.
     * Used when a target has been manually positioned via the calibration interface.
     * The height offset raises/lowers the marker from the ground plane.
     * @param {number} bearingDeg - Bearing in degrees (0=North, 90=East)
     * @param {number} groundDistance - Ground distance in meters
     * @param {Object} target - Target object (for id and distance metadata)
     * @param {number} yaw - Camera yaw
     * @param {number} pitch - Camera pitch
     * @param {number} fov - Camera FOV
     * @param {number} [overrideHeight=0] - Manual height offset in meters (positive = above ground)
     * @returns {Object|null} Projected marker data or null if behind camera
     */
    projectFromOverride(bearingDeg, groundDistance, target, yaw, pitch, fov, overrideHeight = 0) {
        const bearingRad = (bearingDeg * Math.PI) / 180;

        // Convert bearing + distance to ground-plane (x, z) in meters
        const x = Math.sin(bearingRad) * groundDistance;
        const z = -Math.cos(bearingRad) * groundDistance;

        // Place on the ground plane with manual height offset
        const cameraHeight = this.cameraConfig.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT;
        const y = -cameraHeight + overrideHeight;

        const horizontalDistance = groundDistance;

        const projected = this.projector.metersToScreen(x, y, z, yaw, pitch, fov);

        if (!projected.visible) return null;

        const radius = this.projector.calculateMarkerSize(
            NAV_CONSTANTS.MARKER_WORLD_RADIUS, horizontalDistance, fov, overrideHeight
        );
        const flattenY = this.projector.calculateFlattenRatio(horizontalDistance, pitch, overrideHeight);

        return {
            id: target.id,
            screenX: projected.screenX,
            screenY: projected.screenY,
            distance: projected.distance,
            radius,
            flattenY
        };
    }

    /**
     * Projects a POI marker to screen coordinates
     * @param {Object} poi - POI object with position data
     * @param {number} yaw - Camera yaw
     * @param {number} pitch - Camera pitch
     * @param {number} fov - Camera FOV
     * @returns {Object|null} Projected marker data or null
     */
    projectPOI(poi, yaw, pitch, fov) {
        if (!poi.position) return null;

        // POIs are stored as heading/pitch/distance relative to sphere center
        const { heading, pitch: poiPitch, distance } = poi.position;

        // Convert to 3D coordinates
        const headingRad = (heading * Math.PI) / 180;
        const x = Math.sin(headingRad) * Math.cos(poiPitch) * distance;
        const y = Math.sin(poiPitch) * distance;
        const z = -Math.cos(headingRad) * Math.cos(poiPitch) * distance;

        const horizontalDistance = Math.sqrt(x * x + z * z);

        // Project to screen
        const projected = this.projector.metersToScreen(x, y, z, yaw, pitch, fov);

        if (!projected.visible) return null;

        // Use marker size directly (user-controlled, not distance-scaled)
        // Default to 12px if not set (matching DEFAULT_MARKER_360_STYLE.markerSize)
        const radius = poi.style?.markerSize || 12;
        const flattenY = this.projector.calculateFlattenRatio(horizontalDistance, pitch);

        return {
            id: poi.id,
            screenX: projected.screenX,
            screenY: projected.screenY,
            distance: projected.distance,
            radius,
            flattenY,
            style: {
                showMarker: poi.style?.showMarker,
                color: poi.style?.markerColor,
                opacity: poi.style?.markerOpacity,
                label: poi.style?.showLabel ? (poi.style.labelText || poi.properties?.nome) : null,
                showLabel: poi.style?.showLabel,
                labelStyle: {
                    color: poi.style?.labelColor,
                    backgroundColor: poi.style?.labelBackgroundColor,
                    backgroundOpacity: poi.style?.labelBackgroundOpacity,
                    size: poi.style?.labelSize
                }
            }
        };
    }

    /**
     * Handles mouse move events
     * @param {MouseEvent} event - Mouse event
     */
    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePosition = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };

        // Hit test for hover
        const hit = this.hitTester.testPoint(this.mousePosition.x, this.mousePosition.y);

        // Update cursor style via CSS class
        const container = document.getElementById('street-view-container');

        if (hit) {
            this.renderer.setHoveredMarker(hit.id);

            // Show pointer cursor when hovering markers
            if (container) {
                container.classList.add('nav-hover');
            }

        } else {
            this.renderer.setHoveredMarker(null);

            // Remove pointer cursor
            if (container) {
                container.classList.remove('nav-hover');
            }
        }

    }

    /**
     * Handles pointer down events (for drag detection)
     * @param {PointerEvent} event - Pointer event
     */
    handlePointerDown(event) {
        if (event.isPrimary === false) return;
        // Only track left-click for navigation; right-click is for camera drag only
        if (event.button !== 0) return;

        this.pointerDownPos = {
            x: event.clientX,
            y: event.clientY
        };
        this.isDragging = false;

        // Listen for move to detect drag
        const handleDragMove = (moveEvent) => {
            if (!this.pointerDownPos) return;

            const dx = moveEvent.clientX - this.pointerDownPos.x;
            const dy = moveEvent.clientY - this.pointerDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > DRAG_THRESHOLD) {
                this.isDragging = true;
            }
        };

        // Cleanup on pointer up OR cancel (touch interruption / browser gesture
        // takeover). Without pointercancel, handleDragMove leaks on the document.
        // Exposed via _activeDragCleanup so dispose() can detach an in-flight drag.
        const cleanup = () => {
            document.removeEventListener('pointermove', handleDragMove);
            document.removeEventListener('pointerup', cleanup);
            document.removeEventListener('pointercancel', cleanup);
            this._activeDragCleanup = null;
        };
        this._activeDragCleanup = cleanup;

        document.addEventListener('pointermove', handleDragMove);
        document.addEventListener('pointerup', cleanup);
        document.addEventListener('pointercancel', cleanup);
    }

    /**
     * Handles pointer up events (click detection)
     * @param {PointerEvent} event - Pointer event
     */
    handlePointerUp(event) {
        if (event.isPrimary === false) return;
        // Only handle left-click for navigation; right-click is for camera drag only
        if (event.button !== 0) return;

        // If it was a drag, don't handle as click
        if (this.isDragging) {
            this.pointerDownPos = null;
            this.isDragging = false;
            return;
        }

        // This is a click
        this.pointerDownPos = null;

        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        this.handleNavigationClick(x, y);
    }

    /**
     * Handles navigation click (after drag detection)
     * @param {number} x - Click X coordinate
     * @param {number} y - Click Y coordinate
     * @returns {Object|null} Click result with type and data
     */
    handleNavigationClick(x, y) {
        // Check for marker tool mode
        if (this.markerToolActive) {
            // Use currentYaw/currentPitch from render() which include imageHeading,
            // matching the coordinate system used for projecting POIs back to screen
            if (this.currentYaw !== undefined) {
                const spherical = this.projector.screenToSpherical(
                    x, y,
                    this.currentYaw,
                    this.currentPitch,
                    this.currentFov
                );
                // Emit event for marker creation
                getEventBus().emit(EventTypes.MARKER_360_POSITION_CLICKED, {
                    position: spherical,
                    photoName: this.cameraConfig?.img
                });
                return { type: 'new-marker', position: spherical };
            }
        }

        // Hit test
        const hit = this.hitTester.testPoint(x, y);

        if (hit) {
            if (hit.type === 'navigation') {
                // Navigation target clicked - navigate to it
                this.navigateToTarget(hit.data);
                return { type: 'navigation', target: hit.data };
            } else if (hit.type === 'poi') {
                // POI clicked - select it
                this.selectPOI(hit.id);
                getEventBus().emit(EventTypes.MARKER_360_CLICKED, {
                    marker: hit.data,
                    photoName: this.cameraConfig?.img
                });
                return { type: 'poi', poi: hit.data };
            }
        } else {
            // Clicked on empty space
            if (this.selectedPOIId) {
                this.deselectPOI();
            } else if (
                this.cursorNearestTargetId &&
                this.targets.length > 0 &&
                this.renderer.groundCursor?.arrowAngle != null
            ) {
                // Only navigate when the ground cursor is visible and has an
                // arrow pointing to a target (cursor is on the ground plane).
                // If the cursor is above the horizon, groundCursor is null.
                const nearestTarget = this.targets.find(t => t.id === this.cursorNearestTargetId);
                if (nearestTarget) {
                    this.navigateToTarget(nearestTarget);
                    return { type: 'navigation', target: nearestTarget };
                }
            }
            return null;
        }

        return null;
    }

    /**
     * Navigates to a target photo
     * @param {Object} target - Target object with img property
     */
    navigateToTarget(target) {
        import('../street_view_viewer.js')
            .then(module => module.navigateToTarget(target.img))
            .catch(error => {
                console.error('Error navigating to target photo:', error);
                showToast('Erro ao navegar para a foto', 'error');
            });
    }

    /**
     * Selects a POI marker
     * @param {string} poiId - POI ID to select
     */
    selectPOI(poiId) {
        this.selectedPOIId = poiId;
        this.renderer.setSelectedMarker(poiId);
    }

    /**
     * Deselects the current POI
     */
    deselectPOI() {
        if (this.selectedPOIId) {
            const photoName = this.cameraConfig?.img;
            this.selectedPOIId = null;
            this.renderer.setSelectedMarker(null);
            getEventBus().emit(EventTypes.MARKER_360_DESELECTED, { photoName });
        }
    }

    /**
     * Sets visibility of the navigation overlay
     * @param {boolean} visible - Whether to show the overlay
     */
    setVisible(visible) {
        if (this.renderer) {
            this.renderer.setVisible(visible);
        }
        if (this.canvas) {
            this.canvas.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Sets the marker tool active state
     * @param {boolean} active - Whether marker tool is active
     */
    setMarkerToolActive(active) {
        this.markerToolActive = active;
        // Toggle CSS class on container for crosshair cursor
        const container = document.getElementById('street-view-container');
        if (container) {
            container.classList.toggle('marker-tool-active', active);
        }
    }

    /**
     * Handles window resize
     */
    handleResize() {
        if (!this.canvas || !this.container) return;

        // Use container dimensions (accounts for sidebar offset)
        this.canvas.width = this.container.clientWidth;
        this.canvas.height = this.container.clientHeight;

        if (this.projector) {
            this.projector.resize(this.canvas.width, this.canvas.height);
        }
        if (this.renderer) {
            this.renderer.resize(this.canvas.width, this.canvas.height);
        }
    }

    /**
     * Resizes the navigation canvas
     */
    resize() {
        this.handleResize();
    }

    /**
     * Disposes of the navigator
     */
    dispose() {
        if (!this.initialized) return;

        // Detach any in-flight per-drag document listeners (drag interrupted by
        // dispose without a pointerup/pointercancel).
        if (this._activeDragCleanup) this._activeDragCleanup();

        // Remove event listeners
        this.container.removeEventListener('mousemove', this.handleMouseMove);
        this.container.removeEventListener('pointerdown', this.handlePointerDown);
        this.container.removeEventListener('pointerup', this.handlePointerUp);
        window.removeEventListener('resize', this.handleResize);

        // Dispose subcomponents
        if (this.renderer) {
            this.renderer.dispose();
        }
        if (this.minimapSync) {
            this.minimapSync.dispose();
        }

        // Remove canvas
        if (this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }

        this.initialized = false;
    }
}
