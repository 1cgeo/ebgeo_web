// Path: tests/unit/trajectory-cursor-ownership.test.js

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

let TrajectoryEditControl;
beforeAll(async () => {
    ({ TrajectoryEditControl } = await import('@js/temporal/trajectory-tool/trajectory-edit-control.js'));
}, 120000);

let editor;
let map;
let canvas;
let container;
beforeEach(() => {
    canvas = { style: { cursor: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    // `getCanvasContainer` entrou em 2026-09-21 (achado E5): o arrasto de alça virou de
    // PONTEIRO com captura, e os ouvintes dele moram no contêiner, não no mapa.
    container = {
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
    };
    map = {
        getCanvas: () => canvas, getCanvasContainer: () => container, on: vi.fn(), off: vi.fn(),
        getLayer: vi.fn(), getSource: vi.fn(), dragPan: { enable: vi.fn() },
    };
    editor = new TrajectoryEditControl();
    editor._map = map;
    editor._toolManager = { activeTool: null };
    vi.stubGlobal('document', { removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('trajectory editor releases only its own map interactions', () => {
    it('hiding an idle editor preserves another interaction even without a ToolManager owner', () => {
        canvas.style.cursor = 'wait';
        editor.hide();
        editor.hide();
        expect(canvas.style.cursor).toBe('wait');
        expect(map.dragPan.enable).not.toHaveBeenCalled();
    });

    it('hiding an actual editor releases its hover cursor but does not re-enable pan it never disabled', () => {
        editor._editListenersActive = true;
        canvas.style.cursor = 'move';
        editor.hide();
        expect(canvas.style.cursor).toBe('');
        expect(map.dragPan.enable).not.toHaveBeenCalled();
    });

    it('cancelling its own drag restores navigation', () => {
        editor._editListenersActive = true;
        editor._editing = true;
        canvas.style.cursor = 'grabbing';
        editor.hide();
        expect(canvas.style.cursor).toBe('');
        expect(map.dragPan.enable).toHaveBeenCalledOnce();
        expect(editor._editing).toBe(false);
    });

    it.each([false, true])('cleanup after another tool activates preserves cursor and pan (adding=%s)', (adding) => {
        editor._editListenersActive = true;
        editor._editing = true;
        editor._adding = adding;
        editor._toolManager.activeTool = { type: 'point' };
        canvas.style.cursor = 'crosshair';
        editor.hide();
        expect(canvas.style.cursor).toBe('crosshair');
        expect(map.dragPan.enable).not.toHaveBeenCalled();
        expect(editor.isAdding()).toBe(false);
        expect(editor._editing).toBe(false);
    });

    it('rebuilding edit listeners while adding does not erase the append cursor', () => {
        editor._editListenersActive = true;
        editor._adding = true;
        canvas.style.cursor = 'crosshair';
        editor._teardownEditListeners();
        expect(canvas.style.cursor).toBe('crosshair');
    });
});
