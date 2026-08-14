// Path: tests/unit/import-progress-overlay.test.js
//
// ROOT CAUSE it guards: `_readFileWithProgress` hid the progress overlay only in
// `reader.onload` and `reader.onerror`. Its own 30s timeout calls `reader.abort()`,
// which per the File API dispatches 'abort' + 'loadend' but NEVER 'error' — so on a
// timeout the fixed-position overlay (`.import-progress`, z-index 10000) stayed on
// screen forever, blocking the app, and each later import just leaked another one.
// The fix moves the cleanup to `onloadend`, the single exit shared by all outcomes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The control's module graph (store, shapefile/kml parsers, terrain) is irrelevant here
// and expensive; only `_readFileWithProgress` is under test.
vi.mock('@store', () => ({
    addFeatures: vi.fn(),
    createLayerForImport: vi.fn(),
    getLayers: vi.fn(async () => []),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getEventBus: vi.fn(() => ({ emit: vi.fn() })),
}));
vi.mock('@js/terrain', () => ({ getTerrainElevation: vi.fn(async () => 0) }));
vi.mock('@js/user_data', () => ({ userDataManager: { getUserData: vi.fn(() => ({})) } }));

const { default: AddImportControl } = await import('../../src/js/import_export/import.control.js');

/** Minimal `document` double: the overlay is built with createElement + body.appendChild. */
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
    const createElement = () => {
        const el = {
            style: {},
            className: '',
            textContent: '',
            parentNode: null,
            children: [],
            appendChild(child) { el.children.push(child); return child; },
            remove() { if (el.parentNode) el.parentNode.removeChild(el); },
        };
        return el;
    };
    return { body, createElement };
}

/**
 * FileReader double following the File API outcome order: abort() dispatches
 * 'abort' then 'loadend' and never 'error'.
 */
class FakeFileReader {
    static instances = [];

    constructor() {
        this.aborted = false;
        FakeFileReader.instances.push(this);
    }

    readAsText() { /* stays pending until the test drives an outcome */ }
    readAsArrayBuffer() { /* idem */ }

    abort() {
        this.aborted = true;
        this.onabort?.();
        this.onloadend?.();
    }

    emitLoad(result) {
        this.onload?.({ target: { result } });
        this.onloadend?.();
    }

    emitError() {
        this.onerror?.();
        this.onloadend?.();
    }
}

const BIG_FILE = { size: 2 * 1024 * 1024, name: 'grande.geojson' };

let originalDocument;
let originalFileReader;
let control;

beforeEach(() => {
    FakeFileReader.instances = [];
    originalDocument = globalThis.document;
    originalFileReader = globalThis.FileReader;
    globalThis.document = makeDocumentStub();
    globalThis.FileReader = FakeFileReader;
    control = new AddImportControl({ deactivateCurrentTool: vi.fn() });
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.document = originalDocument;
    globalThis.FileReader = originalFileReader;
});

describe('AddImportControl._readFileWithProgress — progress overlay lifecycle', () => {
    it('REGRESSION: the read timeout aborts AND removes the progress overlay', async () => {
        const promise = control._readFileWithProgress(BIG_FILE, 'text');
        // Attach the rejection assertion BEFORE the timer fires, or the rejection lands
        // with no handler while the fake clock is being advanced.
        const rejected = expect(promise).rejects.toThrow(/Timeout na leitura do arquivo/);
        expect(globalThis.document.body.children).toHaveLength(1);
        expect(control._progressElement).not.toBeNull();

        await vi.advanceTimersByTimeAsync(AddImportControl.FILE_LIMITS.timeout);

        await rejected;
        expect(FakeFileReader.instances[0].aborted).toBe(true);
        expect(control._progressElement).toBeNull();
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('removes the overlay on a successful read and resolves the content', async () => {
        const promise = control._readFileWithProgress(BIG_FILE, 'text');
        FakeFileReader.instances[0].emitLoad('{"type":"FeatureCollection"}');

        await expect(promise).resolves.toBe('{"type":"FeatureCollection"}');
        expect(control._progressElement).toBeNull();
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('removes the overlay on a read error', async () => {
        const promise = control._readFileWithProgress(BIG_FILE, 'text');
        FakeFileReader.instances[0].emitError();

        await expect(promise).rejects.toThrow(/Erro ao ler arquivo como text/);
        expect(control._progressElement).toBeNull();
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('EDGE: a small file shows no overlay, and a timeout on it leaves nothing behind', async () => {
        const promise = control._readFileWithProgress({ size: 10, name: 'p.geojson' }, 'text');
        const rejected = expect(promise).rejects.toThrow(/Timeout/);
        expect(globalThis.document.body.children).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(AddImportControl.FILE_LIMITS.timeout);

        await rejected;
        expect(globalThis.document.body.children).toHaveLength(0);
    });

    it('EDGE: an empty file is rejected before any overlay or reader is created', async () => {
        await expect(control._readFileWithProgress({ size: 0, name: 'v.geojson' }, 'text')).rejects.toThrow(/Arquivo vazio/);
        expect(FakeFileReader.instances).toHaveLength(0);
        expect(globalThis.document.body.children).toHaveLength(0);
    });
});
