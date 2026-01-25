// Path: js/coordinates/mouse-coordinates.control.js
import {
    COORDINATE_FORMATS,
    getPlaceholderForFormat,
    parseCoordinates,
    formatCoordinates,
    getDisplayFormat
} from '../utilities';
import { getTerrainElevation } from '../terrain';
import { GridControl } from '../grid';
import { FrameControl } from '../frame';
import config from '../config.js';
import { getStateManager } from '../store';

/** Throttle interval for coordinate updates (50ms = ~20 FPS, sufficient for display) */
const COORDINATE_UPDATE_THROTTLE_MS = 50;

/** Maximum number of coordinate parts to display (for DOM element pooling) */
const MAX_COORDINATE_PARTS = 6;

class MouseCoordinatesControl {
    constructor(pointControl, coordinationMeasureControl, militarySymbolControl) {
        this._map = null;
        this._container = null;
        this._innerContainer = null;
        this._formatSelector = null;
        this._coordinatesText = null;
        // Note: _currentFormat now delegated to StateManager via getter/setter
        this._formatOptions = COORDINATE_FORMATS;
        this._modal = null;
        this._currentCoordinates = { lat: 0, lng: 0 };
        this._pointControl = pointControl;
        this._coordinationMeasureControl = coordinationMeasureControl;
        this._militarySymbolControl = militarySymbolControl;

        // Note: _elevationEnabled and _currentElevation now delegated to StateManager
        this._terrainAvailable = false;
        this._elevationButton = null;
        this._debounceTimer = null;
        this._elevationAbortController = null;

        this.frameControl = null;
        this.gridControl = null;
        this._name = 'MouseCoordinatesControl';

        /** @type {Array<Function>} Cleanup functions for StateManager subscriptions */
        this._unsubscribers = [];

        /** @type {number} Counter to track latest update request and prevent race conditions */
        this._updateRequestId = 0;

        // Performance: Throttle state for mousemove
        /** @type {number} Last time coordinates were updated */
        this._lastCoordinateUpdate = 0;
        /** @type {number|null} Pending throttle timeout */
        this._coordinateThrottleTimeout = null;
        /** @type {{lat: number, lng: number}|null} Pending coordinates to process */
        this._pendingCoordinates = null;

        // Performance: Cached DOM elements to avoid recreation
        /** @type {HTMLSpanElement|null} Cached zoom span element */
        this._zoomSpan = null;
        /** @type {HTMLSpanElement[]} Pool of span elements for coordinate parts */
        this._coordSpanPool = [];
        /** @type {HTMLSpanElement|null} Cached elevation span element */
        this._elevationSpan = null;
        /** @type {number} Current number of visible spans in pool */
        this._visibleSpanCount = 0;

        // Performance: Cached StateManager reference
        /** @type {import('../state/state_manager.js').StateManager|null} */
        this._stateManagerRef = null;
    }

    // =========================================================================
    // PERFORMANCE: CACHED STATE MANAGER ACCESS
    // =========================================================================

    /**
     * Get cached StateManager reference.
     * Avoids repeated singleton lookups in hot paths.
     * @returns {import('../state/state_manager.js').StateManager|null}
     * @private
     */
    _getStateManager() {
        if (!this._stateManagerRef) {
            try {
                this._stateManagerRef = getStateManager();
            } catch (e) {
                return null;
            }
        }
        return this._stateManagerRef;
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get current coordinate format from StateManager.
     * Falls back to 'latlong' if StateManager unavailable.
     * @returns {string}
     */
    get _currentFormat() {
        const sm = this._getStateManager();
        return sm ? sm.getCoordinateFormat() : 'latlong';
    }

    /**
     * Set coordinate format in StateManager.
     * @param {string} value - Format identifier
     */
    set _currentFormat(value) {
        const sm = this._getStateManager();
        if (sm) {
            sm.setCoordinateFormat(value);
        }
    }

    /**
     * Get elevation enabled state from StateManager.
     * @returns {boolean}
     */
    get _elevationEnabled() {
        const sm = this._getStateManager();
        return sm ? sm.isElevationEnabled() : false;
    }

    /**
     * Set elevation enabled state in StateManager.
     * @param {boolean} value
     */
    set _elevationEnabled(value) {
        const sm = this._getStateManager();
        if (sm) {
            sm.setElevationEnabled(value);
        }
    }

    /**
     * Get current elevation from StateManager.
     * @returns {number|null}
     */
    get _currentElevation() {
        const sm = this._getStateManager();
        return sm ? sm.getElevation() : null;
    }

    /**
     * Set current elevation in StateManager.
     * @param {number|null} value
     */
    set _currentElevation(value) {
        const sm = this._getStateManager();
        if (sm) {
            sm.setElevation(value);
        }
    }

    // =========================================================================
    // SUBSCRIPTIONS
    // =========================================================================

    /**
     * Initialize StateManager subscriptions for reactive UI updates.
     * Allows other components to change format/elevation and have UI reflect it.
     * @private
     */
    _initSubscriptions() {
        const stateManager = this._getStateManager();
        if (!stateManager) return;

        try {

            // React to format changes from other UI components
            this._unsubscribers.push(
                stateManager.subscribe('mouse.format', (format) => {
                    this._updateFormatUI(format);
                })
            );

            // React to elevation toggle from other UI components
            this._unsubscribers.push(
                stateManager.subscribe('mouse.elevationEnabled', (enabled) => {
                    this._updateElevationButtonUI(enabled);
                })
            );
        } catch (e) {
            // StateManager not available yet - subscriptions will be skipped
        }
    }

    /**
     * Update format selector UI to reflect current format.
     * @private
     * @param {string} format - Format identifier
     */
    _updateFormatUI(format) {
        if (!this._formatSelector) return;

        this._formatSelector.querySelectorAll('.coordinates-format-option').forEach(opt => {
            if (opt.dataset.format === format) {
                opt.classList.add('active');
                opt.style.backgroundColor = '#f0f0f0';
                opt.style.fontWeight = 'bold';
            } else {
                opt.classList.remove('active');
                opt.style.backgroundColor = '';
                opt.style.fontWeight = '';
            }
        });

        // Also update coordinates display if map is available
        if (this._map) {
            this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
        }
    }

    /**
     * Update elevation button UI to reflect enabled state.
     * @private
     * @param {boolean} enabled
     */
    _updateElevationButtonUI(enabled) {
        if (!this._elevationButton) return;

        if (enabled && this._terrainAvailable) {
            this._elevationButton.style.backgroundColor = '#4CAF50';
            this._elevationButton.style.color = 'white';
        } else {
            this._elevationButton.style.backgroundColor = '';
            this._elevationButton.style.color = '';
        }

        // Update display if enabled state changed
        if (this._map) {
            this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
        }
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group coordinates-control';

        this._container.style.cssText = `
        position: fixed !important;
        bottom: 10px !important;
        left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 1000 !important;
            margin: 0 !important;
            `;

            this._innerContainer = document.createElement('div');
            this._innerContainer.className = 'coordinates-display';

        this._coordinatesText = document.createElement('div');
        this._coordinatesText.className = 'coordinates-text';

        // Performance: Pre-create DOM element pool to avoid allocation during updates
        this._initCoordinatesElementPool();

        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'coordinates-controls';

        const gridContainer = document.createElement('div');
        gridContainer.className = 'coordinates-controls';

        const flyToButton = document.createElement('div');
        flyToButton.className = 'coordinates-button coordinates-flyto-button';
        flyToButton.title = "Ir para coordenadas";
        flyToButton.innerHTML = `<img src="./images/fly_to_icon.svg" alt="Fly to" width="16" height="16" />`;
        flyToButton.addEventListener('click', this._openFlyToModal.bind(this));

        this._elevationButton = document.createElement('div');
        this._elevationButton.className = 'coordinates-button coordinates-elevation-button';
        this._elevationButton.title = "Mostrar elevação (terreno necessário)";
        this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" />`;
        this._elevationButton.style.fontSize = '14px';
        this._elevationButton.addEventListener('click', this._toggleElevation.bind(this));

        const gearButton = document.createElement('div');
        gearButton.className = 'coordinates-button coordinates-gear-button';
        gearButton.title = "Mudar formato de coordenadas";
        gearButton.innerHTML = `<img src="./images/gear_icon.svg" alt="Settings" width="16" height="16" />`;
        gearButton.addEventListener('click', this._toggleFormatSelector.bind(this));

        if (config.features.grid) {
            this.gridControl = new GridControl(map, gridContainer);
            const gridButton = document.createElement('div');
            gridButton.className = 'coordinates-button coordinates-grid-button';
            gridButton.title = "Ligar/desligar Quadrícula";
            gridButton.innerHTML = `<img src="./images/grid_icon.svg" alt="Toogle grid" width="16" height="16" />`;
            gridButton.addEventListener('click', this.gridControl._showGridMenu.bind(this.gridControl));
            this.gridControl.setButton(gridButton);
            gridContainer.appendChild(gridButton);
        }

        if (config.features.frame){
            this.frameControl = new FrameControl(map, gridContainer);
            const frameButton = document.createElement('div');
            frameButton.className = 'coordinates-button coordinates-grid-button';
            frameButton.title = "Ligar/desligar Produtos";
            frameButton.innerHTML = `<img src="./images/frame_icon.svg" alt="Toogle frame" width="16" height="16" />`;
            frameButton.addEventListener('click', this.frameControl._showFrameMenu.bind(this.frameControl));
            this.frameControl.setButton(frameButton);
            gridContainer.appendChild(frameButton);
        }

        this._formatSelector = document.createElement('div');
        this._formatSelector.className = 'coordinates-format-selector';

        this._formatOptions.forEach(format => {
            const option = document.createElement('div');
            option.className = 'coordinates-format-option';
            if (format.id === this._currentFormat) {
                option.classList.add('active');
            }
            option.textContent = format.label;
            option.dataset.format = format.id;

            option.addEventListener('click', (e) => {
                this._setFormat(format.id);
                this._formatSelector.style.display = 'none';
                e.stopPropagation();
            });
            option.addEventListener('mouseenter', () => {
                if (format.id !== this._currentFormat) {
                    option.style.backgroundColor = '#f0f0f0';
                }
            });
            option.addEventListener('mouseleave', () => {
                if (format.id !== this._currentFormat) {
                    option.style.backgroundColor = '';
                }
            });

            this._formatSelector.appendChild(option);
        });

        controlsContainer.appendChild(flyToButton);
        controlsContainer.appendChild(this._elevationButton);
        controlsContainer.appendChild(gearButton)
        if (config.features.grid || config.features.frame) {
            this._innerContainer.appendChild(gridContainer);
        }
        this._innerContainer.appendChild(this._coordinatesText);
        this._innerContainer.appendChild(controlsContainer);
        this._container.appendChild(this._innerContainer);
        this._container.appendChild(this._formatSelector);

        this._createFlyToModal();

        document.addEventListener('click', this._closeFormatSelector.bind(this));

        this._map.on('mousemove', this._onMouseMove.bind(this));

        this._checkTerrainAvailability();

        // Initialize StateManager subscriptions for reactive UI
        this._initSubscriptions();

        this._updateCoordinates(0, 0);

        return this._container;
    }

    async _checkTerrainAvailability() {
        this._map.on('terrain', this._onTerrainChange);
        this._onTerrainChange();
    }

    _onTerrainChange = () => {
        const terrainEnabled = this._map.getTerrain() !== null;

        this._terrainAvailable = terrainEnabled;

        if (terrainEnabled) {
            this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" />`;
            this._elevationButton.title = "Mostrar/ocultar elevação";
            this._elevationButton.disabled = false;
            // Sync button state with current elevation enabled state
            this._updateElevationButtonUI(this._elevationEnabled);
        } else {
            this._elevationButton.innerHTML = `<img src="./images/elevation_icon.svg" alt="Elevation" width="16" height="16" style="opacity: 0.3;" />`;
            this._elevationButton.title = "Elevação indisponível (terreno não carregado)";
            this._elevationButton.disabled = true;

            // Disable elevation if terrain becomes unavailable
            if (this._elevationEnabled) {
                this._elevationEnabled = false;
                this._currentElevation = null;
                this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
            }
        }
    }

    _toggleElevation() {
        if (!this._terrainAvailable) {
            return;
        }

        // Toggle via property (triggers StateManager update)
        const newEnabled = !this._elevationEnabled;
        this._elevationEnabled = newEnabled;

        // Clear elevation value when disabling
        if (!newEnabled) {
            this._currentElevation = null;
        }

        // Immediate UI update for responsive feel
        this._updateElevationButtonUI(newEnabled);

        this._updateCoordinates(this._currentCoordinates.lat, this._currentCoordinates.lng);
    }

    async _getElevationDebounced(lat, lng) {
        return new Promise((resolve) => {
            clearTimeout(this._debounceTimer);

            this._debounceTimer = setTimeout(async () => {
                if (this._elevationAbortController) {
                    this._elevationAbortController.abort();
                }

                this._elevationAbortController = new AbortController();
                const signal = this._elevationAbortController.signal;

                try {
                    const elevation = await getTerrainElevation(this._map, lat, lng, signal);
                    resolve(elevation);
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.warn('Failed to get elevation:', error);
                    }
                    resolve(null);
                }
            }, 50);
        });
    }

    _createFlyToModal() {
        this._modal = document.createElement('div');
        this._modal.className = 'coordinates-modal';
        this._modal.style.display = 'none';

        const modalContent = document.createElement('div');
        modalContent.className = 'coordinates-modal-content';

        const modalHeader = document.createElement('div');
        modalHeader.className = 'coordinates-modal-header';
        const modalTitle = document.createElement('h3');
        modalTitle.textContent = 'Ir para coordenadas';
        const closeButton = document.createElement('span');
        closeButton.className = 'coordinates-modal-close';
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', () => {
            this._modal.style.display = 'none';
        });
        modalHeader.appendChild(modalTitle);
        modalHeader.appendChild(closeButton);

        const formatContainer = document.createElement('div');
        formatContainer.className = 'coordinates-modal-format';
        const formatLabel = document.createElement('label');
        formatLabel.textContent = 'Formato:';
        const formatSelect = document.createElement('select');
        formatSelect.id = 'coordinates-format-select';

        this._formatOptions.forEach(format => {
            const option = document.createElement('option');
            option.value = format.id;
            option.textContent = format.label;
            if (format.id === this._currentFormat) {
                option.selected = true;
            }
            formatSelect.appendChild(option);
        });

        formatContainer.appendChild(formatLabel);
        formatContainer.appendChild(formatSelect);

        const inputContainer = document.createElement('div');
        inputContainer.className = 'coordinates-modal-input';
        const inputLabel = document.createElement('label');
        inputLabel.textContent = 'Coordenadas:';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'coordinates-input';
        input.placeholder = getPlaceholderForFormat(this._currentFormat);

        formatSelect.addEventListener('change', (e) => {
            input.placeholder = getPlaceholderForFormat(e.target.value);
        });

        inputContainer.appendChild(inputLabel);
        inputContainer.appendChild(input);

        const validationMessage = document.createElement('div');
        validationMessage.className = 'coordinates-validation-message';
        validationMessage.id = 'coordinates-validation';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'coordinates-modal-buttons';

        const flyButton = document.createElement('button');
        flyButton.textContent = 'Ir para';
        flyButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        flyButton.addEventListener('click', async () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = await parseCoordinates(inputValue, formatId);

            if (coordinates) {
                this._flyToCoordinates(coordinates.lng, coordinates.lat);
                this._modal.style.display = 'none';
                input.value = '';
                validationMessage.textContent = '';
                validationMessage.className = 'coordinates-validation-message';
            } else {
                validationMessage.textContent = 'Coordenadas inválidas para o formato selecionado';
                validationMessage.className = 'coordinates-validation-message error';
            }
        });

        const createTypeSelect = document.createElement('select');
        createTypeSelect.id = 'coordinates-create-type';
        createTypeSelect.style.cssText = 'margin-left: 8px; padding: 8px; border-radius: 4px; border: 1px solid #ccc;';

        const pointOption = document.createElement('option');
        pointOption.value = 'point';
        pointOption.textContent = 'Ponto';

        const militaryOption = document.createElement('option');
        militaryOption.value = 'military';
        militaryOption.textContent = 'Simbologia militar';

        const coordinationOption = document.createElement('option');
        coordinationOption.value = 'coordination';
        coordinationOption.textContent = 'Medida de coordenação';

        createTypeSelect.appendChild(pointOption);
        createTypeSelect.appendChild(militaryOption);
        createTypeSelect.appendChild(coordinationOption);

        const createButton = document.createElement('button');
        createButton.textContent = 'Criar';
        createButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        createButton.addEventListener('click', async () => {
            const formatId = formatSelect.value;
            const inputValue = input.value.trim();
            const coordinates = await parseCoordinates(inputValue, formatId);

            if (!coordinates) {
                validationMessage.textContent = 'Coordenadas inválidas para o formato selecionado';
                validationMessage.className = 'coordinates-validation-message error';
                return;
            }

            const createType = createTypeSelect.value;

            switch (createType) {
                case 'point':
                    this._createPointAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
                case 'military':
                    this._createMilitarySymbolAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
                case 'coordination':
                    this._createCoordinationMeasureAtCoordinates(coordinates.lng, coordinates.lat);
                    break;
            }

            this._modal.style.display = 'none';
            input.value = '';
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';
        });

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancelar';
        cancelButton.classList.add('tool-button', 'pure-material-tool-button-contained');
        cancelButton.addEventListener('click', () => {
            this._modal.style.display = 'none';
            input.value = '';
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';
        });

        buttonContainer.appendChild(flyButton);
        buttonContainer.appendChild(createButton);
        buttonContainer.appendChild(createTypeSelect);
        buttonContainer.appendChild(cancelButton);

        modalContent.appendChild(modalHeader);
        modalContent.appendChild(formatContainer);
        modalContent.appendChild(inputContainer);
        modalContent.appendChild(validationMessage);
        modalContent.appendChild(buttonContainer);
        this._modal.appendChild(modalContent);

        document.body.appendChild(this._modal);

        this._modal.addEventListener('click', (e) => {
            if (e.target === this._modal) {
                this._modal.style.display = 'none';
            }
        });
    }

    async _createPointAtCoordinates(lng, lat) {
        const feature = await this._pointControl.createPointAtCoordinates(lng, lat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    async _createCoordinationMeasureAtCoordinates(lng, lat) {
        const lngLat = { lng, lat };
        const feature = await this._coordinationMeasureControl.createCoordinationMeasureFeature(lngLat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    async _createMilitarySymbolAtCoordinates(lng, lat) {
        const lngLat = { lng, lat };
        const feature = await this._militarySymbolControl.createMilitarySymbolFeature(lngLat);
        if (feature) {
            this._flyToCoordinates(lng, lat);
        }
    }

    _openFlyToModal() {
        if (this._modal) {
            const formatSelect = document.getElementById('coordinates-format-select');
            formatSelect.value = this._currentFormat;

            const input = document.getElementById('coordinates-input');
            input.placeholder = getPlaceholderForFormat(this._currentFormat);
            input.value = '';

            const validationMessage = document.getElementById('coordinates-validation');
            validationMessage.textContent = '';
            validationMessage.className = 'coordinates-validation-message';

            this._modal.style.display = 'block';

            setTimeout(() => {
                input.focus();
            }, 100);
        }
    }

    _flyToCoordinates(lng, lat) {
        const zoomOptions = {
            center: [lng, lat],
            zoom: Math.max(this._map.getZoom(), 14),
            duration: 1500,
            essential: true
        };

        this._map.easeTo(zoomOptions);
    }

    _toggleFormatSelector(e) {
        e.stopPropagation();
        const isVisible = this._formatSelector.style.display === 'block';
        this._formatSelector.style.display = isVisible ? 'none' : 'block';
    }

    _closeFormatSelector(e) {
        if (this._formatSelector &&
            !this._formatSelector.contains(e.target) &&
            !e.target.closest('.coordinates-gear-button')) {
            this._formatSelector.style.display = 'none';
        }
    }

    _setFormat(formatId) {
        if (this._currentFormat === formatId) return;

        // Setting via property triggers StateManager update
        // Subscription will handle UI updates via _updateFormatUI
        this._currentFormat = formatId;

        // Immediate UI update for responsive feel (subscription will also fire but is idempotent)
        this._updateFormatUI(formatId);
    }

    // =========================================================================
    // PERFORMANCE: DOM ELEMENT POOLING
    // =========================================================================

    /**
     * Initialize the pool of DOM elements for coordinate display.
     * Pre-creates elements to avoid allocation during frequent updates.
     * @private
     */
    _initCoordinatesElementPool() {
        // Create zoom span (always present)
        this._zoomSpan = document.createElement('span');
        this._zoomSpan.className = 'coordinates-zoom';

        // Create pool of spans for coordinate parts
        this._coordSpanPool = [];
        for (let i = 0; i < MAX_COORDINATE_PARTS; i++) {
            const span = document.createElement('span');
            span.className = 'coordinates-part';
            span.style.display = 'none';
            this._coordSpanPool.push(span);
        }

        // Create elevation span (conditionally shown)
        this._elevationSpan = document.createElement('span');
        this._elevationSpan.className = 'coordinates-elevation';
        this._elevationSpan.style.display = 'none';

        // Append all elements to container once
        this._coordinatesText.appendChild(this._zoomSpan);
        this._coordSpanPool.forEach(span => this._coordinatesText.appendChild(span));
        this._coordinatesText.appendChild(this._elevationSpan);

        this._visibleSpanCount = 0;
    }

    // =========================================================================
    // PERFORMANCE: THROTTLED MOUSE HANDLING
    // =========================================================================

    /**
     * Handle mouse move with throttling.
     * Prevents excessive coordinate calculations during fast mouse movement.
     * @param {Object} e - MapLibre mouse event
     * @private
     */
    _onMouseMove(e) {
        // Store current coordinates (lightweight)
        this._currentCoordinates.lat = e.lngLat.lat;
        this._currentCoordinates.lng = e.lngLat.lng;

        // Store pending coordinates for throttled processing
        this._pendingCoordinates = { lat: e.lngLat.lat, lng: e.lngLat.lng };

        const now = Date.now();

        // If enough time has passed, process immediately
        if (now - this._lastCoordinateUpdate >= COORDINATE_UPDATE_THROTTLE_MS) {
            this._processCoordinateUpdate();
        } else if (!this._coordinateThrottleTimeout) {
            // Schedule deferred update
            this._coordinateThrottleTimeout = setTimeout(() => {
                this._processCoordinateUpdate();
                this._coordinateThrottleTimeout = null;
            }, COORDINATE_UPDATE_THROTTLE_MS - (now - this._lastCoordinateUpdate));
        }
        // If timeout already scheduled, pending coordinates will be used when it fires
    }

    /**
     * Process pending coordinate update.
     * Called either immediately or after throttle delay.
     * @private
     */
    async _processCoordinateUpdate() {
        if (!this._pendingCoordinates) return;

        const { lat, lng } = this._pendingCoordinates;
        this._lastCoordinateUpdate = Date.now();

        // Handle elevation (already debounced separately)
        if (this._elevationEnabled && this._terrainAvailable) {
            this._currentElevation = await this._getElevationDebounced(lat, lng);
        }

        this._updateCoordinates(lat, lng);
    }

    /**
     * Update coordinate display using pooled DOM elements.
     * Avoids DOM allocation by reusing pre-created elements.
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @private
     */
    async _updateCoordinates(lat, lng) {
        // Increment request ID and capture it for this call
        const requestId = ++this._updateRequestId;

        try {
            // Update zoom (always synchronous)
            this._zoomSpan.textContent = `Z${this._map.getZoom().toFixed(1)}`;

            // Await async coordinate conversion
            const displayFormat = await getDisplayFormat(lat, lng, this._currentFormat);

            // Check if this is still the latest request (race condition guard)
            if (requestId !== this._updateRequestId) {
                return; // Stale request, discard results
            }

            // Update coordinate parts using pooled elements
            const parts = displayFormat.parts;
            const partsCount = Math.min(parts.length, MAX_COORDINATE_PARTS);

            for (let i = 0; i < MAX_COORDINATE_PARTS; i++) {
                const span = this._coordSpanPool[i];
                if (i < partsCount) {
                    span.textContent = `${parts[i].label}: ${parts[i].value}`;
                    span.style.display = '';
                } else {
                    span.style.display = 'none';
                }
            }
            this._visibleSpanCount = partsCount;

            // Update elevation span
            if (this._elevationEnabled && this._currentElevation !== null) {
                this._elevationSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._elevationSpan.style.display = '';
            } else {
                this._elevationSpan.style.display = 'none';
            }
        } catch (error) {
            // Check if this is still the latest request before error handling
            if (requestId !== this._updateRequestId) {
                return; // Stale request, discard
            }

            console.error('Error converting coordinates:', error);

            // Fallback display using pooled elements
            this._zoomSpan.textContent = `Z${this._map.getZoom().toFixed(1)}`;

            // Show lat/lng in first two pool spans
            if (this._coordSpanPool.length >= 2) {
                this._coordSpanPool[0].textContent = `Lat: ${lat.toFixed(5)}°`;
                this._coordSpanPool[0].style.display = '';
                this._coordSpanPool[1].textContent = `Lon: ${lng.toFixed(5)}°`;
                this._coordSpanPool[1].style.display = '';

                // Hide remaining spans
                for (let i = 2; i < MAX_COORDINATE_PARTS; i++) {
                    this._coordSpanPool[i].style.display = 'none';
                }
            }
            this._visibleSpanCount = 2;

            // Update elevation span for error case
            if (this._elevationEnabled && this._currentElevation !== null) {
                this._elevationSpan.textContent = `Elev: ${Math.round(this._currentElevation)}m`;
                this._elevationSpan.style.display = '';
            } else {
                this._elevationSpan.style.display = 'none';
            }
        }
    }

    getCurrentFormat() {
        return this._currentFormat;
    }

    /**
     * Get current coordinates as formatted text string.
     * @returns {Promise<string>} Formatted coordinate string
     */
    async getCurrentCoordinatesText() {
        const { lat, lng } = this._currentCoordinates;
        return await formatCoordinates(lat, lng, this._currentFormat);
    }

    onRemove() {
        // Cleanup StateManager subscriptions
        this._unsubscribers.forEach(unsub => {
            try {
                unsub();
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        this._unsubscribers = [];

        // Cleanup performance-related timers
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this._coordinateThrottleTimeout) {
            clearTimeout(this._coordinateThrottleTimeout);
            this._coordinateThrottleTimeout = null;
        }
        if (this._elevationAbortController) {
            this._elevationAbortController.abort();
        }

        // Clear cached references
        this._stateManagerRef = null;
        this._pendingCoordinates = null;

        document.removeEventListener('click', this._closeFormatSelector);
        this._map.off('mousemove', this._onMouseMove);
        this._map.off('terrain', this._onTerrainChange);

        if (this._modal && this._modal.parentNode) {
            this._modal.parentNode.removeChild(this._modal);
        }

        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
    }
}

export default MouseCoordinatesControl;
