// Path: js/store/sync/mutation-contract.js

/**
 * @fileoverview What an outbound operation DECLARES about the state it was written against: the
 * revision it observed, and the units it changed. One entry point for every collaborative entity.
 *
 * WHY THE DECLARATION IS THE WHOLE MECHANISM. The server's base-and-revision check is gated on the
 * operation DECLARING a base, never on its target (`hasDeclaredBase`,
 * `backend/src/modules/sync/entity-conflicts.js`). That gate was written that way on purpose, so
 * that the day the client starts stamping a base on a map or a layer the check switches itself on
 * with no server change and no flag day. This file is that day. Until it existed, the only entity
 * that declared anything was `feature`, and every other one was applied by arrival order — not as
 * a policy, but as the absence of one.
 *
 * NO BASE IS A FIRST-CLASS ANSWER, and it is what an unconfirmed document gets: a local atlas, a
 * document this client has never seen the server's revision of, a snapshot written by a build that
 * predates `confirmedVersion`. The operation then travels exactly as it does today and the server
 * keeps applying it by arrival. That is the degradation path, and it has to stay cheap, because
 * the alternative (refusing to send) would turn a missing number into lost work.
 *
 * WHAT THE SERVER ACTUALLY READS TODAY, stated because the gap is invisible from here and would
 * otherwise be discovered by someone debugging a refusal. The server derives the disputed units
 * from the COLUMNS the payload declares (`declaredUpdateColumns`, `sync.service.js`), NOT from the
 * `patch` this file builds: `patch` is read only on the feature path, which is the only entity the
 * server applies patch-wise. For an entity whose payload is a whole document (a layer, a group, a
 * briefing) the server therefore disputes every unit that document carries, and that is the honest
 * verdict rather than an approximation: a whole-document write from a stale base really does
 * overwrite every one of those units, which is precisely the silent loss the check exists to stop.
 * Where the client already sends a narrow payload (a map rename is `{name}`, a lock toggle is
 * `{locked}`, every map sub-type is narrowed by contract) the units are as fine as the table.
 * Making `patch` the server's source of units is a SERVER change and belongs to the same step that
 * gives each entity a canonical serializer.
 *
 * THE ONE ENTITY THAT STILL DECLARES NOTHING IS `map`, AND ITS FIVE SUB-TYPES, which is stated
 * here because the table above would otherwise promise it. A declaration is read out of
 * `previousData`, and the map's write sites hand over the changed FIELD and not the document: a
 * rename records `{name: oldName}`, a lock toggle records `{locked: false}`, a position op records
 * the previous position. None of them carries the confirmed revision, so none declares a base, and
 * the map keeps arrival-order behaviour. Closing it means reading the map document at those sites,
 * and that document carries every feature of the map: a full read on a gesture that today reads
 * nothing. The cheap fix is the other direction, and it belongs with the canonical serializer
 * work: a map receipt that returns the row would let the write site carry the number it already
 * learned. Registered in `docs/reviews/fechamento/03-conflitos.md`.
 */

import { deepEqual } from '../../utilities/deep-utils.js';
import { featureMutationContract } from './feature-patch.js';
import { readConfirmedVersion } from './confirmed-version.js';
import { hasDisputeUnits, unitsForFields } from './dispute-units.js';

/**
 * Fields that describe the local copy of an entity rather than its content, so a change in one of
 * them is not a change anybody can dispute. `version` counts THIS client's writes and moves on
 * every edit; `confirmedVersion` is the declaration itself; the rest is sync bookkeeping that
 * `createSyncMetadata` puts on atlas, map and group documents.
 */
const BOOKKEEPING = new Set([
    'id', 'sync', 'version', 'confirmedVersion', 'createdAt', 'updatedAt',
    'dirty', 'deleted', 'deletedAt', 'ownerId',
]);

/**
 * The declaration for one NON-feature collaborative entity.
 *
 * @param {string} entityType - Client entity type.
 * @param {string} operationType - create / update / delete.
 * @param {Object|null} data - The new document.
 * @param {Object|null} previousData - The document read from the repository before the write.
 * @returns {{protocolVersion: number, baseVersion: number|null, patch: Array|null}}
 */
export function entityMutationContract(entityType, operationType, data, previousData) {
    const baseVersion = readConfirmedVersion(previousData, entityType);
    // A create observes no revision and a delete claims the whole entity, so neither carries a
    // patch. Same shape the feature contract produces, for the same reasons. NO BASE means no
    // patch either: with nothing to compare against, a list of changed units describes a dispute
    // nobody can judge, and publishing it would invite a reader to treat it as one.
    if (operationType !== 'update' || baseVersion === null || !previousData || !data) {
        return { protocolVersion: 2, baseVersion, patch: null };
    }
    const patch = [];
    for (const key of new Set([...Object.keys(previousData), ...Object.keys(data)])) {
        if (BOOKKEEPING.has(key) || deepEqual(previousData[key], data[key])) continue;
        patch.push(Object.hasOwn(data, key)
            ? { op: 'set', path: [key], value: data[key] }
            : { op: 'remove', path: [key] });
    }
    return { protocolVersion: 2, baseVersion, patch };
}

/**
 * The declaration for ANY entity, or an empty object for one that declares nothing.
 *
 * `groupFeature` and `setting` fall through deliberately: a junction row whose create and delete
 * are idempotent has nothing for two writers to disagree about, and atlas settings are merged per
 * key, so a merge has no loser.
 *
 * @param {string} entityType - Client entity type.
 * @param {string} operationType - create / update / delete.
 * @param {Object|null} data - The new document.
 * @param {Object|null} previousData - The document read before the write.
 * @returns {Object} Wire fields to spread onto the operation envelope.
 */
export function mutationContract(entityType, operationType, data, previousData) {
    if (entityType === 'feature') return featureMutationContract(operationType, data, previousData);
    if (!hasDisputeUnits(entityType)) return {};
    return entityMutationContract(entityType, operationType, data, previousData);
}

/**
 * Which units of dispute a declaration claims. Not a wire field (the push schema strips what it
 * does not declare); it is how a test, and later the resolution panel, read a patch back against
 * the table the server judges by.
 *
 * @param {string} entityType - Client entity type.
 * @param {Array|null} patch - The `patch` of a declaration.
 * @returns {string[]} Unit names.
 */
export function claimedUnits(entityType, patch) {
    if (!Array.isArray(patch)) return [];
    return unitsForFields(entityType, patch.map((entry) => entry.path[0]));
}
