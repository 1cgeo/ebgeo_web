// Path: js/phone/phone-bottom-sheet.js

/**
 * @fileoverview Draggable bottom sheet component for phone layout (<=480px).
 * Google Maps-inspired sheet with three snap points (peek / half / full),
 * touch drag gestures, tabs, and a feature detail view.
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** @enum {string} Snap states for the bottom sheet */
const SnapState = Object.freeze({
    PEEK: 'peek',
    HALF: 'half',
    FULL: 'full',
});

/** @enum {string} Tab identifiers */
const TabId = Object.freeze({
    OVERVIEW: 'overview',
    LAYERS: 'layers',
    MORE: 'more',
});

/** Tab display labels (pt-BR) */
const TAB_LABELS = Object.freeze({
    [TabId.OVERVIEW]: 'Vis\u00e3o Geral',
    [TabId.LAYERS]: 'Camadas',
    [TabId.MORE]: 'Mais',
});

/** Ordered list of tabs */
const TAB_ORDER = [TabId.OVERVIEW, TabId.LAYERS, TabId.MORE];

/** Coordinate display formats */
const CoordFormat = Object.freeze({
    DD: 'dd',
    DMS: 'dms',
    UTM: 'utm',
});

/** Ordered cycle for coordinate format */
const COORD_FORMAT_CYCLE = [CoordFormat.DD, CoordFormat.DMS, CoordFormat.UTM];

/**
 * Minimum swipe velocity (px/ms) to trigger directional snap
 * instead of nearest-point snap.
 */
const SWIPE_VELOCITY_THRESHOLD = 0.5;

/** Number of recent touch positions tracked for velocity calculation */
const VELOCITY_HISTORY_SIZE = 3;

/** Peek height in pixels (must match --phone-sheet-peek) */
const PEEK_HEIGHT_PX = 64;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Convert decimal degrees to DMS string.
 * @param {number} dd - Decimal degrees value
 * @param {'lat'|'lng'} axis - Which axis for N/S/E/W suffix
 * @returns {string} Formatted DMS string
 */
function ddToDms(dd, axis) {
    const abs = Math.abs(dd);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = ((minFloat - min) * 60).toFixed(1);

    let dir;
    if (axis === 'lat') {
        dir = dd >= 0 ? 'N' : 'S';
    } else {
        dir = dd >= 0 ? 'E' : 'W';
    }
    return `${deg}\u00b0${String(min).padStart(2, '0')}'${String(sec).padStart(4, '0')}"${dir}`;
}

/**
 * Convert decimal degrees to a simplified UTM-like string.
 * Uses a basic zone calculation; intended for display only.
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lng - Longitude in decimal degrees
 * @returns {string} Simplified UTM zone + easting/northing display
 */
function ddToUtm(lat, lng) {
    const zone = Math.floor((lng + 180) / 6) + 1;
    const band = lat >= 0 ? 'N' : 'S';
    return `${zone}${band} ${lng.toFixed(0)}E ${lat.toFixed(0)}N`;
}

/**
 * Format coordinates according to the given format.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} format - One of CoordFormat values
 * @returns {string} Formatted coordinate string
 */
function formatCoordinates(lat, lng, format) {
    switch (format) {
    case CoordFormat.DMS:
        return `${ddToDms(lat, 'lat')} ${ddToDms(lng, 'lng')}`;
    case CoordFormat.UTM:
        return ddToUtm(lat, lng);
    case CoordFormat.DD:
    default:
        return `${lat.toFixed(3)}\u00b0, ${lng.toFixed(3)}\u00b0`;
    }
}

/**
 * Get the sheet's full height in pixels (90vh).
 * @returns {number}
 */
function getSheetFullHeight() {
    return window.innerHeight * 0.9;
}

/**
 * Get the half-expanded height in pixels (45vh).
 * @returns {number}
 */
function getSheetHalfHeight() {
    return window.innerHeight * 0.45;
}

/**
 * Compute translateY value for a given snap state.
 * @param {string} state - SnapState value
 * @returns {number} translateY in pixels
 */
function getTranslateYForState(state) {
    const fullHeight = getSheetFullHeight();
    switch (state) {
    case SnapState.FULL:
        return 0;
    case SnapState.HALF:
        return fullHeight - getSheetHalfHeight();
    case SnapState.PEEK:
    default:
        return fullHeight - PEEK_HEIGHT_PX;
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Phone bottom sheet with drag, snap, tabs, and feature detail view.
 */
export class PhoneBottomSheet {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre GL map instance
     */
    constructor({ map }) {
        setupCleanup(this);

        /** @private */
        this._map = map;
        /** @private */
        this._state = SnapState.PEEK;
        /** @private */
        this._activeTab = TabId.OVERVIEW;
        /** @private */
        this._coordFormat = CoordFormat.DD;
        /** @private */
        this._stateChangeCallbacks = [];
        /** @private */
        this._showingFeatureDetail = false;
        /** @private */
        this._currentLat = 0;
        /** @private */
        this._currentLng = 0;

        // Map info cache
        /** @private */
        this._mapInfo = {
            atlasName: 'Atlas',
            mapName: '',
            layerCount: 0,
            featureCount: 0,
        };

        // Layers cache
        /** @private */
        this._layers = [];

        // Drag state
        /** @private */
        this._isDragging = false;
        /** @private */
        this._dragStartY = 0;
        /** @private */
        this._dragStartTranslateY = 0;
        /** @private */
        this._currentTranslateY = getTranslateYForState(SnapState.PEEK);
        /** @private */
        this._touchHistory = [];
        /** @private */
        this._rafId = null;

        // DOM references (set in _buildDOM)
        /** @private */
        this._el = null;
        /** @private */
        this._handleEl = null;
        /** @private */
        this._peekEl = null;
        /** @private */
        this._titleEl = null;
        /** @private */
        this._subtitleEl = null;
        /** @private */
        this._coordsEl = null;
        /** @private */
        this._tabsEl = null;
        /** @private */
        this._tabButtons = {};
        /** @private */
        this._contentEl = null;
        /** @private */
        this._featureDetailEl = null;

        // Bound handlers for map events
        /** @private */
        this._handleMoveEnd = this._onMoveEnd.bind(this);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Build DOM and append to parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._buildDOM();
        parent.appendChild(this._el);
        this._bindEvents();
        this._updatePeekContent();
        this._renderTabContent();

        // Initialize coordinates from current map center
        this._onMoveEnd();
    }

    /**
     * Remove from DOM and clean up all listeners.
     */
    destroy() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this._map) {
            this._map.off('moveend', this._handleMoveEnd);
        }

        cleanup(this);

        if (this._el && this._el.parentNode) {
            this._el.parentNode.removeChild(this._el);
        }
        this._el = null;
        this._stateChangeCallbacks = [];
    }

    /**
     * Programmatically snap to a state.
     * @param {'peek'|'half'|'full'} state
     */
    snapTo(state) {
        if (!Object.values(SnapState).includes(state)) {
            return;
        }
        this._setState(state);
    }

    /**
     * Get the current snap state.
     * @returns {'peek'|'half'|'full'}
     */
    getState() {
        return this._state;
    }

    /**
     * Show feature detail content, replacing the tab view.
     * @param {HTMLElement} element - DOM element for feature detail
     */
    setFeatureContent(element) {
        this._showingFeatureDetail = true;
        this._tabsEl.style.display = 'none';
        this._contentEl.style.display = 'none';

        this._featureDetailEl.textContent = '';
        this._featureDetailEl.appendChild(element);
        this._featureDetailEl.style.display = '';

        // Expand to half if currently at peek
        if (this._state === SnapState.PEEK) {
            this._setState(SnapState.HALF);
        }
    }

    /**
     * Clear feature detail and restore tab view.
     */
    clearFeatureContent() {
        this._showingFeatureDetail = false;
        this._featureDetailEl.innerHTML = '';
        this._featureDetailEl.style.display = 'none';

        this._tabsEl.style.display = '';
        this._contentEl.style.display = '';
    }

    /**
     * Register a callback for state changes.
     * @param {function(string): void} callback - Called with new state string
     */
    onStateChange(callback) {
        if (typeof callback === 'function') {
            this._stateChangeCallbacks.push(callback);
        }
    }

    /**
     * Update the layer list displayed in the Camadas tab.
     * @param {Array<Object>} layers - Array of layer objects with
     *   { id, nome, visivel, featureCount, color }
     */
    updateLayers(layers) {
        this._layers = layers || [];
        // Update subtitle with layer count
        this._mapInfo.layerCount = this._layers.length;
        this._updatePeekContent();
        if (this._activeTab === TabId.LAYERS && !this._showingFeatureDetail) {
            this._renderTabContent();
        }
    }

    /**
     * Update map/atlas info displayed in the peek bar and overview tab.
     * @param {Object} info
     * @param {string} [info.atlasName]
     * @param {string} [info.mapName]
     * @param {number} [info.layerCount]
     * @param {number} [info.featureCount]
     */
    updateMapInfo({ atlasName, mapName, layerCount, featureCount }) {
        if (atlasName !== undefined) this._mapInfo.atlasName = atlasName;
        if (mapName !== undefined) this._mapInfo.mapName = mapName;
        if (layerCount !== undefined) this._mapInfo.layerCount = layerCount;
        if (featureCount !== undefined) this._mapInfo.featureCount = featureCount;
        this._updatePeekContent();
        if (this._activeTab === TabId.OVERVIEW && !this._showingFeatureDetail) {
            this._renderTabContent();
        }
    }

    // ========================================================================
    // DOM CONSTRUCTION
    // ========================================================================

    /** @private */
    _buildDOM() {
        // Root container
        this._el = document.createElement('div');
        this._el.className = 'phone-bottom-sheet';

        // Handle
        this._handleEl = document.createElement('div');
        this._handleEl.className = 'phone-bottom-sheet__handle';
        const handleBar = document.createElement('div');
        handleBar.className = 'phone-bottom-sheet__handle-bar';
        this._handleEl.appendChild(handleBar);
        this._el.appendChild(this._handleEl);

        // Peek content
        this._peekEl = document.createElement('div');
        this._peekEl.className = 'phone-bottom-sheet__peek';

        const peekLeft = document.createElement('div');
        this._titleEl = document.createElement('div');
        this._titleEl.className = 'phone-bottom-sheet__title';
        this._subtitleEl = document.createElement('div');
        this._subtitleEl.className = 'phone-bottom-sheet__subtitle';
        peekLeft.appendChild(this._titleEl);
        peekLeft.appendChild(this._subtitleEl);

        this._coordsEl = document.createElement('div');
        this._coordsEl.className = 'phone-bottom-sheet__subtitle';

        this._peekEl.appendChild(peekLeft);
        this._peekEl.appendChild(this._coordsEl);
        this._el.appendChild(this._peekEl);

        // Tabs
        this._tabsEl = document.createElement('div');
        this._tabsEl.className = 'phone-bottom-sheet__tabs';

        for (const tabId of TAB_ORDER) {
            const btn = document.createElement('button');
            btn.className = 'phone-bottom-sheet__tab';
            btn.textContent = TAB_LABELS[tabId];
            btn.dataset.tab = tabId;
            if (tabId === this._activeTab) {
                btn.classList.add('phone-bottom-sheet__tab--active');
            }
            this._tabButtons[tabId] = btn;
            this._tabsEl.appendChild(btn);
        }
        this._el.appendChild(this._tabsEl);

        // Content area
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'phone-bottom-sheet__content';
        this._el.appendChild(this._contentEl);

        // Feature detail area (hidden by default)
        this._featureDetailEl = document.createElement('div');
        this._featureDetailEl.className = 'phone-bottom-sheet__content';
        this._featureDetailEl.style.display = 'none';
        this._el.appendChild(this._featureDetailEl);

        // Apply initial translateY
        this._currentTranslateY = getTranslateYForState(this._state);
        this._el.style.transform = `translateY(${this._currentTranslateY}px)`;
    }

    // ========================================================================
    // EVENT BINDING
    // ========================================================================

    /** @private */
    _bindEvents() {
        // Touch drag on handle
        addDomListener(this, this._handleEl, 'touchstart', this._onTouchStart.bind(this), { passive: true });
        addDomListener(this, this._handleEl, 'touchmove', this._onTouchMove.bind(this), { passive: false });
        addDomListener(this, this._handleEl, 'touchend', this._onTouchEnd.bind(this), { passive: true });

        // Also support touch drag on the peek area
        addDomListener(this, this._peekEl, 'touchstart', this._onTouchStart.bind(this), { passive: true });
        addDomListener(this, this._peekEl, 'touchmove', this._onTouchMove.bind(this), { passive: false });
        addDomListener(this, this._peekEl, 'touchend', this._onTouchEnd.bind(this), { passive: true });

        // Tab clicks
        addDomListener(this, this._tabsEl, 'click', this._onTabClick.bind(this));

        // Coordinate tap to cycle format
        addDomListener(this, this._coordsEl, 'click', this._onCoordsClick.bind(this));

        // Map moveend for coordinate updates
        if (this._map) {
            this._map.on('moveend', this._handleMoveEnd);
        }
    }

    // ========================================================================
    // TOUCH DRAG
    // ========================================================================

    /**
     * @param {TouchEvent} e
     * @private
     */
    _onTouchStart(e) {
        if (!e.touches.length) return;

        this._isDragging = true;
        this._dragStartY = e.touches[0].clientY;
        this._dragStartTranslateY = this._currentTranslateY;
        this._touchHistory = [{ y: e.touches[0].clientY, time: Date.now() }];

        this._el.classList.add('phone-bottom-sheet--dragging');
    }

    /**
     * @param {TouchEvent} e
     * @private
     */
    _onTouchMove(e) {
        if (!this._isDragging || !e.touches.length) return;

        e.preventDefault();

        const currentY = e.touches[0].clientY;
        const now = Date.now();

        // Track velocity history
        this._touchHistory.push({ y: currentY, time: now });
        if (this._touchHistory.length > VELOCITY_HISTORY_SIZE) {
            this._touchHistory.shift();
        }

        const deltaY = currentY - this._dragStartY;
        let newTranslateY = this._dragStartTranslateY + deltaY;

        // Clamp: cannot go above full (0) or below peek
        const maxTranslateY = getSheetFullHeight() - PEEK_HEIGHT_PX;
        newTranslateY = Math.max(0, Math.min(newTranslateY, maxTranslateY));

        // Apply via rAF for smooth updates
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
        }
        this._rafId = requestAnimationFrame(() => {
            this._currentTranslateY = newTranslateY;
            this._el.style.transform = `translateY(${newTranslateY}px)`;
            this._rafId = null;
        });
    }

    /**
     * @param {TouchEvent} _e
     * @private
     */
    _onTouchEnd(_e) {
        if (!this._isDragging) return;

        this._isDragging = false;
        this._el.classList.remove('phone-bottom-sheet--dragging');

        // Compute velocity from touch history
        const velocity = this._computeVelocity();
        const targetState = this._resolveSnapTarget(this._currentTranslateY, velocity);

        this._setState(targetState);
    }

    /**
     * Compute velocity from recent touch positions (px/ms).
     * Positive = dragging down, negative = dragging up.
     * @returns {number}
     * @private
     */
    _computeVelocity() {
        if (this._touchHistory.length < 2) return 0;

        const first = this._touchHistory[0];
        const last = this._touchHistory[this._touchHistory.length - 1];
        const dt = last.time - first.time;
        if (dt === 0) return 0;

        return (last.y - first.y) / dt;
    }

    /**
     * Determine which snap state to transition to based on position and velocity.
     * @param {number} currentY - Current translateY value
     * @param {number} velocity - Swipe velocity (px/ms, positive = down)
     * @returns {string} Target SnapState
     * @private
     */
    _resolveSnapTarget(currentY, velocity) {
        const peekY = getTranslateYForState(SnapState.PEEK);
        const halfY = getTranslateYForState(SnapState.HALF);
        const fullY = getTranslateYForState(SnapState.FULL);

        // If velocity is high enough, snap in swipe direction
        if (Math.abs(velocity) > SWIPE_VELOCITY_THRESHOLD) {
            if (velocity > 0) {
                // Swiping down
                if (this._state === SnapState.FULL) return SnapState.HALF;
                return SnapState.PEEK;
            }
            // Swiping up
            if (this._state === SnapState.PEEK) return SnapState.HALF;
            return SnapState.FULL;
        }

        // Otherwise snap to nearest point
        const distances = [
            { state: SnapState.PEEK, dist: Math.abs(currentY - peekY) },
            { state: SnapState.HALF, dist: Math.abs(currentY - halfY) },
            { state: SnapState.FULL, dist: Math.abs(currentY - fullY) },
        ];
        distances.sort((a, b) => a.dist - b.dist);
        return distances[0].state;
    }

    // ========================================================================
    // STATE MANAGEMENT
    // ========================================================================

    /**
     * Transition to a new snap state with CSS animation.
     * @param {string} newState - SnapState value
     * @private
     */
    _setState(newState) {
        const previousState = this._state;
        this._state = newState;

        // Remove all state modifier classes
        this._el.classList.remove(
            'phone-bottom-sheet--half',
            'phone-bottom-sheet--full',
            'phone-bottom-sheet--dragging',
        );

        // Apply translateY via the CSS class (with transition)
        const translateY = getTranslateYForState(newState);
        this._currentTranslateY = translateY;
        this._el.style.transform = `translateY(${translateY}px)`;

        // Add state class for any CSS-driven differences
        if (newState === SnapState.HALF) {
            this._el.classList.add('phone-bottom-sheet--half');
        } else if (newState === SnapState.FULL) {
            this._el.classList.add('phone-bottom-sheet--full');
        }

        // Notify callbacks if state actually changed
        if (newState !== previousState) {
            for (const cb of this._stateChangeCallbacks) {
                try {
                    cb(newState);
                } catch (err) {
                    console.error('PhoneBottomSheet state change callback error:', err);
                }
            }
        }
    }

    // ========================================================================
    // TAB MANAGEMENT
    // ========================================================================

    /**
     * @param {MouseEvent} e
     * @private
     */
    _onTabClick(e) {
        const btn = e.target.closest('.phone-bottom-sheet__tab');
        if (!btn) return;

        const tabId = btn.dataset.tab;
        if (!tabId || tabId === this._activeTab) return;

        // Update active tab visual
        for (const [id, tabBtn] of Object.entries(this._tabButtons)) {
            tabBtn.classList.toggle('phone-bottom-sheet__tab--active', id === tabId);
        }

        this._activeTab = tabId;
        this._renderTabContent();

        // If tapping a tab while at peek, expand to half
        if (this._state === SnapState.PEEK) {
            this._setState(SnapState.HALF);
        }
    }

    // ========================================================================
    // CONTENT RENDERING
    // ========================================================================

    /**
     * Update the peek bar text (title, subtitle, coordinates).
     * @private
     */
    _updatePeekContent() {
        const { atlasName, mapName, layerCount } = this._mapInfo;

        this._titleEl.textContent = mapName || atlasName;
        const parts = [];
        if (mapName && atlasName) {
            parts.push(atlasName);
        }
        parts.push(`${layerCount} camada${layerCount !== 1 ? 's' : ''}`);
        this._subtitleEl.textContent = parts.join(' \u00b7 ');

        this._coordsEl.textContent = formatCoordinates(
            this._currentLat,
            this._currentLng,
            this._coordFormat,
        );
    }

    /**
     * Render content for the active tab.
     * @private
     */
    _renderTabContent() {
        // Clear previous content
        this._contentEl.innerHTML = '';

        switch (this._activeTab) {
        case TabId.OVERVIEW:
            this._renderOverviewTab();
            break;
        case TabId.LAYERS:
            this._renderLayersTab();
            break;
        case TabId.MORE:
            this._renderMoreTab();
            break;
        }
    }

    /**
     * Render the Visao Geral tab.
     * @private
     */
    _renderOverviewTab() {
        const { atlasName, mapName, layerCount, featureCount } = this._mapInfo;

        const items = [
            { label: 'Atlas', value: atlasName },
            { label: 'Mapa', value: mapName || '\u2014' },
            { label: 'Camadas', value: String(layerCount) },
            { label: 'Fei\u00e7\u00f5es', value: String(featureCount) },
        ];

        const container = document.createElement('div');
        container.className = 'phone-feature-detail__properties';

        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'phone-feature-detail__property';

            const labelEl = document.createElement('span');
            labelEl.className = 'phone-feature-detail__property-label';
            labelEl.textContent = item.label;

            const valueEl = document.createElement('span');
            valueEl.className = 'phone-feature-detail__property-value';
            valueEl.textContent = item.value;

            row.appendChild(labelEl);
            row.appendChild(valueEl);
            container.appendChild(row);
        }

        this._contentEl.appendChild(container);
    }

    /**
     * Render the Camadas tab with layer list.
     * @private
     */
    _renderLayersTab() {
        if (!this._layers.length) {
            const empty = document.createElement('div');
            empty.className = 'phone-search-overlay__empty';
            empty.textContent = 'Nenhuma camada dispon\u00edvel';
            this._contentEl.appendChild(empty);
            return;
        }

        const list = document.createDocumentFragment();

        for (const layer of this._layers) {
            const item = document.createElement('div');
            item.className = 'phone-layer-item';

            // Color swatch
            const colorEl = document.createElement('div');
            colorEl.className = 'phone-layer-item__color';
            if (layer.color) {
                colorEl.style.backgroundColor = layer.color;
            }

            // Name
            const nameEl = document.createElement('div');
            nameEl.className = 'phone-layer-item__name';
            nameEl.textContent = layer.nome || layer.name || '';

            // Feature count
            const countEl = document.createElement('div');
            countEl.className = 'phone-layer-item__count';
            countEl.textContent = layer.featureCount != null ? String(layer.featureCount) : '';

            // Visibility toggle
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'phone-layer-item__toggle';
            if (layer.visivel !== false) {
                toggleBtn.classList.add('phone-layer-item__toggle--visible');
            }
            toggleBtn.innerHTML = this._getEyeIcon(layer.visivel !== false);
            toggleBtn.dataset.layerId = layer.id;

            item.appendChild(colorEl);
            item.appendChild(nameEl);
            item.appendChild(countEl);
            item.appendChild(toggleBtn);

            list.appendChild(item);
        }

        this._contentEl.appendChild(list);

        // Toggle listener delegated on content
        addDomListener(this, this._contentEl, 'click', this._onLayerToggleClick.bind(this));
    }

    /**
     * Render the Mais tab with basic options.
     * @private
     */
    _renderMoreTab() {
        const container = document.createElement('div');
        container.className = 'phone-feature-detail__properties';

        // Coordinate format option
        const formatRow = document.createElement('div');
        formatRow.className = 'phone-feature-detail__property';

        const formatLabel = document.createElement('span');
        formatLabel.className = 'phone-feature-detail__property-label';
        formatLabel.textContent = 'Formato de coordenadas';

        const formatValue = document.createElement('span');
        formatValue.className = 'phone-feature-detail__property-value';
        formatValue.textContent = this._coordFormat.toUpperCase();

        formatRow.appendChild(formatLabel);
        formatRow.appendChild(formatValue);
        container.appendChild(formatRow);

        this._contentEl.appendChild(container);
    }

    // ========================================================================
    // COORDINATE HANDLING
    // ========================================================================

    /**
     * Handle map moveend — update displayed coordinates.
     * @private
     */
    _onMoveEnd() {
        if (!this._map) return;

        const center = this._map.getCenter();
        this._currentLat = center.lat;
        this._currentLng = center.lng;

        this._coordsEl.textContent = formatCoordinates(
            this._currentLat,
            this._currentLng,
            this._coordFormat,
        );
    }

    /**
     * Cycle coordinate format on tap.
     * @private
     */
    _onCoordsClick() {
        const currentIndex = COORD_FORMAT_CYCLE.indexOf(this._coordFormat);
        const nextIndex = (currentIndex + 1) % COORD_FORMAT_CYCLE.length;
        this._coordFormat = COORD_FORMAT_CYCLE[nextIndex];

        this._coordsEl.textContent = formatCoordinates(
            this._currentLat,
            this._currentLng,
            this._coordFormat,
        );

        // Also update Mais tab if visible
        if (this._activeTab === TabId.MORE && !this._showingFeatureDetail) {
            this._renderTabContent();
        }
    }

    // ========================================================================
    // LAYER INTERACTION
    // ========================================================================

    /**
     * Handle visibility toggle click for a layer.
     * @param {MouseEvent} e
     * @private
     */
    _onLayerToggleClick(e) {
        const toggleBtn = e.target.closest('.phone-layer-item__toggle');
        if (!toggleBtn) return;

        const layerId = toggleBtn.dataset.layerId;
        if (!layerId) return;

        // Toggle the local visibility state
        const layer = this._layers.find(l => l.id === layerId);
        if (!layer) return;

        layer.visivel = !layer.visivel;
        toggleBtn.classList.toggle('phone-layer-item__toggle--visible', layer.visivel);
        toggleBtn.innerHTML = this._getEyeIcon(layer.visivel);
    }

    /**
     * Get SVG icon for eye visibility toggle.
     * @param {boolean} visible
     * @returns {string} SVG markup
     * @private
     */
    _getEyeIcon(visible) {
        if (visible) {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    }
}
