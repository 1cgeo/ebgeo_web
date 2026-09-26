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
 * Image blobs are NOT read here — this returns the set of image ids the caller must
 * upload (via `apiClient.bulkUploadImages`) in a later phase.
 *
 * ONE EXCEPTION: THE BYTES OF AN INLINE PHOTO LEAVE THE DOCUMENT HERE (phase 2c of the attached
 * photos, 2026-09-24). A photo attached before phase 2b carries its bytes as a data URL inside the
 * entity (`properties.images[]` of a feature, `images[]` of a 3D or 360 item). This is the
 * boundary where the owner decided it becomes a blob with a reference: the item goes up without
 * `data`, its id joins `imageIds` like any other blob, and the bytes come back in `inlineImages`
 * (local id to data URL) for the caller to upload, because they are in no store. See
 * `converterFotos`.
 */

import { generateUUID, isValidUUID } from '@utils/uuid.js';
import { pruneCatalogLayerDefinitions } from '@catalog/catalog-layer.ref.js';
import { normalizeLegacyDeclinationProperties, ensureMapDataShape } from '@store/repository.utils.js';
import { normalizeSlideControls } from '@js/briefing/slide-controls.js';
import { idsDeFigurasDoDocumento, reescreverFigurasNoHtml } from '@js/briefing/figura-de-slide.js';
import { isDerivedOutputBucket } from '@store/analysis-output.js';
import { mimeDeFotoInlineQueSobe, blobDeDataUrl } from '@utils/image_utils.js';
import { fotoTemBytesInline, idDeFotoPorReferencia, fotoSemBytes } from '@js/user_data/photo-refs.js';

/** Server-accepted feature types (mirror of backend `VALID_FEATURE_TYPES`). */
const VALID_FEATURE_TYPES = new Set([
    'point', 'line', 'polygon', 'text', 'image',
    'circle', 'rectangle', 'ellipse', 'brush', 'sector',
    'arrow', 'boundary', 'occupied_front', 'coordination_line', 'military_symbol', 'engineering_symbol', 'coordination_measure',
    'magnetic_declination',
    'los', 'visibility', 'processed_los', 'processed_visibility',
]);

/**
 * Storage-bucket → server feature type, and the FIRST thing `buildFeatures` asks. The
 * `coordenadas` bucket (ephemeral azimuth/coordinate readouts) has no server feature type and is
 * intentionally absent → such features fall back to `properties.source`, which for them is not a
 * server type either, so they are dropped.
 *
 * THE BUCKET DECIDES, and it used to be the other way round. `properties.source` is the tool that
 * DREW the feature; the bucket is where the store keeps it, and `feature-type.registry.js` is
 * explicit that the two analysis pairs are four distinct rows: the operator's input (`los`,
 * `visibility`) and the algorithm's output (`processed_los`, `processed_visibility`). The output
 * rows carry `source: 'los'`/`'visibility'`, so reading the source first turned a RESULT into a
 * DEFINITION on the way up: measured 2026-09-07, an atlas with `3/6/3/6` landed on the server as
 * `los: 9, visibility: 9` with both processed buckets empty, and came back down the same way.
 * The server accepts all four (the `valid_feature_type` CHECK, the import Joi and the snapshot's
 * `typeToCollection`), so nothing on that side had to change.
 */
const BUCKET_TO_SOURCE = {
    points: 'point', lines: 'line', polygons: 'polygon', texts: 'text', images: 'image',
    circles: 'circle', rectangles: 'rectangle', ellipses: 'ellipse', brushes: 'brush', setores: 'sector',
    arrows: 'arrow', boundarys: 'boundary', occupied_fronts: 'occupied_front', military_symbols: 'military_symbol',
    coordination_lines: 'coordination_line',
    engineering_symbols: 'engineering_symbol',
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

/** Server column width for `slides.model_id` / `slides.photo_id` (`VARCHAR(100)`). */
const SLIDE_TARGET_MAX_LENGTH = 100;

/**
 * The 3D/360 target of a briefing slide, as the server stores it.
 *
 * NOT A UUID, and that was the bug. These two columns hold a RESOURCE id, and the product does
 * not name those with UUIDs: a tileset is a slug (`museu-1cgeo`) and a 360 project is a file name
 * (`FOTO_0001.jpg`). Demanding a UUID here wrote NULL over every real target: measured
 * 2026-09-07, an atlas with one `3d` slide and one `360` slide reached the server with both
 * targets empty EVEN with the catalog registered, so the slide opened in its mode pointing at
 * nothing. Every other layer of the server already treated them as strings (the `VARCHAR(100)`
 * column, and `atlas-resource-prune.js`, which compares them to the catalog with `String(...)`);
 * the import Joi was the single gate that refused, and it moved to `.max(100)` in the same
 * change.
 *
 * The cap is the COLUMN's, not a guess: anything longer cannot name a resource that exists on
 * this server, so it comes back as null rather than as a truncation that would point somewhere
 * else. Passing a UUID still works untouched, since a UUID is a 36-character string.
 *
 * @param {*} value - `slide.modelId` / `slide.photoId` from the local export.
 * @returns {string|null}
 */
function slideResourceRef(value) {
    if (typeof value !== 'string') return null;
    const ref = value.trim();
    if (!ref || ref.length > SLIDE_TARGET_MAX_LENGTH) return null;
    return ref;
}

/** The decoding of each inline photo, once per photo object for both passes (see below). */
const _decodificadas = new WeakMap();

/**
 * The type and the DECODED bytes of an inline photo that goes up as a blob, or null when it stays
 * inline (`mimeDeFotoInlineQueSobe`, `utilities/image_utils.js`, says which ones stay and why:
 * staying is how they always travelled, so it costs nothing).
 *
 * DECODED BEFORE ANYTHING IS DECIDED (2026-09-24, review, item 7). The head of a data URL can be a
 * valid JPEG over a body that does not decode; the photo used to lose its `data` first, then the
 * decode failed, and the picture reached the server as a reference with no bytes anywhere and was
 * counted as missing. A photo that does not decode now stays inline, and `collectImageIds` and
 * `converterFotos` ask this same question, so what is cited and what is converted cannot disagree.
 * Memoised by the photo object: the send builds the payload twice (the probe and the real one) over
 * the same document, and each photo is decoded once.
 *
 * @param {*} foto - An item of an `images` array
 * @returns {{mime: string, blob: Blob}|null}
 */
function fotoInlineQueSobe(foto) {
    if (!foto || typeof foto !== 'object') return null;
    if (_decodificadas.has(foto)) return _decodificadas.get(foto);
    const mime = mimeDeFotoInlineQueSobe(foto);
    const blob = mime ? blobDeDataUrl(foto.data) : null;
    const resposta = mime && blob ? { mime, blob } : null;
    _decodificadas.set(foto, resposta);
    return resposta;
}

/**
 * The image id a photo item makes the caller upload: a reference, or an inline photo that goes up
 * ({@link fotoInlineQueSobe}).
 * @param {*} foto - An item of an `images` array
 * @returns {string|null}
 */
function idDeFotoQueSobe(foto) {
    return fotoInlineQueSobe(foto) ? foto.id : idDeFotoPorReferencia(foto);
}

/**
 * Rewrites an `images` array (the photos of a feature, of a 3D or 360 item) for the server.
 *
 * A reference points at its uploaded id. An inline photo that goes up ({@link fotoInlineQueSobe})
 * loses `data`, keeps everything else (the `thumbnail` above all, which the entity carries so the
 * gallery draws without fetching the photo) and records its DECODED bytes in `fotosInline` under the
 * LOCAL id, first occurrence winning: a duplicated feature carries the same photo twice, and it is one
 * blob. `type` follows the bytes, because an old item kept the type of the file that was picked,
 * not of the JPEG it was re-encoded into.
 *
 * @param {Array} fotos
 * @param {Object} imageIdMap - `{ localId: serverId }`.
 * @param {Map<string, Blob>} fotosInline - Mutated: local id to the decoded bytes.
 * @returns {Array}
 */
function converterFotos(fotos, imageIdMap, fotosInline) {
    return fotos.map((foto) => {
        if (typeof foto === 'string') return imageIdMap[foto] || foto;
        const sobe = fotoInlineQueSobe(foto);
        if (sobe) {
            if (!fotosInline.has(foto.id)) fotosInline.set(foto.id, sobe.blob);
            return { ...fotoSemBytes(foto), id: imageIdMap[foto.id] || foto.id, type: sobe.mime };
        }
        if (!fotoTemBytesInline(foto) && foto?.id && imageIdMap[foto.id]) return { ...foto, id: imageIdMap[foto.id] };
        return foto;
    });
}

/**
 * Rewrites an entity's `images[]` array (3D/360 markers etc.) from local image ids to uploaded
 * server ids, through {@link converterFotos}. Returns the item unchanged when there is nothing to
 * rewrite.
 * @param {Object} item
 * @param {Object} imageIdMap - `{ localId: serverId }`.
 * @param {Map<string, Blob>} fotosInline - Mutated: local id to the decoded bytes.
 * @returns {Object}
 */
function rewriteItemImages(item, imageIdMap, fotosInline) {
    if (!Array.isArray(item?.images) || item.images.length === 0) return item;
    return { ...item, images: converterFotos(item.images, imageIdMap, fotosInline) };
}

/**
 * Flattens one map's feature buckets into the server's flat feature array.
 * @param {Object} buckets - `{ points: [...], lines: [...], ... }`.
 * @param {(id: string) => string} featureId - Global feature-id mapper (seeded with image ids).
 * @param {(layerId: (string|null|undefined)) => string} layerIdFor - Per-map layer-id mapper.
 * @param {Object} imageIdMap - `{ localId: serverId }` for rewriting custom-icon and photo refs.
 * @param {{ droppedFeatures: number }} stats - Mutated with the count of dropped features.
 * @param {Map<string, string>} fotosInline - Mutated: the bytes of the inline photos that go up.
 * @returns {Array<Object>} Server feature rows.
 */
function buildFeatures(buckets, featureId, layerIdFor, imageIdMap, stats, fotosInline) {
    const out = [];
    if (!buckets || typeof buckets !== 'object') return out;

    for (const [bucket, list] of Object.entries(buckets)) {
        if (!Array.isArray(list)) continue;
        // The analysis OUTPUT does not go up: every client re-derives it from the input that does
        // (`store/analysis-output.js`), and the snapshot discards whatever the server holds in
        // those buckets. Not counted as dropped, because nothing is lost: the drawing comes back.
        if (isDerivedOutputBucket(bucket)) continue;
        for (const feature of list) {
            const props = feature?.properties || {};
            const featureType = BUCKET_TO_SOURCE[bucket] || props.source;
            if (!VALID_FEATURE_TYPES.has(featureType) || !feature?.geometry) {
                stats.droppedFeatures += 1;
                continue;
            }
            const serverLayerId = layerIdFor(props.layerId || 'default');
            const mappedId = featureId(props.id);
            // Realign id + layer ref to their server values so the feature stays consistent whether
            // read via the column or via properties. For an IMAGE feature `properties.id` is the
            // blob ref, so it must also become the uploaded server image id (seeded into featureId).
            const compatibleProps = featureType === 'magnetic_declination'
                ? normalizeLegacyDeclinationProperties(props) : props;
            const newProps = { ...compatibleProps, id: mappedId, layerId: serverLayerId };
            // A custom point icon is referenced as `markerSymbol = 'custom:<iconId>'`; rewrite the
            // icon id to its uploaded server id.
            if (typeof newProps.markerSymbol === 'string' && newProps.markerSymbol.startsWith('custom:')) {
                const iconId = newProps.markerSymbol.slice('custom:'.length);
                if (imageIdMap[iconId]) newProps.markerSymbol = `custom:${imageIdMap[iconId]}`;
            }
            // The attached photos: references re-pointed, inline bytes out of the document.
            if (Array.isArray(newProps.images) && newProps.images.length > 0) {
                newProps.images = converterFotos(newProps.images, imageIdMap, fotosInline);
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
 * @param {Map<string, string>} fotosInline - Mutated: the bytes of the inline photos that go up.
 * @returns {Array<Object>}
 */
function buildCesium3d(c3d, idFor, imageIdMap, fotosInline) {
    const out = [];
    if (!c3d || typeof c3d !== 'object') return out;
    const push = (item, dataType) => {
        if (!item?.id) return;
        out.push({ id: idFor(item.id), data_type: dataType, tileset_id: item.tilesetId ?? null, data: rewriteItemImages(item, imageIdMap, fotosInline) });
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
 * @param {Map<string, string>} fotosInline - Mutated: the bytes of the inline photos that go up.
 * @returns {Array<Object>}
 */
function buildStreetview360(sv, idFor, imageIdMap, fotosInline) {
    const out = [];
    if (!sv || typeof sv !== 'object') return out;
    const push = (item, dataType) => {
        if (!item?.id) return;
        out.push({ id: idFor(item.id), data_type: dataType, photo_name: item.photoName ?? null, data: rewriteItemImages(item, imageIdMap, fotosInline) });
    };
    for (const item of Object.values(sv.orientations || {})) push(item, 'orientation');
    for (const item of sv.markers || []) push(item, 'marker');
    return out;
}

/**
 * Collects the image ids referenced by a map's features (image features keyed by their own
 * id, and the photos attached to any feature) and by 3D/360 item `images[]` arrays, for the
 * caller's later bulk upload.
 *
 * A PHOTO IS CITED ONLY WHEN IT GOES UP AS A BLOB ({@link idDeFotoQueSobe}). Until phase 2c the
 * 3D/360 walk cited every `img.id`, inline ones included: their bytes are in no store, so every send
 * of a local atlas with an old 3D or 360 photo asked the person about a MISSING picture that was
 * travelling inside the item all along, and told the server it was missing. The feature walk did
 * not cite photos at all, which after phase 2b would have left every new photo behind.
 *
 * @param {Object} buckets
 * @param {Object|null} c3d
 * @param {Object|null} sv
 * @param {Set<string>} sink
 */
function collectImageIds(buckets, c3d, sv, sink) {
    const fromPhotos = (fotos) => {
        if (!Array.isArray(fotos)) return;
        for (const foto of fotos) {
            const id = idDeFotoQueSobe(foto);
            if (id) sink.add(id);
        }
    };
    for (const [bucket, list] of Object.entries(buckets || {})) {
        if (!Array.isArray(list)) continue;
        for (const f of list) {
            if ((bucket === 'images' || f?.properties?.source === 'image') && f?.properties?.id) sink.add(f.properties.id);
            const marker = f?.properties?.markerSymbol;
            if (typeof marker === 'string' && marker.startsWith('custom:')) sink.add(marker.slice(7));
            // `buildFeatures` does not send the derived buckets, so their photos are not cited.
            if (!isDerivedOutputBucket(bucket)) fromPhotos(f?.properties?.images);
        }
    }
    const fromItems = (items) => {
        for (const it of items || []) fromPhotos(it?.images);
    };
    if (c3d) { fromItems(c3d.markers); fromItems(c3d.measurements); fromItems(c3d.viewsheds); }
    if (sv) fromItems(sv.markers);
}

/**
 * Builds the server bulk-import payload from a local `.ebgeo` export object.
 *
 * Images: the production path is TWO passes, and `meta.imageIdMap` is what the second one uses.
 * `save-local-atlas.service.js` builds once to learn WHICH blobs the atlas cites, mints a fresh
 * id for each, and builds again with `imageIdMap = { localId: novoId }`, which rewrites every
 * blob reference at once (image-feature ids, custom-icon `markerSymbol` + registry ids, the photos
 * of features and of 3D/360 items). The blobs are then uploaded under those fresh ids. The bytes
 * of an inline photo are not in any store: the caller finds them in `inlineImages`, under the
 * LOCAL id, and must look there before the store (see the fileoverview).
 *
 * A minting is not cosmetic: `images.id` is a GLOBAL primary key on the server, so re-sending the
 * same local atlas would try to claim a taken id. The server re-mints colliding ids for every
 * OTHER entity, but it cannot do that for a blob that arrives AFTER the features that point at
 * it. The client decides this one instead. See `backend/src/modules/atlas/atlas.service.js`,
 * the block before `TABELA_POR_SUPERFICIE`.
 *
 * @param {Object} exportData - The object produced by the `.ebgeo` exporter (handleExport's
 *   `data`): `{ maps, layers, groups, cesium3d, streetview360, temporal, gridStyle, mapNotes,
 *   colorUsage, briefings, customIcons, mapOrder, currentMap }`.
 * @param {Object} meta - `{ name, description, imageIdMap? }`; `imageIdMap` is `{ localId: serverId }`.
 * @returns {{ payload: Object, imageIds: string[], inlineImages: Map<string, Blob>, stats: Object, mapNameToId: Object }}
 *   `payload` ready for `apiClient.importAtlas`; `imageIds` (LOCAL ids) to bulk-upload;
 *   `inlineImages` the decoded bytes of every inline photo among them, by local id; `mapNameToId`
 *   maps local map names → assigned server map UUIDs (for briefing/ref resolution + UI).
 */
export function buildServerImportPayload(exportData, meta = {}) {
    const data = exportData || {};
    const maps = data.maps || {};
    const stats = { maps: 0, features: 0, droppedFeatures: 0, layers: 0, groups: 0 };
    const imageSink = new Set();
    const imageIdMap = meta.imageIdMap || {};
    const fotosInline = new Map();

    // Global mappers (UUIDs kept; non-UUIDs assigned a stable UUID). featureId is SEEDED with the
    // image map so an image-feature id (which equals its blob id) becomes the uploaded server id —
    // and group references to that feature follow automatically (same mapper).
    const featureId = makeIdMapper(imageIdMap);
    const groupId = makeIdMapper();

    // Map names → assigned server map UUIDs (briefings reference maps by name/id).
    const mapNameToId = Object.create(null);
    const sourceMapIds = new Map();
    for (const [mapName, mapData] of Object.entries(maps)) {
        mapNameToId[mapName] = generateUUID();
        if (mapData?.id) sourceMapIds.set(mapData.id, mapNameToId[mapName]);
    }

    const serverMaps = [];
    for (const [mapName, mapData] of Object.entries(maps)) {
        // A per-map layer mapper: the literal 'default' layer collides across maps, so each
        // map gets its own UUID for it (features in this map resolve to the same one).
        const layerIdFor = makeIdMapper();

        const buckets = (ensureMapDataShape(mapData) || mapData)?.features || {};
        const c3d = data.cesium3d?.[mapName] || null;
        const sv = data.streetview360?.[mapName] || null;
        const notes = data.mapNotes?.[mapName] || {};

        const features = buildFeatures(buckets, featureId, layerIdFor, imageIdMap, stats, fotosInline);
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
            notes_description: reescreverFigurasNoHtml(notes.description || '', imageIdMap),
            analysis_layers: mapData?.analysisLayers || {},
            // Reference + per-atlas state only. This is a whole-entity upload, so it bypasses the
            // sync write gate; a legacy entry still holding the old embedded copy would otherwise
            // plant a stale definition on the server.
            catalog_layers: pruneCatalogLayerDefinitions(mapData?.catalogLayers) || [],
            locked: false,
            grid_style: data.gridStyle?.[mapName] || {},
            temporal_config: data.temporal?.[mapName] || {},
            features,
            layers,
            groups,
            groupFeatures,
            cesium3dData: buildCesium3d(c3d, makeIdMapper(), imageIdMap, fotosInline),
            streetview360Data: buildStreetview360(sv, makeIdMapper(), imageIdMap, fotosInline),
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
            // A FIGURE HELD BY REFERENCE is a blob like any other: it is cited (below), uploaded
            // under the fresh id, and the slide's HTML is rewritten to that id here.
            content: reescreverFigurasNoHtml(s.content || '', imageIdMap),
            mode: s.mode === '3d' || s.mode === '360' ? s.mode : '2d',
            map_id: mapNameToId[s.mapId] || sourceMapIds.get(s.mapId) || (isValidUUID(s.mapId) ? s.mapId : null),
            model_id: slideResourceRef(s.modelId),
            photo_id: slideResourceRef(s.photoId),
            // The view of the slide (2026-09-20). Same column width as the two ids above, and
            // null is a full state of both: "inherit what was saved with the map".
            base_layer: slideResourceRef(s.baseLayer),
            temporal_enabled: typeof s.temporalEnabled === 'boolean' ? s.temporalEnabled : null,
            // O INSTANTE CONGELADO, que precisa viajar junto com o interruptor acima: mandar um
            // sem o outro entrega ao servidor um slide com a linha do tempo LIGADA e sem instante,
            // que abre num momento que o autor nunca escolheu. O `.ebgeo` sempre preservou os
            // dois, então a mesma pessoa ganhava ou perdia o cursor conforme a porta que usasse.
            // Epoch ms e nada mais: é a forma que o editor grava (`briefing-editor.control.js`) e
            // a única que `transition.service.js` aplica.
            temporal_cursor: Number.isFinite(s.temporalCursor) ? s.temporalCursor : null,
            controls: normalizeSlideControls(s.controls),
            position: s.position || {},
            orientation: s.orientation || {},
        })),
    }));
    // The slide figures, of the briefings and of the notes pasted with one, are cited like photos.
    for (const id of idsDeFigurasDoDocumento(data)) imageSink.add(id);

    // Atlas-level app settings (local-only preference state that syncs through atlas.settings).
    //
    // `data.colorUsage` is deliberately NOT carried over (2026-09-21). The colour count stopped
    // being synced, so writing it into `atlas.settings` here would plant a value that no client
    // reads back and that nothing ever prunes (the server deep-merges that sub-object and a
    // renamed map leaves its old name behind forever). The receiving client recounts each map
    // from its own features on first open (`performInitialColorAnalysis`), which is where the
    // number comes from now. The `.ebgeo` FILE still carries the section: that is a file, not
    // sync.
    const settings = {};
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

    return { payload, imageIds: [...imageSink], inlineImages: fotosInline, stats, mapNameToId };
}
