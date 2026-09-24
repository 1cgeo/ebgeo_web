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
 *              wsClient 'briefingEdit' -> presenceStore.setBriefingEdit
 *   outbound : map 'mousemove' (throttled, 5 Hz)        -> wsClient.sendCursor (2D)
 *              CURSOR_360_MOVED / CURSOR_3D_MOVED        -> wsClient.sendCursor (360 / 3D)
 *              MAP_LOCK_CHANGED (de-facto map switch)    -> wsClient.sendCursor(mapId) [case C]
 *              StateManager 'selection.features' change  -> wsClient.sendSelection (2D)  [case F]
 *              MARKER_3D_CLICKED / _DESELECTED           -> wsClient.sendSelection (3D)  [case F]
 *              MARKER_360_CLICKED / _DESELECTED          -> wsClient.sendSelection (360) [case F]
 *              BRIEFING_EDIT_STARTED / _ENDED            -> wsClient.sendBriefingEdit[case D]
 *              VIEWER_3D_* / STREETVIEW_360_* / FIRST_PERSON_* -> wsClient.sendViewer    [case V]
 *   inbound  : wsClient 'viewerContext' -> presenceStore.setViewer                          [case V]
 *
 * CASE V, THE VIEWER CONTEXT (owner, 2026-09-22): which 3D model, walkable scene or 360 photo each
 * colleague has open, so the roster can say more than the map. The bridge sends only the
 * IDENTIFIER; the server resolves the name from the catalog and sends it only to the recipients
 * who may see that resource, the others receiving the viewer kind without it
 * (`backend/src/modules/collab/collab.viewer.js`). The listened events are the ones the three
 * viewers already emitted; none of them had to change. The public-link visitor sends nothing,
 * by the rule that already keeps its cursor home.
 *
 * OUR OWN CONNECTION LEAVING ONLINE CLEARS THE ROSTER (2026-09-22). While the socket is down the
 * store keeps receiving nothing, so every peer stays listed in the state of the moment it fell,
 * including those who leave meanwhile; when the reconnection keeps failing (a token that expired
 * during a suspended laptop, a server that is down) that picture never gets corrected. The next
 * `connected` repopulates it from the server's room, which is the only truth about who is there.
 *
 * O INSTANTE DA LINHA DO TEMPO NÃO VIAJA (dono, 2026-09-21). Existiu aqui um "caso E" que
 * assinava TEMPORAL_CURSOR_CHANGED, coalescia e mandava `{cursor, label, playing}` ao par, que
 * desenhava "em D+3" na lista de quem está online. Ele saiu inteiro, nos dois pacotes: a presença
 * diz se a pessoa está no mapa ou não, e a linha do tempo é visualização de cada um, como já eram
 * o ligar e desligar, a reprodução e a velocidade desde 2026-09-20. TEMPORAL_CURSOR_CHANGED segue
 * existindo no barramento local (3D, 360 e derivação o ouvem); só esta ponte deixou de ouvi-lo.
 *
 * Selection (case F) is editor-gated: only owner/editor broadcast their selection;
 * a Comentarista/Visualizador only RECEIVES peers' selections (mirrors the backend
 * handleSelection gate). The cursor stays ungated.
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
import { sessionContext } from '@store/sync/session-context.js';
import { ConnectionStates } from '@store/sync/connection-state.js';
import { presenceStore } from '@js/presence/presence-store.js';
import {
    getCurrentMapNameSync,
    getStateManager,
} from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    setupCleanup,
    subscribe,
    trackTimer,
    cleanup,
} from '@utils/event-cleanup.js';

/**
 * Throttle window for outbound cursor broadcasts, in milliseconds: at most 5 frames per second,
 * the leading move at once and the last one of each window guaranteed (`scheduleCoalesced`).
 *
 * IT WAS 80 ms (12.5 Hz) UNTIL 2026-09-23, and the measurement is what moved it. Every cursor frame
 * reaches EVERY colleague in the room, about 260 bytes per mover per server batch, and the server
 * batches every 100 ms (`WS_CURSOR_BATCH_MS`), so a peer's downlink carried ~10 items per second
 * per colleague moving the mouse. On the 40 kbps military link the product targets (5000 B/s),
 * measured with 60 Hz mouse input: 3408 B/s with 2 colleagues moving (68% of the link) and
 * 5639 B/s with 3 (113%, the link saturated by cursors alone). Operations and the heartbeat pong
 * travel on the same socket, behind them. The rate is set at the ORIGIN because that is the only
 * place that caps both the uplink of whoever moves and the downlink of everyone who watches.
 * `tests/e2e-ui/presenca-cabe-no-link-lento.spec.js` holds the budget.
 */
export const CURSOR_THROTTLE_MS = 200;

/**
 * Window of the 2D selection frame: the leading change goes out at once, and at most one trailing
 * frame per window carries the selection as it stands when the window closes.
 * @type {number}
 */
export const SELECTION_THROTTLE_MS = 100;

/** WS inbound events this bridge owns (restored to no-ops on stop). */
const OWNED_WS_EVENTS = Object.freeze(['connected', 'presence', 'cursor', 'selection', 'briefingEdit', 'viewerContext']);

/**
 * Module-level bridge state. Doubles as the "instance" passed to the
 * event-cleanup helpers, which track DOM listeners, bus subscriptions and timers.
 * @type {{ _started: boolean, _map: (import('maplibre-gl').Map|null),
 *   _cursorThrottle: { last: number, timer: (number|null), pending: (Object|null) },
 *   _selectionThrottle: { last: number, timer: (number|null), pending: * },
 *   _stateUnsub: (Function|null) }}
 */
const state = {
    _started: false,
    _map: null,
    _cursorThrottle: { last: 0, timer: null, pending: null },
    _selectionThrottle: { last: 0, timer: null, pending: null },
    _stateUnsub: null,
    _viewers: freshViewers(),
    _viewerSent: null,
};

/**
 * What each immersive viewer has open right now, one slot per viewer. They are tracked apart
 * because they can overlap (the walkable scene opens from the 3D control), and the context that
 * travels is the one on TOP: scene, then 360, then 3D. A close empties only its own slot, so
 * closing the scene falls back to the 3D model still open underneath.
 * @returns {{ fp: (string|null), s360: (string|null), m3d: (string|null) }}
 */
function freshViewers() {
    return { fp: null, s360: null, m3d: null };
}

/**
 * The viewer context this client should be announcing, from the slots.
 * @returns {{ surface: '2d'|'3d'|'360'|'fp', tilesetId?: string, photoName?: string }}
 */
function currentViewerFrame(viewers = state._viewers) {
    if (viewers.fp) return { surface: 'fp', tilesetId: viewers.fp };
    if (viewers.s360) return { surface: '360', photoName: viewers.s360 };
    if (viewers.m3d) return { surface: '3d', tilesetId: viewers.m3d };
    return { surface: '2d' };
}

/**
 * Sends the viewer context when it CHANGED from the last one this socket announced.
 *
 * `force` is the reconnect path: a new socket starts with no context on the server, so what was
 * announced to the previous one has to be said again, unless it is the map, which is the default.
 * The public-link visitor sends nothing (the server would drop it anyway).
 * @param {{ force?: boolean }} [opts]
 */
function announceViewer({ force = false } = {}) {
    if (!wsClient.isConnected() || sessionContext.isVisitor()) {
        return;
    }
    const frame = currentViewerFrame();
    const key = `${frame.surface}|${frame.tilesetId ?? ''}|${frame.photoName ?? ''}`;
    if (force && frame.surface === '2d') {
        state._viewerSent = key;
        return;
    }
    if (!force && state._viewerSent === key) {
        return;
    }
    if (wsClient.sendViewer(frame)) {
        state._viewerSent = key;
    }
}

/**
 * Applies one viewer lifecycle event to its slot and re-announces.
 * @param {'fp'|'s360'|'m3d'} slot
 * @param {*} value - The identifier now open, or null on close.
 */
function setViewerSlot(slot, value) {
    state._viewers[slot] = value !== undefined && value !== null && value !== '' ? String(value) : null;
    announceViewer();
}

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
    // O MOUSE DO VISITANTE NÃO VIAJA (dono, 2026-09-20): quem abre um link público não é
    // colaborador, e um cursor anônimo passeando sobre o mapa de quem trabalha é ruído. O quadro SEM
    // posição continua saindo, porque ele é o único carregador do MAPA ATIVO (caso C), e é por ele
    // que a lista de quem está online sabe em que mapa o visitante está. O servidor impõe o mesmo
    // corte (`handleCursor`), então um cliente modificado também não propaga.
    if (frame.position && sessionContext.isVisitor()) {
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
    state._selectionThrottle = { last: 0, timer: null, pending: null };
    state._viewers = freshViewers();
    state._viewerSent = null;

    setupCleanup(state);

    // Inbound: WS -> presence store.
    wsClient.on('connected', (payload) => {
        presenceStore.setInitial((payload && payload.usersOnline) || []);
        // A new socket starts with no viewer context on the server: say it again (case V).
        announceViewer({ force: true });
    });
    wsClient.on('presence', routePresence);
    wsClient.on('cursor', (msg) => presenceStore.setCursor(msg));
    wsClient.on('selection', (msg) => presenceStore.setSelection(msg));
    wsClient.on('briefingEdit', routeBriefingEdit);
    wsClient.on('viewerContext', (msg) => presenceStore.setViewer(msg));

    // Outbound: local cursor -> peers (throttled). MapLibre's Map is an Evented
    // emitter (on/off), not a DOM node, so we bind directly and unbind in stop().
    if (state._map && typeof state._map.on === 'function') {
        state._map.on('mousemove', onMouseMove);
    }

    // Outbound awareness on the application event bus (cases C/D). These are
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

    // OUR OWN SOCKET LEAVING ONLINE (2026-09-22). See the fileoverview: without a socket nobody
    // corrects the roster, and a peer who leaves meanwhile stays listed for as long as the
    // reconnection keeps failing. ONLINE is excluded because `_onConnected` transitions to it
    // right BEFORE emitting `connected`, whose `setInitial` is what repopulates the list.
    subscribe(state, eventBus, EventTypes.CONNECTION_STATE_CHANGED, ({ currentState } = {}) => {
        if (!currentState || currentState === ConnectionStates.ONLINE) return;
        state._viewerSent = null;
        presenceStore.clear();
    });

    // Case V — the viewer context. Each viewer's own lifecycle events, one slot per viewer.
    subscribe(state, eventBus, EventTypes.VIEWER_3D_OPENED, ({ tilesetId } = {}) => setViewerSlot('m3d', tilesetId));
    subscribe(state, eventBus, EventTypes.VIEWER_3D_CLOSED, () => setViewerSlot('m3d', null));
    subscribe(state, eventBus, EventTypes.STREETVIEW_360_OPENED, ({ photoName } = {}) => setViewerSlot('s360', photoName));
    // Walking from photo to photo. Only while the 360 is OPEN: a load that finishes after the
    // viewer closed must not reopen the context the close just cleared.
    subscribe(state, eventBus, EventTypes.STREETVIEW_360_PHOTO_CHANGED, ({ currentPhoto } = {}) => {
        if (state._viewers.s360 !== null) setViewerSlot('s360', currentPhoto);
    });
    subscribe(state, eventBus, EventTypes.STREETVIEW_360_CLOSED, () => setViewerSlot('s360', null));
    subscribe(state, eventBus, EventTypes.FIRST_PERSON_OPENED, ({ sceneId } = {}) => setViewerSlot('fp', sceneId));
    subscribe(state, eventBus, EventTypes.FIRST_PERSON_CLOSED, () => setViewerSlot('fp', null));

    // NÃO ASSINE AQUI `TEMPORAL_CURSOR_CHANGED` (dono, 2026-09-21): o instante da linha do tempo
    // é visualização de cada um e não se propaga. O evento continua no barramento para o 3D, o 360
    // e a derivação; a presença não tem nada a dizer sobre ele.

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
        // COALESCED, like the cursor. `selection.features` changes once PER FEATURE when a box
        // selection adds them one by one, and every frame carries the WHOLE selection: K adds sent
        // K frames and O(K^2) bytes. Measured on 2026-09-24 in Chromium, box-selecting 1 000, 2 000
        // and 4 000 points in a server atlas sent 1 000, 2 000 and 4 000 frames, 48, 195 and 782
        // MB, and the 4 000 took 11,5 s of main thread. The frame is presence, not data: the last
        // selection of the window is the only one a peer needs.
        state._stateUnsub = getStateManager().subscribe('selection.features',
            () => scheduleCoalesced(state._selectionThrottle, SELECTION_THROTTLE_MS, null, () => broadcastSelection2D()));
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
    subscribe(state, eventBus, EventTypes.POSITION_FP_MOVED, ({ position, tilesetId } = {}) => {
        throttleCursor({ position: position ?? null, surface: 'fp', tilesetId: tilesetId ?? null });
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
    state._viewers = freshViewers();
    state._viewerSent = null;
    state._map = null;
    state._started = false;

    presenceStore.clear();
}
