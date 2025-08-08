// Path: js\controls_sig\map_control.js
import { 
    addMap, 
    removeMap, 
    renameMap, 
    setCurrentMap, 
    updateMapPosition, 
    getCurrentBaseLayer, 
    getMapPosition,
    getAllMapNames,
    getCurrentMapName,
    mapStore,
    imageStore,
    resetMemoryStore,
    moveFeaturesToMap
} from './store.js';

class MapControl {
    constructor(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
        this.selectionManager = null;
        this.setupDropdownPositionListeners();
        console.log('MapControl inicializado'); // Debug
    }

    setSelectionManager(selectionManager) {
        this.selectionManager = selectionManager;
        console.log('SelectionManager definido no MapControl:', !!selectionManager); // Debug
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

    loadMenu() {
        // Reorganizar menu com melhor hierarquia
        const primaryActions = document.createElement('div');
        primaryActions.className = 'primary-actions-container';
        
        $('#save-btn').appendTo(primaryActions);
        $('#load-btn').appendTo(primaryActions);
        $('#load-additive-btn').appendTo(primaryActions);
        
        // Container para ações secundárias (reorganizadas)
        const secondaryActions = document.createElement('div');
        secondaryActions.className = 'secondary-actions-container';
        
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
        
        // Organizar ações em grupos
        secondaryActions.appendChild(addButton);
        
        // Separar ação destrutiva
        const destructiveContainer = document.createElement('div');
        destructiveContainer.className = 'destructive-actions-container';
        destructiveContainer.appendChild(clearButton);
        
        $('#menu-map-list').append(primaryActions);
        $('#menu-map-list').append(secondaryActions);
        $('#menu-map-list').append(destructiveContainer);
        
        $('.base-layer-control').appendTo('#header-map-list');
    }

    onRemove() {
        this.closeAllDropdowns();
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    async updateMapList() {
        this.mapList.innerHTML = '';

        const allMapNames = await getAllMapNames();
        const currentMapName = getCurrentMapName();
        const sortedMapNames = allMapNames.sort();

        for (let i = 0; i < sortedMapNames.length; i++) {
            const mapName = sortedMapNames[i];
            const listItem = $("<li>");
            
            if (mapName === currentMapName) listItem.addClass('current-map');
            
            // Container principal do item - CLICÁVEL EM TODA ÁREA
            const itemContent = $("<div>", { class: "map-item-main clickable-area" });
            
            const mapNameButton = $('<div>', { class: "map-name-display" })
                .append(mapName);
            
            itemContent.append(mapNameButton);
            
            // Adicionar click em toda a área
            itemContent.click(async (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeAllDropdowns(); // Fechar dropdowns ao trocar de mapa
                setCurrentMap(mapName);
                await this.switchMap();
                await this.updateMapList();
            });
            
            // Menu dropdown - MODIFICAÇÃO PRINCIPAL AQUI
            const dropdown = $("<div>", { class: "map-dropdown" });
            const moreButton = $("<button>", { 
                class: "more-info-icon",
                'data-map-name': mapName,
                'data-dropdown-id': `dropdown-${i}`
            })
                .append($('<img>', { src: "./images/icon_more_info.svg" }))
                .click((e) => this.handleDropdownClick(e, mapName, i));
            
            dropdown.append(moreButton);
            
            $(listItem).append(itemContent);
            $(listItem).append(dropdown);
            
            $(this.mapList).append(listItem);
        }
        
        // Limpar listener anterior e adicionar novo
        $(document).off('click.dropdown').on('click.dropdown', (e) => {
            // Não fechar se clicou dentro do dropdown ou no botão
            if (!$(e.target).closest('.portal-dropdown').length && 
                !$(e.target).closest('.more-info-icon').length) {
                this.closeAllDropdowns();
            }
        });
    }

    // NOVO MÉTODO: Gerenciar clique no dropdown
    handleDropdownClick(e, mapName, index) {
        e.preventDefault();
        e.stopPropagation();
        
        const button = $(e.currentTarget);
        const dropdownId = `dropdown-${index}`;
        
        // Verificar se este botão já tem dropdown aberto (toggle)
        if (button.hasClass('active-button')) {
            this.closeAllDropdowns();
            return;
        }
        
        // Fechar todos os dropdowns abertos
        this.closeAllDropdowns();
        
        // Criar e mostrar o dropdown
        this.showDropdown(button, mapName, dropdownId);
        
        // Marcar botão como ativo
        button.addClass('active-button');
    }

    // NOVO MÉTODO: Criar e mostrar dropdown
    showDropdown(button, mapName, dropdownId) {
        // Criar dropdown content
        const dropdownContent = $(`<div class="dropdown-content portal-dropdown" id="${dropdownId}"></div>`);
        
        // Adicionar botões do menu
        this.addDropdownButtons(dropdownContent, mapName);
        
        // Calcular posição
        const buttonOffset = button.offset();
        const buttonHeight = button.outerHeight();
        const buttonWidth = button.outerWidth();
        
        // Posicionar dropdown com largura controlada
        dropdownContent.css({
            position: 'fixed',
            top: buttonOffset.top + buttonHeight + 4,
            right: 'auto',
            left: 'auto',
            zIndex: 999999,
            display: 'block',
            width: '200px', // Largura fixa ao invés de minWidth
            maxWidth: '250px', // Máximo para não sair da tela
            backgroundColor: 'white',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.15)',
            borderRadius: '8px',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            padding: '4px 0',
            whiteSpace: 'nowrap', // Evitar quebra de linha desnecessária
            overflow: 'hidden' // Cortar texto muito longo
        });
        
        // Anexar ao body primeiro para calcular dimensões reais
        $('body').append(dropdownContent);
        
        // Agora calcular posição com base nas dimensões reais
        const dropdownWidth = dropdownContent.outerWidth();
        const dropdownHeight = dropdownContent.outerHeight();
        const windowWidth = $(window).width();
        const windowHeight = $(window).height();
        
        // Posicionar à direita do botão, alinhado pela borda direita
        let finalLeft = buttonOffset.left + buttonWidth - dropdownWidth;
        let finalTop = buttonOffset.top + buttonHeight + 4;
        
        // Verificar limites horizontais
        if (finalLeft < 10) {
            // Se sair pela esquerda, alinhar pela esquerda do botão
            finalLeft = buttonOffset.left;
        }
        if (finalLeft + dropdownWidth > windowWidth - 10) {
            // Se sair pela direita, colar na borda direita da tela
            finalLeft = windowWidth - dropdownWidth - 10;
        }
        
        // Verificar limites verticais
        if (finalTop + dropdownHeight > windowHeight - 10) {
            // Se sair por baixo, mostrar acima do botão
            finalTop = buttonOffset.top - dropdownHeight - 4;
        }
        if (finalTop < 10) {
            // Se sair por cima, colar no topo
            finalTop = 10;
        }
        
        // Aplicar posição final
        dropdownContent.css({
            left: finalLeft,
            top: finalTop
        });
        
        // Adicionar seta indicativa
        this.addDropdownArrow(dropdownContent, button, finalLeft, finalTop, buttonOffset);
    }

    // NOVO MÉTODO: Adicionar seta do dropdown
    addDropdownArrow(dropdownContent, button, dropdownLeft, dropdownTop, buttonOffset) {
        const arrow = $('<div class="dropdown-arrow"></div>');
        
        // Calcular posição da seta em relação ao botão
        const buttonCenterX = buttonOffset.left + (button.outerWidth() / 2);
        const arrowLeft = buttonCenterX - dropdownLeft - 5; // 5 é metade da largura da seta
        
        // Garantir que a seta não saia do dropdown
        const maxArrowLeft = dropdownContent.outerWidth() - 15;
        const finalArrowLeft = Math.max(10, Math.min(arrowLeft, maxArrowLeft));
        
        arrow.css({
            position: 'absolute',
            top: '-5px',
            left: finalArrowLeft + 'px',
            width: '10px',
            height: '10px',
            backgroundColor: 'white',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            borderBottom: 'none',
            borderRight: 'none',
            transform: 'rotate(45deg)',
            zIndex: 1
        });
        
        dropdownContent.append(arrow);
    }

    // NOVO MÉTODO: Adicionar botões ao dropdown
    addDropdownButtons(dropdownContent, mapName) {
        const buttonStyle = {
            display: 'block',
            width: '100%',
            padding: '8px 12px',
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        };
        
        const buttonHoverStyle = 'background-color: #f5f5f5';
        
        // Botão salvar posição
        const savePositionBtn = $("<button>", { class: "menu-button" })
            .css(buttonStyle)
            .html('📍 Salvar posição')
            .hover(
                function() { $(this).css('background-color', '#f5f5f5'); },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const center = this.map.getCenter();
                const zoom = this.map.getZoom();
                
                const center_lat = center.lat;
                const center_long = center.lng;
                await updateMapPosition(center_lat, center_long, zoom);
                this.closeAllDropdowns();
                
                this.showToast(`Posição salva para ${mapName}`, 'success');
            });
        dropdownContent.append(savePositionBtn);
        
        // Botão copiar
        const copyBtn = $("<button>", { class: "menu-button" })
            .css(buttonStyle)
            .html('📋 Copiar')
            .hover(
                function() { $(this).css('background-color', '#f5f5f5'); },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
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
        dropdownContent.append(copyBtn);
        
        // Botão renomear
        const renameBtn = $("<button>", { class: "menu-button" })
            .css(buttonStyle)
            .html('✏️ Renomear')
            .hover(
                function() { $(this).css('background-color', '#f5f5f5'); },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
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
        dropdownContent.append(renameBtn);

        // Botão PUXAR OUTROS MAPAS
        const combineBtn = $("<button>", { class: "menu-button" })
            .css(buttonStyle)
            .html('🔄 Puxar outros mapas')
            .hover(
                function() { $(this).css('background-color', '#f5f5f5'); },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeAllDropdowns();
                
                await this.showCombineMapsModal(mapName);
            });
        dropdownContent.append(combineBtn);

        // Botão mover feições - sempre mostrar, mas verificar seleção no clique
        let selectedCount = 0;
        let buttonText = '↗️ Mover feições selecionadas';
        let buttonDisabled = false;
        
        // Verificar se há feições selecionadas
        if (this.selectionManager) {
            try {
                const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
                selectedCount = selectedFeatures.length;
                if (selectedCount > 0) {
                    buttonText = `↗️ Mover ${selectedCount} feição(ões)`;
                } else {
                    buttonText = '↗️ Mover feições (nenhuma selecionada)';
                    buttonDisabled = true;
                }
            } catch (error) {
                console.warn('Erro ao obter feições selecionadas:', error);
                buttonText = '↗️ Mover feições (erro)';
                buttonDisabled = true;
            }
        } else {
            buttonText = '↗️ Mover feições (sistema indisponível)';
            buttonDisabled = true;
        }
        
        const moveBtn = $("<button>", { class: "menu-button" })
            .css({
                ...buttonStyle,
                opacity: buttonDisabled ? '0.6' : '1',
                fontStyle: buttonDisabled ? 'italic' : 'normal'
            })
            .html(buttonText)
            .hover(
                function() { 
                    if (!buttonDisabled) {
                        $(this).css('background-color', '#f5f5f5'); 
                    }
                },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Verificar se selectionManager existe
                if (!this.selectionManager) {
                    alert("Sistema de seleção não disponível.");
                    this.closeAllDropdowns();
                    return;
                }
                
                const selectedFeatures = this.selectionManager.getAllSelectedFeatures();
                if (selectedFeatures.length === 0) {
                    alert("Nenhuma feição selecionada.");
                    this.closeAllDropdowns();
                    return;
                }
                
                if (mapName === getCurrentMapName()) {
                    alert("Não é possível mover para o mesmo mapa.");
                    this.closeAllDropdowns();
                    return;
                }
                
                if (confirm(`Mover ${selectedFeatures.length} feição(ões) para "${mapName}"?`)) {
                    try {
                        await moveFeaturesToMap(selectedFeatures, mapName);
                        await this.switchMap();
                        this.selectionManager.deselectAllFeatures(true);
                        this.showToast(`${selectedFeatures.length} feição(ões) movida(s)`, 'success');
                    } catch (error) {
                        console.error('Erro ao mover feições:', error);
                        alert('Erro ao mover feições.');
                    }
                }
                
                this.closeAllDropdowns();
            });
        dropdownContent.append(moveBtn);
        
        // Botão excluir
        const deleteBtn = $("<button>", { class: "menu-button menu-button-danger" })
            .css({...buttonStyle, color: '#dc3545'})
            .html('🗑️ Excluir')
            .hover(
                function() { $(this).css('background-color', '#fef2f2'); },
                function() { $(this).css('background-color', 'transparent'); }
            )
            .click(async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const allMapNames = await getAllMapNames();
                if (allMapNames.length > 1) {
                    if (confirm(`Excluir "${mapName}"?`)) {
                        await removeMap(mapName);

                        const currentMapName = getCurrentMapName();
                        if (currentMapName === mapName) {
                            const remainingMaps = await getAllMapNames();
                            setCurrentMap(remainingMaps[0]);
                            await this.switchMap();
                        }

                        await this.updateMapList();
                        this.closeAllDropdowns();
                    }
                } else {
                    alert("Deve haver pelo menos um mapa.");
                }
            });
        dropdownContent.append(deleteBtn);
    }

    // NOVO MÉTODO: Fechar todos os dropdowns
    closeAllDropdowns() {
        $('.portal-dropdown').remove();
        $('.more-info-icon').removeClass('active-button');
    }

    // NOVO MÉTODO: Setup de listeners para reposicionamento
    setupDropdownPositionListeners() {
        $(window).on('scroll resize', () => {
            // Se há dropdown aberto, fechar (evita problemas de posicionamento)
            const activeDropdown = $('.portal-dropdown');
            if (activeDropdown.length > 0) {
                this.closeAllDropdowns();
            }
        });
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
        const originalCurrentMap = getCurrentMapName();
        
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

    async clearAllData() {
        const confirmation = confirm(
            "⚠️ ATENÇÃO: Esta ação é IRREVERSÍVEL!\n\n" +
            "Será removido:\n" +
            "• Todos os mapas\n" +
            "• Todas as feições\n" +
            "• Todas as imagens\n" +
            "• Todo o histórico\n\n" +
            "Continuar?"
        );
        
        if (confirmation) {
            try {
                await mapStore.clear();
                await imageStore.clear();
                resetMemoryStore();
                
                await addMap('Principal');
                setCurrentMap('Principal');
                
                if (this.selectionManager) {
                    this.selectionManager.deselectAllFeatures(true);
                }
                
                await this.switchMap();
                await this.updateMapList();
                
                this.showToast('Dados limpos. Mapa Principal recriado.', 'success');
                
            } catch (error) {
                console.error('Erro ao limpar dados:', error);
                alert('Erro ao limpar dados.');
            }
        }
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
            max-width: 280px;
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

    async switchMap() {
        const baseLayer = await getCurrentBaseLayer();
        const { center_lat, center_long, zoom } = await getMapPosition();
        this.setMapCenterAndZoom(center_lat, center_long, zoom);
        this.baseLayerControl.switchLayer(baseLayer);
    }

    setMapCenterAndZoom(center_lat, center_long, zoom) {
        if (center_lat !== null && center_long !== null && zoom !== null) {
            this.map.setCenter([center_long, center_lat]);
            this.map.setZoom(zoom);
        }
    }
}

export default MapControl;