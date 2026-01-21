// Path: js/sidebar/components/feature-tabs.js

/**
 * @fileoverview Feature panel tabs component.
 * Manages Estilo (Style) and Atributos (Attributes) tabs.
 */

import { getEventBus } from '../../store/index.js';
import { EventTypes, FeatureUpdateProperty } from '../../events/index.js';
import { renderAttributesContent } from '../../user_data/attributes_tab_renderer.js';

/**
 * Tab IDs for the feature panel.
 */
export const FEATURE_TAB_IDS = {
    STYLE: 'estilo',
    ATTRIBUTES: 'atributos'
};

/**
 * Tab configuration.
 */
const TABS_CONFIG = [
    {
        id: FEATURE_TAB_IDS.STYLE,
        label: 'Estilo',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>`
    },
    {
        id: FEATURE_TAB_IDS.ATTRIBUTES,
        label: 'Atributos',
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
    }
];

/**
 * Creates the feature panel tabs component.
 * @param {Object} options - Configuration options
 * @param {string} options.featureId - Feature ID
 * @param {string} options.featureType - Feature type
 * @param {boolean} [options.singleSelection=true] - Whether single feature is selected
 * @returns {Object} Object with container, styleTab, attributesTab, cleanup, switchTab
 */
export function createFeatureTabs(options) {
    const { featureId, featureType, singleSelection = true } = options;

    const container = document.createElement('div');
    container.className = 'feature-tabs-container';

    // For multi-selection, return simple container without tabs
    if (!singleSelection) {
        const simpleContainer = document.createElement('div');
        simpleContainer.className = 'feature-tabs-simple';
        return {
            container: simpleContainer,
            styleTab: simpleContainer,
            attributesTab: null,
            cleanup: () => {},
            switchTab: () => {}
        };
    }

    // Tab buttons container
    const tabButtonsContainer = document.createElement('div');
    tabButtonsContainer.className = 'feature-tabs-buttons';

    const tabContents = {};
    const tabButtons = {};

    // Create tabs
    TABS_CONFIG.forEach((tab, index) => {
        // Button
        const btn = document.createElement('button');
        btn.className = `feature-tab-btn${index === 0 ? ' active' : ''}`;
        btn.innerHTML = `${tab.icon}<span>${tab.label}</span>`;
        btn.dataset.tabId = tab.id;
        btn.type = 'button';
        tabButtons[tab.id] = btn;
        tabButtonsContainer.appendChild(btn);

        // Content
        const content = document.createElement('div');
        content.className = `feature-tab-content${index === 0 ? ' active' : ''}`;
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

    // Tab button click handler
    tabButtonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.feature-tab-btn');
        if (btn) {
            switchTab(btn.dataset.tabId);
        }
    });

    // Event subscription for attribute updates
    let eventUnsubscribe = null;

    // Render attributes tab content
    async function renderAttributesTab() {
        if (renderAttributesContent) {
            await renderAttributesContent(
                tabContents[FEATURE_TAB_IDS.ATTRIBUTES],
                featureId,
                featureType
            );
        }
    }

    // Initial render of attributes
    renderAttributesTab();

    // Subscribe to attribute updates
    try {
        const eventBus = getEventBus();
        eventUnsubscribe = eventBus.on(EventTypes.FEATURE_UPDATED, (payload) => {
            if (payload.featureId === featureId &&
                payload.featureType === featureType &&
                payload.property === FeatureUpdateProperty.ATTRIBUTES) {
                renderAttributesTab();
            }
        });
    } catch {
        // EventBus not available
    }

    function cleanup() {
        if (eventUnsubscribe) {
            eventUnsubscribe();
        }
    }

    return {
        container,
        styleTab: tabContents[FEATURE_TAB_IDS.STYLE],
        attributesTab: tabContents[FEATURE_TAB_IDS.ATTRIBUTES],
        cleanup,
        switchTab
    };
}
