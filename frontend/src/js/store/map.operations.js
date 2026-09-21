// Path: js/store/map.operations.js

/**
 * @fileoverview Map CRUD operations.
 */

import {
    getMapDataCompat,
    updateMapDataCompat,
    mintMapDocument,
    deleteMapCompat,
    renameMapCompat,
    getAllMapKeysCompat,
    getSettingCompat,
    setSettingCompat,
    setMapNotesCompat,
    getRepository
} from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore, resetMemoryStore } from './memory-store.js';
// A entrada em atlas LOCAL ao vivo (`adoptMountedLocalAtlas`) precisa do mesmo preparo do boot
// (`initializeRepository`) e dos dois carregadores de memoria por mapa. Nenhum dos tres importa
// este modulo de volta, entao nao ha ciclo.
import { initializeRepository } from './repository.js';
import { loadCesium3dDataToMemory } from './cesium3d.operations.js';
import { loadStreetview360DataToMemory } from './streetview360.operations.js';
import { MAP_BADGE_COLORS, mapBadgeColorForName } from './map-badge-colors.js';
import { mapResolver } from './services/map-resolver.service.js';
import config from '../config.js';
import { EventTypes } from '../events';
import { OperationType, isOperationLoggingEnabled } from './sync/index.js';
// Leaf module (zero imports): keeps the vocabulary out of the sync barrel's graph, and the
// barrel is what several store suites replace with a partial double that has no `EntityType`.
import { EntityType } from './sync/operation-types.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { recusarMapaInexistente } from './mapa-inexistente.js';
import { generateUUID, isValidUUID } from '../utilities/uuid.js';
// Folha, importada por ARQUIVO e nunca pelo barril `@utils` (que arrastaria a store de volta):
// e' o mesmo import que quatro modulos de `store/sync/` ja' fazem.
import { showWarning } from '../utilities/toast_service.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';
import { runTransaction } from './store-transaction.js';
import { isStoreRecoveryRefusal, STORE_RECOVERY_NOTICE } from './write-coordinator.js';
import { resolveAtlasSettingId } from './atlas-setting-target.js';
import { withMapDocument } from './document-lock.js';
import { POSITION_FIELDS, clearedPositionPayload } from './map-position-clear.js';
import { mapRevisionOf, readMapRevision } from './map-revision.js';

// Repository aliases
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;
const deleteMapData = deleteMapCompat;
const renameMapData = renameMapCompat;
const getAllMapNames = getAllMapKeysCompat;
const getAppSetting = getSettingCompat;
const setAppSetting = setSettingCompat;
const setMapNotesRepo = setMapNotesCompat;

async function getMapOrderRepo() {
    return await getSettingCompat('mapOrder') || [];
}

async function setMapOrderRepo(order) {
    await setSettingCompat('mapOrder', order);
}

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {import('./store.types.js').StoreDependencies}
 */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Sets dependencies for map operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies - Dependencies object
 */
export function setMapDependencies(dependencies) {
    Object.assign(deps, dependencies);
    subscribeRemoteMapRename(deps.eventBus);
}

// ===== REMOTE RENAME RE-KEYING =====

/** @type {Array<() => void>} Unsubscribes of the remote map-lifecycle listeners. */
let _unsubscribeRemoteRename = [];

/**
 * O mapa cuja SAIDA esta em voo, ou null. Marca de voo unica, porque so' um mapa pode ser o
 * corrente.
 *
 * ELA E' ESTRUTURAL, E NAO NASCEU DE UMA MEDIÇAO, o que e' exatamente o que precisa estar escrito
 * aqui. A saida e' ASSINCRONA ate' `activateAtlasInitialMap` trocar o mapa corrente, e a guarda
 * acima ("esta pessoa esta naquele mapa") so' deixa de valer no fim dessa troca: dois anuncios do
 * MESMO fato que cheguem dentro dessa janela (o DELETE ao vivo e um retrato que chegue logo atras,
 * por exemplo) passariam os dois, e o preço sao dois avisos e duas trocas de mapa para um fato so'.
 *
 * O QUE NAO A JUSTIFICA, porque foi um erro de INSTRUMENTO e ficou registrado para nao voltar: o
 * retrato do spec mostrou quatro linhas de aviso onde havia dois avisos, e a leitura natural
 * daquilo ("o apply do delete remoto roda em dobro") era falsa. O retrato CONCATENAVA o registro
 * do observador de toasts com a varredura do DOM, contando duas vezes o aviso ainda vivo.
 *
 * O RAMO DE RENAME NAO PRECISA DELA, e por isso ela nao o cobre: `renameMapInMemory` troca
 * `memoryStore.currentMap` de forma SINCRONA, antes do primeiro await, entao a segunda entrega ja'
 * nao passa da guarda.
 * @type {string|null}
 */
let _saidaDeMapaEmVoo = null;

/**
 * Subscribes the ONE listener that re-keys this client's memory when a PEER renames a map.
 *
 * WHY IT LIVES HERE, ao lado de `renameMap` e nao dentro do tratador de entrada. O tratador de
 * operacoes remotas nao pode importar `store-state-manager.js` (guarda estrutural P8 em
 * `frontend/tests/integration/remote-operation-handler.test.js`, que existe para manter o undo
 * fora do caminho remoto), entao a ligacao entre os dois so' pode ser um evento. E o assinante
 * mora no MESMO arquivo que o autor porque as duas chamadas de re-chaveagem passam a ter um
 * unico sitio: duas copias da regra divergem, e a divergencia e' o defeito N1 em outra forma.
 *
 * A inscricao e' refeita a cada `setMapDependencies`, e a anterior e' solta antes: sem isso uma
 * segunda inicializacao (os testes fazem isso o tempo todo) acumularia ouvintes e a re-chaveagem
 * rodaria N vezes por rename.
 *
 * @param {import('../events/event_bus.js').EventBus|null} eventBus - Bus to listen on.
 */
function subscribeRemoteMapRename(eventBus) {
    for (const solta of _unsubscribeRemoteRename) solta();
    _unsubscribeRemoteRename = [];
    if (typeof eventBus?.on !== 'function') return;
    const inscrever = (evento, acao, queixa) => {
        const solta = eventBus.on(evento, (payload) => {
            // O emissor e' sincrono; a escrita do ponteiro de disco nao e'. Um `catch` aqui impede
            // que uma falha de IndexedDB derrube o apply da operacao remota que fez o anuncio.
            acao(payload).catch((error) => console.warn(queixa, error));
        });
        // O barramento da casa devolve a funcao que solta a inscricao, e um duble de teste devolve
        // o que quiser: guardar um nao-funcao faria a proxima passada estourar num `()`.
        if (typeof solta === 'function') _unsubscribeRemoteRename.push(solta);
    };
    inscrever(EventTypes.MAP_RENAMED_REMOTELY, applyRemoteMapRename,
        '[Store] Falha ao re-chavear a memoria apos rename remoto:');
    inscrever(EventTypes.CURRENT_MAP_STALE_REMOTELY, reconcileStaleCurrentMap,
        '[Store] Falha ao reconciliar o mapa corrente:');
}

/**
 * Re-chaveia a memoria deste cliente depois que um PAR renomeou um mapa.
 *
 * O NOME DO MAPA E' CHAVE EM SEIS LUGARES DA MEMORIA (`memoryStore.currentMap`, `maps`, `groups`,
 * `layers`, `lockedMaps` e as duas metades temporais) mais o indice nome<->id. Quem renomeia
 * move os sete por `renameMapInMemory` + `mapResolver.renameMap`, e o par nao movia nenhum: o
 * disco passava a dizer o nome novo e a memoria continuava no velho. Medido em 2026-09-21 com
 * duas browsers reais: a aba Mapas do par ficava SEM nenhum cartao marcado como atual, o campo de
 * nome do cabecalho mostrava o nome velho, e uma feicao desenhada pelo par depois disso ia parar
 * num mapa FANTASMA gravado sob a chave do nome velho (`getMapDataCompat` nao acha documento com
 * aquele nome, devolve o documento vazio de compatibilidade e a gravacao o crava), de onde a op
 * nunca saiu da fila. Spec: `frontend/tests/e2e-ui/browser-collab-rename-remoto.spec.js`.
 *
 * A GUARDA E' DE IDENTIDADE, E UMA PERGUNTA SO' COBRE AS TRES ARMADILHAS: o indice tem de dizer
 * que o nome VELHO pertence a ESTE mapa. Se ele apontar para outro mapa, o nome velho ja' foi
 * adotado por um homonimo e re-chavear roubaria a memoria DELE (camadas, grupos e pilha de
 * desfazer); se ele nao conhecer o nome, nao ha como provar a posse, e recusar e' a escolha
 * conservadora. Isso torna a funcao IDEMPOTENTE de graca: aplicada uma vez, `mapResolver.renameMap`
 * apaga a entrada do nome velho, entao a segunda entrega do mesmo anuncio nao passa da guarda.
 * A pergunta so' e' verdadeira no instante certo porque `saveMap` REGISTRA o nome novo sem apagar
 * o velho: no anuncio os dois nomes ainda apontam para este mapa.
 *
 * O PONTEIRO DE MAPA CORRENTE NO DISCO ANDA JUNTO, e ele nao e' memoria: `lastActiveMap` guarda
 * um NOME, a aba Mapas le ele (e nao `getCurrentMapNameSync`) para decidir qual cartao esta
 * ativo, e sem esta linha a tela do par continuava sem cartao atual mesmo com a memoria certa. O
 * autor ganha isso de graça porque a tela dele chama `setCurrentMap` logo depois do rename; o par
 * nao troca de mapa, entao ninguem o reescreveria.
 *
 * @param {{mapId?: string, oldName?: string, newName?: string}} payload - MAP_RENAMED_REMOTELY.
 * @returns {Promise<boolean>} True quando a memoria foi re-chaveada.
 */
export async function applyRemoteMapRename({ mapId, oldName, newName } = {}) {
    if (!mapId || !oldName || !newName || oldName === newName) return false;
    if (mapResolver.resolveToId(oldName) !== mapId) return false;
    await rekeyMemoryForRename(oldName, newName);
    return true;
}

/**
 * Move a memoria deste cliente de um nome para outro, mais o ponteiro de mapa corrente do disco.
 *
 * O CORPO E' COMPARTILHADO PELOS DOIS CAMINHOS de entrada (a op ao vivo e o retrato), e so' a
 * GUARDA difere entre eles: duas copias desta rotina divergiriam, e a divergencia entre o caminho
 * do autor e o caminho do par e' o defeito N1 em outra forma.
 *
 * `mapResolver.renameMap` e' chamado aqui tambem, e no caminho do retrato ele e' um no-op: o
 * indice inteiro ja' foi trocado por `replaceAll`, entao o nome velho nao esta' mais la'. Chamar
 * assim mesmo e' o que mantem uma rotina so'.
 *
 * O PONTEIRO DE MAPA CORRENTE NO DISCO ANDA JUNTO, e ele nao e' memoria: `lastActiveMap` guarda
 * um NOME, a aba Mapas le ele (e nao `getCurrentMapNameSync`) para decidir qual cartao esta
 * ativo, e sem esta linha a tela do par continuava sem cartao atual mesmo com a memoria certa. O
 * autor ganha isso de graça porque a tela dele chama `setCurrentMap` logo depois do rename; o par
 * nao troca de mapa, entao ninguem o reescreveria.
 *
 * @param {string} oldName - Nome que a memoria ainda usa como chave.
 * @param {string} newName - Nome que o disco ja' adotou.
 * @returns {Promise<void>}
 * @private
 */
async function rekeyMemoryForRename(oldName, newName) {
    const eraOCorrente = memoryStore.currentMap === oldName;
    mapManager.renameMapInMemory(oldName, newName);
    mapResolver.renameMap(oldName, newName);

    if (eraOCorrente) {
        await setAppSetting('lastActiveMap', newName);
        // O REPINTE VEM DEPOIS DA ESCRITA, e nao antes. O `LAYERS_CHANGED` que o tratador de
        // entrada emite no fim do apply chega enquanto o ajuste acima ainda esta em voo, e a aba
        // leria o nome velho de novo. Este segundo anuncio e' o mesmo que a tela do autor emite
        // depois de renomear.
        deps.eventBus?.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
    }
}

/**
 * Reconcilia o mapa corrente depois que outra pessoa o renomeou ou o excluiu.
 *
 * O DEFEITO QUE ELA FECHA (medido em 2026-09-21 com duas browsers reais,
 * `frontend/tests/e2e-ui/browser-collab-mapa-fantasma.spec.js`), em DOIS portadores. Um RETRATO do
 * meio da sessao reescreve o registro do mapa aberto com o nome que o servidor diz, ou o retira, e
 * `memoryStore.currentMap` e' um NOME que ninguem mexia: com o mapa renomeado enquanto a aba
 * estava fora, o disco dizia "Mapa Renomeado", a memoria dizia "Mapa Tático",
 * `getCurrentMapIdSync` devolvia o proprio NOME (o indice ja' nao o conhecia), o ajuste
 * `lastActiveMap` ficava NULO, a aba Mapas nao marcava cartao nenhum como atual e a ferramenta de
 * linha nao conseguia criar feiçao nenhuma. O outro portador e' o DELETE ao vivo do mapa aberto:
 * ali o desvio existia so' na ABA MAPAS, que e' construida sob demanda, entao um par que nunca a
 * abriu ficava no mapa morto, sem aviso, e cada feiçao desenhada era recusada.
 *
 * DOIS DESFECHOS, E O SEGUNDO NAO E' UM RENAME. Com `newName`, o mapa continua no atlas com outro
 * nome e a memoria e' re-chaveada pela MESMA rotina do caminho ao vivo. Sem `newName`, ele nao
 * existe mais, e a aba sai pelo caminho que ja' existe para isso (`activateAtlasInitialMap`, o
 * mesmo que a abertura de atlas usa) e AVISA nomeando o mapa, porque ninguem clicou: a
 * afordancia nao pode carregar o motivo de um fato que chega sozinho.
 *
 * O AVISO SAI MESMO SE A TROCA FALHAR, e essa ordem e' deliberada: ficar sem mapa e' ruim, ficar
 * sem mapa E sem explicaçao e' pior. A troca e' a parte que pode falhar (ela escreve), a frase
 * nao.
 *
 * A GUARDA E' "ESTA PESSOA ESTA' NAQUELE MAPA", e ela e' o que torna a funçao idempotente: depois
 * da primeira aplicaçao `memoryStore.currentMap` ja' e' outro nome, entao um anuncio repetido (um
 * retrato reaplicado, ou o desvio que a aba Mapas ja' fazia por conta propria) nao passa daqui. Um
 * mapa retirado que esta aba NAO tinha aberto tambem nao a move, porque arrancar a pessoa de onde
 * ela esta' por causa de um mapa que ela nao via seria pior que o silencio.
 *
 * @param {{mapId?: string, oldName?: string, newName?: string|null}} payload - O anuncio.
 * @returns {Promise<boolean>} True quando algo foi reconciliado.
 */
export async function reconcileStaleCurrentMap({ mapId, oldName, newName } = {}) {
    if (!mapId || !oldName || oldName === newName) return false;
    if (memoryStore.currentMap !== oldName) return false;

    if (newName) {
        await rekeyMemoryForRename(oldName, newName);
        return true;
    }

    if (_saidaDeMapaEmVoo === oldName) return false;
    _saidaDeMapaEmVoo = oldName;
    let destino = null;
    try {
        destino = await activateAtlasInitialMap();
    } catch (error) {
        console.warn('[Store] Não foi possível trocar de mapa após o anúncio:', error);
    } finally {
        _saidaDeMapaEmVoo = null;
    }
    showWarning(destino
        ? `O mapa "${oldName}" foi removido por outro usuário. Você está agora em "${destino}".`
        : `O mapa "${oldName}" foi removido por outro usuário.`);
    return true;
}

// ===== BRIEFING LOCK OVERRIDE =====

/**
 * When true, isCurrentMapLockedSync() always returns true.
 * Used during briefing edit/present modes to enforce read-only without persisting.
 */
let briefingLockOverride = false;

/**
 * Enables or disables the briefing lock override.
 * When active, all maps appear locked (read-only) without persisting the lock state.
 *
 * @param {boolean} active - True to force all maps locked
 */
export function setBriefingLockOverride(active) {
    briefingLockOverride = active;
    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, {
            mapName: memoryStore.currentMap,
            locked: active || memoryStore.lockedMaps.has(memoryStore.currentMap)
        });
    }
}

// ===== MAP CRUD OPERATIONS =====

/**
 * Gets all map names in order.
 *
 * @returns {Promise<string[]>} Array of map names
 */
export async function getAllMapNamesStore() {
    const allKeys = await getAllMapNames();

    // Storage keys are a mix of UUIDs (synced/atlas maps) and legacy names. Callers expect
    // display NAMES, so resolve each key (UUID→name) and de-dup — otherwise a peer's
    // UUID-keyed map renders as a raw UUID in the maps list (§item2). resolveToName is a
    // no-op for keys that are already names.
    const seen = new Set();
    const allMaps = [];
    for (const key of allKeys) {
        const name = mapResolver.resolveToName(key) || key;
        if (!seen.has(name)) {
            seen.add(name);
            allMaps.push(name);
        }
    }

    const savedOrder = await getMapOrderRepo();

    if (!savedOrder || savedOrder.length === 0) {
        return allMaps;
    }

    const orderedMaps = [];
    const remainingMaps = new Set(allMaps);

    for (const mapName of savedOrder) {
        if (remainingMaps.has(mapName)) {
            orderedMaps.push(mapName);
            remainingMaps.delete(mapName);
        }
    }

    for (const mapName of remainingMaps) {
        orderedMaps.push(mapName);
    }

    return orderedMaps;
}

/**
 * Gets the map order.
 *
 * @returns {Promise<string[]>} Ordered array of map names
 */
export async function getMapOrder() {
    return await getMapOrderRepo();
}

/**
 * Records the durable intention of an ATLAS KEY inside an open transaction.
 *
 * THE PERMISSION QUESTION IS ASKED HERE AND ONLY GATES THE OP, never the local write, and that
 * asymmetry is the point. These keys are BOTH a synced project setting and a local view
 * preference: a Visualizador must keep his own map order and badge colours, and refusing the
 * local write would also cost a toast on a path as passive as drawing a map badge
 * (`getMapBadgeColor` assigns and saves a colour on first render). What must NOT happen is
 * enqueueing an op the server answers with 403, because a refused op stalls the whole outbound
 * queue, and that is exactly what these two writers did before.
 *
 * @param {import('./store-transaction.js').StoreTransaction} tx - The open transaction
 * @param {Object} patch - The whitelisted atlas-key patch (e.g. `{ mapOrder }`)
 * @param {Object|null} [previousPatch=null] - The same shape, as it was before
 * @returns {Promise<void>}
 * @private
 */
async function recordAtlasSetting(tx, patch, previousPatch = null) {
    if (!checkPermission(GuardAction.UPDATE_ATLAS_SETTINGS).allowed) return;
    const entityId = await resolveAtlasSettingId(tx.scope);
    tx.recordOperation(EntityType.SETTING, OperationType.UPDATE, entityId, null, patch, previousPatch);
}

/**
 * Sets the map order.
 *
 * The order converges across peers as the atlas-level app setting `atlas.settings.mapOrder`, and
 * since 2026-09-13 that intention is journaled BEFORE the local setting is written: the whole
 * point of an ordering nobody can see is that losing it silently is indistinguishable from
 * never having reordered.
 *
 * @param {string[]} orderArray - New map order
 * @returns {Promise<void>}
 */
export async function setMapOrder(orderArray) {
    return runTransaction(async tx => {
        const previous = await getMapOrderRepo();
        await recordAtlasSetting(tx, { mapOrder: orderArray },
            previous?.length ? { mapOrder: previous } : null);
        return () => setMapOrderRepo(orderArray);
    });
}

/**
 * Adds a new map.
 *
 * WRITE-AHEAD since 2026-09-13 (bloco B4), and the migration had to split a function that minted
 * and wrote in the same breath. `createMapCompat` assigned the id INSIDE the save, so the only way
 * to learn the id was to have already created the map, which is the opposite of write-ahead.
 * `mintMapDocument` (`store/repositories/index.js`) is the pure half, and the intention now names
 * the final document and the final id while the disk still holds nothing.
 *
 * THE NOTES ARE A SECOND ENTITY, NOT A FIELD, so they get their own intention
 * (`EntityType.MAP_NOTES`) in the same transaction, in the shape `setMapNotes` already records. The
 * old order wrote the notes document BEFORE the map op was logged, so an import interrupted in
 * between left notes belonging to a map no peer had ever heard of.
 *
 * `MAP_CREATED` IS EMITTED FROM `tx.deferSync`, WHICH RUNS AFTER MATERIALIZATION, and that ordering
 * is the point: the event is a flush trigger (`sync/sync-flush.js`), so emitting it before the
 * marks were released would ask the queue to send an operation still stamped as prepared.
 *
 * THE COLOUR CACHE STAYS AWAITED AFTER THE TRANSACTION. It is derived data with no op and no
 * intention (`processMapColors` recounts the colours of the map and writes `colorUsage`), and the
 * callers that hand over `colorUsageData` are the importers, which read the cache right after, so
 * deferring it would answer before it existed. Awaited and post-persistence keeps the contract of
 * the function: when it resolves, everything it promises is there.
 *
 * @param {string} mapName - Map name
 * @param {Object} [mapData=null] - Initial map data
 * @param {Object} [colorUsageData=null] - Color usage data
 * @param {Object} [notesData=null] - Notes data
 * @returns {Promise<Object>} Created map data
 */
export async function addMap(mapName, mapData = null, colorUsageData = null, notesData = null) {
    const perm = checkPermission(GuardAction.CREATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'addMap', reason: perm.reason, required: perm.required });
        return null;
    }

    // When sync is active (connected to a remote atlas), store the new map UUID-keyed from the
    // start — the same keying synced/peer maps use — so a later snapshot re-apply (reconnect /
    // resync / a peer's import-merge-rename) updates the SAME entry instead of duplicating it
    // (a name-keyed local copy + a UUID-keyed snapshot copy of the same logical map).
    const syncActive = isOperationLoggingEnabled();
    const { document: newMapData, storageKey } =
        mintMapDocument(mapName, mapData, { uuidKeyed: syncActive });

    const mapId = newMapData.id || mapName;
    const notes = notesData && (notesData.title || notesData.description) ? notesData : null;

    await withMapDocument(storageKey, 'addMap', () => runTransaction(async (tx) => {
        tx.recordOperation(EntityType.MAP, OperationType.CREATE, mapId, null, newMapData, null);
        if (notes) {
            // Same shape as `setMapNotes`: the map UUID is BOTH the entity id and the map context.
            tx.recordOperation(EntityType.MAP_NOTES, OperationType.CREATE, mapId, mapId, notes, null);
        }

        tx.deferSync(() => {
            // Register the name -> id mapping ONLY when the map is actually UUID-keyed.
            // `mintMapDocument` always mints a UUID (the map needs one to travel as a CRDT
            // op), but with sync OFF that id is inert and the storage key is the NAME.
            // Registering it anyway pointed the resolver at a key that holds nothing:
            // later writes resolved through the resolver and landed under the UUID, while
            // `getMap(name)` kept reading the stale name-keyed entry. Features drawn on a
            // freshly created local map were written to one key and read back from
            // another — they simply vanished.
            // Pinned by tests/integration/import-phantom-map.repro.test.js, which now
            // exercises the real addMap instead of a copy of it.
            //
            // Worth knowing before touching this again: with sync ON the mapping is ALSO
            // registered by LocalRepository.saveMap, so this line is redundant on the happy
            // path. It is kept for the callers that reach the resolver before the save
            // completes; measured by mutation, removing it does not turn any test red today.
            if (syncActive && mapId !== mapName) {
                mapResolver.registerMap(mapName, mapId);
            }
            mapManager.addMapToMemory(mapName);

            // Announce the new map locally so listeners (maps list, locked banner) refresh and
            // the sync auto-flush trigger fires promptly instead of waiting a full interval
            // (§item2). The remote handler emits the same event when a peer's map arrives; the
            // creator only emits here, so there is no double-handling.
            deps.eventBus?.emit(EventTypes.MAP_CREATED, { mapName, mapId });
        });

        return async () => {
            await updateMapData(storageKey, newMapData);
            if (notes) await setMapNotesRepo(mapName, notes);
        };
    }));

    await mapManager.processMapColors(mapName, newMapData, colorUsageData);

    return newMapData;
}

/**
 * Removes a map.
 *
 * WRITE-AHEAD since 2026-09-13 (bloco B4). The old order was the worst one available: it deleted
 * the map document FIRST and logged the `map` DELETE last, with four auxiliary writes in between
 * (memory, groups, badge colour, current map). A failure anywhere in that stretch left the map gone
 * locally and alive on the server, with nothing to replay, and the next snapshot brought it back.
 *
 * THE COLOUR INTENTION TRAVELS IN THIS TRANSACTION, and it no longer goes through
 * `setMapBadgeColors`. That function opens its OWN transaction, and a transaction nested inside
 * another one's `workFn` COMMITS FIRST: the colour would be journaled and written before this
 * deletion had recorded anything, and a deletion that then failed would leave the colour missing
 * for a map that still exists. This is the move the JSDoc of `setMapBadgeColors` prescribed for
 * whoever migrated its last caller.
 *
 * THE THREE LOCAL EFFECTS STAY AWAITED AFTER THE TRANSACTION instead of going to `tx.deferAsync`,
 * and the reason is the CONTRACT of the returned object: it names `newCurrentMap`, so the switch
 * has to have happened by the time the caller reads it. A deferred effect is started and not
 * awaited, so the UI would refresh pointing at a map that was not current yet. They are local,
 * idempotent and carry their own error handling, and none of them owes the server an operation.
 *
 * @param {string} mapName - Map name to remove
 * @returns {Promise<import('./store.types.js').RemoveResult>} Removal result
 */
export async function removeMap(mapName) {
    const perm = checkPermission(GuardAction.DELETE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'removeMap', reason: perm.reason, required: perm.required });
        return { success: false, reason: 'PERMISSION_DENIED' };
    }

    const allMaps = await getAllMapNames();

    if (allMaps.length <= 1) {
        // `reason` is a MACHINE code (the listener buckets by it) and `message` is what the
        // user reads. This block used to put the Portuguese sentence in `reason`, so it fell
        // into the catch-all bucket and the user was told "Acesso somente leitura", which is
        // the wrong explanation entirely: nothing here is about permission.
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'removeMap',
            reason: 'LAST_MAP',
            message: 'Não é possível excluir o único mapa do projeto.'
        });
        return { success: false, reason: 'LAST_MAP' };
    }

    const mapData = await getMapData(mapName);
    if (!mapData || Object.keys(mapData).length === 0) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    const mapId = mapResolver.resolveToId(mapName) || mapName;

    const currentMapName = mapManager.getCurrentMapName();
    const isCurrentMap = mapName === currentMapName;
    const remainingMaps = allMaps.filter(name => name !== mapName);

    // Read BEFORE the transaction opens, so the intention and the write describe the same starting
    // state. A COPY, never the object read above: mutating it in place would ship the already
    // reduced map as the "previous" payload.
    const colors = await getAppSetting('mapBadgeColors');
    let nextColors = null;
    if (colors?.[mapName]) {
        nextColors = { ...colors };
        delete nextColors[mapName];
    }

    await withMapDocument(mapName, 'removeMap', () => runTransaction(async (tx) => {
        tx.recordOperation(EntityType.MAP, OperationType.DELETE, mapId, null, null, mapData);
        if (nextColors) {
            await recordAtlasSetting(tx, { mapBadgeColors: nextColors }, { mapBadgeColors: colors });
        }

        tx.deferSync(() => {
            if (isValidUUID(mapId)) {
                mapResolver.unregisterMapById(mapId);
            }
        });

        return async () => {
            await deleteMapData(mapName);
            if (nextColors) await setAppSetting('mapBadgeColors', nextColors);
        };
    }));

    await mapManager.removeMapFromMemory(mapName);
    await deps.groupManager.clearMapGroups(mapName);

    if (isCurrentMap) {
        await setCurrentMap(remainingMaps[0]);
    }

    return {
        success: true,
        wasCurrentMap: isCurrentMap,
        remainingMapsCount: remainingMaps.length,
        newCurrentMap: isCurrentMap ? remainingMaps[0] : currentMapName
    };
}

/**
 * Renames a map.
 *
 * Both refusals (missing permission, locked map) are expected failures, not caller bugs, so
 * they emit STORE_OPERATION_BLOCKED and report back as `false`. Returning nothing made the
 * refusal indistinguishable from success, and the caller went on to point the current map at a
 * name that was never created.
 *
 * WRITE-AHEAD since 2026-09-13 (bloco B4), and the rename is the entry where "one edit, several
 * documents" bites: the name lives in the map document, in `mapOrder` and in `mapBadgeColors`,
 * and the old shape wrote the three in sequence with the op logged LAST, so a failure between
 * them left the atlas naming the map two different things with nothing to replay. Now the WHOLE
 * section is one transaction inside one `withMapDocument`: every intention is journaled first
 * (the `map` UPDATE plus one `setting` per auxiliary key that actually changes), and the single
 * returned persistence function writes the three documents.
 *
 * WHY THE COLOUR AND ORDER INTENTIONS ARE RECORDED HERE INSTEAD OF CALLING `setMapBadgeColors`
 * AND `setMapOrder`. Each of those opens its OWN transaction, and a transaction nested inside
 * this one's `workFn` COMMITS FIRST: it journals and writes its key before this transaction has
 * recorded a single intention. The ordering the migration exists for would be inverted, and a
 * rename that then failed would leave the colour and the order already naming a map that does not
 * exist, with no intention to replay. So both travel in this `tx` and both keys are written by
 * this transaction's own persistence function.
 *
 * (The note this replaces claimed the symptom of nesting would be a HUNG interface, by the FIFO
 * no-reentrancy rule of `document-lock.js`. Checked in 2026-09-13: that is not this case. Neither
 * `setMapBadgeColors` nor `setMapOrder` takes a document lock (no repository, transaction or queue
 * module calls `withDocumentLock` at all), so nesting them here would have deadlocked nothing and
 * corrupted the ordering silently, which is the worse of the two failures because it stays green.)
 *
 * The op payload is the NAME, not the re-read document. The old code read `getMapData(newName)`
 * back after writing just to fill it, which is one more read through the compatibility fallback
 * (it answers an EMPTY document for a missing map) for a field the peer never uses.
 *
 * Renaming is a READ-MODIFY-WRITE of the whole map document, not a whole-record replacement:
 * `LocalRepository.renameMap` reads the document under the UUID key, mutates `name` and writes it
 * back. Without the lock it races every other writer of the same document, and one of the two
 * writes is silently dropped (measured: renaming while a feature is being drawn lost the rename in
 * 20 of 20 runs, in both orders). The key resolves through the map id, so this excludes against
 * the local user drawing AND against an inbound remote operation on the same map.
 *
 * @param {string} oldName - Current map name
 * @param {string} newName - New map name
 * @returns {Promise<boolean>} True when the map was renamed, false when the rename was refused
 */
export async function renameMap(oldName, newName) {
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'renameMap', reason: perm.reason, required: perm.required });
        return false;
    }

    // THE LOCK IS ASKED OF THE DISK TOO (2026-09-21, the last entry of the N3 inventory). The
    // in-memory set is only COMPLETE on a server atlas; on a LOCAL atlas it holds the current map
    // alone, so renaming ANOTHER locked map passed in silence, and the `map {name}` op targets the
    // map itself, which the server does not lock-gate. `isMapLocked` and not `isTargetMapLocked`:
    // the briefing overlay is about the map being SHOWN, and folding it in here would start
    // refusing a rename during briefing editing, which is a different decision.
    if (memoryStore.lockedMaps.has(oldName) || await isMapLocked(oldName)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'renameMap', reason: 'map_locked' });
        return false;
    }

    await withMapDocument(oldName, 'renameMap', async () => {
        const mapId = mapResolver.resolveToId(oldName) || oldName;

        // Read the auxiliary documents BEFORE the transaction opens, so the intentions and the
        // writes both describe the same starting state.
        const order = await getMapOrderRepo();
        const orderIndex = order?.length > 0 ? order.indexOf(oldName) : -1;
        // A COPY, never the array read above: the previous state has to keep the old name, and
        // mutating in place would ship the already-renamed order as the "previous" payload.
        const nextOrder = orderIndex === -1 ? null : order.map((n, i) => (i === orderIndex ? newName : n));

        const colors = await getAppSetting('mapBadgeColors');
        let nextColors = null;
        if (colors?.[oldName]) {
            nextColors = { ...colors, [newName]: colors[oldName] };
            delete nextColors[oldName];
        }
        // A REVISÃO OBSERVADA, lida junto com os documentos auxiliares e pelo mesmo motivo. Ela é o
        // que faz o servidor verificar esta edição por BASE em vez de aplicá-la por ordem de
        // chegada, e o preço é uma leitura do documento do mapa num gesto que se faz um por vez.
        const revisao = await readMapRevision(oldName);

        return runTransaction(async (tx) => {
            tx.recordOperation(EntityType.MAP, OperationType.UPDATE, mapId, null,
                { name: newName }, { name: oldName, ...revisao });
            if (nextOrder) {
                await recordAtlasSetting(tx, { mapOrder: nextOrder }, { mapOrder: order });
            }
            if (nextColors) {
                await recordAtlasSetting(tx, { mapBadgeColors: nextColors }, { mapBadgeColors: colors });
            }

            // The resolver is renamed AFTER persistence on purpose: `renameMapData(oldName, ...)`
            // resolves the old name through it, so flipping it first would aim the write at a key
            // that holds nothing.
            tx.deferSync(() => {
                mapManager.renameMapInMemory(oldName, newName);
                mapResolver.renameMap(oldName, newName);
            });
            tx.deferAsync(async () => {
                if (mapManager.getCurrentMapName() === newName) {
                    await deps.groupManager.loadGroupsToMemory(newName);
                }
            });

            return async () => {
                await renameMapData(oldName, newName);
                if (nextOrder) await setMapOrderRepo(nextOrder);
                if (nextColors) await setAppSetting('mapBadgeColors', nextColors);
            };
        });
    });

    return true;
}

/**
 * Sets the current map.
 *
 * @param {string} mapName - Map name to set as current
 * @returns {Promise<void>}
 */
export async function setCurrentMap(mapName) {
    await mapManager.setCurrentMap(mapName);
    await deps.groupManager.loadGroupsToMemory(mapName);
    await deps.layerManager.loadLayersToMemory(mapName);

    const locked = memoryStore.lockedMaps.has(mapName);
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName, locked });

    // QUEM ENTRA NUM MAPA ANUNCIA O INTERRUPTOR TEMPORAL DELE, como anuncia a trava logo acima.
    //
    // Desde 2026-09-20 o interruptor é VISTA da pessoa, e `mapManager.setCurrentMap` o FIXA na
    // entrada (a partir do valor salvo) sem emitir nada, porque aquele módulo não pode importar
    // `temporal.operations.js`. O anúncio ficou sem dono, e o defeito medido em 2026-09-21 foi o
    // que sobra disso: a aba de mapas LÊ a vista e mostrava o relógio LIGADO, enquanto a barra da
    // linha do tempo só se atualiza por evento e ficava com a leitura que tinha feito ANTES de o
    // boot trocar de escopo. `applySavedMapTemporalView` não salvava o caso: ela só emite quando o
    // valor MUDA, e a fixação acabara de torná-lo igual. Abrindo o atlas local pela tela de atlas,
    // 1 abertura em 3 ficava com a vista ligada e a barra escondida.
    //
    // `automatico`: ninguém clicou, então a telemetria de uso não conta como ativação.
    deps.eventBus.emit(EventTypes.MAP_TEMPORAL_CHANGED, {
        mapName,
        enabled: memoryStore.temporalView?.get(mapName) === true,
        automatico: true,
    });
}

/**
 * ADOTA O SLOT LOCAL QUE ACABOU DE SER MONTADO: larga o espelho em memoria do atlas que a aba
 * deixou, e torna corrente o ULTIMO mapa do slot novo. NAO APAGA BANCO NENHUM.
 *
 * ELA EXISTE PORQUE `activateAtlasInitialMap` E O INSTRUMENTO ERRADO AQUI, e o motivo esta
 * escrito na propria: ela roda "only AFTER connecting to a server atlas, where every map is
 * UUID-keyed", e APAGA todo mapa cuja chave nao seja UUID, tratando-o como sobra local. Num
 * atlas LOCAL os mapas sao exatamente esses: `Principal` e os que o usuario criou pelo nome.
 * Reaproveitar aquela funcao para a entrada em atlas local apagaria o atlas que se quer abrir.
 *
 * E ELA NAO PODE SER `clearAllDataStore`, QUE E A OUTRA TENTACAO. Aquele wipe esvazia os dez
 * bancos do escopo ATIVO (`repository.clearAllAtlasStores`), e o escopo ativo aqui ja e o slot
 * de destino: o resultado seria destruir o trabalho local que a pessoa pediu para abrir.
 * `switchToNewLocalAtlas` pode chamar o wipe porque o slot dela nasceu vazio uma linha antes;
 * um slot que ja existe nao tem essa propriedade. A necessidade que o wipe atendia ali era
 * outra, e e a que esta funcao atende: derrubar o espelho EM MEMORIA do atlas anterior.
 *
 * A ORDEM E O CONTRATO. Primeiro `resetMemoryStore()`, que zera os mapas, grupos, camadas,
 * pilhas de desfazer, travas, cache de cores, 3D e 360 do atlas que ficou para tras — sem esta
 * linha, um mapa de mesmo NOME nos dois atlas (e `Principal` esta nos dois) seria lido do cache
 * velho. Depois `initializeRepository()`, que e o mesmo passo que o boot roda: ele executa a
 * migracao do slot montado (um slot local guardado em versao antiga so e legivel depois dela),
 * semeia um mapa em branco se o slot estiver vazio, e devolve o ultimo mapa ativo dele. So
 * entao o resolvedor de nome/UUID e refeito, porque ele guarda os mapas do atlas ERRADO ate
 * ser refeito, e e ele que nomeia o mapa na presenca e nos rotulos.
 *
 * `ALL_DATA_CLEARED` E EMITIDO NO FIM, e o nome do evento e mais estreito do que o contrato
 * dele: os dez ouvintes o tratam como "o que voce espelhava sumiu, releia da store", que e
 * literalmente o que acabou de acontecer. E o mesmo sinal que o caminho de atlas de servidor
 * ja manda (por dentro do wipe), e e o que faz a camada base, os comentarios, os icones, o 3D,
 * o 360 e a aba Mapas se curarem sem que ninguem os chame pelo nome.
 *
 * @param {string|null} [preferredMapId] - Um mapa especifico do slot (UUID ou nome). Cai para o
 *   ultimo mapa ativo quando ausente ou nao encontrado.
 * @returns {Promise<string>} O nome do mapa que ficou corrente.
 */
export async function adoptMountedLocalAtlas(preferredMapId = null) {
    resetMemoryStore();
    // O cache do gerente de camadas vive FORA do `memoryStore`, entao o reset acima nao o
    // alcanca. Deixa-lo de pe faria a aba Camadas desenhar as camadas do atlas anterior.
    deps.layerManager.clearLayersCache();

    const lastActive = await initializeRepository({ strict: true, installation: false });

    // O resolvedor e refeito com o repositorio JA montado no slot novo. `clear()` sozinho
    // deixaria a resolucao nome->UUID vazia pelo resto da sessao (nada a reconstroi), e a
    // presenca passa o mapId por ele.
    await mapResolver.initialize(getRepository());

    const chosen = await resolveRequestedLocalMap(preferredMapId) ?? lastActive;
    await setCurrentMap(chosen);
    await loadCesium3dDataToMemory(chosen);
    await loadStreetview360DataToMemory(chosen);

    deps.eventBus.emit(EventTypes.ALL_DATA_CLEARED, { rebuild: true });
    deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
    return chosen;
}

/**
 * O nome do mapa pedido, quando ele existe no slot montado.
 *
 * Aceita UUID e nome porque um atlas local tem as duas formas de endereco: os mapas antigos
 * sao chaveados por nome, e os criados por `addMap` carregam um `id` UUID. Devolver null
 * (em vez de inventar um mapa) e o que deixa o chamador cair no ultimo mapa ativo.
 * @param {string|null} preferredMapId - UUID ou nome do mapa pedido.
 * @returns {Promise<string|null>} O nome do mapa, ou null.
 */
async function resolveRequestedLocalMap(preferredMapId) {
    if (!preferredMapId) return null;
    const all = await getRepository().getAllMaps();
    const entries = all instanceof Map ? [...all.entries()] : Object.entries(all || {});
    for (const [key, data] of entries) {
        if (!data) continue;
        if (data.id === preferredMapId || key === preferredMapId || data.name === preferredMapId) {
            return data.name ?? key;
        }
    }
    return null;
}

/**
 * Descarta os mapas que sobraram no escopo logo ANTES de um import NÃO-ADITIVO gravar os do
 * arquivo. Devolve quantos removeu.
 *
 * O DEFEITO QUE ELA FECHA, medido em 2026-08-28 com `_ebgeo_dados_teste/01-completo.ebgeo`: abrir
 * um `.ebgeo` pela tela cria um slot local novo, cujo boot semeia um "Principal" em branco
 * chaveado pelo NOME (`seedBlankDefaultMap`). O import então grava os onze mapas do arquivo, e
 * `addMap` os chaveia por UUID sempre que o log de operações está ligado, que é o padrão desde
 * `initServices()`. Ficam DOIS registros chamados "Principal": o em branco e o do arquivo. A
 * lista de mapas de-duplica por nome e mostra um cartão só, e toda leitura por nome
 * (`repo.getMap('Principal')`) acerta o em branco por lookup DIRETO, antes do resolver. As 18
 * feições daquele mapa ficavam no disco e fora do alcance da pessoa: nem pelo cartão, nem pela
 * busca, sem erro em lugar nenhum.
 *
 * POR QUE APAGAR TUDO, e não só o homônimo. O import não-aditivo é "substitui o projeto atual", e
 * quando esta função roda o wipe já passou: o que existe é o mapa em branco que o próprio wipe
 * semeou. Apagar só o homônimo deixaria esse mapa em branco ao lado do projeto sempre que o
 * arquivo não trouxesse um mapa com o nome padrão, que é ruído sem dono na lista.
 *
 * O CHAMADOR GUARDA O CASO VAZIO: um arquivo sem mapa nenhum não pode passar por aqui, senão o
 * escopo fica sem mapa e o app não tem o que abrir.
 *
 * Apaga POR CHAVE de armazenamento, nunca por nome. `deleteMap` resolve o argumento, e resolver
 * um nome enquanto dois registros o carregam é escolher entre os dois pelo caminho errado.
 *
 * @returns {Promise<number>} Quantos registros de mapa foram removidos.
 */
export async function discardMapsForReplacingImport() {
    const repo = getRepository();
    const chaves = await repo.getAllMapIds();
    for (const chave of chaves) {
        await repo.deleteMap(chave);
    }
    // O resolver guarda `nome -> chave` do que acabou de sair. Deixar o par morto faria a
    // primeira leitura por nome do mapa recém-importado passar por uma chave que não existe mais
    // (`getMap` cai no scan e se recupera, mas o registro do arquivo é gravado logo abaixo e
    // registra o par certo: limpar aqui evita a janela inteira).
    mapResolver.clear();
    return chaves.length;
}

/**
 * The atlas's OWN order for the maps on disk, as a rank by map id.
 *
 * WHAT IT REPLACES, and why the replacement is the whole point: `repo.getAllMaps()` answers in
 * INDEXEDDB KEY ORDER, and the keys are map UUIDs, so "the first map" read off that list is the
 * map whose random UUID happens to sort lowest. `atlas.mapOrder` is the order the atlas itself
 * declares — the snapshot fills it with the server's maps by creation time, and it is the order
 * the maps tab shows — so it is the same answer in every tab, in every client, and between two
 * boots of the same atlas.
 *
 * A MISSING OR UNREADABLE RECORD IS NOT A REASON TO REFUSE THE BOOT: an empty ranking leaves
 * every candidate tied, and a stable sort then hands back exactly the repository order this
 * function used before, which is the honest degradation.
 *
 * @param {Object} repo - The active repository.
 * @returns {Promise<Map<string, number>>} Map id to its position in the atlas's order.
 * @private
 */
async function atlasMapRanking(repo) {
    let atlas = null;
    try {
        atlas = await repo.getAtlas?.();
    } catch {
        // Unreadable atlas record: fall through to the empty ranking.
    }
    const order = Array.isArray(atlas?.mapOrder) ? atlas.mapOrder : [];
    return new Map(order.map((id, index) => [id, index]));
}

/**
 * Activates the atlas's map after connecting to a server atlas. Opening an atlas
 * pulls its maps into the store but leaves the app on the LOCAL default map
 * ("Principal"), so the user would not see (or sync onto) the shared content. Atlas
 * maps carry a real UUID `id` (the local default does not), so we switch to the
 * first UUID-keyed map. No-op when there is none (e.g. a brand-new empty atlas).
 *
 * "FIRST" IS THE ATLAS'S ORDER, NEVER THE REPOSITORY'S, and until 2026-09-13 it was the
 * repository's. Measured that day in a real browser, six serial runs of the deep-link resume:
 * the landing map was a COIN FLIP, four runs on one map and two on the other, always the one
 * with the lower UUID, because `getAllMaps()` answers in IndexedDB key order. Two collaborators
 * opening the same atlas landed on different maps, and one tab changed its answer between two
 * boots. It only became visible when a server atlas stopped being born empty (`e70ccf3c`,
 * 2026-09-12, seeds a default "Mapa 1" inside `createAtlas`): before that the last step had a
 * single candidate and had nothing to draw lots between.
 *
 * @param {string|null} [preferredMapId] - A specific map UUID to activate (e.g. from a `?map=<uuid>`
 *   deep link). Falls back to the last-active map, then the atlas's first named map, when absent
 *   or unmatched.
 * @returns {Promise<string|null>} The activated map name, or null when none exists.
 */
export async function activateAtlasInitialMap(preferredMapId = null) {
    const repo = getRepository();
    const all = await repo.getAllMaps();
    const entries = all instanceof Map ? [...all.entries()] : Object.entries(all || {});

    // This runs only AFTER connecting to a server atlas, where every map is UUID-keyed. A
    // NON-UUID-keyed map is therefore a local stray — the offline default ('Principal') recreated
    // on boot. If an atlas map shares that name, the stray SHADOWS it on name-based reads
    // (repo.getMap('Principal') direct-hits the stray's key), so the user would land on an EMPTY
    // map. Drop the strays so name resolution reaches the real (UUID-keyed) atlas map.
    const uuidMaps = [];
    for (const [key, data] of entries) {
        if (data && isValidUUID(data.id)) {
            uuidMaps.push(data);
        } else {
            // Local stray (no UUID id) — delete by its storage key so it can't shadow a remote map.
            await repo.deleteMap?.(key);
        }
    }

    // THE ATLAS'S OWN ORDER DECIDES THE LAST STEP. The sort is stable, so a map the atlas does
    // not list keeps its relative repository position and lands after the listed ones.
    const ranking = await atlasMapRanking(repo);
    const rank = (map) => (ranking.has(map?.id) ? ranking.get(map.id) : Number.MAX_SAFE_INTEGER);
    uuidMaps.sort((a, b) => rank(a) - rank(b));

    // Resolution order: an explicitly requested map (e.g. a `?map=<uuid>` deep link) wins; else the
    // map the user was last on (so an F5 reconnect returns there); else the first named atlas map.
    // Resolving BY NAME here is the fix for the UUID-keyed reconnect: setCurrentMap below persists the
    // NAME so the UI label AND the presence/cursor mapId use the name — not the raw UUID storage key
    // the boot repository falls back to (which peers, keyed by name, filter out).
    const lastName = await getAppSetting('lastActiveMap');
    let atlasMap = (preferredMapId && uuidMaps.find((m) => m && m.id === preferredMapId))
        || (lastName && uuidMaps.find((m) => m && m.name === lastName))
        || uuidMaps.find((m) => m && m.name)
        || uuidMaps[0];
    if (!atlasMap) {
        // Brand-new EMPTY atlas: no UUID-keyed map. Create a first atlas map so the user edits a
        // SYNCED map from the start — addMap assigns a UUID and logs a CREATE op that reaches
        // collaborators (§item3). Blocked for a viewer (returns null), which is fine.
        const created = await addMap('Mapa 1');
        if (!created) return null;
        atlasMap = created;
    }
    await setCurrentMap(atlasMap.name);
    return atlasMap.name;
}

/**
 * Gets the current map name (async, from IndexedDB).
 *
 * @returns {Promise<string>} Current map name
 */
export async function getCurrentMapName() {
    return await getAppSetting('lastActiveMap');
}

/**
 * Gets the current map name synchronously.
 *
 * @returns {string} Current map name
 */
export function getCurrentMapNameSync() {
    return mapManager.getCurrentMapName();
}

/**
 * Gets the current map UUID synchronously.
 * Uses MapResolverService for name -> ID resolution.
 *
 * @returns {string} Current map UUID (or name if resolver not initialized)
 */
export function getCurrentMapIdSync() {
    return mapManager.getCurrentMapId();
}

/**
 * Gets both current map name and ID synchronously.
 *
 * @returns {{name: string, id: string}} Object with name and id
 */
export function getCurrentMapInfoSync() {
    return mapManager.getCurrentMapInfo();
}

/**
 * Sets the last active map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export async function setLastActiveMap(mapName) {
    await setAppSetting('lastActiveMap', mapName);
}

/**
 * Sets the schema version.
 *
 * @param {string} schemaVersion - Schema version
 * @returns {Promise<void>}
 */
export async function setSchemaVersion(schemaVersion) {
    await setAppSetting('schemaVersion', schemaVersion);
}

/**
 * Gets map data from storage.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Map data
 */
export async function getMapDataStore(mapName) {
    return await getMapData(mapName);
}

/**
 * Whether ANY map in the store currently has at least one feature. Used to decide whether
 * replacing the local store (opening/creating a server atlas) would destroy local work and
 * therefore needs a confirmation + `.ebgeo` offer (inv 6).
 *
 * @returns {Promise<boolean>}
 */
export async function hasAnyMapFeatures() {
    const names = await getAllMapNamesStore();
    for (const name of names) {
        const data = await getMapData(name);
        const features = data?.features;
        if (features && Object.values(features).some((arr) => Array.isArray(arr) && arr.length > 0)) {
            return true;
        }
    }
    return false;
}

// ===== MAP CONFIGURATION =====

/**
 * THE LOCK QUESTION OF EVERY MAP-SETTING WRITE, for a map that may NOT be the current one.
 *
 * The three functions below all accept an explicit `mapName` and all used to ask
 * `isCurrentMapLockedSync()`, which reads `memoryStore.lockedMaps` — a set that is COMPLETE
 * only in a SERVER atlas, and in a LOCAL atlas holds the current map alone, because only
 * `toggleMapLock` writes it. Asking that set about ANOTHER map answers "unlocked" for a locked
 * map, silently, in the half of the product where nobody looks for lock defects (see
 * `.claude/rules/architecture.md`, "A TRAVA DE OUTRO MAPA"). `isMapLocked` reads the app
 * setting from disk, which every writer keeps current: `toggleMapLock` persists BEFORE
 * touching memory, and the remote snapshot writes `mapLocked_<name>` alongside the set — so
 * the current map keeps behaving exactly as it did.
 *
 * The briefing override is re-asked here because it lives in memory ONLY, by design: it makes
 * every map read-only during briefing edit/present without persisting a lock, so disk cannot
 * know about it. Reading disk alone would have re-opened writing during a briefing.
 *
 * IT IS EXPORTED SINCE 2026-09-21 (ponto N3), AND THE EXPORT IS THE POINT. The server only
 * enforces `maps.locked` against operations whose target is a CHILD of the map
 * (`LOCKABLE_CHILD_TARGETS`, `backend/src/modules/sync/sync.service.js`: feature, group, layer,
 * cesium3d, streetview360, catalog_layer, group_feature). An adjustment of the map ITSELF
 * (position, base layer, notes, grid, temporal config) has the MAP as its target, so it passes
 * the server gate and the client is the ONLY point of enforcement that exists for it. The owner
 * decided on 2026-09-21 not to close that on the server and to treat these writes as a client
 * convention, like the layer, group and feature locks already are — and a convention only holds
 * if every writer asks the SAME question. `setMapNotes` and `setGridStyle`
 * (`settings.operations.js`) import this one; asking `isCurrentMapLockedSync()` there ignored
 * their own `mapName` argument and answered about whatever map happened to be on screen.
 *
 * @param {string} targetMap - Map name (already resolved, never null)
 * @returns {Promise<boolean>} True when that map must refuse writes
 */
export async function isTargetMapLocked(targetMap) {
    if (briefingLockOverride) return true;
    return isMapLocked(targetMap);
}

/**
 * Refuses a map-setting write whose document has no remote identity, WITH A VOICE.
 *
 * `getMapDataCompat` answers a MISSING map with `getEmptyMapData()`, a full-shaped document with
 * no `id`. Writing it back CREATES that map, so a stale name (a peer's deletion that arrived
 * after this gesture started) would resurrect it as a local phantom whose op then carries a map
 * id the server never issued. The same condition as the gesture door of `mapa-inexistente.js`,
 * seen by the `id` instead of by the absence. A LOCAL atlas is untouched: its maps are name-keyed
 * by design.
 *
 * IT USED TO THROW (until 2026-09-21), and a refusal that throws never reaches the global refusal
 * listener: this was the only map-missing refusal of the store with no phrase. It now emits
 * `map_missing` and the caller returns a no-op persistence.
 *
 * AND IT STAYS INSIDE THE TRANSACTION, on the document the transaction itself read. The first
 * version of this fix asked the gesture door BEFORE the transaction, and
 * `tests/integration/map-settings-write-ahead.test.js` refused it the same day: that made the first
 * disk read happen outside the transaction, so an atlas switch during it was no longer caught by
 * the scope stamp, and the write could land in the OTHER atlas.
 *
 * @param {import('./store-transaction.js').StoreTransaction} tx - The open transaction
 * @param {Object} mapData - The document just read
 * @param {string} targetMap - Map name or id, for the refusal payload
 * @param {string} operation - Operation name, for the refusal payload
 * @returns {boolean} True when the write was REFUSED (the caller must not write)
 * @private
 */
function refusesMissingRemoteMap(tx, mapData, targetMap, operation) {
    if (tx.scope?.kind === 'remote' && !isValidUUID(mapData?.id)) {
        recusarMapaInexistente(operation, targetMap);
        return true;
    }
    return false;
}

/**
 * Runs a write-ahead map-setting transaction, turning "the atlas is being rebuilt" into an
 * EXPECTED refusal instead of a thrown failure.
 *
 * THE MEASURED DEFECT, 2026-09-13. Opening a server atlas ends in `switchMap`, which persists the
 * sanitised base layer through `setBaseLayer`. Since the three settings became write-ahead
 * (`runTransaction` inside `withMapDocument`) that write asks `beginStoreWrite`, and the WS
 * handshake of the very same open answers with a SECOND snapshot whose `applyRemoteSnapshot`
 * holds `pauseStoreWrites` for this scope. The refusal was a thrown `Error` nobody on that path
 * catches, so it escaped `switchMap`, escaped `openRemoteAtlas` (the paint is outside its
 * try/catch), and `openAtlasFromUrl` read the whole open as failed: the boot fell through to
 * `openAtlasChooserOnBoot`, which NAVIGATES to `atlas.html`. An atlas that was already connected
 * and mounted bounced the user back to the chooser, and the map page went away with it.
 *
 * THE THREE-CASE RULE DECIDES THE SHAPE. A recovery in progress is a reversible STATE, not a bad
 * argument and not a risk of losing data, so the answer is `return` plus
 * `STORE_OPERATION_BLOCKED` — the same shape the permission gate and the map-lock gate already
 * use in these three functions. Only the PERSISTENCE of the setting is refused; the drawing that
 * the caller does next is untouched, which is what those functions already promise in prose.
 *
 * IT IS A CATCH AND NOT A PRE-FLIGHT QUESTION. `storeWritesPaused()` would answer the same thing
 * one await earlier, and the pause can start in between: asking first would leave exactly the
 * interleaving that produced the defect. Every other error still propagates.
 *
 * IT DOES NOT CHANGE WHAT THE CALLER IS TOLD, and that is deliberate: the two gates above it in
 * each of these three functions (posto and map lock) already `return` without a value, so
 * `mapManager.saveMapPosition` already answers "Posição salva" for a refused write and lets the
 * blocked-event listener carry the real sentence. Making the recovery refusal behave like its two
 * siblings adds no new claim; teaching those wrappers to read a refusal is a separate change with
 * three cases, not one.
 *
 * @param {string} operation - Operation name for the blocked event, as the other gates report it.
 * @param {() => Promise<*>} run - The `withMapDocument`/`runTransaction` body.
 * @returns {Promise<void>} Resolves either way; the refusal is announced, never thrown.
 * @private
 */
async function refusingDuringRecovery(operation, run) {
    try {
        await run();
    } catch (error) {
        if (!isStoreRecoveryRefusal(error)) throw error;
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation,
            reason: STORE_RECOVERY_NOTICE,
            timestamp: Date.now()
        });
    }
}

/**
 * Gets the current base layer for a map.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<string>} Base layer ID
 */
export async function getCurrentBaseLayer(mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.baseLayer;
}

/**
 * Sets the base layer for a map.
 *
 * @param {string} layer - Base layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function setBaseLayer(layer, mapName = null) {
    // Same gate and same reason as the map settings in `settings.operations.js`: this function
    // journals a `baseLayer` op, which the server refuses for a reader, and a refused op stalls
    // the whole outbound queue. Permissive offline and on a local store, so
    // the anonymous user and the `.ebgeo` import path are untouched. The boot-time sanitising
    // call in `base-layer.control.js` keeps rendering the fallback either way: only the
    // PERSISTENCE of someone else's map preference is refused, never the drawing.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'setBaseLayer', reason: perm.reason, required: perm.required });
        return;
    }

    if (!config.basemaps[layer]?.enabled) {
        const fallback = config.getValidBasemapFallback();
        console.warn(`Base layer "${layer}" not enabled. Using "${fallback}".`);
        layer = fallback;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    // A RECUSA FALA, e até 2026-09-21 ela era um `console.warn` que ninguém lê. O mapa travado é
    // bloqueio por ESTADO, reversível, e o clique é como o motivo chega à pessoa: o listener
    // global de `STORE_OPERATION_BLOCKED` (`store/store-error-listener.js`) já tem a frase de
    // `map_locked`, então emitir é o que faz a tela dizer o que aconteceu. É a mesma forma dos
    // dois gates acima e ao lado (papel, e a recusa por recuperação em `refusingDuringRecovery`),
    // que já emitem: só este eixo era mudo, nas três funções deste bloco.
    if (await isTargetMapLocked(targetMap)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'setBaseLayer', reason: 'map_locked' });
        return;
    }

    // The base layer lives on the map document, so this read-modify-write competes with the
    // feature writes: without the lock, a feature added meanwhile is silently reverted here.
    // WRITE-AHEAD: the intention is journaled INSIDE the transaction and the document write is
    // the returned persistence function, so a journal failure leaves the document untouched and
    // a document failure leaves a recoverable intention behind (see `store-transaction.js`).
    return refusingDuringRecovery('setBaseLayer', () => withMapDocument(targetMap, 'setBaseLayer', () => runTransaction(async tx => {
        const currentMapData = await getMapData(targetMap);
        if (refusesMissingRemoteMap(tx, currentMapData, targetMap, 'setBaseLayer')) return async () => {};
        const previousBaseLayer = currentMapData.baseLayer;

        currentMapData.baseLayer = layer;

        const mapId = mapResolver.resolveToId(targetMap) || targetMap;
        // A revisão sai do documento que esta função JÁ leu, então a declaração de base não custa
        // leitura nenhuma aqui (ver o cabeçalho de `map-revision.js`). Ela fica na MESMA linha do
        // payload anterior de propósito: `tests/unit/referencias-de-recurso-censo.test.js` conta
        // LINHAS que citam o campo, e quebrar esta em duas move um número que descreve superfícies
        // de referência, não formatação.
        tx.recordOperation(EntityType.BASE_LAYER, OperationType.UPDATE, mapId, mapId,
            { baseLayer: layer }, { baseLayer: previousBaseLayer, ...mapRevisionOf(currentMapData) });
        return () => updateMapData(targetMap, currentMapData);
    })));
}

/**
 * Updates the map position.
 *
 * @param {number} center_lat - Center latitude
 * @param {number} center_long - Center longitude
 * @param {number} zoom - Zoom level
 * @param {number} bearing - Bearing
 * @param {number} pitch - Pitch
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function updateMapPosition(center_lat, center_long, zoom, bearing, pitch, mapName = null) {
    // Same gate as `setBaseLayer` above: this function journals a `mapPosition` op the server
    // refuses for a reader. This one is only reached through the explicit "salvar posição"
    // gesture (`map.manager.saveMapPosition`), never on pan or zoom, so the gate costs one
    // refusal per click and not one per frame.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'updateMapPosition', reason: perm.reason, required: perm.required });
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    // Fala pela mesma razão de `setBaseLayer` acima. O menu por mapa já desenha "Salvar posição"
    // e recusa o clique nomeando a trava (`mapMenuActions`, `sidebar/tabs/map-menu-actions.js`),
    // então na prática esta recusa é a segunda linha; ela existe para o chamador que não passa
    // por aquele menu, e um segundo aviso é melhor que nenhum.
    if (await isTargetMapLocked(targetMap)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'updateMapPosition', reason: 'map_locked' });
        return;
    }

    // WRITE-AHEAD, same shape as `setBaseLayer`: the position op is recorded before the document
    // is written, and the document write is the returned persistence function.
    return refusingDuringRecovery('updateMapPosition', () => withMapDocument(targetMap, 'updateMapPosition', () => runTransaction(async tx => {
        const currentMapData = await getMapData(targetMap);
        if (refusesMissingRemoteMap(tx, currentMapData, targetMap, 'updateMapPosition')) return async () => {};

        const existingPosition = currentMapData.savedPosition;
        // A revisão viaja no `previousData` da posição, e ela é a do MAPA, porque a posição é uma
        // unidade dele e não uma entidade própria no servidor.
        //
        // ELA VIAJA TAMBÉM NA PRIMEIRA GRAVAÇÃO, e isso mudou em 2026-09-16. O racional antigo era
        // "sem posição anterior não há `previousData`, e uma criação não observa revisão nenhuma";
        // ele caiu junto com o `create`, porque a op deixou de ser criação: uma posição salva é um
        // conjunto de COLUNAS de um mapa que já existe, e a revisão que ela observa é a do mapa,
        // que existe desde o primeiro `pull`. Sem isto, a primeira posição salva de cada mapa
        // continuaria sendo aplicada por ordem de chegada. É a mesma forma que `setGridStyle` e
        // `setMapNotes` usam, e o `{}` de um documento sem revisão degrada para o mesmo LWW de
        // antes, sem prometer base nenhuma.
        const previousData = { ...(existingPosition ?? {}), ...mapRevisionOf(currentMapData) };

        const sync = existingPosition?.sync
            ? touchSyncMetadata(existingPosition.sync)
            : createSyncMetadata(null);

        currentMapData.savedPosition = {
            id: existingPosition?.id || generateUUID(),
            center_lat,
            center_long,
            zoom,
            bearing,
            pitch,
            savedAt: Date.now(),
            sync
        };

        // Legacy fields for backward compatibility
        currentMapData.center_lat = center_lat;
        currentMapData.center_long = center_long;
        currentMapData.zoom = zoom;
        currentMapData.bearing = bearing;
        currentMapData.pitch = pitch;

        const mapId = mapResolver.resolveToId(targetMap) || targetMap;
        // SEMPRE `update`, pela razão escrita por extenso em `setGridStyle`
        // (`settings.operations.js`): a posição salva é um conjunto de COLUNAS de um mapa que já
        // existe, e não uma linha própria. `create` mandava a op para o ramo de criação de mapa,
        // que insere a linha inteira com o nome nulo, e a primeira posição salva de cada mapa
        // voltava recusada por integridade; e um `create` não monta patch, então a disputa saía
        // sobre o bloco em vez da unidade. A base observada não depende disto: ela viaja no
        // `previousData` acima.
        tx.recordOperation(EntityType.MAP_POSITION, OperationType.UPDATE, mapId, mapId,
            currentMapData.savedPosition, previousData);
        return () => updateMapData(targetMap, currentMapData);
    })));
}

/**
 * Gets the map position.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').MapPosition>} Map position
 */
export async function getMapPosition(mapName) {
    const currentMapData = await getMapData(mapName);
    return {
        center_lat: currentMapData.center_lat,
        center_long: currentMapData.center_long,
        zoom: currentMapData.zoom,
        bearing: currentMapData.bearing,
        pitch: currentMapData.pitch
    };
}

/**
 * Checks if a map has a saved position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} True if has saved position
 */
export async function hasMapSavedPosition(mapName = null) {
    const position = await getMapPosition(mapName);
    return POSITION_FIELDS.every(field => position[field] !== null);
}

/**
 * Clears the map position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function clearMapPosition(mapName = null) {
    // Same gate and same reason as the two siblings above: this function journals a `mapPosition`
    // op the server refuses for a reader, and a refused op stalls the whole outbound queue.
    // This one was the only one of the three without it.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'clearMapPosition', reason: perm.reason, required: perm.required });
        return;
    }

    const targetMapName = mapName || mapManager.getCurrentMapName();
    // Fala pela mesma razão das duas irmãs acima.
    if (await isTargetMapLocked(targetMapName)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'clearMapPosition', reason: 'map_locked' });
        return;
    }

    // WRITE-AHEAD, same shape as the two siblings above.
    return refusingDuringRecovery('clearMapPosition', () => withMapDocument(targetMapName, 'clearMapPosition', () => runTransaction(async tx => {
        const currentMapData = await getMapData(targetMapName);
        if (refusesMissingRemoteMap(tx, currentMapData, targetMapName, 'clearMapPosition')) return async () => {};

        const existingPosition = currentMapData.savedPosition;
        // A revisão do MAPA vai junto, do documento já lido: é ela que faz o servidor verificar
        // esta limpeza por base em vez de aplicá-la por chegada.
        const previousData = existingPosition
            ? { ...existingPosition, ...mapRevisionOf(currentMapData) }
            : null;

        delete currentMapData.savedPosition;

        for (const field of POSITION_FIELDS) {
            currentMapData[field] = null;
        }

        // AN UPDATE WITH EMPTY COLUMNS, NEVER A DELETE. This used to log a DELETE, and on the
        // server that is an act on the MAP: a map-setting op carries the MAP's id as its
        // `entityId` (`createMapSettingLogger`), the `mapPosition` type normalises to the
        // target `map`, and the delete path never read the sub-type, so clearing a position
        // soft-deleted the whole map (achado F1, measured 2026-09-13; the server now refuses
        // that envelope by name, and this is the envelope it tells the client to send). The
        // five keys ARE `MAP_SUBTYPE_FIELDS.position`, the only columns a position update may
        // touch, and the server turns the two NOT NULL ones (bearing/pitch) into zero.
        //
        // Logged UNCONDITIONALLY. The old `if (positionId)` skipped the op for a LEGACY map,
        // whose position lives in the flat fields with no `savedPosition` object to carry an
        // id: the local document cleared and the peer kept the old position forever, with
        // nothing on screen and nothing in the queue.
        const mapId = mapResolver.resolveToId(targetMapName) || targetMapName;
        tx.recordOperation(EntityType.MAP_POSITION, OperationType.UPDATE, mapId, mapId,
            clearedPositionPayload(), previousData);
        return () => updateMapData(targetMapName, currentMapData);
    })));
}

// ===== UNDO/REDO =====

// Undo/redo has ONE public entry point: `undoLastAction`/`redoLastAction` in
// store.js, which bind the feature executors and refuse to run on a locked map.
// This file used to export homonyms that forwarded straight to the state manager
// WITHOUT the lock guard; nothing imported them (store.js never re-exported them,
// so the `@store` barrel only ever exposed the guarded pair) and importing the
// wrong one would have silently bypassed the map lock. Pinned by
// tests/store/undo-redo-lock-guard.test.js.

// ===== COLOR TRACKING =====

/**
 * Gets frequently used colors.
 *
 * @param {number} [limit=10] - Maximum colors to return
 * @param {string} [scope='current'] - Scope ('current' or 'project')
 * @returns {string[]} Array of hex colors
 */
export function getFrequentColors(limit = 10, scope = 'current') {
    return mapManager.getFrequentColors(limit, scope);
}

// ===== MAP BADGE COLORS =====

// MAP_BADGE_COLORS + mapBadgeColorForName live in ./map-badge-colors.js (pure, Node-testable).

/**
 * Finds the least-used color from the palette given current usage counts.
 *
 * @param {string[]} usedColors - Array of currently used color values
 * @returns {string} Least-used color from the palette
 */
function findLeastUsedColor(usedColors) {
    const colorCounts = {};
    for (const c of MAP_BADGE_COLORS) {
        colorCounts[c] = 0;
    }
    for (const c of usedColors) {
        if (colorCounts[c] !== undefined) {
            colorCounts[c]++;
        }
    }
    return MAP_BADGE_COLORS.reduce((min, c) =>
        colorCounts[c] < colorCounts[min] ? c : min
    , MAP_BADGE_COLORS[0]);
}

/**
 * Gets map badge colors from storage.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export async function getMapBadgeColors() {
    const colors = await getAppSetting('mapBadgeColors');
    return colors || {};
}

/**
 * Sets map badge colors to storage.
 *
 * datamodel-13: the full map-name→color object travels to the atlas as one `setting` op (the
 * backend deep-merges `mapBadgeColors` into `atlas.settings`), and since 2026-09-13 that
 * intention is journaled BEFORE the local setting is written. Single chokepoint: add, remove and
 * rename all funnel through here.
 *
 * IT OPENS ITS OWN TRANSACTION, AND THAT IS SAFE ONLY BECAUSE OF WHERE IT IS CALLED FROM. The
 * three remaining callers are all in this file (`getMapBadgeColor`, `removeMapBadgeColor`,
 * `getAllMapBadgeColors`) and NONE of them has an open transaction at the call point. A transaction
 * nested inside another one's `workFn` COMMITS FIRST, so the colour would be journaled and written
 * before the parent had recorded anything, and a parent that then failed would leave the colour
 * naming a map that does not exist.
 *
 * `renameMap` AND `removeMap` WERE two of the callers and stopped being so in 2026-09-13, when
 * they became write-ahead: each records the colour intention in its OWN `tx` and writes the key
 * directly, which is the move the previous version of this paragraph prescribed for whoever
 * migrated them (that version predicted a HUNG interface as the symptom of nesting, by the
 * reentrancy rule of `document-lock.js`; checked on the same date, this path takes no document
 * lock, so the symptom is the silent inversion above, which is worse because it stays green). The
 * three callers left are the READ paths of this file, which assign a colour as a side effect
 * (`getMapBadgeColor`, `removeMapBadgeColor`, `getAllMapBadgeColors`), and none of them has an open
 * transaction at the call point. Pinned by the rename/remove cases of
 * `tests/integration/atlas-keys-write-ahead.test.js` and by the rename and remove cases of
 * `tests/integration/map-settings-write-ahead.test.js`.
 *
 * @param {Object} colors - Map of mapName -> color
 * @returns {Promise<void>}
 */
export async function setMapBadgeColors(colors) {
    return runTransaction(async tx => {
        const previous = await getAppSetting('mapBadgeColors');
        await recordAtlasSetting(tx, { mapBadgeColors: colors },
            previous ? { mapBadgeColors: previous } : null);
        return () => setAppSetting('mapBadgeColors', colors);
    });
}

/**
 * Gets the badge color for a specific map.
 * If the map doesn't have a color, assigns one.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<string>} Hex color
 */
export async function getMapBadgeColor(mapName) {
    const colors = await getMapBadgeColors();

    if (colors[mapName]) {
        return colors[mapName];
    }

    const usedColors = Object.values(colors);
    const availableColor = MAP_BADGE_COLORS.find(c => !usedColors.includes(c));
    const newColor = availableColor || findLeastUsedColor(usedColors);

    colors[mapName] = newColor;
    await setMapBadgeColors(colors);
    return newColor;
}

/**
 * Removes the badge color for a map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export async function removeMapBadgeColor(mapName) {
    const colors = await getMapBadgeColors();
    delete colors[mapName];
    await setMapBadgeColors(colors);
}

/**
 * Gets all map badge colors, assigning colors to maps that don't have one.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export async function getAllMapBadgeColors() {
    const allMaps = await getAllMapNames();
    const colors = await getMapBadgeColors();

    // Remove colors for maps that no longer exist
    const existingMapSet = new Set(allMaps);
    let changed = false;
    for (const mapName of Object.keys(colors)) {
        if (!existingMapSet.has(mapName)) {
            delete colors[mapName];
            changed = true;
        }
    }

    // Assign colors to maps that don't have one
    const usedColors = new Set(Object.values(colors));

    for (const mapName of allMaps) {
        if (!colors[mapName]) {
            const availableColor = MAP_BADGE_COLORS.find(c => !usedColors.has(c));
            const newColor = availableColor || findLeastUsedColor(Object.values(colors));

            colors[mapName] = newColor;
            usedColors.add(newColor);
            changed = true;
        }
    }

    if (changed) {
        await setMapBadgeColors(colors);
    }

    return colors;
}

/**
 * Derived (non-persistent) badge colors for the maps UI, keyed by DISPLAY NAME — the exact key
 * every badge UI uses — so a map's color matches across the current-map card, the maps list, and
 * the recent-map rail (unlike the persisted store, which is keyed by raw UUID/name storage keys and
 * therefore misses on name lookups for synced maps). The color is a STABLE function of the map NAME
 * (mapBadgeColorForName), so reordering maps NEVER recolors them (the previous position-based
 * assignment did, which was confusing) and every collaborator sees the same color without syncing.
 *
 * @returns {Promise<Object<string,string>>} Map of display name -> hex color
 */
export async function getOrderedMapBadgeColors() {
    const names = await getAllMapNamesStore();
    const colors = {};
    for (const name of names) {
        colors[name] = mapBadgeColorForName(name);
    }
    return colors;
}

// ===== MAP LOCK (READ-ONLY) =====

/**
 * Gets lock state for a map (async, from IndexedDB).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map is locked
 */
export async function isMapLocked(mapName = null) {
    const target = mapName || mapManager.getCurrentMapName();
    return !!(await getAppSetting(`mapLocked_${target}`));
}

/**
 * Gets lock state for current map (synchronous, from memory cache).
 * Use this in guards and hot paths that cannot await.
 *
 * @returns {boolean} True if current map is locked
 */
export function isCurrentMapLockedSync() {
    if (briefingLockOverride) return true;
    return memoryStore.lockedMaps.has(memoryStore.currentMap);
}

/**
 * Toggles lock state for a map.
 * Persists to IndexedDB, updates memory cache, emits MAP_LOCK_CHANGED.
 *
 * THERE USED TO BE TWO ENTRY POINTS AND ONLY ONE OF THEM SYNCED, and unifying them is the whole
 * change of 2026-09-13. This op wrote the app setting, updated the memory set and emitted the
 * event WITHOUT logging anything, so called on its own it was the local state of whoever called it;
 * what made the lock travel was `mapLockController.toggleMapLock`
 * (`locking/map-lock.controller.js`), which called this and then logged a `map` update by hand.
 * Two consequences, both real: a test (or any other caller) that used the raw op locked only its
 * own client, and the op that DID travel was born outside any transaction, after the local write.
 * Now the intention is journaled here, before the app setting is written, and the controller only
 * calls this.
 *
 * THE OP IS A `map` UPDATE CARRYING ONLY `{ locked }`, which is what the server's dynamic update
 * expects, and the peer now MERGES it into its record instead of replacing the record with it
 * (see `mergeRemoteMapUpdate`, `sync/remote-operation-handler.js`).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean|null>} New lock state, or null when the guard refused
 */
export async function toggleMapLock(mapName = null) {
    const perm = checkPermission(GuardAction.LOCK_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'toggleMapLock', reason: perm.reason, required: perm.required });
        return null;
    }

    const target = mapName || mapManager.getCurrentMapName();
    const current = await isMapLocked(target);
    const newState = !current;
    // The map UUID, never the name: a non-UUID entity id never matches a row on the backend, and
    // the lock would land on neither the server nor the peers.
    const mapId = mapResolver.resolveToId(target) || target;
    // A REVISÃO OBSERVADA, lida ANTES da trava do documento: dentro dela a leitura seria a mesma,
    // e fora dela ela não segura a fila FIFO do documento por nada. Sem esta linha a troca de
    // trava é aplicada por ordem de chegada, que é o regime que o mapa inteiro tinha.
    const revisao = await readMapRevision(target);

    await withMapDocument(target, 'toggleMapLock', () => runTransaction(async (tx) => {
        tx.recordOperation(EntityType.MAP, OperationType.UPDATE, mapId, null,
            { locked: newState }, { locked: current, ...revisao });

        tx.deferSync(() => {
            if (newState) {
                memoryStore.lockedMaps.add(target);
            } else {
                memoryStore.lockedMaps.delete(target);
            }
            deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName: target, locked: newState });
        });

        return () => setAppSetting(`mapLocked_${target}`, newState);
    }));

    return newState;
}
