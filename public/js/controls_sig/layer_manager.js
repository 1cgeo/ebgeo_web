// Path: js\controls_sig\layer_manager.js
import { memoryStore, setMapLayers, getMapLayers } from './store/repository.js';
import { IDUtils } from './id_utils.js';

/**
 * Gerenciador central de camadas (layers)
 * Segue o mesmo padrão do GroupManager:
 * - Cache em memória para consultas síncronas
 * - Persistência assíncrona no IndexedDB
 * - Eventos para notificar mudanças
 */
export class LayerManager {
    constructor() {
        this.memoryStore = memoryStore;
    }

    // ===== OPERAÇÕES PRINCIPAIS =====

    /**
     * Cria uma nova camada
     * @param {string} name - Nome da camada
     * @param {string} mapName - Nome do mapa (null = mapa atual)
     * @returns {Object} Camada criada
     */
    createLayer(name, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layerId = IDUtils.generateUniqueId();
        const order = this._getNextLayerOrder(targetMap);
        
        const newLayer = {
            id: layerId,
            name: name || 'Nova Camada',
            visible: true,
            locked: false,
            order: order,
            createdAt: Date.now()
        };

        this.memoryStore.layers[targetMap][layerId] = newLayer;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return newLayer;
    }

    /**
     * Deleta uma camada em cascata
     * - Deleta todas as features da camada
     * - Remove features dos grupos (grupos com <2 features são deletados)
     * @param {string} layerId - ID da camada a deletar
     * @param {string} mapName - Nome do mapa
     * @returns {Object} Informações sobre a deleção
     */
    deleteLayer(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layers = this.memoryStore.layers[targetMap];
        
        if (!layers[layerId]) {
            throw new Error(`Camada ${layerId} não encontrada.`);
        }

        const layerCount = Object.keys(layers).length;
        if (layerCount <= 1) {
            throw new Error('Não é possível deletar a última camada.');
        }

        if (this.memoryStore.activeLayerId === layerId) {
            const otherLayers = Object.values(layers).filter(l => l.id !== layerId && !l.locked);
            if (otherLayers.length > 0) {
                this.setActiveLayer(otherLayers[0].id, targetMap);
            } else {
                const anyOther = Object.values(layers).find(l => l.id !== layerId);
                if (anyOther) {
                    anyOther.locked = false;
                    this.setActiveLayer(anyOther.id, targetMap);
                }
            }
        }

        delete layers[layerId];
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return { success: true, deletedLayerId: layerId };
    }

    /**
     * Renomeia uma camada
     * @param {string} layerId - ID da camada
     * @param {string} newName - Novo nome
     * @param {string} mapName - Nome do mapa
     */
    renameLayer(layerId, newName, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Camada ${layerId} não encontrada.`);
        }

        layer.name = newName;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    // ===== VISIBILIDADE E LOCK =====

    /**
     * Define visibilidade da camada
     */
    setLayerVisibility(layerId, visible, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Camada ${layerId} não encontrada.`);
        }

        layer.visible = visible;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    /**
     * Define bloqueio da camada
     * @throws {Error} Se tentar bloquear a camada ativa
     */
    setLayerLocked(layerId, locked, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        if (locked && this.memoryStore.activeLayerId === layerId) {
            throw new Error('Não é possível bloquear a camada ativa.');
        }

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Camada ${layerId} não encontrada.`);
        }

        layer.locked = locked;
        this._saveLayersToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    // ===== CAMADA ATIVA =====

    /**
     * Define a camada ativa
     * @throws {Error} Se a camada está bloqueada
     */
    setActiveLayer(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const layer = this.memoryStore.layers[targetMap][layerId];
        if (!layer) {
            throw new Error(`Camada ${layerId} não encontrada.`);
        }

        if (layer.locked) {
            throw new Error('Não é possível ativar uma camada bloqueada.');
        }

        this.memoryStore.activeLayerId = layerId;
        this._saveActiveLayerToDBAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    /**
     * Retorna ID da camada ativa (síncrono)
     */
    getActiveLayerIdSync() {
        return this.memoryStore.activeLayerId || 'default';
    }

    /**
     * Retorna a camada ativa
     */
    getActiveLayer(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);

        const activeId = this.memoryStore.activeLayerId || 'default';
        return this.memoryStore.layers[targetMap][activeId] || null;
    }

    // ===== CONSULTAS SÍNCRONAS =====

    /**
     * Retorna todas as camadas de um mapa (ordenadas)
     */
    getLayers(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        
        const layers = this.memoryStore.layers[targetMap];
        return Object.values(layers).sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Retorna camadas como objeto (para acesso por ID)
     */
    getLayersObject(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        return this.memoryStore.layers[targetMap];
    }

    /**
     * Retorna camada por ID
     */
    getLayerById(layerId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(targetMap);
        return this.memoryStore.layers[targetMap][layerId] || null;
    }

    /**
     * Retorna IDs das camadas visíveis
     */
    getVisibleLayerIds(mapName = null) {
        const layers = this.getLayers(mapName);
        return layers.filter(l => l.visible).map(l => l.id);
    }

    /**
     * Retorna IDs das camadas desbloqueadas
     */
    getUnlockedLayerIds(mapName = null) {
        const layers = this.getLayers(mapName);
        return layers.filter(l => !l.locked).map(l => l.id);
    }

    // ===== VERIFICAÇÕES DE ESTADO =====

    /**
     * Verifica se uma feature é efetivamente visível (considerando layer)
     */
    isFeatureEffectivelyVisible(feature, mapName = null) {
        const layerId = feature.properties?.layerId || 'default';
        const layer = this.getLayerById(layerId, mapName);
        return layer?.visible ?? true;
    }

    /**
     * Verifica se uma feature é efetivamente bloqueada (layer OR feature)
     */
    isFeatureEffectivelyLocked(feature, mapName = null) {
        const layerId = feature.properties?.layerId || 'default';
        const layer = this.getLayerById(layerId, mapName);
        const layerLocked = layer?.locked ?? false;
        const featureLocked = feature.properties?.bloqueado ?? false;
        return layerLocked || featureLocked;
    }

    // ===== PERSISTÊNCIA =====

    /**
     * Carrega layers do IndexedDB para o cache em memória
     */
    async loadLayersToMemory(mapName) {
        try {
            const layersData = await getMapLayers(mapName);
            
            if (!layersData || Object.keys(layersData).length === 0) {
                this.memoryStore.layers[mapName] = {
                    'default': {
                        id: 'default',
                        name: 'Padrão',
                        visible: true,
                        locked: false,
                        order: 0,
                        createdAt: Date.now()
                    }
                };
                this.memoryStore.activeLayerId = 'default';
            } else {
                this.memoryStore.layers[mapName] = layersData.layers || layersData;
                this.memoryStore.activeLayerId = layersData.activeLayerId || 'default';
            }
            
        } catch (error) {
            console.warn(`Erro ao carregar layers do mapa ${mapName}:`, error);
            this._ensureMapLayersExist(mapName);
        }
    }

    /**
     * Duplica layers de um mapa para outro
     */
    async duplicateMapLayers(sourceMapName, targetMapName, idMapping = new Map()) {
        try {
            const sourceLayers = await getMapLayers(sourceMapName);
            
            if (!sourceLayers || Object.keys(sourceLayers).length === 0) {
                return;
            }

            const duplicatedLayers = {};
            let activeLayerId = 'default';

            Object.values(sourceLayers.layers || sourceLayers).forEach(layer => {
                const newLayerId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId();
                duplicatedLayers[newLayerId] = {
                    ...layer,
                    id: newLayerId,
                    createdAt: Date.now()
                };
                idMapping.set(layer.id, newLayerId);
                
                if ((sourceLayers.activeLayerId || 'default') === layer.id) {
                    activeLayerId = newLayerId;
                }
            });

            await setMapLayers(targetMapName, {
                layers: duplicatedLayers,
                activeLayerId: activeLayerId
            });

            if (targetMapName === this.memoryStore.currentMap) {
                this.memoryStore.layers[targetMapName] = duplicatedLayers;
                this.memoryStore.activeLayerId = activeLayerId;
            }

            return idMapping;
        } catch (error) {
            console.error(`Erro ao duplicar layers de ${sourceMapName} para ${targetMapName}:`, error);
        }
    }

    /**
     * Remove todos os layers de um mapa
     */
    async clearMapLayers(mapName) {
        try {
            await setMapLayers(mapName, {});
            if (this.memoryStore.layers[mapName]) {
                delete this.memoryStore.layers[mapName];
            }
        } catch (error) {
            console.error(`Erro ao limpar layers do mapa ${mapName}:`, error);
        }
    }

    // ===== MÉTODOS PRIVADOS =====

    _notifyLayersChanged() {
        document.dispatchEvent(new CustomEvent('layers-changed'));
    }

    _ensureMapLayersExist(mapName) {
        if (!this.memoryStore.layers) {
            this.memoryStore.layers = {};
        }
        if (!this.memoryStore.layers[mapName]) {
            this.memoryStore.layers[mapName] = {
                'default': {
                    id: 'default',
                    name: 'Padrão',
                    visible: true,
                    locked: false,
                    order: 0,
                    createdAt: Date.now()
                }
            };
        }
        if (!this.memoryStore.activeLayerId) {
            this.memoryStore.activeLayerId = 'default';
        }
    }

    _getNextLayerOrder(mapName) {
        const layers = this.memoryStore.layers[mapName];
        const maxOrder = Math.max(0, ...Object.values(layers).map(l => l.order || 0));
        return maxOrder + 1;
    }

    _saveLayersToDBAsync(mapName) {
        setTimeout(async () => {
            try {
                const layersData = this.memoryStore.layers[mapName];
                await setMapLayers(mapName, {
                    layers: layersData,
                    activeLayerId: this.memoryStore.activeLayerId
                });
            } catch (error) {
                console.error(`Erro ao salvar layers do mapa ${mapName}:`, error);
            }
        }, 0);
    }

    _saveActiveLayerToDBAsync(mapName) {
        this._saveLayersToDBAsync(mapName);
    }
}

// Singleton instance
const layerManagerInstance = new LayerManager();

export default layerManagerInstance;