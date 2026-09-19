// Path: js/import_export/prepare-ebgeo-scope.js
import { ATLAS_RECORD_KEY, StoreName, getStoreFor } from '@store/atlas-namespace.js';
import { createAtlas, ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';
import { getEmptyMapData } from '@store/repositories/local.repository.js';
import { createSyncMetadata } from '@store/sync/sync-metadata.js';
import { sameStorageValue } from '@store/migration/storage-value.js';
import { generateUUID, isValidUUID } from '@utils/uuid.js';
import { normalizeMapDataForCurrentVersion } from './import-normalize.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' };

/** Build an unpublished namespace. Every write, including optional sections, must succeed. */
export async function prepareEbgeoScope(scope, entry, data, zip, processCatalogLayers) {
    const put = async (storeName, key, value) => {
        const store = getStoreFor(storeName, scope);
        await store.setItem(key, value);
        if (!await sameStorageValue(value, await store.getItem(key))) {
            throw new Error('A importação não passou na verificação de gravação. O atlas anterior foi preservado.');
        }
    };
    let unavailableCatalogLayersCount = 0;
    const maps = Object.entries(data.maps);
    if (!maps.length) maps.push(['Principal', getEmptyMapData()]);
    const ids = new Map();
    for (const [name, map] of maps) {
        // Preserve valid identities, but never overwrite a sibling with a duplicate ID.
        if (!isValidUUID(map.id) || [...ids.values()].includes(map.id)) map.id = generateUUID();
        map.name = name;
        ids.set(name, map.id);
        unavailableCatalogLayersCount += normalizeMapDataForCurrentVersion(map, processCatalogLayers).unavailableCatalogLayersCount;
        await put(StoreName.MAPS, map.id, map);
        const sections = [
            ['groups', StoreName.GROUPS, ''], ['layers', StoreName.LAYERS, 'layers_'],
            ['cesium3d', StoreName.CESIUM3D, 'cesium3d_'],
            ['streetview360', StoreName.STREETVIEW360, 'streetview360_'],
            ['comments', StoreName.COMMENTS, 'comments_'],
            ['colorUsage', StoreName.SETTINGS, 'color_usage_'],
            ['mapNotes', StoreName.SETTINGS, 'map_notes_'],
            ['gridStyle', StoreName.SETTINGS, 'gridStyle_'],
        ];
        for (const [section, store, prefix] of sections) {
            let value = data[section]?.[name];
            if (section === 'cesium3d' && value) {
                value = { cameraPositions: {}, markers: [], measurements: [], viewsheds: [], ...value };
            }
            if (section === 'streetview360' && value) {
                value = { orientations: {}, markers: [], ...value };
                value.orientations = Object.fromEntries(Object.entries(value.orientations).map(([key, orientation]) =>
                    [key, { ...orientation, id: orientation.id || generateUUID(), sync: orientation.sync || createSyncMetadata(null) }]));
                value.markers = value.markers.map(marker => ({ ...marker, id: marker.id || generateUUID(), sync: marker.sync || createSyncMetadata(null) }));
            }
            if (value != null) await put(store, prefix + map.id, value);
        }
        if (data.temporal?.[name] != null) await put(StoreName.SETTINGS, `temporal_${name}`, data.temporal[name]);
    }
    const briefingIds = new Set();
    for (const briefing of data.briefings || []) {
        if (!briefing?.id || !briefing.name) throw new Error('O arquivo contém um briefing incompleto. O atlas anterior foi preservado.');
        if (briefingIds.has(briefing.id)) throw new Error('O arquivo contém briefings com o mesmo identificador. O atlas anterior foi preservado.');
        briefingIds.add(briefing.id);
        await put(StoreName.BRIEFINGS, briefing.id, { ...briefing, sync: briefing.sync || createSyncMetadata(null) });
    }
    const imageIds = new Set();
    for (const file of Object.keys(zip.files)) {
        if (!file.startsWith('images/') || !/\.(png|jpe?g|svg|webp)$/i.test(file)) continue;
        const id = file.slice(7).replace(/\.(png|jpe?g|svg|webp)$/i, '');
        if (imageIds.has(id)) throw new Error('O arquivo contém imagens com o mesmo identificador. O atlas anterior foi preservado.');
        imageIds.add(id);
        const bytes = await zip.file(file).async('arraybuffer');
        await put(StoreName.IMAGES, id, new Blob([bytes], { type: MIME[file.split('.').pop().toLowerCase()] }));
    }
    await put(StoreName.SETTINGS, 'custom_icons', (data.customIcons || []).filter(icon => icon?.id));
    await put(StoreName.SETTINGS, 'schemaVersion', ATLAS_SCHEMA_VERSION);
    const order = [...new Set([...(data.mapOrder || []).filter(name => ids.has(name)), ...ids.keys()])];
    const currentName = ids.has(data.currentMap) ? data.currentMap : order[0];
    await put(StoreName.SETTINGS, 'lastActiveMap', ids.get(currentName));
    await put(StoreName.SETTINGS, 'mapOrder', order);
    await put(StoreName.ATLAS, ATLAS_RECORD_KEY, {
        ...createAtlas(entry.name), id: entry.id,
        mapOrder: order.map(name => ids.get(name)), lastActiveMapId: ids.get(currentName),
    });
    return { importedMapsCount: Object.keys(data.maps).length, unavailableCatalogLayersCount, currentMapName: currentName };
}
