// Path: js/store/sync/sync-flush.js

/**
 * @fileoverview Auto-flush driver for the sync engine.
 *
 * `startAutoFlush` runs a lean periodic loop that drains the local operation
 * queue to the server via `engine.flush()`. It is:
 * - idempotent: calling start twice is a no-op (single shared timer);
 * - in-flight guarded: never overlaps two flushes;
 * - online-only: skips flushing unless the connection is ONLINE;
 * - work-gated: skips flushing when the local queue is empty.
 *
 * An immediate flush is attempted on start and again on every local/remote
 * change event so pending operations leave promptly without waiting a full
 * interval. `stopAutoFlush` clears the timer and unsubscribes the listeners.
 *
 * A failing flush used to be entirely silent (`console.warn` and nothing else),
 * so a user could keep editing for minutes against a server that was receiving
 * nothing. Consecutive failures are now counted and, past a threshold, told
 * ONCE — see {@link classifyFlushFailure} / {@link nextFlushAlertState}.
 *
 * ONE OF THOSE KINDS ALSO STOPS THE LOOP: `gone` (404/410, the atlas is not on the
 * server any more). The others are worth retrying and this one cannot be, so past the
 * threshold the loop stops instead of knocking on a deleted address every 1.5 s for the
 * rest of the session. Nothing is dequeued; a later `startAutoFlush` re-arms it.
 *
 * @dependencies sync-engine.js, connection-state.js, operation-queue.js,
 *   ../services.js, ../../events/event_types.js, @utils/toast_service.js
 */

import { syncEngine } from './sync-engine.js';
import { connectionState } from './connection-state.js';
import { operationQueue } from './operation-queue.js';
import { hasPendingLocalEdits } from './remote-operation-handler.js';
import { getEventBus } from '../services.js';
import { EventTypes } from '../../events/event_types.js';
import { showWarning } from '@utils/toast_service.js';

/**
 * Events that trigger an opportunistic flush, on top of the 1.5 s interval.
 *
 * THEY ARE NOT "LOCAL CHANGE EVENTS", which is what this comment used to say. Checked against
 * every emitter in `src/`, the only entries with a LOCAL producer are MAP_CREATED (`addMap`),
 * MAP_MODIFIED (`map-lock.controller.js`) and the three BRIEFING_* (the briefings tab and the
 * briefing editor). The whole FEATURE_*, LAYER_* and GROUP_* families, and MAP_DELETED, are
 * emitted by `remote-operation-handler.js` and by nothing else: they announce a PEER's
 * operation being applied here. The local edit path never emits them. It writes the store and
 * calls its `logXxxOperation` directly (`operation-dispatcher.js`), so the op is already in the
 * queue before any of these events could fire. Reading FEATURE_MODIFIED here as "the user moved
 * a geometry" is the exact misreading this note exists to stop.
 *
 * The remote-only entries are therefore REDUNDANT rather than wrong: each can only fire while
 * an inbound operation is being applied, and `applyRemoteOperation` ends by emitting
 * REMOTE_OPERATION_APPLIED for every operation it applies, which is the last entry in this
 * list. They cost nothing (`flushOnce` returns immediately when a flush is in flight or the
 * queue has no work), and they are kept on purpose: they are what would already be wired the
 * day one of those events gains a local producer, and dropping them would change when a flush
 * happens in exchange for nothing measurable.
 */
const FLUSH_TRIGGER_EVENTS = [
    EventTypes.FEATURE_CREATED,
    EventTypes.FEATURE_MODIFIED,
    EventTypes.FEATURE_DELETED,
    EventTypes.LAYER_CREATED,
    EventTypes.LAYER_MODIFIED,
    EventTypes.LAYER_DELETED,
    EventTypes.GROUP_CREATED,
    EventTypes.GROUP_MODIFIED,
    EventTypes.GROUP_DELETED,
    EventTypes.MAP_CREATED,
    EventTypes.MAP_MODIFIED,
    EventTypes.MAP_DELETED,
    EventTypes.BRIEFING_CREATED,
    EventTypes.BRIEFING_UPDATED,
    EventTypes.BRIEFING_DELETED,
    EventTypes.REMOTE_OPERATION_APPLIED,
];

/**
 * How many CONSECUTIVE failed flush cycles before the user is told. A single
 * failure is normal (a dropped packet, a redeploy) and must stay quiet; three in
 * a row at the 1.5 s interval means the work is not leaving this machine.
 */
export const FLUSH_ALERT_THRESHOLD = 3;

/** Module-level runtime state (a single auto-flush loop is shared app-wide). */
const state = {
    /** @type {ReturnType<typeof setInterval>|null} */
    timer: null,
    /** @type {boolean} Whether a flush is currently in progress. */
    inFlight: false,
    /** @type {Array<{ bus: object, type: string, fn: Function }>} */
    subscriptions: [],
    /** @type {object|null} The engine the loop is bound to. */
    engine: null,
    /** @type {{ failures: number, notifiedKind: string|null }} Consecutive-failure tracking. */
    alert: { failures: 0, notifiedKind: null },
};

/**
 * Classifies a failed flush into what the user needs to hear. A lost permission
 * and a network hiccup look identical in the console and are opposite problems:
 * one is fixed by asking the Gestor, the other by waiting.
 *
 * Pure — no I/O, no module state.
 * @param {*} error - The error thrown by `engine.flush()` (an ApiError carries `status`).
 * @returns {{ kind: 'permission'|'session'|'gone'|'network', message: string }}
 */
export function classifyFlushFailure(error) {
    const status = error?.status ?? error?.statusCode;
    // O atlas sumiu do servidor (excluído, ou o compartilhamento que o tornava alcançável
    // foi revogado). Sem esta classe o caso caía em 'network' e a mensagem dizia ao usuário
    // que era a conexão e que as alterações seriam enviadas quando ela voltasse — as duas
    // metades falsas, e a espera nunca termina.
    if (status === 404 || status === 410) {
        return {
            kind: 'gone',
            message: 'Este atlas não está mais disponível no servidor. Suas alterações '
                + 'continuam guardadas neste computador e não serão enviadas.',
        };
    }
    if (status === 403) {
        return {
            kind: 'permission',
            message: 'Suas alterações não estão sendo salvas no servidor: seu acesso a este atlas '
                + 'não permite mais edição. Peça permissão ao gestor do atlas.',
        };
    }
    if (status === 401) {
        return {
            kind: 'session',
            message: 'Suas alterações não estão sendo salvas no servidor: sua sessão não é mais '
                + 'válida. Entre novamente para enviá-las.',
        };
    }
    return {
        kind: 'network',
        message: 'Suas alterações não estão chegando ao servidor. Elas continuam guardadas neste '
            + 'computador e serão enviadas quando a conexão voltar.',
    };
}

/**
 * Reducer for the consecutive-failure alert: pure, so the "warn once, then stay
 * quiet" rule is testable without timers or a DOM.
 *
 * `message` is non-null ONLY on the cycle where the user should be warned. A
 * change of failure kind re-arms the warning (a 403 arriving after a network
 * outage is genuinely new news); a repeat of the same kind never does.
 * @param {{ failures?: number, notifiedKind?: string|null }|null|undefined} prev
 * @param {*} error
 * @param {number} [threshold=FLUSH_ALERT_THRESHOLD]
 * @returns {{ failures: number, notifiedKind: string|null, message: string|null }}
 */
export function nextFlushAlertState(prev, error, threshold = FLUSH_ALERT_THRESHOLD) {
    const previousFailures = Number.isFinite(prev?.failures) ? prev.failures : 0;
    const failures = previousFailures + 1;
    const { kind, message } = classifyFlushFailure(error);
    const alreadyNotified = (prev?.notifiedKind ?? null) === kind;
    const notify = failures >= threshold && !alreadyNotified;
    return {
        failures,
        notifiedKind: notify ? kind : (prev?.notifiedKind ?? null),
        message: notify ? message : null,
    };
}

/**
 * Whether there is anything worth flushing right now: an active connection
 * that is ONLINE and a non-empty local operation queue.
 * @returns {Promise<boolean>}
 */
async function hasWorkToFlush() {
    if (!connectionState.isOnline()) return false;
    const pending = await operationQueue.count();
    return pending > 0;
}

/**
 * Runs a single guarded flush: no-op when a flush is in flight, offline, or the
 * queue is empty. Swallows errors so the loop keeps running.
 * @returns {Promise<void>}
 */
async function flushOnce() {
    if (state.inFlight || !state.engine) return;
    if (!(await hasWorkToFlush())) {
        // FILA VAZIA NAO E "NADA A FAZER". A auto-cura do freio de convergencia mora dentro de
        // `engine.flush()`, e sair aqui a pulava justamente no estado em que ela e necessaria:
        // um contador de edicao local preso (compactacao de fila, lote, ack sem versao, lote
        // envenenado) deixa as ops remotas daquela entidade DEFERIDAS, e um cliente sem mais
        // nada a enviar nunca reconciliava. Ele divergia em silencio ate um F5. O gate e o Map
        // em memoria, entao o caminho comum (nada preso) nao paga ida nenhuma ao IndexedDB.
        if (hasPendingLocalEdits()) {
            try {
                await state.engine.reconcileConvergenceGuard();
            } catch (error) {
                console.warn('Reconciliacao do freio de convergencia falhou:', error);
            }
        }
        return;
    }

    state.inFlight = true;
    try {
        await state.engine.flush();
        // A successful drain re-arms the warning: the NEXT outage is news again.
        state.alert = { failures: 0, notifiedKind: null };
    } catch (error) {
        console.warn('Auto-flush error:', error);
        const next = nextFlushAlertState(state.alert, error);
        state.alert = { failures: next.failures, notifiedKind: next.notifiedKind };
        if (next.message) {
            try {
                showWarning(next.message, { duration: 8000 });
            } catch {
                // Headless (tests, worker): no UI to tell. Never break the loop over a toast.
            }
        }
        // THE ATLAS IS GONE: STOP KNOCKING. The other failure kinds are worth retrying (a
        // token refreshes, a permission comes back, a network returns), and this one cannot
        // be: the address does not exist, so the loop was firing a request every 1.5 s
        // forever, against a project that had been deleted, while telling the user once and
        // then falling silent. Stopping AFTER the warning, and only at the threshold, is what
        // keeps a single transient 404 from disarming a working session.
        //
        // The queue is untouched: the operations are the user's unsynced work, and it is the
        // rescue path (`preserveUnsyncedWorkAsLocal`) that decides their fate. A later
        // `startAutoFlush` (any successful connect) re-arms the loop from scratch.
        if (next.message && classifyFlushFailure(error).kind === 'gone') {
            stopAutoFlush();
        }
    } finally {
        state.inFlight = false;
    }
}

/**
 * Subscribes to local/remote change events so pending operations flush promptly
 * without waiting for the next interval. No-op if no event bus is available.
 * @returns {void}
 */
function subscribeToChanges() {
    let bus;
    try {
        bus = getEventBus();
    } catch {
        return; // Services not initialized — interval-only flushing still works.
    }
    if (!bus?.on) return;

    for (const type of FLUSH_TRIGGER_EVENTS) {
        const fn = () => { flushOnce(); };
        bus.on(type, fn);
        state.subscriptions.push({ bus, type, fn });
    }
}

/** Removes all change-event subscriptions registered by {@link subscribeToChanges}. */
function unsubscribeFromChanges() {
    for (const { bus, type, fn } of state.subscriptions) {
        bus.off?.(type, fn);
    }
    state.subscriptions = [];
}

/**
 * Starts the periodic auto-flush loop. Idempotent: if already running, this is
 * a no-op and the existing loop/engine are kept.
 * @param {object} [engine=syncEngine] - Object exposing an async `flush()`.
 * @param {Object} [opts]
 * @param {number} [opts.intervalMs=1500] - Flush polling interval.
 * @returns {void}
 */
export function startAutoFlush(engine = syncEngine, { intervalMs = 1500 } = {}) {
    if (state.timer) return; // Already running — idempotent.

    state.engine = engine;
    state.alert = { failures: 0, notifiedKind: null };
    state.timer = setInterval(() => { flushOnce(); }, intervalMs);

    subscribeToChanges();

    // Opportunistic immediate flush so we don't wait a full interval.
    flushOnce();
}

/**
 * Whether the auto-flush loop is running right now.
 *
 * It exists for the tab-lock brake (`tab-lock-sync-brake.js`): the brake must restore EXACTLY
 * what it stopped, and starting a loop that was never running would turn a blocked anonymous tab
 * into a flushing one on resume.
 * @returns {boolean}
 */
export function isAutoFlushRunning() {
    return state.timer !== null;
}

/**
 * Stops the auto-flush loop: clears the timer and unsubscribes change listeners.
 * Idempotent and safe to call when not running.
 * @returns {void}
 */
export function stopAutoFlush() {
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }
    unsubscribeFromChanges();
    state.engine = null;
    state.alert = { failures: 0, notifiedKind: null };
}
