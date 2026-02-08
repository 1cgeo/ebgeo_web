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

        // Services
        this._transitionService = null;

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

        // Reset transition service to 2D
        if (this._transitionService) {
            await this._transitionService.resetTo2D();
            this._transitionService.destroy();
            this._transitionService = null;
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

        // Call exit callback
        if (this._onExit) {
            this._onExit();
        }
    }

    /**
     * Navigates to the next slide.
     */
    async nextSlide() {
        if (!this._isPresenting || !this._briefing) return;

        const nextIndex = this._currentSlideIndex + 1;
        if (nextIndex < this._briefing.slides.length) {
            await this._goToSlide(nextIndex);
        }
    }

    /**
     * Navigates to the previous slide.
     */
    async previousSlide() {
        if (!this._isPresenting || !this._briefing) return;

        const prevIndex = this._currentSlideIndex - 1;
        if (prevIndex >= 0) {
            await this._goToSlide(prevIndex);
        }
    }

    /**
     * Navigates to the first slide.
     */
    async firstSlide() {
        if (!this._isPresenting || !this._briefing) return;
        await this._goToSlide(0);
    }

    /**
     * Navigates to the last slide.
     */
    async lastSlide() {
        if (!this._isPresenting || !this._briefing) return;

        const lastIndex = this._briefing.slides.length - 1;
        if (lastIndex >= 0) {
            await this._goToSlide(lastIndex);
        }
    }

    /**
     * Navigates to a specific slide.
     * @param {number} index - Slide index (0-based)
     */
    async goToSlide(index) {
        if (!this._isPresenting || !this._briefing) return;

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
                onToggleText: () => this.toggleTextPanel(),
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
            toggleFullscreen: () => this.toggleFullscreen(),
            toggleTextPanel: () => this.toggleTextPanel()
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
     * Navigates to a specific slide (internal).
     * Forward navigation = animated transitions. Backward = instant.
     * @private
     * @param {number} index - Slide index
     */
    async _goToSlide(index) {
        const slide = this._briefing.slides[index];
        if (!slide) return;

        // Check if transition is already in progress
        if (this._transitionService?.isTransitioning()) {
            return;
        }

        // Determine direction: forward = animated, backward = instant
        const isForward = index > this._currentSlideIndex;
        const isFirstLoad = this._currentSlideIndex === -1;
        const instant = !isForward && !isFirstLoad;

        // Perform transition with direction-based animation
        const success = await this._transitionService.transitionToSlide(slide, { instant });

        if (success) {
            this._currentSlideIndex = index;

            // Update text panel (includes controls and counter)
            if (this._textPanel) {
                this._textPanel.setSlide(slide, index, this._briefing.slides.length);
            }

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
