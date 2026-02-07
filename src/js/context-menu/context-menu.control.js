// Path: js/context-menu/context-menu.control.js
import { formatCoordinates, showSuccess, showWarning, escapeHtml } from '../utilities';
import { createLongPressHandler } from '../utilities/pointer-utils';
import {
    getFeatureGroup,
    createGroup,
    combineGroups,
    ungroupFeatures,
    getLayers,
    moveFeaturesToLayer,
    getActiveLayerIdSync,
    getCurrentMapNameSync,
    getEventBus,
    getAllMapNamesStore,
    getControl,
    isCurrentMapLockedSync,
    isMapLocked
} from '../store';
import { EventTypes } from '../events';

class ContextMenuControl {
    constructor(mouseCoordinatesControl, toolManager, selectionManager) {
        this._map = null;
        this._mouseCoordinatesControl = mouseCoordinatesControl;
        this._toolManager = toolManager;
        this._selectionManager = selectionManager;
        this._contextMenu = null;
        this._lastCoordinates = null;
        this._cleanupLongPress = null;

        this._onRightClick = this._onRightClick.bind(this);
        this._onMapClick = this._onMapClick.bind(this);
        this._onDocumentClick = this._onDocumentClick.bind(this);
        this._onCopyCoordinates = this._onCopyCoordinates.bind(this);
        this._onLongPress = this._onLongPress.bind(this);
    }

    onAdd(map) {
        this._map = map;
        this._createContextMenu();

        this._map.getCanvas().addEventListener('contextmenu', this._onRightClick);
        this._map.on('click', this._onMapClick);
        document.addEventListener('click', this._onDocumentClick);

        // Long-press para touch (substitui right-click em dispositivos touch)
        this._setupLongPress();

        return document.createElement('div');
    }

    /**
     * Configura long-press para abrir context menu em dispositivos touch
     */
    _setupLongPress() {
        const canvas = this._map.getCanvasContainer();

        this._cleanupLongPress = createLongPressHandler(
            canvas,
            this._onLongPress,
            { duration: 500, moveThreshold: 10 }
        );
    }

    /**
     * Handler para long-press - abre context menu
     * @param {TouchEvent} e - Evento touch original
     * @param {Object} position - Posição {x, y} do toque
     */
    async _onLongPress(e, position) {
        // Não abre menu se há ferramenta ativa
        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }

        // Calcula coordenadas do mapa
        const rect = this._map.getCanvasContainer().getBoundingClientRect();
        const point = {
            x: position.x - rect.left,
            y: position.y - rect.top
        };
        const coordinates = this._map.unproject([point.x, point.y]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };

        // Reconstrói e mostra o menu
        await this._rebuildContextMenu();
        this._showMenu(position.x, position.y);
    }

    onRemove() {
        if (this._map) {
            this._map.getCanvas().removeEventListener('contextmenu', this._onRightClick);
            this._map.off('click', this._onMapClick);
        }
        document.removeEventListener('click', this._onDocumentClick);

        // Cleanup long-press handler
        if (this._cleanupLongPress) {
            this._cleanupLongPress();
            this._cleanupLongPress = null;
        }

        if (this._contextMenu && this._contextMenu.parentNode) {
            this._contextMenu.parentNode.removeChild(this._contextMenu);
        }

        this._map = null;
    }

    _createContextMenu() {
        this._contextMenu = document.createElement('div');
        this._contextMenu.className = 'context-menu';
        this._contextMenu.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px 0;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            min-width: 150px;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        document.body.appendChild(this._contextMenu);
    }

    async _rebuildContextMenu() {
        if (!this._contextMenu) return;

        this._contextMenu.innerHTML = '';

        const locked = isCurrentMapLockedSync();
        const groupingAnalysis = this._analyzeSelectionForGrouping();
        const hasGroupingOptions = !locked && (
            groupingAnalysis.canCreateGroup ||
            groupingAnalysis.canCombineGroups ||
            groupingAnalysis.canUngroup ||
            groupingAnalysis.showDisabledCreateGroup
        );

        const hasSelectedFeatures = groupingAnalysis.selectedFeatures.length > 0;

        if (hasGroupingOptions) {
            this._addGroupingOptions(groupingAnalysis);

            const separator = this._createSeparator();
            this._contextMenu.appendChild(separator);
        }

        if (hasSelectedFeatures && !locked) {
            const layerOptionsAdded = await this._addLayerMoveOptions(groupingAnalysis.selectedFeatures);
            const mapOptionsAdded = await this._addMapMoveOptions(groupingAnalysis.selectedFeatures);

            // Só adiciona separador se algo foi realmente adicionado
            if (layerOptionsAdded || mapOptionsAdded) {
                const separator = this._createSeparator();
                this._contextMenu.appendChild(separator);
            }
        }

        this._addDefaultOptions();
    }

    _addGroupingOptions(analysis) {
        if (analysis.canCreateGroup) {
            const createGroupItem = this._createMenuItem(
                'Criar Grupo',
                () => this._handleCreateGroup(analysis.ungroupedFeatures)
            );
            this._contextMenu.appendChild(createGroupItem);
        } else if (analysis.showDisabledCreateGroup) {
            const disabledItem = this._createDisabledMenuItem(
                'Criar Grupo',
                'Feições em camadas distintas'
            );
            this._contextMenu.appendChild(disabledItem);
        }

        if (analysis.canCombineGroups) {
            const combineText = analysis.groupIds.length > 1 ? 'Combinar Grupos' : 'Adicionar ao Grupo';
            const combineGroupsItem = this._createMenuItem(
                combineText,
                () => this._handleCombineGroups(analysis.groupIds, analysis.ungroupedFeatures)
            );
            this._contextMenu.appendChild(combineGroupsItem);
        }

        if (analysis.canUngroup) {
            const ungroupItem = this._createMenuItem(
                'Desagrupar',
                () => this._handleUngroup(analysis.groupIds[0])
            );
            this._contextMenu.appendChild(ungroupItem);
        }
    }

    async _addLayerMoveOptions(selectedFeatures) {
        const layers = await getLayers();
        const activeLayerId = getActiveLayerIdSync();

        const currentLayerId = selectedFeatures[0]?.properties?.layerId || 'default';

        const availableLayers = layers.filter(l => !l.locked && l.id !== currentLayerId);

        if (availableLayers.length === 0) {
            return false;
        }

        const submenuContainer = document.createElement('div');
        submenuContainer.className = 'context-menu-submenu-container';
        submenuContainer.style.cssText = `
            position: relative;
        `;

        const moveToLayerItem = document.createElement('div');
        moveToLayerItem.className = 'context-menu-item';
        moveToLayerItem.innerHTML = `
            <span>Mover para camada</span>
            <span style="float: right; margin-left: 8px;">▶</span>
        `;
        moveToLayerItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
            transition: background-color 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        const submenu = document.createElement('div');
        submenu.className = 'context-submenu';
        submenu.style.cssText = `
            position: absolute;
            left: 100%;
            top: -8px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            min-width: 150px;
            display: none;
            z-index: 10001;
        `;

        availableLayers.forEach(layer => {
            const layerItem = document.createElement('div');
            layerItem.className = 'context-menu-item';

            let displayName = layer.name;
            if (layer.id === activeLayerId) {
                displayName += ' ★';
            }

            layerItem.textContent = displayName;
            layerItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                font-size: 13px;
                user-select: none;
                transition: background-color 0.2s;
            `;

            layerItem.addEventListener('mouseenter', () => {
                layerItem.style.backgroundColor = '#f5f5f5';
            });

            layerItem.addEventListener('mouseleave', () => {
                layerItem.style.backgroundColor = '';
            });

            layerItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handleMoveToLayer(selectedFeatures, layer.id, layer.name);
                this._hideMenu();
            });

            submenu.appendChild(layerItem);
        });

        moveToLayerItem.addEventListener('mouseenter', () => {
            moveToLayerItem.style.backgroundColor = '#f5f5f5';
            submenu.style.display = 'block';

            const rect = submenu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            if (rect.right > windowWidth) {
                submenu.style.left = 'auto';
                submenu.style.right = '100%';
            }
        });

        submenuContainer.addEventListener('mouseleave', () => {
            moveToLayerItem.style.backgroundColor = '';
            submenu.style.display = 'none';
        });

        submenuContainer.appendChild(moveToLayerItem);
        submenuContainer.appendChild(submenu);
        this._contextMenu.appendChild(submenuContainer);

        return true;
    }

    async _handleMoveToLayer(features, targetLayerId, targetLayerName) {
        try {
            const featureRefs = features.map(f => ({
                type: f.properties.source,
                id: f.properties.id
            }));

            await moveFeaturesToLayer(featureRefs, targetLayerId);

            for (const feature of features) {
                const storageType = feature.properties.source + 's';
                const source = this._map.getSource(storageType);
                if (source) {
                    try {
                        const data = await source.getData();
                        const sourceFeature = data.features.find(f => f.properties.id === feature.properties.id);
                        if (sourceFeature) {
                            sourceFeature.properties.layerId = targetLayerId;
                        }
                        source.setData(data);
                    } catch (_e) {
                    }
                }
            }

            showSuccess(`${features.length} feição(ões) movida(s) para "${targetLayerName}"`);

            // Emit layers-changed event via EventBus
            getEventBus().emit(EventTypes.LAYERS_CHANGED, {
                mapName: getCurrentMapNameSync()
            });
        } catch (error) {
            console.error('Error moving features:', error);
            alert('Erro ao mover feições: ' + error.message);
        }
    }

    /**
     * Adds map move submenu options
     * @param {Array} selectedFeatures - Selected features
     * @returns {boolean} Whether options were added
     */
    async _addMapMoveOptions(selectedFeatures) {
        const allMaps = await getAllMapNamesStore();
        const currentMapName = getCurrentMapNameSync();

        // Filter out current map and locked maps
        const lockedChecks = await Promise.all(
            allMaps.map(async name => ({ name, locked: await isMapLocked(name) }))
        );
        const availableMaps = lockedChecks
            .filter(m => m.name !== currentMapName && !m.locked)
            .map(m => m.name);

        if (availableMaps.length === 0) {
            return false;
        }

        const submenuContainer = document.createElement('div');
        submenuContainer.className = 'context-menu-submenu-container';
        submenuContainer.style.cssText = `
            position: relative;
        `;

        const moveToMapItem = document.createElement('div');
        moveToMapItem.className = 'context-menu-item';
        moveToMapItem.innerHTML = `
            <span>Mover para mapa</span>
            <span style="float: right; margin-left: 8px;">▶</span>
        `;
        moveToMapItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
            transition: background-color 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        const submenu = document.createElement('div');
        submenu.className = 'context-submenu';
        submenu.style.cssText = `
            position: absolute;
            left: 100%;
            top: -8px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 8px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            min-width: 150px;
            display: none;
            z-index: 10001;
            max-height: 300px;
            overflow-y: auto;
        `;

        availableMaps.forEach(mapName => {
            const mapItem = document.createElement('div');
            mapItem.className = 'context-menu-item';

            const initial = mapName.charAt(0).toUpperCase();
            mapItem.innerHTML = `
                <span style="
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 20px;
                    height: 20px;
                    border-radius: 4px;
                    background: #e0e0e0;
                    font-size: 11px;
                    font-weight: 600;
                    margin-right: 8px;
                ">${initial}</span>
                <span>${escapeHtml(mapName)}</span>
            `;
            mapItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                font-size: 13px;
                user-select: none;
                transition: background-color 0.2s;
                display: flex;
                align-items: center;
            `;

            mapItem.addEventListener('mouseenter', () => {
                mapItem.style.backgroundColor = '#f5f5f5';
            });

            mapItem.addEventListener('mouseleave', () => {
                mapItem.style.backgroundColor = '';
            });

            mapItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handleMoveToMap(selectedFeatures, mapName);
                this._hideMenu();
            });

            submenu.appendChild(mapItem);
        });

        moveToMapItem.addEventListener('mouseenter', () => {
            moveToMapItem.style.backgroundColor = '#f5f5f5';
            submenu.style.display = 'block';

            const rect = submenu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            if (rect.right > windowWidth) {
                submenu.style.left = 'auto';
                submenu.style.right = '100%';
            }
        });

        submenuContainer.addEventListener('mouseleave', () => {
            moveToMapItem.style.backgroundColor = '';
            submenu.style.display = 'none';
        });

        submenuContainer.appendChild(moveToMapItem);
        submenuContainer.appendChild(submenu);
        this._contextMenu.appendChild(submenuContainer);

        return true;
    }

    /**
     * Handles moving features to another map
     * @param {Array} features - Features to move
     * @param {string} targetMapName - Target map name
     */
    async _handleMoveToMap(features, targetMapName) {
        try {
            const mapManager = getControl('MapManager');
            if (!mapManager) {
                throw new Error('MapManager não disponível');
            }

            const result = await mapManager.moveFeaturesToMap(features, targetMapName);

            if (result.success) {
                showSuccess(result.message);
            } else {
                showWarning(result.message);
            }
        } catch (error) {
            console.error('Error moving features to map:', error);
            alert('Erro ao mover feições: ' + error.message);
        }
    }

    _addDefaultOptions() {
        const copyItem = this._createMenuItem('Copiar Coordenadas', this._onCopyCoordinates);
        this._contextMenu.appendChild(copyItem);

        const resetNorthItem = this._createMenuItem('Orientar para Norte', this._onResetNorth.bind(this));
        this._contextMenu.appendChild(resetNorthItem);
    }

    _createMenuItem(text, clickHandler) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.textContent = text;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            user-select: none;
            transition: background-color 0.2s;
        `;

        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f5f5f5';
        });

        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = '';
        });

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                clickHandler();
                this._hideMenu();
            } catch (error) {
                console.error('Error in menu operation:', error);
                alert('Erro: ' + error.message);
            }
        });

        return item;
    }

    _createSeparator() {
        const separator = document.createElement('div');
        separator.style.cssText = `
            height: 1px;
            background: #e0e0e0;
            margin: 4px 0;
        `;
        return separator;
    }

    _createDisabledMenuItem(text, tooltip) {
        const item = document.createElement('div');
        item.className = 'context-menu-item disabled';
        item.textContent = text;
        item.title = tooltip;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: not-allowed;
            font-size: 13px;
            user-select: none;
            color: #999;
        `;
        return item;
    }

    _analyzeSelectionForGrouping() {
        if (!this._selectionManager) {
            return {
                canCreateGroup: false,
                canCombineGroups: false,
                canUngroup: false,
                showDisabledCreateGroup: false,
                groupIds: [],
                ungroupedFeatures: [],
                selectedFeatures: []
            };
        }

        const selected = this._selectionManager.getAllSelectedFeatures();
        const groups = new Set();
        const ungroupedFeatures = [];

        selected.forEach(feature => {
            const group = getFeatureGroup(feature.properties.source, feature.properties.id);
            if (group) {
                groups.add(group.id);
            } else {
                ungroupedFeatures.push(feature);
            }
        });

        // Verificar se todas as features selecionadas pertencem à mesma camada
        const allSameLayer = this._allFeaturesInSameLayer(selected);

        // Mostrar opção desabilitada se há 2+ features não agrupadas mas em camadas diferentes
        const showDisabledCreateGroup = ungroupedFeatures.length > 1 && !allSameLayer;

        return {
            // Só pode criar grupo se todas estiverem na mesma camada
            canCreateGroup: ungroupedFeatures.length > 1 && allSameLayer,
            // Só pode combinar grupos se todas estiverem na mesma camada
            canCombineGroups: groups.size > 0 && (groups.size > 1 || ungroupedFeatures.length > 0) && allSameLayer,
            canUngroup: groups.size === 1 && ungroupedFeatures.length === 0,
            showDisabledCreateGroup,
            groupIds: Array.from(groups),
            ungroupedFeatures: ungroupedFeatures,
            selectedFeatures: selected
        };
    }

    /**
     * Checks if all features are in the same layer
     * @param {Array} features - Array of features to check
     * @returns {boolean} true if all features are in same layer
     */
    _allFeaturesInSameLayer(features) {
        if (features.length <= 1) return true;

        const firstLayerId = features[0]?.properties?.layerId || 'default';
        return features.every(f => (f.properties?.layerId || 'default') === firstLayerId);
    }

    _handleCreateGroup(features) {
        if (features.length < 2) {
            throw new Error('É necessário pelo menos 2 feições para criar um grupo.');
        }

        const newGroup = createGroup(features);

        if (this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
            this._selectGroup(newGroup);
            this._selectionManager.updateUI();
        }
    }

    _handleCombineGroups(groupIds, ungroupedFeatures) {
        if (groupIds.length === 0 && ungroupedFeatures.length < 2) {
            throw new Error('É necessário pelo menos 2 feições ou 1 grupo para combinar.');
        }

        const combinedGroup = combineGroups(groupIds, ungroupedFeatures);

        if (this._selectionManager) {
            this._selectionManager.deselectAllFeatures();
            this._selectGroup(combinedGroup);
            this._selectionManager.updateUI();
        }
    }

    _handleUngroup(groupId) {
        const _features = ungroupFeatures(groupId);

        if (this._selectionManager) {
            this._selectionManager.updateUI();
        }
    }

    _selectGroup(group) {
        if (!this._selectionManager) return;

        group.features.forEach(featureRef => {
            const completeFeature = this._selectionManager.getCompleteFeatureFromSource(featureRef.type, featureRef.id);
            if (completeFeature) {
                this._selectionManager.toggleFeatureSelection(featureRef.type, featureRef.id, completeFeature, false);
            }
        });
    }

    async _onRightClick(e) {
        e.preventDefault();

        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }

        const coordinates = this._map.unproject([e.offsetX, e.offsetY]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };

        await this._rebuildContextMenu();

        this._showMenu(e.clientX, e.clientY);
    }

    _onMapClick() {
        this._hideMenu();
    }

    _onDocumentClick(e) {
        if (this._contextMenu && !this._contextMenu.contains(e.target)) {
            this._hideMenu();
        }
    }

    _showMenu(x, y) {
        if (!this._contextMenu) return;

        // Reset position first to measure correctly
        this._contextMenu.style.left = '0px';
        this._contextMenu.style.top = '0px';
        this._contextMenu.style.display = 'block';

        const rect = this._contextMenu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const padding = 8; // Padding from edge

        let finalX = x;
        let finalY = y;

        // Adjust horizontal position if menu would overflow right edge
        if (x + rect.width > windowWidth - padding) {
            finalX = Math.max(padding, windowWidth - rect.width - padding);
        }

        // Adjust vertical position if menu would overflow bottom edge
        if (y + rect.height > windowHeight - padding) {
            finalY = Math.max(padding, y - rect.height);
        }

        // Ensure menu doesn't go off-screen on the left
        if (finalX < padding) {
            finalX = padding;
        }

        // Ensure menu doesn't go off-screen on the top
        if (finalY < padding) {
            finalY = padding;
        }

        this._contextMenu.style.left = `${finalX}px`;
        this._contextMenu.style.top = `${finalY}px`;
    }

    _hideMenu() {
        if (this._contextMenu) {
            this._contextMenu.style.display = 'none';
        }
    }

    async _onCopyCoordinates() {
        if (!this._lastCoordinates || !this._mouseCoordinatesControl) {
            this._hideMenu();
            return;
        }

        const { lat, lng } = this._lastCoordinates;
        const currentFormat = this._mouseCoordinatesControl.getCurrentFormat();
        const textToCopy = await formatCoordinates(lat, lng, currentFormat);

        this._copyToClipboard(textToCopy);
        this._hideMenu();
    }

    _onResetNorth() {
        if (this._map) {
            this._map.easeTo({
                pitch: 0,
                bearing: 0
            });
        }
        this._hideMenu();
    }

    _copyToClipboard(text) {
        if (!text || text.trim() === '') return;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                showSuccess('Coordenadas copiadas!');
            }).catch(() => {
                this._fallbackCopyTextToClipboard(text);
            });
        } else {
            this._fallbackCopyTextToClipboard(text);
        }
    }

    _fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
            showSuccess('Coordenadas copiadas!');
        } catch (err) {
            console.error('Error copying text:', err);
        }

        document.body.removeChild(textArea);
    }
}

export default ContextMenuControl;
