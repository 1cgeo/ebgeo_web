// Path: js/map/map.control.js

/**
 * @fileoverview Map control panel with tabs for maps, features, and PDF export.
 * Delegates sidebar state (collapsed, activeTab) to StateManager.
 */

import {
    initializeWithLastActiveMap,
    setCurrentMap,
    getCurrentMapName,
    getAllMapNamesStore,
    getEventBus,
    getStateManager
} from '../store';

import { IDUtils, showToast as toastServiceShow } from '../utilities';

import Sortable from 'sortablejs';
import MapManager from './map.manager.js';
import { ExportImportService, PDFExportTab } from '../import_export';
import { FeaturesTab } from '../features_tab';
import { showPrompt, showConfirm } from '../modals/index.js';
import { CombineMapsModal } from '../modals/combine-maps.modal.js';

class MapControl {
    constructor(baseLayerControl, analysisLayersManager) {
        this.baseLayerControl = baseLayerControl;
        this.analysisLayersManager = analysisLayersManager;
        this.selectionManager = null;

        this.mapManager = new MapManager(baseLayerControl, this.selectionManager);
        this.exportImportService = new ExportImportService(baseLayerControl, this, this.mapManager, getEventBus());

        this.reopenButton = null;
        this.pdfExportTab = null;
        this.featuresTab = null;
        this.mapsActionsContainer = null;

        /** @type {Array<Function>} Cleanup functions for subscriptions */
        this._unsubscribers = [];
    }

    // =========================================================================
    // STATE MANAGER INTEGRATION
    // =========================================================================

    /**
     * Get collapsed state from StateManager.
     * Note: StateManager stores 'expanded', so we invert it.
     * @returns {boolean}
     */
    get isCollapsed() {
        try {
            return !getStateManager().get('sidebar.expanded');
        } catch (_e) {
            return false;
        }
    }

    /**
     * Get current tab from StateManager.
     * @returns {string}
     */
    get currentTab() {
        try {
            return getStateManager().get('sidebar.activeTab') || 'maps';
        } catch (_e) {
            return 'maps';
        }
    }

    // =========================================================================
    // SETUP
    // =========================================================================

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
        this.mapManager.selectionManager = selectionManager;

        this.mapManager.setMapControl(this);
    }

    deactivateActiveTools() {
        if (this.selectionManager && this.selectionManager.uiManager && this.selectionManager.uiManager.toolManager) {
            this.selectionManager.uiManager.toolManager.deactivateCurrentTool();
        }
    }

    onAdd(map) {
        this.map = map;
        this.mapManager.setMap(map);
        this.pdfExportTab = new PDFExportTab(map);

        this.featuresTab = new FeaturesTab(map, this.selectionManager, this.analysisLayersManager, getEventBus());

        this.container = document.createElement('div');
        this.container.id = 'map-list'
        this.container.className = 'list-map-container';

        const col = document.createElement('div');
        col.id = 'header-map-list';
        col.className = 'header-container-column';

        const headerContainer = document.createElement('div');
        headerContainer.className = 'header-container-row';
        headerContainer.appendChild(col);

        const collapseButton = document.createElement('button');
        collapseButton.className = 'collapse-button';
        collapseButton.id = 'collapse-panel-btn';
        collapseButton.title = 'Esconder painel';
        collapseButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
    `;

        collapseButton.addEventListener('click', () => this.collapsePanel());

        headerContainer.appendChild(collapseButton);

        const titleContainer = document.createElement('div');
        titleContainer.id = 'menu-map-list';
        titleContainer.className = 'menu-container';
        col.appendChild(titleContainer);
        this.container.appendChild(headerContainer);

        this.contentArea = document.createElement('div');
        this.contentArea.className = 'tab-content-area';

        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';

        this.pdfExportContainer = document.createElement('div');
        this.pdfExportContainer.className = 'pdf-export-tab-content';
        this.pdfExportContainer.innerHTML = this.pdfExportTab.createUI();
        this.pdfExportContainer.style.display = 'none';

        this.featuresTabContainer = this.featuresTab.createUI();

        this.contentArea.appendChild(this.mapList);
        this.contentArea.appendChild(this.pdfExportContainer);
        this.contentArea.appendChild(this.featuresTabContainer);
        this.container.appendChild(this.contentArea);

        this.updateMapList();

        this.initSortable();

        this.createReopenButton();

        return this.container;
    }

    async loadMenu() {
        await initializeWithLastActiveMap();

        const menuMapList = document.getElementById('menu-map-list');
        if (menuMapList) menuMapList.innerHTML = '';

        const tabSelector = document.createElement('div');
        tabSelector.className = 'tab-selector';

        const mapsTab = document.createElement('button');
        mapsTab.className = 'tab-button active';
        mapsTab.textContent = 'Mapas';
        mapsTab.addEventListener('click', () => this.switchToTab('maps'));

        const featuresTab = document.createElement('button');
        featuresTab.className = 'tab-button';
        featuresTab.textContent = 'Camadas';
        featuresTab.addEventListener('click', () => this.switchToTab('features'));

        const pdfTab = document.createElement('button');
        pdfTab.className = 'tab-button';
        pdfTab.textContent = 'Exportar';
        pdfTab.addEventListener('click', () => this.switchToTab('pdf'));

        tabSelector.appendChild(mapsTab);
        tabSelector.appendChild(featuresTab);
        tabSelector.appendChild(pdfTab);

        const headerMapList = document.getElementById('header-map-list');
        if (headerMapList) headerMapList.appendChild(tabSelector);

        const baseLayerControl = document.querySelector('.base-layer-control');
        if (baseLayerControl && headerMapList) {
            headerMapList.appendChild(baseLayerControl);
        }

        this.mapsActionsContainer = document.createElement('div');
        this.mapsActionsContainer.className = 'maps-actions-container';
        this.mapsActionsContainer.id = 'maps-actions-container';

        const allActionsContainer = document.createElement('div');
        allActionsContainer.className = 'all-actions-container';

        const saveButton = this.exportImportService.createSaveButton();
        const loadButton = this.exportImportService.createLoadButton();
        const loadAdditiveButton = this.exportImportService.createLoadAdditiveButton();

        const addButton = document.createElement('button');
        addButton.className = 'map-action-button add-map-button';
        addButton.innerHTML = `<img src="./images/icon_add.svg" alt="Adicionar mapa" />`;
        addButton.title = 'Adicionar novo mapa';
        addButton.onclick = async () => {
            this.deactivateActiveTools();
            const existingMaps = await getAllMapNamesStore();
            const defaultName = IDUtils.generateUniqueMapName(existingMaps, 'Novo Mapa');
            const mapName = await showPrompt("Nome do novo mapa:", defaultName);
            if (mapName && mapName.trim()) {
                const result = await this.mapManager.createMap(mapName.trim());
                this.showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    await this.updateMapList();
                }
            } else if (mapName !== null) {
                this.showToast("Nome inválido.", 'error');
            }
        };

        const clearButton = document.createElement('button');
        clearButton.className = 'map-action-button destructive-action';
        clearButton.innerHTML = `<img src="./images/icon_trash_red.svg" alt="Limpar tudo" />`;
        clearButton.title = 'Limpar todos os dados (irreversível)';
        clearButton.onclick = () => this.clearAllData();

        allActionsContainer.appendChild(saveButton);
        allActionsContainer.appendChild(loadButton);
        allActionsContainer.appendChild(loadAdditiveButton);
        allActionsContainer.appendChild(addButton);
        allActionsContainer.appendChild(clearButton);

        this.mapsActionsContainer.appendChild(allActionsContainer);

        const menuMapListEl = document.getElementById('menu-map-list');
        if (menuMapListEl) menuMapListEl.appendChild(this.mapsActionsContainer);

        this.updateVisibilityForCurrentTab();

        await this.updateMapList();
    }

    // =========================================================================
    // TAB MANAGEMENT
    // =========================================================================

    switchToTab(tabName) {
        // Sync to StateManager
        try {
            getStateManager().setActiveTab(tabName);
        } catch (_e) {
            // StateManager not available
        }

        const tabButtons = this.container.querySelectorAll('.tab-button');
        tabButtons.forEach(btn => btn.classList.remove('active'));

        if (tabName === 'maps') {
            tabButtons[0].classList.add('active');
            this.showMapsTab();
        } else if (tabName === 'features') {
            tabButtons[1].classList.add('active');
            this.showFeaturesTab();
        } else if (tabName === 'pdf') {
            tabButtons[2].classList.add('active');
            this.showPDFTab();
        }

        this.updateVisibilityForCurrentTab();
    }

    showMapsTab() {
        this.mapList.style.display = 'block';
        this.pdfExportContainer.style.display = 'none';
        this.featuresTabContainer.style.display = 'none';

        if (this.pdfExportTab) {
            this.pdfExportTab.hide();
        }
        if (this.featuresTab) {
            this.featuresTab.hide();
        }
    }

    showPDFTab() {
        this.mapList.style.display = 'none';
        this.pdfExportContainer.style.display = 'block';
        this.featuresTabContainer.style.display = 'none';

        if (this.pdfExportTab) {
            this.pdfExportTab.show();
        }
        if (this.featuresTab) {
            this.featuresTab.hide();
        }
    }

    showFeaturesTab() {
        this.mapList.style.display = 'none';
        this.pdfExportContainer.style.display = 'none';
        this.featuresTabContainer.style.display = 'block';

        if (this.pdfExportTab) {
            this.pdfExportTab.hide();
        }
        if (this.featuresTab) {
            this.featuresTab.show();
        }
    }

    // =========================================================================
    // PANEL MANAGEMENT
    // =========================================================================

    collapsePanel(type = 'normal') {
        this.container.classList.add('collapsed');

        if (type === 'normal') {
            this.createReopenButton();
            this.reopenButton.classList.add('show');
        }

        // Sync to StateManager (expanded = false)
        try {
            getStateManager().set('sidebar.expanded', false);
        } catch (_e) {
            // StateManager not available
        }

        this.updateVisibilityForCurrentTab();

        if (this.currentTab === 'pdf' && this.pdfExportTab) {
            this.pdfExportTab.hide();
        }
        if (this.currentTab === 'features' && this.featuresTab) {
            this.featuresTab.hide();
        }
    }

    expandPanel() {
        this.container.classList.remove('collapsed');
        if (this.reopenButton) {
            this.reopenButton.classList.remove('show');
        }

        // Sync to StateManager (expanded = true)
        try {
            getStateManager().set('sidebar.expanded', true);
        } catch (_e) {
            // StateManager not available
        }

        this.updateVisibilityForCurrentTab();

        if (this.currentTab === 'pdf' && this.pdfExportTab) {
            this.pdfExportTab.show();
        }
        if (this.currentTab === 'features' && this.featuresTab) {
            this.featuresTab.show();
        }
    }

    createReopenButton() {
        if (this.reopenButton) return;

        this.reopenButton = document.createElement('button');
        this.reopenButton.className = 'reopen-button';
        this.reopenButton.title = 'Mostrar painel';
        this.reopenButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/>
        </svg>
    `;

        this.reopenButton.addEventListener('click', () => this.expandPanel());
        document.body.appendChild(this.reopenButton);
    }

    initSortable() {
        if (typeof Sortable === 'undefined') {
            console.warn('Sortable.js not loaded');
            return;
        }

        this.sortableInstance = Sortable.create(this.mapList, {
            handle: '.map-drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: async (_evt) => {
                const newOrder = Array.from(this.mapList.querySelectorAll('li'))
                    .map(li => li.dataset.mapName)
                    .filter(Boolean);

                await this.mapManager.updateMapOrder(newOrder);
            }
        });
    }

    updateVisibilityForCurrentTab() {
        this.updateActionsVisibility();
        this.updateBaseLayerControlVisibility();
    }

    updateActionsVisibility() {
        if (!this.mapsActionsContainer) return;

        if (this.isCollapsed) {
            this.mapsActionsContainer.style.display = 'none';
        } else {
            this.mapsActionsContainer.style.display = 'block';
        }
    }

    updateBaseLayerControlVisibility() {
        const baseLayerControl = document.querySelector('.base-layer-control');

        if (baseLayerControl) {
            if (this.currentTab === 'maps' && !this.isCollapsed) {
                baseLayerControl.style.setProperty('display', 'grid', 'important');
                baseLayerControl.classList.remove('base-layer-hidden');
            } else {
                baseLayerControl.style.setProperty('display', 'none', 'important');
                baseLayerControl.classList.add('base-layer-hidden');
            }
        }
    }

    // =========================================================================
    // INTERFACE UPDATES
    // =========================================================================

    async updateMapList() {
        const mapListData = await this.mapManager.generateMapListData();

        const existingItems = new Map();
        this.mapList.querySelectorAll('li').forEach(item => {
            const mapName = item.dataset.mapName;
            if (mapName) {
                existingItems.set(mapName, item);
            }
        });

        for (const [mapName, item] of existingItems) {
            if (!mapListData.find(data => data.name === mapName)) {
                item.remove();
                existingItems.delete(mapName);
            }
        }

        this.mapList.innerHTML = '';

        for (const mapData of mapListData) {
            let listItem = existingItems.get(mapData.name);

            if (!listItem) {
                listItem = this.createMapListItem(mapData);
            }

            listItem.className = mapData.isCurrentMap ? 'current-map' : '';

            const mapNameDisplay = listItem.querySelector('.map-name-display');
            const positionIndicator = mapData.hasSavedPosition ? ' 📍' : '';
            mapNameDisplay.textContent = mapData.name + positionIndicator;

            this.mapList.appendChild(listItem);
        }
    }

    createMapListItem(mapData) {
        const listItem = document.createElement('li');
        listItem.dataset.mapName = mapData.name;

        const itemContent = document.createElement('div');
        itemContent.className = 'map-item-main clickable-area';

        const mapNameDisplay = document.createElement('div');
        mapNameDisplay.className = 'map-name-display';

        const positionIndicator = mapData.hasSavedPosition ? ' 📍' : '';
        mapNameDisplay.textContent = mapData.name + positionIndicator;

        itemContent.appendChild(mapNameDisplay);

        itemContent.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const currentMapName = await getCurrentMapName();
            if (mapData.name !== currentMapName) {
                await setCurrentMap(mapData.name);
                await this.baseLayerControl.switchMap();
                await this.updateMapList();
            } else {
                await this.baseLayerControl.applyMapSavedPosition(mapData.name);
            }
        });

        const notesButton = document.createElement('button');
        notesButton.className = 'map-notes-button';
        notesButton.title = 'Notas do mapa';
        notesButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
        </svg>
    `;
        notesButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMapNotes(mapData.name);
        });

        const moreInfo = document.createElement('button');
        moreInfo.className = 'more-info-icon';
        moreInfo.innerHTML = `<img src="./images/icon_more_info.svg" alt="Mais opções" />`;
        moreInfo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.mapManager.toggleDropdown(moreInfo, mapData.name);
        });

        const dragHandle = document.createElement('div');
        dragHandle.className = 'map-drag-handle';
        dragHandle.innerHTML = '☰';
        dragHandle.title = 'Arraste para reordenar';

        listItem.appendChild(dragHandle);
        listItem.appendChild(itemContent);
        listItem.appendChild(notesButton);
        listItem.appendChild(moreInfo);

        return listItem;
    }

    getAnalysisLayersManager() {
        return this.analysisLayersManager;
    }

    // =========================================================================
    // MODAL MANAGEMENT
    // =========================================================================

    /**
     * Shows the combine maps modal.
     * @param {string} targetMapName - Target map to combine into
     */
    async showCombineMapsModal(targetMapName) {
        const allMapNames = await getAllMapNamesStore();
        const availableMaps = allMapNames.filter(name => name !== targetMapName);

        if (availableMaps.length === 0) {
            this.showToast('Não há outros mapas para combinar', 'warning');
            return;
        }

        const modal = new CombineMapsModal({
            targetMapName,
            availableMaps,
            onCombine: async (selectedMaps) => {
                try {
                    const result = await this.mapManager.combineSelectedMapsIntoTarget(selectedMaps, targetMapName);

                    const message = result.totalFeatures > 0
                        ? `${selectedMaps.length} mapa(s) combinado(s): ${result.totalFeatures} feições adicionadas a "${targetMapName}"`
                        : `Mapas combinados mas nenhuma feição foi encontrada`;

                    this.showToast(message, result.totalFeatures > 0 ? 'success' : 'info');
                    await this.updateMapList();
                } catch (error) {
                    console.error('Error combining maps:', error);
                    const errorMsg = error.message || 'Erro desconhecido ao combinar mapas';
                    this.showToast(`Erro: ${errorMsg}`, 'error');
                }
            }
        });

        modal.render();
        modal.show();
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    async clearAllData() {
        const confirmed = await showConfirm('Limpar todos os dados?', {
            message: 'Esta ação é irreversível.',
            destructive: true
        });
        if (confirmed) {
            this.deactivateActiveTools();

            const result = await this.mapManager.clearAllData();
            this.showToast(result.message, result.success ? 'success' : 'error');
            if (result.success) {
                await this.updateMapList();
            }
        }
    }

    showToast(message, type = 'info') {
        toastServiceShow(message, type);
    }

    /**
     * Cleanup resources.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
    }

    onRemove() {
        this.destroy();

        this.mapManager.closeAllDropdowns(false);

        if (this.reopenButton && this.reopenButton.parentNode) {
            this.reopenButton.parentNode.removeChild(this.reopenButton);
            this.reopenButton = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.map = undefined;
    }
}

export default MapControl;
