// Path: js/store/sync/auto-flush-pause.js

// Shared with account-only pages: no import of the map or sync engine belongs here.
let pauses = 0;
const active = new Set();

export function canStartAutoFlush() { return pauses === 0; }

export function trackAutoFlush() {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    active.add(pending);
    return () => { active.delete(pending); finish(); };
}

/** Suspend new sends and expose the completion of every already-started auto-flush. */
export function pauseAutoFlush() {
    pauses += 1;
    let resumed = false;
    return {
        settled: Promise.all([...active]),
        resume() {
            if (!resumed) pauses -= 1;
            resumed = true;
        },
    };
}
