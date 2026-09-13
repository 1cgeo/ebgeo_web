// Path: js/store/atlas-setting-target.js

/**
 * @fileoverview The entity id an atlas-level `setting` operation must carry.
 *
 * WHY THIS IS NOT A DETAIL. A `setting` op whose `entityId` is neither a UUID nor the `'atlas'`
 * sentinel is DROPPED before it reaches the queue (`persistOperationIntents` and `logOperation`
 * both filter it), because Postgres refuses a non-UUID id (22P02) and that one op would fail the
 * ENTIRE flush batch, blocking all sync. So the id decides whether the intention is durable at
 * all, and every writer of an atlas key has to answer the same question the same way.
 *
 * IT EXISTS BECAUSE THE ANSWER MOVED INSIDE THE TRANSACTION. `logAtlasSetting`
 * (`sync/operation-dispatcher.js`) resolved the id at LOGGING time, after the local write; a
 * write-ahead producer needs it BEFORE `tx.recordOperation`, which is before the local write.
 * The resolution rule is deliberately the same one that function uses, and three producers now
 * share it (`setMapOrder`, `setMapBadgeColors`, `saveAtlasAppearance`, plus the custom-icon
 * registry) instead of each copying it.
 *
 * The remote scope answers from memory (`scope.atlasId`) and never touches disk. A local atlas
 * has to be asked, and a slot with no Atlas row yet is the COMMON case, not an error: the
 * sentinel is the honest answer there, and the server scopes a `setting` by the ROUTE atlas and
 * ignores the id, so the sentinel still applies the patch to the right project.
 *
 * Zero imports beyond the repository facade, so it stays loadable from the pages that boot
 * without the store barrel.
 */

import { getRepository } from './repositories/index.js';

/** The id used when this installation has no Atlas row to name yet. */
export const ATLAS_SETTING_SENTINEL = 'atlas';

/**
 * The `entityId` for a `setting` op about the mounted atlas.
 *
 * @param {{kind: string, atlasId?: string}|null} scope - The scope the transaction was born in
 * @param {{id?: string}|null} [atlas=null] - An Atlas record the caller already read, when it has
 *   one: it spares a second read and keeps the answer consistent with what was just written.
 * @returns {Promise<string>} A UUID, or {@link ATLAS_SETTING_SENTINEL}
 */
export async function resolveAtlasSettingId(scope, atlas = null) {
    if (scope?.kind === 'remote' && scope.atlasId) return scope.atlasId;
    if (atlas?.id) return atlas.id;
    try {
        const stored = await getRepository().getAtlas?.();
        if (stored?.id) return stored.id;
    } catch {
        // No atlas record, or no repository mounted yet. The sentinel is the answer.
    }
    return ATLAS_SETTING_SENTINEL;
}
