// Path: js/map/map.manager.js
import {
    addMap,
    addFeature,
    removeMap,
    renameMap,
    setCurrentMap,
    saveMapView,
    getMapTemporalConfig,
    setMapTemporalConfig,
    isMapTemporalEnabledSync,
    hasMapSavedPosition,
    clearMapView,
    getAllMapNamesStore,
    getCurrentMapName,
    moveFeaturesToMap,
    clearAllDataStore,
    getMapDataStore,
    getColorUsage,
    getMapNotes,
    setMapOrder,
    getLayerManager,
    getLayersRepo,
    getGroupManager,
    getCesium3dDataForExport,
    setCesium3dDataForImport,
    getStreetview360DataForExport,
    setStreetview360DataForImport,
    getEmptyCesium3dData,
    isMapLocked
} from '../store';

import { IDUtils } from '../utilities';
// BY FILE, because it is deliberately off the store barrel: the saved temporal switch has one
// writer by design, and the barrel is where a second one would be found by accident. Duplicating
// a map is the other legitimate caller (see `copyMap`), and it names itself here.
import { setMapTemporalSaved } from '@store/temporal.operations.js';
import { checkPermission, GuardAction } from '../store/sync/permission-guard.js';
import { DEFAULT_MAP_NAME } from '../store/store.constants.js';

const MAP_LIMIT = 100;

class MapManager {
    constructor(baseLayerControl, selectionManager) {
        this.baseLayerControl = baseLayerControl;
        this.selectionManager = selectionManager;
        this.map = null;
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
            if (allMapNames.length >= MAP_LIMIT) {
                return { success: false, message: 'Limite de 100 mapas atingido' };
            }

            const trimmed = mapName.trim();
            await addMap(trimmed);
            await setCurrentMap(trimmed);
            await this._switchBaseLayer();

            return { success: true, message: `Mapa "${mapName}" criado` };
        } catch (error) {
            console.error('Erro ao criar mapa:', error);
            return { success: false, message: 'Erro ao criar mapa' };
        }
    }

    async deleteMap(mapName) {
        try {
            const allMapNames = await getAllMapNamesStore();

            if (allMapNames.length <= 1) {
                return {
                    success: false,
                    message: 'Não é possível deletar o último mapa. O sistema precisa de pelo menos um mapa.'
                };
            }

            const result = await removeMap(mapName);

            // A REFUSAL IS NOT AN ERROR, and collapsing the two stacked a second, generic toast
            // on top of the store's own explanation ("Erro ao deletar mapa" over "Apagar ou
            // combinar mapas exige o nível Gestor"). `removeMap` already returns the distinction
            // as `reason: 'PERMISSION_DENIED'`; it was simply discarded here. The store has
            // already said why, so this branch stays silent rather than guessing a second time.
            if (!result.success) {
                if (result.reason === 'PERMISSION_DENIED') {
                    return { success: false, silent: true, reason: result.reason };
                }
                return { success: false, message: 'Erro ao deletar mapa' };
            }

            if (result.wasCurrentMap) {
                await this._switchBaseLayer();
            }

            const message = result.wasCurrentMap
                ? `Mapa deletado. Você foi redirecionado para "${result.newCurrentMap}"`
                : `Mapa "${mapName}" deletado com sucesso`;

            return { success: true, message, wasCurrentMap: result.wasCurrentMap };
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

            const trimmed = newName.trim();
            // The store REFUSES the rename when the map is locked or permission is missing, and
            // the refusal is not an exception. Switching the current map before checking pointed
            // it at a name that does not exist, which is worse than the false success message.
            // The store REFUSES the rename when the map is locked or permission is missing, and
            // the refusal is not an exception. Switching the current map before checking pointed
            // it at a name that does not exist, which is worse than the false success message.
            const renamed = await renameMap(oldName, trimmed);
            if (!renamed) {
                return { success: false, message: 'Não foi possível renomear o mapa (mapa bloqueado ou sem permissão)' };
            }

            await setCurrentMap(trimmed);

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
            if (allMapNames.length >= MAP_LIMIT) {
                return { success: false, message: 'Limite de 100 mapas atingido' };
            }

            const originalMapData = await getMapDataStore(mapName);
            if (!originalMapData) {
                return { success: false, message: 'Dados do mapa não encontrados' };
            }

            const trimmed = newMapName.trim();
            const originalColorUsage = await getColorUsage(mapName);
            const originalNotes = await getMapNotes(mapName);

            const layerManager = getLayerManager();
            const layerIdMapping = await layerManager.duplicateMapLayers(mapName, trimmed);
            const { newMapData, idMapping } = await IDUtils.regenerateMapIds(originalMapData, trimmed, layerIdMapping);

            await addMap(trimmed, newMapData, originalColorUsage, originalNotes);
            await getGroupManager().duplicateMapGroups(mapName, trimmed, idMapping);

            const [cesium3dData, streetview360Data] = await Promise.all([
                getCesium3dDataForExport(mapName),
                getStreetview360DataForExport(mapName)
            ]);
            if (cesium3dData) await setCesium3dDataForImport(trimmed, cesium3dData);
            if (streetview360Data) await setStreetview360DataForImport(trimmed, streetview360Data);

            await this._copyTemporalConfig(mapName, trimmed);

            await setCurrentMap(trimmed);
            await this._switchBaseLayer();

            return { success: true, message: `Mapa "${mapName}" duplicado como "${newMapName}"` };
        } catch (error) {
            console.error('Erro ao duplicar mapa:', error);
            return { success: false, message: 'Erro ao duplicar mapa: ' + error.message };
        }
    }

    /**
     * Copies the temporal configuration of a map onto a freshly duplicated one.
     *
     * WHY THE DUPLICATE NEEDS IT. The camera and the base layer already travel inside the map
     * DOCUMENT, which `IDUtils.regenerateMapIds` deep-clones, and every copied feature keeps its
     * dates. The temporal config does not: it is a side store keyed by map NAME, so before this
     * the copy was born with the defaults while its features carried a timeline, and a duplicate
     * of a map saved with the timeline ON opened with everything visible at once.
     *
     * THE SAVED SWITCH TRAVELS TOO, and it is the part that needs saying out loud. `ativo` is one
     * third of the SAVED VIEW of a map (`store/map-view.operations.js`), next to the camera and
     * the base layer, and those two are already in the copy; leaving it out would hand the
     * duplicate two thirds of a saved view. It has its own writer by design, because the switch
     * on screen must never leak into the shared document: `setMapTemporalConfig` drops `ativo`
     * from any patch, and `setMapTemporalSaved` is the only door. The value written here is read
     * off the STORED document of the original, never off the screen.
     *
     * A KEY WHOSE VALUE THE COPY ALREADY HAS IS NOT WRITTEN, the same rule as `saveMapView`: in a
     * server atlas each of these writes is a sync op, and an op that rewrites the stored value
     * claims a dispute unit for nothing. The comparison is against the destination rather than
     * against the defaults, so a stray config left under the new name is honoured, not assumed.
     *
     * IT RUNS BEFORE `setCurrentMap`, which is what loads the stored config into the sync cache
     * and pins the on-screen switch of the map being entered: entering the copy then behaves
     * exactly like entering any map that has a saved view.
     *
     * @param {string} sourceMapName - Map being duplicated.
     * @param {string} targetMapName - The duplicate.
     * @returns {Promise<void>}
     * @private
     */
    async _copyTemporalConfig(sourceMapName, targetMapName) {
        const origem = await getMapTemporalConfig(sourceMapName);
        const destino = await getMapTemporalConfig(targetMapName);

        const { ativo, ...ajustes } = origem;
        if (Object.keys(ajustes).some((chave) => ajustes[chave] !== destino[chave])) {
            await setMapTemporalConfig(targetMapName, ajustes);
        }
        if (ativo !== destino.ativo) {
            await setMapTemporalSaved(targetMapName, ativo);
        }
    }

    // ===== POSITION MANAGEMENT =====
    async saveMapPosition(mapName = null) {
        try {
            if (!this.map) return { success: false, message: 'Mapa não disponível' };

            // THE SAVED VIEW IS THREE THINGS, read off the SCREEN of whoever is saving: camera,
            // base layer and temporal switch. The last two are view state of the person since
            // 2026-09-20 and travel only through this gesture (`store/map-view.operations.js`).
            // The base is asked of the control because it is the only one that knows what is
            // drawn after a fallback took over.
            const center = this.map.getCenter();
            await saveMapView({
                center_lat: center.lat,
                center_long: center.lng,
                zoom: this.map.getZoom(),
                bearing: this.map.getBearing(),
                pitch: this.map.getPitch(),
                baseLayer: this.baseLayerControl?.currentLayer ?? null,
                temporalEnabled: isMapTemporalEnabledSync(),
            });

            const resolvedName = mapName || await getCurrentMapName();
            const hadSavedPosition = await hasMapSavedPosition(resolvedName);
            const verb = hadSavedPosition ? 'atualizada' : 'salva';

            return { success: true, message: `Vista ${verb} para ${resolvedName}: posição, mapa base e controle temporal` };
        } catch (error) {
            console.error('Erro ao salvar posição:', error);
            return { success: false, message: 'Erro ao salvar posição' };
        }
    }

    async clearMapPosition(mapName) {
        try {
            // THE WHOLE SAVED VIEW, not only the camera (owner, 2026-09-21): the base layer and the
            // temporal switch saved with it leave in the same batch. A refusal (level, map lock)
            // already spoke through STORE_OPERATION_BLOCKED, so it must not be reported as done.
            const cleared = await clearMapView(mapName);
            if (!cleared) return { success: false, message: `A posição salva de "${mapName}" não foi removida` };
            return { success: true, message: `Posição salva removida de "${mapName}", com o mapa base e o controle temporal salvos` };
        } catch (error) {
            console.error('Erro ao limpar posição:', error);
            return { success: false, message: 'Erro ao limpar posição salva' };
        }
    }

    // ===== MAP COMBINATION =====
    async combineSelectedMapsIntoTarget(selectedMapNames, targetMapName) {
        // Combining is a MANAGEMENT action, gated like deleting a map, and the server
        // agrees: POST /maps/:id/merge requires 'manage'. Except the server route is
        // never called — this client combines locally and syncs the result as ordinary
        // feature ops — so without this check the whole gate was unreachable and an
        // Editor could still empty other people's maps under CREATE_FEATURE.
        //
        // It belongs here rather than in the tab: this method is the single choke
        // point for the operation, and a UI-only guard is bypassed by any other caller.
        const perm = checkPermission(GuardAction.COMBINE_MAPS);
        if (!perm.allowed) {
            throw new Error(perm.reason);
        }

        // The tab filters LOCKED maps out of the source list but never checks the
        // TARGET, so a locked map could still receive everything — the one thing the
        // lock exists to prevent. The sync path refuses child writes on a locked map
        // and the merge route answers 409; this is the same rule, applied where the
        // operation actually happens.
        if (await isMapLocked(targetMapName)) {
            throw new Error(`O mapa "${targetMapName}" está bloqueado. Desbloqueie antes de combinar.`);
        }

        const originalCurrentMap = await getCurrentMapName();
        const idMappings = {};

        try {
            let totalFeatures = 0;
            const layerManager = getLayerManager();
            const combinedCesium3d = getEmptyCesium3dData();

            for (const mapName of selectedMapNames) {
                const mapData = await getMapDataStore(mapName);
                if (!mapData?.features) continue;

                await setCurrentMap(targetMapName);

                const layerIdMapping = await this._mergeLayersFromMap(layerManager, mapName, targetMapName);
                const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, targetMapName, layerIdMapping);
                idMappings[mapName] = idMapping;

                for (const [featureType, features] of Object.entries(newMapData.features)) {
                    if (!Array.isArray(features)) continue;
                    for (const feature of features) {
                        await addFeature(featureType, feature);
                        totalFeatures++;
                    }
                }

                // 360: setStreetview360DataForImport merges automatically
                const sv360Data = await getStreetview360DataForExport(mapName);
                if (sv360Data) await setStreetview360DataForImport(targetMapName, sv360Data);

                // 3D: accumulate for manual merge (setCesium3dDataForImport overwrites)
                const c3dData = await getCesium3dDataForExport(mapName);
                if (c3dData) {
                    combinedCesium3d.markers.push(...(c3dData.markers || []));
                    combinedCesium3d.measurements.push(...(c3dData.measurements || []));
                    combinedCesium3d.viewsheds.push(...(c3dData.viewsheds || []));
                    Object.assign(combinedCesium3d.cameraPositions, c3dData.cameraPositions || {});
                }
            }

            // Save accumulated 3D data once
            const hasCesium3d = combinedCesium3d.markers.length
                || combinedCesium3d.measurements.length
                || combinedCesium3d.viewsheds.length
                || Object.keys(combinedCesium3d.cameraPositions).length;
            if (hasCesium3d) await setCesium3dDataForImport(targetMapName, combinedCesium3d);

            try {
                await getGroupManager().combineMapGroups(selectedMapNames, targetMapName, idMappings);
            } catch (groupError) {
                console.warn('Error combining groups:', groupError);
            }

            if (originalCurrentMap === targetMapName) {
                await this._switchBaseLayer(false);
            }

            return { success: true, totalFeatures };
        } finally {
            await setCurrentMap(originalCurrentMap);
        }
    }

    /**
     * Merge layers from source map to target map.
     * Reuses existing layers with matching names; creates new ones otherwise.
     * @param {Object} layerManager - Layer manager instance
     * @param {string} sourceMapName - Source map name
     * @param {string} targetMapName - Target map name
     * @returns {Map} Mapping of oldLayerId -> newLayerId
     */
    async _mergeLayersFromMap(layerManager, sourceMapName, targetMapName) {
        const layerIdMapping = new Map();

        try {
            const sourceLayers = await getLayersRepo(sourceMapName);
            const targetLayers = await getLayersRepo(targetMapName);

            const targetLayersByName = new Map();
            for (const layer of targetLayers) {
                targetLayersByName.set(layer.name, layer.id);
            }

            for (const sourceLayer of sourceLayers) {
                const existingLayerId = targetLayersByName.get(sourceLayer.name);

                if (existingLayerId) {
                    layerIdMapping.set(sourceLayer.id, existingLayerId);
                } else {
                    // `createLayerForImport` e ASSINCRONA desde 2026-09-13 (write-ahead): sem o
                    // `await`, `newLayer.id` viria `undefined` e o mapeamento apontaria as
                    // feicoes do mapa mesclado para uma camada que nao existe.
                    const newLayer = await layerManager.createLayerForImport(sourceLayer.name, targetMapName);
                    layerIdMapping.set(sourceLayer.id, newLayer.id);
                    targetLayersByName.set(newLayer.name, newLayer.id);
                }
            }

            if (!layerIdMapping.has('default')) {
                layerIdMapping.set('default', 'default');
            }
        } catch (error) {
            console.warn('Error merging layers:', error);
            layerIdMapping.set('default', 'default');
        }

        return layerIdMapping;
    }

    // ===== FEATURE MOVEMENT =====
    async moveFeaturesToMap(features, targetMapName) {
        try {
            const currentMapName = await getCurrentMapName();

            if (currentMapName === targetMapName) {
                return { success: false, message: 'As feições já estão neste mapa' };
            }

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

            await this._switchBaseLayer(false);

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
     * Checks which features are part of groups.
     * @param {Array} features - Features to check
     * @returns {Array} Array with information about grouped features
     */
    getGroupedFeatures(features) {
        const groupManager = getGroupManager();
        const grouped = [];

        for (const feature of features) {
            const group = groupManager.getFeatureGroup(
                feature.properties.source,
                feature.properties.id
            );

            if (group) {
                grouped.push({
                    featureId: feature.properties.id,
                    featureType: feature.properties.source,
                    groupId: group.id,
                    groupName: group.name
                });
            }
        }

        return grouped;
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

            await setCurrentMap(DEFAULT_MAP_NAME);
            await this._switchBaseLayer();

            return { success: true, message: 'Todos os dados foram apagados' };
        } catch (error) {
            console.error('Erro ao limpar dados:', error);
            return { success: false, message: 'Erro ao limpar dados' };
        }
    }

    // ===== VALIDATION =====
    validateMapName(name) {
        const trimmed = name?.trim();
        return Boolean(trimmed) && trimmed.length <= 50;
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Switches the base layer control if available.
     * @param {boolean} [animate] - Whether to animate the transition
     */
    async _switchBaseLayer(animate) {
        if (this.baseLayerControl) {
            await this.baseLayerControl.switchMap(animate);
        }
    }
}

export default MapManager;
