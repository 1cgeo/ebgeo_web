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
 *   outbound : map 'mousemove' (throttled ~80ms)        -> wsClient.sendCursor (2D)
 *              CURSOR_360_MOVED / CURSOR_3D_MOVED        -> wsClient.sendCursor (360 / 3D)
 *              MAP_LOCK_CHANGED (de-facto map switch)    -> wsClient.sendCursor(mapId) [case C]
 *              StateManager 'selection.features' change  -> wsClient.sendSelection (2D)  [case F]
 *              MARKER_3D_CLICKED / _DESELECTED           -> wsClient.sendSelection (3D)  [case F]
 *              MARKER_360_CLICKED / _DESELECTED          -> wsClient.sendSelection (360) [case F]
 *              TEMPORAL_CURSOR_CHANGED                   -> wsClient.sendTemporal    [case E]
 *              BRIEFING_EDIT_STARTED / _ENDED            -> wsClient.sendBriefingEdit[case D]
 *
 * Selection (case F) is editor-gated: only owner/editor broadcast their selection;
 * a Comentarista/Visualizador only RECEIVES peers' selections (mirrors the backend
 * handleSelection gate). Cursor/temporal stay ungated.
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
import { checkPermission } from '@store/sync/permission-guard.js';
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

/** Throttle window for outbound temporal-cursor broadcasts (fires per rAF during playback). */
const TEMPORAL_THROTTLE_MS = 80;

/** WS inbound events this bridge owns (restored to no-ops on stop). */
const OWNED_WS_EVENTS = Object.freeze(['connected', 'presence', 'cursor', 'selection', 'temporal', 'briefingEdit']);

/**
 * Module-level bridge state. Doubles as the "instance" passed to the
 * event-cleanup helpers, which track DOM listeners, bus subscriptions and timers.
 * @type {{ _started: boolean, _map: (import('maplibre-gl').Map|null),
 *   _cursorThrottle: { last: number, timer: (number|null), pending: (Object|null) },
 *   _temporalThrottle: { last: number, timer: (number|null), pending: (number|null) },
 *   _stateUnsub: (Function|null) }}
 */
const state = {
    _started: false,
    _map: null,
    _cursorThrottle: { last: 0, timer: null, pending: null },
    _temporalThrottle: { last: 0, timer: null, pending: null },
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
 * Sends one cursor frame, resolving the active map name at call time.
 *
 * O `mapId` VAI EM TODO QUADRO, inclusive nos das superficies imersivas, e nao e redundancia: ele
 * e o unico carregador do "mapa ativo" que o servidor tem (caso C), entao um par que abra o 360
 * continua aparecendo no roster sob o mapa certo.
 *
 * No-op when the socket is not connected (presence is best-effort, never queued).
 * @param {{ position: Object|null, surface: '2d'|'3d'|'360', tilesetId?: string|null,
 *   photoName?: string|null }} frame
 */
function sendCursorFrame(frame) {
    if (!wsClient.isConnected()) {
        return;
    }
    wsClient.sendCursor({ mapId: getCurrentMapNameSync(), ...frame });
}


/**
 * Announces the local user's active map to peers (case C). The backend has no
 * dedicated map-active handler, so we piggyback on the cursor frame: a cursor
 * with no position still carries the new mapId, which the store reads into
 * currentMap. Best-effort; no-op when offline.
 */
function broadcastCurrentMap() {
    sendCursorFrame({ position: null, surface: '2d' });
}

/**
 * Whether the local user may broadcast its selection (case F). Editor-gated: maps
 * to the EDIT capability, which is permissive on the local store but role-gated on a
 * connected remote atlas — so a Comentarista/Visualizador never broadcasts. Mirrors
 * the backend handleSelection gate.
 * @returns {boolean}
 */
function canBroadcastSelection() {
    try {
        return checkPermission('CREATE_FEATURE').allowed === true;
    } catch {
        return false;
    }
}

/**
 * Sends the local 2D feature selection to peers (case F). Reads the live selection
 * from the StateManager and the active map at call time. Best-effort + editor-gated.
 */
function broadcastSelection2D() {
    if (!wsClient.isConnected() || !canBroadcastSelection()) {
        return;
    }
    let featureIds = [];
    let featureMeta = [];
    try {
        const selected = getStateManager().getSelectedFeatures() || [];
        featureIds = selected.map((item) => item.id);
        // Ship the per-feature type so the peer's 2D overlay resolves the highlight
        // box without a store lookup (selection ids alone don't carry the tool type).
        featureMeta = selected.map((item) => ({ id: item.id, type: item.type }));
    } catch {
        // StateManager not initialized — nothing selected.
        featureIds = [];
        featureMeta = [];
    }
    wsClient.sendSelection({ surface: '2d', featureIds, featureMeta, mapId: getCurrentMapNameSync() });
}

/**
 * Sends the local 3D marker selection to peers (case F). Scoped by tilesetId so a
 * peer renders it only inside the same 3D model. Best-effort + editor-gated.
 * @param {string|null} markerId - selected marker id, or null on deselect.
 * @param {string|null} [tilesetId]
 */
function broadcastSelection3D(markerId, tilesetId) {
    if (!wsClient.isConnected() || !canBroadcastSelection()) {
        return;
    }
    wsClient.sendSelection({
        surface: '3d',
        featureIds: markerId ? [String(markerId)] : [],
        mapId: getCurrentMapNameSync(),
        tilesetId: tilesetId ?? null,
    });
}

/**
 * Sends the local 360 marker (POI) selection to peers (case F). Scoped by photoName
 * so a peer renders it only inside the same panorama. Best-effort + editor-gated.
 * @param {string|null} markerId - selected POI id, or null on deselect.
 * @param {string|null} [photoName]
 */
function broadcastSelection360(markerId, photoName) {
    if (!wsClient.isConnected() || !canBroadcastSelection()) {
        return;
    }
    wsClient.sendSelection({
        surface: '360',
        featureIds: markerId ? [String(markerId)] : [],
        mapId: getCurrentMapNameSync(),
        photoName: photoName ?? null,
    });
}

/**
 * Leading + single-trailing coalescing for a high-frequency outbound presence signal.
 * Mirrors the cursor throttle: fire immediately when the window has elapsed, else keep only the
 * latest value and flush it once when the window closes (intermediate values are dropped, never
 * queued). The trailing timer is tracked for cleanup.
 * @param {{ last: number, timer: (number|null), pending: * }} throttle
 * @param {number} intervalMs
 * @param {*} value - latest value; overwrites any pending one.
 * @param {(v: *) => void} send
 */
function scheduleCoalesced(throttle, intervalMs, value, send) {
    const now = Date.now();
    const elapsed = now - throttle.last;
    if (elapsed >= intervalMs) {
        throttle.last = now;
        throttle.pending = null;
        send(value);
        return;
    }
    throttle.pending = value;
    if (throttle.timer === null) {
        throttle.timer = setTimeout(() => {
            throttle.timer = null;
            const queued = throttle.pending;
            throttle.pending = null;
            throttle.last = Date.now();
            send(queued);
        }, intervalMs - elapsed);
        trackTimer(state, throttle.timer, 'timeout');
    }
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
    throttleCursor({ position: { lng: lngLat.lng, lat: lngLat.lat }, surface: '2d' });
}

/**
 * Throttles one outbound cursor frame, whatever its surface.
 *
 * UMA JANELA SO PARA AS TRES SUPERFICIES, de proposito: o usuario aponta uma coisa de cada vez
 * (o 360 e o 3D cobrem a tela do mapa), e o servidor guarda UM cursor por `clientId`. Duas janelas
 * independentes so produziriam dois quadros disputando a mesma gaveta.
 *
 * O QUADRO INTEIRO E O VALOR PENDENTE, e nao so a posicao: o envio atrasado do fim da janela tem
 * de saber de que superficie era o quadro que ele esta mandando. Guardar so a posicao e deixar a
 * superficie na funcao de envio faria o quadro atrasado de uma superficie sair rotulado como o da
 * outra, no exato instante da troca.
 * @param {{ position: Object|null, surface: '2d'|'3d'|'360', tilesetId?: string|null,
 *   photoName?: string|null }} frame
 */
function throttleCursor(frame) {
    scheduleCoalesced(state._cursorThrottle, CURSOR_THROTTLE_MS, frame, (queued) => {
        if (queued) sendCursorFrame(queued);
    });
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
    state._temporalThrottle = { last: 0, timer: null, pending: null };

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

    // A TROCA DE ATLAS AO VIVO, e ela e o unico caminho pelo qual o roster fica velho na tela.
    //
    // O ROSTER SO E SUBSTITUIDO POR UM QUADRO `connected` (`setInitial`, acima) ou pela parada da
    // ponte (`stopPresence`). Numa troca para outro atlas de SERVIDOR isso basta: o `connect` do
    // atlas novo traz o quadro e a lista e trocada inteira. Numa troca para um atlas LOCAL nao ha
    // socket e nunca havera quadro nenhum, entao os colegas do atlas anterior continuavam
    // listados, com cursor e selecao, num projeto que nao tem colegas.
    //
    // A CONDICAO E O SOCKET, e nao o tipo do destino, porque e o socket que decide se alguem vai
    // repovoar a lista: com uma conexao de pe, `setInitial` ja passou por aqui e limpar seria
    // apagar o roster que acabou de chegar.
    subscribe(state, eventBus, EventTypes.ATLAS_SWITCHED, () => {
        if (!wsClient.isConnected()) presenceStore.clear();
    });

    // Case E — temporal instant/playback: the timeline is local per user; share
    // the cursor so peers can show "Fulano — em D+3".
    subscribe(state, eventBus, EventTypes.TEMPORAL_CURSOR_CHANGED, ({ cursor } = {}) => {
        // Coalesce: TEMPORAL_CURSOR_CHANGED fires per rAF during playback — throttle like the
        // cursor (leading + single trailing) so playback doesn't flood the socket.
        scheduleCoalesced(state._temporalThrottle, TEMPORAL_THROTTLE_MS, cursor, broadcastTemporal);
    });

    // Case D — briefing-edit indicator: forward the open/close of a briefing
    // editor outbound so peers see who is editing what.
    subscribe(state, eventBus, EventTypes.BRIEFING_EDIT_STARTED, ({ briefingId } = {}) => {
        if (wsClient.isConnected()) wsClient.sendBriefingEditStart(briefingId);
    });
    subscribe(state, eventBus, EventTypes.BRIEFING_EDIT_ENDED, ({ briefingId } = {}) => {
        if (wsClient.isConnected()) wsClient.sendBriefingEditEnd(briefingId);
    });

    // Case F (2D) — selection awareness: the StateManager is the single source of
    // truth for the 2D selection; mirror every change to peers. Subscription returns
    // an unsubscribe we keep on state and release in stop().
    try {
        state._stateUnsub = getStateManager().subscribe('selection.features', () => broadcastSelection2D());
    } catch {
        // StateManager not initialized yet (e.g. tests/headless) — selection
        // awareness stays dormant, like the rest of presence does offline.
        state._stateUnsub = null;
    }

    // Case F (3D) — marker selection inside the Cesium viewer. The viewer emits
    // MARKER_3D_CLICKED with the selected marker + tilesetId, and _DESELECTED on
    // empty-space click; forward both as a scoped selection frame.
    subscribe(state, eventBus, EventTypes.MARKER_3D_CLICKED, ({ marker, tilesetId } = {}) => {
        broadcastSelection3D(marker?.id ?? null, tilesetId ?? null);
    });
    subscribe(state, eventBus, EventTypes.MARKER_3D_DESELECTED, ({ tilesetId } = {}) => {
        broadcastSelection3D(null, tilesetId ?? null);
    });

    // Cursor das superficies imersivas (2026-09-16). A cena emite a posicao no sistema DELA (esfera
    // no 360, ponto picado no 3D) e a ponte continua sendo a unica dona da cadencia e do socket,
    // como ja e para o mapa. Ungated, como todo cursor: quem so le tambem aparece para os colegas.
    subscribe(state, eventBus, EventTypes.CURSOR_360_MOVED, ({ position, photoName } = {}) => {
        throttleCursor({ position: position ?? null, surface: '360', photoName: photoName ?? null });
    });
    subscribe(state, eventBus, EventTypes.CURSOR_3D_MOVED, ({ position, tilesetId } = {}) => {
        throttleCursor({ position: position ?? null, surface: '3d', tilesetId: tilesetId ?? null });
    });

    // Case F (360) — POI selection inside the panorama viewer, scoped by photoName.
    subscribe(state, eventBus, EventTypes.MARKER_360_CLICKED, ({ marker, photoName } = {}) => {
        broadcastSelection360(marker?.id ?? null, photoName ?? null);
    });
    subscribe(state, eventBus, EventTypes.MARKER_360_DESELECTED, ({ photoName } = {}) => {
        broadcastSelection360(null, photoName ?? null);
    });
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
