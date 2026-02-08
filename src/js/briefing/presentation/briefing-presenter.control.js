// Path: js/briefing/presentation/briefing-presenter.control.js

/**
 * @fileoverview Main briefing presenter control.
 * Orchestrates the presentation mode for briefings.
 *
 * Features:
 * - Full presentation lifecycle management
 * - Slide transitions with animation (forward) / instant (backward)
 * - Right-side panel with integrated slide content and navigation
 * - Keyboard shortcuts
 * - Fullscreen support
 * - Temporary map locking (non-persisted)
 *
 * @module briefing/presentation/briefing-presenter.control
 */

import {
    setupCleanup,
    addDomListener,
    cleanup
} from '../../utilities/event-cleanup.js';
import {
    getBriefingById,
    SlideMode,
    setBriefingLockOverride
} from '../../store/index.js';
import { getControl } from '../../store/control.registry.js';
import { EventTypes } from '../../events/event_types.js';
import { getEventBus } from '../../store/services.js';
import { showError, showWarning } from '../../utilities/index.js';
import { isViewer3DOpen } from '../../utilities/viewer3d-state.js';
import { isStreetView360Open } from '../../utilities/streetview360-state.js';
import {
    getApplicationModeManager,
    ApplicationMode
} from '../../mode/application-mode.manager.js';
import {
    getUIVisibilityController,
    VisibilityProfile
} from '../../ui/ui-visibility.controller.js';
import {
    setKeyboardCallbacksBriefing,
    activateKeyboardServiceBriefing,
    deactivateKeyboardServiceBriefing
} from '../services/keyboard-service-briefing.js';
import { createTransitionService } from './transition.service.js';
import { createPresentationTextPanel } from '../components/presentation-text-panel.js';
import { createTilePreloader } from './tile-preloader.js';

// ============================================================================
// BRIEFING PRESENTER CONTROL
// ============================================================================

/**
 * Briefing presenter control class.
 * Manages the presentation mode for briefings with right-side panel.
 */
export class BriefingPresenterControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.map - MapLibre map instance
     * @param {Object} [dependencies.eventBus] - EventBus instance
     */
    constructor(dependencies = {}) {
        this._map = dependencies.map;
        this._eventBus = dependencies.eventBus || getEventBus();

        // State
        this._briefing = null;
        this._currentSlideIndex = -1;
        this._isPresenting = false;
        this._isFullscreen = false;
        this._isTransitioning = false;

        // Pre-presentation state snapshot (restored on exit)
        this._savedViewerStates = null;

        // Services
        this._transitionService = null;
        this._tilePreloader = null;

        // Components
        this._textPanel = null;

        // Callbacks
        this._onExit = null;

        setupCleanup(this);
    }

    /**
     * Sets callback for when presentation exits.
     * @param {Function} callback - Callback function
     */
    setOnExit(callback) {
        this._onExit = callback;
    }

    /**
     * Starts the presentation for a briefing.
     * @param {string} briefingId - Briefing ID to present
     * @returns {Promise<boolean>} True if presentation started
     */
    async start(briefingId) {
        if (this._isPresenting) {
            await this.exit();
        }

        try {
            // Snapshot current viewer states so we can restore on exit
            this._saveViewerStates();

            // Close 3D and 360 viewers if open before starting
            await this._closeActiveViewers();

            // Load briefing
            this._briefing = await getBriefingById(briefingId);
            if (!this._briefing) {
                showError('Briefing não encontrado');
                return false;
            }

            // Validate briefing has slides
            if (!this._briefing.slides || this._briefing.slides.length === 0) {
                showWarning('Briefing não possui slides');
                return false;
            }

            // Validate slides have positions
            const slidesWithoutPosition = this._briefing.slides.filter(
                s => !s.position || s.position.longitude === null
            );
            if (slidesWithoutPosition.length > 0) {
                showWarning(`${slidesWithoutPosition.length} slide(s) sem posição definida`);
            }

            // Activate temporary lock on all maps (non-persisted)
            setBriefingLockOverride(true);

            // Enter presentation mode
            const modeManager = getApplicationModeManager();
            modeManager.enterMode(ApplicationMode.BRIEFING_PRESENT, {
                briefingId: this._briefing.id
            });

            // Apply visibility profile (sidebar hidden in present mode)
            const visibilityController = getUIVisibilityController();
            visibilityController.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);

            // Offset map/3D/360 containers so the panel doesn't overlap them
            document.body.classList.add('briefing-panel-active');

            // Create transition service
            this._transitionService = createTransitionService(this._map);

            // Create UI components (panel with integrated controls)
            this._createComponents();

            // Setup keyboard shortcuts
            this._setupKeyboardShortcuts();

            // Setup fullscreen listeners
            this._setupFullscreenListeners();

            // MapLibre needs a resize to fill the new available space
            if (this._map) {
                setTimeout(() => this._map.resize(), 50);
            }

            // Mark as presenting
            this._isPresenting = true;
            this._currentSlideIndex = -1;

            // Preload tiles for all slide positions (improves flyTo transitions)
            await this._preloadSlideTiles();

            // Go to first slide
            await this._goToSlide(0);

            // Emit event
            this._eventBus.emit(EventTypes.BRIEFING_PRESENT_STARTED, {
                briefingId: this._briefing.id
            });

            return true;

        } catch (error) {
            console.error('Error starting presentation:', error);
            showError('Erro ao iniciar apresentação');
            await this.exit();
            return false;
        }
    }

    /**
     * Exits the presentation.
     */
    async exit() {
        if (!this._isPresenting) return;

        // Exit fullscreen if active
        if (this._isFullscreen) {
            await this._exitFullscreen();
        }

        // Deactivate keyboard shortcuts
        deactivateKeyboardServiceBriefing();

        // Reset transition service to 2D (closes any open 3D/360 viewers)
        if (this._transitionService) {
            await this._transitionService.resetTo2D();
            this._transitionService.destroy();
            this._transitionService = null;
        }

        // Restore viewer control states to pre-presentation snapshot
        // (deactivates markers that were activated during presentation)
        await this._restoreViewerStates();

        // Destroy tile preloader (restores original flyTo)
        if (this._tilePreloader) {
            this._tilePreloader.destroy();
            this._tilePreloader = null;
        }

        // Destroy text panel (includes integrated controls)
        if (this._textPanel) {
            this._textPanel.destroy();
            this._textPanel = null;
        }

        // Remove layout offset from map/3D/360 containers
        document.body.classList.remove('briefing-panel-active');

        // MapLibre needs a resize to fill the restored space
        if (this._map) {
            setTimeout(() => this._map.resize(), 50);
        }

        // Restore visibility profile
        const visibilityController = getUIVisibilityController();
        visibilityController.applyProfile(VisibilityProfile.NORMAL);

        // Exit application mode
        const modeManager = getApplicationModeManager();
        modeManager.exitMode();

        // Release temporary lock
        setBriefingLockOverride(false);

        // Emit event
        if (this._briefing) {
            this._eventBus.emit(EventTypes.BRIEFING_PRESENT_ENDED, {
                briefingId: this._briefing.id
            });
        }

        // Cleanup
        cleanup(this);
        this._briefing = null;
        this._currentSlideIndex = -1;
        this._isPresenting = false;
        this._isTransitioning = false;
        this._savedViewerStates = null;

        // Call exit callback
        if (this._onExit) {
            this._onExit();
        }
    }

    /**
     * Navigates to the next slide.
     * If a transition is in progress, finishes it instead of advancing.
     */
    async nextSlide() {
        if (!this._isPresenting || !this._briefing) return;
        if (this._isTransitioning) { this._finishCurrentTransition(); return; }

        const nextIndex = this._currentSlideIndex + 1;
        if (nextIndex < this._briefing.slides.length) {
            await this._goToSlide(nextIndex);
        }
    }

    /**
     * Navigates to the previous slide.
     * If a transition is in progress, finishes it instead of going back.
     */
    async previousSlide() {
        if (!this._isPresenting || !this._briefing) return;
        if (this._isTransitioning) { this._finishCurrentTransition(); return; }

        const prevIndex = this._currentSlideIndex - 1;
        if (prevIndex >= 0) {
            await this._goToSlide(prevIndex);
        }
    }

    /**
     * Navigates to the first slide.
     * If a transition is in progress, finishes it instead of jumping.
     */
    async firstSlide() {
        if (!this._isPresenting || !this._briefing) return;
        if (this._isTransitioning) { this._finishCurrentTransition(); return; }
        await this._goToSlide(0, { forceInstant: true });
    }

    /**
     * Navigates to the last slide.
     * If a transition is in progress, finishes it instead of jumping.
     */
    async lastSlide() {
        if (!this._isPresenting || !this._briefing) return;
        if (this._isTransitioning) { this._finishCurrentTransition(); return; }

        const lastIndex = this._briefing.slides.length - 1;
        if (lastIndex >= 0) {
            await this._goToSlide(lastIndex, { forceInstant: true });
        }
    }

    /**
     * Navigates to a specific slide.
     * If a transition is in progress, finishes it instead of jumping.
     * @param {number} index - Slide index (0-based)
     */
    async goToSlide(index) {
        if (!this._isPresenting || !this._briefing) return;
        if (this._isTransitioning) { this._finishCurrentTransition(); return; }

        if (index >= 0 && index < this._briefing.slides.length) {
            await this._goToSlide(index);
        }
    }

    /**
     * Toggles fullscreen mode.
     */
    async toggleFullscreen() {
        if (this._isFullscreen) {
            await this._exitFullscreen();
        } else {
            await this._enterFullscreen();
        }
    }

    /**
     * Toggles text panel visibility.
     * Also toggles the body layout offset so the map expands when panel is hidden.
     */
    toggleTextPanel() {
        if (this._textPanel) {
            this._textPanel.toggle();
            // Sync body class with panel visibility
            document.body.classList.toggle('briefing-panel-active', this._textPanel.isVisible());
            // MapLibre needs a resize to fill the new available space
            if (this._map) {
                setTimeout(() => this._map.resize(), 50);
            }
        }
    }

    /**
     * Checks if currently presenting.
     * @returns {boolean}
     */
    isPresenting() {
        return this._isPresenting;
    }

    /**
     * Gets the current slide index.
     * @returns {number}
     */
    getCurrentSlideIndex() {
        return this._currentSlideIndex;
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    /**
     * Saves the current viewer/control state before starting the presentation.
     * Stored so we can restore exactly the same state on exit.
     * @private
     */
    _saveViewerStates() {
        const modelsViewer = getControl('modelsViewer');
        const streetView = getControl('streetView');

        this._savedViewerStates = {
            models3dActive: modelsViewer?.isActive || false,
            panoramaActive: streetView?.isActive || false
        };
    }

    /**
     * Restores the viewer/control state that existed before presentation started.
     * Deactivates controls that were not originally active (removes markers from map).
     * @private
     */
    async _restoreViewerStates() {
        if (!this._savedViewerStates) return;

        const modelsViewer = getControl('modelsViewer');
        const streetView = getControl('streetView');

        // Deactivate 3D markers if they weren't active before presentation
        if (!this._savedViewerStates.models3dActive && modelsViewer?.isActive) {
            modelsViewer.deactivate();
        }

        // Deactivate 360 markers if they weren't active before presentation
        if (!this._savedViewerStates.panoramaActive && streetView?.isActive) {
            streetView.deactivate();
        }

        // Sync bottom-controls toggles to reflect restored state
        const bottomControls = getControl('bottomControls');
        if (bottomControls) {
            bottomControls.syncStates();
        }

        this._savedViewerStates = null;
    }

    /**
     * Closes any active 3D or 360 viewers before starting presentation.
     * @private
     */
    async _closeActiveViewers() {
        try {
            if (isViewer3DOpen()) {
                const { closeViewer } = await import('../../3d_models_viewer_tool/map_3d.js');
                await closeViewer();
            }

            if (isStreetView360Open()) {
                const { closeViewer360 } = await import('../../street_view_tool/street_view_viewer.js');
                await closeViewer360();
            }
        } catch (error) {
            console.warn('Error closing viewers:', error);
        }
    }

    /**
     * Creates the UI components (integrated text panel with controls).
     * @private
     */
    _createComponents() {
        const settings = this._briefing.settings || {};

        this._textPanel = createPresentationTextPanel(
            {
                width: 520,
                backgroundColor: settings.panelBackgroundColor || 'rgba(255, 255, 255, 0.95)'
            },
            {
                onPrevious: () => this.previousSlide(),
                onNext: () => this.nextSlide(),
                onFirst: () => this.firstSlide(),
                onLast: () => this.lastSlide(),
                onFullscreen: () => this.toggleFullscreen(),
                onExit: () => this.exit()
            }
        );
        this._textPanel.mount();
    }

    /**
     * Sets up keyboard shortcuts.
     * @private
     */
    _setupKeyboardShortcuts() {
        setKeyboardCallbacksBriefing({
            nextSlide: () => this.nextSlide(),
            previousSlide: () => this.previousSlide(),
            firstSlide: () => this.firstSlide(),
            lastSlide: () => this.lastSlide(),
            exitPresentation: () => this.exit(),
            toggleFullscreen: () => this.toggleFullscreen()
        });

        activateKeyboardServiceBriefing();
    }

    /**
     * Sets up fullscreen change listeners.
     * @private
     */
    _setupFullscreenListeners() {
        const handleFullscreenChange = () => {
            this._isFullscreen = !!document.fullscreenElement;
            if (this._textPanel) {
                this._textPanel.setFullscreen(this._isFullscreen);
            }
        };

        addDomListener(this, document, 'fullscreenchange', handleFullscreenChange);
    }

    /**
     * Finishes the current transition instantly.
     * Calls map.stop() which jumps to the animation's final position
     * and fires moveend, resolving the pending flyTo Promise.
     * @private
     */
    _finishCurrentTransition() {
        if (this._map) {
            this._map.stop();
        }
    }

    /**
     * Navigates to a specific slide (internal).
     * Forward navigation = animated transitions. Backward = instant.
     * @private
     * @param {number} index - Slide index
     * @param {Object} [options] - Navigation options
     * @param {boolean} [options.forceInstant=false] - Force instant transition (skip animation)
     */
    async _goToSlide(index, options = {}) {
        if (!this._isPresenting || !this._briefing) return;

        const slide = this._briefing.slides[index];
        if (!slide) return;

        // Determine direction: forward = animated, backward = instant
        const isForward = index > this._currentSlideIndex;
        const isFirstLoad = this._currentSlideIndex === -1;
        const instant = options.forceInstant || (!isForward && !isFirstLoad);

        // Update text panel IMMEDIATELY (before flyTo animation)
        this._currentSlideIndex = index;
        if (this._textPanel) {
            this._textPanel.setSlide(slide, index, this._briefing.slides.length);
        }

        // Perform transition with direction-based animation
        this._isTransitioning = !instant;
        if (this._isTransitioning && this._textPanel) {
            this._textPanel.setTransitioning(true);
        }

        const success = await this._transitionService.transitionToSlide(slide, { instant });

        this._isTransitioning = false;
        if (this._textPanel) {
            this._textPanel.setTransitioning(false);
        }

        if (success && this._briefing) {
            // Update visibility profile based on slide mode
            this._updateVisibilityProfile(slide.mode);

            // Emit slide changed event
            this._eventBus.emit(EventTypes.BRIEFING_SLIDE_CHANGED, {
                briefingId: this._briefing.id,
                slideIndex: index,
                slideId: slide.id
            });
        }
    }

    /**
     * Updates visibility profile based on slide mode.
     * Uses PRESENT profiles (sidebar hidden by default).
     * @private
     * @param {string} mode - Slide mode
     */
    _updateVisibilityProfile(mode) {
        const visibilityController = getUIVisibilityController();

        switch (mode) {
            case SlideMode.VIEWER_3D:
                visibilityController.applyProfile(VisibilityProfile.BRIEFING_PRESENT_3D);
                break;
            case SlideMode.VIEWER_360:
                visibilityController.applyProfile(VisibilityProfile.BRIEFING_PRESENT_360);
                break;
            case SlideMode.MAP_2D:
            default:
                visibilityController.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
                break;
        }
    }

    /**
     * Preloads map tiles for all slide positions.
     * Shows a fullscreen loading overlay during preload (same pattern as site loading screen).
     * @private
     */
    async _preloadSlideTiles() {
        if (!this._briefing?.slides || !this._map) return;

        // Collect 2D positions from all slides that have valid coordinates
        const positions = this._briefing.slides
            .filter(s => s.position?.longitude != null && s.position?.latitude != null)
            .map(s => ({
                center: [s.position.longitude, s.position.latitude],
                zoom: s.position.zoom ?? this._map.getZoom(),
                bearing: s.orientation?.bearing || 0,
                pitch: s.orientation?.pitch || 0
            }));

        if (positions.length === 0) return;

        // Create tile preloader and patch flyTo for ongoing transitions
        this._tilePreloader = createTilePreloader(this._map);
        this._tilePreloader.patchFlyTo();

        // Show fullscreen loading overlay with fake timed progress (5s max)
        const { overlay, progressBar } = this._createLoadingOverlay();
        document.body.appendChild(overlay);

        // Animate progress bar over LOADING_DURATION_MS; if preload finishes
        // earlier, jump to 100% and fade out immediately
        const LOADING_DURATION_MS = 5000;
        const TICK_MS = 50;
        let elapsed = 0;
        let preloadDone = false;

        const progressInterval = setInterval(() => {
            elapsed += TICK_MS;
            if (!preloadDone && progressBar) {
                // Ease-out curve: fast start, slows near 90%
                const t = Math.min(elapsed / LOADING_DURATION_MS, 1);
                const pct = Math.round(90 * (1 - Math.pow(1 - t, 2)));
                progressBar.style.width = `${pct}%`;
            }
        }, TICK_MS);

        try {
            await this._tilePreloader.preloadPositions(positions);
        } catch (error) {
            console.warn('Tile preload failed (non-critical):', error);
        }

        // Preload finished — jump to 100% and stop timer
        preloadDone = true;
        clearInterval(progressInterval);
        if (progressBar) {
            progressBar.style.width = '100%';
        }

        // Brief pause to show 100% before fade out
        await new Promise(r => setTimeout(r, 300));

        // Fade out and remove overlay
        this._removeLoadingOverlay(overlay);
    }

    /**
     * Creates the fullscreen loading overlay DOM elements.
     * Matches the site's loading screen pattern (green background, progress bar).
     * @private
     * @returns {{ overlay: HTMLElement, progressBar: HTMLElement }}
     */
    _createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'briefing-loading-overlay';

        const content = document.createElement('div');
        content.className = 'briefing-loading-overlay__content';

        // Logo (same as site loading screen)
        const logo = document.createElement('img');
        logo.className = 'briefing-loading-overlay__logo';
        logo.src = '/images/logo_ebgeo.webp';
        logo.alt = 'EBGeo';
        content.appendChild(logo);

        const text = document.createElement('p');
        text.className = 'briefing-loading-overlay__text';
        text.textContent = 'Carregando apresentação...';
        content.appendChild(text);

        const track = document.createElement('div');
        track.className = 'briefing-loading-overlay__track';

        const progressBar = document.createElement('div');
        progressBar.className = 'briefing-loading-overlay__bar';
        track.appendChild(progressBar);

        content.appendChild(track);
        overlay.appendChild(content);

        return { overlay, progressBar };
    }

    /**
     * Fades out and removes the loading overlay.
     * @private
     * @param {HTMLElement} overlay - Overlay element to remove
     */
    _removeLoadingOverlay(overlay) {
        if (!overlay) return;

        overlay.classList.add('briefing-loading-overlay--hidden');
        setTimeout(() => overlay.remove(), 500);
    }

    /**
     * Enters fullscreen mode.
     * @private
     */
    async _enterFullscreen() {
        try {
            await document.documentElement.requestFullscreen();
            this._isFullscreen = true;
        } catch (error) {
            console.error('Failed to enter fullscreen:', error);
        }
    }

    /**
     * Exits fullscreen mode.
     * @private
     */
    async _exitFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            }
            this._isFullscreen = false;
        } catch (error) {
            console.error('Failed to exit fullscreen:', error);
        }
    }

    /**
     * Destroys the presenter control.
     */
    destroy() {
        if (this._isPresenting) {
            this.exit();
        }
        cleanup(this);
    }
}

/**
 * Creates a new briefing presenter control.
 * @param {Object} dependencies - Dependencies
 * @returns {BriefingPresenterControl}
 */
export function createBriefingPresenterControl(dependencies) {
    return new BriefingPresenterControl(dependencies);
}

export default BriefingPresenterControl;
