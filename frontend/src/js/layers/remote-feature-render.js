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
 * How many times the duration of the previous refresh the next one waits, at least.
 *
 * A BURST USED TO PAY ONE FULL REBUILD PER OPERATION, and the fixed 80 ms debounce was why. A
 * peer's operation takes a read and a write of the whole map document (`applyRemoteFeatureOp`),
 * which on a map of a few thousand features is longer than 80 ms, so the timer fired between
 * nearly every two operations, and each firing re-read the whole document and `setData`'d every
 * collection. Nothing stopped a second rebuild from starting while the first was still running.
 * Measured on 2026-09-23 in Chromium: 300 remote creates on a map of 3 000 points ran 152 full
 * rebuilds (and 152 extra LAYERS_CHANGED rounds), all of it on the main thread the apply chain
 * also needs. With two rebuilds never overlapping and the gap scaled to what the last one cost,
 * the rebuild takes at most a third of a sustained burst, and a single operation still draws
 * after the same 80 ms.
 * @type {number}
 */
const REFRESH_SPACING_FACTOR = 2;

/**
 * Subscribes a debounced source refresh to remote feature ops.
 *
 * THREE RULES, and the last change of the store is always drawn: (1) a burst arms ONE timer;
 * (2) a refresh never starts while another runs, and an event arriving meanwhile marks the
 * sources dirty, which schedules exactly one more refresh when the running one ends; (3) the
 * wait is `debounceMs` or {@link REFRESH_SPACING_FACTOR} times the previous refresh, whichever
 * is longer.
 *
 * @param {() => (void|Promise<void>)} refresh - Repopulates the map sources from the store.
 * @param {{ debounceMs?: number, scheduler?: (fn: () => void, ms: number) => any,
 *   now?: () => number }} [opts]
 * @returns {() => void} Unsubscribe function.
 */
export function wireRemoteFeatureRender(refresh, { debounceMs = 80, scheduler = setTimeout, now = () => performance.now() } = {}) {
    const bus = getEventBus();
    let timer = null;
    let running = false;
    let dirty = false;
    let wired = true;
    let lastDurationMs = 0;

    const run = () => {
        timer = null;
        running = true;
        dirty = false;
        const started = now();
        Promise.resolve().then(refresh).catch((err) => {
            console.error('Remote feature render refresh failed:', err);
        }).finally(() => {
            lastDurationMs = Math.max(0, now() - started);
            running = false;
            if (dirty) schedule();
        });
    };

    const schedule = () => {
        if (!wired) return;
        if (running) {
            dirty = true;
            return;
        }
        if (timer !== null) return; // coalesce a burst of remote ops into one refresh
        timer = scheduler(run, Math.max(debounceMs, lastDurationMs * REFRESH_SPACING_FACTOR));
    };

    for (const evt of REMOTE_FEATURE_EVENTS) bus.on(evt, schedule);

    return function unwireRemoteFeatureRender() {
        wired = false;
        for (const evt of REMOTE_FEATURE_EVENTS) bus.off?.(evt, schedule);
    };
}
