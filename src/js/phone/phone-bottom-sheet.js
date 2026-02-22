// Path: js/phone/phone-bottom-sheet.js

/**
 * @fileoverview Draggable bottom sheet component for phone layout (<=480px).
 * Google Maps-inspired sheet with three snap points (peek / half / full),
 * touch drag gestures, expandable layer tree, and a feature detail view.
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
// STATIC SVG ICONS
// ============================================================================

/** SVG icons for each feature type (static, safe for innerHTML) */
const FEATURE_TYPE_ICONS = {
    point: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="3"/></svg>',
    line: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="13" x2="13" y2="3"/></svg>',
    polygon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="8,2 14,6 12,13 4,13 2,6"/></svg>',
    circle: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/></svg>',
    ellipse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="8" rx="7" ry="5"/></svg>',
    rectangle: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10"/></svg>',
    text: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3h10v2H9v8H7V5H3V3z"/></svg>',
    sector: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 8L3 3A7 7 0 0 1 13 3Z"/></svg>',
    brush: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13c2-2 3-4 5-6s4-3 5-4"/></svg>',
    image: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.5" fill="currentColor"/><path d="M2 11l3-3 2 2 3-3 4 4"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="3" y1="13" x2="13" y2="3"/><polyline points="7,3 13,3 13,9"/></svg>',
    boundary: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"><rect x="2" y="2" width="12" height="12"/></svg>',
    occupied_front: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8h12"/><path d="M5 5l3 3-3 3M8 5l3 3-3 3"/></svg>',
    military_symbol: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="10" height="8"/><line x1="8" y1="4" x2="8" y2="2"/></svg>',
    coordination_measure: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>',
};

/** Default icon for unknown feature types */
const DEFAULT_FEATURE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="2"/></svg>';

/** Chevron icon for layer expand/collapse */
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

/** Close (X) icon for feature deselect */
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

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
 * Get the SVG icon for a feature type.
 * @param {string} featureType - Feature type string
 * @returns {string} SVG markup
 */
function getFeatureIcon(featureType) {
    return FEATURE_TYPE_ICONS[featureType] || DEFAULT_FEATURE_ICON;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Phone bottom sheet with drag, snap, expandable layer tree, and feature detail view.
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

        // Layer tree state
        /** @private @type {Set<string>} */
        this._expandedLayers = new Set();
        /** @private @type {Object<string, Array<{id: string, type: string, name: string}>>} */
        this._featuresByLayer = {};
        /** @private @type {function(string, string): void|null} */
        this._featureSelectCb = null;
        /** @private @type {function(): void|null} */
        this._featureDeselectCb = null;

        // Drag state
        /** @private */
        this._isDragging = false;
        /** @private */
        this._dragStartY = 0;
        /** @private */
        this._dragStartTranslateY = 0;
        /** @private */
        this._currentTranslateY = 0; // Placeholder; recalculated in mount() after DOM insertion
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
        this._contentEl = null;
        /** @private */
        this._featureDetailEl = null;
        /** @private */
        this._featureCloseEl = null;

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

        // Recalculate translateY now that element is in DOM with actual height
        this._currentTranslateY = this._getTranslateYForState(this._state);
        this._el.style.transform = `translateY(${this._currentTranslateY}px)`;

        this._bindEvents();
        this._updatePeekContent();
        this._renderLayerTree();

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
     * Show feature detail content, replacing the layer tree view.
     * Adds a close (X) button row above the feature content.
     * @param {HTMLElement} element - DOM element for feature detail
     */
    setFeatureContent(element) {
        this._showingFeatureDetail = true;
        this._contentEl.style.display = 'none';

        // Build close button row
        this._featureCloseEl.textContent = '';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'phone-feature-close__btn';
        closeBtn.innerHTML = CLOSE_SVG;
        const closeLabel = document.createElement('span');
        closeLabel.textContent = 'Fechar sele\u00e7\u00e3o';
        closeBtn.appendChild(closeLabel);
        this._featureCloseEl.appendChild(closeBtn);
        this._featureCloseEl.style.display = '';

        // Set feature content
        this._featureDetailEl.textContent = '';
        this._featureDetailEl.appendChild(element);
        this._featureDetailEl.style.display = '';

        // Expand to half if currently at peek
        if (this._state === SnapState.PEEK) {
            this._setState(SnapState.HALF);
        }
    }

    /**
     * Clear feature detail and restore layer tree view.
     */
    clearFeatureContent() {
        this._showingFeatureDetail = false;
        this._featureDetailEl.textContent = '';
        this._featureDetailEl.style.display = 'none';

        this._featureCloseEl.textContent = '';
        this._featureCloseEl.style.display = 'none';

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
     * Register a callback for feature selection from the layer tree.
     * @param {function(string, string): void} cb - Called with (featureId, featureType)
     */
    onFeatureSelect(cb) {
        if (typeof cb === 'function') {
            this._featureSelectCb = cb;
        }
    }

    /**
     * Register a callback for feature deselection (X close button).
     * @param {function(): void} cb - Called when user taps X to close feature detail
     */
    onFeatureDeselect(cb) {
        if (typeof cb === 'function') {
            this._featureDeselectCb = cb;
        }
    }

    /**
     * Update the layer list and re-render the layer tree.
     * @param {Array<Object>} layers - Array of layer objects with
     *   { id, nome, visivel, featureCount, color }
     */
    updateLayers(layers) {
        this._layers = layers || [];
        // Update subtitle with layer count
        this._mapInfo.layerCount = this._layers.length;
        this._updatePeekContent();
        if (!this._showingFeatureDetail) {
            this._renderLayerTree();
        }
    }

    /**
     * Update features grouped by layer for the tree view.
     * @param {Object<string, Array<{id: string, type: string, name: string}>>} featuresByLayer
     */
    updateFeatures(featuresByLayer) {
        this._featuresByLayer = featuresByLayer || {};
        if (!this._showingFeatureDetail) {
            this._renderLayerTree();
        }
    }

    /**
     * Update map/atlas info displayed in the peek bar.
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
    }

    // ========================================================================
    // HEIGHT CALCULATIONS
    // ========================================================================

    /**
     * Get the sheet's full height in pixels from the actual element.
     * Falls back to 90vh when element is not mounted.
     * @returns {number}
     * @private
     */
    _getSheetHeight() {
        return this._el ? this._el.offsetHeight : window.innerHeight * 0.9;
    }

    /**
     * Get the half-expanded height in pixels (45vh).
     * @returns {number}
     * @private
     */
    _getHalfHeight() {
        return window.innerHeight * 0.45;
    }

    /**
     * Compute translateY value for a given snap state.
     * @param {string} state - SnapState value
     * @returns {number} translateY in pixels
     * @private
     */
    _getTranslateYForState(state) {
        const fullHeight = this._getSheetHeight();
        switch (state) {
        case SnapState.FULL:
            return 0;
        case SnapState.HALF:
            return fullHeight - this._getHalfHeight();
        case SnapState.PEEK:
        default:
            return fullHeight - PEEK_HEIGHT_PX;
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

        // Content area (layer tree, default visible)
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'phone-bottom-sheet__content';
        this._el.appendChild(this._contentEl);

        // Feature close button row (hidden by default)
        this._featureCloseEl = document.createElement('div');
        this._featureCloseEl.className = 'phone-feature-close';
        this._featureCloseEl.style.display = 'none';
        this._el.appendChild(this._featureCloseEl);

        // Feature detail area (hidden by default)
        this._featureDetailEl = document.createElement('div');
        this._featureDetailEl.className = 'phone-bottom-sheet__content';
        this._featureDetailEl.style.display = 'none';
        this._el.appendChild(this._featureDetailEl);

        // Apply initial translateY (approximate; recalculated in mount() after DOM insertion)
        this._currentTranslateY = this._getTranslateYForState(this._state);
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

        // Layer tree click delegation
        addDomListener(this, this._contentEl, 'click', this._onTreeClick.bind(this));

        // Feature close button click delegation
        addDomListener(this, this._featureCloseEl, 'click', this._onFeatureCloseClick.bind(this));

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
        const maxTranslateY = this._getSheetHeight() - PEEK_HEIGHT_PX;
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
        const peekY = this._getTranslateYForState(SnapState.PEEK);
        const halfY = this._getTranslateYForState(SnapState.HALF);
        const fullY = this._getTranslateYForState(SnapState.FULL);

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
        const translateY = this._getTranslateYForState(newState);
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
    // LAYER TREE RENDERING
    // ========================================================================

    /**
     * Render the expandable layer tree inside _contentEl.
     * Each layer header expands to show its features.
     * @private
     */
    _renderLayerTree() {
        this._contentEl.textContent = '';

        if (!this._layers.length) {
            const empty = document.createElement('div');
            empty.className = 'phone-search-overlay__empty';
            empty.textContent = 'Nenhuma camada dispon\u00edvel';
            this._contentEl.appendChild(empty);
            return;
        }

        const treeEl = document.createElement('div');
        treeEl.className = 'phone-layer-tree';

        for (const layer of this._layers) {
            const layerId = layer.id;
            const isExpanded = this._expandedLayers.has(layerId);
            const features = this._featuresByLayer[layerId] || [];

            // Layer container
            const layerEl = document.createElement('div');
            layerEl.className = 'phone-layer-tree__layer';

            // Layer header button
            const headerBtn = document.createElement('button');
            headerBtn.className = 'phone-layer-tree__header';
            headerBtn.dataset.layerId = layerId;

            // Color dot
            const colorDot = document.createElement('div');
            colorDot.className = 'phone-layer-tree__color';
            if (layer.color) {
                colorDot.style.backgroundColor = layer.color;
            }

            // Layer name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'phone-layer-tree__name';
            nameSpan.textContent = layer.nome || layer.name || '';

            // Feature count
            const countSpan = document.createElement('span');
            countSpan.className = 'phone-layer-tree__count';
            countSpan.textContent = `(${features.length})`;

            // Chevron icon
            const chevronEl = document.createElement('span');
            chevronEl.className = 'phone-layer-tree__chevron';
            if (isExpanded) {
                chevronEl.classList.add('phone-layer-tree__chevron--expanded');
            }
            chevronEl.innerHTML = CHEVRON_SVG;

            headerBtn.appendChild(colorDot);
            headerBtn.appendChild(nameSpan);
            headerBtn.appendChild(countSpan);
            headerBtn.appendChild(chevronEl);
            layerEl.appendChild(headerBtn);

            // Features list (hidden when collapsed)
            const featuresEl = document.createElement('div');
            featuresEl.className = 'phone-layer-tree__features';
            if (!isExpanded) {
                featuresEl.style.display = 'none';
            }

            for (const feature of features) {
                const featureBtn = document.createElement('button');
                featureBtn.className = 'phone-layer-tree__feature';
                featureBtn.dataset.featureId = feature.id;
                featureBtn.dataset.featureType = feature.type;

                // Type icon
                const iconEl = document.createElement('span');
                iconEl.className = 'phone-layer-tree__feature-icon';
                iconEl.innerHTML = getFeatureIcon(feature.type);

                // Feature name
                const featureNameEl = document.createElement('span');
                featureNameEl.className = 'phone-layer-tree__feature-name';
                featureNameEl.textContent = feature.name || '';

                featureBtn.appendChild(iconEl);
                featureBtn.appendChild(featureNameEl);
                featuresEl.appendChild(featureBtn);
            }

            layerEl.appendChild(featuresEl);
            treeEl.appendChild(layerEl);
        }

        this._contentEl.appendChild(treeEl);
    }

    // ========================================================================
    // TREE INTERACTION
    // ========================================================================

    /**
     * Handle clicks on the layer tree via delegation.
     * @param {MouseEvent} e
     * @private
     */
    _onTreeClick(e) {
        // Check for feature click first (more specific)
        const featureBtn = e.target.closest('.phone-layer-tree__feature');
        if (featureBtn) {
            const featureId = featureBtn.dataset.featureId;
            const featureType = featureBtn.dataset.featureType;
            if (featureId && this._featureSelectCb) {
                this._featureSelectCb(featureId, featureType);
            }
            return;
        }

        // Check for layer header click
        const headerBtn = e.target.closest('.phone-layer-tree__header');
        if (headerBtn) {
            const layerId = headerBtn.dataset.layerId;
            if (!layerId) return;

            // Toggle expanded state
            if (this._expandedLayers.has(layerId)) {
                this._expandedLayers.delete(layerId);
            } else {
                this._expandedLayers.add(layerId);
            }

            this._renderLayerTree();

            // If tapping a layer header while at peek, expand to half
            if (this._state === SnapState.PEEK) {
                this._setState(SnapState.HALF);
            }
        }
    }

    /**
     * Handle click on the feature close (X) button.
     * @param {MouseEvent} e
     * @private
     */
    _onFeatureCloseClick(e) {
        const closeBtn = e.target.closest('.phone-feature-close__btn');
        if (!closeBtn) return;

        this.clearFeatureContent();
        if (this._featureDeselectCb) {
            this._featureDeselectCb();
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
    }
}
