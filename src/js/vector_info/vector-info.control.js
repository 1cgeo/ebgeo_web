// Path: js/vector_info/vector-info.control.js
import config from '@js/config.js';
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';

class VectorTileInfoControl {
    constructor(toolManager, uiManager) {
        this.toolManager = toolManager;
        this.uiManager = uiManager;
        this.isActive = false;
        this.map = null;
        this.contextMenu = null;
        this.pendingVectorTileFeatures = null;

        // Initialize cleanup tracking
        setupCleanup(this);

        // Bound event handlers for proper cleanup
        this.handleMapClickBound = this.handleMapClick.bind(this);
        this._handleMoveStart = this._onMoveStart.bind(this);
        this._handleZoomStart = this._onZoomStart.bind(this);
        this._handleMouseMove = this._onMouseMove.bind(this);
        this._handleKeydown = this._onKeydown.bind(this);

        this._setupDocumentListeners();
    }

    _setupDocumentListeners() {
        addDomListener(this, document, 'keydown', this._handleKeydown);
    }

    _onKeydown(e) {
        if (e.key === 'Escape' && this.contextMenu) {
            this._hideVectorTileSelectionMenu();
        }
    }

    _onMoveStart() {
        if (this.contextMenu) {
            this._hideVectorTileSelectionMenu();
        }
    }

    _onZoomStart() {
        if (this.contextMenu) {
            this._hideVectorTileSelectionMenu();
        }
    }

    /**
     * Keep the identify cursor pinned while the tool is active.
     * Setting the canvas cursor once on activate() can be dropped by other
     * map interactions (drag/pan, layout/resize), so re-assert it on move —
     * mirrors how active draw tools own the cursor while running.
     */
    _onMouseMove() {
        if (this.isActive && this.map && this.map.getCanvas().style.cursor !== 'help') {
            this.map.getCanvas().style.cursor = 'help';
        }
    }

    onAdd(map) {
        this.map = map;
    }

    onRemove() {
        this._hideVectorTileSelectionMenu();

        if (this.isActive && this.map) {
            this.map.off('click', this.handleMapClickBound);
            this.map.off('mousemove', this._handleMouseMove);
            this.map.off('movestart', this._handleMoveStart);
            this.map.off('zoomstart', this._handleZoomStart);
        }

        // Cleanup all tracked listeners (including document keydown)
        cleanup(this);

        this.map = undefined;
    }

    activate() {
        const isEnabled = config.features?.vector_info ?? true;
        if (!isEnabled) {
            return false;
        }

        this.isActive = true;
        this.map.getCanvas().style.cursor = 'help';

        this.map.on('click', this.handleMapClickBound);
        this.map.on('mousemove', this._handleMouseMove);
        this.map.on('movestart', this._handleMoveStart);
        this.map.on('zoomstart', this._handleZoomStart);
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';

        this.map.off('click', this.handleMapClickBound);
        this.map.off('mousemove', this._handleMouseMove);
        this.map.off('movestart', this._handleMoveStart);
        this.map.off('zoomstart', this._handleZoomStart);

        this.uiManager.saveChangesAndClosePanel();
    }

    handleMapClick(e) {
        if (this.isActive) {
            const features = this.map.queryRenderedFeatures(e.point);
            // Only show EDGV layers in the identification tool
            const filteredFeatures = features.filter(f => f.sourceLayer && f.sourceLayer.startsWith('edgv_') && !f.properties.source);

            // Remove duplicates caused by multiple layers (fill, border, etc.) sharing the same source
            const vectorTileFeatures = this._deduplicateFeatures(filteredFeatures);

            if (vectorTileFeatures.length > 0) {
                const preferenceOrder = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

                vectorTileFeatures.sort((a, b) => {
                    return preferenceOrder.indexOf(a.geometry.type) - preferenceOrder.indexOf(b.geometry.type);
                });

                if (vectorTileFeatures.length === 1) {
                    this._hideVectorTileSelectionMenu();
                    this.uiManager.showVectorTileInfoPanel(vectorTileFeatures[0]);
                } else {
                    this._showVectorTileSelectionMenu(vectorTileFeatures, e);
                }
            } else {
                this.uiManager.saveChangesAndClosePanel();
                this._hideVectorTileSelectionMenu();
            }
        }
    }

    /**
     * Shows selection menu when multiple vector tile features are clicked
     * @param {Array} features - Array of vector tile features
     * @param {Object} e - Click event
     */
    _showVectorTileSelectionMenu(features, e) {
        this._hideVectorTileSelectionMenu();

        if (features.length === 0) return;

        this.pendingVectorTileFeatures = features;

        this.contextMenu = this._createContextMenuElement(features, e);
        document.body.appendChild(this.contextMenu);
    }

    /**
     * Creates context menu HTML element
     * @param {Array} features - Array of vector tile features
     * @param {Object} e - Click event
     * @returns {HTMLElement} Menu element
     */
    _createContextMenuElement(features, e) {
        const menu = document.createElement('div');
        menu.className = 'vector-tile-selection-menu';

        // Position is dynamic (based on click coordinates)
        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const header = document.createElement('div');
        header.className = 'vector-tile-selection-menu__header';
        header.textContent = `Selecionar camada (${features.length})`;
        menu.appendChild(header);

        features.forEach((feature) => {
            const item = document.createElement('div');
            item.className = 'vector-tile-selection-menu__item';
            item.textContent = this._getVectorTileFeatureName(feature);

            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.uiManager.showVectorTileInfoPanel(feature);
                this._hideVectorTileSelectionMenu();
            });

            menu.appendChild(item);
        });

        return menu;
    }

    /**
     * Gets display name for a vector tile feature
     * @param {Object} feature - Vector tile feature
     * @returns {string} Feature display name
     */
    _getVectorTileFeatureName(feature) {
        return feature.sourceLayer || 'Camada desconhecida';
    }

    /**
     * Hides and removes the selection menu
     */
    _hideVectorTileSelectionMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.pendingVectorTileFeatures = null;
        }
    }

    /**
     * Removes duplicate features caused by multiple layers (fill, border, label, etc.)
     * sharing the same source and sourceLayer.
     * Uses sourceLayer + feature id or properties hash as unique key.
     * @param {Array} features - Array of features from queryRenderedFeatures
     * @returns {Array} Deduplicated features array
     */
    _deduplicateFeatures(features) {
        const seen = new Map();

        for (const feature of features) {
            // Create a unique key combining sourceLayer and feature identity
            // Feature id is preferred, but fallback to properties hash if not available
            const featureId = feature.id ?? JSON.stringify(feature.properties);
            const uniqueKey = `${feature.sourceLayer}::${featureId}`;

            if (!seen.has(uniqueKey)) {
                seen.set(uniqueKey, feature);
            }
        }

        return Array.from(seen.values());
    }
}

export default VectorTileInfoControl;
