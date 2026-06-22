// Path: js/import_export/local-atlas-to-server.js

/**
 * @fileoverview Transforms a local `.ebgeo` export object into the backend bulk-import
 * payload (`POST /atlas/import`, validated by `importSchema` in the backend
 * `atlas.schemas.js`). Pure + synchronous so it is fully unit-testable.
 *
 * Why this exists: "Salvar atlas local no servidor" reuses the existing `.ebgeo` export
 * (which already decomposes maps/layers/groups/features/3D/360/briefings) and reshapes it
 * to the server contract. The two big jobs are (1) UUID-remapping — the server requires a
 * UUID for every id/ref, but locally maps are name-keyed and the per-map default layer id
 * is the literal `'default'`; and (2) flattening the object-keyed collections
 * (cesium3d.cameraPositions / streetview360.orientations) into typed arrays.
 *
 * Image blobs are NOT handled here — this returns the set of image ids the caller must
 * upload (via `apiClient.bulkUploadImages`) in a later phase.
 */

import { generateUUID, isValidUUID } from '@utils/uuid.js';

/** Server-accepted feature types (mirror of backend `VALID_FEATURE_TYPES`). */
const VALID_FEATURE_TYPES = new Set([
    'point', 'line', 'polygon', 'text', 'image',
    'circle', 'rectangle', 'ellipse', 'brush', 'sector',
    'arrow', 'boundary', 'occupied_front', 'military_symbol', 'coordination_measure',
    'magnetic_declination',
    'los', 'visibility', 'processed_los', 'processed_visibility',
]);

/**
 * Storage-bucket → source type, used only as a fallback when a feature lacks
 * `properties.source`. The `coordenadas` bucket (ephemeral azimuth/coordinate readouts)
 * has no server feature type and is intentionally absent → such features are dropped.
 */
const BUCKET_TO_SOURCE = {
    points: 'point', lines: 'line', polygons: 'polygon', texts: 'text', images: 'image',
    circles: 'circle', rectangles: 'rectangle', ellipses: 'ellipse', brushes: 'brush', setores: 'sector',
    arrows: 'arrow', boundarys: 'boundary', occupied_fronts: 'occupied_front', military_symbols: 'military_symbol',
    coordination_measures: 'coordination_measure', magnetic_declinations: 'magnetic_declination',
    los: 'los', visibility: 'visibility', processed_los: 'processed_los', processed_visibility: 'processed_visibility',
};

/**
 * Builds an id mapper that keeps valid UUIDs as-is and assigns a stable new UUID to any
 * non-UUID id (memoized, so the same local id always maps to the same UUID). An optional `seed`
 * (`{ localId: forcedId }`) pre-binds ids — used to force image-FEATURE ids to their uploaded
 * server image id (since for image features `feature.properties.id` IS the blob id), so the
 * feature and any group references to it stay consistent.
 * @param {Object} [seed]
 * @returns {(localId: (string|null|undefined)) => (string|null)}
 */
function makeIdMapper(seed) {
    const map = new Map(seed ? Object.entries(seed) : []);
    return (localId) => {
        if (localId == null) return null;
        const existing = map.get(localId);
        if (existing) return existing;
        if (isValidUUID(localId)) return localId;
        const mapped = generateUUID();
        map.set(localId, mapped);
        return mapped;
    };
}

/**
 * Rewrites an entity's `images[]` array (3D/360 markers etc.) from local image ids to uploaded
 * server ids. Returns the item unchanged when there is nothing to rewrite.
 * @param {Object} item
 * @param {Object} imageIdMap - `{ localId: serverId }`.
 * @returns {Object}
 */
function rewriteItemImages(item, imageIdMap) {
    if (!Array.isArray(item?.images) || item.images.length === 0) return item;
    return {
        ...item,
        images: item.images.map((img) => {
            if (typeof img === 'string') return imageIdMap[img] || img;
            if (img?.id && imageIdMap[img.id]) return { ...img, id: imageIdMap[img.id] };
            return img;
        }),
    };
}

/**
 * Flattens one map's feature buckets into the server's flat feature array.
 * @param {Object} buckets - `{ points: [...], lines: [...], ... }`.
 * @param {(id: string) => string} featureId - Global feature-id mapper (seeded with image ids).
 * @param {(layerId: (string|null|undefined)) => string} layerIdFor - Per-map layer-id mapper.
 * @param {Object} imageIdMap - `{ localId: serverId }` for rewriting custom-icon refs.
 * @param {{ droppedFeatures: number }} stats - Mutated with the count of dropped features.
 * @returns {Array<Object>} Server feature rows.
 */
function buildFeatures(buckets, featureId, layerIdFor, imageIdMap, stats) {
    const out = [];
    if (!buckets || typeof buckets !== 'object') return out;

    for (const [bucket, list] of Object.entries(buckets)) {
        if (!Array.isArray(list)) continue;
        for (const feature of list) {
            const props = feature?.properties || {};
            const featureType = props.source || BUCKET_TO_SOURCE[bucket];
            if (!VALID_FEATURE_TYPES.has(featureType) || !feature?.geometry) {
                stats.droppedFeatures += 1;
                continue;
            }
            const serverLayerId = layerIdFor(props.layerId || 'default');
            const mappedId = featureId(props.id);
            // Realign id + layer ref to their server values so the feature stays consistent whether
            // read via the column or via properties. For an IMAGE feature `properties.id` is the
            // blob ref, so it must also become the uploaded server image id (seeded into featureId).
            const newProps = { ...props, id: mappedId, layerId: serverLayerId };
            // A custom point icon is referenced as `markerSymbol = 'custom:<iconId>'`; rewrite the
            // icon id to its uploaded server id.
            if (typeof newProps.markerSymbol === 'string' && newProps.markerSymbol.startsWith('custom:')) {
                const iconId = newProps.markerSymbol.slice('custom:'.length);
                if (imageIdMap[iconId]) newProps.markerSymbol = `custom:${imageIdMap[iconId]}`;
            }
            out.push({
                id: mappedId,
                feature_type: featureType,
                geometry: feature.geometry,
                properties: newProps,
                layer_id: serverLayerId,
            });
        }
    }
    return out;
}

/**
 * Maps the local layers array to the server layer schema (`order` → `sort_order`,
 * `'default'`/non-UUID id → per-map UUID).
 * @param {Array<Object>} layers
 * @param {(layerId: (string|null|undefined)) => string} layerIdFor
 * @returns {Array<Object>}
 */
function buildLayers(layers, layerIdFor) {
    if (!Array.isArray(layers)) return [];
    return layers.map((l) => ({
        id: layerIdFor(l.id),
        name: l.name || 'Camada',
        visible: l.visible !== false,
        locked: !!l.locked,
        opacity: typeof l.opacity === 'number' ? l.opacity : 1,
        sort_order: typeof l.order === 'number' ? l.order : 0,
        style: {},
    }));
}

/**
 * Maps the local groups object (keyed by id, each with a `features` member list) to the
 * server `groups` array (flat — no nesting) plus the `groupFeatures` join rows.
 * @param {Object} groupsObj - `{ [groupId]: { id, name, features: [{ id }], ... } }`.
 * @param {(id: string) => string} groupId - Group-id mapper.
 * @param {(id: string) => string} featureId - Feature-id mapper (must match buildFeatures).
 * @returns {{ groups: Array<Object>, groupFeatures: Array<Object> }}
 */
function buildGroups(groupsObj, groupId, featureId) {
    const groups = [];
    const groupFeatures = [];
    if (!groupsObj || typeof groupsObj !== 'object') return { groups, groupFeatures };

    for (const group of Object.values(groupsObj)) {
        if (!group?.id) continue;
        const serverGroupId = groupId(group.id);
        groups.push({
            id: serverGroupId,
            name: group.name || 'Grupo',
            visible: group.visible !== false,
            locked: !!group.locked,
            style: {},
            parent_id: null,
        });
        for (const member of group.features || []) {
            if (!member?.id) continue;
            groupFeatures.push({ group_id: serverGroupId, feature_id: featureId(member.id) });
        }
    }
    return { groups, groupFeatures };
}

/**
 * Flattens the cesium3d export object into the server `cesium3dData` typed array.
 * @param {Object|null} c3d - `{ cameraPositions:{tilesetId→item}, markers:[], measurements:[], viewsheds:[] }`.
 * @param {(id: string) => string} idFor
 * @param {Object} imageIdMap - `{ localId: serverId }` for rewriting item `images[]`.
 * @returns {Array<Object>}
 */
function buildCesium3d(c3d, idFor, imageIdMap) {
    const out = [];
    if (!c3d || typeof c3d !== 'object') return out;
    const push = (item, dataType) => {
        if (!item?.id) return;
        out.push({ id: idFor(item.id), data_type: dataType, tileset_id: item.tilesetId ?? null, data: rewriteItemImages(item, imageIdMap) });
    };
    for (const item of Object.values(c3d.cameraPositions || {})) push(item, 'camera_position');
    for (const item of c3d.markers || []) push(item, 'marker');
    for (const item of c3d.measurements || []) push(item, 'measurement');
    for (const item of c3d.viewsheds || []) push(item, 'viewshed');
    return out;
}

/**
 * Flattens the streetview360 export object into the server `streetview360Data` typed array.
 * @param {Object|null} sv - `{ orientations:{photoName→item}, markers:[] }`.
 * @param {(id: string) => string} idFor
 * @param {Object} imageIdMap - `{ localId: serverId }` for rewriting item `images[]`.
 * @returns {Array<Object>}
 */
function buildStreetview360(sv, idFor, imageIdMap) {
    const out = [];
    if (!sv || typeof sv !== 'object') return out;
    const push = (item, dataType) => {
        if (!item?.id) return;
        out.push({ id: idFor(item.id), data_type: dataType, photo_name: item.photoName ?? null, data: rewriteItemImages(item, imageIdMap) });
    };
    for (const item of Object.values(sv.orientations || {})) push(item, 'orientation');
    for (const item of sv.markers || []) push(item, 'marker');
    return out;
}

/**
 * Collects the image ids referenced by a map's features (image features keyed by their own
 * id) and by 3D/360 item `images[]` arrays, for the caller's later bulk upload.
 * @param {Object} buckets
 * @param {Object|null} c3d
 * @param {Object|null} sv
 * @param {Set<string>} sink
 */
function collectImageIds(buckets, c3d, sv, sink) {
    for (const list of Object.values(buckets || {})) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
            if (f?.properties?.source === 'image' && f.properties.id) sink.add(f.properties.id);
        }
    }
    const fromItems = (items) => {
        for (const it of items || []) {
            for (const img of it?.images || []) {
                const id = typeof img === 'string' ? img : img?.id;
                if (id) sink.add(id);
            }
        }
    };
    if (c3d) { fromItems(c3d.markers); fromItems(c3d.measurements); fromItems(c3d.viewsheds); }
    if (sv) fromItems(sv.markers);
}

/**
 * Builds the server bulk-import payload from a local `.ebgeo` export object.
 *
 * Two-pass usage for images: call ONCE without `meta.imageIdMap` to collect `imageIds`, upload
 * those blobs (`apiClient.bulkUploadImages` → `{ localId: serverId }`), then call AGAIN with
 * `meta.imageIdMap` set to that mapping so every image reference (image-feature ids, custom-icon
 * `markerSymbol` + registry ids, 3D/360 `images[]`) points to the uploaded server id.
 *
 * @param {Object} exportData - The object produced by the `.ebgeo` exporter (handleExport's
 *   `data`): `{ maps, layers, groups, cesium3d, streetview360, temporal, gridStyle, mapNotes,
 *   colorUsage, briefings, customIcons, mapOrder, currentMap }`.
 * @param {Object} meta - `{ name, description, imageIdMap? }`; `imageIdMap` is `{ localId: serverId }`.
 * @returns {{ payload: Object, imageIds: string[], stats: Object, mapNameToId: Object }}
 *   `payload` ready for `apiClient.importAtlas`; `imageIds` to bulk-upload; `mapNameToId`
 *   maps local map names → assigned server map UUIDs (for briefing/ref resolution + UI).
 */
export function buildServerImportPayload(exportData, meta = {}) {
    const data = exportData || {};
    const maps = data.maps || {};
    const stats = { maps: 0, features: 0, droppedFeatures: 0, layers: 0, groups: 0 };
    const imageSink = new Set();
    const imageIdMap = meta.imageIdMap || {};

    // Global mappers (UUIDs kept; non-UUIDs assigned a stable UUID). featureId is SEEDED with the
    // image map so an image-feature id (which equals its blob id) becomes the uploaded server id —
    // and group references to that feature follow automatically (same mapper).
    const featureId = makeIdMapper(imageIdMap);
    const groupId = makeIdMapper();

    // Map names → assigned server map UUIDs (briefings reference maps by name/id).
    const mapNameToId = {};
    for (const mapName of Object.keys(maps)) {
        mapNameToId[mapName] = generateUUID();
    }

    const serverMaps = [];
    for (const [mapName, mapData] of Object.entries(maps)) {
        // A per-map layer mapper: the literal 'default' layer collides across maps, so each
        // map gets its own UUID for it (features in this map resolve to the same one).
        const layerIdFor = makeIdMapper();

        const buckets = mapData?.features || {};
        const c3d = data.cesium3d?.[mapName] || null;
        const sv = data.streetview360?.[mapName] || null;
        const notes = data.mapNotes?.[mapName] || {};

        const features = buildFeatures(buckets, featureId, layerIdFor, imageIdMap, stats);
        const layers = buildLayers(data.layers?.[mapName], layerIdFor);
        const { groups, groupFeatures } = buildGroups(data.groups?.[mapName], groupId, featureId);
        collectImageIds(buckets, c3d, sv, imageSink);

        stats.features += features.length;
        stats.layers += layers.length;
        stats.groups += groups.length;

        serverMaps.push({
            id: mapNameToId[mapName],
            name: mapName,
            base_layer: mapData?.baseLayer || 'carta-topografica',
            center_lat: mapData?.center_lat ?? null,
            center_long: mapData?.center_long ?? null,
            zoom: mapData?.zoom ?? null,
            bearing: mapData?.bearing ?? 0,
            pitch: mapData?.pitch ?? 0,
            notes_title: notes.title || '',
            notes_description: notes.description || '',
            analysis_layers: mapData?.analysisLayers || {},
            catalog_layers: mapData?.catalogLayers || [],
            locked: false,
            grid_style: data.gridStyle?.[mapName] || {},
            temporal_config: data.temporal?.[mapName] || {},
            features,
            layers,
            groups,
            groupFeatures,
            cesium3dData: buildCesium3d(c3d, makeIdMapper(), imageIdMap),
            streetview360Data: buildStreetview360(sv, makeIdMapper(), imageIdMap),
        });
    }
    stats.maps = serverMaps.length;

    // Briefings: slides reference a map by name OR id → resolve to the server map UUID.
    const briefings = (data.briefings || []).map((b) => ({
        id: isValidUUID(b.id) ? b.id : generateUUID(),
        name: b.name || 'Briefing',
        description: b.description || '',
        settings: b.settings || {},
        slides: (b.slides || []).map((s) => ({
            id: isValidUUID(s.id) ? s.id : generateUUID(),
            title: s.title || '',
            content: s.content || '',
            mode: s.mode === '3d' || s.mode === '360' ? s.mode : '2d',
            map_id: mapNameToId[s.mapId] || (isValidUUID(s.mapId) ? s.mapId : null),
            model_id: isValidUUID(s.modelId) ? s.modelId : null,
            photo_id: isValidUUID(s.photoId) ? s.photoId : null,
            position: s.position || {},
            orientation: s.orientation || {},
        })),
    }));

    // Atlas-level app settings (local-only preference state that syncs through atlas.settings).
    const settings = {};
    if (data.colorUsage && Object.keys(data.colorUsage).length) settings.colorUsage = data.colorUsage;
    if (Array.isArray(data.customIcons) && data.customIcons.length) {
        settings.customIcons = data.customIcons.map((icon) => ({ ...icon, id: imageIdMap[icon.id] || icon.id }));
        for (const icon of data.customIcons) if (icon?.id) imageSink.add(icon.id);
    }
    if (Array.isArray(data.mapOrder) && data.mapOrder.length) settings.mapOrder = data.mapOrder;

    const payload = {
        atlas: {
            name: (meta.name || 'Atlas').slice(0, 255),
            description: meta.description || '',
            settings,
        },
        maps: serverMaps,
        briefings,
    };

    return { payload, imageIds: [...imageSink], stats, mapNameToId };
}
