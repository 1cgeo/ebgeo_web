// Path: js/store/sync/snapshot-frontier.js
// Receipt/live-event versions are NOT complete replay cursors. They do, however, prove
// that an older full snapshot cannot replace this mount without losing known commits.
const observedVersions = new WeakMap();

export function observeServerVersion(version, scope) {
    if (scope?.kind !== 'remote' || !Number.isSafeInteger(version) || version < 0) return;
    observedVersions.set(scope, Math.max(observedVersions.get(scope) ?? 0, version));
}

export function assertSnapshotCurrent(version, scope) {
    if (scope?.kind !== 'remote' || version >= (observedVersions.get(scope) ?? 0)) return;
    const error = new Error('O retrato recebido é anterior a uma alteração já confirmada.');
    error.code = 'STALE_SYNC_SNAPSHOT';
    throw error;
}
