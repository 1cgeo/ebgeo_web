// Path: tests/unit/screenshot-capture-timeout.test.js
//
// ROOT CAUSE it guards: `ScreenshotControl._captureWithHiddenMap` resolved ONLY inside
// `tempMap.once('load' -> 'idle')`. When 'load' never fired (style/tile failure) the
// returned Promise never settled, the off-screen container and the WebGL context leaked,
// and the caller (`briefing/export/slide-capture.service.js`, PDF export) awaited forever
// with no error to catch. The sibling `captureWithPreserveDrawingBuffer` already had the
// failsafe. Same for the unbounded `await map.once('idle')` in `captureMapAsDataUrl`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * O duble do MapLibre. Desde 2026-09-05 o controle alcanca a biblioteca pelo PONTO UNICO
 * (`@js/map/maplibre.js`) e nao mais por `globalThis.maplibregl`, entao a costura e o
 * `vi.mock` daquele modulo. `vi.hoisted` porque a fabrica roda no import ESTATICO abaixo,
 * quando a classe `FakeMap` deste arquivo ainda esta em TDZ: o objeto e estavel e cada
 * `beforeEach` troca a propriedade `Map` dentro dele.
 */
const dubleDoMapLibre = vi.hoisted(() => ({}));
vi.mock('@js/map/maplibre.js', () => ({ maplibregl: dubleDoMapLibre }));

import ScreenshotControl from '../../src/js/import_export/screenshot.control.js';

/** Long enough to pass the `length > 200` sanity check of the capture. */
const VALID_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(300);

/** Minimal `document` double: only createElement + body append/remove are used. */
function makeDocumentStub() {
    const body = {
        children: [],
        appendChild(el) { el.parentNode = body; body.children.push(el); return el; },
        removeChild(el) {
            const i = body.children.indexOf(el);
            if (i >= 0) body.children.splice(i, 1);
            el.parentNode = null;
            return el;
        },
    };
    return {
        body,
        createElement: () => ({
            style: {},
            parentNode: null,
            width: 0,
            height: 0,
            getContext: () => ({
                drawImage() {},
                getImageData: () => ({ data: [9, 9, 9, 255] }),
            }),
            toDataURL: () => VALID_DATA_URL,
        }),
    };
}

/** MapLibre `Map` double with a manual event registry (nothing fires on its own). */
class FakeMap {
    static instances = [];

    constructor(options = {}) {
        this.options = options;
        this._handlers = new Map();
        this.removed = false;
        this.dataUrl = VALID_DATA_URL;
        FakeMap.instances.push(this);
    }

    once(type, cb) {
        if (!this._handlers.has(type)) this._handlers.set(type, []);
        this._handlers.get(type).push(cb);
        return this;
    }

    off(type, cb) {
        const list = this._handlers.get(type) || [];
        const i = list.indexOf(cb);
        if (i >= 0) list.splice(i, 1);
        return this;
    }

    listenerCount(type) {
        return (this._handlers.get(type) || []).length;
    }

    fire(type, arg) {
        const list = this._handlers.get(type) || [];
        this._handlers.set(type, []);
        for (const cb of list) cb(arg);
    }

    remove() { this.removed = true; }
    triggerRepaint() {}
    loaded() { return this._loaded !== false; }
    getStyle() { return { layers: [] }; }
    getCenter() { return { lng: -53, lat: -29 }; }
    getZoom() { return 10; }
    getBearing() { return 0; }
    getPitch() { return 0; }
    getCanvas() {
        return { width: 800, height: 600, toDataURL: () => this.dataUrl };
    }
}

let originalDocument;
let originalRaf;

beforeEach(() => {
    FakeMap.instances = [];
    originalDocument = globalThis.document;
    originalRaf = globalThis.requestAnimationFrame;
    globalThis.document = makeDocumentStub();
    dubleDoMapLibre.Map = FakeMap;
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.document = originalDocument;
    delete dubleDoMapLibre.Map;
    globalThis.requestAnimationFrame = originalRaf;
    vi.restoreAllMocks();
});

describe('ScreenshotControl._captureWithHiddenMap', () => {
    it('REGRESSION: resolves null and cleans up when "load" never fires', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const source = new FakeMap();

        const promise = ScreenshotControl._captureWithHiddenMap(source);
        const temp = FakeMap.instances[1];
        expect(globalThis.document.body.children).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(ScreenshotControl.CAPTURE_TIMEOUT_MS);

        await expect(promise).resolves.toBeNull();
        expect(temp.removed).toBe(true);
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('resolves null on a style "error", without waiting for the failsafe', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const promise = ScreenshotControl._captureWithHiddenMap(new FakeMap());
        const temp = FakeMap.instances[1];

        temp.fire('error', { error: new Error('estilo indisponível') });

        await expect(promise).resolves.toBeNull();
        expect(temp.removed).toBe(true);
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('happy path: returns the data URL and still cleans up', async () => {
        const promise = ScreenshotControl._captureWithHiddenMap(new FakeMap());
        const temp = FakeMap.instances[1];

        temp.fire('load');
        temp.fire('idle');
        await vi.advanceTimersByTimeAsync(500);

        await expect(promise).resolves.toBe(VALID_DATA_URL);
        expect(temp.removed).toBe(true);
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('EDGE: a late failsafe after a successful capture neither re-resolves nor removes twice', async () => {
        const removeSpy = vi.fn();
        const promise = ScreenshotControl._captureWithHiddenMap(new FakeMap());
        const temp = FakeMap.instances[1];

        temp.fire('load');
        temp.fire('idle');
        await vi.advanceTimersByTimeAsync(500);
        await expect(promise).resolves.toBe(VALID_DATA_URL);

        // The container is already detached; a second removeChild would throw on a real DOM.
        globalThis.document.body.removeChild = removeSpy;
        await vi.advanceTimersByTimeAsync(ScreenshotControl.CAPTURE_TIMEOUT_MS);
        expect(removeSpy).not.toHaveBeenCalled();
    });

    it('EDGE: a truncated canvas data URL becomes null (not a bogus image)', async () => {
        const promise = ScreenshotControl._captureWithHiddenMap(new FakeMap());
        const temp = FakeMap.instances[1];
        temp.dataUrl = 'data:,';

        temp.fire('load');
        temp.fire('idle');
        await vi.advanceTimersByTimeAsync(500);

        await expect(promise).resolves.toBeNull();
        expect(globalThis.document.body.children).toHaveLength(0);
    });
});

describe('ScreenshotControl.captureMapAsDataUrl', () => {
    it('REGRESSION: does not hang when the source map never becomes idle', async () => {
        const map = new FakeMap();
        map._loaded = false;

        const promise = ScreenshotControl.captureMapAsDataUrl(map);
        expect(map.listenerCount('idle')).toBe(1);

        await vi.advanceTimersByTimeAsync(ScreenshotControl.CAPTURE_TIMEOUT_MS);
        await vi.advanceTimersByTimeAsync(10); // requestAnimationFrame double

        await expect(promise).resolves.toBe(VALID_DATA_URL);
        // The abandoned 'idle' listener is detached, so a late idle cannot resolve twice.
        expect(map.listenerCount('idle')).toBe(0);
    });

    it('EDGE: a null map short-circuits instead of throwing', async () => {
        await expect(ScreenshotControl.captureMapAsDataUrl(null)).resolves.toBeNull();
    });
});
