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
// The leaf module, never the `sync/index.js` barrel: several store suites replace that barrel
// with a partial double that has no `EntityType`, so reaching for it there breaks them at load.
import { EntityType, OperationType } from '../store/sync/operation-types.js';
import { runTransaction } from '../store/store-transaction.js';
import { withSideDocument } from '../store/document-lock.js';
import { mapResolver } from '../store/services/map-resolver.service.js';
import { getActiveScope } from '../store/atlas-namespace.js';
// A pergunta de EXISTÊNCIA do mapa alvo (D2), pelo ARQUIVO e nunca pelo barril do store: este
// arquivo não lê o documento do mapa, só precisa saber se ele existe antes de gravar o documento
// lateral de camadas (`layers_<chave>`), que `_resolveMapKey` chaveia pelo nome não resolvido.
import { mapExistsForGesture } from '../store/mapa-inexistente.js';

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
 * THE LAYERS DOCUMENT HAS EXACTLY ONE WRITER SINCE 2026-09-13, and that is the whole story here.
 * Create, property update (rename/visibility/lock/opacity), reorder and DELETE are WRITE-AHEAD:
 * they all go through {@link LayerManager#_writeLayers}, which journals the intention and then
 * writes the document itself, inside the transaction. `deleteLayer` was the last scheduler of the
 * layers {@link DebouncedPersist}, so that debounce is GONE: with a single writer there is no
 * pending snapshot that could land after a direct write and silently undo it, and therefore
 * nothing left to drain.
 *
 * `setActiveLayer` stays SYNCHRONOUS and debounced, and it is not an exception: the active layer is
 * per-client VIEW state, it has no op, and it writes a DIFFERENT key (`activeLayer_<map>`), so it
 * cannot clobber the document above.
 */
class LayerManager {
    /** @param {import('../events/event_bus.js').EventBus} eventBus */
    constructor(eventBus) {
        this.memoryStore = memoryStore;
        this._eventBus = eventBus;
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
     * Delete a layer.
     * If deleting the last layer, creates a new default layer automatically.
     *
     * ASYNC and WRITE-AHEAD since 2026-09-13 (bloco B4). The `layer` DELETE is journaled before
     * the layers document is written, the document is written by the transaction itself (no
     * debounce), and the active-layer switch happens in `tx.deferSync`, so a refused write leaves
     * the person pointing at the layer that still exists.
     *
     * THE FEATURES OF THE LAYER CARRY NO OP OF THEIR OWN, and that is contract, not an omission:
     * the server cascades them inside the same transaction as the layer row
     * (`UPDATE features SET deleted_at ... WHERE layer_id AND map_id`) and the peer mirrors that
     * cascade in `cascadeRemoteLayerDelete` (`store/sync/remote-operation-handler.js`). Emitting a
     * feature DELETE here would be the obvious fix and the wrong one, because
     * `transferLayerToMap` relocates a feature by a `feature create` with the SAME id in the
     * destination map, and under LWW by arrival order the delete would erase what had just moved.
     *
     * WHY THE LOCAL REMOVAL OF THOSE FEATURES IS NOT IN THIS TRANSACTION. It lives in
     * `deleteLayerFeatures`, which is a read-modify-write of the MAP document, and the composite
     * `deleteLayer` (`store/store.js`) runs it FIRST, in a section of its own. Folding it in here
     * would mean taking `map:<id>` while holding `layers:<id>`, and the reverse order already
     * exists: two callers reach layer creation from inside a `withMapDocument` section of the same
     * map (the move composite and the import path). Two lock orders is a cycle, i.e. a deadlock,
     * so the two documents stay in two sections and the composite keeps the order that cannot
     * cycle (map first, layers second). The cost is bounded and visible: a failure between them
     * leaves an EMPTY layer, never an orphan feature.
     *
     * THE REPLACEMENT DEFAULT LAYER IS A LOCAL-ONLY AFFAIR. In a server atlas it is not created at
     * all (`getActiveScope().kind === 'remote'`): the server creates the substitute and the ack
     * brings it back in `data.replacementLayers`, which `applyConfirmedMapLayers` adopts. Locally
     * it is a `layer` CREATE intention of its own, journaled in the same transaction, so the two
     * halves of "the last layer went away and this one took its place" are recoverable together.
     *
     * @param {string} layerId
     * @param {string} mapName
     * @returns {Promise<Object>} Information about the deletion
     */
    async deleteLayer(layerId, mapName = null) {
        // Sem fabricar o cache: ver `_targetMapName`.
        const targetMap = this._targetMapName(mapName);
        return this._writeLayers(targetMap, 'deleteLayer', (layersMap) => {
            // Read INSIDE the critical section: a layer read before the lock may already have been
            // deleted by the writer ahead in the queue.
            const deletedLayer = layersMap.get(layerId);
            if (!deletedLayer) {
                throw new Error(`Layer ${layerId} not found.`);
            }

            const operations = [{
                type: OperationType.DELETE, id: layerId, data: null, previous: { ...deletedLayer }
            }];
            const layers = {};
            let createdDefaultLayer = null;
            let nextActiveId = null;

            if (layersMap.size <= 1 && getActiveScope()?.kind !== 'remote') {
                const defaultLayer = getDefaultLayer();
                if (layerId === 'default') {
                    defaultLayer.id = IDUtils.generateUniqueId('layer');
                }
                layers[defaultLayer.id] = defaultLayer;
                operations.push({ type: OperationType.CREATE, id: defaultLayer.id, data: defaultLayer });
                createdDefaultLayer = defaultLayer;
                nextActiveId = defaultLayer.id;
            } else if (this.memoryStore.activeLayerId === layerId) {
                const replacement = this._pickActiveLayerOnDelete(layersMap, layerId);
                nextActiveId = replacement?.layer.id ?? null;
                // Every other layer was LOCKED, so the fallback unlocks the one it activates. That
                // unlock reached disk before this migration and never reached a peer, because no op
                // described it; now it travels, as the property edit it has always been.
                if (replacement?.unlock) {
                    const unlocked = {
                        ...replacement.layer, locked: false,
                        updatedAt: Date.now(), version: (replacement.layer.version || 0) + 1
                    };
                    layers[unlocked.id] = unlocked;
                    operations.push({
                        type: OperationType.UPDATE, id: unlocked.id, data: unlocked,
                        previous: { ...replacement.layer }
                    });
                }
            }

            return {
                layers,
                removals: [layerId],
                operations,
                result: { success: true, deletedLayerId: layerId, createdDefaultLayer },
                effect: () => {
                    if (nextActiveId !== null) {
                        this.memoryStore.activeLayerId = nextActiveId;
                        this._persistActiveLayerAsync(targetMap);
                    }
                    this._notifyLayersChanged();
                }
            };
        });
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
        // Sem fabricar o cache: ver `_targetMapName`.
        const targetMap = this._targetMapName(mapName);
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
     * Descarrega toda escrita de camada ainda represada pelo debounce.
     *
     * POR QUE ELA EXISTE, e por que e publica. A escrita do DOCUMENTO de camadas era adiada em
     * 300 ms, entao quem lia do REPOSITORIO logo depois de uma edicao lia o estado ANTERIOR. O
     * exportador passou a ler do repositorio (era memoria, e memoria so existe para o mapa
     * corrente, o que apagava em silencio as camadas de todo mapa nao visitado na sessao); sem
     * este descarregamento a troca compraria a perda grande pagando com uma pequena, a de
     * renomear uma camada e exportar em seguida.
     *
     * DESDE 2026-09-13 O DOCUMENTO DE CAMADAS NAO E MAIS REPRESADO: `deleteLayer` foi o ultimo a
     * agendar por `DebouncedPersist`, e com ele migrado a gravacao acontece sempre dentro da
     * transacao. O que sobra represado e a CAMADA ATIVA, que e estado de visao por cliente. A
     * funcao continua publica e continua sendo chamada antes de ler do repositorio, pelos
     * chamadores de fora (`flushPendingLayerWrites`), porque o contrato deles nao muda e porque a
     * chave da ativa ainda pode estar em voo.
     * @returns {Promise<void>}
     */
    async flushPendingWrites() {
        await this._activeLayerPersist.flushAll();
    }

    /**
     * Load layers from IndexedDB to in-memory cache.
     * @param {string} mapName
     */
    async loadLayersToMemory(mapName) {
        try {
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
        this._activeLayerPersist.cancelAll();
        this.memoryStore.layers = Object.create(null);
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
     * O MESMO NOME RESOLVIDO, SEM FABRICAR O CACHE, e é este que toda ESCRITA usa (D2).
     *
     * `_resolveMap` chama `_ensureMapLayersExist`, que cria `memoryStore.layers[<qualquer nome>]`
     * sem perguntar nada. Numa escrita isso acontecia ANTES de {@link LayerManager#_writeLayers}
     * poder perguntar se o mapa existe, então a recusa chegava com a estrutura já fabricada: um
     * balde de camadas em nome de um mapa que o atlas não tem mais. Quem precisa do cache é o
     * funil, DEPOIS da pergunta.
     *
     * A METADE DE LEITURA CONTINUA FABRICANDO, de propósito: `getLayers`/`getLayerById` indexam o
     * cache sem conferir e são chamados antes de existir mapa (o boot pergunta a camada ativa
     * cedo), então tirar o `_ensure` de lá é outra mudança, com outros chamadores.
     *
     * @param {string} mapName
     * @returns {string} Resolved map name
     * @private
     */
    _targetMapName(mapName) {
        return mapName || this.memoryStore.currentMap;
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
     * THERE IS NO DEBOUNCE LEFT TO DRAIN, since 2026-09-13. It used to flush `DebouncedPersist`
     * inside the lock because `deleteLayer` still scheduled a write carrying a pre-edit snapshot of
     * memory, which firing after the direct write would silently undo. `deleteLayer` came through
     * here in the same wave, so the document has exactly one writer and the race no longer has two
     * sides. Do not reintroduce a scheduled write for this document: it would need the drain back,
     * and a drain is only correct while somebody remembers it exists.
     *
     * The edited layer is REPLACED, not mutated in place, which is what keeps the failed write
     * invisible. Read it back through `getLayerById`, never through a reference held across the
     * await.
     *
     * O MAPA ALVO TEM DE EXISTIR (D2, 2026-09-21), e a pergunta mora AQUI porque este é o funil:
     * criar, renomear, mostrar, travar, opacizar, reordenar e excluir camada passam todos por ele,
     * e nenhum deles é escrita DERIVADA. O inventário do mapa fantasma classificou esta família
     * como derivada em cima de um comentário sobre o `DebouncedPersist` que saiu em 2026-09-13:
     * não há mais represa nenhuma, toda entrada daqui responde a um clique e grava dentro da
     * transação. Em atlas de SERVIDOR um mapa que o store de MAPAS não tem deixa `layers_<nome>`
     * órfão (nenhum cartão na aba Mapas denuncia) e a op sai com contexto que não é UUID, morrendo
     * no anti-vazamento antes do envio: o gesto é aceito na tela e jogado fora em silêncio.
     *
     * ELA VEM DENTRO DA TRANSAÇÃO e ANTES de `_ensureMapLayersExist`, e as duas metades importam.
     * Dentro, porque uma leitura de disco fora da transação fica fora do carimbo de escopo e uma
     * troca de atlas durante ela deixaria a escrita cair no OUTRO atlas (é o que
     * `tests/integration/map-settings-write-ahead.test.js` pegou na guarda irmã). Antes do
     * `_ensure`, porque ele fabrica o balde de camadas do nome que lhe derem, e uma recusa que
     * chega depois disso já deixou a estrutura fantasma na memória.
     *
     * A RECUSA DEVOLVE `undefined`, que é o valor que os chamadores já tratam: a fachada
     * (`store/layer.operations.js`) devolve `null` nas recusas de papel e de trava, e as telas
     * guardam com `if (!novaCamada) return;`. O motivo real não se perde, sai no
     * `STORE_OPERATION_BLOCKED` com `reason: 'map_missing'`.
     *
     * @private
     * @param {string} targetMap - Resolved map name
     * @param {string} label - Operation label, for the deadlock report AND for the refusal payload
     * @param {function(Map): (Object|null)} prepare - Receives the map's layers cache; returns
     *   `{ layers, removals, operations, result, effect }` or null to abort with no write
     * @returns {Promise<*>} `edit.result`, or `undefined` when the map is gone
     */
    async _writeLayers(targetMap, label, prepare) {
        let output;
        // Leaf read-modify-write of the per-map layers document; see store/document-lock.js.
        await withSideDocument('layers', targetMap, label, async () => runTransaction(async (tx) => {
            if (!await mapExistsForGesture(targetMap, label)) return async () => {};
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
            const removed = new Set(edit.removals ?? []);
            const document = Array.from(layersMap.values())
                .filter((layer) => !removed.has(layer.id))
                .map((layer) => edit.layers[layer.id] ?? layer);
            for (const [id, layer] of Object.entries(edit.layers)) {
                if (!layersMap.has(id)) document.push(layer);
            }
            tx.deferSync(() => {
                const live = this.memoryStore.layers[targetMap];
                for (const id of removed) live.delete(id);
                for (const [id, layer] of Object.entries(edit.layers)) live.set(id, layer);
                edit.effect?.();
            });
            output = edit.result;
            return () => setLayersRepo(targetMap, document);
        }));
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
        // `_targetMapName` e não `_resolveMap`: fabricar o cache aqui derrotaria a pergunta de
        // existência que `_writeLayers` faz logo adiante. Ver o cabeçalho daquele funil.
        const targetMap = this._targetMapName(mapName);
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
        // Sem fabricar o cache: ver `_targetMapName`.
        const targetMap = this._targetMapName(mapName);
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
     * Which layer takes over when the ACTIVE one is deleted, and whether it has to be unlocked.
     *
     * PURE since 2026-09-13: it DECIDES and returns, where the previous version wrote
     * `memoryStore.activeLayerId` and mutated `locked` on the chosen layer in place. Both effects
     * now belong to the caller's transaction (the unlock to the edit, the activation to
     * `tx.deferSync`), because a decision taken before persistence must not be visible if the write
     * is refused.
     *
     * @param {Map} layersMap
     * @param {string} deletedId
     * @returns {{layer: Object, unlock: boolean}|null} The layer to activate, or null when the map
     *   has none left
     * @private
     */
    _pickActiveLayerOnDelete(layersMap, deletedId) {
        const remaining = Array.from(layersMap.values())
            .filter(l => l.id !== deletedId && !l.locked);

        if (remaining.length > 0) {
            return { layer: remaining[0], unlock: false };
        }

        const anyOther = Array.from(layersMap.values())
            .find(l => l.id !== deletedId);
        return anyOther ? { layer: anyOther, unlock: true } : null;
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
            this.memoryStore.layers = Object.create(null);
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
    _persistActiveLayerAsync(mapName) {
        const scope = getActiveScope();
        const layerId = this.memoryStore.activeLayerId;
        this._activeLayerPersist.schedule(mapName, async () => {
            if (getActiveScope() !== scope) return;
            await setActiveLayerIdRepo(mapName, layerId);
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
