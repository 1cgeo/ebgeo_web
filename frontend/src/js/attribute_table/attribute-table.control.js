// Path: js/attribute_table/attribute-table.control.js

/**
 * @fileoverview Main controller for the Attribute Table feature.
 */

import { ATTRIBUTE_TABLE } from './attribute-table.constants.js';
import { tableDataService } from './services/table-data.service.js';
import { tableConfigService } from './services/table-config.service.js';
import {
    createTablePanel,
    setPanelState,
    getTableContainer,
    getFiltersContainer,
    updateLayerName,
    updateFeatureCount,
} from './components/table-panel.js';
import { createFiltersBar } from './components/table-filters.js';
import { renderTable, updateRowSelections } from './components/table-renderer.js';
import { showColumnContextMenu } from './components/column-context-menu.js';
import { EventTypes } from '@events';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { ensureTurf } from '@utils/turf-loader.js';
import { getLayers, getCurrentMapNameSync, isCurrentMapLockedSync, FEATURE_TYPE_MAPPINGS, FEATURE_DISPLAY_NAMES } from '@store';
import { showPrompt } from '@modals';
import userDataManager from '@js/user_data/user_data_manager.js';
import { showWarning, showError, showSuccess } from '@utils';
import { escapeCsvCell } from '@utils/csv-escape.js';

// turf is loaded as a global via script tag in index.html

/**
 * AttributeTableControl - Main orchestrator for the attribute table feature.
 */
export class AttributeTableControl {
    /**
     * @param {Object} options - Control options
     * @param {Object} options.map - MapLibre map instance
     * @param {Object} options.eventBus - Event bus instance
     * @param {Object} options.stateManager - State manager instance
     * @param {Object} options.selectionManager - Selection manager instance
     */
    constructor(options) {
        const { map, eventBus, stateManager, selectionManager } = options;

        this._map = map;
        this._eventBus = eventBus;
        this._stateManager = stateManager;
        this._selectionManager = selectionManager;

        // State
        this._currentLayerId = null;
        this._currentLayerName = '';
        this._panel = null;
        this._isOpen = false;
        this._panelState = ATTRIBUTE_TABLE.STATES.CLOSED;

        // Data state
        this._allFeatures = [];
        this._filteredFeatures = [];
        this._attributeColumns = [];

        // Filter state
        this._filterState = {
            search: '',
            types: new Set(),
            selectedOnly: false,
        };

        // Sort state
        this._sortState = {
            column: null,
            direction: null,
        };

        // Selection state
        this._selectedIds = new Set();

        // Event unsubscribers
        this._unsubscribers = [];

        // Hover state for map highlight
        this._hoveredFeatureId = null;
        this._hoveredFeatureType = null;
        this._hoveredSourceName = null;

        // Bind methods
        this._handleLayersChanged = this._handleLayersChanged.bind(this);
        this._handleFeatureUpdated = this._handleFeatureUpdated.bind(this);
        this._handleSelectionChanged = this._handleSelectionChanged.bind(this);
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Opens the attribute table for a layer.
     * @param {string} layerId - Layer ID
     */
    async open(layerId) {
        // If opening same layer that's already open, just ensure visible
        if (this._isOpen && this._currentLayerId === layerId) {
            if (this._panelState === ATTRIBUTE_TABLE.STATES.MINIMIZED) {
                this._expandPanel();
            }
            return;
        }

        // Close existing if different layer. Remove the old listeners too —
        // otherwise _setupEventListeners() below stacks duplicate LAYERS_CHANGED /
        // FEATURE_UPDATED subscriptions on every layer switch (handler leak).
        if (this._isOpen) {
            this._removeEventListeners();
            this._removePanel();
            // Reset user-added columns — they are per-layer and must not leak into
            // the layer we are switching to.
            this._extraColumns?.clear();
        }

        this._currentLayerId = layerId;
        this._isOpen = true;

        // Get layer info
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === layerId);
        this._currentLayerName = layer?.name || 'Camada';

        // Load config
        const mapName = getCurrentMapNameSync();
        const config = tableConfigService.getConfig(mapName, layerId);

        // Reset filter and sort state from config
        this._sortState = {
            column: config.sortColumn,
            direction: config.sortDirection,
        };

        // Load data
        await this._loadData();

        // Create panel
        this._createPanel(config.height);

        // Setup event listeners
        this._setupEventListeners();

        // Sync selection from map
        this._syncSelectionFromMap();
    }

    /**
     * Closes the attribute table.
     */
    close() {
        if (!this._isOpen) return;

        this._removeEventListeners();
        this._removePanel();
        this._clearMapHover();

        this._isOpen = false;
        this._currentLayerId = null;
        this._currentLayerName = '';
        this._allFeatures = [];
        this._filteredFeatures = [];
        this._attributeColumns = [];
        this._extraColumns?.clear();
        this._selectedIds.clear();

        this._filterState = {
            search: '',
            types: new Set(),
            selectedOnly: false,
        };

        this._sortState = {
            column: null,
            direction: null,
        };
    }

    /**
     * Toggles the attribute table for a layer.
     * @param {string} layerId - Layer ID
     */
    async toggle(layerId) {
        if (this._isOpen && this._currentLayerId === layerId) {
            this.close();
        } else {
            await this.open(layerId);
        }
    }

    /**
     * Checks if the table is open.
     * @returns {boolean} True if open
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * Gets the current layer ID.
     * @returns {string|null} Current layer ID
     */
    getCurrentLayerId() {
        return this._currentLayerId;
    }

    /**
     * Refreshes the table data.
     */
    async refresh() {
        if (!this._isOpen) return;
        await this._loadData();
        this._renderTable();
    }

    /**
     * Destroys the control and cleans up resources.
     */
    destroy() {
        this.close();
    }

    // =========================================================================
    // PRIVATE - PANEL MANAGEMENT
    // =========================================================================

    /**
     * Creates the panel element.
     * @param {number} [height] - Initial height
     */
    _createPanel(height) {
        this._panel = createTablePanel({
            layerName: this._currentLayerName,
            featureCount: this._allFeatures.length,
            filteredCount: this._filteredFeatures.length,
            height,
            onClose: () => this.close(),
            onMinimize: () => this._toggleMinimize(),
            onAddColumn: () => this._handleAddColumn(),
            onCsvExport: () => this._handleCsvExport(),
            onResize: (newHeight) => this._handleResize(newHeight),
        });

        // Create filters
        const filtersContainer = getFiltersContainer(this._panel);
        const availableTypes = tableDataService.getFeatureTypes(this._allFeatures);

        const filtersBar = createFiltersBar({
            availableTypes,
            initialState: this._filterState,
            onFilterChange: (changes) => this._handleFilterChange(changes),
        });

        filtersContainer.replaceWith(filtersBar);

        // Add to DOM
        document.body.appendChild(this._panel);
        this._panelState = ATTRIBUTE_TABLE.STATES.EXPANDED;

        // Render table
        this._renderTable();

        // Trigger reflow then show
        this._panel.offsetHeight;
        this._panel.dataset.state = ATTRIBUTE_TABLE.STATES.EXPANDED;
    }

    /**
     * Removes the panel from DOM.
     */
    _removePanel() {
        if (this._panel) {
            this._panel.remove();
            this._panel = null;
        }
        this._panelState = ATTRIBUTE_TABLE.STATES.CLOSED;
    }

    /**
     * Toggles minimize state.
     */
    _toggleMinimize() {
        if (this._panelState === ATTRIBUTE_TABLE.STATES.MINIMIZED) {
            this._expandPanel();
        } else {
            this._minimizePanel();
        }
    }

    /**
     * Minimizes the panel.
     */
    _minimizePanel() {
        this._panelState = ATTRIBUTE_TABLE.STATES.MINIMIZED;
        setPanelState(this._panel, ATTRIBUTE_TABLE.STATES.MINIMIZED);
    }

    /**
     * Expands the panel.
     */
    _expandPanel() {
        this._panelState = ATTRIBUTE_TABLE.STATES.EXPANDED;
        setPanelState(this._panel, ATTRIBUTE_TABLE.STATES.EXPANDED);
    }

    /**
     * Handles panel resize.
     * @param {number} newHeight - New height
     */
    _handleResize(newHeight) {
        const mapName = getCurrentMapNameSync();
        tableConfigService.saveHeight(mapName, this._currentLayerId, newHeight);
    }

    // =========================================================================
    // PRIVATE - DATA MANAGEMENT
    // =========================================================================

    /**
     * Loads data for the current layer.
     */
    async _loadData() {
        // Get features
        this._allFeatures = await tableDataService.getLayerFeatures(this._currentLayerId);

        // Get attribute columns
        this._attributeColumns = tableDataService.getAttributeColumns(this._allFeatures);

        // Merge user-added columns that no feature carries a value for yet, so a
        // refresh (LAYERS_CHANGED/FEATURE_UPDATED) does not silently drop a freshly
        // added empty column before the user types a value into it.
        if (this._extraColumns && this._extraColumns.size > 0) {
            for (const key of this._extraColumns) {
                if (!this._attributeColumns.includes(key)) {
                    this._attributeColumns.push(key);
                }
            }
            this._attributeColumns.sort((a, b) =>
                a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
            );
        }

        // Apply filters and sort
        this._applyFiltersAndSort();
    }

    /**
     * Applies filters and sorting to the data.
     */
    _applyFiltersAndSort() {
        // Filter
        this._filteredFeatures = tableDataService.filterFeatures(this._allFeatures, {
            search: this._filterState.search,
            types: this._filterState.types,
            selectedOnly: this._filterState.selectedOnly,
            selectedIds: this._selectedIds,
        });

        // Sort
        this._filteredFeatures = tableDataService.sortFeatures(
            this._filteredFeatures,
            this._sortState
        );
    }

    // =========================================================================
    // PRIVATE - RENDERING
    // =========================================================================

    /**
     * Renders the table.
     */
    _renderTable() {
        if (!this._panel) return;

        const container = getTableContainer(this._panel);
        if (!container) return;

        // Get column widths from config
        const mapName = getCurrentMapNameSync();
        const config = tableConfigService.getConfig(mapName, this._currentLayerId);

        renderTable(container, {
            features: this._filteredFeatures,
            attributeColumns: this._attributeColumns,
            selectedIds: this._selectedIds,
            sortState: this._sortState,
            columnWidths: config.columnWidths,
            callbacks: {
                readOnly: isCurrentMapLockedSync(),
                onCheckboxChange: (featureId, checked) =>
                    this._handleCheckboxChange(featureId, checked),
                onSelectAll: (checked) => this._handleSelectAll(checked),
                onCellEdit: (featureId, featureType, columnKey, newValue) =>
                    this._handleCellEdit(featureId, featureType, columnKey, newValue),
                onZoomToFeature: (feature) => this._handleZoomToFeature(feature),
                onRowHover: (feature, isHovering) =>
                    this._handleRowHover(feature, isHovering),
                onColumnSort: (columnKey) => this._handleColumnSort(columnKey),
                onColumnContextMenu: (columnKey, event) =>
                    this._handleColumnContextMenu(columnKey, event),
            },
        });

        // Update count display
        updateFeatureCount(
            this._panel,
            this._allFeatures.length,
            this._filteredFeatures.length
        );
    }

    // =========================================================================
    // PRIVATE - EVENT HANDLERS
    // =========================================================================

    /**
     * Sets up event listeners.
     */
    _setupEventListeners() {
        this._unsubscribers.push(
            this._eventBus.on(EventTypes.LAYERS_CHANGED, this._handleLayersChanged)
        );

        this._unsubscribers.push(
            this._eventBus.on(EventTypes.FEATURE_UPDATED, this._handleFeatureUpdated)
        );

        // Subscribe to selection changes via StateManager
        if (this._stateManager) {
            const unsubscribe = this._stateManager.subscribe(
                'selection.features',
                this._handleSelectionChanged
            );
            if (unsubscribe) {
                this._unsubscribers.push(unsubscribe);
            }
        }
    }

    /**
     * Removes event listeners.
     */
    _removeEventListeners() {
        this._unsubscribers.forEach((unsub) => {
            if (typeof unsub === 'function') {
                unsub();
            }
        });
        this._unsubscribers = [];
    }

    /**
     * Handles layers changed event.
     */
    async _handleLayersChanged() {
        if (!this._isOpen) return;

        // Check if our layer still exists
        const layers = await getLayers();
        const layer = layers.find((l) => l.id === this._currentLayerId);

        if (!layer) {
            // Layer was deleted
            this.close();
            return;
        }

        // Update layer name if changed
        if (layer.name !== this._currentLayerName) {
            this._currentLayerName = layer.name;
            if (this._panel) {
                updateLayerName(this._panel, this._currentLayerName);
            }
        }

        // Refresh data
        await this.refresh();
    }

    /**
     * Handles feature updated event.
     * @param {Object} payload - Event payload
     */
    async _handleFeatureUpdated(payload) {
        if (!this._isOpen) return;

        // Check if updated feature belongs to our layer
        const feature = this._allFeatures.find(
            (f) =>
                f.properties?.id === payload.featureId &&
                f.properties?.source === payload.featureType
        );

        if (feature) {
            await this.refresh();
        }
    }

    /**
     * Handles selection changed from StateManager.
     */
    _handleSelectionChanged() {
        if (!this._isOpen) return;
        this._syncSelectionFromMap();
    }

    /**
     * Syncs selection state from the map.
     */
    _syncSelectionFromMap() {
        const selectedFeatures = this._selectionManager.getAllSelectedFeatures();
        this._selectedIds.clear();

        for (const f of selectedFeatures) {
            const featureId = f.properties?.id;
            // Check if feature belongs to current layer
            const layerId = f.properties?.layerId || 'default';
            if (layerId === this._currentLayerId && featureId) {
                this._selectedIds.add(featureId);
            }
        }

        // If "selected only" filter is active, re-filter
        if (this._filterState.selectedOnly) {
            this._applyFiltersAndSort();
            this._renderTable();
        } else {
            // Just update row selections
            if (this._panel) {
                const container = getTableContainer(this._panel);
                const tbody = container?.querySelector('tbody');
                if (tbody) {
                    updateRowSelections(tbody, this._selectedIds);
                }
            }
        }
    }

    // =========================================================================
    // PRIVATE - FILTER HANDLERS
    // =========================================================================

    /**
     * Handles filter changes.
     * @param {Object} changes - Filter changes
     */
    _handleFilterChange(changes) {
        Object.assign(this._filterState, changes);
        this._applyFiltersAndSort();
        this._renderTable();
    }

    // =========================================================================
    // PRIVATE - SELECTION HANDLERS
    // =========================================================================

    /**
     * Handles checkbox change.
     * Selection is now only via checkbox - no row click, shift, or ctrl modifiers.
     * Supports multi-selection by adding/removing from existing selection.
     * @param {string} featureId - Feature ID
     * @param {boolean} checked - Checked state
     */
    async _handleCheckboxChange(featureId, checked) {
        const feature = this._filteredFeatures.find(
            (f) => f.properties?.id === featureId
        );

        if (!feature) return;

        const featureType = feature.properties?.source;
        if (!featureType) return;

        if (checked) {
            // Add to selection without clearing existing selection
            if (!this._selectionManager.isFeatureSelected(featureType, featureId)) {
                await this._selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
            }
        } else {
            // Remove from selection
            if (this._selectionManager.isFeatureSelected(featureType, featureId)) {
                await this._selectionManager.toggleFeatureSelection(featureType, featureId, feature, true);

                // Sync edit handles for remaining selected features
                this._syncEditHandlesForType(featureType);
            }
        }

        // Update UI (panels, handles, etc.)
        this._selectionManager.updateUI();
    }

    /**
     * Syncs edit handles for a feature type after deselection.
     * Re-creates handles for the first remaining selected feature or clears them.
     * @param {string} featureType - Feature type (singular)
     */
    _syncEditHandlesForType(featureType) {
        const control = this._selectionManager.controls?.get(featureType);
        if (!control) return;

        // Get remaining selected features of this type
        const remainingSelected = this._selectionManager.getSelectedFeaturesByType(featureType);

        if (remainingSelected.length > 0 && control.createEditHandles) {
            // Re-create handles for the first remaining feature
            control.createEditHandles(remainingSelected[0].feature);
        } else if (control.clearEditHandles) {
            // No more selected features of this type - clear handles
            control.clearEditHandles();
        }
    }

    /**
     * Handles select all.
     * @param {boolean} checked - Checked state
     */
    async _handleSelectAll(checked) {
        if (checked) {
            // Select all filtered features (add to selection)
            for (const feature of this._filteredFeatures) {
                const featureId = feature.properties?.id;
                const featureType = feature.properties?.source;

                if (featureId && featureType) {
                    if (!this._selectionManager.isFeatureSelected(featureType, featureId)) {
                        await this._selectionManager.toggleFeatureSelection(featureType, featureId, feature, false);
                    }
                }
            }
        } else {
            // Deselect all
            this._selectionManager.deselectAllFeatures();
        }

        // Update UI
        this._selectionManager.updateUI();
    }

    // =========================================================================
    // PRIVATE - EDIT HANDLERS
    // =========================================================================

    /**
     * Handles cell edit.
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature type (singular, e.g., 'polygon')
     * @param {string} columnKey - Column key
     * @param {string} newValue - New value
     */
    async _handleCellEdit(featureId, featureType, columnKey, newValue) {
        if (isCurrentMapLockedSync()) return;

        try {
            if (columnKey === 'nome' || columnKey === 'descricao') {
                // Convert singular type to plural storage type (e.g., 'polygon' -> 'polygons')
                const storageType = FEATURE_TYPE_MAPPINGS[featureType] || featureType;

                // Update in persistence (IndexedDB)
                const { updateFeatureProperty } = await import('@store/feature.operations.js');
                await updateFeatureProperty(storageType, featureId, columnKey, newValue);

                // Update in MapLibre source
                this._updateMapLibreSource(storageType, featureId, columnKey, newValue);

                // Update SelectionManager if this feature is selected
                this._updateSelectionManagerFeature(featureId, featureType, columnKey, newValue);

                // Emit LAYERS_CHANGED to update UI (features tab, etc.)
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            } else {
                // Update attribute via userDataManager
                await userDataManager.setAttribute(featureId, featureType, columnKey, newValue);
            }
        } catch (error) {
            console.error('Error saving cell edit:', error);
            // Refresh to revert
            await this.refresh();
        }
    }

    /**
     * Updates a feature property in the MapLibre source.
     * @param {string} sourceId - MapLibre source ID (plural form, e.g., 'polygons')
     * @param {string} featureId - Feature ID
     * @param {string} property - Property name
     * @param {*} value - New value
     */
    _updateMapLibreSource(sourceId, featureId, property, value) {
        if (!this._map.getSource(sourceId)) {
            console.warn(`Source ${sourceId} not found`);
            return;
        }

        // A one-property change is exactly what the dispatcher's `patch` expresses, and going
        // through it is mandatory rather than tidy: these sources are dispatcher-owned, so the
        // read-modify-write that used to live here replaced MapLibre's pending-update slot and
        // dropped whatever diff a tool had queued, with no error. The read is gone with it: the
        // patch keys on the promoted id, so nothing needs to be located first.
        getGeoJsonDispatcher(this._map, sourceId).patch(featureId, { setProps: { [property]: value } });
    }

    /**
     * Updates a feature in the SelectionManager if it's selected.
     * Also refreshes the feature panel to show updated data.
     * @param {string} featureId - Feature ID
     * @param {string} featureType - Feature type (singular)
     * @param {string} property - Property name
     * @param {*} value - New value
     */
    _updateSelectionManagerFeature(featureId, featureType, property, value) {
        if (!this._selectionManager.isFeatureSelected(featureType, featureId)) {
            return;
        }

        const selectedFeatures = this._selectionManager.getAllSelectedFeatures();
        const feature = selectedFeatures.find(
            (f) => f.properties?.id === featureId && f.properties?.source === featureType
        );

        if (feature) {
            feature.properties[property] = value;
            this._selectionManager.updateSelectedFeature(featureType, featureId, feature);

            // Re-emit FEATURE_PANEL_OPENED to refresh the panel with updated data
            this._eventBus.emit(EventTypes.FEATURE_PANEL_OPENED, {
                featureId,
                featureType,
            });
        }
    }

    /**
     * Handles add column action.
     */
    async _handleAddColumn() {
        if (isCurrentMapLockedSync()) return;
        const name = await showPrompt('Nome do novo atributo:', '');
        if (!name || !name.trim()) return;

        const key = name.trim();

        // Validate key
        const validation = userDataManager.validateAttributeKey(key);
        if (!validation.valid) {
            showWarning(validation.reason);
            return;
        }

        // Check if already exists
        if (this._attributeColumns.includes(key)) {
            showWarning(`O atributo "${key}" já existe.`);
            return;
        }

        // Track as a user-added column so it survives refreshes until a value is
        // entered (columns are otherwise recomputed from feature data each load).
        if (!this._extraColumns) this._extraColumns = new Set();
        this._extraColumns.add(key);

        this._attributeColumns.push(key);
        this._attributeColumns.sort((a, b) =>
            a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
        );

        this._renderTable();
    }

    /**
     * Handles column context menu.
     * @param {string} columnKey - Column key
     * @param {MouseEvent} event - Event
     */
    _handleColumnContextMenu(columnKey, event) {
        showColumnContextMenu(columnKey, event, {
            onRemoveColumn: (key) => this._handleRemoveColumn(key),
        });
    }

    /**
     * Handles remove column action.
     * @param {string} columnKey - Column key
     */
    async _handleRemoveColumn(columnKey) {
        if (isCurrentMapLockedSync()) return;
        try {
            // Remove attribute from all features in this layer
            for (const feature of this._allFeatures) {
                const featureId = feature.properties?.id;
                const featureType = feature.properties?.source;

                if (featureId && featureType) {
                    await userDataManager.removeAttribute(featureId, featureType, columnKey);
                }
            }

            // Refresh
            await this.refresh();
        } catch (error) {
            console.error('Error removing column:', error);
            showError('Erro ao remover atributo: ' + error.message);
        }
    }

    // =========================================================================
    // PRIVATE - CSV EXPORT
    // =========================================================================

    /**
     * Exports the current (filtered/sorted) table data as CSV.
     */
    _handleCsvExport() {
        if (this._filteredFeatures.length === 0) {
            showWarning('Nenhuma feição para exportar.');
            return;
        }

        // Headers include user-authored attribute column names, so they need the
        // same formula-injection escaping as the body cells.
        const headers = ['Tipo', 'Nome', ...this._attributeColumns];
        const rows = [headers.map(escapeCsvCell).join(',')];

        for (const feature of this._filteredFeatures) {
            const rawType = feature.properties?.source || '';
            const type = FEATURE_DISPLAY_NAMES[rawType] || rawType;
            const name = feature.properties?.nome || '';
            const attrValues = this._attributeColumns.map(col => {
                const val = feature.properties?.attributes?.[col];
                return val != null ? String(val) : '';
            });

            const row = [type, name, ...attrValues];
            rows.push(row.map(escapeCsvCell).join(','));
        }

        // UTF-8 BOM for Excel compatibility
        const bom = '\uFEFF';
        const csv = bom + rows.join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${this._currentLayerName}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showSuccess('CSV exportado com sucesso!');
    }

    // =========================================================================
    // PRIVATE - SORT HANDLERS
    // =========================================================================

    /**
     * Handles column sort.
     * @param {string} columnKey - Column key
     */
    _handleColumnSort(columnKey) {
        // Cycle through: none -> asc -> desc -> none
        if (this._sortState.column !== columnKey) {
            this._sortState.column = columnKey;
            this._sortState.direction = 'asc';
        } else if (this._sortState.direction === 'asc') {
            this._sortState.direction = 'desc';
        } else {
            this._sortState.column = null;
            this._sortState.direction = null;
        }

        // Save to config
        const mapName = getCurrentMapNameSync();
        tableConfigService.saveSortConfig(
            mapName,
            this._currentLayerId,
            this._sortState.column,
            this._sortState.direction
        );

        // Re-render
        this._applyFiltersAndSort();
        this._renderTable();
    }

    // =========================================================================
    // PRIVATE - ZOOM AND HOVER
    // =========================================================================

    /**
     * Handles zoom to feature.
     *
     * ASSINCRONO DESDE 2026-08-25, e a troca custou UM chamador: o `onZoomToFeature` que
     * `_renderTable` passa ao renderizador, que descarta o retorno. Este e o caso em que
     * tornar o metodo assincrono e mais barato do que arrumar um funil anterior: a tabela de
     * atributos abre por gesto proprio, nao passa por `ensureControl` nem por selecao, e o
     * unico Turf que ela le e o `turf.bbox` de enquadrar uma feicao que nao e ponto.
     *
     * O `await` fica DEPOIS da guarda de feicao vazia e ANTES do `try`: enquadrar um PONTO
     * nao le Turf nenhum, mas separar os dois caminhos por causa disso trocaria uma linha por
     * um ramo, e quem clica em "ir para a feicao" numa tabela clica em varias.
     *
     * @param {Object} feature - Feature
     * @returns {Promise<void>}
     */
    async _handleZoomToFeature(feature) {
        if (!feature || !feature.geometry) return;

        await ensureTurf().catch((erro) => {
            console.warn('Turf nao carregou para enquadrar a feicao:', erro);
        });

        try {
            const geometryType = feature.geometry.type;

            if (geometryType === 'Point') {
                const coords = feature.geometry.coordinates;
                this._map.flyTo({
                    center: coords,
                    zoom: 16,
                    duration: 1000,
                });
            } else {
                const bbox = turf.bbox(feature);
                this._map.fitBounds(
                    [
                        [bbox[0], bbox[1]],
                        [bbox[2], bbox[3]],
                    ],
                    {
                        padding: 50,
                        duration: 1000,
                    }
                );
            }
        } catch (error) {
            console.error('Error zooming to feature:', error);
        }
    }

    /**
     * Handles row hover.
     * @param {Object} feature - Feature
     * @param {boolean} isHovering - Whether hovering
     */
    _handleRowHover(feature, isHovering) {
        if (isHovering) {
            this._setMapHover(feature);
        } else {
            this._clearMapHover();
        }
    }

    /**
     * Gets the MapLibre source name from a feature type.
     * Feature types are stored as singular (e.g., 'polygon') but MapLibre sources use plural (e.g., 'polygons').
     * @param {string} featureType - Feature type (singular)
     * @returns {string} MapLibre source name (plural)
     */
    _getSourceName(featureType) {
        return FEATURE_TYPE_MAPPINGS[featureType] || featureType;
    }

    /**
     * Sets hover highlight on map.
     * @param {Object} feature - Feature
     */
    _setMapHover(feature) {
        // Clear previous hover
        this._clearMapHover();

        const featureId = feature.properties?.id;
        const featureType = feature.properties?.source;

        if (!featureId || !featureType) return;

        // Get the source name (plural form)
        const sourceName = this._getSourceName(featureType);

        // Check if source exists before trying to set state
        if (!this._map.getSource(sourceName)) {
            return;
        }

        this._hoveredFeatureId = featureId;
        this._hoveredFeatureType = featureType;
        this._hoveredSourceName = sourceName;

        // Use MapLibre feature state
        try {
            this._map.setFeatureState(
                { source: sourceName, id: featureId },
                { tableHover: true }
            );
        } catch (error) {
            // Feature state may not work for all sources
            console.debug('Could not set feature state:', error.message);
        }
    }

    /**
     * Clears hover highlight from map.
     */
    _clearMapHover() {
        if (this._hoveredFeatureId && this._hoveredSourceName) {
            // Check if source still exists
            if (this._map.getSource(this._hoveredSourceName)) {
                try {
                    this._map.setFeatureState(
                        { source: this._hoveredSourceName, id: this._hoveredFeatureId },
                        { tableHover: false }
                    );
                } catch (_error) {
                    // Ignore
                }
            }

            this._hoveredFeatureId = null;
            this._hoveredFeatureType = null;
            this._hoveredSourceName = null;
        }
    }
}
