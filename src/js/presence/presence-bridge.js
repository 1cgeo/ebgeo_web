// Path: js/presence/presence-bridge.js

/**
 * @fileoverview Presence/awareness wiring (multiuser UX).
 *
 * Bridges the WS transport (ws-client.js) to the pure presence store
 * (presence-store.js) and back:
 *
 *   inbound  : wsClient 'connected'    -> presenceStore.setInitial(usersOnline)
 *              wsClient 'presence'     -> userJoined / userLeft / userAway / userBack
 *              wsClient 'cursor'       -> presenceStore.setCursor (also currentMap)
 *              wsClient 'selection'    -> presenceStore.setSelection
 *              wsClient 'temporal'     -> presenceStore.setTemporal
 *              wsClient 'briefingEdit' -> presenceStore.setBriefingEdit
 *   outbound : map 'mousemove' (throttled ~80ms)        -> wsClient.sendCursor
 *              MAP_LOCK_CHANGED (de-facto map switch)    -> wsClient.sendCursor(mapId) [case C]
 *              StateManager 'selection.features' change  -> wsClient.sendSelection  [case F]
 *              TEMPORAL_CURSOR_CHANGED                   -> wsClient.sendTemporal    [case E]
 *              BRIEFING_EDIT_STARTED / _ENDED            -> wsClient.sendBriefingEdit[case D]
 *
 * The bridge owns no UI; the presence overlays/roster consume the store via the
 * PRESENCE_CHANGED / PRESENCE_CURSORS_CHANGED events. Self is excluded by the
 * UI layer (presenceStore.getOthers(sessionContext.clientId)), not here, so the
 * store keeps a complete picture.
 *
 * Active-map awareness (case C): the backend has no `map_active` handler, so the
 * local user's current map piggybacks on the cursor message's `mapId` — on a
 * map switch we send a positionless cursor carrying the new mapId, and the store
 * reads `mapId` off every inbound presence frame.
 *
 * @dependencies @store/sync/ws-client.js, @js/presence/presence-store.js,
 *   @store (getCurrentMapNameSync, getCurrentMapIdSync, getStateManager, getControl),
 *   @store/services.js (getEventBus), @events/event_types.js, @utils/event-cleanup.js
 */

import { wsClient } from '@store/sync/ws-client.js';
import { presenceStore } from '@js/presence/presence-store.js';
import {
    getCurrentMapNameSync,
    getStateManager,
    getControl,
} from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { formatTimelineLabel } from '@js/temporal/temporal.utils.js';
import {
    setupCleanup,
    subscribe,
    trackTimer,
    cleanup,
} from '@utils/event-cleanup.js';

/** Throttle window for outbound cursor broadcasts, in milliseconds. */
const CURSOR_THROTTLE_MS = 80;

/** WS inbound events this bridge owns (restored to no-ops on stop). */
const OWNED_WS_EVENTS = Object.freeze(['connected', 'presence', 'cursor', 'selection', 'temporal', 'briefingEdit']);

/**
 * Module-level bridge state. Doubles as the "instance" passed to the
 * event-cleanup helpers, which track DOM listeners, bus subscriptions and timers.
 * @type {{ _started: boolean, _map: (import('maplibre-gl').Map|null),
 *   _cursorThrottle: { last: number, timer: (number|null), pending: (Object|null) },
 *   _stateUnsub: (Function|null) }}
 */
const state = {
    _started: false,
    _map: null,
    _cursorThrottle: { last: 0, timer: null, pending: null },
    _stateUnsub: null,
};

/**
 * Routes a WS `presence` frame to the matching presence-store mutation.
 * @param {{ type?: string }} msg
 */
function routePresence(msg) {
    if (!msg || typeof msg !== 'object') {
        return;
    }
    switch (msg.type) {
        case 'user_joined':
            // The join frame nests the descriptor under `user` ({ type, user: { id, nome, ... } }),
            // unlike user_left/away/back which carry a top-level userId. Passing the whole msg made
            // resolveKey() look for id/userId/clientId at the top level, find none, and silently drop
            // the join — so peers never appeared in the roster. Unwrap to the nested user.
            presenceStore.userJoined(msg.user || msg);
            break;
        case 'user_left':
            presenceStore.userLeft(msg);
            break;
        case 'user_away':
            presenceStore.userAway(msg);
            break;
        case 'user_back':
            presenceStore.userBack(msg);
            break;
        default:
            // Unknown presence subtype — ignore (forward-compatible).
            break;
    }
}

/**
 * Routes an inbound WS `briefingEdit` frame (briefing_edit_started/ended) to the
 * presence store. The frame carries { type, userId, userName, briefingId }.
 * @param {{ type?: string, userId?: string, userName?: string, briefingId?: string }} msg
 */
function routeBriefingEdit(msg) {
    if (!msg || typeof msg !== 'object') {
        return;
    }
    const editing = msg.type === 'briefing_edit_started';
    presenceStore.setBriefingEdit({
        userId: msg.userId,
        clientId: msg.clientId,
        briefingId: msg.briefingId,
        userName: msg.userName,
        editing,
    });
}

/**
 * Sends the local cursor to peers, resolving the active map id at call time.
 * No-op when the socket is not connected (presence is best-effort, never queued).
 * @param {{ lng: number, lat: number }} position
 */
function broadcastCursor(position) {
    if (!wsClient.isConnected()) {
        return;
    }
    wsClient.sendCursor({ position, mapId: getCurrentMapNameSync() });
}

/**
 * Announces the local user's active map to peers (case C). The backend has no
 * dedicated map-active handler, so we piggyback on the cursor frame: a cursor
 * with no position still carries the new mapId, which the store reads into
 * currentMap. Best-effort; no-op when offline.
 */
function broadcastCurrentMap() {
    if (!wsClient.isConnected()) {
        return;
    }
    wsClient.sendCursor({ position: null, mapId: getCurrentMapNameSync() });
}

/**
 * Sends the local feature selection to peers (case F). Reads the live selection
 * from the StateManager and the active map at call time. Best-effort.
 */
function broadcastSelection() {
    if (!wsClient.isConnected()) {
        return;
    }
    let featureIds = [];
    try {
        const selected = getStateManager().getSelectedFeatures() || [];
        featureIds = selected.map((item) => item.id);
    } catch {
        // StateManager not initialized — nothing selected.
        featureIds = [];
    }
    wsClient.sendSelection({ featureIds, mapId: getCurrentMapNameSync() });
}

/**
 * Sends the local temporal viewing state to peers (case E). The timeline is
 * local per user, so this is awareness only: we ship the cursor plus a
 * precomputed short label (e.g. "D+3") so peers can render it without the
 * sender's temporal config. Best-effort.
 * @param {number} cursor - Timeline cursor (epoch ms) from TEMPORAL_CURSOR_CHANGED.
 */
function broadcastTemporal(cursor) {
    if (!wsClient.isConnected()) {
        return;
    }
    let label = null;
    let playing = false;
    try {
        const ctrl = getControl('TemporalControl');
        if (ctrl) {
            playing = typeof ctrl.isPlaying === 'function' ? ctrl.isPlaying() : false;
            if (typeof ctrl.getTimeContext === 'function' && Number.isFinite(cursor)) {
                label = formatTimelineLabel(cursor, ctrl.getTimeContext());
            }
        }
    } catch {
        // Temporal control not available — ship the raw cursor only.
    }
    wsClient.sendTemporal({ cursor, label, playing }, getCurrentMapNameSync());
}

/**
 * Throttled mousemove handler: emits the leading move immediately, then at most
 * one trailing move per window. The trailing timer is tracked for cleanup.
 * @param {{ lngLat?: { lng: number, lat: number } }} e - MapLibre mouse event.
 */
function onMouseMove(e) {
    const lngLat = e && e.lngLat;
    if (!lngLat || typeof lngLat.lng !== 'number' || typeof lngLat.lat !== 'number') {
        return;
    }
    const position = { lng: lngLat.lng, lat: lngLat.lat };
    const throttle = state._cursorThrottle;
    const now = Date.now();
    const elapsed = now - throttle.last;

    if (elapsed >= CURSOR_THROTTLE_MS) {
        throttle.last = now;
        throttle.pending = null;
        broadcastCursor(position);
        return;
    }

    // Within the window: remember the latest position and schedule a trailing send.
    throttle.pending = position;
    if (throttle.timer === null) {
        const delay = CURSOR_THROTTLE_MS - elapsed;
        throttle.timer = setTimeout(() => {
            throttle.timer = null;
            const queued = throttle.pending;
            throttle.pending = null;
            if (queued) {
                throttle.last = Date.now();
                broadcastCursor(queued);
            }
        }, delay);
        trackTimer(state, throttle.timer, 'timeout');
    }
}

/**
 * Wires WS presence events to the store and starts broadcasting the local
 * cursor from the given map. Idempotent: a second call while running is a no-op.
 * @param {{ map: import('maplibre-gl').Map }} opts
 */
export function startPresence({ map } = {}) {
    if (state._started) {
        return;
    }
    state._started = true;
    state._map = map || null;
    state._cursorThrottle = { last: 0, timer: null, pending: null };

    setupCleanup(state);

    // Inbound: WS -> presence store.
    wsClient.on('connected', (payload) => {
        presenceStore.setInitial((payload && payload.usersOnline) || []);
    });
    wsClient.on('presence', routePresence);
    wsClient.on('cursor', (msg) => presenceStore.setCursor(msg));
    wsClient.on('selection', (msg) => presenceStore.setSelection(msg));
    wsClient.on('temporal', (msg) => presenceStore.setTemporal(msg));
    wsClient.on('briefingEdit', routeBriefingEdit);

    // Outbound: local cursor -> peers (throttled). MapLibre's Map is an Evented
    // emitter (on/off), not a DOM node, so we bind directly and unbind in stop().
    if (state._map && typeof state._map.on === 'function') {
        state._map.on('mousemove', onMouseMove);
    }

    // Outbound awareness on the application event bus (cases C/E/D). These are
    // tracked for cleanup via subscribe(); self is excluded by the UI layer.
    const eventBus = getEventBus();

    // Case C — active-map indicator: setCurrentMap emits MAP_LOCK_CHANGED with the
    // newly active map, which is the de-facto "map switched" signal. Re-announce
    // our current map (piggybacked on a positionless cursor frame).
    subscribe(state, eventBus, EventTypes.MAP_LOCK_CHANGED, () => broadcastCurrentMap());

    // Case E — temporal instant/playback: the timeline is local per user; share
    // the cursor so peers can show "Fulano — em D+3".
    subscribe(state, eventBus, EventTypes.TEMPORAL_CURSOR_CHANGED, ({ cursor } = {}) => {
        broadcastTemporal(cursor);
    });

    // Case D — briefing-edit indicator: forward the open/close of a briefing
    // editor outbound so peers see who is editing what.
    subscribe(state, eventBus, EventTypes.BRIEFING_EDIT_STARTED, ({ briefingId } = {}) => {
        if (wsClient.isConnected()) wsClient.sendBriefingEditStart(briefingId);
    });
    subscribe(state, eventBus, EventTypes.BRIEFING_EDIT_ENDED, ({ briefingId } = {}) => {
        if (wsClient.isConnected()) wsClient.sendBriefingEditEnd(briefingId);
    });

    // Case F — selection awareness: the StateManager is the single source of
    // truth for selection; mirror every change to peers. Subscription returns an
    // unsubscribe we keep on state and release in stop().
    try {
        state._stateUnsub = getStateManager().subscribe('selection.features', () => broadcastSelection());
    } catch {
        // StateManager not initialized yet (e.g. tests/headless) — selection
        // awareness stays dormant, like the rest of presence does offline.
        state._stateUnsub = null;
    }
}

/**
 * Tears the bridge down: removes the map listener, cancels timers, releases the
 * owned WS handlers, and clears the presence store. Safe to call when stopped.
 */
export function stopPresence() {
    if (!state._started) {
        return;
    }

    // Unbind the map emitter (paired with the map.on() in startPresence).
    if (state._map && typeof state._map.off === 'function') {
        state._map.off('mousemove', onMouseMove);
    }

    // Release the StateManager selection subscription (case F outbound).
    if (typeof state._stateUnsub === 'function') {
        state._stateUnsub();
    }
    state._stateUnsub = null;

    // Cancel any tracked trailing-cursor timer + bus subscriptions.
    cleanup(state);

    // Release the WS events we own so stale handlers don't fire after teardown.
    // ws-client.on() overwrites the single handler per event; a no-op detaches us.
    const noop = () => {};
    for (const event of OWNED_WS_EVENTS) {
        wsClient.on(event, noop);
    }

    state._cursorThrottle = { last: 0, timer: null, pending: null };
    state._map = null;
    state._started = false;

    presenceStore.clear();
}
