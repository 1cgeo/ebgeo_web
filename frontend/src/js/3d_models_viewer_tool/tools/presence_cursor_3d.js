// Path: js/3d_models_viewer_tool/tools/presence_cursor_3d.js

/**
 * @fileoverview Peers' live cursors inside the 3D scene (multiuser presence).
 *
 * Two halves, both scoped to the tileset being viewed:
 *
 *   outbound : the local pointer is picked against the tileset/terrain and published as
 *              CURSOR_3D_MOVED; the presence bridge owns the throttle and the socket.
 *   inbound  : each peer's cursor becomes one Cesium entity (a dot in the peer's presence
 *              colour plus their name), rebuilt from the presence store.
 *
 * O QUE VIAJA E UM PONTO DO MUNDO, NUNCA UM PIXEL. Cada par olha a cena de uma camera propria,
 * entao a coordenada de tela do outro nao significa nada aqui; o que significa e o ponto que ele
 * apontou sobre o modelo. Mesmo motivo pelo qual o cursor do 360 viaja em coordenada de esfera.
 *
 * O PICK E CARO (le o buffer de profundidade), entao a janela de tempo vem ANTES dele: sem isso o
 * custo seria um pick por evento do sistema operacional, e nao um por quadro de presenca.
 *
 * @dependencies @store/services.js (getEventBus), @events/event_types.js,
 *   @js/presence/presence-store.js, @js/presence/presence-colors.js,
 *   @store/sync/session-context.js
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { getPresenceColor } from '@js/presence/presence-colors.js';
import { sessionContext } from '@store/sync/session-context.js';
import { hexToCesiumColor } from '../services/cesium-color.js';

/** Same window the presence bridge uses for the 2D cursor; here it also caps the pick rate. */
const CURSOR_PICK_THROTTLE_MS = 80;

let viewerInstance = null;
let getTilesetId = () => null;
let mouseMoveHandler = null;
let mouseLeaveHandler = null;
let offPresence = null;
let lastPickAt = 0;

/** clientId -> Cesium.Entity of that peer's cursor. */
const cursorEntities = new Map();

/**
 * Publishes the local pointer's world position, at most once per window.
 * @param {MouseEvent} e
 */
function onMouseMove(e) {
    if (!viewerInstance || viewerInstance.isDestroyed?.()) return;

    const now = Date.now();
    if (now - lastPickAt < CURSOR_PICK_THROTTLE_MS) return;
    lastPickAt = now;

    const canvas = viewerInstance.scene.canvas;
    const rect = canvas.getBoundingClientRect();
    const screen = new Cesium.Cartesian2(e.clientX - rect.left, e.clientY - rect.top);

    // O pick de profundidade e o que acerta o ponto SOBRE o modelo; o elipsoide e a reserva para
    // quando o ponteiro esta no ceu, e ali `alt` e zero por construcao.
    const cartesian = viewerInstance.scene.pickPosition(screen)
        || viewerInstance.camera.pickEllipsoid(screen, viewerInstance.scene.globe.ellipsoid);
    if (!cartesian) return;

    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    getEventBus()?.emit(EventTypes.CURSOR_3D_MOVED, {
        position: {
            lng: Cesium.Math.toDegrees(cartographic.longitude),
            lat: Cesium.Math.toDegrees(cartographic.latitude),
            alt: Number.isFinite(cartographic.height) ? cartographic.height : 0,
        },
        tilesetId: getTilesetId(),
    });
}

/** Tells peers the pointer left the scene, so the cursor does not stay stuck where it was. */
function onMouseLeave() {
    getEventBus()?.emit(EventTypes.CURSOR_3D_MOVED, { position: null, tilesetId: getTilesetId() });
}

/**
 * Rebuilds the peers' cursor entities from the presence store, scoped to the current tileset.
 * Self is excluded by both ids, like every other presence surface.
 */
export function renderRemoteCursors3D() {
    if (!viewerInstance || viewerInstance.isDestroyed?.() || !window.Cesium) return;

    const tilesetId = getTilesetId();
    const cursors = tilesetId ? presenceStore.getCursors('3d', tilesetId) : [];
    const selfClientId = sessionContext.clientId;
    const selfUserId = sessionContext.userId;
    const vivos = new Set();

    for (const cursor of cursors) {
        const ownerKey = String(cursor.clientId ?? '');
        const isSelf = (selfClientId != null && ownerKey === String(selfClientId))
            || (selfUserId != null && ownerKey === String(selfUserId));
        if (isSelf) continue;

        const { lng, lat, alt } = cursor.position;
        if (typeof lng !== 'number' || typeof lat !== 'number') continue;

        vivos.add(ownerKey);
        upsertCursorEntity(
            ownerKey,
            Cesium.Cartesian3.fromDegrees(lng, lat, alt ?? 0),
            getPresenceColor(String(cursor.userId || cursor.clientId || '')),
            cursor.userName || '',
        );
    }

    for (const clientId of [...cursorEntities.keys()]) {
        if (!vivos.has(clientId)) removeCursorEntity(clientId);
    }
}

/**
 * Creates or moves one peer's cursor entity.
 * @param {string} clientId
 * @param {Cesium.Cartesian3} position
 * @param {string} color - Peer presence colour (hex).
 * @param {string} name - Peer display name.
 */
function upsertCursorEntity(clientId, position, color, name) {
    const cesiumColor = hexToCesiumColor(color);
    const existing = cursorEntities.get(clientId);
    if (existing) {
        // Mover a entidade e mais barato que refaze-la, e evita o piscar a cada quadro de presenca.
        existing.position = position;
        if (existing.point) existing.point.color = cesiumColor;
        if (existing.label) {
            existing.label.text = name;
            existing.label.backgroundColor = cesiumColor;
        }
        return;
    }

    const entity = viewerInstance.entities.add({
        id: `remote-cursor-3d-${clientId}`,
        position,
        point: {
            pixelSize: 12,
            color: cesiumColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            // Sempre visivel: um cursor que o modelo esconde nao informa nada.
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.NONE,
        },
        label: name ? {
            text: name,
            font: '12px Inter, sans-serif',
            fillColor: Cesium.Color.WHITE,
            showBackground: true,
            backgroundColor: cesiumColor,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            pixelOffset: new Cesium.Cartesian2(12, -6),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
    });
    cursorEntities.set(clientId, entity);
}

/**
 * Removes one peer's cursor entity.
 * @param {string} clientId
 */
function removeCursorEntity(clientId) {
    const entity = cursorEntities.get(clientId);
    if (entity && viewerInstance && !viewerInstance.isDestroyed?.()) {
        viewerInstance.entities.remove(entity);
    }
    cursorEntities.delete(clientId);
}

/**
 * Wires both halves. Idempotent: a second call while running is a no-op.
 * @param {Cesium.Viewer} viewer
 * @param {{ tilesetIdProvider: () => (string|null) }} opts - The scene owns which tileset is open;
 *   reading it through a provider keeps this module free of a cycle back into map_3d.
 */
export function initPresenceCursor3D(viewer, { tilesetIdProvider } = {}) {
    if (mouseMoveHandler || !viewer) return;

    viewerInstance = viewer;
    getTilesetId = typeof tilesetIdProvider === 'function' ? tilesetIdProvider : () => null;
    lastPickAt = 0;

    mouseMoveHandler = onMouseMove;
    mouseLeaveHandler = onMouseLeave;
    viewer.scene.canvas.addEventListener('mousemove', mouseMoveHandler);
    viewer.scene.canvas.addEventListener('mouseleave', mouseLeaveHandler);

    offPresence = getEventBus()?.on(EventTypes.PRESENCE_CURSORS_CHANGED, renderRemoteCursors3D);
    renderRemoteCursors3D();
}

/**
 * Drops the registry of peer cursors and redraws from the store.
 *
 * Existe para o caso em que a CENA apagou as entidades por fora (o `entities.removeAll` da troca
 * de tileset): o registro aqui continuaria apontando para entidades mortas, e `upsertCursorEntity`
 * tentaria mover o que ja nao existe em vez de criar de novo.
 */
export function resetRemoteCursors3D() {
    cursorEntities.clear();
    renderRemoteCursors3D();
}

/** Unwires everything and drops the peers' cursors from the scene. */
export function cleanupPresenceCursor3D() {
    if (viewerInstance && !viewerInstance.isDestroyed?.()) {
        if (mouseMoveHandler) viewerInstance.scene.canvas.removeEventListener('mousemove', mouseMoveHandler);
        if (mouseLeaveHandler) viewerInstance.scene.canvas.removeEventListener('mouseleave', mouseLeaveHandler);
    }
    mouseMoveHandler = null;
    mouseLeaveHandler = null;

    if (typeof offPresence === 'function') offPresence();
    offPresence = null;

    for (const clientId of [...cursorEntities.keys()]) removeCursorEntity(clientId);
    cursorEntities.clear();

    // Sair da cena tira o ponteiro de dentro dela para os colegas.
    getEventBus()?.emit(EventTypes.CURSOR_3D_MOVED, { position: null, tilesetId: null });

    viewerInstance = null;
    getTilesetId = () => null;
}
