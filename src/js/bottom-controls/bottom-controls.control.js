// Path: js/bottom-controls/bottom-controls.control.js

/**
 * @fileoverview Main bottom controls controller.
 * Manages feature toggles (left) and navigation buttons (right).
 */

import { FeatureToggle } from './components/feature-toggle.js';
import { NavButton } from './components/nav-button.js';
import { FEATURE_TOGGLES, NAV_BUTTONS } from './bottom-controls.constants.js';
import config from '@js/config.js';
import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { registerControl } from '@store/control.registry.js';

/**
 * Main bottom controls controller.
 */
export class BottomControlsControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.map - MapLibre map instance
     * @param {Object} dependencies.toolManager - ToolManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.terrainControl - TerrainControl instance
     * @param {Object} dependencies.modelsViewerControl - Add3DModelsViewerControl instance
     * @param {Object} dependencies.streetViewControl - AddStreetViewControl instance
     */
    constructor(dependencies) {
        this._map = dependencies.map;
        this._toolManager = dependencies.toolManager;
        this._eventBus = dependencies.eventBus;
        this._terrainControl = dependencies.terrainControl;
        this._modelsViewerControl = dependencies.modelsViewerControl;
        this._streetViewControl = dependencies.streetViewControl;

        this._leftContainer = null;
        this._rightContainer = null;
        this._featureToggles = new Map();
        this._navButtons = new Map();
        this._isFullscreen = false;

        // Bind methods
        this._updateCompass = this._updateCompass.bind(this);
        this._onFullscreenChange = this._onFullscreenChange.bind(this);
        this._onTerrainChange = this._onTerrainChange.bind(this);

        // Track toolManager subscriptions for cleanup
        this._toolManagerUnsubscribers = [];

        setupCleanup(this);
    }

    /**
     * Initializes the bottom controls and attaches to DOM.
     * @param {HTMLElement} parentElement - Parent to attach to
     */
    init(parentElement) {
        // Create left container (feature toggles)
        this._leftContainer = document.createElement('div');
        this._leftContainer.className = 'bottom-controls-left';
        this._leftContainer.id = 'bottom-controls-left';

        // Create feature toggles
        this._createFeatureToggles();

        parentElement.appendChild(this._leftContainer);

        // Create right container (navigation)
        this._rightContainer = document.createElement('div');
        this._rightContainer.className = 'bottom-controls-right';
        this._rightContainer.id = 'bottom-controls-right';

        // Create navigation buttons
        this._createNavButtons();

        parentElement.appendChild(this._rightContainer);

        // Setup event listeners
        this._setupEventListeners();

        // Initialize states
        this._syncInitialStates();

        // Register for external access (e.g., briefing transitions calling syncStates)
        registerControl('bottomControls', this);
    }

    /**
     * Creates feature toggle buttons.
     * @private
     */
    _createFeatureToggles() {
        Object.values(FEATURE_TOGGLES).forEach(toggleConfig => {
            // Check if feature is enabled in config
            const isEnabled = this._isFeatureEnabled(toggleConfig);

            // Don't render button if feature is disabled in config
            if (!isEnabled) {
                return;
            }

            // Check if feature is available (has data/resources)
            const isAvailable = this._isFeatureAvailable(toggleConfig);

            const toggle = new FeatureToggle(
                toggleConfig,
                (cfg, active) => this._handleToggle(cfg, active)
            );

            const element = toggle.render();
            this._leftContainer.appendChild(element);
            this._featureToggles.set(toggleConfig.id, toggle);

            // Disable if not available (no tilesets, no terrain source, etc.)
            if (!isAvailable) {
                toggle.setDisabled(true);
            }
        });
    }

    /**
     * Checks if a feature is enabled in config.
     * @private
     * @param {Object} toggleConfig - Toggle configuration
     * @returns {boolean}
     */
    _isFeatureEnabled(toggleConfig) {
        switch (toggleConfig.id) {
            case 'models3d':
                return config.features?.map_3d !== false;
            case 'panorama':
                return config.features?.imagens_panoramicas !== false;
            case 'terrain':
                return config.map2d?.terrainSource != null;
            default:
                return true;
        }
    }

    /**
     * Creates navigation buttons.
     * @private
     */
    _createNavButtons() {
        // Zoom buttons group
        const zoomGroup = document.createElement('div');
        zoomGroup.className = 'nav-btn-group';

        ['zoomIn', 'zoomOut'].forEach(key => {
            const btnConfig = NAV_BUTTONS[key];
            const btn = new NavButton(btnConfig, (cfg) => this._handleNavAction(cfg));
            zoomGroup.appendChild(btn.render());
            this._navButtons.set(btnConfig.id, btn);
        });

        this._rightContainer.appendChild(zoomGroup);

        // Other navigation buttons
        ['fullscreen', 'compass'].forEach(key => {
            const btnConfig = NAV_BUTTONS[key];
            const btn = new NavButton(btnConfig, (cfg) => this._handleNavAction(cfg));
            this._rightContainer.appendChild(btn.render());
            this._navButtons.set(btnConfig.id, btn);
        });
    }

    /**
     * Checks if a feature is available based on config.
     * @private
     * @param {Object} toggleConfig - Toggle configuration
     * @returns {boolean}
     */
    _isFeatureAvailable(toggleConfig) {
        // Parse config key path (e.g., 'features.terrain')
        const keys = toggleConfig.configKey.split('.');
        let value = config;

        for (const key of keys) {
            if (value && typeof value === 'object') {
                value = value[key];
            } else {
                return false;
            }
        }

        // Special checks for specific features
        switch (toggleConfig.id) {
            case 'terrain':
                return value !== false && value !== undefined && value !== null &&
                    this._terrainControl?.terrainSourceConfig;
            case 'models3d':
                return value !== false && config.hasTilesets?.();
            case 'panorama':
                return value !== false;
            default:
                return value !== false;
        }
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Map rotation changes for compass
        this._map.on('rotate', this._updateCompass);

        // Fullscreen changes
        addDomListener(this, document, 'fullscreenchange', this._onFullscreenChange);
        addDomListener(this, document, 'webkitfullscreenchange', this._onFullscreenChange);

        // Terrain changes
        this._map.on('terrain', this._onTerrainChange);

        // Tool manager activation events - listen on toolManager if it has events
        // Store unsubscribe functions for cleanup to prevent memory leaks
        if (this._toolManager?.on) {
            this._toolManagerUnsubscribers.push(
                this._toolManager.on('toolActivated', (tool) => this._syncViewerToggle(tool, true)),
                this._toolManager.on('toolDeactivated', (tool) => this._syncViewerToggle(tool, false)),
                this._toolManager.on('viewerActivated', (viewer) => this._syncViewerToggle(viewer, true)),
                this._toolManager.on('viewerDeactivated', (viewer) => this._syncViewerToggle(viewer, false))
            );
        }
    }

    /**
     * Syncs initial states from existing controls.
     * @private
     */
    _syncInitialStates() {
        // Terrain state
        const hasTerrain = this._map.getTerrain() != null;
        this._featureToggles.get('terrain')?.setActive(hasTerrain);

        // 3D models state
        const models3dActive = this._modelsViewerControl?.isActive || false;
        this._featureToggles.get('models3d')?.setActive(models3dActive);

        // Panorama state
        const panoramaActive = this._streetViewControl?.isActive || false;
        this._featureToggles.get('panorama')?.setActive(panoramaActive);

        // Compass rotation
        this._updateCompass();
    }

    /**
     * Handles feature toggle.
     * @private
     * @param {Object} toggleConfig - Toggle configuration
     * @param {boolean} active - New active state
     */
    _handleToggle(toggleConfig, active) {
        switch (toggleConfig.id) {
            case 'terrain':
                this._toggleTerrain(active);
                break;
            case 'models3d':
                this._toggleModels3D(active);
                break;
            case 'panorama':
                this._togglePanorama(active);
                break;
        }
    }

    /**
     * Toggles terrain.
     * @private
     * @param {boolean} active
     */
    _toggleTerrain(active) {
        if (!this._terrainControl) return;

        // Use terrain control's toggle method
        if (this._terrainControl._toggleTerrain) {
            this._terrainControl._toggleTerrain();
        } else {
            // Fallback direct manipulation
            if (active) {
                this._map.setTerrain(this._terrainControl.terrainConfig);
            } else {
                this._map.setTerrain(null);
            }
        }
    }

    /**
     * Toggles 3D models viewer.
     * @private
     * @param {boolean} active
     */
    _toggleModels3D(active) {
        if (!this._modelsViewerControl || !this._toolManager) return;

        // Only toggle if state doesn't match desired state
        if (active !== this._modelsViewerControl.isActive) {
            this._toolManager.toggleViewer(this._modelsViewerControl);
        }
    }

    /**
     * Toggles panoramic images viewer.
     * @private
     * @param {boolean} active
     */
    _togglePanorama(active) {
        if (!this._streetViewControl || !this._toolManager) return;

        // Only toggle if state doesn't match desired state
        if (active !== this._streetViewControl.isActive) {
            this._toolManager.toggleViewer(this._streetViewControl);
        }
    }

    /**
     * Handles navigation button action.
     * @private
     * @param {Object} btnConfig - Button configuration
     */
    _handleNavAction(btnConfig) {
        switch (btnConfig.action) {
            case 'zoomIn':
                this._map.zoomIn({ duration: 300 });
                break;
            case 'zoomOut':
                this._map.zoomOut({ duration: 300 });
                break;
            case 'toggleFullscreen':
                this._toggleFullscreen();
                break;
case 'resetNorth':
                this._resetNorth();
                break;
        }
    }

    /**
     * Toggles fullscreen mode.
     * @private
     */
    _toggleFullscreen() {
        const container = this._map.getContainer().parentElement || document.body;

        if (!document.fullscreenElement) {
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    /**
     * Resets map bearing to north.
     * @private
     */
    _resetNorth() {
        this._map.easeTo({
            bearing: 0,
            pitch: 0,
            duration: 500
        });
    }

    /**
     * Updates compass rotation.
     * @private
     */
    _updateCompass() {
        const bearing = this._map.getBearing();
        const compassBtn = this._navButtons.get('compass');
        if (compassBtn) {
            compassBtn.setRotation(-bearing);
        }
    }

    /**
     * Handles fullscreen change event.
     * @private
     */
    _onFullscreenChange() {
        this._isFullscreen = !!document.fullscreenElement;
        const fullscreenBtn = this._navButtons.get('fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.setActive(this._isFullscreen);
        }
    }

    /**
     * Handles terrain change event.
     * @private
     */
    _onTerrainChange() {
        const hasTerrain = this._map.getTerrain() != null;
        this._featureToggles.get('terrain')?.setActive(hasTerrain);
    }

    /**
     * Syncs a viewer control's toggle state when activated or deactivated.
     * Shared handler for both tool and viewer events.
     * @private
     * @param {Object} control - Activated/deactivated control
     * @param {boolean} active - Whether the control is now active
     */
    _syncViewerToggle(control, active) {
        if (control === this._modelsViewerControl) {
            this._featureToggles.get('models3d')?.setActive(active);
        }
        if (control === this._streetViewControl) {
            this._featureToggles.get('panorama')?.setActive(active);
        }
    }

    /**
     * Sync toggle states with external controls.
     * Call this periodically or on relevant events to keep toggles in sync.
     */
    syncStates() {
        // Sync terrain
        const hasTerrain = this._map.getTerrain() != null;
        this._featureToggles.get('terrain')?.setActive(hasTerrain);

        // Sync 3D models
        const models3dActive = this._modelsViewerControl?.isActive || false;
        this._featureToggles.get('models3d')?.setActive(models3dActive);

        // Sync panorama
        const panoramaActive = this._streetViewControl?.isActive || false;
        this._featureToggles.get('panorama')?.setActive(panoramaActive);
    }

    /**
     * Destroys the bottom controls.
     */
    destroy() {
        // Remove map event listeners
        this._map.off('rotate', this._updateCompass);
        this._map.off('terrain', this._onTerrainChange);

        // Cleanup toolManager subscriptions to prevent memory leaks
        this._toolManagerUnsubscribers.forEach(unsub => {
            if (typeof unsub === 'function') {
                unsub();
            }
        });
        this._toolManagerUnsubscribers = [];

        this._featureToggles.forEach(toggle => toggle.destroy());
        this._featureToggles.clear();

        this._navButtons.forEach(btn => btn.destroy());
        this._navButtons.clear();

        cleanup(this);
        removeElement(this._leftContainer);
        removeElement(this._rightContainer);
        this._leftContainer = null;
        this._rightContainer = null;
    }
}
