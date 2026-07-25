// Path: tests/unit/config-raster-dem.test.js
// rasterDemSource() — the builder of map2d.terrainSource / map2d.hillshadeSource,
// which /api/config emits and the frontend hands VERBATIM to map.addSource().
//
// It encodes a fix for a REAL production bug (a terrain served by tile template
// landed in `url:`, which MapLibre cannot resolve) and had NO regression test: the
// only assertion anywhere was `cfg.map2d.terrainSource.type === 'raster-dem'`
// (config.test.js), which is true of BOTH the fixed and the broken shape. That is
// coverage which cannot distinguish the bug from its fix.
//
// The function was private to config.service.js — a module that drags in the
// Postgres pool — so it was untestable in isolation; it now lives in the pure
// config.static.js and is imported here directly.
//
// MapLibre's two raster-dem forms are NOT interchangeable and are MUTUALLY
// EXCLUSIVE: emitting both `url` and `tiles` is not "belt and braces", it is
// ambiguous. Each case therefore asserts the ABSENCE of the other key.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rasterDemSource } from '../../src/modules/config/config.static.js';

describe('rasterDemSource — the TileJSON form (no {z} in the URL)', () => {
  it('emits { type, url, tileSize } and NO `tiles` key', () => {
    const out = rasterDemSource('https://h/terrain/tiles.json', undefined, undefined);
    assert.deepEqual(out, { type: 'raster-dem', url: 'https://h/terrain/tiles.json', tileSize: 256 });
    assert.equal('tiles' in out, false, 'a TileJSON source must not also carry a tiles array');
  });

  it('ignores minzoom/maxzoom in the TileJSON form (the TileJSON itself declares them)', () => {
    const out = rasterDemSource('https://h/terrain/tiles.json', 0, 14);
    assert.equal('minzoom' in out, false);
    assert.equal('maxzoom' in out, false);
  });
});

describe('rasterDemSource — the tile-template form ({z} present)', () => {
  it('the production case that motivated the fix: template goes to `tiles`, never `url`', () => {
    const out = rasterDemSource('/cms/martin/fathom_terrain/{z}/{x}/{y}', undefined, undefined);
    assert.deepEqual(out.tiles, ['/cms/martin/fathom_terrain/{z}/{x}/{y}']);
    assert.equal('url' in out, false, 'the pre-fix shape — MapLibre never resolved it');
    assert.equal(out.type, 'raster-dem');
    assert.equal(out.tileSize, 256);
  });

  it('minzoom 0 is EMITTED — a truthiness guard would silently drop a legitimate zoom', () => {
    // `if (minzoom)` is the natural way to write this and is wrong: zoom 0 is the
    // whole world and a perfectly ordinary lower bound.
    const out = rasterDemSource('/x/{z}/{x}/{y}', 0, 14);
    assert.equal(out.minzoom, 0);
    assert.equal(out.maxzoom, 14);
    assert.ok('minzoom' in out, 'zero must survive as a key, not be treated as absent');
  });

  it('NaN / Infinity are dropped — `?? 0` would NOT have caught either', () => {
    // Number.isFinite is what protects here. An env var that fails to parse arrives
    // as NaN, and `{ minzoom: NaN }` serializes to `null` in JSON, which MapLibre
    // rejects when parsing the style.
    const out = rasterDemSource('/x/{z}/{x}/{y}', NaN, Infinity);
    assert.equal('minzoom' in out, false);
    assert.equal('maxzoom' in out, false);
    assert.deepEqual(out, { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'], tileSize: 256 });
  });

  it('each bound is independent — one invalid value does not drop the other', () => {
    const out = rasterDemSource('/x/{z}/{x}/{y}', 2, NaN);
    assert.equal(out.minzoom, 2);
    assert.equal('maxzoom' in out, false);
  });

  it('a negative zoom is finite and therefore emitted (characterization, not endorsement)', () => {
    // The guard is Number.isFinite, not a range check. Pinned so the difference is
    // visible if someone later expects range validation to live here.
    const out = rasterDemSource('/x/{z}/{x}/{y}', -1, 30);
    assert.equal(out.minzoom, -1);
    assert.equal(out.maxzoom, 30);
  });
});

describe('rasterDemSource — the "not configured" signal', () => {
  it('an absent or empty URL yields undefined, so the key disappears from the payload', () => {
    // This is how map2d.terrainSource vanishes from /api/config on a deployment
    // with no terrain server. Returning an object with url: '' instead would make
    // the frontend register a broken source.
    assert.equal(rasterDemSource('', 1, 2), undefined);
    assert.equal(rasterDemSource(undefined), undefined);
    assert.equal(rasterDemSource(null), undefined);
  });
});
