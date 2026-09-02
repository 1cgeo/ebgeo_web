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
    isMapLocked,
    isUncopyableFeatureType
} from '@store';
import { EventTypes } from '@events';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { fitBounds, ANIMATION_DURATION } from '@js/map/animation.service.js';
import { flattenPositions, antimeridianSafeLngSpan } from '@utils/geometry-utils.js';
import { checkPermission } from '@store/sync/permission-guard.js';
import {
    ClipboardMenuAction,
    clipboardMenuActions
} from './clipboard-menu-actions.js';
// ── Portões de combinar/separar setas ─────────────────────────────────────────────────────────
//
// POR QUE OS PREDICADOS ESTÃO AQUI, COPIADOS. O import estático de `arrow-merge.js` prendia
// `military_tools` inteiro (47 módulos, 820 kB de fonte) no chunk `ui-components`, que é ansioso:
// a página do mapa baixava as ferramentas militares só para poder DECIDIR se mostra dois itens
// de menu. As operações de verdade (`mergeArrows`, `splitArrows`) já viraram `await import()`
// dentro dos handlers, que é o padrão que este mesmo arquivo já usava para cortar linha.
//
// OS PREDICADOS NÃO PODEM SER ASSÍNCRONOS, e é isso que obriga a cópia: `_addArrowMergeOptions`
// MONTA o menu com eles, não os usa dentro do handler. Um `await` aqui mudaria o instante em que
// o item aparece — o menu abriria sem "Combinar Setas" e o item brotaria depois, sob o cursor.
//
// O GÊMEO DELES vive em `military_tools/arrow_tool/arrow-merge.js`, e há um terceiro em
// `tool_manager/helpers/feature-header.helpers.js`, pelo mesmo motivo e com o mesmo aviso: quem
// mexer num lado mexe nos três. `arrow-merge.test.js` prende o comportamento do original.

/** Pure property check — no heavy imports needed */
function canMergeArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length < 2) {
        return { canMerge: false, reason: 'Selecione pelo menos 2 setas' };
    }
    const allArrows = selectedFeatures.every(f => f.properties?.source === 'arrow');
    if (!allArrows) return { canMerge: false, reason: 'Todas as feições devem ser setas' };
    // `??`, NUNCA `||`: um `layerId` de `0` ou `''` e valor de dominio, e o `||` o trocava por
    // 'default', fazendo setas de CAMADAS DIFERENTES passarem pelo portao de mesma-camada.
    const layerIds = new Set(selectedFeatures.map(f => f.properties?.layerId ?? 'default'));
    if (layerIds.size > 1) return { canMerge: false, reason: 'Setas devem estar na mesma camada' };
    return { canMerge: true };
}

/** Pure property check — no heavy imports needed */
function canSplitArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) return { canSplit: false };
    const f = selectedFeatures[0];
    return {
        canSplit: f.properties?.source === 'arrow' &&
            f.properties?.isMerged === true &&
            Array.isArray(f.properties?.branches) &&
            f.properties.branches.length > 1
    };
}

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
        // The same gesture in SCREEN space. `_lastCoordinates` answers "where on the world",
        // which is what a paste needs; this answers "which pixel", which is what the
        // rendered-features hit-test needs to find the feature under the cursor.
        this._lastPoint = null;
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
        this._lastPoint = [point.x, point.y];

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
            const layerOptionsAdded = await this._addLayerMoveOptions(groupingAnalysis.selectedFeatures);
            const mapOptionsAdded = await this._addMapMoveOptions(groupingAnalysis.selectedFeatures);

            // Only add separator if something was actually added
            if (layerOptionsAdded || mapOptionsAdded) {
                const separator = this._createSeparator();
                this._contextMenu.appendChild(separator);
            }
        }

        this._addDefaultOptions(groupingAnalysis.selectedFeatures);
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
            const { mergeArrows } = await import('@js/military_tools/arrow_tool/arrow-merge.js');
            await mergeArrows(features, this._map, this._selectionManager);
        } catch (error) {
            console.error('Error merging arrows:', error);
            showError('Erro ao combinar setas');
        }
    }

    async _handleSplitArrows(mergedFeature) {
        try {
            const { splitArrows } = await import('@js/military_tools/arrow_tool/arrow-merge.js');
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
                if (!this._map.getSource(storageType)) continue;
                // A single-property change on one feature, queued: these sources are
                // dispatcher-owned, so the read-modify-write that used to live here replaced
                // MapLibre's pending-update slot and dropped whatever diff a tool had queued.
                getGeoJsonDispatcher(this._map, storageType)
                    .patch(feature.properties.id, { setProps: { layerId: targetLayerId } });
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

    /**
     * @param {Array<Object>} [selectedFeatures] - The selection this build was analysed with.
     *   Passed in rather than re-read so the whole menu describes ONE instant.
     * @private
     */
    _addDefaultOptions(selectedFeatures = null) {
        const selection = selectedFeatures ?? this._selectionManager?.getAllSelectedFeatures() ?? [];
        const hasSelected = selection.length > 0;
        const locked = isCurrentMapLockedSync();

        // ONE decision for every command that writes through the clipboard, taken by a pure
        // table (`clipboard-menu-actions.js`) so it is testable in node and so "Duplicar
        // Seleção" cannot drift away from "Colar Aqui": both are a copy followed by a paste,
        // and until 2026-09-01 Duplicar was offered to a Leitor, wrote nothing, and toasted
        // success anyway.
        const commands = clipboardMenuActions({
            can: (key) => checkPermission(key).allowed,
            locked,
            selectedCount: selection.length,
            hasFeatureUnderCursor: !!this._findCopiableHitUnderCursor(selection),
            clipboardCount: this._clipboardCount()
        });
        const commandById = new Map(commands.map((c) => [c.id, c]));

        if (hasSelected) {
            const zoomItem = this._createMenuItem(
                'Zoom para Seleção',
                () => this._handleZoomToSelection()
            );
            this._contextMenu.appendChild(zoomItem);

            // Duplicar keeps its historical slot even though its decision now comes from the
            // clipboard table: it acts on the SELECTION, so it belongs next to the other
            // selection commands rather than in the copy/paste block below.
            this._appendClipboardCommand(commandById.get(ClipboardMenuAction.DUPLICATE_SELECTION));

            const separator = this._createSeparator();
            this._contextMenu.appendChild(separator);
        }

        if (this._addClipboardOptions(commandById, selection)) {
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

    /**
     * An INERT row: the command exists but has nothing to act on right now (two features in
     * different layers, a map already facing north). It carries no click, so assistive tech
     * has to be told it is refused, and the tooltip is where the reason lives.
     * @param {string} text
     * @param {string} tooltip
     * @returns {HTMLElement}
     * @private
     */
    _createDisabledMenuItem(text, tooltip) {
        const item = document.createElement('div');
        item.className = 'context-menu-item disabled';
        item.textContent = text;
        item.title = tooltip;
        item.setAttribute('aria-disabled', 'true');
        return item;
    }

    /**
     * A row blocked by the map's STATE, which is a different animal from the inert one above
     * and must NOT reuse it: the state is reversible, the person right-clicking may be the
     * very owner who can reverse it, and the CLICK is how the reason reaches them. So this
     * one keeps its listener and answers with the sentence.
     *
     * `aria-disabled`, never the `disabled` property - a disabled control fires no click, and
     * the click is the carrier. (`div` has no `disabled` property anyway, which is exactly
     * how this rule gets broken by accident the day someone turns the row into a `button`.)
     *
     * @param {string} text - The label, drawn in full.
     * @param {string} notice - The sentence naming the state.
     * @returns {HTMLElement}
     * @private
     */
    _createBlockedMenuItem(text, notice) {
        const item = document.createElement('div');
        item.className = 'context-menu-item context-menu-item--blocked';
        item.textContent = text;
        item.title = notice;
        item.setAttribute('aria-disabled', 'true');

        item.addEventListener('click', (e) => {
            e.stopPropagation();
            showWarning(notice);
            this._hideMenu();
        });

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

    // =========================================================================
    // CLIPBOARD BLOCK
    // =========================================================================

    /**
     * The copy/paste rows, appended between the selection commands and "Copiar Coordenadas".
     *
     * BUILDING THIS IS SYNCHRONOUS ON PURPOSE. Deciding whether "Copiar Feição" appears needs
     * only the rendered-features hit-test, which is synchronous; the COMPLETE feature (the one
     * with the full geometry) is read inside the row's own click handler. Doing it the other
     * way would make every ordinary right-click wait for a source round-trip before the menu
     * appears, for the sake of a row most right-clicks do not use.
     *
     * @param {Map<string, {id: string, count: number|null, blocked: string|null}>} commandById
     * @param {Array<Object>} selection
     * @returns {boolean} True when at least one row was added.
     * @private
     */
    _addClipboardOptions(commandById, selection) {
        const copySelection = commandById.get(ClipboardMenuAction.COPY_SELECTION);
        const copyUnderCursor = commandById.get(ClipboardMenuAction.COPY_UNDER_CURSOR);
        const pasteHere = commandById.get(ClipboardMenuAction.PASTE_HERE);

        let added = false;
        added = this._appendClipboardCommand(copySelection, selection) || added;
        added = this._appendClipboardCommand(copyUnderCursor, selection) || added;
        added = this._appendClipboardCommand(pasteHere, selection) || added;
        return added;
    }

    /**
     * Renders ONE decision from `clipboardMenuActions`. A command the table left out is
     * simply absent (rank), one it marked `blocked` is drawn and refuses the click (state).
     * @param {{id: string, count: number|null, blocked: string|null}|undefined} command
     * @param {Array<Object>} [selection]
     * @returns {boolean} Whether a row was appended.
     * @private
     */
    _appendClipboardCommand(command, selection = []) {
        if (!command) return false;

        const LABELS = {
            [ClipboardMenuAction.DUPLICATE_SELECTION]: () => 'Duplicar Seleção',
            [ClipboardMenuAction.COPY_SELECTION]: (n) => `Copiar Feições (${n})`,
            [ClipboardMenuAction.COPY_UNDER_CURSOR]: () => 'Copiar Feição',
            [ClipboardMenuAction.PASTE_HERE]: (n) => `Colar Aqui (${n})`
        };
        const HANDLERS = {
            [ClipboardMenuAction.DUPLICATE_SELECTION]: () => this._handleDuplicateSelected(),
            [ClipboardMenuAction.COPY_SELECTION]: () => this._handleCopySelection(),
            [ClipboardMenuAction.COPY_UNDER_CURSOR]: () => this._handleCopyUnderCursor(
                this._findCopiableHitUnderCursor(selection)
            ),
            [ClipboardMenuAction.PASTE_HERE]: () => this._handlePasteHere()
        };

        const label = LABELS[command.id](command.count);

        this._contextMenu.appendChild(
            command.blocked
                ? this._createBlockedMenuItem(label, command.blocked)
                : this._createMenuItem(label, HANDLERS[command.id])
        );
        return true;
    }

    /** @returns {number} How many features the clipboard holds. @private */
    _clipboardCount() {
        const clipboardManager = getControl('ClipboardManager');
        return clipboardManager?.clipboard?.features?.length ?? 0;
    }

    /**
     * A reference to the topmost COPIABLE feature under the gesture, from the synchronous
     * rendered-features hit-test. It never changes the selection and never reads the source:
     * only `{toolType, id}` is kept.
     *
     * The hit-test already skips a feature that is locked or on a hidden layer
     * (`getAllClickedCustomFeatures`), which is the behaviour we want and is worth naming:
     * "Copiar Feição" will not appear over a feature the person cannot even select, so it
     * never promises a copy of something invisible.
     *
     * THE ONLY THING ASKED ABOUT THE TYPE IS `isUncopyableFeatureType`, and asking anything
     * more is what this used to get wrong. The gate was `filterCopiableFeatures([target])`,
     * which is SYNCHRONOUS and looks the tool up in `selectionManager.controls`: a tool that
     * has not been loaded yet is not in that map, so the filter fell through to a
     * `console.warn` and returned false. Only six controls are eager, so a right click over a
     * circle, a rectangle, a sector, an arrow, a boundary or a military symbol offered no
     * "Copiar Feição" at all, and said nothing about why - and it came back a click later,
     * once something else had loaded the tool, which reads as a broken menu rather than a
     * rule.
     *
     * The tool's own `canCopy` is not skipped, only DEFERRED to where it can be awaited:
     * `_handleCopyUnderCursor` calls `copy([complete])`, which runs `ensureControlsFor`
     * BEFORE `filterCopiableFeatures`, so the real control answers for itself. A type that
     * genuinely refuses there produces the toast `copy()` already owns.
     *
     * @param {Array<Object>} selection - Current selection; a non-empty one makes the cursor
     *   irrelevant, and skipping the hit-test then also skips a `queryRenderedFeatures`.
     * @returns {{toolType: string, id: string}|null}
     * @private
     */
    _findCopiableHitUnderCursor(selection) {
        if (selection.length > 0) return null;
        if (!this._lastPoint || !this._selectionManager) return null;

        if (!getControl('ClipboardManager')) return null;

        const target = this._selectionManager.getClickedCustomFeature(this._lastPoint);
        if (!target?.properties?.id) return null;

        // `toolType` and the rendered feature's own `properties.source` are the same string:
        // it is what the hit-test matched on.
        if (isUncopyableFeatureType(target.toolType)) return null;

        return { toolType: target.toolType, id: target.properties.id };
    }

    /** @private */
    async _handleCopySelection() {
        try {
            const clipboardManager = getControl('ClipboardManager');
            if (!clipboardManager) {
                showWarning('Área de transferência não disponível');
                return;
            }

            const count = await clipboardManager.copy();
            if (count > 0) showSuccess(`${count} feição(ões) copiada(s)`);
        } catch (error) {
            console.error('Error copying selection:', error);
            showError('Erro ao copiar feições');
        }
    }

    /**
     * Copies the feature the menu was opened over, WITHOUT selecting it: selecting would open
     * the attributes panel behind the menu and replace whatever the person had chosen before.
     *
     * The complete geometry is read HERE and not while the menu was being built, so the right
     * click itself never waits for it.
     * @param {{toolType: string, id: string}|null} hit
     * @private
     */
    async _handleCopyUnderCursor(hit) {
        try {
            if (!hit) {
                showWarning('Nenhuma feição sob o cursor');
                return;
            }

            const clipboardManager = getControl('ClipboardManager');
            if (!clipboardManager) {
                showWarning('Área de transferência não disponível');
                return;
            }

            const complete = await this._selectionManager?.getCompleteFeatureFromSource(
                hit.toolType,
                hit.id
            );
            if (!complete) {
                showWarning('Não foi possível ler a feição para copiar');
                return;
            }

            const count = await clipboardManager.copy([complete]);
            if (count > 0) showSuccess(`${count} feição(ões) copiada(s)`);
        } catch (error) {
            console.error('Error copying feature under cursor:', error);
            showError('Erro ao copiar feição');
        }
    }

    /**
     * Pastes so that the CENTRE of the copied set's bounding box lands on the clicked
     * position. No toast of our own on failure: `paste()` owns every refusal and has already
     * said which one it was.
     * @private
     */
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

            await clipboardManager.copy();
            await clipboardManager.paste();
        } catch (error) {
            console.error('Error duplicating features:', error);
            showError('Erro ao duplicar feições');
        }
    }

    /**
     * ANTIMERIDIAN: the longitude span comes from `antimeridianSafeLngSpan`, not from
     * min/max. A selection straddling the date line used to produce west -179 / east 179,
     * i.e. the box of the whole world mirrored, so this command framed everything EXCEPT
     * what was selected and zoomed out until the planet fit. The fix arrived for free with
     * the promotion of that helper out of `terrain/data-layers.manager.js`, which had the
     * identical bug and had already paid for it.
     * @private
     */
    _handleZoomToSelection() {
        const selectedFeatures = this._selectionManager.getAllSelectedFeatures();
        if (selectedFeatures.length === 0) return;

        const lngs = [];
        let minY = Infinity, maxY = -Infinity;

        for (const feature of selectedFeatures) {
            for (const [x, y] of flattenPositions(feature.geometry)) {
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                lngs.push(x);
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }

        if (lngs.length === 0) return;

        const [west, east] = antimeridianSafeLngSpan(lngs);

        fitBounds(this._map, [[west, minY], [east, maxY]], {
            duration: ANIMATION_DURATION.FAST,
            padding: 80
        });
    }

    async _onRightClick(e) {
        e.preventDefault();

        if (this._toolManager && this._toolManager.hasActiveTool()) {
            return;
        }

        const coordinates = this._map.unproject([e.offsetX, e.offsetY]);
        this._lastCoordinates = { lat: coordinates.lat, lng: coordinates.lng };
        // The SAME pair `unproject` was just given, so the hit-test and the paste target
        // cannot disagree about which pixel the gesture was on.
        this._lastPoint = [e.offsetX, e.offsetY];

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
