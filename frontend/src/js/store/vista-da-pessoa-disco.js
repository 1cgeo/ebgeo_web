// Path: js/store/vista-da-pessoa-disco.js

/**
 * @fileoverview THE REMEMBERED VIEW OF THE PERSON, AS IT SITS ON DISK: one `localStorage` record
 * per atlas namespace, holding, per map, the base layer and the temporal switch this person last
 * CHOSE on that map (owner's request of 2026-09-22, registered in docs/decisions/decisions-2026.md).
 *
 * WHAT IT IS NOT. It is not a map setting and it never travels: no sync op, no snapshot, no
 * `.ebgeo`, no key of the settings database the server could ever be sent. The saved view of the
 * map (`store/map-view.operations.js`) is what travels; this is the person's deviation from it,
 * kept on this computer. Who reads it and in what order is `store/vista-da-pessoa.js`.
 *
 * WHY `localStorage` AND NOT A DATABASE OF THE NAMESPACE, and the choice is measured against the
 * code, not preferred:
 *   - the data databases of a SERVER atlas are GENERATIONAL (`namespace-generation.js`): every full
 *     snapshot is staged into nine fresh databases, so a key written into the settings database
 *     would vanish on the next catalogue repair or on a pull older than the operation log, silently;
 *   - "Salvar como local" copies those databases into a new slot and prunes the private references
 *     it knows (`private-reference-prune.scope.js`), and a basemap id kept among them would be a
 *     private reference leaving the server outside that list;
 *   - the entry path reads it inside `setCurrentMap` and `switchMap`, and a SYNCHRONOUS read keyed
 *     by the namespace suffix captured in the same tick cannot land in another atlas, whatever the
 *     next `await` does. That is the race `store/mapa-inexistente.js` describes for disk reads.
 *
 * ONE RECORD PER NAMESPACE, KEYED BY THE DATABASE SUFFIX, which is what makes it die with the atlas:
 * `clearAtlasDatabases` and `dropAtlasDatabases` (`atlas-namespace.js`) forget it next to the
 * generation pointer, and the atlas wipe (`clearAllAtlasStores`, `repository.js`) forgets it too,
 * because the maps it described are the content that just left. A tab-lock keeps two tabs off the
 * same suffix, so the read-modify-write below has one writer per record.
 *
 * ONE OWNER PER RECORD. A server atlas remembers for the SIGNED-IN user and nobody else; a local
 * atlas belongs to the computer, like its saved view, and its owner is `null`. A record whose owner
 * is not the one asking reads as empty, and the first write replaces it: two accounts never read
 * each other's view, and the one-atlas-at-a-time logout (which destroys the namespace) makes the
 * replacement the rare path.
 *
 * ZERO IMPORTS, BY CONTRACT: `atlas-namespace.js` imports `forgetPersonViews`, and the adapter that
 * resolves the active scope imports `atlas-namespace.js`. A leaf is what keeps that triangle from
 * becoming an import cycle around the one module every store access depends on.
 *
 * EVERY ACCESS IS GUARDED: private mode, a blocked storage or a quota error make the remembered view
 * unavailable, never the map. The degradation is the behaviour before this file existed: the saved
 * view of the map, or what is on screen.
 */

/** Base of the storage key; the namespace suffix follows a colon (`ebgeo_vista_da_pessoa:<suffix>`). */
const STORAGE_KEY_BASE = 'ebgeo_vista_da_pessoa';

/** Shape version of the record. A record of another version reads as absent. */
const RECORD_VERSION = 1;

/**
 * How many maps one record keeps, the most recently chosen last. A map that was deleted leaves its
 * entry behind (nothing here knows which maps exist), so the record is bounded by recency instead.
 * The product caps an atlas at 100 maps, so an entry only falls off for maps nobody touched for a
 * long time.
 */
export const MAX_REMEMBERED_MAPS = 200;

/**
 * @typedef {Object} PersonViewTarget
 * @property {string} dbSuffix - Database suffix of the namespace the view belongs to.
 * @property {string|null} owner - User id in a server atlas, `null` in a local one.
 * @property {string} mapKey - Map id when the map has one, its name otherwise.
 */

/**
 * @typedef {Object} RememberedView
 * @property {string} [baseLayer] - Base layer id the person last chose on this map.
 * @property {boolean} [temporalEnabled] - Temporal switch the person last chose on this map.
 */

/**
 * @param {string} dbSuffix - Namespace suffix.
 * @returns {string} The `localStorage` key of that namespace's record.
 */
export function personViewStorageKey(dbSuffix) {
    return `${STORAGE_KEY_BASE}:${dbSuffix}`;
}

/** @returns {Storage|null} */
function storage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * @param {*} target
 * @returns {boolean} Whether it names a namespace, an owner and a map.
 */
function isTarget(target) {
    return Boolean(target)
        && typeof target.dbSuffix === 'string'
        && (target.owner === null || (typeof target.owner === 'string' && target.owner.length > 0))
        && typeof target.mapKey === 'string' && target.mapKey.length > 0;
}

/**
 * Keeps only the two fields this record knows, each in its own type.
 * @param {*} entry
 * @returns {RememberedView}
 */
function cleanEntry(entry) {
    const out = {};
    if (entry && typeof entry.baseLayer === 'string' && entry.baseLayer.length > 0) out.baseLayer = entry.baseLayer;
    if (entry && typeof entry.temporalEnabled === 'boolean') out.temporalEnabled = entry.temporalEnabled;
    return out;
}

/**
 * @param {*} value
 * @returns {boolean} Whether a parsed value is a record this build can act on.
 */
function isRecord(value) {
    return Boolean(value) && value.v === RECORD_VERSION
        && (value.owner === null || typeof value.owner === 'string')
        && Array.isArray(value.maps)
        && value.maps.every((item) => item && typeof item.key === 'string');
}

/**
 * @param {string} dbSuffix
 * @returns {{v: number, owner: (string|null), maps: Array<{key: string}>}|null}
 */
function readRecord(dbSuffix) {
    const ls = storage();
    if (!ls) return null;
    try {
        const raw = ls.getItem(personViewStorageKey(dbSuffix));
        if (!raw) return null;
        const value = JSON.parse(raw);
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} dbSuffix
 * @param {Object|null} record - Null removes the record.
 * @returns {boolean} Whether the storage accepted the write.
 */
function writeRecord(dbSuffix, record) {
    const ls = storage();
    if (!ls) return false;
    try {
        if (record === null || record.maps.length === 0) ls.removeItem(personViewStorageKey(dbSuffix));
        else ls.setItem(personViewStorageKey(dbSuffix), JSON.stringify(record));
        return true;
    } catch {
        return false;
    }
}

/**
 * What this person remembers for one map, or an empty object.
 * @param {PersonViewTarget|null} target
 * @returns {RememberedView}
 */
export function readPersonView(target) {
    if (!isTarget(target)) return {};
    const record = readRecord(target.dbSuffix);
    if (!record || record.owner !== target.owner) return {};
    return cleanEntry(record.maps.find((item) => item.key === target.mapKey));
}

/**
 * Merges a choice into what this person remembers for one map, and moves the map to the recent end.
 *
 * A patch field of the wrong type is IGNORED, never written as a hole: `baseLayer` must be a
 * non-empty string and `temporalEnabled` a boolean, and a patch left with neither writes nothing.
 * @param {PersonViewTarget|null} target
 * @param {RememberedView} patch
 * @returns {boolean} Whether something was written.
 */
export function rememberPersonView(target, patch) {
    if (!isTarget(target)) return false;
    const choice = cleanEntry(patch);
    if (Object.keys(choice).length === 0) return false;

    const current = readRecord(target.dbSuffix);
    const record = current && current.owner === target.owner
        ? current
        : { v: RECORD_VERSION, owner: target.owner, maps: [] };
    const previous = cleanEntry(record.maps.find((item) => item.key === target.mapKey));
    const maps = record.maps.filter((item) => item.key !== target.mapKey);
    maps.push({ key: target.mapKey, ...previous, ...choice });
    return writeRecord(target.dbSuffix, {
        v: RECORD_VERSION,
        owner: target.owner,
        maps: maps.slice(-MAX_REMEMBERED_MAPS),
    });
}

/**
 * Forgets some fields of what this person remembers for one map.
 * @param {PersonViewTarget|null} target
 * @param {{baseLayer?: boolean, temporalEnabled?: boolean}} [fields] - Which fields to forget;
 *   both by default.
 * @returns {boolean} Whether something was removed.
 */
export function forgetPersonView(target, { baseLayer = true, temporalEnabled = true } = {}) {
    if (!isTarget(target) || (!baseLayer && !temporalEnabled)) return false;
    const record = readRecord(target.dbSuffix);
    if (!record || record.owner !== target.owner) return false;
    const index = record.maps.findIndex((item) => item.key === target.mapKey);
    if (index < 0) return false;

    const entry = cleanEntry(record.maps[index]);
    if (baseLayer) delete entry.baseLayer;
    if (temporalEnabled) delete entry.temporalEnabled;
    const maps = [...record.maps];
    if (Object.keys(entry).length === 0) maps.splice(index, 1);
    else maps[index] = { key: target.mapKey, ...entry };
    return writeRecord(target.dbSuffix, { ...record, maps });
}

/**
 * Moves what is remembered under one map key to another, for a map keyed by NAME that was renamed.
 * A map keyed by id never needs this: its key does not change with the name.
 * @param {string} dbSuffix
 * @param {string} oldKey
 * @param {string} newKey
 * @returns {boolean} Whether an entry moved.
 */
export function movePersonView(dbSuffix, oldKey, newKey) {
    if (typeof dbSuffix !== 'string' || !oldKey || !newKey || oldKey === newKey) return false;
    const record = readRecord(dbSuffix);
    const entry = record?.maps.find((item) => item.key === oldKey);
    if (!entry) return false;
    const maps = record.maps.filter((item) => item.key !== oldKey && item.key !== newKey);
    maps.push({ ...cleanEntry(entry), key: newKey });
    return writeRecord(dbSuffix, { ...record, maps });
}

/**
 * Forgets the whole record of a namespace: its atlas was destroyed or its content was replaced.
 * @param {string} dbSuffix
 * @returns {void}
 */
export function forgetPersonViews(dbSuffix) {
    if (typeof dbSuffix !== 'string') return;
    writeRecord(dbSuffix, null);
}
