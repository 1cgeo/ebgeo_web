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
 */

import { getSettingCompat, setSettingCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { getEventBus } from './services.js';
import { EventTypes } from '../events';
import { withSideDocument } from './document-lock.js';
import { DEFAULT_TEMPORAL_CONFIG } from '../temporal/temporal.constants.js';
import { logMapTemporalOperation, OperationType } from './sync/operation-dispatcher.js';

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
 * Whether temporal control is enabled for a map (synchronous).
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {boolean}
 */
export function isMapTemporalEnabledSync(mapName = null) {
    return getMapTemporalConfigSync(mapName).ativo === true;
}

/**
 * Whether temporal control is enabled for a map (async, from IndexedDB).
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>}
 */
export async function isMapTemporalEnabled(mapName = null) {
    return (await getMapTemporalConfig(mapName)).ativo === true;
}

/**
 * Persists a (partial) temporal config for a map, updates the cache and emits
 * change events. Emits MAP_TEMPORAL_CHANGED when the `ativo` flag changes and
 * always emits TEMPORAL_CONFIG_CHANGED.
 *
 * @param {string|null} mapName - Map name (null = current).
 * @param {Partial<{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null)}>} patch
 * @returns {Promise<Object>} The merged, persisted config.
 */
export async function setMapTemporalConfig(mapName, patch) {
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
    const next = await withSideDocument('temporal', target, 'setMapTemporalConfig', async () => {
        const previous = withDefaults(await getSettingCompat(`${STORE_PREFIX}${target}`));
        const merged = { ...previous, ...(patch || {}) };
        await setSettingCompat(`${STORE_PREFIX}${target}`, merged);
        memoryStore.temporalConfigs.set(target, merged);
        return { merged, previous };
    });
    const { merged: config, previous } = next;

    const bus = getEventBus();
    if (bus) {
        if (config.ativo !== previous.ativo) {
            bus.emit(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: target, enabled: config.ativo });
        }
        bus.emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName: target, config });
    }

    // Emit as a sync op so the per-map temporal config travels to collaborators.
    // No-op unless operation logging is enabled (safe offline). Backend maps
    // 'mapTemporal' to maps.temporal_config; entityId === the map UUID. The op MUST
    // carry the UUID (not the name) — the dispatcher's isValidUUID guard drops non-UUID
    // map-setting ops, so logging the name silently dropped every temporal sync.
    await logMapTemporalOperation(OperationType.UPDATE, mapManager.getMapId(target), config);

    return config;
}

/**
 * Toggles temporal control on/off for a map.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>} The new enabled state.
 */
export async function toggleMapTemporal(mapName = null) {
    const target = resolveMapName(mapName);
    const current = await isMapTemporalEnabled(target);
    const next = await setMapTemporalConfig(target, { ativo: !current });
    return next.ativo;
}
