// Path: js/store/sync/confirmed-version.js

/**
 * @fileoverview The revision of an entity that the SERVER has confirmed, kept on the local
 * document so the next local edit can declare the base it observed.
 *
 * WHY A FIELD AND NOT A SIDE TABLE. The base an operation declares is read at the moment the
 * operation is born, from `previousData` — the document the store read out of IndexedDB just
 * before writing over it (`tx.recordOperation`). Anything that is not IN that document is not
 * available at that point without a second read on every write, and a second read that can fail
 * would make the base disappear silently, which is the one failure this whole mechanism exists to
 * avoid. The feature path reached the same conclusion first and put `confirmedVersion` inside
 * `properties`; this module is that decision generalised, with the SAME field name, because two
 * names for one fact is how the two halves drift.
 *
 * `version` IS NOT IT, and confusing the two is the cheap mistake here. Every entity already
 * carries a local `version` that the client increments on each local edit (`layer.manager.js`
 * does `(layer.version || 0) + 1`), so it counts LOCAL writes and means nothing to the server.
 * `confirmedVersion` is the value of the server's own `version` column at the last moment this
 * client had proof of it: a snapshot row, a canonical operation, or a push receipt.
 *
 * ABSENT IS A LEGITIMATE STATE, and it is the SAFE one. A document with no `confirmedVersion` is
 * a document whose server revision this client cannot prove, so its operation goes out with no
 * base and the server keeps applying it by arrival order, exactly as before any of this existed
 * (`hasDeclaredBase`, `backend/src/modules/sync/entity-conflicts.js`). That is why the stamping
 * helpers are no-ops on a payload without a numeric `version`, and why the CLEARING helper exists
 * at all: an inbound operation that merges a partial payload into the local document leaves a
 * revision that is now older than the row it describes, and a STALE base is worse than none — it
 * makes the author's next edit lose to a change the author has already seen.
 *
 * ZERO IMPORTS by contract, so it is loadable in plain node and can be read by the store, by the
 * sync client and by tests without dragging the store barrel along.
 */

/** The single name of the fact, shared with the feature path. */
export const CONFIRMED_VERSION_FIELD = 'confirmedVersion';

/**
 * Where the field lives for a given entity type. A feature is a GeoJSON Feature, so everything
 * that is not geometry lives under `properties`; every other entity is a flat document.
 * @param {string} entityType - Client entity type.
 * @returns {boolean}
 */
export function confirmedVersionInProperties(entityType) {
    return entityType === 'feature';
}

/**
 * The server revision a value claims, or null when it claims none.
 * @param {*} value - Anything.
 * @returns {number|null}
 */
function asRevision(value) {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Reads the confirmed revision of a stored document.
 * @param {Object|null|undefined} document - Stored entity (or GeoJSON feature).
 * @param {string} [entityType] - Client entity type, to find the right level.
 * @returns {number|null}
 */
export function readConfirmedVersion(document, entityType = null) {
    if (!document || typeof document !== 'object') return null;
    const holder = confirmedVersionInProperties(entityType) ? document.properties : document;
    return asRevision(holder?.[CONFIRMED_VERSION_FIELD]);
}

/**
 * Stamps an explicit revision onto a document, IN PLACE.
 *
 * In place because every caller has just built or just read the object it is about to persist,
 * and returning a copy would leave the caller free to persist the copy or the original.
 * @param {Object|null|undefined} document - Stored entity.
 * @param {number|string|null|undefined} version - The server revision.
 * @returns {Object|null|undefined} The same document.
 */
export function stampConfirmedVersion(document, version) {
    const revision = asRevision(version);
    if (document && typeof document === 'object' && revision !== null) {
        document[CONFIRMED_VERSION_FIELD] = revision;
    }
    return document;
}

/**
 * Stamps a document from the `version` the server sent ON that same document.
 *
 * A no-op when the payload carries no server revision, which is the ordinary case for a live
 * operation broadcast from another client: what travels there is the AUTHOR's document, and the
 * author's `version` is its own local counter. Only rows the server itself serialised (snapshot
 * rows, a canonical operation) carry a revision worth believing.
 * @param {Object|null|undefined} document - Stored entity carrying a server `version`.
 * @returns {Object|null|undefined} The same document.
 */
export function stampConfirmedVersionFromRow(document) {
    return stampConfirmedVersion(document, document?.version);
}

/** Stamps every element of an array (or of an object's values) from its own `version`. */
export function stampConfirmedVersionFromRows(collection) {
    if (Array.isArray(collection)) {
        for (const item of collection) stampConfirmedVersionFromRow(item);
    } else if (collection && typeof collection === 'object') {
        for (const item of Object.values(collection)) stampConfirmedVersionFromRow(item);
    }
    return collection;
}

/**
 * Forgets the confirmed revision of a document, IN PLACE.
 *
 * The caller has just merged a payload it cannot date. Keeping the old number would declare a
 * base the server has already moved past, and the refusal that produces names units the author
 * never disputed. No number is the honest answer, and it costs one operation of arrival-order
 * behaviour, which is what every entity had until this bloc.
 * @param {Object|null|undefined} document - Stored entity.
 * @returns {Object|null|undefined} The same document.
 */
export function clearConfirmedVersion(document) {
    if (document && typeof document === 'object') delete document[CONFIRMED_VERSION_FIELD];
    return document;
}

/**
 * Carries the confirmed revision from the stored document to the one about to replace it.
 *
 * Most local edits build the next document by spreading the previous one, so the field survives
 * on its own; this exists for the ones that build a fresh object, and as the single place a test
 * can point at. It NEVER overwrites a revision the next document already carries: an inbound
 * canonical payload is fresher than what was on disk.
 * @param {Object|null|undefined} next - The document about to be written.
 * @param {Object|null|undefined} previous - The document being replaced.
 * @returns {Object|null|undefined} `next`.
 */
export function preserveConfirmedVersion(next, previous) {
    if (!next || typeof next !== 'object') return next;
    if (asRevision(next[CONFIRMED_VERSION_FIELD]) !== null) return next;
    return stampConfirmedVersion(next, previous?.[CONFIRMED_VERSION_FIELD]);
}
