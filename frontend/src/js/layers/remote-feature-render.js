// Path: js/layers/remote-feature-render.js

/**
 * @fileoverview Bridges remote (peer) feature operations to the 2D map sources.
 *
 * The remote-operation-handler applies a peer's feature create/update/delete to the
 * local STORE and emits FEATURE_CREATED / FEATURE_MODIFIED / FEATURE_DELETED — but
 * nothing repopulates the MapLibre GeoJSON sources. As a result a synced feature was
 * invisible on the live 2D map (and on the source-built features tree) until a
 * base-layer / map switch happened to re-run setupMapFeatures(). This module closes
 * that gap: it listens for those remote-only feature events and runs a (debounced)
 * source refresh so collaborators' features appear live.
 *
 * Pure + injectable (eventBus via services, refresh + scheduler via params) so it is
 * unit-testable without a real map.
 *
 * NOT a diff-dispatcher call site, and deliberately so: this module writes nothing itself, and the
 * `refresh` it debounces (`setupMapFeatures`) rebuilds every feature source FROM THE STORE, where
 * the delta is the whole collection. One interaction is worth knowing before migrating a source:
 * that rebuild writes with a raw `setData`, which discards any diff a dispatcher had queued. It is
 * benign because the store is written before the source in every migrated path (persistence-first),
 * so the collection the rebuild produces already contains whatever the discarded diff carried.
 */

import { EventTypes } from '../events/event_types.js';
import { getEventBus } from '../store/services.js';

/** Remote-only feature events (the local draw path updates its source directly). */
const REMOTE_FEATURE_EVENTS = [
    EventTypes.FEATURE_CREATED,
    EventTypes.FEATURE_MODIFIED,
    EventTypes.FEATURE_DELETED,
    // A snapshot (initial open / reconnect catch-up) saves features to the STORE and emits
    // MAP_MODIFIED per map, but NOT per-feature FEATURE_* events — so without this a
    // just-reconnected client had its snapshot features in the store yet missing from the live
    // MapLibre source (and the source-built features tree). MAP_MODIFIED is map-level + infrequent
    // (map ops + snapshots), so refreshing on it has none of the cost of refreshing on LAYERS_CHANGED.
    EventTypes.MAP_MODIFIED,
];

/**
 * Longest a refresh may hold the single-flight gate. `setupMapFeatures` can wait on the NETWORK
 * (a missing image blob goes to `fetchImageBlob`, a plain fetch with no deadline, and the symbol
 * library is a dynamic import), so a refresh that never settles would otherwise freeze the 2D
 * rendering of every peer's edit until a reload. Past this, the gate opens and the next event
 * schedules a new refresh, overlapping the stuck one, which is what the code did before the gate.
 * @type {number}
 */
const REFRESH_WATCHDOG_MS = 5000;

/**
 * Ceiling of the trailing wait. The measured refresh duration is wall clock and includes network
 * waits, so without a ceiling one slow image would space the next rebuild by as long as it took.
 * @type {number}
 */
const MAX_TRAILING_SPACING_MS = 2000;

/**
 * Subscribes a debounced source refresh to remote feature ops.
 *
 * A BURST USED TO PAY ONE FULL REBUILD PER OPERATION, and the fixed 80 ms debounce was why. A
 * peer's operation takes a read and a write of the whole map document (`applyRemoteFeatureOp`),
 * which on a map of a few thousand features is longer than 80 ms, so the timer fired between
 * nearly every two operations, and each firing re-read the whole document and `setData`'d every
 * collection. Nothing stopped a second rebuild from starting while the first was still running.
 * Measured on 2026-09-23 in Chromium: 300 remote creates on a map of 3 000 points ran 161 to 220
 * full rebuilds (each one more LAYERS_CHANGED round), all of it on the main thread the apply chain
 * also needs.
 *
 * FOUR RULES, and the last change of the store is always drawn: (1) a burst arms ONE timer;
 * (2) a refresh never starts while another runs, and an event arriving meanwhile marks the
 * sources dirty, which schedules exactly one more refresh when the running one ends; (3) that
 * trailing refresh waits `debounceMs` or as long as the refresh that just ran, whichever is
 * longer, capped at {@link MAX_TRAILING_SPACING_MS}, so a sustained burst spends at most about
 * half its time rebuilding; (4) a refresh that has not settled after {@link REFRESH_WATCHDOG_MS}
 * releases the gate, and when it does settle it schedules one more refresh.
 *
 * WHY THE LATE SETTLEMENT REPAINTS. `setupMapFeatures` reads the features FIRST and only then waits
 * on the network (`setImages`), so a refresh released by the watchdog still holds the list it read
 * before it stalled. When it finally settles it `setData`s that list, which can be older than what
 * a newer refresh already drew: a feature a colleague deleted meanwhile reappears, and nothing
 * else would repaint until the next remote event. The extra refresh re-reads the store.
 *
 * AN ISOLATED OPERATION STILL DRAWS AFTER `debounceMs`, and that is why the spacing lives only on
 * the trailing path: a peer's single edit on a big map must not wait for the cost of the previous
 * rebuild, which is what a spacing applied to every schedule did in its first version.
 *
 * @param {() => (void|Promise<void>)} refresh - Repopulates the map sources from the store.
 * @param {{ debounceMs?: number, scheduler?: (fn: () => void, ms: number) => any,
 *   cancelScheduled?: (handle: any) => void, now?: () => number, watchdogMs?: number,
 *   watchdogScheduler?: (fn: () => void, ms: number) => any,
 *   cancelWatchdog?: (handle: any) => void }} [opts]
 * @returns {() => void} Unsubscribe function.
 */
export function wireRemoteFeatureRender(refresh, {
    debounceMs = 80,
    scheduler = setTimeout,
    cancelScheduled = clearTimeout,
    now = () => performance.now(),
    watchdogMs = REFRESH_WATCHDOG_MS,
    watchdogScheduler = setTimeout,
    cancelWatchdog = clearTimeout,
} = {}) {
    const bus = getEventBus();
    let timer = null;
    /** Id of the refresh holding the gate, or 0 when the gate is open. */
    let activeRun = 0;
    let lastRunId = 0;
    let dirty = false;
    let wired = true;
    /** Watchdog of the refresh holding the gate, cleared on settlement and on unwire. */
    let watchdogHandle = null;

    /**
     * Opens the gate for `runId`, once: the watchdog and the settlement race, and whichever comes
     * second finds the gate already open (or held by a newer refresh) and does nothing.
     * @param {number} runId
     * @param {number} spacingMs - How long the refresh held the gate.
     */
    const release = (runId, spacingMs) => {
        if (activeRun !== runId) return;
        activeRun = 0;
        if (dirty) schedule(Math.min(spacingMs, MAX_TRAILING_SPACING_MS));
    };

    const run = () => {
        timer = null;
        const runId = ++lastRunId;
        activeRun = runId;
        dirty = false;
        const started = now();
        const watchdog = watchdogScheduler(() => {
            if (watchdogHandle === watchdog) watchdogHandle = null;
            if (activeRun === runId) console.warn('Remote feature render refresh did not settle; releasing the gate.');
            release(runId, 0);
        }, watchdogMs);
        watchdogHandle = watchdog;
        Promise.resolve().then(refresh).catch((err) => {
            console.error('Remote feature render refresh failed:', err);
        }).finally(() => {
            cancelWatchdog(watchdog);
            if (watchdogHandle === watchdog) watchdogHandle = null;
            if (activeRun === runId) {
                release(runId, Math.max(0, now() - started));
            } else {
                // Superseded: it may have just painted a list older than the store. Repaint.
                schedule();
            }
        });
    };

    /** @param {number} [spacingMs] - Trailing wait (only the trailing path passes one). */
    const schedule = (spacingMs = 0) => {
        if (!wired) return;
        if (activeRun !== 0) {
            dirty = true;
            return;
        }
        if (timer !== null) return; // coalesce a burst of remote ops into one refresh
        timer = scheduler(run, Math.max(debounceMs, spacingMs));
    };

    // The bus hands the payload to the listener; the spacing argument is the trailing path's alone.
    const onRemoteFeatureEvent = () => schedule();
    for (const evt of REMOTE_FEATURE_EVENTS) bus.on(evt, onRemoteFeatureEvent);

    return function unwireRemoteFeatureRender() {
        wired = false;
        if (timer !== null) cancelScheduled(timer);
        timer = null;
        if (watchdogHandle !== null) cancelWatchdog(watchdogHandle);
        watchdogHandle = null;
        for (const evt of REMOTE_FEATURE_EVENTS) bus.off?.(evt, onRemoteFeatureEvent);
    };
}
