// Path: js/sidebar/components/sidebar-collapsed.js

/**
 * @fileoverview Collapsed sidebar component (56px always visible).
 * Contains logo, navigation buttons, and recent maps shortcuts.
 */

import { SIDEBAR_TABS, SIDEBAR_ICONS, TAB_CONFIG } from '../sidebar.constants.js';
import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/**
 * Creates and manages the collapsed sidebar component.
 */
export class SidebarCollapsed {
    /**
     * @param {Object} options - Configuration options
     * @param {Function} options.onTabClick - Callback when tab button clicked
     * @param {Function} options.onRecentMapClick - Callback when recent map clicked
     * @param {string} options.logoSrc - Logo image source path
     */
    constructor(options) {
        this._onTabClick = options.onTabClick;
        this._onRecentMapClick = options.onRecentMapClick;
        this._logoSrc = options.logoSrc || './images/ebgeo_logo.svg';

        this._container = null;
        this._navButtons = new Map();

        setupCleanup(this);
    }

    /**
     * Creates the collapsed sidebar DOM structure.
     * @returns {HTMLElement} Container element
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'sidebar-collapsed';

        // Logo section
        const logo = this._createLogo();
        this._container.appendChild(logo);

        // Navigation buttons
        const nav = this._createNavigation();
        this._container.appendChild(nav);

        // Separator
        const separator = document.createElement('div');
        separator.className = 'sidebar-separator';
        this._container.appendChild(separator);

        // Recent maps section
        const recentMaps = this._createRecentMapsSection();
        this._container.appendChild(recentMaps);

        return this._container;
    }

    /**
     * Creates the logo element.
     * @private
     * @returns {HTMLElement}
     */
    _createLogo() {
        const logoContainer = document.createElement('div');
        logoContainer.className = 'sidebar-logo';

        const logoImg = document.createElement('img');
        logoImg.src = this._logoSrc;
        logoImg.alt = 'EBGeo';
        logoImg.draggable = false;

        logoContainer.appendChild(logoImg);
        return logoContainer;
    }

    /**
     * Creates the navigation buttons.
     * @private
     * @returns {HTMLElement}
     */
    _createNavigation() {
        const nav = document.createElement('nav');
        nav.className = 'sidebar-nav';

        const tabs = [
            { id: SIDEBAR_TABS.MAPAS, icon: SIDEBAR_ICONS.map },
            { id: SIDEBAR_TABS.CAMADAS, icon: SIDEBAR_ICONS.layers },
            { id: SIDEBAR_TABS.BRIEFINGS, icon: SIDEBAR_ICONS.presentation },
            { id: SIDEBAR_TABS.PROCESSAMENTO, icon: SIDEBAR_ICONS.processing },
            { id: SIDEBAR_TABS.IMPORTAR, icon: SIDEBAR_ICONS.upload },
            { id: SIDEBAR_TABS.EXPORTAR, icon: SIDEBAR_ICONS.download },
        ];

        tabs.forEach(({ id, icon }) => {
            const button = this._createNavButton(id, icon, TAB_CONFIG[id].label);
            nav.appendChild(button);
            this._navButtons.set(id, button);
        });

        return nav;
    }

    /**
     * Creates a navigation button.
     * @private
     * @param {string} tabId - Tab identifier
     * @param {string} icon - SVG icon markup
     * @param {string} label - Button label
     * @returns {HTMLButtonElement}
     */
    _createNavButton(tabId, icon, label) {
        const button = document.createElement('button');
        button.className = 'sidebar-nav-btn';
        button.dataset.tab = tabId;
        button.dataset.active = 'false';
        button.setAttribute('aria-label', label);
        button.title = label;

        button.innerHTML = `
            ${icon}
            <span>${label}</span>
        `;

        const handleClick = () => {
            if (this._onTabClick) {
                this._onTabClick(tabId);
            }
        };

        addDomListener(this, button, 'click', handleClick);

        return button;
    }

    /**
     * Creates the recent maps section.
     * @private
     * @returns {HTMLElement}
     */
    _createRecentMapsSection() {
        const container = document.createElement('div');
        container.className = 'sidebar-recent-maps';
        container.id = 'sidebar-recent-maps';

        // Placeholder - will be populated by updateRecentMaps
        return container;
    }

    /**
     * Updates the active tab indicator.
     * @param {string|null} activeTab - Currently active tab ID
     */
    setActiveTab(activeTab) {
        this._navButtons.forEach((button, tabId) => {
            button.dataset.active = (tabId === activeTab).toString();
        });
    }

    /**
     * Updates the recent maps display.
     * @param {Array<Object>} recentMaps - Array of recent map objects
     * @param {string} recentMaps[].name - Map name
     * @param {string} [recentMaps[].thumbnail] - Thumbnail URL
     * @param {boolean} [recentMaps[].isActive] - Whether this is the current map
     * @param {string} [recentMaps[].color] - Color for the map button (persistent)
     */
    updateRecentMaps(recentMaps) {
        const container = this._container?.querySelector('#sidebar-recent-maps');
        if (!container) return;

        container.innerHTML = '';

        // Show all maps - container handles overflow with scroll
        const mapsToShow = recentMaps;

        // Fallback color palette (only used if no persistent color is assigned)
        const fallbackColor = '#3b82f6';

        mapsToShow.forEach((mapInfo) => {
            const button = document.createElement('button');
            button.className = 'recent-map-btn';
            button.title = mapInfo.name;
            button.dataset.mapName = mapInfo.name;
            button.setAttribute('aria-label', `Abrir mapa: ${mapInfo.name}`);

            // Set active state if this is the current map
            if (mapInfo.isActive) {
                button.dataset.active = 'true';
            }

            // Get first letter for initial badge
            const initial = mapInfo.name.charAt(0).toUpperCase();
            const color = mapInfo.color || fallbackColor;

            if (mapInfo.thumbnail) {
                const img = document.createElement('img');
                img.src = mapInfo.thumbnail;
                img.alt = mapInfo.name;
                img.draggable = false;
                button.appendChild(img);
            } else {
                // Create colored initial badge (similar to mockup)
                const badge = document.createElement('div');
                badge.className = 'recent-map-badge';
                badge.style.backgroundColor = color;
                badge.textContent = initial;
                button.appendChild(badge);
            }

            // Map name label below the badge
            const label = document.createElement('span');
            label.className = 'recent-map-label';
            label.textContent = this._truncateName(mapInfo.name, 8);
            button.appendChild(label);

            const handleClick = () => {
                if (this._onRecentMapClick) {
                    this._onRecentMapClick(mapInfo.name);
                }
            };

            addDomListener(this, button, 'click', handleClick);
            container.appendChild(button);
        });
    }

    /**
     * Truncates a name to fit within the button.
     * @private
     * @param {string} name - Full name
     * @param {number} maxLength - Maximum characters
     * @returns {string} Truncated name
     */
    _truncateName(name, maxLength) {
        if (name.length <= maxLength) return name;
        return name.substring(0, maxLength - 1) + '…';
    }

    /**
     * Gets the container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the component and cleans up resources.
     */
    destroy() {
        cleanup(this);
        this._navButtons.clear();
        removeElement(this._container);
        this._container = null;
    }
}
