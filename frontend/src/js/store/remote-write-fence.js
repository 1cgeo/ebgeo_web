// Path: js/store/remote-write-fence.js

const PREFIX = 'ebgeo_remote_write_epoch:';
const mounts = new WeakMap();

function read(scope) {
    const raw = globalThis.localStorage?.getItem(PREFIX + scope.dbSuffix);
    if (raw === null || raw === undefined) return { epoch: 0, discarded: false };
    const state = JSON.parse(raw);
    if (!state || !Number.isSafeInteger(state.epoch) || state.epoch < 0 || typeof state.discarded !== 'boolean') {
        throw new Error('O registro de descarte deste atlas está inválido.');
    }
    return state;
}

function write(scope, discarded) {
    if (scope?.kind !== 'remote') throw new Error('O descarte remoto não pode alterar um atlas local.');
    const state = read(scope);
    if (!globalThis.localStorage || state.epoch === Number.MAX_SAFE_INTEGER) {
        throw new Error('Não foi possível registrar o descarte remoto com segurança.');
    }
    globalThis.localStorage.setItem(PREFIX + scope.dbSuffix, JSON.stringify({ epoch: state.epoch + 1, discarded }));
}

/** Capture at mount/birth, before an asynchronous operation can outlive its session. */
export function captureRemoteWriteFence(scope) {
    if (scope?.kind !== 'remote') return () => {};
    if (!mounts.has(scope)) mounts.set(scope, read(scope).epoch);
    const epoch = mounts.get(scope);
    const assertWritable = () => {
        const state = read(scope);
        if (state.discarded || state.epoch !== epoch) {
            throw new DOMException('As pendências desta sessão foram descartadas. Esta gravação foi cancelada.', 'AbortError');
        }
    };
    assertWritable();
    return assertWritable;
}

/** Only call after explicit discard consent and exclusion of locally adopted namespaces. */
export function discardRemoteWrites(scope) {
    write(scope, true);
}

/** Called after the abandoned databases have been cleared, before a fresh remote mount. */
export function reopenRemoteWrites(scope) {
    if (scope?.kind !== 'remote') return;
    if (read(scope).discarded) write(scope, false);
}

/** A persisted fence also recovers interrupted writes of the asynchronous registry. */
export function remoteWritesDiscarded(scope) {
    return scope?.kind === 'remote' && read(scope).discarded;
}
