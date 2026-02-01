// Path: js/vector_info/vector-info.control.js
import config from '../config.js';
import { setupCleanup, addDomListener, cleanup } from '../utilities/event-cleanup.js';

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

    onAdd(map) {
        this.map = map;
    }

    onRemove() {
        this._hideVectorTileSelectionMenu();

        if (this.isActive && this.map) {
            this.map.off('click', this.handleMapClickBound);
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
        this.map.on('movestart', this._handleMoveStart);
        this.map.on('zoomstart', this._handleZoomStart);
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';

        this.map.off('click', this.handleMapClickBound);
        this.map.off('movestart', this._handleMoveStart);
        this.map.off('zoomstart', this._handleZoomStart);

        this.uiManager.saveChangesAndClosePanel();
    }

    handleMapClick(e) {
        if (this.isActive) {
            const features = this.map.queryRenderedFeatures(e.point);
            const filteredFeatures = features.filter(f => f.sourceLayer && !f.properties.source && !f.sourceLayer.startsWith('grid') && !f.sourceLayer.startsWith('situacao_ponto') && !f.sourceLayer.startsWith('fotos'));

            // Remove duplicates caused by multiple layers (fill, border, etc.) sharing the same source
            const vectorTileFeatures = this._deduplicateFeatures(filteredFeatures);

            if (vectorTileFeatures.length > 0) {
                const preferenceOrder = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

                vectorTileFeatures.sort((a, b) => {
                    const aPriority = a.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(a.geometry.type);
                    const bPriority = b.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(b.geometry.type);

                    return aPriority - bPriority;
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

        menu.style.cssText = `
            position: fixed !important;
            background: white !important;
            border: 1px solid #ccc !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
            z-index: 999999 !important;
            min-width: 200px !important;
            max-height: 300px !important;
            overflow-y: auto !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 14px !important;
            line-height: 1.4 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        `;

        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const header = document.createElement('div');
        header.textContent = `Selecionar camada (${features.length})`;
        header.style.cssText = `
            padding: 8px 12px !important;
            background: #f5f5f5 !important;
            color: #666 !important;
            border-bottom: 1px solid #ddd !important;
            font-weight: bold !important;
            font-size: 12px !important;
            margin: 0 !important;
        `;
        menu.appendChild(header);

        features.forEach((feature, index) => {
            const item = document.createElement('div');
            const featureName = this._getVectorTileFeatureName(feature);
            item.textContent = featureName;

            item.style.cssText = `
                padding: 10px 12px !important;
                cursor: pointer !important;
                border-bottom: ${index < features.length - 1 ? '1px solid #eee' : 'none'} !important;
                transition: background-color 0.2s !important;
                background: white !important;
                color: black !important;
                font-size: 14px !important;
                margin: 0 !important;
            `;

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#f0f8ff !important';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'white !important';
            });

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
