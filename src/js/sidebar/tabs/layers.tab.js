// Path: js/sidebar/tabs/layers.tab.js

/**
 * @fileoverview Layers tab component for sidebar.
 * Wraps existing FeaturesTab functionality without base layer selector.
 */

import {
    setupCleanup,
    subscribe,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import { EventTypes } from '../../events/event_types.js';

/**
 * Layers tab component - wrapper around FeaturesTab.
 * Removes base layer selector UI as it's moved to bottom-left corner.
 */
export class LayersTab {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.featuresTab - FeaturesTab instance
     * @param {Object} dependencies.eventBus - EventBus instance
     */
    constructor(dependencies) {
        this._featuresTab = dependencies.featuresTab;
        this._eventBus = dependencies.eventBus;

        this._container = null;
        this._featuresTabContainer = null;
        this._isVisible = false;

        setupCleanup(this);
    }

    /**
     * Creates the tab UI.
     * @returns {HTMLElement}
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-tab-content layers-tab';

        // Get FeaturesTab UI
        if (this._featuresTab) {
            this._featuresTabContainer = this._featuresTab.createUI();

            // Remove base layer selector if present
            this._removeBaseLayerSelector();

            // Add to our container
            this._container.appendChild(this._featuresTabContainer);
        } else {
            this._container.innerHTML = `
                <div class="sidebar-tab-placeholder">
                    <p>FeaturesTab nao disponivel</p>
                </div>
            `;
        }

        this._setupEventListeners();

        return this._container;
    }

    /**
     * Removes the base layer selector from FeaturesTab UI.
     * This selector is moved to the bottom-left corner of the map.
     * @private
     */
    _removeBaseLayerSelector() {
        if (!this._featuresTabContainer) return;

        // Look for common selectors that might contain base layer UI
        const selectors = [
            '.base-layer-control',
            '.base-layer-selector',
            '[class*="base-layer"]',
            '.layer-switcher',
        ];

        selectors.forEach(selector => {
            const element = this._featuresTabContainer.querySelector(selector);
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Listen for visibility changes
        subscribe(this, this._eventBus, EventTypes.SIDEBAR_TAB_CHANGED,
            (payload) => this._onTabChanged(payload));
    }

    /**
     * Handles tab change events.
     * @private
     * @param {Object} payload - Event payload
     */
    _onTabChanged(payload) {
        const isLayersTab = payload.currentTab === 'camadas';

        if (isLayersTab && !this._isVisible) {
            this.show();
        } else if (!isLayersTab && this._isVisible) {
            this.hide();
        }
    }

    /**
     * Shows the tab and loads content.
     */
    async show() {
        this._isVisible = true;

        if (this._featuresTab) {
            await this._featuresTab.show();
        }
    }

    /**
     * Hides the tab.
     */
    hide() {
        this._isVisible = false;

        if (this._featuresTab) {
            this._featuresTab.hide();
        }
    }

    /**
     * Refreshes the tab content.
     */
    async refresh() {
        if (this._featuresTab && this._isVisible) {
            await this._featuresTab.loadFeatures();
        }
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the component.
     * Note: Does NOT destroy the underlying FeaturesTab as it may be used elsewhere.
     */
    destroy() {
        this._isVisible = false;

        // Hide FeaturesTab but don't destroy it
        if (this._featuresTab) {
            this._featuresTab.hide();
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._featuresTabContainer = null;
    }
}
