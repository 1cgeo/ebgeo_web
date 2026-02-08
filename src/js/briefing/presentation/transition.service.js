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
 * │ 2D → 3D │ flyTo() → wait → openViewerWithTileset()           │
 * │ 2D → 360│ flyTo() → wait → openViewer360WithPhoto()          │
 * │ 3D → 2D │ closeViewer() → flyTo()                            │
 * │ 3D → 3D │ Same model: camera.flyTo() / Different: reload     │
 * │ 360→ 2D │ closeViewer360() → flyTo()                         │
 * │ 360→360 │ Same marker: change photo / Different: close→fly→open │
 * │ 3D → 360│ closeViewer() → flyTo() → openViewer360WithPhoto() │
 * │ 360→ 3D │ closeViewer360() → flyTo() → openViewerWithTileset()│
 * └─────────┴────────────────────────────────────────────────────┘
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
    /** Map flyTo duration in milliseconds */
    MAP_FLY_DURATION: ANIMATION_DURATION.BRIEFING_TRANSITION,
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
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     * @param {number} [durationMultiplier=1] - Duration multiplier (0.5 for half-speed)
     */
    async _flyTo2D(slide, options, durationMultiplier = 1) {
        if (!slide.position || slide.position.longitude === null) return;

        await flyTo(this._map, {
            lng: slide.position.longitude,
            lat: slide.position.latitude,
            zoom: slide.position.zoom,
            bearing: slide.orientation?.bearing || 0,
            pitch: slide.orientation?.pitch || 0,
            duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION * durationMultiplier
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
     * @private
     */
    async _transition2Dto3D(slide, options) {
        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.modelId) {
            const viewer3d = await get3DViewerModule();
            await viewer3d.openViewerWithTileset(slide.modelId);
        }
    }

    /**
     * Transitions from 2D to 360 (flyTo then open viewer).
     * @private
     */
    async _transition2Dto360(slide, options) {
        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.photoId) {
            const viewer360 = await get360ViewerModule();
            await viewer360.openViewer360WithPhoto(slide.photoId);
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
        const viewer3d = await get3DViewerModule();
        viewer3d.closeViewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options);
    }

    /**
     * Transitions from 3D to 3D.
     * Same model: Cesium camera flyTo. Different model: close and reopen.
     * @private
     */
    async _transition3Dto3D(slide, options) {
        const viewer3d = await get3DViewerModule();

        if (slide.modelId === this._currentModelId && slide.modelId) {
            // Same model: use Cesium camera flyTo
            try {
                const cesiumViewer = viewer3d.getCesiumViewer?.();
                const Cesium = window.Cesium;
                if (cesiumViewer && Cesium && slide.position?.longitude != null) {
                    cesiumViewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(
                            slide.position.longitude,
                            slide.position.latitude,
                            slide.position.altitude || 1000
                        ),
                        orientation: {
                            heading: Cesium.Math.toRadians(slide.orientation?.heading || 0),
                            pitch: Cesium.Math.toRadians(slide.orientation?.pitch || -30),
                            roll: 0
                        },
                        duration: options.instant ? 0 : TRANSITION_CONFIG.CESIUM_FLY_DURATION
                    });

                    if (!options.instant) {
                        await delay(TRANSITION_CONFIG.CESIUM_FLY_DURATION * 1000);
                    }
                }
            } catch (error) {
                // Fallback: close and reopen
                console.warn('Cesium flyTo failed, falling back to reload:', error);
                viewer3d.closeViewer();
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                await viewer3d.openViewerWithTileset(slide.modelId);
            }
        } else if (slide.modelId) {
            // Different model: close and reopen
            viewer3d.closeViewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            await viewer3d.openViewerWithTileset(slide.modelId);
        }
    }

    /**
     * Transitions from 3D to 360 (close 3D, fly, open 360).
     * @private
     */
    async _transition3Dto360(slide, options) {
        const viewer3d = await get3DViewerModule();
        viewer3d.closeViewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.photoId) {
            const viewer360 = await get360ViewerModule();
            await viewer360.openViewer360WithPhoto(slide.photoId);
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
        const viewer360 = await get360ViewerModule();
        await viewer360.closeViewer360();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options);
    }

    /**
     * Transitions from 360 to 3D (close 360, fly, open 3D).
     * @private
     */
    async _transition360to3D(slide, options) {
        const viewer360 = await get360ViewerModule();
        await viewer360.closeViewer360();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        await this._flyTo2D(slide, options, 0.5);

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        if (slide.modelId) {
            const viewer3d = await get3DViewerModule();
            await viewer3d.openViewerWithTileset(slide.modelId);
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
                await viewer360.closeViewer360();

                if (!options.instant) {
                    await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                }

                await this._flyTo2D(slide, options, 0.5);

                if (!options.instant) {
                    await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
                }

                await viewer360.openViewer360WithPhoto(slide.photoId);
            }
        }

        // Restore camera orientation for the target slide
        await this._restore360CameraOrientation(slide);
    }

    /**
     * Resets to 2D map mode.
     * Closes any open viewer.
     */
    async resetTo2D() {
        if (this._currentViewerMode === SlideMode.VIEWER_3D) {
            const viewer3d = await get3DViewerModule();
            viewer3d.closeViewer();
        } else if (this._currentViewerMode === SlideMode.VIEWER_360) {
            const viewer360 = await get360ViewerModule();
            await viewer360.closeViewer360();
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
