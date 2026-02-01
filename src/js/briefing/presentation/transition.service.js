// Path: js/briefing/presentation/transition.service.js

/**
 * @fileoverview Transition service for briefing presentations.
 * Handles animated transitions between slides with different viewer modes.
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
 * │ 360→360 │ Same photo: rotate camera / Different: reload      │
 * │ 3D → 360│ closeViewer() → flyTo() → openViewer360WithPhoto() │
 * │ 360→ 3D │ closeViewer360() → flyTo() → openViewerWithTileset()│
 * └─────────┴────────────────────────────────────────────────────┘
 *
 * @module briefing/presentation/transition.service
 */

import { SlideMode } from '../../store/index.js';
import { flyTo, ANIMATION_DURATION } from '../../map/animation.service.js';

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
    /** Cesium camera transition duration */
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
     *
     * @param {Object} slide - Target slide data
     * @param {Object} [options] - Transition options
     * @param {boolean} [options.instant=false] - Skip animation
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
            return true;

        } catch (error) {
            console.error('Transition error:', error);
            return false;
        } finally {
            this._isTransitioning = false;
        }
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
    // 2D MAP TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 2D to 2D (map flyTo).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition2Dto2D(slide, options) {
        if (!slide.position || slide.position.longitude === null) {
            console.warn('Slide has no position defined');
            return;
        }

        await flyTo(this._map, {
            lng: slide.position.longitude,
            lat: slide.position.latitude,
            zoom: slide.position.zoom,
            bearing: slide.orientation?.bearing || 0,
            pitch: slide.orientation?.pitch || 0,
            duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION
        });
    }

    /**
     * Transitions from 2D to 3D (flyTo then open viewer).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition2Dto3D(slide, options) {
        // First fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION / 2
            });

            if (!options.instant) {
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            }
        }

        // Open 3D viewer with model
        if (slide.modelId) {
            const viewer3d = await get3DViewerModule();
            await viewer3d.openViewerWithTileset(slide.modelId);
        }
    }

    /**
     * Transitions from 2D to 360 (flyTo then open viewer).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition2Dto360(slide, options) {
        // First fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION / 2
            });

            if (!options.instant) {
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            }
        }

        // Open 360 viewer with photo
        if (slide.photoId) {
            const viewer360 = await get360ViewerModule();
            await viewer360.openViewer360WithPhoto(slide.photoId);
        }
    }

    // =========================================================================
    // 3D VIEWER TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 3D to 2D (close viewer then flyTo).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition3Dto2D(slide, options) {
        // Close 3D viewer
        const viewer3d = await get3DViewerModule();
        viewer3d.closeViewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        // Fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION
            });
        }
    }

    /**
     * Transitions from 3D to 3D (camera movement or reload).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition3Dto3D(slide, _options) {
        const viewer3d = await get3DViewerModule();

        // If different model, close and reopen
        // For now, we always reload since we don't track current model
        // Future optimization: compare modelIds and do camera flyTo if same
        if (slide.modelId) {
            viewer3d.closeViewer();
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            await viewer3d.openViewerWithTileset(slide.modelId);
        }
    }

    /**
     * Transitions from 3D to 360 (close 3D, fly, open 360).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition3Dto360(slide, options) {
        // Close 3D viewer
        const viewer3d = await get3DViewerModule();
        viewer3d.closeViewer();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        // Fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION / 2
            });

            if (!options.instant) {
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            }
        }

        // Open 360 viewer
        if (slide.photoId) {
            const viewer360 = await get360ViewerModule();
            await viewer360.openViewer360WithPhoto(slide.photoId);
        }
    }

    // =========================================================================
    // 360 VIEWER TRANSITIONS
    // =========================================================================

    /**
     * Transitions from 360 to 2D (close viewer then flyTo).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition360to2D(slide, options) {
        // Close 360 viewer
        const viewer360 = await get360ViewerModule();
        await viewer360.closeViewer360();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        // Fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION
            });
        }
    }

    /**
     * Transitions from 360 to 3D (close 360, fly, open 3D).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition360to3D(slide, options) {
        // Close 360 viewer
        const viewer360 = await get360ViewerModule();
        await viewer360.closeViewer360();

        if (!options.instant) {
            await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
        }

        // Fly to position on 2D map
        if (slide.position && slide.position.longitude !== null) {
            await flyTo(this._map, {
                lng: slide.position.longitude,
                lat: slide.position.latitude,
                zoom: slide.position.zoom,
                bearing: slide.orientation?.bearing || 0,
                pitch: slide.orientation?.pitch || 0,
                duration: options.instant ? 0 : TRANSITION_CONFIG.MAP_FLY_DURATION / 2
            });

            if (!options.instant) {
                await delay(TRANSITION_CONFIG.VIEWER_OPEN_DELAY);
            }
        }

        // Open 3D viewer
        if (slide.modelId) {
            const viewer3d = await get3DViewerModule();
            await viewer3d.openViewerWithTileset(slide.modelId);
        }
    }

    /**
     * Transitions from 360 to 360 (same photo: rotate, different: reload).
     * @private
     * @param {Object} slide - Target slide
     * @param {Object} options - Transition options
     */
    async _transition360to360(slide, _options) {
        const viewer360 = await get360ViewerModule();
        const currentPhoto = viewer360.getCurrentPhotoName();

        // If same photo, just rotate camera
        // If different photo, navigate to target
        if (slide.photoId && slide.photoId !== currentPhoto) {
            await viewer360.navigateToTarget(slide.photoId);
        }
        // Camera rotation will be handled by the viewer's internal state
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
    }

    /**
     * Destroys the transition service.
     */
    destroy() {
        this._map = null;
        this._isTransitioning = false;
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
