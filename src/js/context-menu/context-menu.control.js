// Path: js/context-menu/context-menu.control.js
import { formatCoordinates, showSuccess, showWarning, showError, escapeHtml } from '@utils';
import { createLongPressHandler, isTouchDevice } from '@utils/pointer-utils';
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
} from '@store';
import { EventTypes } from '@events';
import { fitBounds, ANIMATION_DURATION } from '@js/map/animation.service.js';
import { canMergeArrows, canSplitArrows, mergeArrows, splitArrows } from '@js/military_tools/arrow_tool/arrow-merge.js';

/** Pure property check for line split eligibility (no heavy imports) */
function canSplitLineCheck(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) return { canSplit: false };
    const f = selectedFeatures[0];
    return {
        canSplit: f.properties?.source === 'line' &&
                  f.geometry?.coordinates?.length >= 2 &&
                  !f.properties?.bloqueado
    };
}

class ContextMenuControl {
    constructor(mouseCoordinatesControl, toolManager, selectionManager) {
        this._map = null;
        this._mouseCoordinatesControl = mouseCoordinatesControl;
        this._toolManager = toolManager;
        this._selectionManager = selectionManager;
        this._contextMenu = null;
        this._lastCoordinates = null;
        this._lastPoint = null;
        this._cleanupLongPress = null;
        // Bumped by every _rebuildContextMenu: a build that awaits must not
        // append into a menu a newer build already cleared.
        this._menuBuildId = 0;

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

        // Long-press for touch (replaces right-click on touch devices)
        this._setupLongPress();

        return document.createElement('div');
    }

    /**
     * Sets up long-press to open context menu on touch devices.
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
     * Handler for long-press - opens context menu.
     * @param {TouchEvent} e - Original touch event
     * @param {Object} position - Touch position {x, y}
     */
    async _onLongPress(e, position) {
        // Do not open menu if a tool is active
        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }

        // Calculate map coordinates
        const rect = this._map.getCanvasContainer().getBoundingClientRect();
        const point = {
            x: position.x - rect.left,
            y: position.y - rect.top
        };
        const coordinates = this._map.unproject([point.x, point.y]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };
        this._lastPoint = { x: point.x, y: point.y };

        // Rebuild and show the menu
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

        if (isTouchDevice()) {
            this._contextMenu.classList.add('context-menu--touch');
        }

        document.body.appendChild(this._contextMenu);
    }

    async _rebuildContextMenu() {
        if (!this._contextMenu) return;

        // Two right-clicks in quick succession overlap: the second rebuild clears
        // the menu while the first is still awaiting the layer/map lists, and the
        // first would then append its items into the second's menu. Only the
        // newest generation may write.
        const buildId = ++this._menuBuildId;

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

        // Arrow merge/split options
        if (hasSelectedFeatures && !locked) {
            const arrowMergeAdded = this._addArrowMergeOptions(groupingAnalysis.selectedFeatures);
            if (arrowMergeAdded) {
                const separator = this._createSeparator();
                this._contextMenu.appendChild(separator);
            }
        }

        // Line split option
        if (hasSelectedFeatures && !locked) {
            const lineSplitAdded = this._addLineSplitOption(groupingAnalysis.selectedFeatures);
            if (lineSplitAdded) {
                this._contextMenu.appendChild(this._createSeparator());
            }
        }

        // QAN export option (lines and polygons)
        if (hasSelectedFeatures) {
            const qanAdded = this._addQANExportOption(groupingAnalysis.selectedFeatures);
            if (qanAdded) {
                this._contextMenu.appendChild(this._createSeparator());
            }
        }

        if (hasSelectedFeatures && !locked) {
            const layerOptionsAdded = await this._addLayerMoveOptions(groupingAnalysis.selectedFeatures, buildId);
            if (this._isStaleBuild(buildId)) return;

            const mapOptionsAdded = await this._addMapMoveOptions(groupingAnalysis.selectedFeatures, buildId);
            if (this._isStaleBuild(buildId)) return;

            // Only add separator if something was actually added
            if (layerOptionsAdded || mapOptionsAdded) {
                const separator = this._createSeparator();
                this._contextMenu.appendChild(separator);
            }
        }

        this._addDefaultOptions();
    }

    /**
     * True when a newer `_rebuildContextMenu` started while this one was awaiting.
     * A stale build must not append: the newer one already cleared the menu.
     * @param {number} buildId
     * @returns {boolean}
     * @private
     */
    _isStaleBuild(buildId) {
        return buildId !== this._menuBuildId;
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

    /**
     * Add arrow merge/split options to context menu
     * @param {Array} selectedFeatures - Currently selected features
     * @returns {boolean} Whether any option was added
     */
    _addArrowMergeOptions(selectedFeatures) {
        let added = false;

        const mergeCheck = canMergeArrows(selectedFeatures);
        if (mergeCheck.canMerge) {
            const mergeItem = this._createMenuItem(
                'Combinar Setas',
                () => this._handleMergeArrows(selectedFeatures)
            );
            this._contextMenu.appendChild(mergeItem);
            added = true;
        }

        const splitCheck = canSplitArrows(selectedFeatures);
        if (splitCheck.canSplit) {
            const splitItem = this._createMenuItem(
                'Separar Setas',
                () => this._handleSplitArrows(selectedFeatures[0])
            );
            this._contextMenu.appendChild(splitItem);
            added = true;
        }

        return added;
    }

    async _handleMergeArrows(features) {
        try {
            await mergeArrows(features, this._map, this._selectionManager);
        } catch (error) {
            console.error('Error merging arrows:', error);
            showError('Erro ao combinar setas');
        }
    }

    async _handleSplitArrows(mergedFeature) {
        try {
            await splitArrows(mergedFeature, this._map, this._selectionManager);
        } catch (error) {
            console.error('Error splitting arrows:', error);
            showError('Erro ao separar setas');
        }
    }

    /**
     * Add line split option to context menu
     * @param {Array} selectedFeatures - Currently selected features
     * @returns {boolean} Whether the option was added
     */
    _addLineSplitOption(selectedFeatures) {
        const check = canSplitLineCheck(selectedFeatures);
        if (!check.canSplit) return false;

        const splitItem = this._createMenuItem(
            'Cortar Linha',
            () => this._handleSplitLine(selectedFeatures[0])
        );
        this._contextMenu.appendChild(splitItem);
        return true;
    }

    async _handleSplitLine(lineFeature) {
        try {
            const { activateSplitMode } = await import('@js/draw_tools/line_tool/line-split.js');
            await activateSplitMode(lineFeature, this._map, this._selectionManager);
        } catch (error) {
            console.error('Error splitting line:', error);
            showError('Erro ao cortar linha');
        }
    }

    /**
     * Add QAN export option for line/polygon features.
     * @param {Array} selectedFeatures - Currently selected features
     * @returns {boolean} Whether the option was added
     */
    _addQANExportOption(selectedFeatures) {
        if (selectedFeatures.length !== 1) return false;
        const source = selectedFeatures[0].properties?.source;
        if (source !== 'line' && source !== 'polygon') return false;

        const item = this._createMenuItem(
            'Exportar QAN',
            () => this._handleQANExport(selectedFeatures[0])
        );
        this._contextMenu.appendChild(item);
        return true;
    }

    async _handleQANExport(feature) {
        try {
            const { generateQAN, downloadQANAsHTML } = await import('@js/import_export/qan/index.js');
            const qanData = await generateQAN(feature);
            downloadQANAsHTML(qanData, feature.properties.nome);
        } catch (error) {
            console.error('Error exporting QAN:', error);
            showError('Erro ao exportar QAN');
        }
    }

    /**
     * Adds the layer move submenu.
     * @param {Array} selectedFeatures - Selected features
     * @param {number} [buildId] - Menu generation this build belongs to.
     * @returns {Promise<boolean>} Whether options were added
     */
    async _addLayerMoveOptions(selectedFeatures, buildId) {
        const layers = await getLayers();
        if (buildId !== undefined && this._isStaleBuild(buildId)) return false;

        const activeLayerId = getActiveLayerIdSync();

        const currentLayerId = selectedFeatures[0]?.properties?.layerId || 'default';

        const availableLayers = layers.filter(l => !l.locked && l.id !== currentLayerId);

        if (availableLayers.length === 0) {
            return false;
        }

        const submenuContainer = document.createElement('div');
        submenuContainer.className = 'context-menu-submenu-container';

        const moveToLayerItem = document.createElement('div');
        moveToLayerItem.className = 'context-menu-item context-menu-submenu-trigger';
        moveToLayerItem.innerHTML = `
            <span>Mover para camada</span>
            <span class="context-menu-submenu-arrow">▶</span>
        `;

        const submenu = document.createElement('div');
        submenu.className = 'context-submenu';

        availableLayers.forEach(layer => {
            const layerItem = document.createElement('div');
            layerItem.className = 'context-menu-item';

            let displayName = layer.name;
            if (layer.id === activeLayerId) {
                displayName += ' ★';
            }

            layerItem.textContent = displayName;

            layerItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handleMoveToLayer(selectedFeatures, layer.id, layer.name);
                this._hideMenu();
            });

            submenu.appendChild(layerItem);
        });

        moveToLayerItem.addEventListener('mouseenter', () => {
            submenu.style.display = 'block';

            const rect = submenu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            if (rect.right > windowWidth) {
                submenu.style.left = 'auto';
                submenu.style.right = '100%';
            }
        });

        submenuContainer.addEventListener('mouseleave', () => {
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
            showError('Erro ao mover feições: ' + error.message);
        }
    }

    /**
     * Adds map move submenu options
     * @param {Array} selectedFeatures - Selected features
     * @param {number} [buildId] - Menu generation this build belongs to.
     * @returns {Promise<boolean>} Whether options were added
     */
    async _addMapMoveOptions(selectedFeatures, buildId) {
        const allMaps = await getAllMapNamesStore();
        if (buildId !== undefined && this._isStaleBuild(buildId)) return false;

        const currentMapName = getCurrentMapNameSync();

        // Filter out current map and locked maps
        const lockedChecks = await Promise.all(
            allMaps.map(async name => ({ name, locked: await isMapLocked(name) }))
        );
        if (buildId !== undefined && this._isStaleBuild(buildId)) return false;

        const availableMaps = lockedChecks
            .filter(m => m.name !== currentMapName && !m.locked)
            .map(m => m.name);

        if (availableMaps.length === 0) {
            return false;
        }

        const submenuContainer = document.createElement('div');
        submenuContainer.className = 'context-menu-submenu-container';

        const moveToMapItem = document.createElement('div');
        moveToMapItem.className = 'context-menu-item context-menu-submenu-trigger';
        moveToMapItem.innerHTML = `
            <span>Mover para mapa</span>
            <span class="context-menu-submenu-arrow">▶</span>
        `;

        const submenu = document.createElement('div');
        submenu.className = 'context-submenu context-submenu--scrollable';

        availableMaps.forEach(mapName => {
            const mapItem = document.createElement('div');
            mapItem.className = 'context-menu-item';

            const initial = mapName.charAt(0).toUpperCase();
            mapItem.innerHTML = `
                <span class="context-menu-map-initial">${initial}</span>
                <span>${escapeHtml(mapName)}</span>
            `;

            mapItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this._handleMoveToMap(selectedFeatures, mapName);
                this._hideMenu();
            });

            submenu.appendChild(mapItem);
        });

        moveToMapItem.addEventListener('mouseenter', () => {
            submenu.style.display = 'block';

            const rect = submenu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            if (rect.right > windowWidth) {
                submenu.style.left = 'auto';
                submenu.style.right = '100%';
            }
        });

        submenuContainer.addEventListener('mouseleave', () => {
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
            showError('Erro ao mover feições: ' + error.message);
        }
    }

    _addDefaultOptions() {
        const selectedFeatures = this._selectionManager?.getAllSelectedFeatures() || [];
        const hasSelected = selectedFeatures.length > 0;
        const locked = isCurrentMapLockedSync();

        if (hasSelected) {
            const zoomItem = this._createMenuItem(
                'Zoom para Seleção',
                () => this._handleZoomToSelection()
            );
            this._contextMenu.appendChild(zoomItem);

            if (!locked) {
                const duplicateItem = this._createMenuItem(
                    'Duplicar Seleção',
                    () => this._handleDuplicateSelected()
                );
                this._contextMenu.appendChild(duplicateItem);
            }

            const separator = this._createSeparator();
            this._contextMenu.appendChild(separator);
        }

        const clipboardAdded = this._addClipboardOptions(selectedFeatures, locked);
        if (clipboardAdded) {
            this._contextMenu.appendChild(this._createSeparator());
        }

        const copyItem = this._createMenuItem('Copiar Coordenadas', this._onCopyCoordinates);
        this._contextMenu.appendChild(copyItem);

        const bearing = this._map.getBearing();
        const pitch = this._map.getPitch();
        const isAlreadyNorth = Math.abs(bearing) < 0.5 && Math.abs(pitch) < 0.5;

        if (isAlreadyNorth) {
            const disabledItem = this._createDisabledMenuItem('Orientar para Norte', 'Mapa já está orientado para norte');
            this._contextMenu.appendChild(disabledItem);
        } else {
            const resetNorthItem = this._createMenuItem('Orientar para Norte', this._onResetNorth.bind(this));
            this._contextMenu.appendChild(resetNorthItem);
        }
    }

    _createMenuItem(text, clickHandler) {
        const item = document.createElement('div');
        item.className = 'context-menu-item';
        item.textContent = text;

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            try {
                clickHandler();
                this._hideMenu();
            } catch (error) {
                console.error('Error in menu operation:', error);
                showError('Erro: ' + error.message);
            }
        });

        return item;
    }

    _createSeparator() {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        return separator;
    }

    _createDisabledMenuItem(text, tooltip) {
        const item = document.createElement('div');
        item.className = 'context-menu-item disabled';
        item.textContent = text;
        item.title = tooltip;
        // The item stays in the DOM and stays readable, so assistive tech must
        // hear that it is refused, and why (the tooltip names the state).
        item.setAttribute('aria-disabled', 'true');
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

        // Check if all selected features belong to the same layer
        const allSameLayer = this._allFeaturesInSameLayer(selected);

        // Show disabled option if 2+ ungrouped features are in different layers
        const showDisabledCreateGroup = ungroupedFeatures.length > 1 && !allSameLayer;

        return {
            // Can only create group if all features are in the same layer
            canCreateGroup: ungroupedFeatures.length > 1 && allSameLayer,
            // Can only combine groups if all features are in the same layer
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

    /**
     * Adds the copy/paste block. Copy acts on the selection, or - when nothing
     * is selected - on the feature under the cursor, WITHOUT selecting it
     * (selecting here would open the attributes panel behind the menu).
     * Paste anchors the copied set on the clicked position.
     *
     * Building this block is SYNCHRONOUS on purpose: deciding whether "Copiar
     * Feição" shows up only needs the rendered-features hit-test, so the common
     * right-click does not wait for a source read before the menu opens. The
     * complete feature is read inside the item's own click handler.
     *
     * @param {Array<Object>} selectedFeatures - Current selection.
     * @param {boolean} locked - Whether the current map is locked.
     * @returns {boolean} True when at least one item was added.
     * @private
     */
    _addClipboardOptions(selectedFeatures, locked) {
        const clipboardManager = getControl('ClipboardManager');
        if (!clipboardManager) return false;

        let added = false;

        if (selectedFeatures.length > 0) {
            const copiable = clipboardManager.filterCopiableFeatures(selectedFeatures);
            const copyItem = copiable.length > 0
                ? this._createMenuItem('Copiar Feições', () => this._handleCopyFeatures())
                : this._createDisabledMenuItem(
                    'Copiar Feições',
                    'Nenhuma feição selecionada pode ser copiada'
                );
            this._contextMenu.appendChild(copyItem);
            added = true;
        } else {
            const hit = this._findCopiableHitUnderCursor(clipboardManager);
            if (hit) {
                this._contextMenu.appendChild(this._createMenuItem(
                    'Copiar Feição',
                    () => this._handleCopyFeatureUnderCursor(hit)
                ));
                added = true;
            }
        }

        if (clipboardManager.hasClipboardData()) {
            const count = clipboardManager.clipboard.features.length;
            const label = `Colar Aqui (${count})`;

            if (locked) {
                this._contextMenu.appendChild(
                    this._createDisabledMenuItem(label, 'Mapa bloqueado')
                );
            } else {
                const lockedLayers = clipboardManager.getLockedDestinationLayers();
                if (lockedLayers.length > 0) {
                    this._contextMenu.appendChild(this._createDisabledMenuItem(
                        label,
                        `Camada de destino bloqueada: ${lockedLayers.join(', ')}`
                    ));
                } else {
                    this._contextMenu.appendChild(this._createMenuItem(
                        label,
                        () => this._handlePasteHere()
                    ));
                }
            }
            added = true;
        }

        return added;
    }

    /**
     * Reference to the topmost copiable feature under the last gesture, from the
     * SYNCHRONOUS rendered-features hit-test. Never changes selection and never
     * reads the source: only `{toolType, id}` is kept, and the complete feature
     * is fetched when the menu item is clicked.
     * @param {Object} clipboardManager
     * @returns {{toolType: string, id: string}|null}
     * @private
     */
    _findCopiableHitUnderCursor(clipboardManager) {
        if (!this._lastPoint || !this._selectionManager) return null;

        const clicked = this._selectionManager.getAllClickedCustomFeatures(
            [this._lastPoint.x, this._lastPoint.y]
        );
        if (clicked.length === 0) return null;

        const target = clicked[0];
        if (clipboardManager.filterCopiableFeatures([target]).length === 0) return null;

        return { toolType: target.toolType, id: target.properties.id };
    }

    /**
     * Copies the feature the menu was opened over. The complete geometry is read
     * from the map source HERE (not while the menu is being built) so the right
     * click itself never waits for it.
     * @param {{toolType: string, id: string}} hit
     * @private
     */
    async _handleCopyFeatureUnderCursor(hit) {
        try {
            const complete = await this._selectionManager?.getCompleteFeatureFromSource(
                hit.toolType,
                hit.id
            );

            if (!complete) {
                showWarning('Não foi possível ler a feição para copiar');
                return;
            }

            this._handleCopyFeatures([complete]);
        } catch (error) {
            console.error('Error copying feature under cursor:', error);
            showError('Erro ao copiar feição');
        }
    }

    /**
     * @param {Array<Object>|null} [features] - Defaults to the selection.
     * @private
     */
    _handleCopyFeatures(features = null) {
        const clipboardManager = getControl('ClipboardManager');
        if (!clipboardManager) {
            showWarning('Área de transferência não disponível');
            return;
        }

        const count = clipboardManager.copy(features);
        if (count > 0) {
            showSuccess(`${count} feição(ões) copiada(s)`);
        }
    }

    /** @private */
    async _handlePasteHere() {
        try {
            const clipboardManager = getControl('ClipboardManager');
            if (!clipboardManager) {
                showWarning('Área de transferência não disponível');
                return;
            }

            await clipboardManager.paste({ targetLngLat: this._lastCoordinates });
        } catch (error) {
            console.error('Error pasting features:', error);
            showError('Erro ao colar feições');
        }
    }

    async _handleDuplicateSelected() {
        try {
            const clipboardManager = getControl('ClipboardManager');
            if (!clipboardManager) {
                showWarning('Área de transferência não disponível');
                return;
            }

            clipboardManager.copy();
            await clipboardManager.paste();
        } catch (error) {
            console.error('Error duplicating features:', error);
            showError('Erro ao duplicar feições');
        }
    }

    _handleZoomToSelection() {
        const selectedFeatures = this._selectionManager.getAllSelectedFeatures();
        if (selectedFeatures.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const feature of selectedFeatures) {
            const coords = this._extractCoordinates(feature.geometry);
            for (const [x, y] of coords) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }

        if (!isFinite(minX)) return;

        fitBounds(this._map, [[minX, minY], [maxX, maxY]], {
            duration: ANIMATION_DURATION.FAST,
            padding: 80
        });
    }

    /**
     * Extracts flat array of [lng, lat] pairs from any GeoJSON geometry.
     * @param {Object} geometry - GeoJSON geometry
     * @returns {Array<[number, number]>} Coordinate pairs
     */
    _extractCoordinates(geometry) {
        if (!geometry || !geometry.coordinates) return [];

        const type = geometry.type;
        if (type === 'Point') {
            return [geometry.coordinates];
        } else if (type === 'MultiPoint' || type === 'LineString') {
            return geometry.coordinates;
        } else if (type === 'MultiLineString' || type === 'Polygon') {
            return geometry.coordinates.flat();
        } else if (type === 'MultiPolygon') {
            return geometry.coordinates.flat(2);
        } else if (type === 'GeometryCollection') {
            return geometry.geometries.flatMap(g => this._extractCoordinates(g));
        }

        return [];
    }

    async _onRightClick(e) {
        e.preventDefault();

        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }

        const coordinates = this._map.unproject([e.offsetX, e.offsetY]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };
        this._lastPoint = { x: e.offsetX, y: e.offsetY };

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
        const padding = isTouchDevice() ? 12 : 8;

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
