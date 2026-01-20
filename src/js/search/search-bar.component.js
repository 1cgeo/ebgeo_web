// Path: js/search/search-bar.component.js

/**
 * @fileoverview Redesigned search bar component (Google Maps style).
 * Always visible input with dynamic positioning based on sidebar state.
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

    // 3D Model - same as toolbar/bottom-controls (layers icon)
    model3d: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,

    // Streetview - camera/panorama icon
    streetview: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
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
     */
    constructor(dependencies) {
        this._stateManager = dependencies.stateManager;
        this._eventBus = dependencies.eventBus;
        this._map = dependencies.map;
        this._uiManager = dependencies.uiManager;

        this._container = null;
        this._input = null;
        this._clearBtn = null;
        this._resultsDropdown = null;
        this._marker = null;

        this._debounceTimer = null;
        this._isSearching = false;
        this._abortController = null;

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
     * Shows 3D models and Streetview markers immediately, then loads API results.
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
        const immediateResults = [...model3dResults, ...streetviewResults];

        // Show immediate results if found, otherwise show loading
        if (immediateResults.length > 0) {
            this._displayResults(immediateResults, true); // true = still loading API
        } else {
            this._showLoading();
        }

        // Search API (places/coordinates) - async
        let apiResults = [];
        if (config.search?.apiUrl) {
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

        // Combine all results: 3D + Streetview first, then API
        const allResults = [...immediateResults, ...apiResults];

        if (allResults.length > 0) {
            this._displayResults(allResults, false);
        } else {
            this._showNoResults();
        }
    }

    /**
     * Searches local features on the map.
     * @private
     * @param {string} query - Search query
     * @returns {Array} Search results
     */
    _searchLocalFeatures(query) {
        const results = [];
        const normalizedQuery = query.toLowerCase();

        // Get features from map sources
        const sources = ['points', 'lines', 'polygons', 'military_symbols', 'coordination_measures'];

        sources.forEach(sourceName => {
            try {
                const source = this._map.getSource(sourceName);
                if (!source || !source._data) return;

                const features = source._data.features || [];
                features.forEach(feature => {
                    const name = feature.properties?.name || feature.properties?.nome || '';
                    if (name.toLowerCase().includes(normalizedQuery)) {
                        results.push({
                            type: 'feature',
                            subtype: sourceName,
                            name: name,
                            layer: this._getLayerDisplayName(sourceName),
                            coordinates: this._getFeatureCenter(feature),
                            feature: feature,
                        });
                    }
                });
            } catch (_e) {
                // Source may not exist
            }
        });

        return results.slice(0, MAX_RESULTS.features);
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
        this._input.value = result.name;
        this._clearBtn.style.display = 'flex';

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

        // Fly to coordinates
        if (result.coordinates) {
            this._map.flyTo({
                center: result.coordinates,
                zoom: 14,
                essential: true,
            });

            // Add marker
            this._marker = new maplibregl.Marker()
                .setLngLat(result.coordinates)
                .addTo(this._map);
        }

        // Handle feature selection
        if (result.type === 'feature' && result.feature) {
            // Trigger feature selection via UIManager
            if (this._uiManager) {
                this._uiManager.showFeatureSearchPanel(result.original || result.feature);
            }
        }
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
     * Gets display name for layer.
     * @private
     * @param {string} sourceName - Source name
     * @returns {string} Display name
     */
    _getLayerDisplayName(sourceName) {
        const names = {
            'points': 'Pontos',
            'lines': 'Linhas',
            'polygons': 'Poligonos',
            'military_symbols': 'Simbolos Militares',
            'coordination_measures': 'Medidas de Coordenacao',
        };
        return names[sourceName] || sourceName;
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

export default SearchBarComponent;
