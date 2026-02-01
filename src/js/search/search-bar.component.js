// Path: js/search/search-bar.component.js

/**
 * @fileoverview Redesigned search bar component (Google Maps style).
 * Always visible input with dynamic positioning based on sidebar state.
 * API results open in the sidebar feature panel with a "Save as Feature" button.
 *
 * @module search/search-bar.component
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
import { addFeature, getActiveLayerIdSync } from '../store/store.js';
import { FeatureNavigationUtils } from '../utilities/feature_navigation_utils.js';
import { IDUtils } from '../utilities/id_utils.js';
import { getEventBus } from '../store/services.js';
import { getControl } from '../store/control.registry.js';

// Extracted modules
import { SEARCH_ICONS } from './search-bar.icons.js';
import {
    searchCoordinates,
    searchLocalFeatures,
    search3DModels,
    searchStreetViewMarkers,
    searchAPI
} from './search-bar.search-providers.js';
import {
    createCoordinateResultContent,
    createApiResultContent
} from './search-bar.sidepanel-content.js';

// ============================================================================
// SEARCH BAR COMPONENT
// ============================================================================

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

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

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
        this._input.placeholder = 'Buscar lugares, modelos, feições...';
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

        // Listen to generic layout changes
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED, () => this._updatePosition());

        // Listen for feature panel close to remove API result marker
        subscribe(this, this._eventBus, EventTypes.FEATURE_PANEL_CLOSED, () => this._onFeaturePanelClosed());
    }

    // ========================================================================
    // INPUT HANDLERS
    // ========================================================================

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

    // ========================================================================
    // SEARCH LOGIC
    // ========================================================================

    /**
     * Performs the search with progressive results display.
     * @private
     * @param {string} query - Search query
     */
    async _performSearch(query) {
        if (this._isSearching) return;
        this._isSearching = true;
        this._container.classList.add('searching');

        // Try to detect coordinates first (highest priority)
        let coordinateResults = [];
        try {
            coordinateResults = await searchCoordinates(query);
        } catch (error) {
            console.warn('[SearchBar] Coordinate search failed:', error);
        }

        // Search 3D models and Streetview markers immediately (synchronous)
        const model3dResults = search3DModels(query);
        const streetviewResults = searchStreetViewMarkers(query);

        // Search local features from store (async but fast)
        let featureResults = [];
        try {
            featureResults = await searchLocalFeatures(query);
        } catch (error) {
            console.warn('[SearchBar] Local features search failed:', error);
        }

        // Combine local results
        const localResults = [...coordinateResults, ...featureResults, ...model3dResults, ...streetviewResults];

        // Show local results if found, otherwise show loading
        if (localResults.length > 0) {
            this._displayResults(localResults, true);
        } else {
            this._showLoading();
        }

        // Search API (places) - async
        let apiResults = [];
        if (coordinateResults.length === 0 && config.features?.apisearch !== false && config.search?.apiUrl) {
            try {
                // Cancel any pending request
                this._cancelPendingRequest();
                this._abortController = new AbortController();

                apiResults = await searchAPI(query, this._map, this._abortController.signal);
            } catch (error) {
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

        // Combine all results
        const allResults = [...localResults, ...apiResults];

        if (allResults.length > 0) {
            this._displayResults(allResults, false);
        } else {
            this._showNoResults();
        }
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

    // ========================================================================
    // RESULTS DISPLAY
    // ========================================================================

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

    // ========================================================================
    // RESULT SELECTION
    // ========================================================================

    /**
     * Selects a search result.
     * @private
     * @param {Object} result - Selected result
     */
    _selectResult(result) {
        this._hideResults();
        this._clearSearchInput();
        this._removeMarker();

        // Handle 3D model
        if (result.type === '3d-model') {
            const modelsViewerControl = getControl('modelsViewer');
            if (modelsViewerControl) {
                modelsViewerControl.navigateToModel(result.tilesetId);
            }
            return;
        }

        // Handle Streetview marker
        if (result.type === 'streetview-marker') {
            const streetViewControl = getControl('streetView');
            if (streetViewControl) {
                streetViewControl.navigateToStreetViewMarker(result.markerId);
            }
            return;
        }

        // Handle local feature
        if (result.type === 'feature' && result.feature) {
            this._selectLocalFeature(result);
            return;
        }

        // Handle coordinate results
        if (result.type === 'coordinate' && result.coordinates) {
            this._handleCoordinateResult(result);
            return;
        }

        // Handle API results (places)
        if (result.coordinates) {
            this._handleApiResult(result);
        }
    }

    /**
     * Handles coordinate result selection.
     * @private
     * @param {Object} result - Coordinate result
     */
    _handleCoordinateResult(result) {
        this._map.flyTo({
            center: result.coordinates,
            zoom: Math.max(this._map.getZoom(), 14),
            essential: true,
        });

        this._currentApiResult = result;
        this._marker = new maplibregl.Marker()
            .setLngLat(result.coordinates)
            .addTo(this._map);

        this._openCoordinateResultInSidepanel(result);
    }

    /**
     * Handles API result selection.
     * @private
     * @param {Object} result - API result
     */
    _handleApiResult(result) {
        this._map.flyTo({
            center: result.coordinates,
            zoom: 14,
            essential: true,
        });

        this._currentApiResult = result;
        this._marker = new maplibregl.Marker()
            .setLngLat(result.coordinates)
            .addTo(this._map);

        this._openApiResultInSidepanel(result);
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
            if (result.coordinates) {
                await FeatureNavigationUtils.zoomToFeature(feature, this._map);
            }
        }
    }

    // ========================================================================
    // SIDEPANEL INTEGRATION
    // ========================================================================

    /**
     * Opens the API search result in the sidebar feature panel.
     * @private
     * @param {Object} result - API search result
     */
    _openApiResultInSidepanel(result) {
        this._apiResultPanelOpen = true;

        const eventBus = getEventBus();
        if (eventBus) {
            const content = createApiResultContent(result, {
                onSaveAsFeature: (r) => this._saveApiResultAsFeature(r)
            });

            eventBus.emit(EventTypes.SEARCH_RESULT_PANEL_REQUESTED, {
                result: result,
                content: content
            });
        }
    }

    /**
     * Opens the coordinate search result in the sidebar feature panel.
     * @private
     * @param {Object} result - Coordinate search result
     */
    _openCoordinateResultInSidepanel(result) {
        this._apiResultPanelOpen = true;

        const eventBus = getEventBus();
        if (eventBus) {
            const content = createCoordinateResultContent(result, {
                onCreatePoint: (r) => this._createPointAtCoordinate(r),
                onCreateMilitarySymbol: (r) => this._createMilitarySymbolAtCoordinate(r),
                onCreateCoordinationMeasure: (r) => this._createCoordinationMeasureAtCoordinate(r)
            });

            eventBus.emit(EventTypes.SEARCH_RESULT_PANEL_REQUESTED, {
                result: result,
                content: content
            });
        }
    }

    /**
     * Called when feature panel is closed.
     * @private
     */
    _onFeaturePanelClosed() {
        if (this._apiResultPanelOpen) {
            this._removeMarker();
            this._apiResultPanelOpen = false;
            this._currentApiResult = null;
        }
    }

    // ========================================================================
    // FEATURE CREATION
    // ========================================================================

    /**
     * Creates a point at the coordinate result location.
     * @private
     * @param {Object} result - Coordinate search result
     */
    async _createPointAtCoordinate(result) {
        const [lng, lat] = result.coordinates;
        this._closeCoordinatePanel();

        try {
            const pointControl = getControl('AddPointControl');
            if (pointControl && typeof pointControl.createPointAtCoordinates === 'function') {
                await pointControl.createPointAtCoordinates(lng, lat);
            } else {
                console.warn('[SearchBar] PointControl not available');
            }
        } catch (error) {
            console.error('[SearchBar] Error creating point:', error);
        }
    }

    /**
     * Creates a military symbol at the coordinate result location.
     * @private
     * @param {Object} result - Coordinate search result
     */
    async _createMilitarySymbolAtCoordinate(result) {
        const [lng, lat] = result.coordinates;
        this._closeCoordinatePanel();

        try {
            const militarySymbolControl = getControl('AddMilitarySymbolControl');
            if (militarySymbolControl && typeof militarySymbolControl.createMilitarySymbolFeature === 'function') {
                await militarySymbolControl.createMilitarySymbolFeature({ lng, lat });
            } else {
                console.warn('[SearchBar] MilitarySymbolControl not available');
            }
        } catch (error) {
            console.error('[SearchBar] Error creating military symbol:', error);
        }
    }

    /**
     * Creates a coordination measure at the coordinate result location.
     * @private
     * @param {Object} result - Coordinate search result
     */
    async _createCoordinationMeasureAtCoordinate(result) {
        const [lng, lat] = result.coordinates;
        this._closeCoordinatePanel();

        try {
            const coordinationMeasureControl = getControl('AddCoordinationMeasureControl');
            if (coordinationMeasureControl && typeof coordinationMeasureControl.createCoordinationMeasureFeature === 'function') {
                await coordinationMeasureControl.createCoordinationMeasureFeature({ lng, lat });
            } else {
                console.warn('[SearchBar] CoordinationMeasureControl not available');
            }
        } catch (error) {
            console.error('[SearchBar] Error creating coordination measure:', error);
        }
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

            // Add any other properties from original
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
            this._apiResultPanelOpen = false;
            this._removeMarker();

            // Close the feature panel
            if (this._stateManager) {
                this._stateManager.closeFeaturePanel();
            }

            // Select the new feature
            if (this._selectionManager) {
                await this._selectionManager.toggleFeatureSelection('point', featureId, feature);
                this._selectionManager.updateUI();
            }

            this._currentApiResult = null;

        } catch (error) {
            console.error('[SearchBar] Error saving API result as feature:', error);
            alert('Erro ao salvar feição. Tente novamente.');
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Closes the coordinate panel and cleans up.
     * @private
     */
    _closeCoordinatePanel() {
        this._apiResultPanelOpen = false;
        this._removeMarker();
        this._currentApiResult = null;

        if (this._stateManager) {
            this._stateManager.closeFeaturePanel();
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
