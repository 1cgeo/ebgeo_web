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
 */

import { EventTypes } from '../events/event_types.js';
import { getEventBus } from '../store/services.js';

/** Remote-only feature events (the local draw path updates its source directly). */
const REMOTE_FEATURE_EVENTS = [
    EventTypes.FEATURE_CREATED,
    EventTypes.FEATURE_MODIFIED,
    EventTypes.FEATURE_DELETED,
];

/**
 * Subscribes a debounced source refresh to remote feature ops.
 *
 * @param {() => (void|Promise<void>)} refresh - Repopulates the map sources from the store.
 * @param {{ debounceMs?: number, scheduler?: (fn: () => void, ms: number) => any }} [opts]
 * @returns {() => void} Unsubscribe function.
 */
export function wireRemoteFeatureRender(refresh, { debounceMs = 80, scheduler = setTimeout } = {}) {
    const bus = getEventBus();
    let timer = null;

    const schedule = () => {
        if (timer !== null) return; // coalesce a burst of remote ops into one refresh
        timer = scheduler(() => {
            timer = null;
            Promise.resolve().then(refresh).catch((err) => {
                console.error('Remote feature render refresh failed:', err);
            });
        }, debounceMs);
    };

    for (const evt of REMOTE_FEATURE_EVENTS) bus.on(evt, schedule);

    return function unwireRemoteFeatureRender() {
        for (const evt of REMOTE_FEATURE_EVENTS) bus.off?.(evt, schedule);
    };
}
