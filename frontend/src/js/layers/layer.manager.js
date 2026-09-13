// Path: js/layers/layer.manager.js

import {
    memoryStore,
    setLayersRepo,
    getLayersRepo,
    setActiveLayerIdRepo,
    getActiveLayerIdRepo,
    getDefaultLayer,
    StoreErrorEvents,
    emitStoreError
} from '../store';
import { IDUtils } from '../utilities';
import { DebouncedPersist } from '../utilities/debounced-persist.js';
import { EventTypes } from '../events';
import { logLayerOperation } from '../store/sync/index.js';
// The leaf module, never the `sync/index.js` barrel: several store suites replace that barrel
// with a partial double that has no `EntityType`, so reaching for it there breaks them at load.
import { EntityType, OperationType } from '../store/sync/operation-types.js';
import { runTransaction } from '../store/store-transaction.js';
import { withSideDocument } from '../store/document-lock.js';
import { mapResolver } from '../store/services/map-resolver.service.js';
import { getActiveScope } from '../store/atlas-namespace.js';

/**
 * Create a DebouncedPersist with standard error handling.
 * @param {string} label - Human-readable label for error messages
 * @returns {DebouncedPersist}
 */
function createPersist(label) {
    return new DebouncedPersist({
        delay: 300,
        maxRetries: 3,
        onError: (key, error) => emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
            operation: `persist ${label} [${key}]`,
            error: error.message || String(error),
            timestamp: Date.now()
        })
    });
}

/**
 * Central layer manager.
 * In-memory cache (Map) for synchronous O(1) queries,
 * asynchronous persistence to IndexedDB, events to notify changes.
 *
 * TWO WRITE PATHS LIVE HERE SINCE 2026-09-13, and knowing which is which is the whole story.
 * Create, property update (rename/visibility/lock/opacity) and reorder are WRITE-AHEAD: they go
 * through {@link LayerManager#_writeLayers}, which journals the intention and writes the document
 * itself. `deleteLayer` and `setActiveLayer` are still on the old path (memory first, write
 * deferred by {@link DebouncedPersist}); the first is the next wave, the second is per-client view
 * state with no op at all. The two paths write the SAME document, which is why the migrated one
 * drains the debounce before reading.
 */
class LayerManager {
    /** @param {import('../events/event_bus.js').EventBus} eventBus */
    constructor(eventBus) {
        this.memoryStore = memoryStore;
        this._eventBus = eventBus;
        this._layersPersist = createPersist('layers');
        this._activeLayerPersist = createPersist('active layer');
    }

    // ===== SYNCHRONOUS READ OPERATIONS =====

    /**
     * Get all layers from a map (sorted by order).
     * @param {string} mapName - Map name (null = current map)
     * @returns {Array} Sorted array of layers
     */
    getLayers(mapName = null) {
        const targetMap = this._resolveMap(mapName);
        return Array.from(this.memoryStore.layers[targetMap].values())
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /**
     * Get layer by ID - O(1) lookup.
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object|null}
     */
    getLayerById(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        return this.memoryStore.layers[targetMap].get(layerId) || null;
    }

    /**
     * O id da camada ATIVA, sincrono, e ele nomeia uma camada que EXISTE.
     *
     * O GEMEO ASSINCRONO E `LocalRepository.getActiveLayerId`, e os dois tinham a MESMA queda:
     * o literal `'default'`, que e o id da camada padrao LOCAL (`getDefaultLayer`). Num atlas de
     * SERVIDOR toda camada tem UUID, entao esse id nao nomeia nada, e a feicao criada com ele
     * nasce orfa: o filtro de camada a esconde do mapa e a aba de feicoes continua listando-a.
     * Medido em 2026-08-25, no atlas do chefe.
     *
     * ESTE E O CAMINHO QUE A CRIACAO USA, por ser sincrono, entao consertar so o do repositorio
     * deixaria o defeito de pe por baixo. Os dois precisam cair na mesma coisa.
     *
     * A QUEDA E A PRIMEIRA CAMADA DO MAPA. No atlas local ela continua sendo `'default'` por
     * construcao, porque a camada padrao sintetizada tem esse id. O `'default'` final so responde
     * quando nao ha mapa resolvido nem camada nenhuma, que e o estado de antes do boot.
     * @param {string} [mapName] - Map name (null = current map)
     * @returns {string}
     */
    getActiveLayerIdSync(mapName = null) {
        const ativo = this.memoryStore.activeLayerId;
        let camadas = [];
        // `getLayers` indexa `memoryStore.layers[mapa]` sem conferir, e este getter e chamado
        // ANTES de existir mapa (o boot pergunta a camada ativa cedo). Um `catch` aqui vale mais
        // que um guarda a mais: o que importa e nunca lancar num caminho de leitura.
        try { camadas = this.getLayers(mapName); } catch { camadas = []; }
        if (ativo && camadas.some((l) => l?.id === ativo)) return ativo;
        if (camadas.length > 0) return camadas[0].id;
        return getActiveScope()?.kind === 'remote' ? null : (ativo || 'default');
    }

    /**
     * Get active layer object.
     * @param {string} mapName
     * @returns {Object|null}
     */
    getActiveLayer(mapName = null) {
        return this.getLayerById(this.getActiveLayerIdSync(), mapName);
    }

    /**
     * Get visible layer IDs.
     * @param {string} mapName
     * @returns {Array<string>}
     */
    getVisibleLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => l.visible)
            .map(l => l.id);
    }

    /**
     * Get unlocked layer IDs.
     * @param {string} mapName
     * @returns {Array<string>}
     */
    getUnlockedLayerIds(mapName = null) {
        return this.getLayers(mapName)
            .filter(l => !l.locked)
            .map(l => l.id);
    }

    // ===== STATE CHECKS =====

    /**
     * Check if a feature is effectively visible (considering layer).
     * @param {Object} feature
     * @param {string} mapName
     * @returns {boolean}
     */
    isFeatureEffectivelyVisible(feature, mapName = null) {
        if (!feature?.properties) return true;
        if (feature.properties.visivel === false) return false;

        const layer = this.getLayerById(feature.properties.layerId || 'default', mapName);
        return layer?.visible ?? true;
    }

    /**
     * Check if a feature is effectively locked (layer OR feature).
     * @param {Object} feature
     * @param {string} mapName
     * @returns {boolean}
     */
    isFeatureEffectivelyLocked(feature, mapName = null) {
        if (!feature?.properties) return false;
        if (feature.properties.bloqueado === true) return true;

        const layer = this.getLayerById(feature.properties.layerId || 'default', mapName);
        return layer?.locked ?? false;
    }

    // ===== WRITE OPERATIONS =====

    /**
     * Create a new layer.
     *
     * ASYNC since 2026-09-13 (write-ahead, bloco B4): the intention is journaled before the
     * layers document is written, and the write no longer goes through the debounce.
     *
     * @param {string} name - Layer name (if not provided, generates unique default name)
     * @param {string} mapName
     * @returns {Promise<Object>} Created layer
     */
    async createLayer(name, mapName = null) {
        return this._createLayerInternal(name, 'Nova Camada', mapName, true);
    }

    /**
     * Create a new layer for import (no event emission, no active layer change).
     *
     * ASYNC since 2026-09-13, same reason as {@link createLayer}.
     *
     * @param {string} name
     * @param {string} mapName
     * @returns {Promise<Object>} Created layer
     */
    async createLayerForImport(name, mapName = null) {
        return this._createLayerInternal(name, 'Importação', mapName, false);
    }

    /**
     * Delete a layer in cascade.
     * If deleting the last layer, creates a new default layer automatically.
     *
     * STILL ON THE OLD PATH (memory first, debounce, log without waiting), and deliberately so:
     * it is the wave after this one. It writes the same document the migrated entries write, so
     * {@link _writeLayers} DRAINS the debounce inside the lock before reading — without that, a
     * delete's pending write would land after a create's direct write and take the new layer
     * with it.
     *
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object} Information about the deletion
     */
    deleteLayer(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        const layersMap = this.memoryStore.layers[targetMap];

        if (!layersMap.has(layerId)) {
            throw new Error(`Layer ${layerId} not found.`);
        }

        const deletedLayer = layersMap.get(layerId);
        let createdDefaultLayer = null;

        if (layersMap.size <= 1 && getActiveScope()?.kind !== 'remote') {
            const defaultLayer = getDefaultLayer();
            if (layerId === 'default') {
                defaultLayer.id = IDUtils.generateUniqueId('layer');
            }
            layersMap.set(defaultLayer.id, defaultLayer);
            this.memoryStore.activeLayerId = defaultLayer.id;
            createdDefaultLayer = defaultLayer;
        } else if (this.memoryStore.activeLayerId === layerId) {
            this._switchActiveLayerOnDelete(layersMap, layerId);
        }

        layersMap.delete(layerId);
        this._persistLayersAsync(targetMap);
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        logLayerOperation(OperationType.DELETE, layerId, mapResolver.resolveToId(targetMap), null, deletedLayer);

        return { success: true, deletedLayerId: layerId, createdDefaultLayer };
    }

    /**
     * Rename a layer.
     * @param {string} layerId
     * @param {string} newName
     * @param {string} mapName
     * @returns {Promise<Object>} Renamed layer
     */
    async renameLayer(layerId, newName, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { name: newName });
    }

    // ===== ACTIVE LAYER =====

    /**
     * Set the active layer.
     *
     * NO OP IS LOGGED HERE, and it stays SYNCHRONOUS on purpose: the active layer is per-client
     * VIEW state (it has no `layer` op and never travels), so its write may keep riding the
     * debounce. It also writes a different key (`activeLayer_<map>`) from the layers document,
     * so it cannot clobber a migrated write.
     *
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Object} Activated layer
     * @throws {Error} If the layer is locked
     */
    setActiveLayer(layerId, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        const layer = this.getLayerById(layerId, targetMap);

        if (!layer) throw new Error(`Layer ${layerId} not found.`);
        if (layer.locked) throw new Error('Cannot activate a locked layer.');

        this.memoryStore.activeLayerId = layerId;
        this._persistActiveLayerAsync(targetMap);
        this._notifyLayersChanged();

        return layer;
    }

    // ===== VISIBILITY AND LOCK =====

    /**
     * Set layer visibility.
     * @param {string} layerId
     * @param {boolean} visible
     * @param {string} mapName
     * @returns {Promise<Object>} Updated layer
     */
    async setLayerVisibility(layerId, visible, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { visible });
    }

    /**
     * Set layer lock state.
     * @param {string} layerId
     * @param {boolean} locked
     * @param {string} mapName
     * @returns {Promise<Object>} Updated layer
     */
    async setLayerLocked(layerId, locked, mapName = null) {
        return this._updateLayerProperty(layerId, mapName, { locked });
    }

    /**
     * Set layer opacity (clamped to 0..1).
     * @param {string} layerId
     * @param {number} opacity
     * @param {string} mapName
     * @returns {Promise<Object>} Updated layer
     */
    async setLayerOpacity(layerId, opacity, mapName = null) {
        // `Number(null)` is 0 and `Number('')` is 0, both of which survive
        // `Number.isFinite` and clamp to a FULLY TRANSPARENT layer, while
        // `Number(undefined)` is NaN and falls on the default 1. Three spellings
        // of "no choice was made" came out at opposite ends of the scale, and the
        // null one made a layer vanish. Nullish and empty now share the default.
        const n = (opacity === null || opacity === '') ? NaN : Number(opacity);
        const clamped = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
        const layer = this.getLayerById(layerId, mapName);
        if (layer && layer.opacity === clamped) return layer;
        return this._updateLayerProperty(layerId, mapName, { opacity: clamped });
    }

    /**
     * Reorder layers based on array of IDs.
     *
     * ASYNC since 2026-09-13 (write-ahead, bloco B4): N intentions and ONE write, in one
     * transaction, so the new stacking either is recoverable whole or never happened. Reordering
     * is the entry where the old shape hurt most, because the order is invisible: a lost write
     * is indistinguishable from never having dragged anything.
     *
     * @param {string[]} orderedLayerIds
     * @param {string} mapName
     * @returns {Promise<void>}
     */
    async reorderLayers(orderedLayerIds, mapName = null) {
        const targetMap = this._resolveMap(mapName);
        return this._writeLayers(targetMap, 'reorderLayers', (layersMap) => {
            const layers = {};
            const operations = [];
            const now = Date.now();
            // The index must count the layers that EXIST, not the positions of the
            // received array: a stale id left in the UI list used to consume index 0
            // and push the whole stack down by one, with no error anywhere.
            let index = 0;
            for (const layerId of orderedLayerIds) {
                const layer = layersMap.get(layerId);
                if (!layer) continue;
                const position = index++;
                if (layer.order === position) continue;
                const next = { ...layer, order: position, updatedAt: now, version: (layer.version || 0) + 1 };
                layers[layerId] = next;
                // Sync the new render order to peers — it was persisted locally but never logged,
                // so collaborators kept the old layer order.
                operations.push({ type: OperationType.UPDATE, id: layerId, data: next, previous: { ...layer } });
            }
            // Nothing moved: no intention, and no write either. The old shape still wrote the
            // whole document back for a no-op drag.
            if (operations.length === 0) return null;
            return { layers, operations };
        });
    }

    // ===== LIFECYCLE / PERSISTENCE =====

    /**
     * Descarrega TODA escrita de camada ainda represada pelo debounce.
     *
     * POR QUE ELA EXISTE, e por que e publica. A escrita de camada e adiada em 300 ms
     * (`_persistLayersAsync` -> `DebouncedPersist.schedule`), entao quem le do REPOSITORIO logo
     * depois de uma edicao le o estado ANTERIOR. O exportador passou a ler do repositorio (era
     * memoria, e memoria so existe para o mapa corrente, o que apagava em silencio as camadas de
     * todo mapa nao visitado na sessao); sem este descarregamento a troca compraria a perda
     * grande pagando com uma pequena, a de renomear uma camada e exportar em seguida.
     *
     * O PRECEDENTE E INTERNO: `loadLayersToMemory` ja faz `flush` antes de ler, pelo mesmo
     * motivo. Isto so promove aquele gesto a `flushAll`, para alcancar TODO mapa com escrita
     * pendente e nao apenas um.
     * @returns {Promise<void>}
     */
    async flushPendingWrites() {
        await this._layersPersist.flushAll();
        await this._activeLayerPersist.flushAll();
    }

    /**
     * Load layers from IndexedDB to in-memory cache.
     * @param {string} mapName
     */
    async loadLayersToMemory(mapName) {
        try {
            await this._layersPersist.flush(mapName);
            await this._activeLayerPersist.flush(mapName);

            const layersArray = await getLayersRepo(mapName);
            const activeId = await getActiveLayerIdRepo(mapName);

            const layersMap = new Map();
            layersArray.forEach((layer, index) => {
                if (layer.order === undefined) {
                    layer.order = index;
                }
                if (typeof layer.opacity !== 'number') {
                    layer.opacity = 1;
                }
                layersMap.set(layer.id, layer);
            });

            this.memoryStore.layers[mapName] = layersMap;
            this.memoryStore.activeLayerId = activeId;
        } catch (error) {
            console.warn(`Error loading layers for map ${mapName}:`, error);
            this._ensureMapLayersExist(mapName);
        }
    }

    /**
     * Duplicate layers from one map to another.
     * @param {string} sourceMapName
     * @param {string} targetMapName
     * @param {Map} idMapping
     * @returns {Map} ID mapping with layer ID translations
     */
    async duplicateMapLayers(sourceMapName, targetMapName, idMapping = new Map()) {
        try {
            const sourceLayers = await getLayersRepo(sourceMapName);
            const sourceActiveId = await getActiveLayerIdRepo(sourceMapName);

            if (!sourceLayers || sourceLayers.length === 0) {
                return idMapping;
            }

            const now = Date.now();
            let newActiveId = 'default';

            const duplicatedLayers = sourceLayers.map(layer => {
                const newId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId('layer');
                idMapping.set(layer.id, newId);
                if (sourceActiveId === layer.id) {
                    newActiveId = newId;
                }
                return { ...layer, id: newId, createdAt: now, updatedAt: now, version: 1 };
            });

            await setLayersRepo(targetMapName, duplicatedLayers);
            await setActiveLayerIdRepo(targetMapName, newActiveId);

            if (targetMapName === this.memoryStore.currentMap) {
                await this.loadLayersToMemory(targetMapName);
            }

            return idMapping;
        } catch (error) {
            console.error(`Error duplicating layers from ${sourceMapName} to ${targetMapName}:`, error);
            return idMapping;
        }
    }

    /**
     * Remove all layers from a map.
     * @param {string} mapName
     */
    async clearMapLayers(mapName) {
        this._layersPersist.cancel(mapName);
        this._activeLayerPersist.cancel(mapName);

        try {
            await setLayersRepo(mapName, []);
            if (this.memoryStore.layers[mapName]) {
                this.memoryStore.layers[mapName].clear();
            }
        } catch (error) {
            console.error(`Error clearing layers for map ${mapName}:`, error);
        }
    }

    /**
     * Clear the in-memory cache for layers.
     */
    clearLayersCache() {
        this._layersPersist.cancelAll();
        this._activeLayerPersist.cancelAll();
        this.memoryStore.layers = {};
        this.memoryStore.activeLayerId = 'default';
    }

    // ===== PRIVATE METHODS =====

    /**
     * Resolve map name, defaulting to current map, and ensure cache exists.
     * @param {string} mapName
     * @returns {string} Resolved map name
     * @private
     */
    _resolveMap(mapName) {
        const resolved = mapName || this.memoryStore.currentMap;
        this._ensureMapLayersExist(resolved);
        return resolved;
    }

    /**
     * Journals a layer edit before the per-map layers document is written.
     *
     * The contract is the one `editCatalogLayers` established and `_writeGroups`
     * (`tool_manager/group_manager.js`) copies: the side-document lock serializes writers,
     * `prepare` reads the cache and builds the WHOLE edit, `recordOperation` states the intention
     * while the copy on disk is still the old one, and the returned closure is the ONLY writer.
     * The memory cache is updated in `tx.deferSync`, so a write that fails leaves the cache
     * agreeing with disk instead of showing an edit that nothing persisted.
     *
     * THE LOCK IS THE 'layers' SIDE KEY, NOT THE MAP DOCUMENT, and that is load-bearing. The
     * layers of a map live in their own store, and two callers reach layer creation from INSIDE a
     * `withMapDocument` section of the same map (`buildLayerMappingForMove` runs under the move
     * composite, and the import path writes features right after); the queue in
     * `store/document-lock.js` is FIFO with no reentrancy, so sharing `map:<id>` would wait for
     * the caller itself, forever.
     *
     * IT DRAINS THE DEBOUNCE FIRST, inside the lock. `deleteLayer` and `setActiveLayer` still
     * schedule their writes through `DebouncedPersist`, and a pending one carries a SNAPSHOT of
     * memory taken before this edit: firing after the direct write it would silently undo it.
     * Draining converts that race into an ordinary ordering. The drain is outside the transaction
     * on purpose: it persists somebody else's already-decided edit, not ours.
     *
     * The edited layer is REPLACED, not mutated in place, which is what keeps the failed write
     * invisible. Read it back through `getLayerById`, never through a reference held across the
     * await.
     *
     * @private
     * @param {string} targetMap - Resolved map name
     * @param {string} label - Operation label, for the deadlock report
     * @param {function(Map): (Object|null)} prepare - Receives the map's layers cache; returns
     *   `{ layers, operations, result, effect }` or null to abort with no write
     * @returns {Promise<*>} `edit.result`
     */
    async _writeLayers(targetMap, label, prepare) {
        let output;
        // Leaf read-modify-write of the per-map layers document; see store/document-lock.js.
        await withSideDocument('layers', targetMap, label, async () => {
            await this._layersPersist.flush(targetMap);
            return runTransaction(async (tx) => {
                this._ensureMapLayersExist(targetMap);
                const layersMap = this.memoryStore.layers[targetMap];
                const edit = prepare(layersMap);
                if (!edit) return async () => {};
                // Tag the op with the map's UUID (not its name) so it reaches the right map on the
                // backend/peers — a non-UUID map id is rejected and poisons the whole flush batch.
                const mapId = mapResolver.resolveToId(targetMap);
                for (const op of edit.operations) {
                    tx.recordOperation(EntityType.LAYER, op.type, op.id, mapId, op.data ?? null, op.previous ?? null);
                }
                const document = Array.from(layersMap.values()).map((layer) => edit.layers[layer.id] ?? layer);
                for (const [id, layer] of Object.entries(edit.layers)) {
                    if (!layersMap.has(id)) document.push(layer);
                }
                tx.deferSync(() => {
                    const live = this.memoryStore.layers[targetMap];
                    for (const [id, layer] of Object.entries(edit.layers)) live.set(id, layer);
                    edit.effect?.();
                });
                output = edit.result;
                return () => setLayersRepo(targetMap, document);
            });
        });
        return output;
    }

    /**
     * Shared layer creation logic.
     * @param {string} name - Explicit name (may be falsy)
     * @param {string} defaultPrefix - Prefix for auto-generated name
     * @param {string} mapName
     * @param {boolean} notify - Whether to emit LAYERS_CHANGED
     * @returns {Promise<Object>} Created layer
     * @private
     */
    async _createLayerInternal(name, defaultPrefix, mapName, notify) {
        const targetMap = this._resolveMap(mapName);
        return this._writeLayers(targetMap, 'createLayer', (layersMap) => {
            const layerName = name || IDUtils.generateUniqueLayerName(
                Array.from(layersMap.values()), defaultPrefix
            );

            const now = Date.now();
            const newLayer = {
                id: IDUtils.generateUniqueId('layer'),
                name: layerName,
                visible: true,
                locked: false,
                opacity: 1,
                order: this._getNextLayerOrder(targetMap),
                createdAt: now,
                updatedAt: now,
                version: 1
            };

            return {
                layers: { [newLayer.id]: newLayer },
                operations: [{ type: OperationType.CREATE, id: newLayer.id, data: newLayer }],
                result: newLayer,
                effect: notify ? () => this._notifyLayersChanged() : undefined
            };
        });
    }

    /**
     * Update one or more properties on a layer, with versioning and sync logging.
     *
     * Serves rename, visibility, lock and opacity. ASYNC and write-ahead since 2026-09-13.
     *
     * @param {string} layerId
     * @param {string} mapName
     * @param {Object} changes - Key/value pairs to apply
     * @returns {Promise<Object>} Updated layer
     * @private
     */
    async _updateLayerProperty(layerId, mapName, changes) {
        const targetMap = this._resolveMap(mapName);
        return this._writeLayers(targetMap, 'updateLayer', (layersMap) => {
            // Read INSIDE the critical section: a layer read before the lock may have been
            // deleted by the writer ahead in the queue, and editing it would resurrect it.
            const layer = layersMap.get(layerId);
            if (!layer) throw new Error(`Layer ${layerId} not found.`);

            const next = {
                ...layer,
                ...changes,
                updatedAt: Date.now(),
                version: (layer.version || 0) + 1
            };

            return {
                layers: { [layerId]: next },
                operations: [{ type: OperationType.UPDATE, id: layerId, data: next, previous: { ...layer } }],
                result: next,
                effect: () => this._notifyLayersChanged()
            };
        });
    }

    /**
     * When deleting the active layer, switch to the best alternative.
     * @param {Map} layersMap
     * @param {string} deletedId
     * @private
     */
    _switchActiveLayerOnDelete(layersMap, deletedId) {
        const remaining = Array.from(layersMap.values())
            .filter(l => l.id !== deletedId && !l.locked);

        if (remaining.length > 0) {
            this.memoryStore.activeLayerId = remaining[0].id;
            return;
        }

        const anyOther = Array.from(layersMap.values())
            .find(l => l.id !== deletedId);
        if (anyOther) {
            anyOther.locked = false;
            this.memoryStore.activeLayerId = anyOther.id;
        }
    }

    /** @private */
    _notifyLayersChanged() {
        this._eventBus.emit(EventTypes.LAYERS_CHANGED, {
            mapName: this.memoryStore.currentMap
        });
    }

    /** @private */
    _ensureMapLayersExist(mapName) {
        if (!this.memoryStore.layers) {
            this.memoryStore.layers = {};
        }
        if (!this.memoryStore.layers[mapName]) {
            this.memoryStore.layers[mapName] = getActiveScope()?.kind === 'remote'
                ? new Map() : new Map([['default', getDefaultLayer()]]);
        }
        if (!this.memoryStore.activeLayerId && getActiveScope()?.kind !== 'remote') {
            this.memoryStore.activeLayerId = 'default';
        }
    }

    /** @private */
    _getNextLayerOrder(mapName) {
        const values = Array.from(this.memoryStore.layers[mapName].values());
        return values.length === 0 ? 0 : Math.max(...values.map(l => l.order || 0)) + 1;
    }

    /** @private */
    _persistLayersAsync(mapName) {
        this._layersPersist.schedule(mapName, async () => {
            const layersMap = this.memoryStore.layers[mapName];
            if (!layersMap) return;
            await setLayersRepo(mapName, Array.from(layersMap.values()));
        });
    }

    /** @private */
    _persistActiveLayerAsync(mapName) {
        this._activeLayerPersist.schedule(mapName, async () => {
            await setActiveLayerIdRepo(mapName, this.memoryStore.activeLayerId);
        });
    }
}

/**
 * Factory function to create LayerManager instance.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 * @returns {LayerManager}
 */
export function createLayerManager(eventBus) {
    return new LayerManager(eventBus);
}

/**
 * Module-level instance holder for backward compatibility.
 * Set by services.js after initialization.
 * @type {{instance: LayerManager|null}}
 */
export const layerManagerHolder = { instance: null };

export { LayerManager };
