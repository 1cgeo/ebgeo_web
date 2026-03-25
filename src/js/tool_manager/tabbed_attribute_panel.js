// Path: js/tool_manager/tabbed_attribute_panel.js

/**
 * @fileoverview TabbedAttributePanel - Tabbed panel component.
 * Manages the tab structure (Properties, Attributes, Images) centrally.
 */

import { getEventBus } from '../store';
import { EventTypes, FeatureUpdateProperty } from '../events';

/**
 * @typedef {Object} TabbedPanelConfig
 * @property {string} featureId - ID of the selected feature
 * @property {string} featureType - Feature type ('polygon', 'point', etc.)
 * @property {Object} control - Tool control instance
 * @property {boolean} [singleSelection=true] - Whether single selection (enables tabs)
 */

/**
 * @typedef {Object} TabbedPanelInstance
 * @property {HTMLElement} container - Main panel container
 * @property {HTMLElement} propertiesTab - Properties tab container
 * @property {Function} cleanup - Cleanup function
 * @property {Function} switchTab - Tab switching function
 */

/**
 * Available tab IDs.
 * @readonly
 * @enum {string}
 */
export const TAB_IDS = Object.freeze({
    PROPERTIES: 'properties',
    ATTRIBUTES: 'attributes',
    IMAGES: 'images'
});

const TABS_CONFIG = [
    { id: TAB_IDS.PROPERTIES, label: 'Propriedades' },
    { id: TAB_IDS.ATTRIBUTES, label: 'Atributos' },
    { id: TAB_IDS.IMAGES, label: 'Imagens' }
];

/**
 * Create an attribute panel with tab system.
 *
 * @param {TabbedPanelConfig} config - Panel configuration
 * @param {Function} renderAttributesContent - Render function for attributes tab
 * @param {Function} renderImagesContent - Render function for images tab
 * @returns {TabbedPanelInstance} Tabbed panel instance
 */
export function createTabbedAttributePanel(config, renderAttributesContent, renderImagesContent) {
    const { featureId, featureType, singleSelection = true } = config;

    const container = document.createElement('div');
    container.className = 'tabbed-attribute-panel';

    // For multi-selection, return a simple container without tabs
    if (!singleSelection) {
        return {
            container,
            propertiesTab: container,
            cleanup: () => {},
            switchTab: () => {}
        };
    }

    // Create tab structure
    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'tabbed-panel-buttons';

    const tabContents = {};
    const tabButtons = {};

    TABS_CONFIG.forEach((tab, index) => {
        const btn = document.createElement('button');
        btn.className = `tabbed-panel-btn${index === 0 ? ' active' : ''}`;
        btn.textContent = tab.label;
        btn.dataset.tabId = tab.id;
        btn.type = 'button';
        tabButtons[tab.id] = btn;
        tabButtonsContainer.appendChild(btn);

        const content = document.createElement('div');
        content.className = `tabbed-panel-content${index === 0 ? ' active' : ''}`;
        content.dataset.tabId = tab.id;
        tabContents[tab.id] = content;
    });

    container.appendChild(tabButtonsContainer);
    Object.values(tabContents).forEach(content => container.appendChild(content));

    // Tab switching logic
    function switchTab(tabId) {
        Object.entries(tabButtons).forEach(([id, btn]) => {
            btn.classList.toggle('active', id === tabId);
        });
        Object.entries(tabContents).forEach(([id, content]) => {
            content.classList.toggle('active', id === tabId);
        });
    }

    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tabbed-panel-btn');
        if (btn) switchTab(btn.dataset.tabId);
    });

    // Internal state
    let eventUnsubscribe = null;

    // Initial render of user data tabs
    async function renderUserDataTabs() {
        if (renderAttributesContent) {
            await renderAttributesContent(
                tabContents[TAB_IDS.ATTRIBUTES],
                featureId,
                featureType
            );
        }
        if (renderImagesContent) {
            await renderImagesContent(
                tabContents[TAB_IDS.IMAGES],
                featureId,
                featureType
            );
        }
    }

    renderUserDataTabs();

    // Subscribe to update events
    try {
        const eventBus = getEventBus();
        eventUnsubscribe = eventBus.on(EventTypes.FEATURE_UPDATED, (payload) => {
            if (payload.featureId === featureId && payload.featureType === featureType) {
                if (payload.property === FeatureUpdateProperty.ATTRIBUTES && renderAttributesContent) {
                    renderAttributesContent(tabContents[TAB_IDS.ATTRIBUTES], featureId, featureType);
                } else if (payload.property === FeatureUpdateProperty.IMAGES && renderImagesContent) {
                    renderImagesContent(tabContents[TAB_IDS.IMAGES], featureId, featureType);
                }
            }
        });
    } catch (_e) {
        console.warn('EventBus not available for TabbedAttributePanel');
    }

    function cleanup() {
        if (eventUnsubscribe) eventUnsubscribe();
    }

    return {
        container,
        propertiesTab: tabContents[TAB_IDS.PROPERTIES],
        cleanup,
        switchTab
    };
}

/**
 * Inject TabbedAttributePanel CSS styles.
 * Call once during initialization.
 */
export function injectTabbedPanelStyles() {
    if (document.getElementById('tabbed-panel-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'tabbed-panel-styles';
    styles.textContent = `
        .tabbed-attribute-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .tabbed-panel-buttons {
            display: flex;
            border-bottom: 1px solid #e0e0e0;
            background: #f5f5f5;
            flex-shrink: 0;
        }

        .tabbed-panel-btn {
            flex: 1;
            padding: 10px 12px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #666;
            transition: all 0.2s ease;
            border-bottom: 2px solid transparent;
        }

        .tabbed-panel-btn:hover {
            background: #e8e8e8;
            color: #333;
        }

        .tabbed-panel-btn.active {
            color: #1976d2;
            border-bottom-color: #1976d2;
            background: #fff;
        }

        .tabbed-panel-content {
            display: none;
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .tabbed-panel-content.active {
            display: block;
        }
    `;
    document.head.appendChild(styles);
}
