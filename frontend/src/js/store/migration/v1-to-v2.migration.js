// Path: js/store/migration/v1-to-v2.migration.js
/**
 * v1 -> v2: persist IDs and records BEFORE changing any data. Replay the plan verbatim
 * after a crash. Copy blobs before their references and retain old keys for recovery.
 * The browser boot runs this on an isolated destination; direct callers can also resume.
 */
import { ATLAS_RECORD_KEY, StoreName, getStoreFor } from '../atlas-namespace.js';
import { compareVersions } from '../repository.utils.js';
import { legacyScope } from './migration-scope.js';
import { generateUUID, isValidUUID } from '../../utilities/uuid.js';
import { createSyncMetadata } from '../sync/sync-metadata.js';
import { createAtlas } from '../atlas/atlas.entity.js';
import { sameStorageValue } from './storage-value.js';

export const V2_PLAN_KEY = '__migration_v2_plan__';
const TARGET_VERSION = '2.0';

export function createIdMappings() {
    return { maps: new Map(), layers: new Map(), groups: new Map(), features: new Map() };
}

function resolveId(mapping, oldId) {
    if (!mapping.has(oldId)) mapping.set(oldId, isValidUUID(oldId) ? oldId : generateUUID());
    return mapping.get(oldId);
}

export function migrateFeature(feature, mappings) {
    if (!feature?.properties) return feature;
    const { id, layerId, groupId } = feature.properties;
    return {
        ...feature,
        properties: {
            ...feature.properties,
            id: id ? resolveId(mappings.features, id) : id,
            layerId: layerId === 'default' ? 'default' : mappings.layers.get(layerId) || layerId || 'default',
            groupId: mappings.groups.get(groupId) || groupId,
            sync: createSyncMetadata()
        }
    };
}

export function migrateFeatures(features, mappings) {
    if (!features || typeof features !== 'object') return features;
    return Object.fromEntries(Object.entries(features).map(([type, list]) => [
        type, Array.isArray(list) ? list.map(feature => migrateFeature(feature, mappings)) : list
    ]));
}

async function preparePlan(scope) {
    const store = id => getStoreFor(id, scope);
    const names = await store(StoreName.MAPS).keys();
    const records = [];
    const images = [];
    for (const name of names) {
        const data = await store(StoreName.MAPS).getItem(name);
        if (!data) continue;
        const ids = createIdMappings();
        const layers = await store(StoreName.LAYERS).getItem(`layers_${name}`);
        const groups = await store(StoreName.GROUPS).getItem(name);
        if (Array.isArray(layers)) {
            for (const layer of layers) {
                if (layer.id !== 'default') resolveId(ids.layers, layer.id);
            }
            records.push([StoreName.LAYERS, `layers_${name}`, layers.map(layer => ({
                ...layer, id: ids.layers.get(layer.id) || layer.id, sync: createSyncMetadata()
            }))]);
        }
        const active = await store(StoreName.LAYERS).getItem(`activeLayer_${name}`);
        if (active != null) records.push([StoreName.LAYERS, `activeLayer_${name}`, ids.layers.get(active) || active]);
        for (const id of Object.keys(groups || {})) resolveId(ids.groups, id);
        const features = migrateFeatures(data.features, ids);
        if (groups && typeof groups === 'object') {
            records.push([StoreName.GROUPS, name, Object.fromEntries(Object.entries(groups).map(([id, group]) => [
                ids.groups.get(id), {
                    ...group, id: ids.groups.get(id), sync: createSyncMetadata(),
                    features: (group.features || []).map(ref => ({ ...ref, id: ids.features.get(ref.id) || ref.id }))
                }
            ]))]);
        }
        for (const [oldId, newId] of ids.features) {
            if (oldId !== newId && await store(StoreName.IMAGES).getItem(oldId) != null) images.push([oldId, newId]);
        }
        records.push([StoreName.MAPS, name, {
            ...data, id: isValidUUID(data.id) ? data.id : generateUUID(), name, features, sync: createSyncMetadata()
        }]);
    }
    const order = await store(StoreName.SETTINGS).getItem('mapOrder') || [];
    const last = await store(StoreName.SETTINGS).getItem('lastActiveMap');
    const atlas = createAtlas('Meu Atlas');
    atlas.schemaVersion = TARGET_VERSION;
    atlas.mapOrder = order.length ? order : names;
    if (names.length) atlas.lastActiveMapId = names.includes(last) ? last : names[0];
    return { version: 1, records, images, atlas };
}

export async function migrateToV2(scope = legacyScope()) {
    const store = id => getStoreFor(id, scope);
    const existing = await store(StoreName.ATLAS).getItem(ATLAS_RECORD_KEY);
    if (typeof existing?.schemaVersion === 'string' && compareVersions(existing.schemaVersion, TARGET_VERSION) >= 0) {
        return { success: true, skipped: true };
    }
    console.log('Starting migration to v2.0...');
    let plan = await store(StoreName.SETTINGS).getItem(V2_PLAN_KEY);
    if (!plan) {
        plan = await preparePlan(scope);
        await store(StoreName.SETTINGS).setItem(V2_PLAN_KEY, plan);
    }
    if (plan.version !== 1 || !Array.isArray(plan.records) || !Array.isArray(plan.images) || !plan.atlas) {
        throw new Error('Plano de migração ilegível. Os dados foram preservados para recuperação.');
    }
    for (const [oldId, newId] of plan.images) {
        const blob = await store(StoreName.IMAGES).getItem(oldId);
        if (blob == null) throw new Error('Uma imagem da migração não está disponível. Recupere a cópia original.');
        await store(StoreName.IMAGES).setItem(newId, blob);
        if (!await sameStorageValue(blob, await store(StoreName.IMAGES).getItem(newId))) {
            throw new Error('A imagem copiada não passou na verificação.');
        }
    }
    for (const [id, key, value] of plan.records) await store(id).setItem(key, value);
    for (const [id, key, value] of plan.records) {
        if (!await sameStorageValue(value, await store(id).getItem(key))) {
            throw new Error('Um registro migrado não passou na verificação.');
        }
    }
    // Commit of THIS step, not of the entire migration chain.
    await store(StoreName.ATLAS).setItem(ATLAS_RECORD_KEY, plan.atlas);
    await store(StoreName.SETTINGS).setItem('schemaVersion', TARGET_VERSION);
    console.log('Migration to v2.0 complete');
    return { success: true };
}
