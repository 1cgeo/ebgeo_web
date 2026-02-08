// Path: js/briefing/presentation/transition.service.js

/**
 * @fileoverview Transition service for briefing presentations.
 * Handles animated transitions between slides with different viewer modes.
 * Supports map switching when slides reference different maps.
 *
 * Transition Matrix:
 * ┌─────────┬────────────────────────────────────────────────────┐
 * │ From→To │ Behavior                                           │
 * ├─────────┼────────────────────────────────────────────────────┤
 * │ 2D → 2D │ flyTo() with BRIEFING_TRANSITION duration          │
 * │ 2D → 3D │ flyTo() → wait → open3DViewer(instant)              │
 * │ 2D → 360│ flyTo() → wait → open360Viewer()                   │
 * │ 3D → 2D │ close3DViewer() → flyTo()                          │
 * │ 3D → 3D │ Same model: camera.setView() / Different: reload    │
 * │ 360→ 2D │ close360Viewer() → flyTo()                         │
 * │ 360→360 │ Same marker: change photo / Different: close→fly→open │
 * │ 3D → 360│ close3DViewer() → flyTo() → open360Viewer()        │
 * │ 360→ 3D │ close360Viewer() → flyTo() → open3DViewer(instant)  │
 * └─────────┴────────────────────────────────────────────────────┘
 *
 * Viewer open/close follows the same pattern as the features panel:
 * - 3D: uses getControl('modelsViewer').openViewer() which handles
 *   container visibility (setFullMap) and close button setup.
 * - 360: uses openViewer360WithPhoto() with miniMap/controlInstance
 *   options from the streetView control.
 *
 * All transitions switch map first if needed (via setCurrentMap + switchMap).
 *
 * @module briefing/presentation/transition.service
 */

import { SlideMode, getCurrentMapNameSync, setCurrentMap } from '../../store/index.js';
import { flyTo, ANIMATION_DURATION } from '../../map/animation.service.js';
import { getControl } from '../../store/control.registry.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Transition timing configuration.
 * @type {Object}
 */
const TRANSITION_CONFIG = {
    /** Maximum map flyTo duration in milliseconds */
    MAP_FLY_DURATION: ANIMATION_DURATION.BRIEFING_TRANSITION,
    /** Minimum flyTo duration in milliseconds (for very short distances) */
    MAP_FLY_DURATION_MIN: 600,
    /** Distance threshold for minimum duration (meters) */
    DISTANCE_SHORT: 500,
    /** Distance threshold for maximum duration (meters) */
    DISTANCE_LONG: 50000,
    /** Delay before opening viewer after map animation */
    VIEWER_OPEN_DELAY: 300,
    /** Cesium camera transition duration in seconds */
    CESIUM_FLY_DURATION: 2.0,
    /** 360 camera rotation duration */
    ROTATION_360_DURATION: 1000
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Delays execution for a specified time.
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculates the Haversine distance between two points in meters.
 * @param {number} lng1 - Longitude of point 1 (degrees)
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lng2 - Longitude of point 2 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @returns {number} Distance in meters
 */
function haversineDistance(lng1, lat1, lng2, lat2) {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculates a dynamic flyTo duration based on the distance between
 * the current map center and the target position.
 * Short distances get shorter animations; long distances get the full duration.
 *
 * @param {Object} map - MapLibre map instance
 * @param {number} targetLng - Target longitude
 * @param {number} targetLat - Target latitude
 * @param {number} baseDuration - Maximum duration in milliseconds
 * @returns {number} Scaled duration in milliseconds
 */
function calculateDynamicDuration(map, targetLng, targetLat, baseDuration) {
    if (!map) return baseDuration;

    const center = map.getCenter();
    const dist = haversineDistance(center.lng, center.lat, targetLng, targetLat);

    // Below SHORT threshold → minimum duration (quick pan)
    if (dist <= TRANSITION_CONFIG.DISTANCE_SHORT) {
        return TRANSITION_CONFIG.MAP_FLY_DURATION_MIN;
    }

    // Above LONG threshold → full duration
    if (dist >= TRANSITION_CONFIG.DISTANCE_LONG) {
        return baseDuration;
    }

    // Proportional scaling with sqrt for perceptual smoothness
    // sqrt makes medium distances feel proportionally faster
    const t = (dist - TRANSITION_CONFIG.DISTANCE_SHORT) /
              (TRANSITION_CONFIG.DISTANCE_LONG - TRANSITION_CONFIG.DISTANCE_SHORT);
    const scaled = TRANSITION_CONFIG.MAP_FLY_DURATION_MIN +
                   Math.sqrt(t) * (baseDuration - TRANSITION_CONFIG.MAP_FLY_DURATION_MIN);

    return Math.round(scaled);
}

/**
 * Safely imports and gets 3D viewer functions.
 * @returns {Promise<Object>} 3D viewer module
 */
async function get3DViewerModule() {
    return await import('../../3d_models_viewer_tool/map_3d.js');
}

/**
 * Safely imports and gets 360 viewer functions.
 * @returns {Promise<Object>} 360 viewer module
 */
async function get360ViewerModule() {
    return await import('../../street_view_tool/street_view_viewer.js');
}

/**
 * Opens the 3D viewer for a tileset using the registered control.
 * Follows the same pattern as the features panel (models3d-section).
 * The control handles container visibility (setFullMap) and close button.
 * @param {string} tilesetId - Tileset ID to open
 * @param {Object} [options] - Options forwarded to the viewer
 * @param {boolean} [options.skipCameraAnimation=false] - Skip Cesium camera flyTo
 */
async function open3DViewer(tilesetId, options = {}) {
    const modelsViewerControl = getControl('modelsViewer');
    if (modelsViewerControl) {
        await modelsViewerControl.openViewer(tilesetId, options);
    } else {
        // Fallback: directly import (may not show container properly)
        console.warn('modelsViewerControl not found, using fallback');
        const viewer3d = await get3DViewerModule();
        await viewer3d.openViewerWithTileset(tilesetId, options);
    }
}

/**
 * Closes the 3D viewer using the registered control.
 * The control handles container visibility (setFullMap) and close button.
 */
async function close3DViewer() {
    const modelsViewerControl = getControl('modelsViewer');
    if (modelsViewerControl) {
        await modelsViewerControl.closeViewer();
    } else {
        // Fallback: directly import
        const viewer3d = await get3DViewerModule();
        viewer3d.closeViewer();
    }
}

/**
 * Opens the 360 viewer with a photo.
 * Passes miniMap and controlInstance from the streetView control
 * (same pattern as streetview360-section.component).
 * @param {string} photoId - Photo name to open
 */
async function open360Viewer(photoId) {
    const viewer360 = await get360ViewerModule();
    const streetViewControl = getControl('streetView');
    await viewer360.openViewer360WithPhoto(photoId, {
        miniMap: streetViewControl?.miniMap,
        controlInstance: streetViewControl
    });
}

/**
 * Closes the 360 viewer.
 * closeViewer360 handles its own cleanup (container visibility, class removal).
 */
async function close360Viewer() {
    const viewer360 = await get360ViewerModule();
    await viewer360.closeViewer360();
}


// ============================================================================
// TRANSITION SERVICE
// ============================================================================

/**
 * Transition service for briefing presentations.
 * Handles transitions between slides with different viewer modes.
 */
class TransitionService {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this._map = map;
        this._isTransitioning = false;
        this._currentViewerMode = SlideMode.MAP_2D;
        this._currentModelId = null;
        this._currentMapId = null;
    }

    /**
     * Gets the current viewer mode.
     * @returns {string}
     */
    getCurrentViewerMode() {
        return this._currentViewerMode;
    }

    /**
     * Checks if a transition is in progress.
     * @returns {boolean}
     */
    isTransitioning() {
        return this._isTransitioning;
    }

    /**
     * Transitions to a slide.
     * Handles all combinations of viewer modes (2D, 3D, 360).
     * Switches map if the slide references a different map.
     *
     * @param {Object} slide - Target slide data
     * @param {Object} [options] - Transition options
     * @param {boolean} [options.instant=false] - Skip animation (used for backward navigation)
     * @returns {Promise<boolean>} True if transition completed
     */
    async transitionToSlide(slide, options = {}) {
        // Cancel any ongoing map animation from a previous transition
        if (this._map) {
            this._map.stop();
        }

        if (!slide) {
            console.warn('No slide provided for transition');
            return false;
        }

        this._isTransitioning = true;

        try {
            // Switch map if needed (before any viewer transition)
            await this._switchMapIfNeeded(slide);

            const fromMode = this._currentViewerMode;
            const toMode = slide.mode || SlideMode.MAP_2D;

            // Get transition handler based on from/to modes
            const transitionFn = this._getTransitionHandler(fromMode, toMode);

            if (transitionFn) {
                await transitionFn.call(this, slide, options);
            } else {
                console.warn(`No transition handler for ${fromMode} → ${toMode}`);
            }

            this._currentViewerMode = toMode;

            // Track current model for 3D optimization
            if (toMode === SlideMode.VIEWER_3D) {
                this._currentModelId = slide.modelId;
            } else {
                this._currentModelId = null;
            }

            return true;

        } catch (error) {
            console.error('Transition error:', error);
            return false;
        } finally {
            this._isTransitioning = false;
        }
    }

    /**
     * Switches the active map if the slide's mapId differs from the current map.
     * @private
     * @param {Object} slide - Target slide
     */
    async _switchMapIfNeeded(slide) {
        if (!slide.mapId) return;

        const currentMap = getCurrentMapNameSync();

        if (currentMap === slide.mapId) return;

        await setCurrentMap(slide.mapId);
        const baseLayerControl = getControl('BaseLayerControl');
        if (baseLayerControl) {
            // false = don't apply saved map position (briefing controls position)
            await baseLayerControl.switchMap(false);
        }

        this._currentMapId = slide.mapId;
    }

    /**
     * Gets the appropriate transition handler for mode combination.
     * @private
     * @param {string} fromMode - Current mode
     * @param {string} toMode - Target mode
     * @returns {Function|null}
     */
    _getTransitionHandler(fromMode, toMode) {
        const handlers = {
            [`${SlideMode.MAP_2D}->${SlideMode.MAP_2D}`]: this._transition2Dto2D,
            [`${SlideMode.MAP_2D}->${SlideMode.VIEWER_3D}`]: this._transition2Dto3D,
            [`${SlideMode.MAP_2D}->${SlideMode.VIEWER_360}`]: this._transition2Dto360,
            [`${SlideMode.VIEWER_3D}->${SlideMode.MAP_2D}`]: this._transition3Dto2D,
            [`${SlideMode.VIEWER_3D}->${SlideMode.VIEWER_3D}`]: this._transition3Dto3D,
            [`${SlideMode.VIEWER_3D}->${SlideMode.VIEWER_360}`]: this._transition3Dto360,
            [`${SlideMode.VIEWER_360}->${SlideMode.MAP_2D}`]: this._transition360to2D,
            [`${SlideMode.VIEWER_360}->${SlideMode.VIEWER_3D}`]: this._transition360to3D,
            [`${SlideMode.VIEWER_360}->${SlideMode.VIEWER_360}`]: this._transition360to360
        };

        return handlers[`${fromMode}->${toMode}`] || null;
    }

    // =========================================================================
    // SHARED HELPERS
    // =========================================================================

    /**
     * Performs a 2D map flyTo for the given slide.
     * Duration is dynamic: scales based on distance between current position and target.
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     * @param {number} [durationMultiplier=1] - Duration multiplier (0.5 for half-speed)
     */
    async _flyTo2D(slide, options, durationMultiplier = 1) {
        if (!slide.position || slide.position.longitude === null) return;

        const targetZoom = slide.position.zoom ?? this._map.getZoom();
        const baseDuration = TRANSITION_CONFIG.MAP_FLY_DURATION * durationMultiplier;

        // Scale duration proportionally to the distance
        const duration = options.instant
            ? 0
            : calculateDynamicDuration(
                this._map,
                slide.position.longitude,
                slide.position.latitude,
                baseDuration
            );

        await flyTo(this._map, {
            lng: slide.position.longitude,
            lat: slide.position.latitude,
            zoom: targetZoom,
            bearing: slide.orientation?.bearing || 0,
            pitch: slide.orientation?.pitch || 0,
            duration,
            // Shallow arc: almost lateral movement, minimal zoom-out
            curve: 0.5,
            // Never zoom out more than 1 level below the target during animation
            minZoom: Math.max(targetZoom - 1, 0)
        });
    }

    /**
     * Restores 360 camera orientation after opening the viewer.
     * @private
     * @param {Object} slide - Target slide (with orientation.lon/lat/fov)
     */
    async _restore360CameraOrientation(slide) {
        if (slide.orientation?.lon == null && slide.orientation?.lat == null) return;

        try {
            const viewer360 = await get360ViewerModule();
            if (slide.orientation.lon != null && slide.orientation.lat != null) {
                viewer360.setCameraRotation(slide.orientation.lon, slide.orientation.lat);
            }
            if (slide.orientation.fov != null) {
                viewer360.setCameraFOV(slide.orientation.fov);
            }
        } catch (error) {
            console.warn('Failed to restore 360 camera orientation:', error);
        }
    }

    /**
     * Ensures viewer markers are active on the 2D map before opening a viewer.
     * Calls activate() on the corresponding control if not already active.
     * @private
     * @param {string} mode - Target slide mode (SlideMode.VIEWER_3D or SlideMode.VIEWER_360)
     */
    async _ensureViewerMarkersActive(mode) {
        try {
            if (mode === SlideMode.VIEWER_3D) {
                const ctrl = getControl('modelsViewer');
                if (ctrl && !ctrl.isActive) {
                    await ctrl.activate();
                }
            } else if (mode === SlideMode.VIEWER_360) {
                const ctrl = getControl('streetView');
                if (ctrl && !ctrl.isActive) {
                    await ctrl.activate();
                }
            }

            // Sync bottom-controls toggle buttons to reflect the new state
            const bottomControls = getControl('bottomControls');
            if (bottomControls) {
                bottomControls.syncStates();
            }
        } catch (error) {
            console.warn('Failed to activate viewer markers:', error);
        }
    }

    // =========================================================================
    // 2D MAP TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 2D to 2D (map flyTo).
     * @private
     */
    async _transition2Dto2D(slide, options) {
        await this._flyTo2D(slide, options);
    }

    /**
     * Transitions from 2D to 3D (flyTo then open viewer).
     * Cesium opens directly at the target location without camera animation.
     * @private
     */
    async _transition2Dto3D(slide, options) {
        await this._ensureViewerMarkersActive(SlideMode.VIEWER_3D);
        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.modelId) {
            await open3DViewer(slide.modelId, { skipCameraAnimation: true });
        }
    }

    /**
     * Transitions from 2D to 360 (flyTo then open viewer).
     * @private
     */
    async _transition2Dto360(slide, options) {
        await this._ensureViewerMarkersActive(SlideMode.VIEWER_360);
        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.photoId) {
            await open360Viewer(slide.photoId);
            await this._restore360CameraOrientation(slide);
        }
    }

    // =========================================================================
    // 3D VIEWER TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 3D to 2D (close viewer then flyTo).
     * @private
     */
    async _transition3Dto2D(slide, options) {
        await close3DViewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options);
    }

    /**
     * Transitions from 3D to 3D.
     * Same model: instant camera setView. Different model: close and reopen.
     * During briefing presentations, Cesium camera always jumps instantly.
     * @private
     */
    async _transition3Dto3D(slide, _options) {
        if (slide.modelId === this._currentModelId && slide.modelId) {
            // Same model: use instant Cesium camera positioning (no flyTo animation)
            try {
                const viewer3d = await get3DViewerModule();
                const cesiumViewer = viewer3d.getCesiumViewer?.();
                const Cesium = window.Cesium;
                if (cesiumViewer && Cesium && slide.position?.longitude != null) {
                    cesiumViewer.camera.setView({
                        destination: Cesium.Cartesian3.fromDegrees(
                            slide.position.longitude,
                            slide.position.latitude,
                            slide.position.altitude || 1000
                        ),
                        orientation: {
                            heading: Cesium.Math.toRadians(slide.orientation?.heading || 0),
                            pitch: Cesium.Math.toRadians(slide.orientation?.pitch || -30),
                            roll: 0
                        }
                    });
                }
            } catch (error) {
                // Fallback: close and reopen
                console.warn('Cesium setView failed, falling back to reload:', error);
                await close3DViewer();
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                await open3DViewer(slide.modelId, { skipCameraAnimation: true });
            }
        } else if (slide.modelId) {
            // Different model: close and reopen
            await close3DViewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            await open3DViewer(slide.modelId, { skipCameraAnimation: true });
        }
    }

    /**
     * Transitions from 3D to 360 (close 3D, fly, open 360).
     * @private
     */
    async _transition3Dto360(slide, options) {
        await close3DViewer();
        await this._ensureViewerMarkersActive(SlideMode.VIEWER_360);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.photoId) {
            await open360Viewer(slide.photoId);
            await this._restore360CameraOrientation(slide);
        }
    }

    // =========================================================================
    // 360 VIEWER TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 360 to 2D (close viewer then flyTo).
     * @private
     */
    async _transition360to2D(slide, options) {
        await close360Viewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options);
    }

    /**
     * Transitions from 360 to 3D (close 360, fly, open 3D).
     * Cesium opens directly at the target location without camera animation.
     * @private
     */
    async _transition360to3D(slide, options) {
        await close360Viewer();
        await this._ensureViewerMarkersActive(SlideMode.VIEWER_3D);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.modelId) {
            await open3DViewer(slide.modelId, { skipCameraAnimation: true });
        }
    }

    /**
     * Transitions from 360 to 360.
     * Same marker (photo): just change photo + restore camera.
     * Different markers: close, flyTo, reopen.
     * @private
     */
    async _transition360to360(slide, options) {
        const viewer360 = await get360ViewerModule();
        const currentPhoto = viewer360.getCurrentPhotoName();

        if (slide.photoId && slide.photoId !== currentPhoto) {
            // Check if the geographic position differs (different marker location)
            const currentGeo = await viewer360.getCurrentPhotoGeoPosition();
            const targetLng = slide.position?.longitude;
            const targetLat = slide.position?.latitude;

            const isNearby = currentGeo && targetLng != null && targetLat != null &&
                Math.abs(currentGeo.longitude - targetLng) < 0.0001 &&
                Math.abs(currentGeo.latitude - targetLat) < 0.0001;

            if (isNearby) {
                // Same marker location, different photo: navigate within viewer
                await viewer360.navigateToTarget(slide.photoId);
            } else {
                // Different marker: close, flyTo, reopen
                await close360Viewer();

                if (!options.instant) {
                    await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                }

                await this._flyTo2D(slide, options, 0.5);

                if (!options.instant) {
                    await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                }

                await open360Viewer(slide.photoId);
            }
        }

        // Restore camera orientation for the target slide
        await this._restore360CameraOrientation(slide);
    }

    // =========================================================================
    // EDITOR-ONLY: INSTANT TRANSITIONS (no flyTo)
    // =========================================================================

    /**
     * Transitions to a slide instantly, without flyTo animations.
     * Used by the editor: jumpTo for 2D position, open/close viewers as needed.
     * Switches map if needed (reloads features).
     *
     * @param {Object} slide - Target slide data
     * @returns {Promise<boolean>} True if transition completed
     */
    async transitionToSlideInstant(slide) {
        if (this._isTransitioning) {
            console.warn('Transition already in progress');
            return false;
        }

        if (!slide) {
            console.warn('No slide provided for transition');
            return false;
        }

        this._isTransitioning = true;

        try {
            // Switch map if needed (before any viewer transition)
            await this._switchMapIfNeeded(slide);

            const fromMode = this._currentViewerMode;
            const toMode = slide.mode || SlideMode.MAP_2D;

            // Handle 360→360 transitions (same marker = change photo, different = close→open)
            if (fromMode === SlideMode.VIEWER_360 && toMode === SlideMode.VIEWER_360) {
                await this._instantTransition360to360(slide);
            } else {
                // Close current viewer if changing mode or switching 3D models
                const needsClose = fromMode !== toMode ||
                    (fromMode === SlideMode.VIEWER_3D && slide.modelId !== this._currentModelId);

                if (needsClose) {
                    await this._closeCurrentViewer(fromMode);
                }

                // Open target viewer if mode changed or it was closed above
                if (needsClose || fromMode !== toMode) {
                    await this._openTargetViewer(toMode, slide);
                }
            }

            // Jump to 2D position (no animation) to position the underlying map
            if (slide.position?.longitude != null) {
                this._jumpTo2D(slide);
            }

            this._currentViewerMode = toMode;

            // Track current model for 3D optimization
            if (toMode === SlideMode.VIEWER_3D) {
                this._currentModelId = slide.modelId;
            } else {
                this._currentModelId = null;
            }

            return true;

        } catch (error) {
            console.error('Instant transition error:', error);
            return false;
        } finally {
            this._isTransitioning = false;
        }
    }

    /**
     * Handles 360→360 instant transition.
     * Same marker: change photo. Different marker: close→open.
     * @private
     * @param {Object} slide - Target slide
     */
    async _instantTransition360to360(slide) {
        if (!slide.photoId) return;

        const viewer360 = await get360ViewerModule();
        const currentPhoto = viewer360.getCurrentPhotoName();

        if (slide.photoId === currentPhoto) {
            // Same photo, just restore camera
            await this._restore360CameraOrientation(slide);
            return;
        }

        // Check if nearby (same marker location)
        const currentGeo = await viewer360.getCurrentPhotoGeoPosition();
        const targetLng = slide.position?.longitude;
        const targetLat = slide.position?.latitude;

        const isNearby = currentGeo && targetLng != null && targetLat != null &&
            Math.abs(currentGeo.longitude - targetLng) < 0.0001 &&
            Math.abs(currentGeo.latitude - targetLat) < 0.0001;

        if (isNearby) {
            // Same marker, navigate to different photo within viewer
            await viewer360.navigateToTarget(slide.photoId);
        } else {
            // Different marker: close, reopen
            await close360Viewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            await open360Viewer(slide.photoId);
        }

        await this._restore360CameraOrientation(slide);
    }

    /**
     * Instantly positions the 2D map without animation.
     * @private
     * @param {Object} slide - Target slide
     */
    _jumpTo2D(slide) {
        if (!this._map || !slide.position || slide.position.longitude == null) return;

        this._map.jumpTo({
            center: [slide.position.longitude, slide.position.latitude],
            zoom: slide.position.zoom ?? this._map.getZoom(),
            bearing: slide.orientation?.bearing || 0,
            pitch: slide.orientation?.pitch || 0
        });
    }

    /**
     * Closes the current viewer based on mode.
     * Uses registered controls for proper container management.
     * @private
     * @param {string} mode - Current viewer mode to close
     */
    async _closeCurrentViewer(mode) {
        if (mode === SlideMode.VIEWER_3D) {
            await close3DViewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        } else if (mode === SlideMode.VIEWER_360) {
            await close360Viewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }
    }

    /**
     * Opens the target viewer for the slide.
     * Uses registered controls for proper container management.
     * Camera animation is skipped for instant positioning.
     * @private
     * @param {string} toMode - Target viewer mode
     * @param {Object} slide - Target slide
     */
    async _openTargetViewer(toMode, slide) {
        if (toMode === SlideMode.VIEWER_3D && slide.modelId) {
            await open3DViewer(slide.modelId, { skipCameraAnimation: true });
        } else if (toMode === SlideMode.VIEWER_360 && slide.photoId) {
            await open360Viewer(slide.photoId);
            await this._restore360CameraOrientation(slide);
        }
    }

    /**
     * Resets to 2D map mode.
     * Closes any open viewer using registered controls.
     */
    async resetTo2D() {
        if (this._currentViewerMode === SlideMode.VIEWER_3D) {
            await close3DViewer();
        } else if (this._currentViewerMode === SlideMode.VIEWER_360) {
            await close360Viewer();
        }

        this._currentViewerMode = SlideMode.MAP_2D;
        this._currentModelId = null;
    }

    /**
     * Destroys the transition service.
     */
    destroy() {
        this._map = null;
        this._isTransitioning = false;
        this._currentModelId = null;
        this._currentMapId = null;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a new transition service instance.
 * @param {Object} map - MapLibre map instance
 * @returns {TransitionService}
 */
export function createTransitionService(map) {
    return new TransitionService(map);
}

export default TransitionService;
