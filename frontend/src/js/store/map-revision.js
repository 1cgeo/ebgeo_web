// Path: js/store/map-revision.js

/**
 * @fileoverview The map's confirmed server revision, in the shape a `previousData` carries it.
 *
 * WHY THIS EXISTS. An outbound operation declares the revision it observed by carrying
 * `confirmedVersion` inside its `previousData` (`entityMutationContract`, `sync/mutation-contract.js`),
 * and that is read by the server as the gate of the whole base-and-revision check
 * (`hasDeclaredBase`, `backend/src/modules/sync/entity-conflicts.js`). Every other entity gets it
 * for free, because the store hands the document it just read as `previousData`. The MAP does not:
 * its six write sites record the FIELD they changed (`{name: oldName}`, `{locked: false}`, the
 * previous position, the previous notes, grid or temporal settings), so `previousData` is a
 * fragment of a map and never the map. The map was therefore the one entity applied purely by
 * arrival order, which is not a policy, it is the absence of one.
 *
 * THE COST IS WHY IT IS A MODULE AND NOT A LINE AT EACH SITE. Three of those sites already hold the
 * map document (base layer, save position, clear position) and pay nothing: {@link mapRevisionOf}
 * reads it out of what they have. The other three (rename, lock, and the three map-setting writers
 * that live in other files) hold no document at all, and for them {@link readMapRevision} reads it
 * from the repository. That read is not free: a map document carries the map's whole feature
 * collection. It is spent on gestures a person performs one at a time (renaming a map, toggling its
 * lock, editing its notes, its grid or its temporal window) and never on the hot path, which is
 * exactly the position update that already had the document in hand.
 *
 * WHY NOT AN IN-MEMORY REGISTRY OF REVISIONS, which is the obvious cheaper answer: the confirmed
 * revision has a CLEARING rule (`clearConfirmedVersion`, called wherever an inbound payload is
 * merged into the local document without dating it), because a stale base is worse than none. A
 * second copy in memory would have to mirror every one of those clears, and the copy that forgets
 * one hands the author a base the server has already moved past, producing a refusal naming units
 * the author never disputed. The document is the single home of the fact; this module only reads it.
 *
 * ABSENT IS THE SAFE ANSWER, and it is why every function here returns an EMPTY object rather than
 * throwing or guessing: a map whose server revision this client cannot prove sends its operation
 * with no base and the server keeps applying it by arrival, exactly as before this existed.
 *
 * ASK BY NAME, NOT BY ID, when the caller has both. `getMapDataCompat` answers to either, and its
 * fast path is a direct key lookup: in a LOCAL atlas the maps are name-keyed, so an id would miss
 * the key, miss the resolver and fall through to a full scan of every map of the atlas. Every
 * caller here holds the name, so none of them pays for that.
 */

import { getMapDataCompat } from './repositories/index.js';
import { readConfirmedVersion } from './sync/confirmed-version.js';

/**
 * The declaration fragment to spread into a map operation's `previousData`, from a map document
 * the caller already holds.
 *
 * @param {Object|null|undefined} mapDocument - The stored map document.
 * @returns {{confirmedVersion?: number}} Empty when the document proves no revision.
 */
export function mapRevisionOf(mapDocument) {
    const revision = readConfirmedVersion(mapDocument);
    return revision === null ? {} : { confirmedVersion: revision };
}

/**
 * The same fragment, for a caller that does not hold the document.
 *
 * Best-effort by design: a read that fails costs one operation of arrival-order behaviour, which
 * is where every map operation started, and must never turn a rename into a thrown error.
 *
 * @param {string} mapNameOrId - Map name or UUID.
 * @returns {Promise<{confirmedVersion?: number}>}
 */
export async function readMapRevision(mapNameOrId) {
    try {
        return mapRevisionOf(await getMapDataCompat(mapNameOrId));
    } catch {
        return {};
    }
}
