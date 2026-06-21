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
 * @dependencies sync-engine.js, connection-state.js, operation-queue.js,
 *   ../services.js, ../../events/event_types.js
 */

import { syncEngine } from './sync-engine.js';
import { connectionState } from './connection-state.js';
import { operationQueue } from './operation-queue.js';
import { getEventBus } from '../services.js';
import { EventTypes } from '../../events/event_types.js';

/** Local change events that should trigger an opportunistic flush. */
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
};

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
    if (!(await hasWorkToFlush())) return;

    state.inFlight = true;
    try {
        await state.engine.flush();
    } catch (error) {
        console.warn('Auto-flush error:', error);
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
    state.timer = setInterval(() => { flushOnce(); }, intervalMs);

    subscribeToChanges();

    // Opportunistic immediate flush so we don't wait a full interval.
    flushOnce();
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
}
