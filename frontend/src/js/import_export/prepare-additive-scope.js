// Path: js/import_export/prepare-additive-scope.js
import { copyAtlasDatabases, getStoreFor, StoreName } from '@store/atlas-namespace.js';
import { generateUUID, isValidId } from '@utils/uuid.js';
import { prepareEbgeoScope } from './prepare-ebgeo-scope.js';
import { idsDeFotosPorReferencia } from '@js/user_data/photo-refs.js';
import { idsDeFigurasDoDocumento, reescreverFigurasNoHtml } from '@js/briefing/figura-de-slide.js';

const SECTIONS = ['groups', 'layers', 'cesium3d', 'streetview360', 'comments', 'colorUsage', 'mapNotes', 'gridStyle', 'temporal', 'mapLocks', 'mapBadgeColors'];
const REFERENCES = new Set(['id', 'parentId', 'layerId', 'groupId', 'featureId', 'mapId', 'briefingId', 'slideId']);
// These contain user data or external resource identities, never atlas entity identities.
const OPAQUE = new Set(['attributes', 'catalogLayers', 'analysisLayers', 'geometry', 'style', 'sync', 'gridStyle', 'mapNotes', 'temporal', 'mapLocks', 'mapBadgeColors']);
const unique = (name, used) => {
    let next = name;
    for (let n = 1; used.has(next); n++) next = `${name}_${n}`;
    used.add(next);
    return next;
};

/** Copy the original verbatim, then append only to the unpublished destination. */
export async function prepareAdditiveScope(source, destination, entry, input, zip, processCatalogLayers) {
    await copyAtlasDatabases(source, destination);
    const names = new Set();
    await getStoreFor(StoreName.MAPS, destination).iterate((map, key) => {
        const name = isValidId(key) ? map.name || key : key;
        if (names.has(name)) throw new Error('O atlas contém mapas com nomes repetidos. O original foi preservado.');
        names.add(name);
    });
    if (names.size + Object.keys(input.maps).length > 100) throw new Error('Limite de mapas excedido. Limite: 100 mapas. O atlas anterior foi preservado.');
    const ids = new Map();
    const imageFiles = new Map();
    for (const path of Object.keys(zip.files)) {
        const match = /^images\/(.+)\.(png|jpe?g|svg|webp)$/i.exec(path);
        if (!match) continue;
        if (ids.has(match[1])) throw new Error('O arquivo contém imagens com o mesmo identificador.');
        const id = generateUUID();
        ids.set(match[1], id);
        imageFiles.set(`images/${id}.${match[2]}`, path);
    }
    const collect = (value, key = '') => {
        if (OPAQUE.has(key) || !value || typeof value !== 'object') return;
        if (typeof value.id === 'string' && value.id !== 'default' && !ids.has(value.id)) ids.set(value.id, generateUUID());
        for (const [name, child] of Object.entries(value)) collect(child, name);
    };
    collect(input);
    const rewrite = (value, key = '') => {
        if (OPAQUE.has(key)) return structuredClone(value);
        if (typeof value === 'string') {
            if (key === 'markerSymbol' && value.startsWith('custom:')) return `custom:${ids.get(value.slice(7)) || value.slice(7)}`;
            // A slide figure is cited INSIDE rich text (`briefing/figura-de-slide.js`): its id
            // follows the image's new one like any other reference.
            return REFERENCES.has(key) || key === 'images' ? ids.get(value) || value : reescreverFigurasNoHtml(value, ids);
        }
        if (Array.isArray(value)) return value.map(child => rewrite(child, key));
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, rewrite(child, name)]));
    };
    // Photos cannot borrow a same-ID image from the atlas being extended.
    const archiveImages = new Set([...imageFiles.values()].map(path => path.slice(7).replace(/\.[^.]+$/, '')));
    const required = new Set((input.customIcons || []).map(icon => icon.id));
    // The attached PHOTOS held by reference, of features and of 3D/360 items (phase 2c of the
    // attached photos, 2026-09-24). An inline photo carries its bytes and is never missing: the walk
    // this replaced counted every 3D/360 photo, so an old inline one warned about a picture that
    // came inside the file, and it never looked at a FEATURE's photos, so a missing one went unsaid.
    for (const id of idsDeFotosPorReferencia(input)) required.add(id);
    for (const id of idsDeFigurasDoDocumento(input)) required.add(id);
    for (const map of Object.values(input.maps)) {
        for (const feature of map.features?.images || []) {
            required.add(feature.properties?.id);
        }
        for (const feature of map.features?.points || []) {
            const marker = feature.properties?.markerSymbol;
            if (typeof marker === 'string' && marker.startsWith('custom:')) required.add(marker.slice(7));
        }
    }
    const missingOriginalImages = [...required].filter(id => !archiveImages.has(id)).length;
    // Preserve incomplete legacy definitions, but isolate even missing references so
    // they cannot silently display unrelated bytes from the original atlas.
    for (const id of required) if (id && !ids.has(id)) ids.set(id, generateUUID());
    const data = rewrite(input);
    // `mapNotes` is opaque to the walk (user text), but a slide figure pasted into the notes is a
    // reference to a re-minted image all the same.
    for (const notas of Object.values(data.mapNotes || {})) {
        if (notas && typeof notas === 'object') notas.description = reescreverFigurasNoHtml(notas.description, ids);
    }
    const mapNames = new Map(Object.keys(input.maps).map(name => [name, unique(name, names)]));
    for (const section of ['maps', ...SECTIONS]) {
        if (!data[section]) continue;
        data[section] = Object.fromEntries(Object.entries(data[section]).map(([name, value]) => [mapNames.get(name) || name, value]));
    }
    for (const groups of [...Object.values(data.groups || {}), ...Object.values(data.comments || {})]) {
        for (const id of Object.keys(groups)) {
            const value = groups[id];
            delete groups[id];
            groups[ids.get(id) || id] = value;
        }
    }
    const briefingNames = new Set();
    await getStoreFor(StoreName.BRIEFINGS, destination).iterate(briefing => { briefingNames.add(briefing.name); });
    for (const briefing of data.briefings || []) {
        briefing.name = unique(briefing.name, briefingNames);
        for (const slide of briefing.slides || []) {
            if (mapNames.has(slide.mapId)) slide.mapId = mapNames.get(slide.mapId);
            if (mapNames.has(slide.mapName)) slide.mapName = mapNames.get(slide.mapName);
        }
    }
    data.currentMap = mapNames.get(data.currentMap);
    data.mapOrder = (data.mapOrder || Object.keys(input.maps)).map(name => mapNames.get(name));
    const isolatedZip = { files: Object.fromEntries([...imageFiles.keys()].map(path => [path, {}])),
        file: path => zip.file(imageFiles.get(path)) };
    const result = await prepareEbgeoScope(destination, entry, data, isolatedZip, processCatalogLayers, { append: true });
    return { ...result, missingOriginalImages };
}
