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
    setMapOrder,
    getLayerManager,
    getLayersRepo,
    getGroupManager
} from '../store';

import { IDUtils } from '../utilities';
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

            if (!result.success) {
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
            await renameMap(oldName, trimmed);
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

            await setCurrentMap(trimmed);
            await this._switchBaseLayer();

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
            await updateMapPosition(center.lat, center.lng, this.map.getZoom(), this.map.getBearing(), this.map.getPitch());

            const resolvedName = mapName || await getCurrentMapName();
            const hadSavedPosition = await hasMapSavedPosition(resolvedName);
            const verb = hadSavedPosition ? 'atualizada' : 'salva';

            return { success: true, message: `Posição ${verb} para ${resolvedName}` };
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
            const layerManager = getLayerManager();

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
            }

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
                    const newLayer = layerManager.createLayerForImport(sourceLayer.name, targetMapName);
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
