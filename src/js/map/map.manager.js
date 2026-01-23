// Path: js/map/map.manager.js
import {
    addMap,
    addFeature,
    removeMap,
    renameMap,
    setCurrentMap,
    updateMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    getAllMapNamesStore,
    getCurrentMapName,
    moveFeaturesToMap,
    clearAllDataStore,
    getMapDataStore,
    getColorUsage,
    getMapNotes,
    setMapOrder
} from '../store';

import { IDUtils, showError, showWarning } from '../utilities';
import { groupManager } from '../tool_manager';
import { showPrompt } from '../modals/prompt.modal.js';

class MapManager {
    constructor(baseLayerControl, selectionManager) {
        this.baseLayerControl = baseLayerControl;
        this.selectionManager = selectionManager;
        this.mapControl = null;
        this.map = null;

        this.setupDropdownPositionListeners();
    }

    setMapControl(mapControl) {
        this.mapControl = mapControl;
    }

    setMap(map) {
        this.map = map;
    }

    // ===== CRUD OPERATIONS =====
    async createMap(mapName) {
        try {
            if (!this.validateMapName(mapName)) {
                return { success: false, message: 'Nome inválido' };
            }

            const allMapNames = await getAllMapNamesStore();
            if (allMapNames.length >= 100) {
                return { success: false, message: 'Limite de 100 mapas atingido' };
            }

            await addMap(mapName.trim());
            await setCurrentMap(mapName.trim());

            if (this.baseLayerControl) {
                await this.baseLayerControl.switchMap();
            }

            return { success: true, message: `Mapa "${mapName}" criado` };
        } catch (error) {
            console.error('Erro ao criar mapa:', error);
            return { success: false, message: 'Erro ao criar mapa' };
        }
    }

    async deleteMap(mapName) {
        try {
            const allMapNames = await getAllMapNamesStore();
            const currentMapName = await getCurrentMapName();

            if (allMapNames.length <= 1) {
                return {
                    success: false,
                    message: 'Não é possível deletar o último mapa. O sistema precisa de pelo menos um mapa.'
                };
            }

            const isCurrentMap = mapName === currentMapName;
            const result = await removeMap(mapName);

            if (result.success) {
                if (result.wasCurrentMap && this.baseLayerControl) {
                    await this.baseLayerControl.switchMap();
                }

                const message = result.wasCurrentMap
                    ? `Mapa deletado. Você foi redirecionado para "${result.newCurrentMap}"`
                    : `Mapa "${mapName}" deletado com sucesso`;

                return { success: true, message, wasCurrentMap: result.wasCurrentMap };
            } else {
                return { success: false, message: 'Erro ao deletar mapa' };
            }
        } catch (error) {
            console.error('Erro ao deletar mapa:', error);
            return { success: false, message: 'Erro ao deletar mapa: ' + error.message };
        }
    }

    async renameMap(oldName, newName) {
        try {
            if (!this.validateMapName(newName)) {
                return { success: false, message: 'Nome inválido' };
            }

            await renameMap(oldName, newName.trim());
            setCurrentMap(newName.trim());

            return { success: true, message: `Mapa renomeado para "${newName}"` };
        } catch (error) {
            console.error('Erro ao renomear mapa:', error);
            return { success: false, message: 'Erro ao renomear mapa' };
        }
    }

    async copyMap(mapName, newMapName) {
        try {
            if (!this.validateMapName(newMapName)) {
                return { success: false, message: 'Nome inválido' };
            }

            const allMapNames = await getAllMapNamesStore();
            if (allMapNames.length >= 100) {
                return { success: false, message: 'Limite de 100 mapas atingido' };
            }

            const originalMapData = await getMapDataStore(mapName);
            if (!originalMapData) {
                return { success: false, message: 'Dados do mapa não encontrados' };
            }

            // Get colors and notes from original map
            const originalColorUsage = await getColorUsage(mapName);
            const originalNotes = await getMapNotes(mapName);

            const { newMapData } = await IDUtils.regenerateMapIds(originalMapData, newMapName.trim());

            // Pass colors and notes to optimize and preserve data
            await addMap(newMapName.trim(), newMapData, originalColorUsage, originalNotes);

            // Duplicate groups from original map
            await groupManager.duplicateMapGroups(mapName, newMapName.trim());

            setCurrentMap(newMapName.trim());

            if (this.baseLayerControl) {
                await this.baseLayerControl.switchMap();
            }

            return { success: true, message: `Mapa "${mapName}" duplicado como "${newMapName}"` };
        } catch (error) {
            console.error('Erro ao duplicar mapa:', error);
            return { success: false, message: 'Erro ao duplicar mapa: ' + error.message };
        }
    }

    // ===== POSITION MANAGEMENT =====
    async saveMapPosition(mapName = null) {
        try {
            if (!this.map) return { success: false, message: 'Mapa não disponível' };

            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            const bearing = this.map.getBearing();
            const pitch = this.map.getPitch();

            await updateMapPosition(center.lat, center.lng, zoom, bearing, pitch);

            const hadSavedPosition = await hasMapSavedPosition(mapName || await getCurrentMapName());
            const message = hadSavedPosition
                ? `Posição atualizada para ${mapName || 'mapa atual'}`
                : `Posição salva para ${mapName || 'mapa atual'}`;

            return { success: true, message };
        } catch (error) {
            console.error('Erro ao salvar posição:', error);
            return { success: false, message: 'Erro ao salvar posição' };
        }
    }

    async clearMapPosition(mapName) {
        try {
            await clearMapPosition(mapName);
            return { success: true, message: `Posição salva removida de "${mapName}"` };
        } catch (error) {
            console.error('Erro ao limpar posição:', error);
            return { success: false, message: 'Erro ao limpar posição salva' };
        }
    }

    // ===== MAP COMBINATION =====
    async combineSelectedMapsIntoTarget(selectedMapNames, targetMapName) {
        const originalCurrentMap = await getCurrentMapName();
        const idMappings = {};

        try {
            let totalFeatures = 0;

            for (const mapName of selectedMapNames) {
                const mapData = await getMapDataStore(mapName);
                if (mapData && mapData.features) {
                    // Use regenerateMapIds to regenerate IDs and duplicate resources
                    const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, targetMapName);
                    idMappings[mapName] = idMapping;

                    // Set context ONCE before loop
                    setCurrentMap(targetMapName);

                    // Add main features
                    for (const [featureType, features] of Object.entries(newMapData.features)) {
                        if (Array.isArray(features)) {
                            for (const feature of features) {
                                await addFeature(featureType, feature);
                                totalFeatures++;
                            }
                        }
                    }

                    // Copy processed features (LOS/Visibility)
                    if (newMapData.features.processed_los && newMapData.features.processed_los.length > 0) {
                        for (const processedFeature of newMapData.features.processed_los) {
                            await addFeature('processed_los', processedFeature);
                        }
                    }

                    if (newMapData.features.processed_visibility && newMapData.features.processed_visibility.length > 0) {
                        for (const processedFeature of newMapData.features.processed_visibility) {
                            await addFeature('processed_visibility', processedFeature);
                        }
                    }
                }
            }

            // Pass ID mappings to combineMapGroups
            try {
                await groupManager.combineMapGroups(selectedMapNames, targetMapName, idMappings);
            } catch (groupError) {
                console.warn('Error combining groups:', groupError);
                // Continue even if there's an error with groups
            }

            if (originalCurrentMap === targetMapName && this.baseLayerControl) {
                await this.baseLayerControl.switchMap(false);
            }

            return { success: true, totalFeatures };
        } catch (error) {
            throw error;
        } finally {
            // Always ensure context restoration
            setCurrentMap(originalCurrentMap);
        }
    }

    // ===== FEATURE MOVEMENT =====
    async moveFeaturesToMap(features, targetMapName) {
        try {
            const currentMapName = await getCurrentMapName();

            if (currentMapName === targetMapName) {
                return { success: false, message: 'As feições já estão neste mapa' };
            }

            // Check if any feature is part of a group
            const groupedFeatures = this.getGroupedFeatures(features);

            if (groupedFeatures.length > 0) {
                const groupNames = groupedFeatures.map(gf => gf.groupName).join(', ');
                return {
                    success: false,
                    message: `Não é possível mover feições agrupadas individualmente. Grupos encontrados: ${groupNames}. Desfaça os grupos primeiro ou use a funcionalidade "Puxar outros mapas" para mover grupos completos.`
                };
            }

            await moveFeaturesToMap(features, targetMapName);

            if (this.selectionManager) {
                this.selectionManager.deselectAllFeatures();
            }

            if (this.baseLayerControl) {
                await this.baseLayerControl.switchMap(false);
            }

            const featureCount = features.length;
            const featureText = featureCount === 1 ? 'feição' : 'feições';

            return {
                success: true,
                message: `${featureCount} ${featureText} movida(s) para "${targetMapName}"`
            };
        } catch (error) {
            console.error('Erro ao mover feições:', error);
            return { success: false, message: `Erro ao mover feições: ${error.message}` };
        }
    }

    /**
     * Checks which features are part of groups
     * @param {Array} features - Features to check
     * @returns {Array} Array with information about grouped features
     */
    getGroupedFeatures(features) {
        const groupedFeatures = [];

        features.forEach(feature => {
            const group = groupManager.getFeatureGroup(
                feature.properties.source,
                feature.properties.id
            );

            if (group) {
                groupedFeatures.push({
                    featureId: feature.properties.id,
                    featureType: feature.properties.source,
                    groupId: group.id,
                    groupName: group.name
                });
            }
        });

        return groupedFeatures;
    }

    // ===== DATA GENERATION =====
    async generateMapListData() {
        const mapNames = await getAllMapNamesStore();
        const currentMapName = await getCurrentMapName();


        const mapData = [];
        for (const mapName of mapNames) {
            const hasSavedPosition = await hasMapSavedPosition(mapName);
            mapData.push({
                name: mapName,
                isCurrentMap: mapName === currentMapName,
                hasSavedPosition
            });
        }

        return mapData;
    }

    // ===== MAP ORDER =====
    async updateMapOrder(orderedMapNames) {
        await setMapOrder(orderedMapNames);
    }
    async clearAllData() {
        try {
            await clearAllDataStore();

            if (this.selectionManager) {
                this.selectionManager.deselectAllFeatures();
            }

            setCurrentMap('Principal');

            if (this.baseLayerControl) {
                await this.baseLayerControl.switchMap();
            }

            return { success: true, message: 'Todos os dados foram apagados' };
        } catch (error) {
            console.error('Erro ao limpar dados:', error);
            return { success: false, message: 'Erro ao limpar dados' };
        }
    }

    // ===== VALIDATION =====
    validateMapName(name) {
        if (!name || !name.trim()) {
            return false;
        }
        if (name.trim().length > 50) {
            return false;
        }
        return true;
    }

    async canCreateNewMap() {
        const allMapNames = await getAllMapNamesStore();
        if (allMapNames.length >= 100) {
            alert('Limite de 100 mapas atingido. Delete mapas existentes antes de criar novos.');
            return false;
        }
        return true;
    }

    // ===== DROPDOWN MANAGEMENT =====
    toggleDropdown(button, mapName) {
        const isOpen = button.dataset.dropdownOpen === 'true';

        if (isOpen) {
            this.closeAllDropdowns(true);
            return;
        }

        this.closeAllDropdowns(false);

        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-content';
        dropdown.dataset.buttonId = button.dataset.buttonId || Date.now().toString();

        this.populateDropdown(dropdown, mapName);

        document.body.appendChild(dropdown);
        this.positionDropdown(dropdown, button);

        button.classList.add('dropdown-active');
        button.dataset.dropdownOpen = 'true';

        if (!button.dataset.buttonId) {
            button.dataset.buttonId = Date.now().toString();
        }
    }

    positionDropdown(dropdown, button) {
        requestAnimationFrame(() => {
            const rect = button.getBoundingClientRect();
            const dropdownRect = dropdown.getBoundingClientRect();
            const dropdownWidth = dropdownRect.width || 180;
            const dropdownHeight = dropdownRect.height || 200;

            let top = rect.bottom + 4;
            let left = rect.right - dropdownWidth;

            const viewport = {
                width: window.innerWidth,
                height: window.innerHeight
            };

            const padding = 10;

            // Adjust horizontally
            if (left < padding) {
                left = rect.left;
            }
            if (left + dropdownWidth > viewport.width - padding) {
                left = Math.max(padding, viewport.width - dropdownWidth - padding);
            }

            // Adjust vertically
            if (top + dropdownHeight > viewport.height - padding) {
                const topAbove = rect.top - dropdownHeight - 4;
                if (topAbove >= padding) {
                    top = topAbove;
                } else {
                    top = Math.max(padding, Math.min(
                        viewport.height - dropdownHeight - padding,
                        rect.top - (dropdownHeight / 2)
                    ));
                }
            }

            dropdown.style.position = 'fixed';
            dropdown.style.top = `${Math.round(top)}px`;
            dropdown.style.left = `${Math.round(left)}px`;
            dropdown.style.zIndex = '9999';
            dropdown.style.maxHeight = `${Math.min(320, viewport.height - top - padding)}px`;
            dropdown.style.overflowY = 'auto';
        });
    }

    async populateDropdown(dropdownContent, mapName) {
        dropdownContent.innerHTML = '';
        const currentMapName = await getCurrentMapName();
        const hasSavedPosition = await hasMapSavedPosition(mapName);

        // Save position button
        const savePositionBtn = document.createElement('button');
        savePositionBtn.className = 'menu-button';
        savePositionBtn.innerHTML = hasSavedPosition ? '📍 Atualizar posição salva' : '📍 Salvar posição';
        savePositionBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const result = await this.saveMapPosition(mapName);
            this.closeAllDropdowns();

            if (this.mapControl) {
                this.mapControl.showToast(result.message, result.success ? 'success' : 'error');
                if (result.success) {
                    await this.mapControl.updateMapList();
                }
            }
        });
        dropdownContent.appendChild(savePositionBtn);

        // Clear position button (if exists)
        if (hasSavedPosition) {
            const clearPositionBtn = document.createElement('button');
            clearPositionBtn.className = 'menu-button clear-position';
            clearPositionBtn.innerHTML = '🗑️ Limpar posição salva';
            clearPositionBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (confirm(`Tem certeza que deseja limpar a posição salva do mapa "${mapName}"?`)) {
                    const result = await this.clearMapPosition(mapName);
                    this.closeAllDropdowns();

                    if (this.mapControl) {
                        this.mapControl.showToast(result.message, result.success ? 'success' : 'error');
                        if (result.success) {
                            await this.mapControl.updateMapList();
                        }
                    }
                }
            });
            dropdownContent.appendChild(clearPositionBtn);
        }

        // Duplicate button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'menu-button';
        copyBtn.innerHTML = '📋 Duplicar';
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (await this.canCreateNewMap()) {
                const existingMaps = await getAllMapNamesStore();
                const defaultName = IDUtils.generateUniqueMapName(existingMaps, `${mapName} (cópia)`);
                const newMapName = await showPrompt("Nome para o novo mapa:", defaultName);
                if (newMapName && newMapName.trim()) {
                    const result = await this.copyMap(mapName, newMapName.trim());
                    this.closeAllDropdowns();

                    if (this.mapControl) {
                        this.mapControl.showToast(result.message, result.success ? 'success' : 'error');
                        if (result.success) {
                            await this.mapControl.updateMapList();
                        }
                    }
                }
            }
        });
        dropdownContent.appendChild(copyBtn);

        // Rename button
        const renameBtn = document.createElement('button');
        renameBtn.className = 'menu-button';
        renameBtn.innerHTML = '✏️ Renomear';
        renameBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const newMapName = await showPrompt("Novo nome do mapa:");
            if (newMapName && newMapName.trim()) {
                const result = await this.renameMap(mapName, newMapName.trim());
                this.closeAllDropdowns();

                if (this.mapControl) {
                    this.mapControl.showToast(result.message, result.success ? 'success' : 'error');
                    if (result.success) {
                        await this.mapControl.updateMapList();
                    }
                }
            }
        });
        dropdownContent.appendChild(renameBtn);

        // Combine maps button
        const combineBtn = document.createElement('button');
        combineBtn.className = 'menu-button';
        combineBtn.innerHTML = '🔄 Puxar outros mapas';
        combineBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeAllDropdowns();

            if (this.mapControl) {
                await this.mapControl.showCombineMapsModal(mapName);
            }
        });
        dropdownContent.appendChild(combineBtn);

        // Move features button (if not current map)
        if (mapName !== currentMapName && this.selectionManager) {
            const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
            const selectedCount = selectedFeatures.length;

            let buttonText = '↗️ Mover feições (nenhuma selecionada)';
            let buttonDisabled = selectedCount === 0;

            if (selectedCount > 0) {
                // Check if there are grouped features
                const groupedFeatures = this.getGroupedFeatures(selectedFeatures);

                if (groupedFeatures.length > 0) {
                    buttonText = `↗️ Não é possível mover feições agrupadas`;
                    buttonDisabled = true;
                } else {
                    buttonText = `↗️ Mover ${selectedCount} ${selectedCount > 1 ? 'feições' : 'feição'} selecionada${selectedCount > 1 ? 's' : ''}`;
                }
            }

            const moveBtn = document.createElement('button');
            moveBtn.className = 'menu-button';
            moveBtn.innerHTML = buttonText;
            if (buttonDisabled) {
                moveBtn.style.color = '#999';
                moveBtn.style.cursor = 'not-allowed';
            }

            moveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (buttonDisabled) {
                    if (selectedCount === 0) {
                        showWarning('Selecione pelo menos uma feição para mover primeiro.');
                    } else {
                        showWarning('Não é possível mover feições agrupadas individualmente. Desfaça os grupos primeiro.');
                    }
                    return;
                }

                const result = await this.moveFeaturesToMap(selectedFeatures, mapName);
                this.closeAllDropdowns();

                if (this.mapControl) {
                    this.mapControl.showToast(result.message, result.success ? 'success' : 'error');
                    if (result.success) {
                        await this.mapControl.updateMapList();
                    }
                }
            });
            dropdownContent.appendChild(moveBtn);
        }

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'menu-button menu-button-danger';
        deleteBtn.innerHTML = '🗑️ Deletar mapa';
        deleteBtn.style.borderTop = '1px solid #eee';
        deleteBtn.style.marginTop = '4px';
        deleteBtn.style.paddingTop = '12px';
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isCurrentMap = mapName === currentMapName;
            const warningMessage = isCurrentMap
                ? `Tem certeza que deseja deletar o mapa atual "${mapName}"?\n\nVocê será redirecionado para outro mapa.`
                : `Tem certeza que deseja deletar o mapa "${mapName}"?`;

            if (confirm(warningMessage)) {
                const result = await this.deleteMap(mapName);
                this.closeAllDropdowns();

                if (this.mapControl) {
                    this.mapControl.showToast(result.message, result.success ? 'success' : 'info');
                    if (result.success) {
                        await this.mapControl.updateMapList();
                    }
                }
            }
        });
        dropdownContent.appendChild(deleteBtn);
    }

    closeAllDropdowns(animated = false) {
        const dropdowns = document.querySelectorAll('.dropdown-content');

        if (animated && dropdowns.length > 0) {
            dropdowns.forEach(dropdown => {
                if (dropdown.parentElement === document.body) {
                    dropdown.classList.add('closing');
                    setTimeout(() => {
                        if (dropdown.parentNode) {
                            dropdown.remove();
                        }
                    }, 150);
                }
            });
        } else {
            dropdowns.forEach(dropdown => {
                if (dropdown.parentElement === document.body) {
                    dropdown.remove();
                }
            });
        }

        // Clear active button states
        if (this.mapControl && this.mapControl.container) {
            const activeButtons = this.mapControl.container.querySelectorAll('.more-info-icon.dropdown-active');
            activeButtons.forEach(button => {
                button.classList.remove('dropdown-active');
                delete button.dataset.dropdownOpen;
            });
        }
    }

    setupDropdownPositionListeners() {
        // Close dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-content') && !e.target.closest('.more-info-icon')) {
                this.closeAllDropdowns(false);
            }
        });

        // Close dropdown on scroll
        document.addEventListener('scroll', () => {
            this.closeAllDropdowns(false);
        }, true);

        // Close dropdown on window resize
        window.addEventListener('resize', () => {
            this.closeAllDropdowns(false);
        });
    }

    // Helper method
    deactivateActiveTools() {
        if (this.selectionManager && this.selectionManager.uiManager && this.selectionManager.uiManager.toolManager) {
            this.selectionManager.uiManager.toolManager.deactivateCurrentTool();
        }
    }
}

export default MapManager;
