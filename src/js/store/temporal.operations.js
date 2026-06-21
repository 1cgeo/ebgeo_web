// Path: js/store/temporal.operations.js

/**
 * @fileoverview Per-map temporal configuration operations.
 *
 * Temporal control is enabled per map. Config is persisted in appStore under
 * `temporal_<mapName>` (mirroring the map-lock pattern) and cached in
 * `memoryStore.temporalConfigs` for synchronous reads on hot paths (render,
 * filters). Config shape: `{ ativo, unidade, inicio, fim }`.
 */

import { getSettingCompat, setSettingCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { getEventBus } from './services.js';
import { EventTypes } from '../events';
import { DEFAULT_TEMPORAL_CONFIG } from '../temporal/temporal.constants.js';
import { logMapTemporalOperation, OperationType } from './sync/operation-dispatcher.js';

const STORE_PREFIX = 'temporal_';

/**
 * Merges a stored (possibly partial/null) config with defaults.
 * @param {Object|null} raw - Stored config.
 * @returns {{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null)}}
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
 * @returns {{ativo: boolean, unidade: string, inicio: (number|null), fim: (number|null)}}
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
    const previous = withDefaults(await getSettingCompat(`${STORE_PREFIX}${target}`));
    const next = { ...previous, ...(patch || {}) };

    await setSettingCompat(`${STORE_PREFIX}${target}`, next);
    memoryStore.temporalConfigs.set(target, next);

    const bus = getEventBus();
    if (bus) {
        if (next.ativo !== previous.ativo) {
            bus.emit(EventTypes.MAP_TEMPORAL_CHANGED, { mapName: target, enabled: next.ativo });
        }
        bus.emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName: target, config: next });
    }

    // Emit as a sync op so the per-map temporal config travels to collaborators.
    // No-op unless operation logging is enabled (safe offline). Backend maps
    // 'mapTemporal' to maps.temporal_config; entityId === the map UUID. The op MUST
    // carry the UUID (not the name) — the dispatcher's isValidUUID guard drops non-UUID
    // map-setting ops, so logging the name silently dropped every temporal sync.
    await logMapTemporalOperation(OperationType.UPDATE, mapManager.getMapId(target), next);

    return next;
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
