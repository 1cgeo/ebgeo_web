// Path: js\controls_sig\map_control.js
import {
    addMap,
    removeMap,
    renameMap,
    setCurrentMap,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    getCurrentBaseLayer,
    clearMapPosition,
    getAllMapNames,
    getCurrentMapName,
    moveFeaturesToMap,
    mapStore,
    imageStore,
    appStore,
    resetMemoryStore,
    initializeWithLastActiveMap
} from './store.js';

import { ExportImportService } from './export_import_service.js';

class MapControl {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
        this.selectionManager = null;
        this.exportImportService = new ExportImportService(baseLayerControl);
        this.setupDropdownPositionListeners();

        this.isCollapsed = false;
        this.reopenButton = null;
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    onAdd(map) {
        this.map = map;
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

        // Inserir botão no header container (acessando elemento DOM do jQuery)
        headerContainer[0].appendChild(collapseButton);

        // Container para o menu (onde loadMenu() adiciona os botões)
        const titleContainer = $("<div>", { id: 'menu-map-list', class: "menu-container" });
        col.append(titleContainer);
        $(this.container).append(headerContainer);

        // Criar lista de mapas
        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';
        this.updateMapList();
        this.container.appendChild(this.mapList);

        // Criar botão de reabrir (inicialmente escondido)
        this.createReopenButton();

        return this.container;
    }

    async loadMenu() {
        await initializeWithLastActiveMap();

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
            const allMapNames = await getAllMapNames();
            if (allMapNames.length < 10) {
                const mapName = prompt("Nome do novo mapa:");
                if (mapName && mapName.trim()) {
                    await addMap(mapName.trim());
                    setCurrentMap(mapName.trim());
                    await this.switchMap();
                    await this.updateMapList();
                }
            } else {
                alert("Limite de 10 mapas atingido.");
            }
        };

        // Botão para limpar todos os dados (ação destrutiva - separada)
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

        $('#menu-map-list').append(allActionsContainer);

        const baseLayerControl = $('.base-layer-control');
        if (baseLayerControl.length > 0) {
            baseLayerControl.appendTo('#header-map-list');
        }

        await this.switchMap()
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 18px;
            border-radius: 6px;
            color: white;
            font-size: 13px;
            font-weight: 500;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            background-color: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
        `;

        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    onRemove() {
        this.closeAllDropdowns(false);

        // Remover listeners globais se necessário
        // (Os listeners são automaticamente removidos quando o elemento é removido)
        if (this.reopenButton && this.reopenButton.parentNode) {
            this.reopenButton.parentNode.removeChild(this.reopenButton);
            this.reopenButton = null;
        }

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.map = undefined;
    }

    async updateMapList() {
        this.mapList.innerHTML = '';

        const mapNames = await getAllMapNames();
        const currentMapName = await getCurrentMapName();

        for (const mapName of mapNames) {
            const listItem = document.createElement('li');
            listItem.className = mapName === currentMapName ? 'current-map' : '';

            const itemContent = document.createElement('div');
            itemContent.className = 'map-item-main clickable-area';

            const mapNameDisplay = document.createElement('div');
            mapNameDisplay.className = 'map-name-display';

            const hasSavedPosition = await hasMapSavedPosition(mapName);
            const positionIndicator = hasSavedPosition ? ' 📍' : '';
            mapNameDisplay.textContent = mapName + positionIndicator;

            itemContent.appendChild(mapNameDisplay);

            // Adicionar click em toda a área
            itemContent.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (mapName !== currentMapName) {
                    await setCurrentMap(mapName);
                    await this.switchMap();
                    await this.updateMapList();
                }
            });

            // Botão "mais opções" (separado da área clicável)
            const moreInfo = document.createElement('button');
            moreInfo.className = 'more-info-icon';
            moreInfo.innerHTML = `<img src="./images/icon_more_info.svg" alt="Mais opções" />`;
            moreInfo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleDropdown(moreInfo, mapName);
            });

            listItem.appendChild(itemContent);
            listItem.appendChild(moreInfo);
            this.mapList.appendChild(listItem);
        }
    }

    toggleDropdown(button, mapName) {
        // Verificar se este botão já tem dropdown ativo
        const isCurrentlyActive = button.classList.contains('dropdown-active');

        // Sempre fechar todos os dropdowns primeiro
        this.closeAllDropdowns(false); // Com animação para UX melhor

        // Se o botão estava ativo, não reabrir (comportamento toggle)
        if (isCurrentlyActive) {
            return;
        }

        // Criar novo dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown-content';
        dropdown.style.display = 'block';
        dropdown.dataset.mapName = mapName; // Para identificar qual dropdown é
        dropdown.dataset.buttonId = button.dataset.buttonId || Date.now().toString(); // ID único para o botão

        // Anexar ao body para evitar problemas de overflow
        document.body.appendChild(dropdown);

        // Posicionar dropdown
        this.positionDropdown(dropdown, button);

        // Popular dropdown com opções
        this.populateDropdown(dropdown, mapName);

        // Marcar como ativo
        button.classList.add('dropdown-active');
        button.dataset.dropdownOpen = 'true';

        // Adicionar ID único ao botão se não tiver
        if (!button.dataset.buttonId) {
            button.dataset.buttonId = Date.now().toString();
        }
    }

    async populateDropdown(dropdownContent, mapName) {
        dropdownContent.innerHTML = '';
        const currentMapName = await getCurrentMapName();

        // Verificar se tem posição salva
        const hasSavedPosition = await hasMapSavedPosition(mapName);

        // Botão salvar posição
        const savePositionBtn = document.createElement('button');
        savePositionBtn.className = 'menu-button';

        if (hasSavedPosition) {
            savePositionBtn.innerHTML = '📍 Atualizar posição salva';
        } else {
            savePositionBtn.innerHTML = '📍 Salvar posição';
        }

        savePositionBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();

            const center_lat = center.lat;
            const center_long = center.lng;
            await updateMapPosition(center_lat, center_long, zoom);
            this.closeAllDropdowns();

            const message = hasSavedPosition ?
                `Posição atualizada para ${mapName}` :
                `Posição salva para ${mapName}`;
            this.showToast(message, 'success');

            // Atualizar lista para mostrar novo indicador
            await this.updateMapList();
        });
        dropdownContent.appendChild(savePositionBtn);

        if (hasSavedPosition) {
            const clearPositionBtn = document.createElement('button');
            clearPositionBtn.className = 'menu-button clear-position';
            clearPositionBtn.innerHTML = '🗑️ Limpar posição salva';
            clearPositionBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (confirm(`Tem certeza que deseja limpar a posição salva do mapa "${mapName}"?`)) {
                    await clearMapPosition(mapName);
                    this.closeAllDropdowns();
                    this.showToast(`Posição salva removida de "${mapName}"`, 'success');

                    // Atualizar lista para remover o indicador 📍
                    await this.updateMapList();
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
            const allMapNames = await getAllMapNames();
            if (allMapNames.length < 10) {
                const newMapName = prompt("Nome para o novo mapa:");
                if (newMapName && newMapName.trim()) {
                    const copiedMapData = await mapStore.getItem(mapName);
                    await addMap(newMapName.trim(), copiedMapData);
                    setCurrentMap(newMapName.trim());
                    await this.switchMap();
                    await this.updateMapList();
                    this.closeAllDropdowns();
                }
            } else {
                alert("Limite de 10 mapas atingido.");
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
                const oldMapName = mapName;
                await renameMap(oldMapName, newMapName.trim());
                setCurrentMap(newMapName.trim());
                await this.switchMap();
                await this.updateMapList();
                this.closeAllDropdowns();
            }
        });
        dropdownContent.appendChild(renameBtn);

        // Botão PUXAR OUTROS MAPAS
        const combineBtn = document.createElement('button');
        combineBtn.className = 'menu-button';
        combineBtn.innerHTML = '🔄 Puxar outros mapas';
        combineBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeAllDropdowns();

            await this.showCombineMapsModal(mapName);
        });
        dropdownContent.appendChild(combineBtn);

        if (mapName !== currentMapName) {
            // Botão mover feições - sempre mostrar, mas verificar seleção no clique
            let selectedCount = 0;
            let buttonText = '↗️ Mover feições selecionadas';
            let buttonDisabled = false;

            // Verificar se há feições selecionadas
            selectedCount = this.selectionManager.getAllSelectedFeatures().length;
            if (selectedCount === 0) {
                buttonText = '↗️ Mover feições (nenhuma selecionada)';
                buttonDisabled = true;
            } else {
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

                if (this.selectionManager) {
                    const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
                    if (selectedFeatures.length > 0) {
                        try {
                            const currentMapName = await getCurrentMapName();

                            // Se tentar mover para o mesmo mapa
                            if (currentMapName === mapName) {
                                alert('As feições já estão neste mapa');
                                return;
                            }

                            await moveFeaturesToMap(selectedFeatures, mapName);

                            // Limpar seleção
                            this.selectionManager.deselectAllFeatures();

                            // Recarregar mapa atual para refletir as remoções
                            await this.switchMap();

                            // Atualizar lista de mapas
                            await this.updateMapList();

                            // Feedback de sucesso
                            const featureCount = selectedFeatures.length;
                            const featureText = featureCount === 1 ? 'feição' : 'feições';
                            this.showToast(`${featureCount} ${featureText} movida(s) para "${mapName}"`, 'success');

                        } catch (error) {
                            console.error('Erro ao mover feições:', error);
                            alert(`Erro ao mover feições: ${error.message}`);
                        }
                    }
                }

                this.closeAllDropdowns();
            });
            dropdownContent.appendChild(moveBtn);
        }

        // Botão deletar (último e destacado)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'menu-button menu-button-danger';
        deleteBtn.innerHTML = '🗑️ Deletar mapa';
        deleteBtn.style.borderTop = '1px solid #eee';
        deleteBtn.style.marginTop = '4px';
        deleteBtn.style.paddingTop = '12px';
        deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (confirm(`Tem certeza que deseja deletar o mapa "${mapName}"?`)) {
                await removeMap(mapName);
                const remainingMaps = await getAllMapNames();
                if (remainingMaps.length > 0) {
                    setCurrentMap(remainingMaps[0]);
                    await this.switchMap();
                }
                await this.updateMapList();
                this.closeAllDropdowns();
            }
        });
        dropdownContent.appendChild(deleteBtn);
    }

    positionDropdown(dropdown, button) {
        // Aguardar o dropdown ser renderizado para calcular tamanho real
        requestAnimationFrame(() => {
            const rect = button.getBoundingClientRect();
            const dropdownRect = dropdown.getBoundingClientRect();
            const dropdownWidth = dropdownRect.width || 180;
            const dropdownHeight = dropdownRect.height || 200;

            // Posição inicial (abaixo e à direita do botão)
            let top = rect.bottom + 4;
            let left = rect.right - dropdownWidth;

            // Verificar espaço disponível
            const viewport = {
                width: window.innerWidth,
                height: window.innerHeight
            };

            const padding = 10; // Margem da borda da tela

            // Ajustar horizontalmente
            if (left < padding) {
                left = rect.left; // Alinhar com a esquerda do botão
            }
            if (left + dropdownWidth > viewport.width - padding) {
                left = Math.max(padding, viewport.width - dropdownWidth - padding);
            }

            // Ajustar verticalmente
            if (top + dropdownHeight > viewport.height - padding) {
                // Tentar mostrar acima do botão
                const topAbove = rect.top - dropdownHeight - 4;
                if (topAbove >= padding) {
                    top = topAbove;
                } else {
                    // Se não couber acima nem abaixo, centralizar verticalmente visível
                    top = Math.max(padding, Math.min(
                        viewport.height - dropdownHeight - padding,
                        rect.top - (dropdownHeight / 2)
                    ));
                }
            }

            // Aplicar posicionamento final
            dropdown.style.position = 'fixed';
            dropdown.style.top = `${Math.round(top)}px`;
            dropdown.style.left = `${Math.round(left)}px`;
            dropdown.style.zIndex = '9999';
            dropdown.style.maxHeight = `${Math.min(320, viewport.height - top - padding)}px`;
            dropdown.style.overflowY = 'auto';
        });
    }

    closeAllDropdowns(animated = false) {
        // Buscar dropdowns no body (não apenas no container)
        const dropdowns = document.querySelectorAll('.dropdown-content');

        if (animated && dropdowns.length > 0) {
            // Fechar com animação
            dropdowns.forEach(dropdown => {
                if (dropdown.parentElement === document.body) {
                    dropdown.classList.add('closing');
                    setTimeout(() => {
                        if (dropdown.parentNode) {
                            dropdown.remove();
                        }
                    }, 150); // Duração da animação slideUp
                }
            });
        } else {
            // Fechar imediatamente
            dropdowns.forEach(dropdown => {
                if (dropdown.parentElement === document.body) {
                    dropdown.remove();
                }
            });
        }

        // Limpar estado dos botões ativos
        const activeButtons = this.container.querySelectorAll('.more-info-icon.dropdown-active');
        activeButtons.forEach(button => {
            button.classList.remove('dropdown-active');
            delete button.dataset.dropdownOpen;
        });

        // Também buscar dropdowns no container (fallback)
        const containerDropdowns = this.container.querySelectorAll('.dropdown-content');
        containerDropdowns.forEach(dropdown => {
            if (dropdown.parentElement) {
                dropdown.parentElement.classList.remove('dropdown-active');
                dropdown.remove();
            }
        });
    }

    // Método para verificar se um dropdown específico está aberto
    isDropdownOpen(button) {
        return button && button.classList.contains('dropdown-active');
    }

    // Método para fechar dropdown específico de um botão
    closeDropdownForButton(button) {
        if (!button || !this.isDropdownOpen(button)) return;

        // Buscar dropdown relacionado a este botão
        const buttonId = button.dataset.buttonId;
        if (buttonId) {
            const dropdown = document.querySelector(`.dropdown-content[data-button-id="${buttonId}"]`);
            if (dropdown) {
                dropdown.remove();
            }
        }

        // Limpar estado do botão
        button.classList.remove('dropdown-active');
        delete button.dataset.dropdownOpen;
    }

    setupDropdownPositionListeners() {
        // Fechar dropdown ao clicar fora
        document.addEventListener('click', (e) => {
            // Não fechar se clicou no botão de menu (o toggle é tratado no toggleDropdown)
            // Não fechar se clicou dentro do dropdown
            if (!e.target.closest('.dropdown-content')) {
                // Se clicou em um botão more-info-icon, deixar o toggleDropdown tratar
                if (!e.target.closest('.more-info-icon')) {
                    this.closeAllDropdowns(false); // Sem animação para clique fora
                }
            }
        });

        // Fechar dropdown ao fazer scroll
        document.addEventListener('scroll', () => {
            this.closeAllDropdowns(false); // Sem animação para scroll
        }, true); // true para capturar scroll em qualquer elemento

        // Fechar dropdown ao redimensionar janela
        window.addEventListener('resize', () => {
            this.closeAllDropdowns(false); // Sem animação para resize
        });
    }

    getSelectedMapNames() {
        const checkboxes = this.container.querySelectorAll('.map-checkbox:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    async switchMap() {
        const currentMapName = await getCurrentMapName();

        if (this.baseLayerControl && this.baseLayerControl.switchLayer) {
            const baseLayer = await getCurrentBaseLayer()
            this.baseLayerControl.switchLayer(baseLayer);
        }

        await this.applyMapSavedPosition(currentMapName);
    }

    async applyMapSavedPosition(mapName = null) {
        try {
            const targetMapName = mapName || await getCurrentMapName();

            // Verificar se há posição salva para este mapa
            const hasSavedPosition = await hasMapSavedPosition(targetMapName);

            if (hasSavedPosition) {
                const position = await getMapPosition(targetMapName);

                // Aplicar a posição com jumpTo
                this.map.jumpTo({
                    center: [position.center_long, position.center_lat],
                    zoom: position.zoom
                });

                return true;
            } else {
                return false;
            }
        } catch (error) {
            console.error('Erro ao aplicar posição salva:', error);
            return false;
        }
    }

    async clearAllData() {
        if (confirm('Tem certeza que deseja limpar todos os dados? Esta ação é irreversível.')) {
            try {
                await mapStore.clear();
                await imageStore.clear();
                await appStore.clear();
                await resetMemoryStore();

                // Criar novo mapa padrão
                await addMap('Principal');
                setCurrentMap('Principal');
                await this.switchMap();
                await this.updateMapList();

                this.showToast('Todos os dados foram limpos', 'success');
            } catch (error) {
                console.error('Erro ao limpar dados:', error);
                alert('Erro ao limpar dados');
            }
        }
    }

    async showCombineMapsModal(targetMapName) {
        const allMapNames = await getAllMapNames();
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
                    await this.combineSelectedMapsIntoTarget(Array.from(selectedMaps), targetMapName);
                    document.body.removeChild(modal);
                    this.showToast(`${selectedMaps.size} mapa(s) combinado(s) em "${targetMapName}"`, 'success');
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

                                const { addFeature } = await import('./store.js');
                                await addFeature(featureType, featureCopy);
                                totalFeatures++;
                            }
                        }
                    }
                }
            }

            setCurrentMap(originalCurrentMap);

            // Recarregar o mapa se estivermos visualizando o mapa de destino
            if (originalCurrentMap === targetMapName) {
                await this.switchMap();
            }

            await this.updateMapList();

        } catch (error) {
            setCurrentMap(originalCurrentMap);
            throw error;
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

    // Método para colapsar o painel
    collapsePanel() {
        this.container.classList.add('collapsed');
        this.createReopenButton();
        this.reopenButton.classList.add('show');
        this.isCollapsed = true;
    }

    expandPanel() {
        this.container.classList.remove('collapsed');
        if (this.reopenButton) {
            this.reopenButton.classList.remove('show');
        }
        this.isCollapsed = false;
    }

    // Método para alternar colapso
    togglePanel() {
        if (this.isCollapsed) {
            this.expandPanel();
        } else {
            this.collapsePanel();
        }
    }
}

export default MapControl;