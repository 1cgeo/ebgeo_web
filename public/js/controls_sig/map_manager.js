// Path: js\controls_sig\map_manager.js
import {
    addMap,
    removeMap,
    renameMap,
    setCurrentMap,
    updateMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    getAllMapNames,
    getCurrentMapName,
    moveFeaturesToMap,
    mapStore,
    resetMemoryStore,
    SCHEMA_VERSION,
    imageStore,
    appStore
} from './store/store.js';

import { IDUtils } from './id_utils.js';

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

            const allMapNames = await getAllMapNames();
            if (allMapNames.length >= 30) {
                return { success: false, message: 'Limite de 30 mapas atingido' };
            }

            await addMap(mapName.trim());
            setCurrentMap(mapName.trim());
            
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
            const allMapNames = await getAllMapNames();
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

            const allMapNames = await getAllMapNames();
            if (allMapNames.length >= 30) {
                return { success: false, message: 'Limite de 30 mapas atingido' };
            }

            const originalMapData = await mapStore.getItem(mapName);
            if (!originalMapData) {
                return { success: false, message: 'Dados do mapa não encontrados' };
            }

            const { newMapData } = await IDUtils.regenerateMapIds(originalMapData, newMapName.trim());
            await addMap(newMapName.trim(), newMapData);
            setCurrentMap(newMapName.trim());
            
            if (this.baseLayerControl) {
                await this.baseLayerControl.switchMap();
            }

            return { success: true, message: `Mapa "${mapName}" copiado como "${newMapName}"` };
        } catch (error) {
            console.error('Erro ao copiar mapa:', error);
            return { success: false, message: 'Erro ao copiar mapa: ' + error.message };
        }
    }

    // ===== POSITION MANAGEMENT =====
    async saveMapPosition(mapName = null) {
        try {
            if (!this.map) return { success: false, message: 'Mapa não disponível' };

            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            
            await updateMapPosition(center.lat, center.lng, zoom);
            
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

        try {
            let totalFeatures = 0;

            for (const mapName of selectedMapNames) {
                const mapData = await mapStore.getItem(mapName);
                if (mapData && mapData.features) {
                    for (const [featureType, features] of Object.entries(mapData.features)) {
                        if (Array.isArray(features)) {
                            for (const feature of features) {
                                const featureCopy = {
                                    ...JSON.parse(JSON.stringify(feature)),
                                    id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
                                };

                                setCurrentMap(targetMapName);
                                const { addFeature } = await import('./store/store.js');
                                await addFeature(featureType, featureCopy);
                                totalFeatures++;
                            }
                        }
                    }
                }
            }

            setCurrentMap(originalCurrentMap);

            if (originalCurrentMap === targetMapName && this.baseLayerControl) {
                await this.baseLayerControl.switchMap(false);
            }

            return { success: true, totalFeatures };
        } catch (error) {
            setCurrentMap(originalCurrentMap);
            throw error;
        }
    }

    // ===== FEATURE MOVEMENT =====
    async moveFeaturesToMap(features, targetMapName) {
        try {
            const currentMapName = await getCurrentMapName();
            
            if (currentMapName === targetMapName) {
                return { success: false, message: 'As feições já estão neste mapa' };
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

    // ===== DATA GENERATION =====
    async generateMapListData() {
        const mapNames = await getAllMapNames();
        const currentMapName = await getCurrentMapName();

        // Ordenar alfabeticamente
        mapNames.sort();

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

    // ===== VALIDATIONS =====
    validateMapName(name) {
        return name && name.trim().length > 0;
    }

    async canDeleteMap(mapName) {
        const allMapNames = await getAllMapNames();
        return allMapNames.length > 1;
    }

    async canCreateNewMap() {
        const allMapNames = await getAllMapNames();
        return allMapNames.length < 30;
    }

    // ===== CLEAR ALL DATA =====
    async clearAllData() {
        try {
            await resetMemoryStore();
            // Limpar também imageStore e appStore
            await imageStore.clear();
            await appStore.clear();
            await mapStore.clear();

            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
            
            // Criar novo mapa padrão
            await addMap('Principal');
            setCurrentMap('Principal');

            await this.baseLayerControl.switchMap();

            return { success: true, message: 'Todos os dados foram limpos' };
        } catch (error) {
            console.error('Erro ao limpar dados:', error);
            return { success: false, message: 'Erro ao limpar dados' };
        }
    }

    // ===== DROPDOWN MANAGEMENT =====
    toggleDropdown(button, mapName) {
        const isCurrentlyActive = button.classList.contains('dropdown-active');
        
        // Sempre fechar todos os dropdowns primeiro
        this.closeAllDropdowns(false);

        // Se estava ativo, não reabrir (toggle)
        if (isCurrentlyActive) {
            return;
        }

        this.deactivateActiveTools();

        // Criar novo dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-content';
        dropdown.style.display = 'block';
        dropdown.dataset.mapName = mapName;
        dropdown.dataset.buttonId = button.dataset.buttonId || Date.now().toString();

        // Anexar ao body
        document.body.appendChild(dropdown);

        // Posicionar e popular
        this.positionDropdown(dropdown, button);
        this.populateDropdown(dropdown, mapName);

        // Marcar como ativo
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

            // Ajustar horizontalmente
            if (left < padding) {
                left = rect.left;
            }
            if (left + dropdownWidth > viewport.width - padding) {
                left = Math.max(padding, viewport.width - dropdownWidth - padding);
            }

            // Ajustar verticalmente
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

        // Botão salvar posição
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

        // Botão limpar posição (se existe)
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

        // Botão copiar
        const copyBtn = document.createElement('button');
        copyBtn.className = 'menu-button';
        copyBtn.innerHTML = '📋 Copiar';
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (await this.canCreateNewMap()) {
                const newMapName = prompt("Nome para o novo mapa:");
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
            } else {
                alert("Limite de 30 mapas atingido.");
            }
        });
        dropdownContent.appendChild(copyBtn);

        // Botão renomear
        const renameBtn = document.createElement('button');
        renameBtn.className = 'menu-button';
        renameBtn.innerHTML = '✏️ Renomear';
        renameBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const newMapName = prompt("Novo nome do mapa:");
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

        // Botão combinar mapas
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

        // Botão mover feições (se não é mapa atual)
        if (mapName !== currentMapName && this.selectionManager) {
            const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
            const selectedCount = selectedFeatures.length;
            
            let buttonText = '↗️ Mover feições (nenhuma selecionada)';
            let buttonDisabled = selectedCount === 0;
            
            if (selectedCount > 0) {
                buttonText = `↗️ Mover ${selectedCount} ${selectedCount > 1 ? 'feições' : 'feição'} selecionada${selectedCount > 1 ? 's' : ''}`;
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
                    alert('Selecione pelo menos uma feição para mover');
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

        // Botão deletar
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

        // Limpar estado dos botões ativos
        if (this.mapControl && this.mapControl.container) {
            const activeButtons = this.mapControl.container.querySelectorAll('.more-info-icon.dropdown-active');
            activeButtons.forEach(button => {
                button.classList.remove('dropdown-active');
                delete button.dataset.dropdownOpen;
            });
        }
    }

    setupDropdownPositionListeners() {
        // Fechar dropdown ao clicar fora
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-content') && !e.target.closest('.more-info-icon')) {
                this.closeAllDropdowns(false);
            }
        });

        // Fechar dropdown ao fazer scroll
        document.addEventListener('scroll', () => {
            this.closeAllDropdowns(false);
        }, true);

        // Fechar dropdown ao redimensionar janela
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