import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeElement } from '../helpers/dom-double.js';

const h = vi.hoisted(() => ({ listeners: new Map(), click3d: null, comments: {} }));
vi.mock('@store', () => ({ getComments: async () => h.comments, getCurrentMapNameSync: () => 'Map', addComment: vi.fn(), addMarker360: vi.fn() }));
vi.mock('@store/services.js', () => ({ getEventBus: () => ({
    on: (key, fn) => { h.listeners.set(key, fn); return () => h.listeners.delete(key); },
    emit: (key, payload) => h.listeners.get(key)?.(payload),
}) }));
vi.mock('@store/sync/permission-guard.js', () => ({ checkPermission: () => ({ allowed: true }) }));
vi.mock('@utils/toast_service.js', () => ({ showSuccess: vi.fn(), showWarning: vi.fn() }));
vi.mock('@js/comment_tool/comment-card.js', () => ({
    SUPERFICIE: { MODELO_3D: '3d', FOTO_360: '360' }, podeComentar: () => true,
    autoriaAtual: () => ({}), respostasDe: () => [], ehDaSuperficie: () => false,
    montarCartaoDeCompose: () => document.createElement('div'),
    montarCartaoDeThread: () => document.createElement('div'),
}));
vi.mock('@js/vendor/cesium.js', () => ({ Cesium: {
    ScreenSpaceEventHandler: class { setInputAction(fn) { h.click3d = fn; } destroy() {} },
    ScreenSpaceEventType: { LEFT_CLICK: 1 }, defined: Boolean,
    Cartographic: { fromCartesian: (p) => p }, Math: { toDegrees: (v) => v },
} }));
import { iniciarComentarios3D, pararComentarios3D, alternarModoComentario3D } from '@js/3d_models_viewer_tool/tools/comments-3d.js';
import { iniciarComentarios360, pararComentarios360, alternarModoComentario360, modoComentario360Ativo } from '@js/street_view_tool/comments-360.js';
import { StreetViewNavigator } from '@js/street_view_tool/navigation/navigator.js';
import { activateMarkerTool, deactivateMarkerTool } from '@js/street_view_tool/tools/marker_tool_360.js';

let scene;
beforeEach(() => {
    scene = makeElement('div'); scene.clientWidth = 800; scene.clientHeight = 600;
    scene.classList.toggle = (name, value) => value ? scene.classList.add(name) : scene.classList.remove(name);
    vi.stubGlobal('document', { getElementById: () => scene, createElement: makeElement });
    h.listeners.clear(); h.comments = {};
});
afterEach(() => { pararComentarios3D(); pararComentarios360(); deactivateMarkerTool(); vi.unstubAllGlobals(); });

describe('comment cards follow scene gestures', () => {
    it('Cesium: blank scene click dismisses; clicking a comment opens the thread', async () => {
        const viewer = { canvas: { style: {} }, entities: { values: [] }, scene: {
            pick: vi.fn(() => null), pickPosition: () => ({ longitude: 1, latitude: 2, height: 3 }),
        } };
        h.comments = { c: { id: 'c', text: 'Saved' } };
        await iniciarComentarios3D(viewer, 'model');
        alternarModoComentario3D(true);
        h.click3d({ position: { x: 200, y: 200 } });
        expect(scene.children).toHaveLength(1);
        h.click3d({ position: { x: 20, y: 20 } });
        expect(scene.children).toHaveLength(0);
        viewer.scene.pick.mockReturnValue({ id: { properties: { commentId: { getValue: () => 'c' } } } });
        h.click3d({ position: { x: 200, y: 200 } });
        expect(scene.children).toHaveLength(1);
    });
    it('360: scene clicks close cards and marker activation cancels comment placement', async () => {
        const nav = Object.assign(Object.create(StreetViewNavigator.prototype), {
            requestRender: vi.fn(), setComments: vi.fn(), currentYaw: 0, currentPitch: 0, currentFov: 75,
            cameraConfig: { img: 'photo' }, hitTester: { testPoint: () => null },
            projector: { screenToSpherical: () => ({ heading: 0, pitch: 0 }) },
        });
        await iniciarComentarios360(nav, 'photo');
        alternarModoComentario360(true);
        nav.handleNavigationClick(200, 200);
        expect(scene.children).toHaveLength(1);
        // Bubble a pointer release from the card through the same container as the navigator.
        nav.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
        scene.addEventListener('pointerup', (event) => nav.handlePointerUp(event));
        let stopped = false;
        const event = { button: 0, clientX: 200, clientY: 200, stopPropagation: () => { stopped = true; } };
        for (let node = scene.children[0]; node && !stopped; node = node.parentNode) {
            for (const handler of node._listeners.get('pointerup') || []) handler(event);
        }
        expect(scene.children).toHaveLength(1);
        nav.handleNavigationClick(20, 20);
        expect(scene.children).toHaveLength(0);
        alternarModoComentario360(true);
        activateMarkerTool('photo', nav);
        expect(modoComentario360Ativo()).toBe(false);
        expect(nav.handleNavigationClick(20, 20).type).toBe('new-marker');
        expect(scene.children).toHaveLength(0);
    });
});
