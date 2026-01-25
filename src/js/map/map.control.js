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
import { MapNotesManager } from './map-notes.panel.js';
import { showPrompt } from '../modals/prompt.modal.js';

class MapControl {
    constructor(baseLayerControl, analysisLayersManager) {
        this.baseLayerControl = baseLayerControl;
        this.analysisLayersManager = analysisLayersManager;
        this.selectionManager = null;

        this.mapManager = new MapManager(baseLayerControl, this.selectionManager);
        this.exportImportService = new ExportImportService(baseLayerControl, this, this.mapManager);

        this.reopenButton = null;
        this.pdfExportTab = null;
        this.featuresTab = null;
        this.mapsActionsContainer = null;
        this.mapNotesManager = null;

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

        this.mapNotesManager = new MapNotesManager(this, this.mapManager);
        this.mapNotesManager.createPanels();

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

    async showCombineMapsModal(targetMapName) {
        const allMapNames = await getAllMapNamesStore();
        const availableMaps = allMapNames.filter(name => name !== targetMapName);

        if (availableMaps.length === 0) {
            alert("Não há outros mapas para combinar.");
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'combine-maps-modal';
        modal.style.cssText = `
            display: block;
            position: fixed;
            z-index: 1001;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0, 0, 0, 0.4);
        `;

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.cssText = `
            background-color: white;
            margin: 10% auto;
            padding: 20px;
            border: 1px solid #888;
            border-radius: 8px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        `;

        modalContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; font-size: 1.1em;">Puxar outros mapas para "${targetMapName}"</h3>
                <span class="modal-close" style="color: #aaa; font-size: 28px; font-weight: bold; cursor: pointer;">&times;</span>
            </div>
            <p style="margin-bottom: 15px; font-size: 0.9em; color: #666;">Selecione os mapas que deseja combinar com "${targetMapName}":</p>
            <div class="maps-selection" style="max-height: 200px; overflow-y: auto; margin-bottom: 20px;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px;">
                <button class="cancel-btn" style="padding: 8px 16px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: white;">Cancelar</button>
                <button class="confirm-btn" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: not-allowed; background-color: #508D4E; color: white; opacity: 0.5;" disabled>Combinar</button>
            </div>
        `;

        const mapsSelection = modalContent.querySelector('.maps-selection');
        const confirmBtn = modalContent.querySelector('.confirm-btn');
        const selectedMaps = new Set();

        availableMaps.forEach(mapName => {
            const mapItem = document.createElement('div');
            mapItem.style.cssText = 'display: flex; align-items: center; padding: 8px; border: 1px solid #eee; margin-bottom: 5px; border-radius: 4px;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `map-${mapName}`;
            checkbox.style.cursor = 'pointer';
            checkbox.style.marginRight = '10px';

            const label = document.createElement('label');
            label.htmlFor = `map-${mapName}`;
            label.textContent = mapName;
            label.style.flexGrow = '1';

            mapItem.appendChild(checkbox);
            mapItem.appendChild(label);

            mapItem.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }

                if (checkbox.checked) {
                    selectedMaps.add(mapName);
                    mapItem.style.backgroundColor = '#f0f8f0';
                } else {
                    selectedMaps.delete(mapName);
                    mapItem.style.backgroundColor = '';
                }

                confirmBtn.disabled = selectedMaps.size === 0;
                confirmBtn.style.cursor = selectedMaps.size === 0 ? 'not-allowed' : 'pointer';
                confirmBtn.style.opacity = selectedMaps.size === 0 ? '0.5' : '1';
            });

            mapsSelection.appendChild(mapItem);
        });

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        modalContent.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modalContent.querySelector('.cancel-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modalContent.querySelector('.confirm-btn').addEventListener('click', async () => {
            if (selectedMaps.size > 0) {
                try {
                    const result = await this.mapManager.combineSelectedMapsIntoTarget(Array.from(selectedMaps), targetMapName);
                    document.body.removeChild(modal);

                    const message = result.totalFeatures > 0
                        ? `${selectedMaps.size} mapa(s) combinado(s): ${result.totalFeatures} feições adicionadas a "${targetMapName}"`
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

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    async clearAllData() {
        if (confirm('Tem certeza que deseja limpar todos os dados? Esta ação é irreversível.')) {
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

    async showMapNotes(mapName) {
        this.deactivateActiveTools();
        await this.mapNotesManager.showViewPanel(mapName);
    }

    async saveCurrentMapNotes() {
        if (this.mapNotesManager) {
            await this.mapNotesManager.saveCurrentMapNotes();
        }
    }

    isNotesPanel() {
        return this.mapNotesManager && this.mapNotesManager.isVisible;
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

        if (this.mapNotesManager) {
            this.mapNotesManager.destroy();
            this.mapNotesManager = null;
        }

        this.map = undefined;
    }
}

export default MapControl;
