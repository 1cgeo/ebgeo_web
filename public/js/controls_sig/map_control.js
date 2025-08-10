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
    getAllMapNames,
    getCurrentMapName,
    mapStore,
    imageStore,
    resetMemoryStore,
    initializeWithLastActiveMap
} from './store.js';

class MapControl {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
        this.selectionManager = null;
        this.setupDropdownPositionListeners();
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.id = 'map-list'
        this.container.className = 'list-map-container';

        const col = $("<div>", { id: 'header-map-list', class: "header-container-column" })
        const headerContainer = $("<div>", { class: "header-container-row" }).append(col)
        const titleContainer = $("<div>", { id: 'menu-map-list', class: "menu-container" });
        col.append(titleContainer)
        $(this.container).append(headerContainer);

        this.mapList = document.createElement('ul');
        this.mapList.className = 'map-list';
        this.updateMapList();
        this.container.appendChild(this.mapList);

        return this.container;
    }

    async loadMenu() {
        await initializeWithLastActiveMap();

        // Container único para todos os botões em uma fileira
        const allActionsContainer = document.createElement('div');
        allActionsContainer.className = 'all-actions-container';

        // Criar botões save/load diretamente aqui (não mover de outro lugar)
        const saveButton = this.createSaveButton();
        const loadButton = this.createLoadButton();
        const loadAdditiveButton = this.createLoadAdditiveButton();

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

    createSaveButton() {
        const saveButton = document.createElement('button');
        saveButton.className = 'map-action-button save-action';
        saveButton.innerHTML = `<img src="./images/icon_save_black.svg" alt="Exportar projeto" />`;
        saveButton.title = 'Exportar projeto';

        saveButton.onclick = async () => {
            try {
                const zip = new JSZip();

                // Verificar se há mapas selecionados
                const selectedMaps = this.getSelectedMapNames();
                const mapsToExport = selectedMaps.length > 0 ? selectedMaps : await getAllMapNames();

                if (mapsToExport.length === 0) {
                    alert('Nenhum mapa para exportar');
                    return;
                }

                const data = {
                    version: '1.0',
                    currentMap: await getCurrentMapName(),
                    maps: {}
                };

                // Exportar dados dos mapas selecionados
                for (const mapName of mapsToExport) {
                    const mapData = await mapStore.getItem(mapName);
                    if (mapData) {
                        data.maps[mapName] = mapData;
                    }
                }

                // Adicionar data.json ao ZIP
                zip.file('data.json', JSON.stringify(data, null, 2));

                // Coletar e exportar imagens usadas nos mapas
                const usedImages = new Set();
                for (const mapName of mapsToExport) {
                    const mapData = await mapStore.getItem(mapName);
                    if (mapData && mapData.features) {
                        for (const [category, features] of Object.entries(mapData.features)) {
                            if (Array.isArray(features)) {
                                features.forEach(feature => {
                                    if (feature.properties && feature.properties.imageId) {
                                        usedImages.add(feature.properties.imageId);
                                    }
                                });
                            }
                        }
                    }
                }

                // Adicionar imagens ao ZIP
                for (const imageId of usedImages) {
                    try {
                        const blob = await imageStore.getItem(imageId);
                        if (blob) {
                            zip.file(`images/${imageId}.png`, blob);
                        }
                    } catch (error) {
                        console.warn('Imagem não encontrada:', imageId);
                    }
                }

                // Gerar e baixar arquivo
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `projeto_${new Date().toISOString().slice(0, 10)}.ebgeo`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.showSaveSuccess(mapsToExport.length);

            } catch (error) {
                console.error('Erro ao exportar dados:', error);
                alert('Erro ao exportar arquivo .ebgeo');
            }
        };

        return saveButton;
    }

    createLoadButton() {
        const loadButton = document.createElement('button');
        loadButton.className = 'map-action-button load-action';
        loadButton.innerHTML = `<img src="./images/icon_load_black.svg" alt="Importar projeto" />`;
        loadButton.title = 'Importar projeto (substitui atual)';

        // Criar input file associado
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, false);
        };

        loadButton.onclick = () => {
            fileInput.click();
        };

        // Anexar input ao container
        loadButton.appendChild(fileInput);

        return loadButton;
    }

    createLoadAdditiveButton() {
        const loadAdditiveButton = document.createElement('button');
        loadAdditiveButton.className = 'map-action-button load-action';
        loadAdditiveButton.innerHTML = `<img src="./images/icon_folder_plus_black.svg" alt="Adicionar ao projeto" />`;
        loadAdditiveButton.title = 'Adicionar ao projeto atual';

        // Criar input file associado
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, true);
        };

        loadAdditiveButton.onclick = () => {
            fileInput.click();
        };

        // Anexar input ao container
        loadAdditiveButton.appendChild(fileInput);

        return loadAdditiveButton;
    }

    async handleImport(event, isAdditiveImport) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const zip = await JSZip.loadAsync(file);

            if (!isAdditiveImport) {
                // Import normal - limpar tudo
                await mapStore.clear();
                await imageStore.clear();
            }

            // Buscar arquivo data.json
            let dataFile = zip.file('data.json');

            if (!dataFile) {
                throw new Error('Arquivo data.json não encontrado no .ebgeo');
            }

            const dataJson = await dataFile.async('string');
            const data = JSON.parse(dataJson);

            // Processar mapas
            let importedMapsCount = 0;
            if (isAdditiveImport) {
                const existingMapNames = await getAllMapNames();

                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    let finalMapName = originalMapName;
                    let counter = 1;

                    // Gerar nome único se houver conflito
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_importado${counter > 1 ? counter : ''}`;
                        counter++;
                    }

                    await mapStore.setItem(finalMapName, mapData);
                    await addMap(finalMapName, mapData);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }
            } else {
                // Salvar cada mapa no IndexedDB (comportamento original)
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    await mapStore.setItem(mapName, mapData);
                    await addMap(mapName, mapData);
                    importedMapsCount++;
                }

                // Atualizar mapa atual
                setCurrentMap(data.currentMap);
            }

            // Carregar imagens para imageStore
            const imageFiles = Object.keys(zip.files).filter(name =>
                name.startsWith('images/') && name.endsWith('.png')
            );

            for (const fileName of imageFiles) {
                try {
                    const imageId = fileName.replace('images/', '').replace('.png', '');
                    const blob = await zip.file(fileName).async('blob');
                    await imageStore.setItem(imageId, blob);
                } catch (imgError) {
                    console.warn('Erro ao carregar imagem:', fileName, imgError);
                }
            }

            // Recarregar MapLibre (trigger styledata)
            let baseLayer = 'Carta';
            if (!isAdditiveImport) {
                const currentMapData = await mapStore.getItem(data.currentMap);
                baseLayer = currentMapData ? currentMapData.baseLayer : 'Carta';
            }

            this.baseLayerControl.switchLayer(baseLayer);
            this.updateMapList();

            // Feedback personalizado baseado no tipo de importação
            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        // Limpar input
        event.target.value = '';
    }

    showSaveSuccess(mapCount) {
        const saveBtn = this.container?.querySelector('.save-action');
        if (saveBtn) {
            const originalContent = saveBtn.innerHTML;

            saveBtn.classList.add('success');
            saveBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                saveBtn.classList.remove('success');
                saveBtn.innerHTML = originalContent;
            }, 1500);
        }

        this.showToast(
            mapCount === 1 ?
                `1 mapa exportado!` :
                `${mapCount} mapas exportados!`,
            'success'
        );
    }

    showLoadSuccess(mapCount, importType) {
        const loadBtn = this.container?.querySelector('.load-action');
        if (loadBtn) {
            const originalContent = loadBtn.innerHTML;

            loadBtn.classList.add('success');
            loadBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                loadBtn.classList.remove('success');
                loadBtn.innerHTML = originalContent;
            }, 1500);
        }

        this.showToast(
            mapCount === 1 ?
                `1 mapa ${importType}!` :
                `${mapCount} mapas ${importType}!`,
            'success'
        );
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
            console.log(mapName, hasSavedPosition)
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

        // Botão mover feições - sempre mostrar, mas verificar seleção no clique
        let selectedCount = 0;
        let buttonText = '↗️ Mover feições selecionadas';
        let buttonDisabled = false;

        // Verificar se há feições selecionadas
        if (this.selectionManager) {
            selectedCount = this.selectionManager.getAllSelectedFeatures().length;
            if (selectedCount === 0) {
                buttonText = '↗️ Mover feições (nenhuma selecionada)';
                buttonDisabled = true;
            } else {
                buttonText = `↗️ Mover ${selectedCount} feição${selectedCount > 1 ? 'ões' : ''} selecionada${selectedCount > 1 ? 's' : ''}`;
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
                alert('Selecione pelo menos uma feição para mover');
                return;
            }

            if (this.selectionManager) {
                const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
                if (selectedFeatures.length > 0) {
                    await this.showMoveToMapModal(selectedFeatures, mapName);
                }
            }

            this.closeAllDropdowns();
        });
        dropdownContent.appendChild(moveBtn);

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
            dropdown.style.maxHeight = `${Math.min(300, viewport.height - top - padding)}px`;
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
                console.log(`📍 Nenhuma posição salva para ${targetMapName}`);
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
            mapItem.style.cssText = 'display: flex; align-items: center; padding: 8px; border: 1px solid #eee; margin-bottom: 5px; border-radius: 4px; cursor: pointer;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `map-${mapName}`;
            checkbox.style.marginRight = '10px';

            const label = document.createElement('label');
            label.htmlFor = `map-${mapName}`;
            label.textContent = mapName;
            label.style.cursor = 'pointer';
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
}

export default MapControl;