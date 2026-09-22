// Path: js/first_person_3d_tool/collaboration-fp.js
/** Collaboration in scene-local metres. Presence follows the walker, comments hit the model. */
import { getComments, addComment, getCurrentMapNameSync } from '@store';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { getPresenceColor } from '@js/presence/presence-colors.js';
import {
    SUPERFICIE, autoriaAtual, ehDaSuperficie, escrevendoNoCartao, montarCartaoDeCompose,
    montarCartaoDeThread, podeComentar, respostasDe,
} from '@js/comment_tool/comment-card.js';

const finitePoint = (p) => p && [p.x, p.y, p.z].every(Number.isFinite);

/** Project a local point using the same camera basis as curated markers. */
export function projectFpPoint(point, camera, width, height) {
    if (!finitePoint(point) || !camera?.matrixWorld) return null;
    const e = camera.matrixWorld.elements;
    const dx = point.x - e[12], dy = point.y - e[13], dz = point.z - e[14];
    const front = -(dx * e[8] + dy * e[9] + dz * e[10]);
    if (front <= 0.05) return null;
    const tan = Math.tan((camera.fov || 60) * Math.PI / 360);
    const nx = (dx * e[0] + dy * e[1] + dz * e[2]) / front / tan / camera.aspect;
    const ny = (dx * e[4] + dy * e[5] + dz * e[6]) / front / tan;
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
    return { x: (nx + 1) * width / 2, y: (1 - ny) * height / 2 };
}

/** Pick a comment anchor against the collision octree, never fabricate a point in empty space. */
export function pickFpPoint(camera, collision, nx, ny) {
    if (!collision || !camera?.matrixWorld) return null;
    const e = camera.matrixWorld.elements;
    const tan = Math.tan((camera.fov || 60) * Math.PI / 360);
    const cx = nx * tan * camera.aspect, cy = ny * tan;
    const dx = cx * e[0] + cy * e[4] - e[8];
    const dy = cx * e[1] + cy * e[5] - e[9];
    const dz = cx * e[2] + cy * e[6] - e[10];
    const n = Math.hypot(dx, dy, dz);
    const hit = collision.queryRay(e[12], e[13], e[14], dx / n, dy / n, dz / n, 100);
    return finitePoint(hit) ? { x: hit.x, y: hit.y, z: hit.z } : null;
}

/** A mounted collaboration layer owns its map and scene for its entire lifetime. */
export class FpCollaboration {
    constructor({ container, sceneId, collision, releasePointer, onContextLost }) {
        this.container = container;
        this.sceneId = sceneId;
        this.collision = collision;
        this.releasePointer = releasePointer;
        this.mapName = getCurrentMapNameSync();
        this.active = true;
        this.collection = {};
        this.items = new Map();
        this.request = 0;
        this.lastSent = -Infinity;
        this.root = document.createElement('div');
        this.root.className = 'fp3d-collaboration';
        container.appendChild(this.root);
        const bus = getEventBus();
        this.off = [
            ...[EventTypes.COMMENT_CREATED, EventTypes.COMMENT_UPDATED, EventTypes.COMMENT_DELETED]
                .map((type) => bus.on(type, () => { this.reload(); })),
            bus.on(EventTypes.ATLAS_SWITCHED, onContextLost),
            bus.on(EventTypes.MAP_LOCK_CHANGED, () => {
                if (this.mapName !== getCurrentMapNameSync()) onContextLost();
            }),
            bus.on(EventTypes.SESSION_CHANGED, () => { this.cancel(); }),
        ];
        this.ready = this.reload();
    }

    async reload() {
        const request = ++this.request;
        try {
            const collection = await getComments(this.mapName);
            if (!this.active || request !== this.request) return;
            this.collection = collection || {};
            if (this.openId) {
                const root = this.collection[this.openId];
                if (!root || !ehDaSuperficie(root, SUPERFICIE.PRIMEIRA_PESSOA, this.sceneId)) this.closeCard();
                // Keep an in-progress reply/edit intact when a peer updates the thread. The test is
                // unsent TEXT, not focus: a focused Resolver/Reabrir button froze the card in its
                // pre-click state, and the reply box is focused on every draw.
                else if (!escrevendoNoCartao(this.card)) this.focus(root.id);
            }
        } catch (error) {
            console.error('[first-person] could not read comments:', error);
        }
    }

    toggle(force) {
        this.placing = (force ?? !this.placing) && podeComentar() && !!this.collision;
        if (this.placing) this.releasePointer();
        this.closeCard();
        this.container.classList.toggle('fp3d-commenting', !!this.placing);
    }

    closeCard() {
        const hadCard = !!this.card;
        this.card?.remove();
        this.card = null;
        this.openId = null;
        return hadCard;
    }

    cancel() {
        const used = !!this.placing || !!this.card;
        this.toggle(false);
        return used;
    }

    showCard(card, x = this.container.clientWidth / 2, y = this.container.clientHeight / 2) {
        this.releasePointer();
        this.closeCard();
        this.card = card;
        card.classList.add('comment-card--flutuante');
        this.container.appendChild(card);
        card.style.left = `${Math.max(12, Math.min(x, this.container.clientWidth - (card.offsetWidth || 320) - 12))}px`;
        card.style.top = `${Math.max(12, Math.min(y, this.container.clientHeight - (card.offsetHeight || 180) - 12))}px`;
        // Cards sit above the canvas. Their clicks must never place another point or turn the camera.
        for (const event of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
            card.addEventListener(event, (e) => e.stopPropagation());
        }
        card.querySelector('textarea')?.focus();
    }

    focus(id) {
        const root = this.collection[id];
        if (!this.active || !root || !ehDaSuperficie(root, SUPERFICIE.PRIMEIRA_PESSOA, this.sceneId)) return false;
        // Scoped to THIS thread: after a resolution the card calls it only once the store accepted
        // the write, and by then another pin may be open.
        this.showCard(montarCartaoDeThread({
            raiz: root, respostas: respostasDe(this.collection, id),
            aoFechar: () => { if (this.openId === id) this.closeCard(); },
        }));
        this.openId = id;
        return true;
    }

    place(camera, nx, ny) {
        if (!this.placing || !podeComentar()) return false;
        const point = pickFpPoint(camera, this.collision, nx, ny);
        if (!point) return true;
        this.toggle(false);
        const author = sessionContext.userId;
        this.showCard(montarCartaoDeCompose({
            aoCancelar: () => this.closeCard(),
            aoEnviar: async (text) => {
                if (!this.active || this.mapName !== getCurrentMapNameSync() || author !== sessionContext.userId) return false;
                const created = await addComment({
                    surface: SUPERFICIE.PRIMEIRA_PESSOA, tilesetId: this.sceneId,
                    ...point, text, ...autoriaAtual(),
                }, this.mapName);
                if (created) this.closeCard();
                return !!created;
            },
        }));
        return true;
    }

    update(camera, width, height, now = performance.now()) {
        if (!this.active) return;
        // Heartbeats republish stationary visitors after reconnect without a 10 Hz idle stream.
        const { x, y, z } = camera.position;
        const changed = !this.lastPosition || Math.hypot(x - this.lastPosition.x, y - this.lastPosition.y, z - this.lastPosition.z) > 0.005;
        if (finitePoint(camera.position) && now - this.lastSent >= (changed ? 100 : 1000)) {
            this.lastSent = now;
            this.lastPosition = { x, y, z };
            getEventBus().emit(EventTypes.POSITION_FP_MOVED, { tilesetId: this.sceneId, position: { x, y, z } });
        }
        const points = Object.values(this.collection).filter((c) => c && !c.parentId && c.status !== 'resolved'
            && ehDaSuperficie(c, SUPERFICIE.PRIMEIRA_PESSOA, this.sceneId) && finitePoint(c))
            .map((c) => ({ key: `comment:${c.id}`, point: c, text: `${c.authorInitials || '?'} · ${respostasDe(this.collection, c.id).length}`,
                color: c.authorColor, id: c.id }));
        for (const peer of presenceStore.getCursors('fp', this.sceneId)) {
            if (peer.clientId === sessionContext.clientId || peer.position.mapId !== this.mapName) continue;
            points.push({ key: `peer:${peer.clientId}`, point: peer.position, text: peer.userName || 'Visitante',
                color: getPresenceColor(peer.userId || peer.clientId) });
        }
        const seen = new Set();
        for (const item of points) {
            const pixel = projectFpPoint(item.point, camera, width, height);
            if (!pixel) continue;
            seen.add(item.key);
            let el = this.items.get(item.key);
            if (!el) {
                el = document.createElement(item.id ? 'button' : 'span');
                el.className = item.id ? 'fp3d-comment-pin' : 'fp3d-person';
                if (item.id) {
                    el.type = 'button';
                    el.setAttribute('aria-label', 'Abrir comentário');
                    el.addEventListener('click', (e) => { e.stopPropagation(); this.focus(item.id); });
                }
                this.root.appendChild(el);
                this.items.set(item.key, el);
            }
            el.textContent = item.text;
            el.style.backgroundColor = item.color || '#2563eb';
            el.style.transform = `translate(${pixel.x}px, ${pixel.y}px) translate(-50%, -50%)`;
        }
        for (const [key, el] of this.items) {
            if (!seen.has(key)) { el.remove(); this.items.delete(key); }
        }
    }

    destroy() {
        if (!this.active) return;
        this.active = false;
        this.cancel();
        for (const off of this.off) off?.();
        this.root.remove();
        this.items.clear();
        getEventBus().emit(EventTypes.POSITION_FP_MOVED, { tilesetId: this.sceneId, position: null });
    }
}
