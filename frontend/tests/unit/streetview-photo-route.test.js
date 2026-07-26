// Path: tests/unit/streetview-photo-route.test.js
//
// Regression: photo metadata must be requested on the route that MATCHES the
// identifier's shape (streetview-api.service.js).
//
// ROOT CAUSE — the 360 viewer navigates by the target's `img` (`original_name`):
// navigateToTarget → loadPhoto → loadMetadataWithCache all thread a NAME, never the
// uuid. The service sent everything to `/photos/:uuid`, whose param guard answers
// 422 for a non-uuid, so EVERY in-viewer jump to an adjacent panorama failed
// ("Photo not found: MULTICAPTURA_9468_005110 (HTTP 422)") the moment the archive
// held real photos. `/photos/by-name/:nome` exists for this and returns the same
// frozen shape. validatePhoto had the identical defect: a briefing slide stores the
// viewer's current photo, which is a name, so legacy slides were all reported missing.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

const SERVICE = '/api/v1/sv360';
const UUID_V5 = '6e173151-17cb-4eff-8c7e-31193aa278a0'; // a real id from the corpus (v4 nibble)
const NAME = 'MULTICAPTURA_9468_005110';

let api;
let config;

beforeAll(async () => {
    globalThis.window = globalThis.window ?? { location: { origin: 'http://localhost:3000' } };
    config = (await import('../../src/js/config.js')).default;
    config.streetView360 = { ...config.streetView360, serviceUrl: SERVICE };
    api = await import('../../src/js/street_view_tool/streetview-api.service.js');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Captures the URL passed to fetch and answers with a minimal metadata body. */
function stubFetch() {
    const calls = [];
    vi.stubGlobal('fetch', (url, opts) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ camera: {}, targets: [] }) });
    });
    return calls;
}

describe('fetchPhotoMetadata route selection', () => {
    it('uses /photos/:uuid when given a UUID', async () => {
        const calls = stubFetch();
        await api.fetchPhotoMetadata(UUID_V5);
        expect(calls[0].url).toBe(`${SERVICE}/photos/${UUID_V5}`);
    });

    it('uses /photos/by-name/:nome when given an original filename', async () => {
        const calls = stubFetch();
        await api.fetchPhotoMetadata(NAME);
        expect(calls[0].url).toBe(`${SERVICE}/photos/by-name/${NAME}`);
        // The uuid route is what answered 422 for a name — it must not be used.
        expect(calls[0].url).not.toContain(`/photos/${NAME}`);
    });

    it('percent-encodes a name with URL-significant characters', async () => {
        const calls = stubFetch();
        await api.fetchPhotoMetadata('foto 01/02?x=1');
        expect(calls[0].url).toBe(`${SERVICE}/photos/by-name/${encodeURIComponent('foto 01/02?x=1')}`);
        // A raw '/' would split the path and hit a different route entirely.
        expect(calls[0].url).not.toContain('01/02');
    });

    it('surfaces a failed lookup as an error naming the identifier', async () => {
        vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
        await expect(api.fetchPhotoMetadata(NAME)).rejects.toThrow(/MULTICAPTURA_9468_005110.*404/);
    });
});

describe('validatePhoto route selection', () => {
    it('HEADs the by-name route for a name (briefing slides store names)', async () => {
        const calls = stubFetch();
        const ok = await api.validatePhoto(NAME);
        expect(ok).toBe(true);
        expect(calls[0].method).toBe('HEAD');
        expect(calls[0].url).toBe(`${SERVICE}/photos/by-name/${NAME}`);
    });

    it('HEADs the uuid route for a uuid', async () => {
        const calls = stubFetch();
        await api.validatePhoto(UUID_V5);
        expect(calls[0].url).toBe(`${SERVICE}/photos/${UUID_V5}`);
    });
});
