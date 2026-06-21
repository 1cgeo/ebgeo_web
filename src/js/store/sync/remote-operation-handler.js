// Path: js/store/sync/remote-operation-handler.js

/**
 * @fileoverview Remote operation handler for sync system.
 * Applies operations received from other clients to the local store.
 *
 * This handler is the inverse of operation logging:
 * - Logging: local change -> create operation -> queue
 * - Remote: receive operation -> apply to local state -> emit events
 *
 * IMPORTANT: Remote operations MUST NOT:
 * - Check permissions (already validated by server)
 * - Log to operation queue (avoids feedback loop)
 * - Record undo actions (undo is per-user, local only)
 */

import { EventTypes } from '../../events/event_types.js';
import { getRepository, setSettingCompat } from '../repositories/index.js';
import { localRepository } from '../repositories/local.repository.js';
import { getStorageTypeFromSource } from '../store.constants.js';
import { getControl } from '../control.registry.js';
import { mapResolver } from '../services/map-resolver.service.js';
import { memoryStore } from '../memory-store.js';
import { EntityType, OperationType } from './operation-types.js';

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {import('../../events/event_bus.js').EventBus|null} */
let _eventBus = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Sets the EventBus dependency for emitting events.
 * Called once from initServices().
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function setRemoteHandlerEventBus(eventBus) {
    _eventBus = eventBus;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Applies a remote operation to the local store.
 * Routes to entity-specific handlers based on entityType.
 *
 * @param {Object} operation - Remote operation
 * @param {string} operation.entityType - Entity type (from EntityType)
 * @param {string} operation.operationType - Operation type (from OperationType)
 * @param {string} operation.entityId - Entity UUID
 * @param {string} [operation.mapId] - Map UUID (context)
 * @param {Object} [operation.data] - Entity data (for CREATE/UPDATE)
 * @returns {Promise<void>}
 */
export async function applyRemoteOperation(operation) {
    const { entityType, operationType, entityId, mapId, data } = operation;

    switch (entityType) {
        case EntityType.FEATURE:
            await applyRemoteFeatureOp(operationType, entityId, mapId, data);
            break;
        case EntityType.LAYER:
            await applyRemoteLayerOp(operationType, entityId, mapId, data);
            break;
        case EntityType.MAP:
            // A map op is atlas-level: its identity is `entityId` (the map id), and
            // `mapId` (the op context) is null. Pass entityId so remote MAP_CREATED/
            // MODIFIED/DELETED carry the real id (§1.8/§1.9).
            await applyRemoteMapOp(operationType, entityId, data);
            break;
        case EntityType.GROUP:
            await applyRemoteGroupOp(operationType, entityId, mapId, data);
            break;
        case EntityType.BRIEFING:
            await applyRemoteBriefingOp(operationType, entityId, data);
            break;
        case EntityType.MARKER_3D:
            applyRemote3dOp(EventTypes.MARKERS_3D_CHANGED, mapId);
            break;
        case EntityType.MEASUREMENT_3D:
            applyRemote3dOp(EventTypes.MEASUREMENTS_3D_CHANGED, mapId);
            break;
        case EntityType.VIEWSHED_3D:
            applyRemote3dOp(EventTypes.VIEWSHEDS_3D_CHANGED, mapId);
            break;
        case EntityType.CAMERA_POSITION_3D:
            applyRemoteCameraOp(operationType, mapId, data);
            break;
        case EntityType.ORIENTATION_360:
            applyRemoteOrientation360Op(operationType, mapId, data);
            break;
        case EntityType.MARKER_360:
            applyRemote3dOp(EventTypes.MARKERS_360_CHANGED, mapId);
            break;
        case EntityType.MAP_POSITION:
        case EntityType.BASE_LAYER:
        case EntityType.MAP_NOTES:
        case EntityType.GRID_STYLE:
        case EntityType.MAP_TEMPORAL:
            await applyRemoteMapSettingOp(entityType, mapId, data);
            break;
        case EntityType.CATALOG_LAYER:
            emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
            break;
        case EntityType.SETTING:
            await applyRemoteSettingOp(data);
            break;
        default:
            console.warn(`Remote operation handler: unknown entity type "${entityType}"`);
    }

    emit(EventTypes.REMOTE_OPERATION_APPLIED, { operation });
}

// ============================================================================
// ENTITY-SPECIFIC HANDLERS
// ============================================================================

/**
 * Finds a feature by ID within a storage type array.
 *
 * @param {Array} features - Feature array to search
 * @param {string} featureId - Feature UUID
 * @returns {number} Index of the feature, or -1 if not found
 */
function findFeatureIndex(features, featureId) {
    return features.findIndex(f => f.properties?.id === featureId);
}

/**
 * Applies a remote feature operation.
 *
 * @param {string} opType - Operation type
 * @param {string} featureId - Feature UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Feature GeoJSON data
 */
async function applyRemoteFeatureOp(opType, featureId, mapId, data) {
    const repo = getRepository();
    const mapData = await repo.getMap(mapId);
    if (!mapData) {
        console.warn(`Remote feature op: map "${mapId}" not found`);
        return;
    }

    const sourceType = data?.properties?.source || 'point';
    const storageType = getStorageTypeFromSource(sourceType);

    if (!mapData.features[storageType]) {
        mapData.features[storageType] = [];
    }

    const features = mapData.features[storageType];

    switch (opType) {
        case OperationType.CREATE: {
            // Idempotent by id: a re-applied/echoed CREATE (e.g. the author's own
            // op coming back on a catch-up pull) must NOT duplicate the feature —
            // replace in place when it already exists instead of pushing a copy.
            const existingIndex = findFeatureIndex(features, featureId);
            if (existingIndex !== -1) {
                features[existingIndex] = data;
            } else {
                features.push(data);
            }
            await repo.saveMap(mapId, mapData);

            emit(EventTypes.FEATURE_CREATED, {
                featureId, featureType: sourceType, mapId, feature: data
            });
            break;
        }
        case OperationType.UPDATE: {
            const index = findFeatureIndex(features, featureId);
            if (index !== -1) {
                const previousFeature = features[index];
                features[index] = data;
                await repo.saveMap(mapId, mapData);

                emit(EventTypes.FEATURE_MODIFIED, {
                    featureId, featureType: sourceType, mapId,
                    feature: data, previousFeature
                });
            }
            break;
        }
        case OperationType.DELETE: {
            // A DELETE op carries no `data` (only previousData), so the source/storage
            // bucket can't be derived from it — sourceType defaulted to 'point', which
            // silently dropped the delete of EVERY non-point feature type (it searched
            // only the 'points' bucket). Search ALL buckets by id and remove it.
            let deletedFeature = null;
            for (const arr of Object.values(mapData.features)) {
                if (!Array.isArray(arr)) continue;
                const idx = findFeatureIndex(arr, featureId);
                if (idx !== -1) {
                    deletedFeature = arr[idx];
                    arr.splice(idx, 1);
                    break;
                }
            }
            if (deletedFeature) {
                await repo.saveMap(mapId, mapData);
                emit(EventTypes.FEATURE_DELETED, {
                    featureId, featureType: deletedFeature.properties?.source || sourceType, mapId
                });
            }
            break;
        }
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote layer operation.
 *
 * @param {string} opType - Operation type
 * @param {string} layerId - Layer UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Layer data
 */
async function applyRemoteLayerOp(opType, layerId, mapId, data) {
    const repo = getRepository();
    // Persist the layer to the local store like the map/feature handlers do. Emitting
    // an event alone left the peer WITHOUT the layer — the desktop has no subscriber
    // that persists LAYER_* events — so a collaborator's new/edited/deleted layer never
    // reached the other client.
    try {
        const layers = (await repo.getLayers?.(mapId)) || [];
        let next = layers;
        if (opType === OperationType.CREATE) {
            next = findFeatureIndexById(layers, layerId) !== -1
                ? layers.map((l) => (l.id === layerId ? data : l)) // idempotent re-apply
                : [...layers, data];
        } else if (opType === OperationType.UPDATE) {
            next = layers.map((l) => (l.id === layerId ? { ...l, ...data } : l));
        } else if (opType === OperationType.DELETE) {
            next = layers.filter((l) => l.id !== layerId);
        }
        await repo.saveLayers?.(mapId, next);
    } catch (err) {
        console.warn('Remote layer op persist failed:', err);
    }

    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.LAYER_CREATED, { layerId, mapId, layer: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.LAYER_MODIFIED, { layerId, mapId, layer: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.LAYER_DELETED, { layerId, mapId });
            break;
    }

    emit(EventTypes.LAYERS_CHANGED, { mapName: mapId });
}

/** Index of a layer by its `id` (layers have a top-level id, not properties.id). */
function findFeatureIndexById(arr, id) {
    return arr.findIndex((x) => x && x.id === id);
}

/**
 * Applies a remote map operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} data - Map data
 */
async function applyRemoteMapOp(opType, mapId, data) {
    const repo = getRepository();
    switch (opType) {
        case OperationType.CREATE:
            // Persist a map another user created so it appears locally (§1.8). The
            // maps list is repo-backed, so saving here makes it show up on refresh.
            if (data) await repo.saveMap?.(mapId, data);
            if (data?.name) mapResolver.registerMap(data.name, mapId);
            emit(EventTypes.MAP_CREATED, { mapId, map: data });
            break;
        case OperationType.UPDATE:
            if (data) await repo.saveMap?.(mapId, data);
            emit(EventTypes.MAP_MODIFIED, { mapId, map: data });
            break;
        case OperationType.DELETE:
            // Remove the map another user deleted (§1.9). The resolver entry is left
            // intact so the maps tab can still resolve id→name for its redirect; the
            // resolver is rebuilt on the next snapshot/init.
            await repo.deleteMap?.(mapId);
            emit(EventTypes.MAP_DELETED, { mapId });
            break;
    }
}

/**
 * Applies a remote group operation.
 *
 * @param {string} opType - Operation type
 * @param {string} groupId - Group UUID
 * @param {string} mapId - Map UUID
 * @param {Object} data - Group data
 */
async function applyRemoteGroupOp(opType, groupId, mapId, data) {
    const repo = getRepository();
    // Persist the group to BOTH the local group store (a separate store from map data,
    // keyed by map id) AND the in-memory cache (memoryStore.groups, keyed by map NAME —
    // what getMapGroups reads), mirroring how group_manager writes them. Emitting an event
    // alone left the peer WITHOUT the group: no subscriber persists GROUP_* events, and the
    // map-data save never touches the group store. The backend already stores groups and
    // returns them in the snapshot — this is the live-op half of that same contract.
    try {
        const mapName = mapResolver.resolveToName(mapId) || mapId;
        const groups = (await repo.getGroups?.(mapId)) || {};
        if (!memoryStore.groups[mapName]) memoryStore.groups[mapName] = {};
        if (opType === OperationType.DELETE) {
            delete groups[groupId];
            delete memoryStore.groups[mapName][groupId];
        } else if (data) {
            groups[groupId] = data;
            memoryStore.groups[mapName][groupId] = data;
        }
        await repo.saveGroups?.(mapId, groups);
    } catch (err) {
        console.warn('Remote group op persist failed:', err);
    }

    switch (opType) {
        case OperationType.CREATE:
            emit(EventTypes.GROUP_CREATED, { groupId, mapId, group: data });
            break;
        case OperationType.UPDATE:
            emit(EventTypes.GROUP_MODIFIED, { groupId, mapId, group: data });
            break;
        case OperationType.DELETE:
            emit(EventTypes.GROUP_DELETED, { groupId, mapId });
            break;
    }

    emit(EventTypes.GROUPS_CHANGED, {});
}

/**
 * Applies a remote briefing operation.
 *
 * @param {string} opType - Operation type
 * @param {string} briefingId - Briefing UUID
 * @param {Object} data - Briefing data
 */
async function applyRemoteBriefingOp(opType, briefingId, data) {
    switch (opType) {
        case OperationType.CREATE:
        case OperationType.UPDATE: {
            if (data) {
                await localRepository.saveBriefing(briefingId, data);
            }
            const eventType = opType === OperationType.CREATE
                ? EventTypes.BRIEFING_CREATED
                : EventTypes.BRIEFING_UPDATED;
            emit(eventType, { briefingId, briefing: data });
            break;
        }
        case OperationType.DELETE:
            await localRepository.deleteBriefing(briefingId);
            emit(EventTypes.BRIEFING_DELETED, { briefingId });
            break;
    }
}

/**
 * Applies a remote 3D / 360 collection operation.
 *
 * These entities (markers, measurements, viewsheds, 360 markers) are persisted
 * by the app inside the per-map cesium3d / streetview360 stores, which are
 * keyed by map *name* and backed by their own memory caches. Reproducing that
 * write path here would couple the remote handler to four store modules and
 * their caches. Instead we emit the matching coarse "changed" event so the
 * relevant UI re-reads its data from the store (mirrors the feature handler,
 * which also emits LAYERS_CHANGED with the map id as mapName).
 *
 * @param {string} changeEvent - EventTypes.* coarse change event to emit
 * @param {string} mapId - Map UUID (used as mapName for downstream listeners)
 */
function applyRemote3dOp(changeEvent, mapId) {
    emit(changeEvent, { mapName: mapId });
}

/**
 * Applies a remote 3D camera position operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} [data] - Camera position data ({ tilesetId, ... })
 */
function applyRemoteCameraOp(opType, mapId, data) {
    if (opType !== OperationType.DELETE) {
        emit(EventTypes.CAMERA_3D_SAVED, { tilesetId: data?.tilesetId, mapName: mapId });
    }
    emit(EventTypes.MARKERS_3D_CHANGED, { mapName: mapId });
}

/**
 * Applies a remote 360 orientation operation.
 *
 * @param {string} opType - Operation type
 * @param {string} mapId - Map UUID
 * @param {Object} [data] - Orientation data ({ photoName, ... })
 */
function applyRemoteOrientation360Op(opType, mapId, data) {
    const eventType = opType === OperationType.DELETE
        ? EventTypes.ORIENTATION_360_CLEARED
        : EventTypes.ORIENTATION_360_SAVED;
    emit(eventType, { photoName: data?.photoName, mapName: mapId });
}

/**
 * Applies a remote map-level setting operation (position, base layer, notes,
 * grid style). These live on the map record itself, so a coarse MAP_MODIFIED
 * tells the app to re-read the map. A type-specific event is emitted when one
 * exists for the setting.
 *
 * @param {string} entityType - Entity type (from EntityType)
 * @param {string} mapId - Map UUID
 * @param {Object} [data] - Setting data
 */
async function applyRemoteMapSettingOp(entityType, mapId, data) {
    switch (entityType) {
        case EntityType.BASE_LAYER:
            emit(EventTypes.BASE_LAYER_CHANGED, { layer: data });
            break;
        case EntityType.MAP_NOTES:
            emit(EventTypes.MAP_NOTES_REQUESTED, { mapName: mapId });
            break;
        case EntityType.MAP_TEMPORAL: {
            // Persist the per-map temporal config so the peer actually adopts it — emitting
            // an event alone left B's stored config unchanged (same emit-without-persist
            // class as the layer bug). The config is keyed locally by map NAME
            // (`temporal_<name>`, matching temporal.operations.js), while the op carries the
            // map UUID, so resolve UUID→name first.
            const mapName = mapResolver.resolveToName(mapId) || mapId;
            if (data) {
                await setSettingCompat(`temporal_${mapName}`, data);
                memoryStore.temporalConfigs.set(mapName, data);
                emit(EventTypes.TEMPORAL_CONFIG_CHANGED, { mapName, config: data });
                if (typeof data.ativo === 'boolean') {
                    emit(EventTypes.MAP_TEMPORAL_CHANGED, { mapName, enabled: data.ativo });
                }
            }
            break;
        }
        default:
            break;
    }
    emit(EventTypes.MAP_MODIFIED, { mapId, map: data });
}

/**
 * Applies a remote atlas-level setting op (§24.8 + datamodel-13/14): persists the
 * whitelisted preference(s) to the local stores using the EXACT same keys/setters the
 * local write path uses, and applies live where there is a control (terrain). Peers
 * see the change in real time. Best-effort and defensive.
 *
 * Keys handled (must match the emitters in operation-dispatcher.logAtlasSetting):
 * - terrainExaggeration → atlas.settings.terrainExaggeration + terrain control (§24.8)
 * - mapBadgeColors (datamodel-13) → repo.saveSetting('mapBadgeColors', obj)
 *      (the setSettingCompat key map.operations.js uses)
 * - colorUsage (datamodel-13) → per map: repo.saveSetting('color_usage_<mapName>', counts)
 *      (the setColorUsageCompat key; payload is { [mapName]: counts })
 * - customIcons (datamodel-14) → repo.saveSetting('custom_icons', list)
 *      (the SETTING_KEY customIcons.operations.js uses; blobs sync via images)
 *
 * @param {Object} [data] - Setting payload.
 * @returns {Promise<void>}
 */
async function applyRemoteSettingOp(data) {
    if (!data || typeof data !== 'object') return;

    if (data.terrainExaggeration !== undefined) {
        try {
            const repo = getRepository();
            const atlas = await repo.getAtlas?.();
            if (atlas) {
                if (!atlas.settings) atlas.settings = {};
                atlas.settings.terrainExaggeration = data.terrainExaggeration;
                await repo.saveAtlas?.(atlas);
            }
        } catch {
            // best-effort persist; the live apply below is what the user sees
        }
        const terrain = getControl('terrain');
        if (terrain && typeof terrain.setExaggeration === 'function') {
            terrain.setExaggeration(data.terrainExaggeration);
        }
    }

    await applyRemoteAppStateSettings(data);
}

/**
 * Applies the datamodel-13/14 app-state setting keys (mapBadgeColors, colorUsage,
 * customIcons) from a remote `setting` op or a snapshot's atlas.settings, writing
 * each to the same local store key its local setter uses. Best-effort per key.
 *
 * @param {Object} data - Object that may carry mapBadgeColors/colorUsage/customIcons.
 * @returns {Promise<void>}
 */
async function applyRemoteAppStateSettings(data) {
    const repo = getRepository();

    if (data.mapBadgeColors && typeof data.mapBadgeColors === 'object') {
        // setSettingCompat('mapBadgeColors', obj) → repo.saveSetting('mapBadgeColors', obj).
        // Consumers (getMapBadgeColors) re-read this key fresh, so a persist is enough.
        try {
            await repo.saveSetting?.('mapBadgeColors', data.mapBadgeColors);
        } catch {
            // best-effort
        }
    }

    if (data.colorUsage && typeof data.colorUsage === 'object') {
        // Per-map nested object { [mapName]: counts }; write each under color_usage_<mapName>
        // (the setColorUsageCompat key) so getColorUsage(mapName) reads it back.
        for (const [mapName, counts] of Object.entries(data.colorUsage)) {
            try {
                await repo.saveSetting?.(`color_usage_${mapName}`, counts);
            } catch {
                // best-effort per map
            }
        }
    }

    if (Array.isArray(data.customIcons)) {
        // setSettingCompat('custom_icons', list) — the customIcons.operations SETTING_KEY.
        // Reset the registry's in-memory cache so the next getCustomIcons() reloads the
        // synced list (mirrors the ALL_DATA_CLEARED reset the registry already does).
        // Dynamic import keeps customIcons.operations (and its wide store graph) OUT of
        // the remote handler's static import graph — loaded only when an icons op arrives.
        try {
            await repo.saveSetting?.('custom_icons', data.customIcons);
            const { invalidateCustomIconsCache } = await import('../customIcons.operations.js');
            invalidateCustomIconsCache();
        } catch {
            // best-effort
        }
    }
}

// ============================================================================
// SNAPSHOT
// ============================================================================

/**
 * Reshapes a backend-shaped snapshot map into the local store's shape and
 * redistributes the map-level settings the backend keeps as columns into the
 * local side-stores the rest of the app reads from.
 *
 * The backend returns these map fields snake_case (mirroring the `maps` table):
 * `base_layer`, `notes_title`, `notes_description`, `grid_style`,
 * `temporal_config`, `locked`. Locally the loader expects camelCase
 * (`baseLayer`) and reads notes/grid/temporal/lock from dedicated side-stores
 * keyed exactly as the setters below produce. If we saved the row verbatim the
 * camelCase loader would miss `baseLayer` and the side-stores would stay empty
 * (notes/grid/temporal/lock would vanish for the user) — so we strip those
 * columns off the map and push them through the same keys/setters the app uses.
 *
 * Key derivation MUST match the consumers:
 * - notes  → `repo.saveMapNotes(id, …)`   → `map_notes_<id>`  (keyed by map id)
 * - grid   → `repo.saveGridStyle(id, …)`  → `gridStyle_<id>`  (keyed by map id)
 * - temporal → `temporal_<name>`  (temporal.operations.js STORE_PREFIX; read in
 *   store-state-manager.setCurrentMap via `getSettingCompat('temporal_<name>')`)
 * - lock   → `mapLocked_<name>`    (map.operations.js setAppSetting; read in
 *   store-state-manager.setCurrentMap via `getSettingCompat('mapLocked_<name>')`)
 *
 * @param {Object} repo - Active repository
 * @param {Object} map - Backend-shaped snapshot map (mutated: columns removed)
 * @returns {Promise<Object>} The reshaped map ready for `repo.saveMap`
 */
async function reshapeSnapshotMap(repo, map) {
    const {
        base_layer: baseLayer,
        notes_title: notesTitle,
        notes_description: notesDescription,
        grid_style: gridStyle,
        temporal_config: temporalConfig,
        locked,
        ...rest
    } = map;

    // Notes / grid are keyed by map id (UUID); the repo resolves and writes
    // `map_notes_<id>` / `gridStyle_<id>` — the exact keys getMapNotes/getGridStyle read.
    if (notesTitle != null || notesDescription != null) {
        await repo.saveMapNotes?.(map.id, {
            title: notesTitle || '',
            description: notesDescription || ''
        });
    }
    if (gridStyle != null && Object.keys(gridStyle).length > 0) {
        await repo.saveGridStyle?.(map.id, gridStyle);
    }

    // Temporal / lock are keyed by map NAME (matches temporal.operations.js
    // `temporal_<name>` and map.operations.js `mapLocked_<name>`, which is how
    // store-state-manager loads them on map activation).
    const mapName = map.name;
    if (mapName) {
        if (temporalConfig != null && Object.keys(temporalConfig).length > 0) {
            await repo.saveSetting?.(`temporal_${mapName}`, temporalConfig);
        }
        if (locked != null) {
            await repo.saveSetting?.(`mapLocked_${mapName}`, locked);
        }
    }

    // Rebuild the map with the camelCase field the loader expects; drop the
    // snake_case columns now living in side-stores.
    const reshaped = { ...rest };
    if (baseLayer !== undefined) {
        reshaped.baseLayer = baseLayer;
    }
    return reshaped;
}

/**
 * Applies a full snapshot to the local store.
 *
 * Each map carries its `features`/`layers`/`groups`/`cesium3d`/`streetview360`
 * (saved verbatim) plus backend-only map columns that must be reshaped into the
 * local camelCase + side-store shape first (see `reshapeSnapshotMap`). Each
 * briefing is saved as-is. Defensive about missing fields.
 *
 * @param {Object} [snapshot] - Snapshot payload ({ maps?, briefings? })
 * @returns {Promise<void>}
 */
export async function applyRemoteSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return;
    }

    const repo = getRepository();

    // datamodel-13/14: distribute the synced app-state settings the backend keeps in
    // atlas.settings (mapBadgeColors, colorUsage, customIcons) into the SAME local
    // store keys their local setters use, so a fresh snapshot rehydrates them. Uses
    // the analogous reshape the map fields get (reshapeSnapshotMap), but for atlas
    // settings keys. terrainExaggeration is left on the atlas record (loaded elsewhere).
    if (snapshot.atlas && snapshot.atlas.settings && typeof snapshot.atlas.settings === 'object') {
        await applyRemoteAppStateSettings(snapshot.atlas.settings);
    }

    const maps = Array.isArray(snapshot.maps) ? snapshot.maps : [];
    for (const map of maps) {
        if (map && map.id) {
            const reshaped = await reshapeSnapshotMap(repo, map);
            await repo.saveMap(map.id, reshaped);
            // Groups live in a SEPARATE local store (not part of map data), so saveMap does
            // not carry them. Restore the snapshot's map.groups (array → object keyed by id)
            // into both the group store (by id) and the in-memory cache (by name) so a peer
            // sees existing groups on open. Without this the snapshot dropped them silently.
            if (Array.isArray(map.groups)) {
                const byId = {};
                for (const g of map.groups) { if (g && g.id) byId[g.id] = g; }
                await repo.saveGroups?.(map.id, byId);
                if (map.name) memoryStore.groups[map.name] = byId;
            }
            emit(EventTypes.MAP_MODIFIED, { mapId: map.id, map: reshaped });
        }
    }

    const briefings = Array.isArray(snapshot.briefings) ? snapshot.briefings : [];
    for (const briefing of briefings) {
        if (briefing && briefing.id) {
            await localRepository.saveBriefing(briefing.id, briefing);
            emit(EventTypes.BRIEFING_UPDATED, { briefingId: briefing.id, briefing });
        }
    }

    emit(EventTypes.LAYERS_CHANGED, {});
    emit(EventTypes.GROUPS_CHANGED, {});
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Emits an event if EventBus is available.
 *
 * @param {string} eventType
 * @param {Object} payload
 */
function emit(eventType, payload) {
    if (_eventBus) {
        _eventBus.emit(eventType, payload);
    }
}
