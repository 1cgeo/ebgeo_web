// Path: js/store/sync/dispute-units.js

/**
 * @fileoverview The unit of dispute of each collaborative entity, MIRRORED from the server.
 *
 * THE SERVER OWNS THIS TABLE. `DISPUTE_UNITS` in `backend/src/modules/sync/entity-conflicts.js`
 * decides which columns move together, and its verdict is the one the user lives with: two people
 * renaming one map from the same base is a conflict, one renaming it while the other pans it is
 * not. This file is the CLIENT's copy of the same split, in the field names the client actually
 * sends, so an operation can say which units it claims and a refusal naming `posicao` can be read
 * back against something. `frontend/tests/unit/unidades-de-disputa-espelham-backend.test.js`
 * imports BOTH tables in one process and compares the unit names per target, which is the only
 * kind of assertion that survives someone editing one side.
 *
 * IT IS KEYED BY CLIENT ENTITY TYPE, NOT BY SERVER TARGET, and that is not a translation
 * convenience. Six client entity types collapse onto the single target `map` (`map` itself plus
 * the five sub-typed ones), and each SUB-TYPE may only touch its own unit: the server narrows a
 * sub-typed write to `MAP_SUBTYPE_FIELDS` precisely so a `name` smuggled beside a temporal config
 * cannot ride along. Keying by entity type states that narrowing here too, and it also removes an
 * alias collision that a target-keyed table would have: `visible` means the grid's visibility on a
 * `gridStyle` payload and a layer's visibility on a `layer` one.
 *
 * THE FIELD LISTS CARRY THE ALIASES THE SERVER RESOLVES, because the server compares COLUMNS after
 * `normalizeMapChanges` / `normalizeLayerChanges` have run. A client field the server would fold
 * into a column, listed here under a different unit or not listed at all, is a client that
 * declares one thing and writes another.
 *
 * AN UNKNOWN FIELD WIDENS TO EVERYTHING, never to nothing ({@link unitsForFields} answers `['*']`),
 * for the same reason the server does it: a field nobody classified is a field written without
 * being compared, and an over-eager refusal is noticed while a silent overwrite is not.
 *
 * ZERO IMPORTS by contract: it is read by the operation factory, by tests in plain node, and it
 * must never drag the store barrel behind it.
 */

/** The single unit of an entity whose document is disputed whole. Mirrors the server's constant. */
export const DOCUMENTO = 'documento';

/** Every unit is claimed at once. Mirrors the server's widening answer. */
export const TODAS_AS_UNIDADES = '*';

/**
 * Client entity type → the server target it lands on, and the units it may claim.
 * `wholeDocument` entities have exactly one unit and therefore no per-unit frontier at all
 * (see the server's header for why a single-unit entity keeps no frontier row).
 */
export const DISPUTE_UNITS = {
    map: {
        target: 'map',
        units: [
            { unit: 'nome', fields: ['name'] },
            { unit: 'posicao', fields: ['center_lat', 'center_long', 'centerLat', 'centerLong', 'zoom', 'bearing', 'pitch'] },
            { unit: 'mapaBase', fields: ['base_layer', 'baseLayer'] },
            { unit: 'notas', fields: ['notes_title', 'notes_description', 'title', 'description'] },
            { unit: 'grade', fields: ['grid_style', 'gridStyle', 'analysis_layers'] },
            { unit: 'temporal', fields: ['temporal_config'] },
            { unit: 'travado', fields: ['locked'] },
        ],
    },
    // The five sub-typed map entities. Each declares ONE unit, which is the same narrowing the
    // server applies through `MAP_SUBTYPE_FIELDS`.
    mapPosition: {
        target: 'map',
        units: [{ unit: 'posicao', fields: ['center_lat', 'center_long', 'centerLat', 'centerLong', 'zoom', 'bearing', 'pitch'] }],
    },
    baseLayer: {
        target: 'map',
        units: [{ unit: 'mapaBase', fields: ['base_layer', 'baseLayer'] }],
    },
    mapNotes: {
        target: 'map',
        units: [{ unit: 'notas', fields: ['notes_title', 'notes_description', 'title', 'description'] }],
    },
    gridStyle: {
        // `format` and `visible` are the grid payload the server assembles into `grid_style`.
        target: 'map',
        units: [{ unit: 'grade', fields: ['grid_style', 'gridStyle', 'analysis_layers', 'format', 'visible'] }],
    },
    mapTemporal: {
        // The six temporal keys the server folds into `temporal_config`.
        target: 'map',
        units: [{ unit: 'temporal', fields: ['temporal_config', 'ativo', 'unidade', 'inicio', 'fim', 'modo', 'origem'] }],
    },
    layer: {
        target: 'layer',
        units: [
            { unit: 'nome', fields: ['name'] },
            { unit: 'visivel', fields: ['visible'] },
            { unit: 'travado', fields: ['locked'] },
            { unit: 'opacidade', fields: ['opacity'] },
            { unit: 'ordem', fields: ['sort_order', 'order'] },
            { unit: 'estilo', fields: ['style'] },
        ],
    },
    group: {
        target: 'group',
        units: [
            { unit: 'nome', fields: ['name'] },
            { unit: 'visivel', fields: ['visible'] },
            { unit: 'travado', fields: ['locked'] },
            { unit: 'estilo', fields: ['style'] },
            { unit: 'pai', fields: ['parent_id', 'parentId'] },
        ],
    },
    briefing: {
        target: 'briefing',
        // `slides` is what the client sends; the server derives `slide_order` from it and stores
        // nothing else of the array, so the array IS the ordering unit.
        units: [
            { unit: 'nome', fields: ['name'] },
            { unit: 'descricao', fields: ['description'] },
            { unit: 'settings', fields: ['settings'] },
            { unit: 'ordemDosSlides', fields: ['slide_order', 'slides'] },
        ],
    },
    slide: {
        target: 'slide',
        units: [
            { unit: 'titulo', fields: ['title'] },
            { unit: 'conteudo', fields: ['content'] },
            { unit: 'alvo', fields: ['mode', 'map_id', 'mapId', 'model_id', 'modelId', 'photo_id', 'photoId'] },
            { unit: 'camera', fields: ['position', 'orientation', 'temporal_cursor', 'temporalCursor',
                'base_layer', 'baseLayer', 'temporal_enabled', 'temporalEnabled', 'controls'] },
            { unit: 'defeito', fields: ['is_broken', 'isBroken', 'broken_reason', 'brokenReason'] },
        ],
    },
    comment: {
        target: 'comment',
        // Everything that is not `status` is the comment BLOB, which the server writes as one
        // column. Resolving a thread and writing a reply are different gestures by different
        // people, which is why they are two units and not one.
        units: [
            { unit: 'resolvido', fields: ['status'] },
            { unit: 'texto', fields: null },
        ],
    },
    catalogLayer: { target: 'catalog_layer', wholeDocument: true },
    marker3d: { target: 'cesium3d', wholeDocument: true },
    measurement3d: { target: 'cesium3d', wholeDocument: true },
    viewshed3d: { target: 'cesium3d', wholeDocument: true },
    cameraPosition3d: { target: 'cesium3d', wholeDocument: true },
    orientation360: { target: 'streetview360', wholeDocument: true },
    marker360: { target: 'streetview360', wholeDocument: true },
};

/**
 * Whether this client entity type has a declared unit of dispute at all.
 *
 * `groupFeature` and `setting` deliberately have none: membership is a junction whose create and
 * delete are idempotent, and atlas settings are merged per key, so neither has a loser.
 * @param {string} entityType - Client entity type.
 * @returns {boolean}
 */
export function hasDisputeUnits(entityType) {
    return Object.hasOwn(DISPUTE_UNITS, entityType);
}

/**
 * The units a set of payload fields claims, in table order and deduplicated.
 *
 * A unit whose `fields` is null is the CATCH-ALL of its entity (the comment blob): it owns every
 * field no other unit claims, which is exactly what the server's statement does with that column.
 * With no catch-all, an unclassified field answers `['*']`.
 * @param {string} entityType - Client entity type.
 * @param {string[]} fields - Top-level payload keys the operation writes.
 * @returns {string[]} Unit names, `[DOCUMENTO]`, or `[TODAS_AS_UNIDADES]`.
 */
export function unitsForFields(entityType, fields) {
    const spec = DISPUTE_UNITS[entityType];
    if (!spec) return [];
    if (spec.wholeDocument) return [DOCUMENTO];
    const catchAll = spec.units.find((entry) => entry.fields === null);
    const claimed = new Set();
    for (const field of fields) {
        const owner = spec.units.find((entry) => entry.fields?.includes(field)) ?? catchAll;
        if (!owner) return [TODAS_AS_UNIDADES];
        claimed.add(owner.unit);
    }
    return spec.units.filter((entry) => claimed.has(entry.unit)).map((entry) => entry.unit);
}
