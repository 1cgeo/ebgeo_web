// Path: js/store/sync/legacy-queue.js

export const LEGACY_QUEUE_CODE = 'SYNC_PROTOCOL_REVIEW';

/** A missing version is not evidence that an old intention is safe to replay. */
export function legacyQueueIssue(operation) {
    if (operation.protocolVersion === 2) return null;
    return {
        rejected: true,
        status: 'review',
        code: LEGACY_QUEUE_CODE,
        reason: 'Esta alteração foi criada por uma versão incompatível e precisa de revisão antes de ser enviada.',
    };
}

/**
 * Receipt lookup is read-only. Never send an old operation to discover whether
 * it was applied, and never change its envelope to make it pass a new schema.
 * @returns {Promise<number>} Number of old intentions whose outcome needs review.
 */
export async function reconcileLegacyQueue(queue, lookup, assertActive) {
    const legacy = (await queue.getAll()).filter(op => legacyQueueIssue(op));
    const recorded = new Set((await queue.getIssues()).map(issue => issue.operation.id));
    assertActive();
    for (const operation of legacy) {
        if (!recorded.has(operation.id)) await queue.recordIssue(operation, legacyQueueIssue(operation));
        assertActive();
    }
    let pending = legacy.length;
    for (let offset = 0; offset < legacy.length; offset += 100) {
        const batch = legacy.slice(offset, offset + 100);
        const response = await lookup(batch);
        assertActive();
        for (const operation of batch) {
            // Absence, ambiguity or an error is never proof of delivery.
            const matches = response?.results?.filter(result => result.opId === operation.id) ?? [];
            if (matches.length !== 1 || matches[0].status !== 'confirmed') continue;
            await queue.dequeue([operation.id]);
            assertActive();
            pending--;
        }
    }
    return pending;
}
