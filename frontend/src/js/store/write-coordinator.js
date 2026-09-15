// Path: js/store/write-coordinator.js

/**
 * @fileoverview MAY THIS TAB WRITE TO THE ATLAS RIGHT NOW, asked in two ranges.
 *
 * THE PER-TAB HALF (`beginStoreWrite` / `pauseStoreWrites`) is a module `WeakMap` keyed by scope
 * OBJECT, so it only ever knows about writers of THIS document. It is what a local recovery
 * (`applyRemoteSnapshot`) leans on to wait for the journal state of writes it can see.
 *
 * THE CROSS-TAB HALF (everything below `pauseStoreWrites`) is a Web Lock per remote scope, and it
 * exists because the per-tab half answered the WRONG QUESTION at logout. The logout dialog counts
 * pending work for every server namespace ON THIS BROWSER and then destroys them, siblings
 * included; a count taken while a sibling tab is still writing is optimistic by construction, and
 * no message can prove a sibling stopped (a frozen or throttled tab answers nothing and keeps
 * writing when it wakes). A lock is a FACT of the user agent instead of a claim on a channel.
 *
 * HOW THE TWO MODES MEET, and it is the whole design (each step measured in node 24, which has
 * `navigator.locks`, and the numbers are in `tests/integration/barreira-de-logout-entre-abas.test.js`):
 *
 *   - a WRITER takes the barrier in `shared` mode with `ifAvailable: true`. Shared is compatible
 *     with shared, so concurrent writers in any number of tabs never wait for each other;
 *   - the LOGOUT DIALOG takes the same name in `exclusive` mode and WAITS. Because the queue is
 *     FIFO per name, being merely PENDING already refuses every later `shared ifAvailable`
 *     (measured), so new writes stop the instant the dialog asks, in every tab, without a message;
 *   - the grant of the exclusive is therefore evidence that every in-flight write finished. That
 *     is the drain the dialog needs before it counts;
 *   - a writer refused does NOT WAIT. It fails with `STORE_OPERATION_BLOCKED` and
 *     {@link LOGOUT_BARRIER_NOTICE}, because a write parked behind a dialog somebody may leave open
 *     is a frozen interface, and the interface is not what the barrier is protecting.
 *
 * WHY THE CROSS-TAB CHECK IS NOT INSIDE `beginStoreWrite`: that function is synchronous and every
 * caller of `runTransaction` depends on it being so, while a lock request is not. Caching the
 * answer would reintroduce exactly the thing this replaces, a belief about another tab instead of a
 * fact, so the async half lives at the async entry (`runTransaction`, `beginStoreWrite`'s only
 * production caller) and at the auto-flush loop.
 *
 * WHAT IT DOES NOT COVER, declared because an absence reads as an oversight. The barrier is held
 * for the body of the transaction, and the outbound op is enqueued by a `deferAsync` effect that
 * `runTransaction` starts but does not await, so an enqueue can outlive the release by a microtask.
 * What bars that one after the discard is the write epoch fence
 * (`store/remote-write-fence.js`), which is a different guard with a different clock.
 *
 * WITHOUT `navigator.locks` (plain HTTP, a hardened embedder) every function here degrades to the
 * per-tab behaviour this module had before: no barrier is taken, no write is refused, and the
 * dialog's census is as optimistic as it used to be. Decision 5 of `atlas-namespace.js` is the same
 * trade in the same runtime, and it is stated rather than hidden: the product is served over HTTPS
 * (D1 of the release plan), so the degraded regime is the exception, not the deployment.
 */

const mounts = new WeakMap();

function stateFor(scope) {
    if (!scope) return null;
    if (!mounts.has(scope)) mounts.set(scope, { paused: 0, writers: new Set(), resumeWaiters: new Set() });
    const state = mounts.get(scope);
    // Defensive for a hand-built entry (test doubles seed this map directly): a missing waiter set
    // must degrade into "nobody is waiting", never into a throw inside a write path.
    state.resumeWaiters ??= new Set();
    return state;
}

/**
 * What the user is told when a write is refused because the atlas is being rebuilt.
 *
 * It names the STATE and not the role, like {@link LOGOUT_BARRIER_NOTICE} and every other
 * reversible refusal in the product: the recovery ends on its own, and the same gesture works a
 * moment later.
 */
export const STORE_RECOVERY_NOTICE = 'O atlas está recuperando alterações. Aguarde antes de editar.';

/**
 * Whether an error is the recovery refusal raised by {@link beginStoreWrite}.
 *
 * THE FLAG EXISTS SO THAT NOBODY MATCHES THE SENTENCE. A caller for which this is an EXPECTED
 * failure (return plus `STORE_OPERATION_BLOCKED`) rather than a broken write has to recognise it,
 * and recognising it by message text would break the day the sentence is reworded, silently and in
 * the direction that hurts: an expected refusal would go back to reading as a thrown failure.
 * @param {*} error - Anything caught.
 * @returns {boolean} True only for the refusal this module raises.
 */
export function isStoreRecoveryRefusal(error) {
    return error?.storeRecoveryRefusal === true;
}

/** Register before preparing an edit, so recovery can wait for its final journal state. */
export function beginStoreWrite(scope) {
    const state = stateFor(scope);
    if (!state) return () => {};
    if (state.paused) {
        const refusal = new Error(STORE_RECOVERY_NOTICE);
        refusal.storeRecoveryRefusal = true;
        throw refusal;
    }
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
            if (state.paused === 0) {
                for (const wake of [...state.resumeWaiters]) wake();
                state.resumeWaiters.clear();
            }
        },
    };
}

/**
 * How long a gesture waits for a recovery before it gives up and is refused.
 *
 * Five seconds, and the number is the STAGING of nine databases on a loaded machine, not a guess:
 * the window this closes was measured at hundreds of milliseconds idle and seconds with several
 * browsers running. It is a ceiling on a frozen recovery, not the expected wait, so it is set well
 * above the real one on purpose. It is deliberately NOT {@link BARRIER_DRAIN_TIMEOUT_MS}: that one
 * bounds a cross-tab drain behind a modal dialog, and sharing a number between two unrelated
 * deadlines is how one of them gets retuned for the other's reason.
 */
const RECOVERY_WAIT_TIMEOUT_MS = 5000;

/**
 * Waits until nobody is holding this scope's writes paused, for a GESTURE that has not taken any
 * lock yet. Resolves `true` when writes are open, `false` when the deadline passed with the pause
 * still up.
 *
 * WHY A WAIT EXISTS NEXT TO A REFUSAL, and why it has to live ABOVE the store. `beginStoreWrite`
 * refuses instead of waiting because its caller (`runTransaction`) already holds the map document
 * lock, and `applyRemoteSnapshotInner` takes that same lock per map while it stages: a writer that
 * waited there would wait for a recovery that is waiting for the writer's lock. That reasoning is
 * about the writer's POSITION, not about the answer being right for a person. A gesture that has
 * not entered the store yet holds nothing, so it can simply wait out a staging that lasts a few
 * hundred milliseconds instead of throwing the person's intent away.
 *
 * THE MEASURED DEFECT IT CLOSES, 2026-09-15. Opening a server atlas answers TWO snapshots (see
 * `refusingDuringRecovery` in `store/map.operations.js`, which paid for the same window on the
 * settings path). While the second one stages, every store write in the tab is refused, and the
 * delete gesture swallowed that refusal in each drawing control's `catch` and removed the feature
 * from the MapLibre source anyway: the map showed a deletion that no operation ever carried, and
 * the peers never heard about it.
 *
 * WHAT IS PROVEN AND WHAT IS INFERRED, kept apart on purpose. Proven, by
 * `tests/e2e-ui/delete-durante-recuperacao.repro.spec.js` with the pause taken by hand: the
 * mechanism exists and produces exactly this outcome. Inferred: that it is what made phase 5 of
 * `browser-collab-three-client-flow.spec.js` fail once in sixteen on 2026-09-15, in the client
 * that had just reopened the atlas, with a missing author-side `apply.persist` and no other
 * error. The signature matches and no other path loses an operation that quietly, but that red
 * was never caught in the act: 32 isolated runs afterwards did not reproduce it, which is what a
 * window of a few hundred milliseconds does to repetition.
 *
 * IT IS NOT A SUBSTITUTE FOR THE REFUSAL, and the residue is declared rather than implied: the
 * pause can still start between this answer and the store call, and `runTransaction` still
 * refuses there, silently, with the control still painting. Announcing from `runTransaction`
 * would cover that residue and was tried: it also fires for the writes the person never asked
 * for (`switchMap` persists a base layer on every open, inside this very window), so every atlas
 * open would toast about a recovery nobody started. Naming the state belongs to whoever knows a
 * PERSON asked, which is the gesture.
 *
 * @param {{kind: string, dbSuffix: string}|null|undefined} scope - Scope object, usually the active one.
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=RECOVERY_WAIT_TIMEOUT_MS] - Cap, so a recovery that never
 *   finishes refuses the gesture instead of freezing it.
 * @returns {Promise<boolean>} True when writes are open (including "never paused").
 */
export function whenStoreWritesResume(scope, { timeoutMs = RECOVERY_WAIT_TIMEOUT_MS } = {}) {
    if (!storeWritesPaused(scope)) return Promise.resolve(true);
    const state = stateFor(scope);
    return new Promise((resolve) => {
        let done = false;
        const settle = (value) => {
            if (done) return;
            done = true;
            state.resumeWaiters.delete(wake);
            clearTimeout(timer);
            resolve(value);
        };
        const wake = () => settle(true);
        const timer = setTimeout(() => settle(false), timeoutMs);
        state.resumeWaiters.add(wake);
    });
}

/**
 * Whether SOMEBODY is holding this scope's writes paused RIGHT NOW.
 *
 * WHY A READER EXISTS AT ALL. The sync light has to answer "is my work saved?", and while the atlas
 * is being rebuilt from a snapshot or a replay there is no answer: nothing is being sent, the queue
 * is being rewritten under it, and an empty queue at that instant means "not read yet", not "the
 * server has everything". Until this function existed the light had no way to know, so it painted
 * green over a recovery in progress, which is the worst moment to promise anything.
 *
 * IT READS AND REGISTERS NOTHING: `mounts.get`, never `stateFor`. A question that created an entry
 * would grow the `WeakMap` on every repaint, and the light repaints every three seconds.
 *
 * THE TWO PAUSERS ARE NOT THE SAME EVENT, and naming is the caller's job: `applyRemoteSnapshot`
 * pauses while it rebuilds the atlas, and the exit dialog pauses while it counts pending work. The
 * light reads this as "recovering", which is exact for the first and unreadable for the second
 * (that one happens behind a modal dialog nobody reads the bar through). Carrying a reason would
 * mean a parameter on every call site, and the call sites are two.
 *
 * THE SCOPE MUST BE THE SAME OBJECT the pauser used, because the map is keyed by identity. That
 * object is what `getActiveScope()` returns, and it is the same identity `assertActive` compares
 * against for the same reason.
 * @param {{kind: string, dbSuffix: string}|null|undefined} scope - Scope object, usually the active one.
 * @returns {boolean} False for a scope nobody ever paused, which is the honest answer and not a guess.
 */
export function storeWritesPaused(scope) {
    if (!scope) return false;
    return (mounts.get(scope)?.paused ?? 0) > 0;
}

// ===========================================================================================
// THE CROSS-TAB BARRIER
// ===========================================================================================

/**
 * What the user is told when a write is refused because a sibling tab is leaving the account.
 *
 * It names the STATE and not the role, like every other reversible refusal in the product: the
 * person can be the one who reverts it (finish or cancel the logout in the other window).
 */
export const LOGOUT_BARRIER_NOTICE = 'Outra janela está saindo da conta. '
    + 'Aguarde a saída terminar para editar este atlas.';

/**
 * Prefix of the barrier's lock name. `#` separates the suffix and cannot appear in a `dbSuffix`
 * (`VALID_SUFFIX` in `atlas-namespace.js`), so the mapping suffix -> name is injective, exactly as
 * it is for `atlasMountLockName` and `atlasGenerationLockName`.
 *
 * IT IS A THIRD NAME, not a reuse of the mount lock, and the reason is the same one written into
 * the generation lock: the mount lock is held SHARED by every tab that has the atlas open, so an
 * exclusive request on it would be refused by the asker itself and the barrier would never close.
 */
const BARRIER_LOCK_PREFIX = 'ebgeo-atlas-logout:';

/**
 * @param {string} dbSuffix - Database suffix of a remote scope.
 * @returns {string} Name of the Web Lock that means "a logout dialog owns this namespace".
 */
export function logoutBarrierLockName(dbSuffix) {
    return `${BARRIER_LOCK_PREFIX}#${dbSuffix}`;
}

/**
 * @returns {LockManager|null} The lock manager, or null where it does not exist. Null is a
 *   supported answer: see the fileoverview's degraded regime.
 */
function lockManager() {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

/** @returns {boolean} Whether this runtime can arbitrate the barrier at all. */
export function hasLogoutBarrierSupport() {
    return lockManager() !== null;
}

/**
 * The barrier only ever covers a REMOTE scope: a local atlas is not destroyed by a logout, and
 * making its writers ask would add a lock request to every local edit for nothing.
 * @param {{kind?: string, dbSuffix?: string}|null|undefined} scope
 * @returns {string|null} The lock name, or null when there is nothing to arbitrate.
 */
function barrierNameFor(scope) {
    if (!scope || scope.kind !== 'remote' || typeof scope.dbSuffix !== 'string') return null;
    if (scope.dbSuffix.length === 0) return null;
    return logoutBarrierLockName(scope.dbSuffix);
}

/**
 * Takes the barrier as a WRITER: shared, and refused instead of queued.
 *
 * @param {{kind?: string, dbSuffix?: string}|null} scope - Scope about to be written.
 * @returns {Promise<{blocked: boolean, release: () => void}>} `blocked:true` means a logout dialog
 *   holds the barrier or is waiting for it, and NOTHING was taken. `release` is idempotent and
 *   safe to call in a `finally` in either case.
 */
export async function enterCoordinatedWrite(scope) {
    const manager = lockManager();
    const name = barrierNameFor(scope);
    if (!manager || !name) return { blocked: false, release() {} };

    let release = () => {};
    let resolveEntered;
    const entered = new Promise(resolve => { resolveEntered = resolve; });
    try {
        const settled = manager.request(name, { mode: 'shared', ifAvailable: true }, lock => {
            if (lock === null) {
                resolveEntered(false);
                return undefined;
            }
            const untilDone = new Promise(resolve => { release = resolve; });
            resolveEntered(true);
            return untilDone;
        });
        settled.catch(() => resolveEntered(false));
        const granted = await entered;
        if (!granted) return { blocked: true, release() {} };
        let released = false;
        return {
            blocked: false,
            release() {
                if (released) return;
                released = true;
                release();
            },
        };
    } catch {
        // A runtime that refuses the request must not refuse the edit: the barrier is an
        // arbitration, and a broken arbitration falls back to the per-tab regime.
        return { blocked: false, release() {} };
    }
}

/**
 * ASKS whether the barrier is taken, without taking or waiting for anything.
 *
 * For a writer that has nothing to hold across an await (the auto-flush loop, which pushes what is
 * already on disk). An `exclusive ifAvailable` probe answers "is anybody here", and here the asker
 * is never one of the holders: a writer's own share is released before the loop gets to ask, and
 * the tab whose dialog is open SHOULD read its own barrier as taken.
 *
 * @param {{kind?: string, dbSuffix?: string}|null} scope - Scope about to be written.
 * @returns {Promise<boolean>} True when a logout dialog owns it. False whenever there is no fact
 *   to read, which is the same direction the mount lock degrades in.
 */
export async function logoutBarrierBlocks(scope) {
    const manager = lockManager();
    const name = barrierNameFor(scope);
    if (!manager || !name) return false;
    try {
        return await manager.request(
            name,
            { mode: 'exclusive', ifAvailable: true },
            lock => lock === null
        );
    } catch {
        return false;
    }
}

/**
 * How long the dialog waits for the writers of every tab to drain before it gives up and reports
 * an unknown amount of pending work.
 *
 * The same 3 s the per-tab settle already used, and one number rather than two because both bound
 * the same thing: how long a person stares at a logout that is measuring. Longer buys a rarer
 * "unknown" at the cost of a logout that looks stuck; shorter reports unknown for an ordinary
 * write of a big feature.
 */
export const BARRIER_DRAIN_TIMEOUT_MS = 3000;

/**
 * TAKES THE BARRIER FOR THE LOGOUT DIALOG: exclusive, and it waits for the writers.
 *
 * The request is NOT `ifAvailable`, and that is the point: pending is what refuses the siblings,
 * and the grant is what proves they finished. It is raced against a deadline and ABORTED on
 * timeout, because a request left pending would be granted later and then held forever, which
 * would wedge every writer in every tab (measured: after `abort()` the callback never runs and the
 * name is free again).
 *
 * @param {{kind?: string, dbSuffix?: string}|null} scope - Remote scope being left.
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{held: boolean, drained: boolean, supported: boolean,
 *   release: () => Promise<void>}>} `drained` is the only field a census may believe: true means
 *   every tab's writers finished (or that there is nothing to arbitrate, i.e. a local scope or a
 *   runtime without locks, where the answer is the per-tab one this module always gave). `held`
 *   says whether new writes are being refused right now.
 */
export async function holdLogoutBarrier(scope, { timeoutMs = BARRIER_DRAIN_TIMEOUT_MS } = {}) {
    const manager = lockManager();
    const name = barrierNameFor(scope);
    const idle = { held: false, drained: true, supported: false, async release() {} };
    if (!manager || !name) return idle;

    const controller = new AbortController();
    let release = () => {};
    let resolveHeld;
    let abandoned = false;
    const held = new Promise(resolve => { resolveHeld = resolve; });
    let settled;
    try {
        settled = manager.request(
            name,
            { mode: 'exclusive', signal: controller.signal },
            () => {
                // THE GRANT CAN RACE THE ABORT, and holding it then would wedge every writer in
                // every tab forever. A grant that arrives after the deadline is dropped on the
                // spot: returning nothing releases the lock immediately.
                if (abandoned) return undefined;
                const untilReleased = new Promise(resolve => { release = resolve; });
                resolveHeld(true);
                return untilReleased;
            }
        );
        settled.catch(() => resolveHeld(false));
    } catch {
        return { ...idle, supported: true };
    }

    let timer;
    const drained = await Promise.race([
        held,
        new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    clearTimeout(timer);

    if (!drained) {
        abandoned = true;
        controller.abort();
        release();
        await settled.catch(() => undefined);
        return { held: false, drained: false, supported: true, async release() {} };
    }

    let released = false;
    return {
        held: true,
        drained: true,
        supported: true,
        async release() {
            if (released) return;
            released = true;
            release();
            await settled.catch(() => undefined);
        },
    };
}
