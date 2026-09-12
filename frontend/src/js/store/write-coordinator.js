// Path: js/store/write-coordinator.js

const mounts = new WeakMap();

function stateFor(scope) {
    if (!scope) return null;
    if (!mounts.has(scope)) mounts.set(scope, { paused: 0, writers: new Set() });
    return mounts.get(scope);
}

/** Register before preparing an edit, so recovery can wait for its final journal state. */
export function beginStoreWrite(scope) {
    const state = stateFor(scope);
    if (!state) return () => {};
    if (state.paused) throw new Error('O atlas está recuperando alterações. Aguarde antes de editar.');
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    state.writers.add(pending);
    return () => { state.writers.delete(pending); finish(); };
}

/** Stop new writers immediately. Never leave a waiting writer holding a document lock. */
export function pauseStoreWrites(scope) {
    const state = stateFor(scope);
    if (!state) return { settled: Promise.resolve(), resume() {} };
    state.paused += 1;
    let resumed = false;
    return {
        settled: Promise.all([...state.writers]),
        resume() {
            if (!resumed) state.paused -= 1;
            resumed = true;
        },
    };
}
