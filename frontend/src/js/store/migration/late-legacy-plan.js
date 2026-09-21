// Path: js/store/migration/late-legacy-plan.js
import { StoreName } from '../atlas-namespace.js';

/**
 * @fileoverview What to do with what the PREVIOUS product line wrote AFTER the transition
 * committed, decided from fingerprints alone.
 *
 * ===========================================================================================
 * WHY THIS EXISTS (owner's decision, 2026-09-21)
 * ===========================================================================================
 * Both lines share one origin, so a person who opens the new version, goes back to the old one
 * and draws, finds the new version stopped on a recovery screen. Measured on the first report:
 * the atlas in the new version was the old one frozen at 09:13, untouched since, and the old one
 * had two lines drawn at 09:27 and 09:28. Nothing could be lost by bringing them over, and the
 * screen asked the person to decide anyway. The owner's rule: the trivial case resolves itself,
 * and the screen stays only for a real conflict.
 *
 * ===========================================================================================
 * THE RULE IS A THREE-WAY MERGE, AND THE THREE WAYS ARE ALREADY ON DISK
 * ===========================================================================================
 * The journal keeps two inventories that describe the same instant from both sides: the
 * migrated acervo as it landed (`resultInventory`, the BASE of both sides) and, after the first
 * absorption, the pair this module leaves behind (`lateBase`). The legacy side is compared in
 * MIGRATED form: the current legacy acervo is copied and migrated into a staging scope, and its
 * inventory is diffed against the migrated base. Comparing raw legacy records instead would put
 * two schemas on one scale.
 *
 * THE TWO BASES ARE DIFFERENT AFTER THE FIRST ABSORPTION, and collapsing them loses data. The
 * legacy side's base is "the legacy acervo, migrated, as of the last absorption"; the
 * destination's base is "the destination as the last absorption left it". When the destination
 * had edits of its own, those two differ, and diffing the next staging against the DESTINATION
 * would read every edit of the new version as a legacy change and write the stale legacy value
 * over it (`alteracoes-tardias-legado.test.js` holds that case).
 *
 * ===========================================================================================
 * THE UNIT OF CONFLICT IS THE MAP, NOT THE RECORD
 * ===========================================================================================
 * A map is spread across stores (`maps/X`, `groups/X`, `layers_X`, `color_usage_X`...), and its
 * records are coupled: a feature names a layer, a colour count follows the features. Two sides
 * that edited different records of the SAME map would merge into a map whose parts disagree, so
 * every record that belongs to a map is judged as the map. Measured on 2026-09-21: drawing one
 * point in the new version changes `maps/Principal` and `color_usage_Principal`. Opening, panning
 * and zooming changed nothing on the acervo that measure used, and production showed the case it
 * missed: a map with NO colour count gets one written on first open (see `DERIVED_KEYS`).
 *
 * A map is addressed by key, id AND name, because the new version moves per-map settings from
 * the name to the id lazily (`getColorUsageCompat`): the same map can be `color_usage_Principal`
 * on one side and `color_usage_<uuid>` on the other.
 *
 * ===========================================================================================
 * WHAT MAKES A CASE NON-TRIVIAL (the screen stays)
 * ===========================================================================================
 * Two kinds of record never make a case non-trivial: the caches the app recomputes
 * (`DERIVED_KEYS`) and the navigation pointers (`PREFERENCE_KEYS`). A third is decided by the
 * caller, because it needs VALUES and this module only sees fingerprints: a map record the
 * destination rewrote without adding work (the `inert` input). Measured in production on
 * 2026-09-21, in the reporter's own browser: the build deployed that morning re-stamped the
 * `sync` of `maps/Principal` at 09:13:56 with no operation in the journal, and the fingerprint
 * read that as an edit of Principal. A LIMIT that is known and
 * left open: the PNG that three tools regenerate under a feature id (declination, coordination
 * measure, military symbol) is an ordinary image record here, so both sides regenerating the
 * same one is a conflict. It needs the feature type to be told apart from an image feature's
 * bytes, which live under the feature id too.
 *
 *   same_unit          both sides changed the same map, or the same record outside a map
 *   map_removed        the legacy side deleted a whole map: never propagated in silence
 *   image_removed      the legacy side deleted an image while the destination has edits of its
 *                      own, which may reference it
 *   unstable_migration a record whose legacy source did not change came out of the migration
 *                      different: the migration is not deterministic for this acervo, and the
 *                      diff cannot be trusted. Fails toward the screen, never toward a write.
 */

/**
 * The stores whose records belong to a map, with the key prefix that precedes the map address.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const MAP_SCOPED_KEYS = Object.freeze([
    [StoreName.MAPS, ''],
    [StoreName.GROUPS, ''],
    [StoreName.LAYERS, 'layers_'],
    [StoreName.LAYERS, 'activeLayer_'],
    [StoreName.CESIUM3D, 'cesium3d_'],
    [StoreName.STREETVIEW360, 'streetview360_'],
    [StoreName.COMMENTS, 'comments_'],
    [StoreName.SETTINGS, 'color_usage_'],
    [StoreName.SETTINGS, 'map_notes_'],
    [StoreName.SETTINGS, 'gridStyle_'],
    [StoreName.SETTINGS, 'temporal_'],
]);

/**
 * Records that are a CACHE of the map, recomputed by the app from the features, and therefore
 * never an edit of anybody.
 *
 * MEASURED IN PRODUCTION ON 2026-09-21, the same day this rule shipped without it: the first
 * open of the new version runs `performInitialColorAnalysis` on a map whose colour count is
 * missing, and CREATES `color_usage_Principal` in the destination. The plan read that as "the
 * new version edited Principal", and a person who had only opened the new version got the
 * screen this module exists to remove. So a derived record is never a destination change, and it
 * FOLLOWS the side whose map was taken: when a map comes from the legacy side, its derived
 * records come with it, or go, so the cache never describes features the map no longer has.
 */
const DERIVED_KEYS = Object.freeze([
    [StoreName.SETTINGS, 'color_usage_'],
]);

/**
 * Records that say where the person WAS, not what they made: when both sides changed one, the
 * destination's value stays and nobody is asked. Measured on 2026-09-21 on the 11-map production
 * fixture: switching maps in the new version, with no edit at all, writes `lastActiveMap`, and
 * switching maps in the old version does the same, so without this every person who navigated
 * in both would meet the screen over a pointer.
 */
const PREFERENCE_KEYS = Object.freeze([
    [StoreName.SETTINGS, 'lastActiveMap'],
]);

/**
 * Version of the rule, stamped on every remembered conflict. A conflict decided by an older rule
 * is decided again: without this, the fix above would never reach a browser that had already
 * remembered the conflict, because the two acervos it compares are exactly the same ones.
 */
export const LATE_RULE_VERSION = 3;

/** Outcomes of `planLateLegacyChanges`. */
export const LateOutcome = Object.freeze({
    NOTHING: 'nothing',
    ABSORB: 'absorb',
    CONFLICT: 'conflict',
});

/**
 * @param {Array<[string, string, string]>} inventory - `[store, key, hash]` rows.
 * @returns {Map<string, string>} `store/key` -> hash.
 */
function indexInventory(inventory) {
    return new Map((inventory || []).map(([store, key, hash]) => [recordId(store, key), hash]));
}

/**
 * @param {string} store
 * @param {string} key
 * @returns {string}
 */
function recordId(store, key) {
    return JSON.stringify([store, key]);
}

/**
 * The records whose fingerprint differs between two inventories, additions and removals included.
 * @param {Map<string, string>} base
 * @param {Map<string, string>} current
 * @returns {Set<string>}
 */
function changedRecords(base, current) {
    const changed = new Set();
    for (const [id, hash] of current) if (base.get(id) !== hash) changed.add(id);
    for (const id of base.keys()) if (!current.has(id)) changed.add(id);
    return changed;
}

/**
 * Builds the resolver from any address of a map (record key, id, name) to one canonical unit.
 * @param {Array<{ key: string, id?: string, name?: string }>} maps - Map records of every side.
 * @returns {(address: string) => string} Canonical map address.
 */
function mapResolver(maps) {
    const alias = new Map();
    for (const { key, id, name } of maps || []) {
        if (typeof key !== 'string') continue;
        const canonical = alias.get(key) ?? alias.get(id) ?? alias.get(name) ?? key;
        for (const address of [key, id, name]) {
            if (typeof address === 'string' && address.length > 0 && !alias.has(address)) alias.set(address, canonical);
        }
    }
    return address => alias.get(address) ?? address;
}

/**
 * @param {string} id - Record id from `recordId`.
 * @param {(address: string) => string} resolve - Map resolver.
 * @returns {string} The unit a record is judged as.
 */
function unitOf(id, resolve) {
    const [store, key] = JSON.parse(id);
    for (const [mapStore, prefix] of MAP_SCOPED_KEYS) {
        if (store === mapStore && key.startsWith(prefix)) {
            return `map:${resolve(key.slice(prefix.length))}`;
        }
    }
    return `record:${id}`;
}

/**
 * @param {string} id - Record id from `recordId`.
 * @returns {boolean} True for a cache the app recomputes from the map (`DERIVED_KEYS`).
 */
function isDerived(id) {
    const [store, key] = JSON.parse(id);
    return DERIVED_KEYS.some(([derivedStore, prefix]) => store === derivedStore && key.startsWith(prefix));
}

/**
 * @param {string} id - Record id from `recordId`.
 * @returns {boolean} True for a navigation pointer (`PREFERENCE_KEYS`).
 */
function isPreference(id) {
    const [store, key] = JSON.parse(id);
    return PREFERENCE_KEYS.some(([preferenceStore, name]) => store === preferenceStore && key === name);
}

/**
 * Decides what to do with the late legacy changes.
 *
 * @param {Object} input
 * @param {Array} input.migratedBase - Legacy side's base, in migrated form.
 * @param {Array} input.staged - Current legacy acervo, migrated in a staging scope.
 * @param {Array} input.destinationBase - Destination's base.
 * @param {Array} input.destination - Destination now.
 * @param {Array} input.rawBase - Legacy acervo, RAW, at the instant `migratedBase` was taken.
 * @param {Array} input.rawNow - Legacy acervo, RAW, now (the one that was staged).
 * @param {Array<{ key: string, id?: string, name?: string }>} input.maps - Map records of the
 *   staging and of the destination, for the address resolver.
 * @param {Array<[string, string]>} [input.inert] - Destination records that changed on disk but
 *   carry no work the legacy side lacks, as proved by the caller (`inertMapChanges` in
 *   `legacy-transition.js`). They are not destination changes.
 * @returns {{ outcome: string, reason?: string, writes: Array<[string, string]>,
 *   deletes: Array<[string, string]> }} `writes` and `deletes` name destination records.
 */
export function planLateLegacyChanges({ migratedBase, staged, destinationBase, destination, rawBase, rawNow, maps, inert = [] }) {
    const stagedIndex = indexInventory(staged);
    const legacyChanges = changedRecords(indexInventory(migratedBase), stagedIndex);
    const plan = { outcome: LateOutcome.NOTHING, writes: [], deletes: [] };
    if (legacyChanges.size === 0) return plan;

    const conflict = reason => ({ outcome: LateOutcome.CONFLICT, reason, writes: [], deletes: [] });
    const destinationIndex = indexInventory(destination);
    const inertIds = new Set(inert.map(([store, key]) => recordId(store, key)));
    const destinationChanges = [...changedRecords(indexInventory(destinationBase), destinationIndex)]
        .filter(id => !isDerived(id) && !inertIds.has(id));
    const raw = { base: indexInventory(rawBase), now: indexInventory(rawNow) };
    const resolve = mapResolver(maps);
    const destinationUnits = new Set(destinationChanges.map(id => unitOf(id, resolve)));
    const takenUnits = new Set();

    for (const id of legacyChanges) {
        const [store] = JSON.parse(id);
        const isLegacyRecord = raw.base.has(id) || raw.now.has(id);
        if (isLegacyRecord && raw.base.get(id) === raw.now.get(id)) return conflict('unstable_migration');
        if (isDerived(id)) continue;
        if (isPreference(id) && destinationChanges.includes(id)) continue;
        const removed = !stagedIndex.has(id);
        if (removed && store === StoreName.MAPS) return conflict('map_removed');
        if (removed && store === StoreName.IMAGES && destinationChanges.length > 0) return conflict('image_removed');
        const unit = unitOf(id, resolve);
        if (destinationUnits.has(unit)) return conflict('same_unit');
        takenUnits.add(unit);
        (removed ? plan.deletes : plan.writes).push(JSON.parse(id));
    }

    // The caches of every map taken from the legacy side follow it, whichever side last wrote them.
    for (const id of new Set([...stagedIndex.keys(), ...destinationIndex.keys()])) {
        if (!isDerived(id) || !takenUnits.has(unitOf(id, resolve))) continue;
        if (stagedIndex.get(id) === destinationIndex.get(id)) continue;
        (stagedIndex.has(id) ? plan.writes : plan.deletes).push(JSON.parse(id));
    }
    plan.outcome = plan.writes.length || plan.deletes.length ? LateOutcome.ABSORB : LateOutcome.NOTHING;
    return plan;
}
