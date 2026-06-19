import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    lngLatToMercator,
    mercatorToLngLat,
    pageContainerCssPx,
    computeMosaicZoom,
    pageMercatorSpan,
    computeTileCenters,
    tileBounds,
    computeMosaicBounds,
    mirrorAssemblyPosition,
    pageMercatorSpanFromScale,
} from '../../src/js/import_export/pdf-mosaic-geometry.js';

// ============================================================================
// Mercator round-trip
// ============================================================================

describe('lngLatToMercator / mercatorToLngLat', () => {
    it('round-trips a known point', () => {
        const { x, y } = lngLatToMercator(-43.18, -22.9);
        const { lng, lat } = mercatorToLngLat(x, y);
        expect(lng).toBeCloseTo(-43.18, 9);
        expect(lat).toBeCloseTo(-22.9, 9);
    });

    it('maps the origin to (0, 0)', () => {
        const { x, y } = lngLatToMercator(0, 0);
        expect(x).toBeCloseTo(0, 6);
        expect(y).toBeCloseTo(0, 6);
    });

    it('is round-trip stable for all valid lng/lat (fast-check)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -180, max: 180, noNaN: true }),
                // Web Mercator is undefined at the poles; clamp to its usual ±85.05°.
                fc.double({ min: -85, max: 85, noNaN: true }),
                (lng, lat) => {
                    const m = lngLatToMercator(lng, lat);
                    const back = mercatorToLngLat(m.x, m.y);
                    expect(back.lng).toBeCloseTo(lng, 6);
                    expect(back.lat).toBeCloseTo(lat, 6);
                }
            )
        );
    });
});

// ============================================================================
// Container size + zoom
// ============================================================================

describe('pageContainerCssPx', () => {
    it('matches A4 sides at 96 CSS dpi', () => {
        expect(pageContainerCssPx(297)).toBe(1123);
        expect(pageContainerCssPx(210)).toBe(794);
    });
});

describe('computeMosaicZoom', () => {
    it('produces a sane zoom for 1:25000 in southern Brazil', () => {
        const z = computeMosaicZoom(25000, -22.9);
        expect(z).toBeGreaterThan(12);
        expect(z).toBeLessThan(15);
    });

    it('is monotonic: larger scale denominator → smaller zoom', () => {
        const zClose = computeMosaicZoom(1000, 0);
        const zFar = computeMosaicZoom(1000000, 0);
        expect(zClose).toBeGreaterThan(zFar);
    });

    it('reproduces the requested ground scale at the centre latitude', () => {
        const denom = 25000;
        const lat = -22.9;
        const z = computeMosaicZoom(denom, lat);
        const span = pageMercatorSpan(z, pageContainerCssPx(297), pageContainerCssPx(210));
        // True ground width = pageMm/1000 * denom, stretched by 1/cos(lat) in Mercator.
        const expectedMercW = (297 / 1000) * denom / Math.cos((lat * Math.PI) / 180);
        // Within container-rounding tolerance (sub-1%).
        expect(span.width).toBeCloseTo(expectedMercW, -1);
        expect(span.width / span.height).toBeCloseTo(297 / 210, 2);
    });
});

// ============================================================================
// Tile layout + seamlessness
// ============================================================================

describe('computeTileCenters', () => {
    const base = {
        rows: 2,
        cols: 3,
        centerLng: -43.2,
        centerLat: -22.9,
        pageMercW: 8000,
        pageMercH: 5600,
    };

    it('returns rows*cols tiles in row-major order', () => {
        const tiles = computeTileCenters(base);
        expect(tiles).toHaveLength(6);
        expect(tiles.map(t => [t.row, t.col])).toEqual([
            [0, 0], [0, 1], [0, 2],
            [1, 0], [1, 1], [1, 2],
        ]);
    });

    it('spaces neighbouring tiles by exactly one page span in Mercator', () => {
        const tiles = computeTileCenters(base);
        const merc = tiles.map(t => lngLatToMercator(t.centerLng, t.centerLat));
        // Horizontal neighbours (col → col+1) differ by pageMercW in x.
        expect(merc[1].x - merc[0].x).toBeCloseTo(base.pageMercW, 3);
        expect(merc[2].x - merc[1].x).toBeCloseTo(base.pageMercW, 3);
        // Vertical neighbours (row → row+1) differ by pageMercH in y (downward).
        expect(merc[0].y - merc[3].y).toBeCloseTo(base.pageMercH, 3);
        // Same column shares the same x (no drift).
        expect(merc[0].x).toBeCloseTo(merc[3].x, 6);
    });

    it('adjacent tile bounds share an exact seam (continuity)', () => {
        const tiles = computeTileCenters(base);
        const span = { pageMercW: base.pageMercW, pageMercH: base.pageMercH };
        const t0 = tileBounds({ ...tiles[0], ...span });
        const t1 = tileBounds({ ...tiles[1], ...span });
        // East edge of tile 0 == west edge of tile 1.
        expect(t0.east).toBeCloseTo(t1.west, 9);
        expect(t0.north).toBeCloseTo(t1.north, 9);
    });

    it('a single 1×1 tile is centred on the mosaic centre', () => {
        const [tile] = computeTileCenters({ ...base, rows: 1, cols: 1 });
        expect(tile.centerLng).toBeCloseTo(base.centerLng, 6);
        expect(tile.centerLat).toBeCloseTo(base.centerLat, 6);
    });

    it('overlap shrinks neighbour spacing by the overlap amount', () => {
        const tiles = computeTileCenters({ ...base, overlapMercW: 2000, overlapMercH: 1400 });
        const merc = tiles.map(t => lngLatToMercator(t.centerLng, t.centerLat));
        // Horizontal/vertical advance = span − overlap.
        expect(merc[1].x - merc[0].x).toBeCloseTo(base.pageMercW - 2000, 3);
        expect(merc[0].y - merc[3].y).toBeCloseTo(base.pageMercH - 1400, 3);
    });

    it('adjacent tiles share an overlap-wide duplicated strip', () => {
        const tiles = computeTileCenters({ ...base, overlapMercW: 2000, overlapMercH: 1400 });
        const m0 = lngLatToMercator(tiles[0].centerLng, tiles[0].centerLat);
        const m1 = lngLatToMercator(tiles[1].centerLng, tiles[1].centerLat);
        // East edge of tile 0 overlaps the west edge of tile 1 by exactly `overlap`.
        const t0East = m0.x + base.pageMercW / 2;
        const t1West = m1.x - base.pageMercW / 2;
        expect(t0East - t1West).toBeCloseTo(2000, 3);
    });

    it('keeps the mosaic centred when overlapping', () => {
        const merc = computeTileCenters({ ...base, overlapMercW: 2000, overlapMercH: 1400 })
            .map(t => lngLatToMercator(t.centerLng, t.centerLat));
        const meanX = merc.reduce((s, m) => s + m.x, 0) / merc.length;
        const meanY = merc.reduce((s, m) => s + m.y, 0) / merc.length;
        const c = lngLatToMercator(base.centerLng, base.centerLat);
        expect(meanX).toBeCloseTo(c.x, 3);
        expect(meanY).toBeCloseTo(c.y, 3);
    });

    it('overlap = 0 reproduces the abutting (no-overlap) layout', () => {
        const plain = computeTileCenters(base);
        const zeroed = computeTileCenters({ ...base, overlapMercW: 0, overlapMercH: 0 });
        expect(zeroed).toEqual(plain);
    });
});

describe('computeMosaicBounds', () => {
    it('encloses every tile', () => {
        const params = {
            centerLng: 10, centerLat: 45, rows: 3, cols: 4,
            pageMercW: 6000, pageMercH: 4200,
        };
        const bounds = computeMosaicBounds(params);
        const tiles = computeTileCenters({
            ...params, centerLng: params.centerLng, centerLat: params.centerLat,
        });
        for (const t of tiles) {
            const tb = tileBounds({ ...t, pageMercW: params.pageMercW, pageMercH: params.pageMercH });
            expect(tb.west).toBeGreaterThanOrEqual(bounds.west - 1e-6);
            expect(tb.east).toBeLessThanOrEqual(bounds.east + 1e-6);
            expect(tb.south).toBeGreaterThanOrEqual(bounds.south - 1e-6);
            expect(tb.north).toBeLessThanOrEqual(bounds.north + 1e-6);
        }
    });

    it('shrinks the total span by the overlaps', () => {
        const params = {
            centerLng: 10, centerLat: 45, rows: 3, cols: 4,
            pageMercW: 6000, pageMercH: 4200,
        };
        const b = computeMosaicBounds({ ...params, overlapMercW: 1000, overlapMercH: 700 });
        // Mercator x depends only on lng, so converting the bounds back gives the total span.
        const width = lngLatToMercator(b.east, params.centerLat).x - lngLatToMercator(b.west, params.centerLat).x;
        // total = pageMercW + (cols−1)(pageMercW − overlap) = 6000 + 3·5000 = 21000.
        expect(width).toBeCloseTo(6000 + 3 * 5000, 0);
    });

    it('still encloses every tile when overlapping', () => {
        const params = {
            centerLng: 10, centerLat: 45, rows: 3, cols: 4,
            pageMercW: 6000, pageMercH: 4200, overlapMercW: 1000, overlapMercH: 700,
        };
        const bounds = computeMosaicBounds(params);
        const tiles = computeTileCenters(params);
        for (const t of tiles) {
            const tb = tileBounds({ ...t, pageMercW: params.pageMercW, pageMercH: params.pageMercH });
            expect(tb.west).toBeGreaterThanOrEqual(bounds.west - 1e-6);
            expect(tb.east).toBeLessThanOrEqual(bounds.east + 1e-6);
            expect(tb.south).toBeGreaterThanOrEqual(bounds.south - 1e-6);
            expect(tb.north).toBeLessThanOrEqual(bounds.north + 1e-6);
        }
    });
});

// ============================================================================
// Face-down assembly mirroring
// ============================================================================

describe('mirrorAssemblyPosition', () => {
    it('reverses columns and keeps rows (left↔right final flip)', () => {
        expect(mirrorAssemblyPosition({ row: 0, col: 0, cols: 3 })).toEqual({ assemblyRow: 0, assemblyCol: 2 });
        expect(mirrorAssemblyPosition({ row: 1, col: 1, cols: 3 })).toEqual({ assemblyRow: 1, assemblyCol: 1 });
        expect(mirrorAssemblyPosition({ row: 1, col: 2, cols: 3 })).toEqual({ assemblyRow: 1, assemblyCol: 0 });
    });

    it('is an involution (mirroring twice restores the column)', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 12 }),
                fc.nat(11),
                (cols, rawCol) => {
                    const col = rawCol % cols;
                    const once = mirrorAssemblyPosition({ row: 0, col, cols });
                    const twice = mirrorAssemblyPosition({ row: 0, col: once.assemblyCol, cols });
                    expect(twice.assemblyCol).toBe(col);
                }
            )
        );
    });

    it('1×1 mosaic maps the single tile to itself', () => {
        expect(mirrorAssemblyPosition({ row: 0, col: 0, cols: 1 })).toEqual({ assemblyRow: 0, assemblyCol: 0 });
    });
});

// ============================================================================
// Closed-form span sanity
// ============================================================================

describe('pageMercatorSpanFromScale', () => {
    it('agrees with the zoom-based span', () => {
        const span = pageMercatorSpanFromScale({
            pageWidthMm: 297, pageHeightMm: 210, scaleDenom: 50000, centerLat: -15,
        });
        expect(span.width).toBeGreaterThan(span.height);
        expect(span.width / span.height).toBeCloseTo(297 / 210, 2);
    });
});
