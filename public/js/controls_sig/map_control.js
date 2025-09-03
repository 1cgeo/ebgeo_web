// Path: js\controls_sig\map_control.js
import {
    initializeWithLastActiveMap,
    setCurrentMap,
    getCurrentMapName
} from './store/store.js';

import MapManager from './map_manager.js';
import { ExportImportService } from './export_import_service.js';
import PDFExportTab from './pdf_export_tab.js';
import FeaturesTab from './features_tab.js';
import { showToast as toastServiceShow } from './utilities/toast_service.js';

class MapControl {
    constructor(baseLayerControl, analysisLayersManager) {
        this.baseLayerControl = baseLayerControl;
        this.analysisLayersManager = analysisLayersManager;
        this.selectionManager = null;

        // Componentes
        this.mapManager = new MapManager(baseLayerControl, this.selectionManager);
        this.exportImportService = new ExportImportService(baseLayerControl, this, this.mapManager);

        this.isCollapsed = false;
        this.reopenButton = null;

        // Sistema de abas
        this.currentTab = 'maps';
        this.pdfExportTab = null;
        this.featuresTab = null;
        this.mapsActionsContainer = null;
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
        this.mapManager.selectionManager = selectionManager;

        // Resolver referência circular
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
        
        this.featuresTab = new FeaturesTab(map, this.selectionManager, this.analysisLayersManager);

        this.container = document.createElement('div');
        this.container.id = 'map-list'
        this.container.className = 'list-map-container';

        // Criar header container usando jQuery (mantendo compatibilidade)
        const col = $("<div>", { id: 'header-map-list', class: "header-container-column" });
        const headerContainer = $("<div>", { class: "header-container-row" }).append(col);

        // Adicionar botão de colapso ao header
        const collapseButton = document.createElement('button');
        collapseButton.className = 'collapse-button';
        collapseButton.id = 'collapse-panel-btn';
        collapseButton.title = 'Esconder painel';
        collapseButton.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
    `;

        // Event listener para colapso
        collapseButton.addEventListener('click', () => this.collapsePanel());

        // Inserir botão no header container
        headerContainer[0].appendChild(collapseButton);

        // Container para o menu
        const titleContainer = $("<div>", { id: 'menu-map-list', class: "menu-container" });
        col.append(titleContainer);
        $(this.container).append(headerContainer);

        // Criar área de conteúdo das abas
        this.contentArea = document.createElement('div');
        this.contentArea.className = 'tab-content-area';

        // Criar lista de mapas (aba Maps) 
        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';

        // Criar container PDF Export (aba PDF)
        this.pdfExportContainer = document.createElement('div');
        this.pdfExportContainer.className = 'pdf-export-tab-content';
        this.pdfExportContainer.innerHTML = this.pdfExportTab.createUI();
        this.pdfExportContainer.style.display = 'none';

        this.featuresTabContainer = this.featuresTab.createUI();

        // Adicionar conteúdo ao content area
        this.contentArea.appendChild(this.mapList);
        this.contentArea.appendChild(this.pdfExportContainer);
        this.contentArea.appendChild(this.featuresTabContainer);
        this.container.appendChild(this.contentArea);

        // Atualizar lista de mapas
        this.updateMapList();

        // Criar botão de reabrir (inicialmente escondido)
        this.createReopenButton();

        return this.container;
    }

    async loadMenu() {
        await initializeWithLastActiveMap();

        // Limpar menu existente
        $("#menu-map-list").empty();

        // 1. Criar seletor de abas
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

        // Adicionar tab selector ao header
        $("#header-map-list").append(tabSelector);

        // 2. Adicionar base layer control
        const baseLayerControl = $('.base-layer-control');
        if (baseLayerControl.length > 0) {
            baseLayerControl.appendTo('#header-map-list');
        }

        // 3. Criar container para ações da aba Maps
        this.mapsActionsContainer = document.createElement('div');
        this.mapsActionsContainer.className = 'maps-actions-container';
        this.mapsActionsContainer.id = 'maps-actions-container';

        // Container único para todos os botões em uma fileira
        const allActionsContainer = document.createElement('div');
        allActionsContainer.className = 'all-actions-container';

        // Usar o serviço de export/import para criar os botões
        const saveButton = this.exportImportService.createSaveButton();
        const loadButton = this.exportImportService.createLoadButton();
        const loadAdditiveButton = this.exportImportService.createLoadAdditiveButton();

        // Botão para adicionar mapa
        const addButton = document.createElement('button');
        addButton.className = 'map-action-button add-map-button';
        addButton.innerHTML = `<img src="./images/icon_add.svg" alt="Adicionar mapa" />`;
        addButton.title = 'Adicionar novo mapa';
        addButton.onclick = async () => {
            this.deactivateActiveTools();
            const mapName = prompt("Nome do novo mapa:");
            if (mapName && mapName.trim()) {
                const result = await this.mapManager.createMap(mapName.trim());
                this.showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    await this.updateMapList();
                }
            } else if (mapName !== null) {
                alert("Nome inválido.");
            }
        };

        // Botão para limpar todos os dados
        const clearButton = document.createElement('button');
        clearButton.className = 'map-action-button destructive-action';
        clearButton.innerHTML = `<img src="./images/icon_trash_red.svg" alt="Limpar tudo" />`;
        clearButton.title = 'Limpar todos os dados (irreversível)';
        clearButton.onclick = () => this.clearAllData();

        // Adicionar todos os botões na mesma fileira
        allActionsContainer.appendChild(saveButton);
        allActionsContainer.appendChild(loadButton);
        allActionsContainer.appendChild(loadAdditiveButton);
        allActionsContainer.appendChild(addButton);
        allActionsContainer.appendChild(clearButton);

        // Adicionar ao container de ações
        this.mapsActionsContainer.appendChild(allActionsContainer);

        // 4. Adicionar actions container ao menu
        $("#menu-map-list").append(this.mapsActionsContainer);

        // Configurar visibilidade inicial
        this.updateVisibilityForCurrentTab();

        await this.updateMapList();
    }

    // ===== TAB MANAGEMENT =====
    switchToTab(tabName) {
        this.currentTab = tabName;

        // Atualizar botões visuais
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

    // ===== PANEL MANAGEMENT =====
    collapsePanel() {
        this.container.classList.add('collapsed');
        this.createReopenButton();
        this.reopenButton.classList.add('show');
        this.isCollapsed = true;

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
        this.isCollapsed = false;

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
        const baseLayerControl = $('.base-layer-control');

        if (baseLayerControl.length > 0) {
            if (this.currentTab === 'maps' && !this.isCollapsed) {
                baseLayerControl[0].style.setProperty('display', 'grid', 'important');
                baseLayerControl.removeClass('base-layer-hidden');
            } else {
                baseLayerControl[0].style.setProperty('display', 'none', 'important');
                baseLayerControl.addClass('base-layer-hidden');
            }
        }
    }

    // ===== INTERFACE UPDATES =====
    async updateMapList() {
        const mapListData = await this.mapManager.generateMapListData();

        // Mapear itens existentes no DOM por data-map-name
        const existingItems = new Map();
        this.mapList.querySelectorAll('li').forEach(item => {
            const mapName = item.dataset.mapName;
            if (mapName) {
                existingItems.set(mapName, item);
            }
        });

        // Remover mapas que não existem mais
        for (const [mapName, item] of existingItems) {
            if (!mapListData.find(data => data.name === mapName)) {
                item.remove();
                existingItems.delete(mapName);
            }
        }

        // Limpar lista para reordenar
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

        // Botão "mais opções" - delegar para MapManager
        const moreInfo = document.createElement('button');
        moreInfo.className = 'more-info-icon';
        moreInfo.innerHTML = `<img src="./images/icon_more_info.svg" alt="Mais opções" />`;
        moreInfo.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.mapManager.toggleDropdown(moreInfo, mapData.name);
        });

        listItem.appendChild(itemContent);
        listItem.appendChild(moreInfo);

        return listItem;
    }

    getAnalysisLayersManager() {
        return this.analysisLayersManager;
    }

    // ===== MODAL MANAGEMENT =====
    async showCombineMapsModal(targetMapName) {
        const { getAllMapNamesStore } = await import('./store/store.js');
        const allMapNames = await getAllMapNamesStore();
        const availableMaps = allMapNames.filter(name => name !== targetMapName);

        if (availableMaps.length === 0) {
            alert("Não há outros mapas para combinar.");
            return;
        }

        // Criar modal
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
                <button class="confirm-btn" style="padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; background-color: #508D4E; color: white;" disabled>Combinar</button>
            </div>
        `;

        const mapsSelection = modalContent.querySelector('.maps-selection');
        const confirmBtn = modalContent.querySelector('.confirm-btn');
        const selectedMaps = new Set();

        // Criar checkboxes para mapas disponíveis
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

            // Tornar todo o item clicável
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
                confirmBtn.style.opacity = selectedMaps.size === 0 ? '0.5' : '1';
            });

            mapsSelection.appendChild(mapItem);
        });

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Event listeners
        modalContent.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modalContent.querySelector('.cancel-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modalContent.querySelector('.confirm-btn').addEventListener('click', async () => {
            if (selectedMaps.size > 0) {
                try {
                    await this.mapManager.combineSelectedMapsIntoTarget(Array.from(selectedMaps), targetMapName);
                    document.body.removeChild(modal);
                    this.showToast(`${selectedMaps.size} mapa(s) combinado(s) em "${targetMapName}"`, 'success');
                    await this.updateMapList();
                } catch (error) {
                    console.error('Erro ao combinar mapas:', error);
                    alert('Erro ao combinar mapas.');
                }
            }
        });

        // Fechar ao clicar fora
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    // ===== UTILITY METHODS =====
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

    onRemove() {
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