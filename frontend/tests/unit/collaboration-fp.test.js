import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeElement, fire } from '../helpers/dom-double.js';

function element(tag) {
    const el = makeElement(tag);
    el.clientWidth = el.clientHeight = 600;
    el.classList.toggle = (name, on) => on ? el.classList.add(name) : el.classList.remove(name);
    el.querySelectorAll = (selector) => el.children.flatMap((c) => [
        ...(selector.startsWith('.') ? c.className.split(' ').includes(selector.slice(1)) : c.tagName === selector.toUpperCase()) ? [c] : [],
        ...c.querySelectorAll(selector),
    ]);
    el.querySelector = (selector) => el.querySelectorAll(selector)[0] || null;
    el.focus = () => { document.activeElement = el; };
    el.dispatchEvent = (event) => fire(el, event.type);
    return el;
}

const h = vi.hoisted(() => ({
    comments: {}, map: 'Mapa', allowed: true, peers: [],
    emit: vi.fn(), add: vi.fn(), callbacks: new Map(),
}));
vi.mock('@store', () => ({
    getComments: vi.fn(async () => h.comments),
    addComment: (...args) => h.add(...args), getCurrentMapNameSync: () => h.map,
    addReply: vi.fn(), resolveComment: vi.fn(), removeComment: vi.fn(), updateComment: vi.fn(),
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => ({ emit: h.emit, on: (key, fn) => {
    h.callbacks.set(key, fn); return () => h.callbacks.delete(key);
} }) }));
vi.mock('@store/store-origin.js', () => ({ isRemoteStoreSync: () => true }));
vi.mock('@utils/toast_service.js', () => ({ showError: vi.fn() }));
vi.mock('@store/sync/permission-guard.js', () => ({ checkPermission: () => ({ allowed: h.allowed }), GuardAction: { CREATE_COMMENT: 'CREATE_COMMENT' } }));
vi.mock('@store/sync/session-context.js', () => ({ sessionContext: {
    userId: 'me', clientId: 'self', username: 'Me', isAuthenticated: () => true, canPerformAction: () => true,
} }));
vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: { getCursors: (_surface, scene) => h.peers.filter((p) => p.position.tilesetId === scene) } }));
import { FpCollaboration, pickFpPoint, projectFpPoint } from '@js/first_person_3d_tool/collaboration-fp.js';
import { EventTypes } from '@events/event_types.js';

const camera = { position: { x: 1, y: 2, z: 3 }, fov: 60, aspect: 1,
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] } };
const root = { id: 'root', surface: 'fp', tilesetId: 'museum', x: 1, y: 2, z: 0, text: 'Museum', status: 'open' };
let layer;
beforeEach(() => {
    layer?.destroy();
    h.comments = {}; h.map = 'Mapa'; h.allowed = true; h.peers = [];
    h.emit.mockClear(); h.add.mockReset();
    const scene = element('div');
    vi.stubGlobal('document', { createElement: element, getElementById: () => scene,
        querySelector: (s) => scene.querySelector(s), querySelectorAll: (s) => scene.querySelectorAll(s) });
});
function mount(collision = { queryRay: () => ({ x: 1, y: 2, z: 0 }) }) {
    layer = new FpCollaboration({ container: document.getElementById('scene'), sceneId: 'museum', collision,
        releasePointer: vi.fn(), onContextLost: () => layer.destroy() });
    return layer;
}

describe('first-person collaboration', () => {
    it('projects local metres and refuses points behind the viewer or invalid points', () => {
        expect(projectFpPoint(root, camera, 600, 600)).toEqual({ x: 300, y: 300 });
        expect(projectFpPoint({ x: 1, y: 2, z: 4 }, camera, 600, 600)).toBeNull();
        expect(projectFpPoint({ x: NaN, y: 2, z: 0 }, camera, 600, 600)).toBeNull();
    });
    it('picks geometry only for comments, never invents a hit in empty space', () => {
        const collision = { queryRay: vi.fn(() => null) };
        expect(pickFpPoint(camera, collision, 0, 0)).toBeNull();
        expect(collision.queryRay).toHaveBeenCalledWith(1, 2, 3, 0, 0, -1, 100);
        expect(pickFpPoint(camera, null, 0, 0)).toBeNull();
    });
    it('broadcasts the visitor position even without a mouse hit, throttles and clears on close', async () => {
        mount(null); await layer.ready;
        layer.update(camera, 600, 600, 0);
        layer.update(camera, 600, 600, 50);
        expect(h.emit).toHaveBeenCalledTimes(1);
        expect(h.emit).toHaveBeenCalledWith(EventTypes.POSITION_FP_MOVED, { tilesetId: 'museum', position: { x: 1, y: 2, z: 3 } });
        layer.destroy();
        expect(h.emit).toHaveBeenLastCalledWith(EventTypes.POSITION_FP_MOVED, { tilesetId: 'museum', position: null });
    });
    it('isolates comment surface and scene, presence map and scene, and excludes self', async () => {
        h.comments = { root, other: { ...root, id: 'other', tilesetId: 'other' }, cesium: { ...root, id: 'cesium', surface: '3d' } };
        h.peers = [
            { clientId: 'self', position: { ...root, mapId: 'Mapa' } },
            { clientId: 'wrong-map', position: { ...root, mapId: 'Other' } },
            { clientId: 'wrong-scene', position: { ...root, tilesetId: 'other', mapId: 'Mapa' } },
            { clientId: 'peer', userName: 'Peer', position: { ...root, mapId: 'Mapa' } },
        ];
        mount(); await layer.ready; layer.update(camera, 600, 600);
        expect(document.querySelectorAll('.fp3d-comment-pin')).toHaveLength(1);
        expect(document.querySelectorAll('.fp3d-person')).toHaveLength(1);
        expect(document.querySelector('.fp3d-person').textContent).toBe('Peer');
        expect(layer.focus('other')).toBe(false);
    });
    it('keeps the draft when persistence fails and refuses placement without permission', async () => {
        mount(); await layer.ready;
        h.allowed = false; layer.toggle(true); expect(layer.placing).toBe(false);
        h.allowed = true; layer.toggle(true); layer.place(camera, 0, 0);
        const input = document.querySelector('textarea');
        input.value = 'Review'; input.dispatchEvent(new Event('input', { bubbles: true }));
        h.add.mockRejectedValueOnce(new Error('storage unavailable'));
        document.querySelector('.comment-composer__btn--primary').click();
        await vi.waitFor(() => expect(h.add).toHaveBeenCalled());
        expect(document.querySelector('textarea').value).toBe('Review');
        expect(h.add.mock.calls[0][0]).toMatchObject({ surface: 'fp', tilesetId: 'museum', x: 1, y: 2, z: 0 });
    });
    it('does not resurrect a stale read after teardown or map switch', async () => {
        h.comments = { root }; mount();
        layer.destroy(); await layer.ready;
        layer.update(camera, 600, 600);
        expect(document.querySelector('.fp3d-collaboration')).toBeNull();
        mount(); await layer.ready;
        h.map = 'Other'; h.callbacks.get(EventTypes.MAP_LOCK_CHANGED)();
        expect(layer.active).toBe(false);
    });
});
