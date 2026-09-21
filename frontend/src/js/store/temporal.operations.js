// Path: js/store/temporal.operations.js

/**
 * @fileoverview Per-map temporal configuration operations.
 *
 * Temporal control is enabled per map. Config is persisted in appStore under
 * `temporal_<mapName>` (mirroring the map-lock pattern) and cached in
 * `memoryStore.temporalConfigs` for synchronous reads on hot paths (render,
 * filters). Config shape: `{ ativo, unidade, inicio, fim, modo, origem }` — the
 * authoritative list is `DEFAULT_TEMPORAL_CONFIG` (`temporal/temporal.constants.js:49`).
 * `modo` and `origem` are the display lens (absoluto vs relativo D+N and its
 * D-origin); they never mutate feature times.
 *
 * `ativo` HAS TWO VALUES SINCE 2026-09-20, AND ONLY ONE OF THEM TRAVELS (owner's decision,
 * registered in docs/decisions/decisions-2026.md). The switch on the screen is VIEW state of
 * this person, exactly like the camera and the base layer: it lives in
 * `memoryStore.temporalView`, is never persisted and never enqueues an op, so a reader and a
 * locked map keep it, and a colleague flipping theirs does not flip anyone else's. The `ativo`
 * inside the stored config is the SAVED value, part of the saved view of the map, and exactly
 * one function writes it: `setMapTemporalSaved`, called by the "save view" gesture
 * (`map-view.operations.js`). Everything else of the config (window, unit, lens) stays a synced
 * map setting.
 *
 * THE VIEW IS PINNED ON ENTRY, by `setCurrentMap` (`store-state-manager.js`, inline there because
 * this module imports that one). Without an entry the readers below answer the saved value, so a
 * colleague saving THEIR view of a map would flip the timeline of everyone who is on it and never
 * touched the switch. Pinning freezes what the person saw when they came in; a saved value that
 * arrives later is picked up on the NEXT entry, like a saved camera.
 *
 * THE PIN IS SILENT, SO THE ENTRY ANNOUNCES IT: `setCurrentMap` of `map.operations.js` emits
 * `MAP_TEMPORAL_CHANGED` (flagged `automatico`) right after the pin, next to the lock event it
 * already emits. `setMapTemporalView` below emits only when the value CHANGES, and the pin has just
 * made it equal, so without that announcement the timeline bar (event-driven) kept whatever it had
 * read before, while the maps tab (which READS the view) showed the clock on (2026-09-21).
 *
 * THE TRAP THIS SPLIT CLOSES BY CONSTRUCTION: the server replaces `temporal_config` with the
 * keys the op carries, so the payload must KEEP carrying `ativo`, and it must be the SAVED one.
 * `setMapTemporalConfig` therefore drops any `ativo` from the patch it receives: no caller of
 * the config op can leak the on-screen switch into the shared document, not even by accident.
 */

import { getSettingCompat, setSettingCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { getEventBus } from './services.js';
import { EventTypes } from '../events';
import { withSideDocument } from './document-lock.js';
import { DEFAULT_TEMPORAL_CONFIG } from '../temporal/temporal.constants.js';
import { OperationType } from './sync/operation-dispatcher.js';
// Leaf module (zero imports): keeps the vocabulary out of the dispatcher's graph.
import { EntityType } from './sync/operation-types.js';
import { runTransaction } from './store-transaction.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { readMapRevision } from './map-revision.js';

const STORE_PREFIX = 'temporal_';

/**
 * Merges a stored (possibly partial/null) config with defaults.
 * @param {Object|null} raw - Stored config.
 * @returns {{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null), modo: string, origem: (number|null)}}
 */
function withDefaults(raw) {
    return { ...DEFAULT_TEMPORAL_CONFIG, ...(raw || {}) };
}

function resolveMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Reads the full temporal config for a map from IndexedDB (merged with defaults).
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null)}>}
 */
export async function getMapTemporalConfig(mapName = null) {
    const target = resolveMapName(mapName);
    const raw = await getSettingCompat(`${STORE_PREFIX}${target}`);
    const config = withDefaults(raw);
    memoryStore.temporalConfigs.set(target, raw || config);
    return config;
}

/**
 * Reads the temporal config for a map from the synchronous memory cache.
 * Use on hot paths (render/filters). Falls back to defaults when uncached.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null), modo: string, origem: (number|null)}}
 */
export function getMapTemporalConfigSync(mapName = null) {
    const target = resolveMapName(mapName);
    return withDefaults(memoryStore.temporalConfigs.get(target));
}

/**
 * The SAVED switch of a map, from the synchronous cache: what the "save view" gesture wrote.
 * @param {string} target - Resolved map name.
 * @returns {boolean}
 * @private
 */
function savedEnabledSync(target) {
    return withDefaults(memoryStore.temporalConfigs.get(target)).ativo === true;
}

/**
 * Whether temporal control is ON THE SCREEN for a map (synchronous).
 *
 * The answer is the VIEW state of this session when the map has one, and the saved value
 * otherwise. Every consumer (timeline, 3D markers, 360 markers, PDF export, the maps tab) asks
 * what the person is looking at, which is why the name did not change when the meaning did.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {boolean}
 */
export function isMapTemporalEnabledSync(mapName = null) {
    const target = resolveMapName(mapName);
    const view = memoryStore.temporalView.get(target);
    return typeof view === 'boolean' ? view : savedEnabledSync(target);
}

/**
 * Whether temporal control is ON THE SCREEN for a map (async: warms the config cache first).
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>}
 */
export async function isMapTemporalEnabled(mapName = null) {
    const target = resolveMapName(mapName);
    const config = await getMapTemporalConfig(target);
    const view = memoryStore.temporalView.get(target);
    return typeof view === 'boolean' ? view : config.ativo === true;
}

/**
 * The SAVED switch of a map (async, from IndexedDB): part of the saved view of the map.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>}
 */
export async function isMapTemporalSavedEnabled(mapName = null) {
    return (await getMapTemporalConfig(mapName)).ativo === true;
}

/**
 * Sets the ON-SCREEN switch of a map. View state: no permission gate, no lock gate, no
 * persistence and no sync op, by design (see the file overview).
 *
 * @param {string|null} mapName - Map name (null = current).
 * @param {boolean} enabled - The switch the person wants on their own screen.
 * @param {{automatico?: boolean}} [options] - `automatico` when no gesture asked for the flip.
 * @returns {boolean} The state now on screen.
 */
export function setMapTemporalView(mapName, enabled, { automatico = false } = {}) {
    const target = resolveMapName(mapName);
    const next = enabled === true;
    const previous = isMapTemporalEnabledSync(target);
    memoryStore.temporalView.set(target, next);
    if (next !== previous) {
        // `automatico` MARKS A FLIP NOBODY CLICKED (the saved view applied on entering a map, a
        // briefing slide). One subscriber reads it: usage telemetry counts `temporal.ativado` on
        // this event, and an applied saved view is not a person turning the timeline on.
        const payload = { mapName: target, enabled: next };
        if (automatico) payload.automatico = true;
        getEventBus()?.emit(EventTypes.MAP_TEMPORAL_CHANGED, payload);
    }
    return next;
}

/**
 * Applies the SAVED switch to the screen: the temporal third of "entering a map that has a
 * saved view", next to the camera and the base layer (`BaseLayerControl.switchMap`).
 *
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>} The state now on screen.
 */
export async function applySavedMapTemporalView(mapName = null) {
    const target = resolveMapName(mapName);
    return setMapTemporalView(target, await isMapTemporalSavedEnabled(target), { automatico: true });
}

/**
 * Persists a (partial) temporal config for a map, updates the cache and emits
 * TEMPORAL_CONFIG_CHANGED.
 *
 * `ativo` IS NOT ACCEPTED HERE: it is dropped from the patch, and the merged document keeps the
 * SAVED value it already had (see the file overview for why the payload must still carry it).
 * The on-screen switch is `setMapTemporalView`; the saved one is `setMapTemporalSaved`.
 *
 * @param {string|null} mapName - Map name (null = current).
 * @param {Partial<{unidade: string, inicio: (number|null), fim: (number|null), modo: string, origem: (number|null)}>} patch
 * @returns {Promise<Object|null>} The merged, persisted config, or null when the write was refused.
 */
export async function setMapTemporalConfig(mapName, patch) {
    const { ativo: _viewSwitchNeverTravelsHere, ...settings } = patch || {};
    return writeMapTemporalConfig(mapName, settings, 'setMapTemporalConfig');
}

/**
 * Writes the SAVED switch of a map. One caller by design: the "save view" gesture
 * (`saveMapView`, `map-view.operations.js`), which runs it inside the same logical batch as the
 * camera and the base layer. It does NOT touch the on-screen switch: the person saving is
 * already looking at the value being saved.
 *
 * @param {string|null} mapName - Map name (null = current).
 * @param {boolean} enabled - The switch to save with the view.
 * @returns {Promise<Object|null>} The merged, persisted config, or null when the write was refused.
 */
export async function setMapTemporalSaved(mapName, enabled) {
    return writeMapTemporalConfig(mapName, { ativo: enabled === true }, 'setMapTemporalSaved');
}

/**
 * The single write path of the stored config, shared by the two functions above.
 * @param {string|null} mapName - Map name (null = current).
 * @param {Object} patch - Keys to merge over the stored document.
 * @param {string} operation - Name reported by the blocked event.
 * @returns {Promise<Object|null>}
 * @private
 */
async function writeMapTemporalConfig(mapName, patch, operation) {
    // Gate BEFORE the local write, exactly like the sibling map ops (`renameMap`,
    // `toggleMapLock`). The tail of this function enqueues a `mapTemporal` op, and the server
    // refuses a map-setting write from a reader (`assertOperationAllowed`, backend
    // sync.service). Without the gate the timeline switch was offered to a reader, the op was
    // queued, the push came back 403 and the OUTBOUND QUEUE STOPPED, with a message blaming
    // the user's access for a control the screen itself had offered. UPDATE_MAP is the right
    // key: this edits settings of the map document, like a rename, and it already maps to
    // PermissionAction.EDIT (the server gate for this op is the same 'write' level).
    //
    // Local work is untouched, and that is a property of `checkPermission`, not of a special
    // case here: it returns allowed whenever the session is offline OR the store is not a
    // connected remote atlas. So an anonymous visitor, and a logged-in user on their own local
    // atlas, keep the full timeline. That early return is also what keeps the `.ebgeo` import
    // working, since a project import is a local restore (see `setMapComments`), and an import
    // INTO a remote atlas is already refused upstream by `addMap` (GuardAction.CREATE_MAP).
    //
    // Refusal is an EXPECTED failure, so it emits and returns null rather than throwing: the
    // temporal settings modal wraps this call in a try/catch that only logs, so a throw would
    // be swallowed and the user would be told nothing at all.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation,
            reason: perm.reason,
            required: perm.required
        });
        return null;
    }

    const target = resolveMapName(mapName);

    // MERGE de patch sobre o estado anterior, e por isso um read-modify-write de
    // verdade: dois patches concorrentes leem o mesmo `previous` e o segundo merge
    // descarta o campo que o primeiro acabou de gravar. Diferente de `setMapNotes` e
    // `setGridStyle`, que leem apenas para escolher CREATE ou UPDATE e gravam o valor
    // inteiro recebido do chamador, e por isso NAO tomam trava.
    //
    // A chave e compartilhada com o caminho inbound, que grava o documento inteiro em
    // `applyRemoteMapSettingOp` (EntityType.MAP_TEMPORAL). Os dois lados nomeiam o mapa
    // pelo NOME, entao caem na mesma chave. Sem isso, a config do colega chegando no meio
    // do merge local seria sobrescrita pelo estado velho mais o patch.
    const next = await withSideDocument('temporal', target, operation, async () => {
        let previous, merged;
        await runTransaction(async tx => {
            const mapId = mapManager.getMapId(target);
            previous = withDefaults(await getSettingCompat(`${STORE_PREFIX}${target}`));
            merged = { ...previous, ...(patch || {}) };
            // A REVISÃO DO MAPA no `previousData`, e só nele: a config temporal é uma unidade do
            // mapa, e `merged` é o que vai ser gravado no app setting, onde a revisão do servidor
            // não tem o que fazer. `confirmedVersion` é bookkeeping, então não entra no patch.
            const observado = { ...previous, ...(await readMapRevision(target)) };
            tx.recordOperation(EntityType.MAP_TEMPORAL, OperationType.UPDATE, mapId, mapId, merged, observado);
            tx.deferSync(() => memoryStore.temporalConfigs.set(target, merged));
            return () => setSettingCompat(`${STORE_PREFIX}${target}`, merged);
        });
        return { merged, previous };
    });
    const { merged: config } = next;

    // `MAP_TEMPORAL_CHANGED` IS NOT EMITTED FROM HERE ANY MORE: it announces the ON-SCREEN switch,
    // and this function only ever writes the stored document (`setMapTemporalView` is its emitter).
    getEventBus()?.emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName: target, config });

    // Emit as a sync op so the per-map temporal config travels to collaborators.
    // No-op unless operation logging is enabled (safe offline). Backend maps
    // 'mapTemporal' to maps.temporal_config; entityId === the map UUID. The op MUST
    // carry the UUID (not the name) — the dispatcher's isValidUUID guard drops non-UUID
    // map-setting ops, so logging the name silently dropped every temporal sync.

    return config;
}

/**
 * Toggles the ON-SCREEN temporal switch of a map. View state, so it cannot be refused.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>} The new on-screen state.
 */
export async function toggleMapTemporal(mapName = null) {
    const target = resolveMapName(mapName);
    const current = await isMapTemporalEnabled(target);
    return setMapTemporalView(target, !current);
}
