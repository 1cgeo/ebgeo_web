// Path: js/search/search-bar.component.js

/**
 * @fileoverview Redesigned search bar component (Google Maps style).
 * Always visible input with dynamic positioning based on sidebar state.
 *
 * API results open in the sidebar feature panel with a "Save as Feature" button.
 */

import { EventTypes } from '../events/event_types.js';
import config from '../config.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '../utilities/event-cleanup.js';
import { getCurrentMapFeatures } from '../store/feature.operations.js';
import { addFeature, getActiveLayerIdSync } from '../store/store.js';
import { getAllStorageTypes, getFeatureDisplayNameFromStorage } from '../store/store.constants.js';
import { FeatureNavigationUtils } from '../utilities/feature_navigation_utils.js';
import { IDUtils } from '../utilities/id_utils.js';
import { getEventBus } from '../store/services.js';

/**
 * SVG Icons for search bar.
 */
const SEARCH_ICONS = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,

    clear: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

    feature: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    military: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,

    // POI/Place - marker icon
    place: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,

    coordinate: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,

    // 3D Model - same as bottom-controls (box/cube icon)
    model3d: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.5 7.27783L12 12.0001M12 12.0001L3.49997 7.27783M12 12.0001L12 21.5001M21 16.0586V7.94153C21 7.59889 21 7.42757 20.9495 7.27477C20.9049 7.13959 20.8318 7.01551 20.7354 6.91082C20.6263 6.79248 20.4766 6.70928 20.177 6.54288L12.777 2.43177C12.4934 2.27421 12.3516 2.19543 12.2015 2.16454C12.0685 2.13721 11.9315 2.13721 11.7986 2.16454C11.6484 2.19543 11.5066 2.27421 11.223 2.43177L3.82297 6.54288C3.52345 6.70928 3.37369 6.79248 3.26463 6.91082C3.16816 7.01551 3.09515 7.13959 3.05048 7.27477C3 7.42757 3 7.59889 3 7.94153V16.0586C3 16.4013 3 16.5726 3.05048 16.7254C3.09515 16.8606 3.16816 16.9847 3.26463 17.0893C3.37369 17.2077 3.52345 17.2909 3.82297 17.4573L11.223 21.5684C11.5066 21.726 11.6484 21.8047 11.7986 21.8356C11.9315 21.863 12.0685 21.863 12.2015 21.8356C12.3516 21.8047 12.4934 21.726 12.777 21.5684L20.177 17.4573C20.4766 17.2909 20.6263 17.2077 20.7354 17.0893C20.8318 16.9847 20.9049 16.8606 20.9495 16.7254C21 16.5726 21 16.4013 21 16.0586Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    // Streetview - same as bottom-controls (panorama/person icon)
    streetview: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 15 15" fill="none"><path d="M4.5 11.5H4C4 11.7761 4.22386 12 4.5 12V11.5ZM10.5 11.5V12C10.7761 12 11 11.7761 11 11.5H10.5ZM4.5 12H10.5V11H4.5V12ZM11 11.5V9.5H10V11.5H11ZM4 9.5V11.5H5V9.5H4ZM7.5 6C5.567 6 4 7.567 4 9.5H5C5 8.11929 6.11929 7 7.5 7V6ZM11 9.5C11 7.567 9.433 6 7.5 6V7C8.88071 7 10 8.11929 10 9.5H11ZM14 11.5C14 11.7451 13.8862 12.0204 13.594 12.3165C13.2997 12.6147 12.8491 12.9061 12.2528 13.1617C11.0619 13.6721 9.3819 14 7.5 14V15C9.48409 15 11.3041 14.6563 12.6467 14.0808C13.3171 13.7935 13.8916 13.4385 14.3058 13.0189C14.722 12.5971 15 12.0833 15 11.5H14ZM7.5 14C5.6181 14 3.93808 13.6721 2.74721 13.1617C2.15089 12.9061 1.70026 12.6147 1.40597 12.3165C1.1138 12.0204 1 11.7451 1 11.5H0C0 12.0833 0.27795 12.5971 0.694221 13.0189C1.10837 13.4385 1.68286 13.7935 2.35329 14.0808C3.69593 14.6563 5.51591 15 7.5 15V14ZM1 11.5C1 11.258 1.1108 10.9868 1.39448 10.6952C1.68043 10.4012 2.11881 10.1128 2.70035 9.85849L2.29965 8.94229C1.644 9.22903 1.08238 9.58178 0.677627 9.99794C0.270611 10.4164 0 10.9245 0 11.5H1ZM12.2996 9.85849C12.8812 10.1128 13.3196 10.4012 13.6055 10.6952C13.8892 10.9868 14 11.258 14 11.5H15C15 10.9245 14.7294 10.4164 14.3224 9.99794C13.9176 9.58178 13.356 9.22903 12.7004 8.94229L12.2996 9.85849ZM7.5 4C6.67157 4 6 3.32843 6 2.5H5C5 3.88071 6.11929 5 7.5 5V4ZM9 2.5C9 3.32843 8.32843 4 7.5 4V5C8.88071 5 10 3.88071 10 2.5H9ZM7.5 1C8.32843 1 9 1.67157 9 2.5H10C10 1.11929 8.88071 0 7.5 0V1ZM7.5 0C6.11929 0 5 1.11929 5 2.5H6C6 1.67157 6.67157 1 7.5 1V0Z" fill="currentColor"/></svg>`,
};

/**
 * Maximum results per category.
 */
const MAX_RESULTS = {
    features: 5,
    models3d: 3,
    streetview: 3,
    places: 3,
};

/**
 * Redesigned search bar component.
 */
export class SearchBarComponent {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.stateManager - StateManager instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.map - MapLibre map instance
     * @param {Object} [dependencies.uiManager] - UIManager instance
     * @param {Object} [dependencies.selectionManager] - SelectionManager instance
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._map = dependencies.map;
        this._uiManager = dependencies.uiManager;
        this._selectionManager = dependencies.selectionManager;

        this._container = null;
        this._input = null;
        this._clearBtn = null;
        this._resultsDropdown = null;
        this._marker = null;
        this._currentApiResult = null;

        this._debounceTimer = null;
        this._isSearching = false;
        this._abortController = null;

        // Track if we opened the feature panel for API result
        this._apiResultPanelOpen = false;

        setupCleanup(this);
    }

    /**
     * Initializes and attaches the search bar to DOM.
     * @param {HTMLElement} parentElement - Parent element
     */
    init(parentElement) {
        this._createElements();
        this._setupEventListeners();
        parentElement.appendChild(this._container);
        this._updatePosition();
    }

    /**
     * Creates the search bar DOM elements.
     * @private
     */
    _createElements() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'search-bar-container';
        this._container.id = 'search-bar-redesign';

        // Search wrapper (input + icons)
        const searchWrapper = document.createElement('div');
        searchWrapper.className = 'search-bar-wrapper';

        // Search icon
        const searchIcon = document.createElement('div');
        searchIcon.className = 'search-bar-icon';
        searchIcon.innerHTML = SEARCH_ICONS.search;

        // Input
        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.className = 'search-bar-input';
        this._input.placeholder = 'Buscar lugares, modelos, coordenadas...';
        this._input.autocomplete = 'off';
        this._input.spellcheck = false;

        // Clear button
        this._clearBtn = document.createElement('button');
        this._clearBtn.className = 'search-bar-clear';
        this._clearBtn.innerHTML = SEARCH_ICONS.clear;
        this._clearBtn.title = 'Limpar busca';
        this._clearBtn.style.display = 'none';

        // Assemble wrapper
        searchWrapper.appendChild(searchIcon);
        searchWrapper.appendChild(this._input);
        searchWrapper.appendChild(this._clearBtn);

        // Results dropdown
        this._resultsDropdown = document.createElement('div');
        this._resultsDropdown.className = 'search-bar-results';
        this._resultsDropdown.style.display = 'none';

        // Assemble container
        this._container.appendChild(searchWrapper);
        this._container.appendChild(this._resultsDropdown);
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Input events
        addDomListener(this, this._input, 'input', () => this._onInputChange());
        addDomListener(this, this._input, 'focus', () => this._onInputFocus());
        addDomListener(this, this._input, 'blur', () => this._onInputBlur());
        addDomListener(this, this._input, 'keydown', (e) => this._onKeyDown(e));

        // Clear button
        addDomListener(this, this._clearBtn, 'click', () => this._clearSearch());

        // Sidebar state changes
        subscribe(this, this._eventBus, EventTypes.SIDEBAR_EXPANDED, () => this._updatePosition());
        subscribe(this, this._eventBus, EventTypes.SIDEBAR_COLLAPSED, () => this._updatePosition());
        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_OPENED, () => this._updatePosition());
        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_CLOSED, () => this._updatePosition());

        // Listen to generic layout changes (covers vector info panel and other cases)
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED, () => this._updatePosition());

        // Listen for feature panel close to remove API result marker
        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_CLOSED, () => this._onFeaturePanelClosed());
    }

    /**
     * Handles input change with debounce.
     * @private
     */
    _onInputChange() {
        const value = this._input.value;

        // Show/hide clear button
        this._clearBtn.style.display = value.length > 0 ? 'flex' : 'none';

        // Debounced search
        clearTimeout(this._debounceTimer);

        if (value.length < 2) {
            this._hideResults();
            return;
        }

        this._debounceTimer = setTimeout(() => {
            this._performSearch(value);
        }, 300);
    }

    /**
     * Handles input focus.
     * @private
     */
    _onInputFocus() {
        this._container.classList.add('focused');

        // Show results if we have cached results
        if (this._input.value.length >= 2 && this._resultsDropdown.children.length > 0) {
            this._resultsDropdown.style.display = 'block';
        }
    }

    /**
     * Handles input blur.
     * @private
     */
    _onInputBlur() {
        this._container.classList.remove('focused');

        // Delay hiding to allow click on results
        setTimeout(() => {
            this._hideResults();
        }, 200);
    }

    /**
     * Handles keyboard navigation.
     * @private
     * @param {KeyboardEvent} e - Keyboard event
     */
    _onKeyDown(e) {
        if (e.key === 'Escape') {
            this._clearSearch();
            this._input.blur();
        }
    }

    /**
     * Performs the search with progressive results display.
     * Shows local features, 3D models and Streetview markers first, then loads API results.
     * @private
     * @param {string} query - Search query
     */
    async _performSearch(query) {
        if (this._isSearching) return;
        this._isSearching = true;
        this._container.classList.add('searching');

        // Search 3D models and Streetview markers immediately (synchronous)
        const model3dResults = this._search3DModels(query);
        const streetviewResults = this._searchStreetViewMarkers(query);

        // Search local features from store (async but fast)
        let featureResults = [];
        try {
            featureResults = await this._searchLocalFeatures(query);
        } catch (error) {
            console.warn('[SearchBar] Local features search failed:', error);
        }

        // Combine local results: features first, then 3D models, then streetview
        const localResults = [...featureResults, ...model3dResults, ...streetviewResults];

        // Show local results if found, otherwise show loading
        if (localResults.length > 0) {
            this._displayResults(localResults, true); // true = still loading API
        } else {
            this._showLoading();
        }

        // Search API (places/coordinates) - async
        // Only search API if apisearch feature is enabled
        let apiResults = [];
        if (config.features?.apisearch !== false && config.search?.apiUrl) {
            try {
                apiResults = await this._searchAPI(query);
            } catch (error) {
                // Ignore abort errors (user cancelled)
                if (error.name === 'AbortError') {
                    return;
                }
                console.warn('[SearchBar] API search failed:', error);
            }
        }

        // Check if search was cancelled while waiting
        if (!this._isSearching) {
            return;
        }

        this._isSearching = false;
        this._container.classList.remove('searching');

        // Combine all results: local results first, then API
        const allResults = [...localResults, ...apiResults];

        if (allResults.length > 0) {
            this._displayResults(allResults, false);
        } else {
            this._showNoResults();
        }
    }

    /**
     * Searches local features from the store.
     * @private
     * @param {string} query - Search query
     * @returns {Promise<Array>} Search results
     */
    async _searchLocalFeatures(query) {
        const results = [];
        const normalizedQuery = query.toLowerCase();

        try {
            const allFeatures = await getCurrentMapFeatures();
            const storageTypes = getAllStorageTypes();

            for (const storageType of storageTypes) {
                const features = allFeatures[storageType] || [];

                for (const feature of features) {
                    const matchInfo = this._featureMatchesQuery(feature, normalizedQuery);
                    if (matchInfo) {
                        const name = feature.properties?.name || feature.properties?.nome || 'Sem nome';
                        results.push({
                            type: 'feature',
                            subtype: storageType,
                            name: name,
                            layer: getFeatureDisplayNameFromStorage(storageType),
                            matchedField: matchInfo.field,
                            coordinates: this._getFeatureCenter(feature),
                            feature: feature,
                        });

                        if (results.length >= MAX_RESULTS.features) {
                            return results;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[SearchBar] Error searching local features:', error);
        }

        return results;
    }

    /**
     * Checks if a feature matches the search query.
     * @private
     * @param {Object} feature - GeoJSON feature
     * @param {string} normalizedQuery - Lowercase search query
     * @returns {Object|null} Match info with field name, or null if no match
     */
    _featureMatchesQuery(feature, normalizedQuery) {
        const props = feature.properties;
        if (!props) return null;

        // Check name/nome
        const name = props.name || props.nome || '';
        if (name.toLowerCase().includes(normalizedQuery)) {
            return { field: 'nome' };
        }

        // Check description/descricao
        const description = props.description || props.descricao || '';
        if (description.toLowerCase().includes(normalizedQuery)) {
            return { field: 'descrição' };
        }

        // Check attributes object
        if (props.attributes && typeof props.attributes === 'object') {
            for (const [key, value] of Object.entries(props.attributes)) {
                if (value && typeof value === 'string' && value.toLowerCase().includes(normalizedQuery)) {
                    return { field: `atributo: ${key}` };
                }
            }
        }

        return null;
    }

    /**
     * Searches 3D models from config.
     * @private
     * @param {string} query - Search query
     * @returns {Array} Search results
     */
    _search3DModels(query) {
        if (!config.tilesets || config.tilesets.length === 0) {
            return [];
        }

        const normalizedQuery = query.toLowerCase();

        return config.tilesets
            .filter(tileset => tileset.name?.toLowerCase().includes(normalizedQuery))
            .slice(0, MAX_RESULTS.models3d)
            .map(tileset => ({
                type: '3d-model',
                name: tileset.name,
                tilesetId: tileset.id,
                coordinates: tileset.locate ? [tileset.locate.lon, tileset.locate.lat] : null,
                dataCaptura: tileset.data_captura,
            }));
    }

    /**
     * Searches streetview markers from config.
     * @private
     * @param {string} query - Search query
     * @returns {Array} Search results
     */
    _searchStreetViewMarkers(query) {
        if (!config.streetViewMarkers || config.streetViewMarkers.length === 0) {
            return [];
        }

        const normalizedQuery = query.toLowerCase();

        return config.streetViewMarkers
            .filter(marker => marker.name?.toLowerCase().includes(normalizedQuery))
            .slice(0, MAX_RESULTS.streetview)
            .map(marker => ({
                type: 'streetview-marker',
                name: marker.name,
                markerId: marker.id,
                coordinates: marker.locate ? [marker.locate.lon, marker.locate.lat] : null,
                dataCaptura: marker.data_captura,
            }));
    }

    /**
     * Searches external API.
     * @private
     * @param {string} query - Search query
     * @returns {Promise<Array>} Search results
     */
    async _searchAPI(query) {
        // Cancel any pending request
        this._cancelPendingRequest();

        // Create new abort controller for this request
        this._abortController = new AbortController();

        const center = this._map.getCenter();
        const url = `${config.search.apiUrl}?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}`;

        const response = await fetch(url, {
            signal: this._abortController.signal
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) return [];

        return data
            .filter(item => item.nome && item.longitude && item.latitude)
            .slice(0, MAX_RESULTS.places)
            .map(item => ({
                type: 'place',
                name: item.nome,
                description: `${item.municipio || ''}, ${item.estado || ''}`.trim().replace(/^,|,$/g, ''),
                coordinates: [item.longitude, item.latitude],
                original: item,
            }));
    }

    /**
     * Cancels any pending API request.
     * @private
     */
    _cancelPendingRequest() {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    /**
     * Shows loading state in results dropdown.
     * @private
     */
    _showLoading() {
        this._resultsDropdown.innerHTML = `
            <div class="search-loading">
                <div class="search-loading-spinner"></div>
                <span>Pesquisando...</span>
            </div>
        `;
        this._resultsDropdown.style.display = 'block';
        this._container.classList.add('has-results');
    }

    /**
     * Displays search results.
     * @private
     * @param {Array} results - Search results
     * @param {boolean} [stillLoading=false] - Whether API is still loading
     */
    _displayResults(results, stillLoading = false) {
        this._resultsDropdown.innerHTML = '';

        results.forEach(result => {
            const item = document.createElement('button');
            item.className = 'search-result-item';
            item.dataset.type = result.type;

            const icon = this._getResultIcon(result.type, result.subtype);
            const subtitle = result.layer || result.description || result.dataCaptura || '';

            item.innerHTML = `
                <div class="search-result-icon">${icon}</div>
                <div class="search-result-content">
                    <div class="search-result-name">${this._escapeHtml(result.name)}</div>
                    ${subtitle ? `<div class="search-result-subtitle">${this._escapeHtml(subtitle)}</div>` : ''}
                </div>
            `;

            addDomListener(this, item, 'mousedown', (e) => {
                e.preventDefault();
                this._selectResult(result);
            });

            this._resultsDropdown.appendChild(item);
        });

        // Show loading indicator if still fetching API results
        if (stillLoading) {
            const loadingItem = document.createElement('div');
            loadingItem.className = 'search-loading';
            loadingItem.innerHTML = `
                <div class="search-loading-spinner"></div>
                <span>Pesquisando...</span>
            `;
            this._resultsDropdown.appendChild(loadingItem);
        }

        this._resultsDropdown.style.display = 'block';
        this._container.classList.add('has-results');
    }

    /**
     * Shows no results message.
     * @private
     */
    _showNoResults() {
        this._resultsDropdown.innerHTML = `
            <div class="search-no-results">
                Nenhum resultado encontrado
            </div>
        `;
        this._resultsDropdown.style.display = 'block';
        this._container.classList.add('has-results');
    }

    /**
     * Hides results dropdown and cancels pending requests.
     * @private
     */
    _hideResults() {
        this._cancelPendingRequest();
        this._resultsDropdown.style.display = 'none';
        this._container.classList.remove('has-results');
    }

    /**
     * Selects a search result.
     * @private
     * @param {Object} result - Selected result
     */
    _selectResult(result) {
        this._hideResults();
        this._clearSearchInput();

        // Remove existing marker
        this._removeMarker();

        // Handle 3D model
        if (result.type === '3d-model') {
            if (window.modelsViewerControl) {
                window.modelsViewerControl.navigateToModel(result.tilesetId);
            }
            return;
        }

        // Handle Streetview marker
        if (result.type === 'streetview-marker') {
            if (window.streetViewControl) {
                window.streetViewControl.navigateToStreetViewMarker(result.markerId);
            }
            return;
        }

        // Handle local feature - zoom and select using FeatureNavigationUtils
        if (result.type === 'feature' && result.feature) {
            this._selectLocalFeature(result);
            return;
        }

        // Handle API results (places) - fly to coordinates, add marker, and open sidepanel
        if (result.coordinates) {
            this._map.flyTo({
                center: result.coordinates,
                zoom: 14,
                essential: true,
            });

            // Store the current API result for later use
            this._currentApiResult = result;

            // Create marker (without popup)
            this._marker = new maplibregl.Marker()
                .setLngLat(result.coordinates)
                .addTo(this._map);

            // Open sidepanel with API result content
            this._openApiResultInSidepanel(result);
        }
    }

    /**
     * Opens the API search result in the sidebar feature panel.
     * @private
     * @param {Object} result - API search result
     */
    _openApiResultInSidepanel(result) {
        // Mark that we opened the panel for an API result
        this._apiResultPanelOpen = true;

        // Emit event to open the feature panel with search result content
        const eventBus = getEventBus();
        if (eventBus) {
            // Emit a custom event for search result panel
            eventBus.emit(EventTypes.SEARCH_RESULT_PANEL_REQUESTED, {
                result: result,
                content: this._createApiResultSidepanelContent(result)
            });
        }
    }

    /**
     * Called when feature panel is closed.
     * Removes the API result marker if we opened the panel.
     * @private
     */
    _onFeaturePanelClosed() {
        if (this._apiResultPanelOpen) {
            this._removeMarker();
            this._apiResultPanelOpen = false;
            this._currentApiResult = null;
        }
    }

    /**
     * Creates sidepanel content for API search results.
     * @private
     * @param {Object} result - API search result
     * @returns {HTMLElement} Sidepanel content element
     */
    _createApiResultSidepanelContent(result) {
        const container = document.createElement('div');
        container.className = 'search-result-sidepanel-content';

        // Identification section (similar to feature-identification)
        const identification = document.createElement('div');
        identification.className = 'feature-identification';

        // Icon
        const iconContainer = document.createElement('div');
        iconContainer.className = 'feature-identification-icon feature-icon-bg-orange';
        iconContainer.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
            </svg>
        `;

        // Info
        const info = document.createElement('div');
        info.className = 'feature-identification-info';

        const nameContainer = document.createElement('div');
        nameContainer.className = 'feature-identification-name-container';

        const name = document.createElement('div');
        name.className = 'feature-identification-name';
        name.textContent = result.name || 'Resultado da Busca';
        nameContainer.appendChild(name);

        const typeText = document.createElement('div');
        typeText.className = 'feature-identification-type';
        typeText.textContent = result.original?.tipo || 'Local';

        const layerText = document.createElement('div');
        layerText.className = 'feature-identification-layer';
        layerText.textContent = result.description || '';

        info.appendChild(nameContainer);
        info.appendChild(typeText);
        info.appendChild(layerText);

        identification.appendChild(iconContainer);
        identification.appendChild(info);
        container.appendChild(identification);

        // Properties section
        const propertiesSection = document.createElement('div');
        propertiesSection.className = 'search-result-properties-section';

        const propertiesHeader = document.createElement('div');
        propertiesHeader.className = 'search-result-section-header';
        propertiesHeader.textContent = 'Informações';
        propertiesSection.appendChild(propertiesHeader);

        const propertiesList = document.createElement('ul');
        propertiesList.className = 'search-result-properties-list';

        const original = result.original || {};
        const infoItems = [
            { label: 'Classe', value: original.tipo },
            { label: 'Município', value: original.municipio },
            { label: 'Estado', value: original.estado },
            { label: 'Latitude', value: result.coordinates?.[1]?.toFixed(6) },
            { label: 'Longitude', value: result.coordinates?.[0]?.toFixed(6) }
        ].filter(item => item.value);

        infoItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'search-result-property-item';
            li.innerHTML = `
                <span class="search-result-property-label">${item.label}</span>
                <span class="search-result-property-value">${this._escapeHtml(String(item.value))}</span>
            `;
            propertiesList.appendChild(li);
        });

        propertiesSection.appendChild(propertiesList);
        container.appendChild(propertiesSection);

        // Save as feature button section
        const saveSection = document.createElement('div');
        saveSection.className = 'search-result-save-section';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'search-result-save-btn';
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
            </svg>
            Salvar como Feição
        `;
        saveBtn.title = 'Salvar este resultado como uma feição ponto no mapa';
        saveBtn.onclick = () => this._saveApiResultAsFeature(result);

        saveSection.appendChild(saveBtn);
        container.appendChild(saveSection);

        return container;
    }

    /**
     * Converts an API search result into a point feature and saves it.
     * @private
     * @param {Object} result - API search result
     */
    async _saveApiResultAsFeature(result) {
        try {
            const original = result.original || {};
            const featureId = IDUtils.generateUniqueId();

            // Build attributes from API result
            const attributes = {};
            if (original.tipo) attributes.classe = original.tipo;
            if (original.municipio) attributes.municipio = original.municipio;
            if (original.estado) attributes.estado = original.estado;

            // Add any other properties from original that we haven't captured
            const knownProps = ['nome', 'tipo', 'municipio', 'estado', 'longitude', 'latitude'];
            Object.keys(original).forEach(key => {
                if (!knownProps.includes(key) && original[key] !== undefined && original[key] !== null) {
                    attributes[key] = original[key];
                }
            });

            const feature = {
                type: 'Feature',
                id: Date.now().toString(),
                properties: {
                    id: featureId,
                    layerId: getActiveLayerIdSync(),
                    source: 'point',
                    nome: result.name || 'Ponto de Busca',
                    descricao: `Importado da busca: ${original.tipo || 'Local'}`,
                    fillColor: '#e74c3c',
                    size: 12,
                    opacity: 1,
                    visivel: true,
                    bloqueado: false,
                    attributes: attributes
                },
                geometry: {
                    type: 'Point',
                    coordinates: result.coordinates
                }
            };

            // Save to store
            await addFeature('points', feature);

            // Update map source
            const source = this._map.getSource('points');
            if (source) {
                const data = await source.getData();
                data.features.push(feature);
                source.setData(data);
            }

            // Disable API result panel flag before closing
            // This prevents marker removal when we close the panel to select the new feature
            this._apiResultPanelOpen = false;

            // Remove the temporary marker
            this._removeMarker();

            // Close the feature panel (via StateManager)
            if (this._stateManager) {
                this._stateManager.closeFeaturePanel();
            }

            // Select the new feature
            if (this._selectionManager) {
                await this._selectionManager.toggleFeatureSelection('point', featureId, feature);
                this._selectionManager.updateUI();
            }

            // Clear the current API result
            this._currentApiResult = null;

        } catch (error) {
            console.error('[SearchBar] Error saving API result as feature:', error);
            alert('Erro ao salvar feição. Tente novamente.');
        }
    }

    /**
     * Selects a local feature: zoom to it and open attributes panel.
     * @private
     * @param {Object} result - Search result with feature data
     */
    async _selectLocalFeature(result) {
        const feature = result.feature;
        const featureId = feature.properties?.id;
        const storageType = result.subtype;

        if (!featureId || !storageType || !this._selectionManager) {
            // Fallback: just zoom to coordinates
            if (result.coordinates) {
                this._map.flyTo({
                    center: result.coordinates,
                    zoom: 14,
                    essential: true,
                });
            }
            return;
        }

        try {
            await FeatureNavigationUtils.zoomAndSelectFeature(
                feature,
                this._map,
                this._selectionManager,
                storageType,
                featureId
            );
        } catch (error) {
            console.warn('[SearchBar] Error selecting feature:', error);
            // Fallback: just zoom
            if (result.coordinates) {
                await FeatureNavigationUtils.zoomToFeature(feature, this._map);
            }
        }
    }

    /**
     * Clears the search input text.
     * @private
     */
    _clearSearchInput() {
        this._input.value = '';
        this._clearBtn.style.display = 'none';
    }

    /**
     * Clears the search and cancels pending requests.
     * @private
     */
    _clearSearch() {
        this._cancelPendingRequest();
        this._input.value = '';
        this._clearBtn.style.display = 'none';
        this._hideResults();
        this._removeMarker();
        clearTimeout(this._debounceTimer);
        this._isSearching = false;
        this._container.classList.remove('searching');
        this._currentApiResult = null;
        this._apiResultPanelOpen = false;
    }

    /**
     * Removes the map marker.
     * @private
     */
    _removeMarker() {
        if (this._marker) {
            this._marker.remove();
            this._marker = null;
        }
    }

    /**
     * Updates position based on sidebar state.
     * @private
     */
    _updatePosition() {
        if (!this._container) return;

        const sidebarExpanded = this._stateManager?.get('sidebar.expanded') || false;
        const featurePanelOpen = this._stateManager?.get('ui.featurePanelOpen') || false;

        this._container.dataset.sidebarState =
            (sidebarExpanded || featurePanelOpen) ? 'expanded' : 'collapsed';
    }

    /**
     * Gets icon for result type.
     * @private
     * @param {string} type - Result type
     * @param {string} subtype - Result subtype
     * @returns {string} SVG icon
     */
    _getResultIcon(type, subtype) {
        switch (type) {
            case '3d-model':
                return SEARCH_ICONS.model3d;
            case 'streetview-marker':
                return SEARCH_ICONS.streetview;
            case 'place':
                return SEARCH_ICONS.place;
            case 'coordinate':
                return SEARCH_ICONS.coordinate;
            case 'feature':
                if (subtype?.includes('military')) {
                    return SEARCH_ICONS.military;
                }
                return SEARCH_ICONS.feature;
            default:
                return SEARCH_ICONS.feature;
        }
    }

    /**
     * Gets center coordinates of a feature.
     * @private
     * @param {Object} feature - GeoJSON feature
     * @returns {Array|null} [lng, lat] or null
     */
    _getFeatureCenter(feature) {
        const geom = feature.geometry;
        if (!geom) return null;

        if (geom.type === 'Point') {
            return geom.coordinates;
        }

        // Calculate centroid for other geometry types
        if (geom.type === 'Polygon' && geom.coordinates[0]) {
            const coords = geom.coordinates[0];
            const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
            return [sum[0] / coords.length, sum[1] / coords.length];
        }

        if (geom.type === 'LineString' && geom.coordinates.length > 0) {
            const mid = Math.floor(geom.coordinates.length / 2);
            return geom.coordinates[mid];
        }

        return null;
    }

    /**
     * Escapes HTML special characters.
     * @private
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
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
     */
    destroy() {
        clearTimeout(this._debounceTimer);
        this._removeMarker();
        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
