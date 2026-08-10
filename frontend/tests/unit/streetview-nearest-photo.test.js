// Path: tests/unit/streetview-nearest-photo.test.js
//
// The nearest 360 photo is resolved by the SERVICE, never by the map.
//
// ROOT CAUSE it guards: `getNearestPhoto` used to run `querySourceFeatures` over
// the vector tiles the main map had already loaded, then pick the closest with
// turf. That tied the answer to what happened to be DRAWN — below the source's
// minimum zoom no tile exists, so a click on a trajectory line resolved nothing
// and the viewer never opened, silently. It also forced the main map to carry an
// invisible points layer (`street-view`, circle-radius 0) whose only reader was
// this query.
//
// `GET {serviceUrl}/photos/nearest?lon=&lat=` answers from the spatial index:
// valid at every zoom, and really the closest photo. These cases fail on the old
// implementation on three counts at once — it issued no request, it touched
// `map.querySourceFeatures`, and it returned a tile FEATURE (`.properties.id`)
// instead of a photo object carrying `id`.

import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from 'vitest';

const SERVICE = '/api/v1/sv360';
const ORIGIN = 'http://localhost:3000';
const PHOTO = {
    id: '6e173151-17cb-4eff-8c7e-31193aa278a0',
    img: 'MULTICAPTURA_9468_005110',
    display_name: 'MULTICAPTURA_9468_005110',
    lon: -53.3812,
    lat: -29.6842,
    ele: 92.4,
    projectSlug: 'beira-rio',
    sequence_number: 1369,
    distance: 4.7,
    floor_level: 5,
    floor_label: '5o andar',
};

let api;
let AddStreetViewControl;
let config;

beforeAll(async () => {
    // The unit environment is node: the module reads `window.location.origin`,
    // and the control's constructor calls `window.matchMedia`.
    globalThis.window = {
        location: { origin: ORIGIN },
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
    config = (await import('../../src/js/config.js')).default;
    config.streetView360 = {
        ...config.streetView360,
        serviceUrl: SERVICE,
        pointsSource: { type: 'vector', tiles: ['/api/v1/sv360/tiles/{z}/{x}/{y}.pbf'] },
        pointsSourceLayer: 'fotos',
        linesSource: { type: 'vector', tiles: ['/api/v1/sv360/tiles/{z}/{x}/{y}.pbf'] },
        linesSourceLayer: 'fotos_linha',
    };
    config.features = { ...config.features, imagens_panoramicas: true };
    api = await import('../../src/js/street_view_tool/streetview-api.service.js');
    ({ default: AddStreetViewControl } = await import('../../src/js/street_view_tool/add_street_view_control.js'));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Captures every fetch call and answers with a canned response.
 * @param {{ok?: boolean, status?: number, body?: Object}} [answer]
 */
function stubFetch(answer = {}) {
    const { ok = true, status = 200, body = { photo: PHOTO } } = answer;
    const calls = [];
    vi.stubGlobal('fetch', (url) => {
        calls.push(String(url));
        return Promise.resolve({ ok, status, json: async () => body });
    });
    return calls;
}

describe('fetchNearestPhoto', () => {
    it('asks /photos/nearest with lon and lat as query parameters', async () => {
        const calls = stubFetch();
        await api.fetchNearestPhoto(-53.3812, -29.6842);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe(`${SERVICE}/photos/nearest?lon=-53.3812&lat=-29.6842`);
    });

    it('unwraps the `photo` envelope and keeps every field the route sends', async () => {
        stubFetch();
        const photo = await api.fetchNearestPhoto(-53.3812, -29.6842);
        expect(photo).toEqual(PHOTO);
        // `id` is the property the map features carry; `photo_uuid` is the dead
        // PMTiles name and must not resurface here.
        expect(photo.id).toBe(PHOTO.id);
        expect(photo).not.toHaveProperty('photo_uuid');
        // The floor fields travel with the photo, so the viewer can open on the
        // right level without a second request.
        expect(photo.floor_level).toBe(5);
        expect(photo.floor_label).toBe('5o andar');
    });

    it('returns null when nothing is nearby (the route answers 404)', async () => {
        stubFetch({ ok: false, status: 404, body: { error: 'no photo near this point' } });
        expect(await api.fetchNearestPhoto(0, 0)).toBeNull();
    });

    it('returns null on a 200 with no photo in the envelope', async () => {
        stubFetch({ body: {} });
        expect(await api.fetchNearestPhoto(-53.38, -29.68)).toBeNull();
    });

    it('returns null instead of throwing when the network fails', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(await api.fetchNearestPhoto(-53.38, -29.68)).toBeNull();
        quiet.mockRestore();
    });
});

describe('AddStreetViewControl.getNearestPhoto', () => {
    let control;
    let map;

    beforeEach(() => {
        control = new AddStreetViewControl({});
        // A main map that SCREAMS if the old path is taken. It also no longer
        // carries the points source, so querySourceFeatures could only return
        // an empty list in the real app.
        map = {
            querySourceFeatures: vi.fn(() => {
                throw new Error('getNearestPhoto must not query the map');
            }),
        };
        control.map = map;
    });

    it('resolves the photo through the service, and never through the map', async () => {
        const calls = stubFetch();
        const photo = await control.getNearestPhoto({ lng: -53.3812, lat: -29.6842 });

        expect(photo.id).toBe(PHOTO.id);
        expect(map.querySourceFeatures).not.toHaveBeenCalled();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('/photos/nearest?lon=-53.3812&lat=-29.6842');
    });

    it('caches by rounded coordinate, so a second click on the same spot costs no request', async () => {
        const calls = stubFetch();
        await control.getNearestPhoto({ lng: -53.3812, lat: -29.6842 });
        // Same key at 1e-3 rounding: about 10 cm apart.
        const again = await control.getNearestPhoto({ lng: -53.38119, lat: -29.68421 });
        expect(calls).toHaveLength(1);
        expect(again.id).toBe(PHOTO.id);
    });

    it('goes back to the service for a coordinate that rounds elsewhere', async () => {
        const calls = stubFetch();
        await control.getNearestPhoto({ lng: -53.3812, lat: -29.6842 });
        await control.getNearestPhoto({ lng: -53.3902, lat: -29.6842 });
        expect(calls).toHaveLength(2);
    });

    it('clearCache empties the cache, so the next click asks again', async () => {
        const calls = stubFetch();
        await control.getNearestPhoto({ lng: -53.3812, lat: -29.6842 });
        control.clearCache();
        await control.getNearestPhoto({ lng: -53.3812, lat: -29.6842 });
        expect(calls).toHaveLength(2);
    });

    it('returns null when the service finds nothing, and caches no miss', async () => {
        const calls = stubFetch({ ok: false, status: 404, body: { error: 'nothing near' } });
        expect(await control.getNearestPhoto({ lng: 0, lat: 0 })).toBeNull();
        // A miss is not worth remembering: the archive grows.
        await control.getNearestPhoto({ lng: 0, lat: 0 });
        expect(calls).toHaveLength(2);
    });
});

describe('the points source left the main map', () => {
    it('the control exposes a SOURCE reference, not a layer definition', async () => {
        const control = new AddStreetViewControl({});
        // `pointsSourceRef` is what the minimap reads to draw points, selected
        // and hovered. The old `streetViewPointsLayer` was a full layer spec for
        // the main map, and nothing draws it any more.
        expect(control.pointsSourceRef).toEqual({
            id: 'streetViewPointsSource',
            sourceLayer: 'fotos',
        });
        expect(control.streetViewPointsLayer).toBeUndefined();
    });

    it('loadData adds only the trajectory line source to the main map', async () => {
        const control = new AddStreetViewControl({});
        const added = [];
        control.map = {
            getSource: () => undefined,
            addSource: (id) => added.push(id),
            getLayer: () => undefined,
            on: () => {},
            off: () => {},
            isSourceLoaded: () => false,
        };
        await control.loadData();
        expect(added).toEqual([control.streetViewLinesLayer['source']]);
        expect(added).not.toContain('streetViewPointsSource');
    });

    it('keeps `source-layer` on the line layers — they are MVT, not GeoJSON', () => {
        const control = new AddStreetViewControl({});
        // The trajectory comes from the `fotos_linha` layer of the SAME vector
        // tile. Dropping `source-layer` makes MapLibre discard the layer in
        // silence, with nothing drawn and nothing logged.
        for (const layer of [control.streetViewLinesLayer, control.streetViewLinesHitLayer]) {
            expect(layer['source-layer']).toBe('fotos_linha');
        }
    });
});
