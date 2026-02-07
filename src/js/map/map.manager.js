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

            const _isCurrentMap = mapName === currentMapName;
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
            await setCurrentMap(newName.trim());

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

            // Duplicate layers first to get the layer ID mapping
            const layerManager = getLayerManager();
            const layerIdMapping = await layerManager.duplicateMapLayers(mapName, newMapName.trim());

            // Regenerate map IDs with layer ID mapping to update feature layerIds
            const { newMapData, idMapping } = await IDUtils.regenerateMapIds(originalMapData, newMapName.trim(), layerIdMapping);

            // Pass colors and notes to optimize and preserve data
            await addMap(newMapName.trim(), newMapData, originalColorUsage, originalNotes);

            // Duplicate groups from original map with feature ID mapping
            await getGroupManager().duplicateMapGroups(mapName, newMapName.trim(), idMapping);

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
            const layerManager = getLayerManager();

            for (const mapName of selectedMapNames) {
                const mapData = await getMapDataStore(mapName);
                if (mapData && mapData.features) {
                    // Set context to target map
                    setCurrentMap(targetMapName);

                    // Merge layers from source map to target map and get mapping
                    const layerIdMapping = await this._mergeLayersFromMap(layerManager, mapName, targetMapName);

                    // Use regenerateMapIds with layer mapping to update feature layerIds
                    const { newMapData, idMapping } = await IDUtils.regenerateMapIds(mapData, targetMapName, layerIdMapping);
                    idMappings[mapName] = idMapping;

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
                await getGroupManager().combineMapGroups(selectedMapNames, targetMapName, idMappings);
            } catch (groupError) {
                console.warn('Error combining groups:', groupError);
                // Continue even if there's an error with groups
            }

            if (originalCurrentMap === targetMapName && this.baseLayerControl) {
                await this.baseLayerControl.switchMap(false);
            }

            return { success: true, totalFeatures };
        } finally {
            // Always ensure context restoration
            setCurrentMap(originalCurrentMap);
        }
    }

    /**
     * Merge layers from source map to target map
     * If a layer with the same name exists in target, reuse it
     * Otherwise, create a new layer in target
     * @param {Object} layerManager - Layer manager instance
     * @param {string} sourceMapName - Source map name
     * @param {string} targetMapName - Target map name
     * @returns {Map} Mapping of oldLayerId -> newLayerId
     */
    async _mergeLayersFromMap(layerManager, sourceMapName, targetMapName) {
        const layerIdMapping = new Map();

        try {
            // Load source map layers from repository
            const sourceLayers = await getLayersRepo(sourceMapName);
            const targetLayers = layerManager.getLayers(targetMapName);

            // Create a map of target layer names to IDs
            const targetLayersByName = new Map();
            for (const layer of targetLayers) {
                targetLayersByName.set(layer.name, layer.id);
            }

            // For each source layer, find or create matching layer in target
            for (const sourceLayer of sourceLayers) {
                const existingLayerId = targetLayersByName.get(sourceLayer.name);

                if (existingLayerId) {
                    // Layer with same name exists, reuse it
                    layerIdMapping.set(sourceLayer.id, existingLayerId);
                } else {
                    // Create new layer in target
                    const newLayer = layerManager.createLayerForImport(sourceLayer.name, targetMapName);
                    layerIdMapping.set(sourceLayer.id, newLayer.id);
                    targetLayersByName.set(newLayer.name, newLayer.id);
                }
            }

            // Default layer mapping - if source has 'default', map to target's 'default'
            if (!layerIdMapping.has('default')) {
                layerIdMapping.set('default', 'default');
            }
        } catch (error) {
            console.warn('Error merging layers:', error);
            // Fallback: map everything to 'default'
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
            const group = getGroupManager().getFeatureGroup(
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

}

export default MapManager;
