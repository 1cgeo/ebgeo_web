// Path: tests/unit/streetview-absolute-tiles.test.js
//
// Regression: `withAbsoluteTiles` (street_view_tool/streetview-api.service.js).
//
// ROOT CAUSE — `/api/config` serves the 360 tile template RELATIVE
// (`/api/v1/sv360/tiles/{z}/{x}/{y}.pbf`), which resolves fine for this module's
// own window-context `fetch()`. MapLibre fetches tiles inside a Web Worker booted
// from a `blob:` URL, which has no usable base, so the relative template died with
// "Failed to construct 'Request': Failed to parse URL" and the 360 photo layer
// never rendered on the 2D map.
//
// The braces assertion is the one that matters most: the obvious fix,
// `new URL(t, origin).href`, percent-encodes `{z}` into `%7Bz%7D`, and MapLibre
// substitutes placeholders by literal string replacement — that would swap a loud
// failure for a silent one (tiles requested at a nonexistent literal path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const ORIGIN = 'http://localhost:3000';
let withAbsoluteTiles;
let hadWindow;

beforeAll(async () => {
    // The module reads `window.location.origin`; the unit env is node, not jsdom.
    hadWindow = 'window' in globalThis;
    globalThis.window = { location: { origin: ORIGIN } };
    ({ withAbsoluteTiles } = await import('../../src/js/street_view_tool/streetview-api.service.js'));
});

afterAll(() => {
    if (!hadWindow) delete globalThis.window;
});

describe('withAbsoluteTiles', () => {
    it('prefixes a root-relative tile template with the page origin', () => {
        const out = withAbsoluteTiles({
            type: 'vector',
            tiles: ['/api/v1/sv360/tiles/{z}/{x}/{y}.pbf'],
        });
        expect(out.tiles).toEqual([`${ORIGIN}/api/v1/sv360/tiles/{z}/{x}/{y}.pbf`]);
    });

    it('leaves the {z}/{x}/{y} placeholders literal (never percent-encoded)', () => {
        const [url] = withAbsoluteTiles({ tiles: ['/t/{z}/{x}/{y}.pbf'] }).tiles;
        // MapLibre replaces {z} textually; %7Bz%7D would never match.
        expect(url).toContain('{z}');
        expect(url).toContain('{x}');
        expect(url).toContain('{y}');
        expect(url).not.toContain('%7B');
    });

    it('passes an already-absolute template through untouched (other-origin service)', () => {
        const abs = 'https://sv360.example.mil.br/tiles/{z}/{x}/{y}.pbf';
        expect(withAbsoluteTiles({ tiles: [abs] }).tiles).toEqual([abs]);
    });

    it('preserves the other source properties and does not mutate the input', () => {
        const input = { type: 'vector', minzoom: 7, tiles: ['/a/{z}.pbf'] };
        const out = withAbsoluteTiles(input);
        expect(out.type).toBe('vector');
        expect(out.minzoom).toBe(7);
        expect(input.tiles).toEqual(['/a/{z}.pbf']); // the config object stays untouched
        expect(out).not.toBe(input);
    });

    it('returns the source unchanged when there is nothing to rewrite', () => {
        // Empty / absent tiles, and non-string entries: the helper must not throw on
        // a source shape it does not understand — it is handed whatever /api/config sent.
        const empty = { type: 'vector', tiles: [] };
        expect(withAbsoluteTiles(empty)).toBe(empty);
        const noTiles = { type: 'geojson', data: {} };
        expect(withAbsoluteTiles(noTiles)).toBe(noTiles);
        expect(withAbsoluteTiles(undefined)).toBe(undefined);
        expect(withAbsoluteTiles(null)).toBe(null);
        expect(withAbsoluteTiles({ tiles: [42] }).tiles).toEqual([42]);
    });
});
