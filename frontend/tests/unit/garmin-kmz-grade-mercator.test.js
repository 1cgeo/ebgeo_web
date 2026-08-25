// Path: tests/unit/garmin-kmz-grade-mercator.test.js

/**
 * @fileoverview Pins the pure half of `js/import_export/garmin-kmz-export.js`:
 * the bbox normalization, the Web Mercator tile grid built in PIXEL space, and
 * the KML document generated from it. All three are instance methods that touch
 * neither the map nor the DOM, so a stub `map` object is enough to reach them.
 *
 * WHAT THIS SUITE PINS
 * - `_cornersToBox`: any of the four corner orders yields the same box;
 * - the MapLibre 512 px tile base (a 256 px base would halve every pixel extent,
 *   which is the exact bug the module's comment says it exists to prevent);
 * - `_calculateTileGrid`'s three refusals - degenerate bbox, more than 100 tiles,
 *   and a pixel extent above 16384 - each with the neighbouring accepted case, so
 *   the boundary is pinned rather than the side of it;
 * - `_buildMercatorTileGrid`'s coverage contract: row-major order, edge tiles
 *   shrunk to fit, neighbouring tiles sharing an EXACT edge (no gap, no overlap),
 *   and the tile widths summing to the total;
 * - the geographic round trip: the assembled tile bounds reproduce the requested
 *   bbox to within the one-pixel rounding of the total extent;
 * - `_generateKml`: one GroundOverlay per tile, with the href the packer writes.
 *
 * WHAT IT DOES NOT REACH
 * - Rendering, JPEG encoding and zipping (`exportKmz` and friends): they need a
 *   live MapLibre map, a canvas and `Blob`.
 * - The preview layers (`_showPreview`, `_ensurePreviewSource`) and the two-click
 *   drawing handlers, which drive the real map.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { GarminKmzExport } from '../../src/js/import_export/garmin-kmz-export.js';

// The exporter only stores the map in the constructor, so a bare object is a
// sufficient stand-in for every method exercised here.
const make = () => new GarminKmzExport({});

// ============================================================================
// Independent Mercator, written out rather than imported
// ============================================================================

const TILE_BASE = 512;
const ZOOM = 16;
const WORLD_PX = TILE_BASE * 2 ** ZOOM; // 33 554 432 px at zoom 16
const DEG_PER_PX = 360 / WORLD_PX;

const xOf = (lng) => ((lng + 180) / 360) * WORLD_PX;
const yOf = (lat) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD_PX;
};

// ============================================================================
// _cornersToBox
// ============================================================================

describe('_cornersToBox', () => {
    const A = [-43.2, -22.9];
    const B = [-43.1, -22.8];
    const expected = { west: -43.2, east: -43.1, south: -22.9, north: -22.8 };

    it('as quatro ordens de canto dao a MESMA caixa', () => {
        const g = make();
        const orders = [
            [A, B],
            [B, A],
            [[A[0], B[1]], [B[0], A[1]]],
            [[B[0], A[1]], [A[0], B[1]]],
        ];
        expect(orders).toHaveLength(4);
        for (const [c1, c2] of orders) {
            const box = g._cornersToBox(c1, c2);
            expect(box.west).toBeCloseTo(expected.west, 12);
            expect(box.east).toBeCloseTo(expected.east, 12);
            expect(box.south).toBeCloseTo(expected.south, 12);
            expect(box.north).toBeCloseTo(expected.north, 12);
        }
    });

    it('invariante (fast-check): west <= east e south <= north sempre', () => {
        const g = make();
        fc.assert(
            fc.property(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -85, max: 85, noNaN: true }),
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -85, max: 85, noNaN: true }),
                (a, b, c, d) => {
                    const box = g._cornersToBox([a, b], [c, d]);
                    expect(box.west).toBeLessThanOrEqual(box.east);
                    expect(box.south).toBeLessThanOrEqual(box.north);
                },
            ),
            { numRuns: 150 },
        );
    });

    it('cantos identicos dao uma caixa degenerada, sem erro', () => {
        const box = make()._cornersToBox(A, A);
        expect(box.west).toBe(box.east);
        expect(box.south).toBe(box.north);
    });

    it('OBSERVADO: um canto NaN contamina a caixa em silencio', () => {
        // `Math.min(NaN, x)` is NaN, so the bbox survives as a well-formed object
        // full of NaN and only fails much later, inside the grid arithmetic.
        const box = make()._cornersToBox([NaN, -22.9], [-43.1, -22.8]);
        expect(Number.isNaN(box.west)).toBe(true);
        expect(Number.isNaN(box.east)).toBe(true);
        expect(box.south).toBe(-22.9); // the clean axis is untouched
    });

    it('CONSERTADO: a caixa NaN e RECUSADA, em vez de virar grade vazia', () => {
        // `totalWidth < 1` is false for NaN, `NaN > MAX_TILES` is false and
        // `NaN > MAX_CANVAS_DIM` is false, so all three guards failed OPEN. What
        // came back was a grid object with `cols: NaN` and `tiles: []`: the export
        // produced a KMZ with no imagery at all, and `getTileInfo().total` read
        // NaN on screen. `Number.isFinite` on the pixel extents is the guard.
        const g = make();
        const bad = g._cornersToBox([NaN, -22.9], [-43.1, -22.8]);
        expect(g._calculateTileGrid(bad)).toBeNull();
    });

    it('CONSERTADO: qualquer canto nao finito tem o mesmo desfecho', () => {
        const g = make();
        for (const ruim of [NaN, Infinity, -Infinity, undefined]) {
            expect(g._calculateTileGrid(g._cornersToBox([ruim, -22.9], [-43.1, -22.8])), String(ruim))
                .toBeNull();
            expect(g._calculateTileGrid(g._cornersToBox([-43.2, ruim], [-43.1, -22.8])), String(ruim))
                .toBeNull();
        }
    });

    it('CONTROLE: a MESMA caixa com o canto finito e aceita e traz tiles', () => {
        // Proves the case above is the NaN reaching through the guards, not a
        // bbox that would be refused anyway.
        const g = make();
        const good = g._cornersToBox([-43.2, -22.9], [-43.1, -22.8]);
        const grid = g._calculateTileGrid(good);
        expect(grid).not.toBeNull();
        expect(Number.isNaN(grid.cols)).toBe(false);
        expect(grid.tiles.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// Pixel base: 512, not 256
// ============================================================================

describe('base de tile do MapLibre', () => {
    it('a largura em pixels usa base 512 no zoom 16', () => {
        // 0,05 deg at zoom 16 is 4660 px on a 512 base and 2330 px on a 256 one.
        const g = make();
        const grid = g._calculateTileGrid({ west: 0, east: 0.05, south: 0, north: 0.005 });
        expect(grid).not.toBeNull();
        const expectedPx = Math.round(xOf(0.05) - xOf(0));
        expect(expectedPx).toBe(4660);
        expect(grid.totalWidth).toBe(expectedPx);
        expect(grid.totalWidth).not.toBe(Math.round(expectedPx / 2));
    });

    it('o zoom de exportacao e 16 e vem carimbado na grade', () => {
        const grid = make()._calculateTileGrid({ west: 0, east: 0.01, south: 0, north: 0.01 });
        expect(grid).not.toBeNull();
        expect(grid.zoom).toBe(ZOOM);
    });

    it('a altura em pixels segue a projecao de Mercator, nao a diferenca de graus', () => {
        const g = make();
        // Same 0,01 deg of latitude, once at the equator and once at 60 deg N:
        // Mercator stretches the high-latitude one.
        const low = g._calculateTileGrid({ west: 0, east: 0.01, south: 0, north: 0.01 });
        const high = g._calculateTileGrid({ west: 0, east: 0.01, south: 60, north: 60.01 });
        expect(low).not.toBeNull();
        expect(high).not.toBeNull();
        expect(high.totalHeight).toBeGreaterThan(low.totalHeight);
        expect(high.totalHeight / low.totalHeight).toBeCloseTo(1 / Math.cos((60 * Math.PI) / 180), 2);
    });
});

// ============================================================================
// _calculateTileGrid - the three refusals
// ============================================================================

describe('_calculateTileGrid - recusas', () => {
    const g = make();

    it('caixa degenerada (menos de 1 px) devolve null', () => {
        expect(g._calculateTileGrid({ west: 0, east: 0, south: 0, north: 0 })).toBeNull();
        // A hair under one pixel wide is still refused.
        const sub = DEG_PER_PX * 0.4;
        expect(g._calculateTileGrid({ west: 0, east: sub, south: 0, north: 0.01 })).toBeNull();
    });

    it('CONTROLE: um pixel inteiro em cada eixo ja e aceito', () => {
        const one = DEG_PER_PX * 1.0;
        const grid = g._calculateTileGrid({ west: 0, east: one, south: 0, north: one });
        expect(grid).not.toBeNull();
        expect(grid.cols).toBe(1);
        expect(grid.rows).toBe(1);
    });

    it('exatamente 100 tiles passa; 110 nao (limite do Garmin)', () => {
        // 10 240 px in each axis is exactly 10 x 10 tiles.
        const tenTiles = DEG_PER_PX * 10240;
        const latFor = (px) => {
            // Invert the Mercator so the requested pixel height is met at the equator.
            const n = Math.PI - (2 * Math.PI * (WORLD_PX / 2 - px)) / WORLD_PX;
            return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        };
        const okay = g._calculateTileGrid({ west: 0, east: tenTiles, south: 0, north: latFor(10240) });
        expect(okay).not.toBeNull();
        expect(okay.cols * okay.rows).toBe(100);

        const tooMany = g._calculateTileGrid({
            west: 0, east: DEG_PER_PX * 11264, south: 0, north: latFor(10240),
        });
        expect(tooMany).toBeNull();
    });

    it('largura acima de 16384 px devolve null mesmo com poucos tiles', () => {
        // 0,17578125 deg is exactly 16384 px at zoom 16 - 16 columns, one row,
        // so the 100-tile ceiling is nowhere near and only the canvas cap can fire.
        const exact = 0.17578125;
        const oneRow = DEG_PER_PX * 900;
        const okay = g._calculateTileGrid({ west: 0, east: exact, south: 0, north: oneRow });
        expect(okay).not.toBeNull();
        expect(okay.totalWidth).toBe(16384);
        expect(okay.rows).toBe(1);
        expect(okay.cols).toBe(16);

        const over = g._calculateTileGrid({
            west: 0, east: exact + DEG_PER_PX * 2, south: 0, north: oneRow,
        });
        expect(over).toBeNull();
    });
});

// ============================================================================
// _buildMercatorTileGrid - coverage contract
// ============================================================================

describe('_buildMercatorTileGrid - cobertura', () => {
    const BBOX = { west: -43.30, east: -43.22, south: -22.94, north: -22.90 };
    const grid = make()._calculateTileGrid(BBOX);

    it('a grade existe e tem o numero de tiles anunciado', () => {
        expect(grid).not.toBeNull();
        expect(grid.tiles).toHaveLength(grid.rows * grid.cols);
        expect(grid.rows).toBeGreaterThan(1);
        expect(grid.cols).toBeGreaterThan(1);
    });

    it('a ordem e row-major', () => {
        const seen = grid.tiles.map((t) => `${t.row}:${t.col}`);
        const expected = [];
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols; c++) expected.push(`${r}:${c}`);
        }
        expect(seen).toEqual(expected);
    });

    it('so os tiles de borda encolhem, e a soma fecha o total', () => {
        const row0 = grid.tiles.filter((t) => t.row === 0);
        expect(row0).toHaveLength(grid.cols);
        for (const t of row0.slice(0, -1)) expect(t.width).toBe(1024);
        expect(row0.reduce((s, t) => s + t.width, 0)).toBe(grid.totalWidth);

        const col0 = grid.tiles.filter((t) => t.col === 0);
        expect(col0).toHaveLength(grid.rows);
        for (const t of col0.slice(0, -1)) expect(t.height).toBe(1024);
        expect(col0.reduce((s, t) => s + t.height, 0)).toBe(grid.totalHeight);
    });

    it('vizinhos compartilham a aresta EXATA: sem vao e sem sobreposicao', () => {
        const at = (r, c) => grid.tiles.find((t) => t.row === r && t.col === c);
        let checkedH = 0;
        let checkedV = 0;
        for (let r = 0; r < grid.rows; r++) {
            for (let c = 0; c < grid.cols - 1; c++) {
                expect(at(r, c).east).toBe(at(r, c + 1).west);
                checkedH++;
            }
        }
        for (let r = 0; r < grid.rows - 1; r++) {
            for (let c = 0; c < grid.cols; c++) {
                expect(at(r, c).south).toBe(at(r + 1, c).north);
                checkedV++;
            }
        }
        expect(checkedH).toBe(grid.rows * (grid.cols - 1));
        expect(checkedV).toBe((grid.rows - 1) * grid.cols);
    });

    it('cada tile tem north > south e east > west', () => {
        expect(grid.tiles.length).toBeGreaterThan(0);
        for (const t of grid.tiles) {
            expect(t.east).toBeGreaterThan(t.west);
            expect(t.north).toBeGreaterThan(t.south);
        }
    });

    it('o centro de cada tile cai dentro do proprio tile', () => {
        expect(grid.tiles.length).toBeGreaterThan(0);
        for (const t of grid.tiles) {
            expect(t.centerLng).toBeGreaterThan(t.west);
            expect(t.centerLng).toBeLessThan(t.east);
            expect(t.centerLat).toBeLessThan(t.north);
            expect(t.centerLat).toBeGreaterThan(t.south);
        }
    });

    it('a uniao dos tiles reproduz a bbox pedida (round-trip pixel -> grau)', () => {
        const first = grid.tiles[0];
        const last = grid.tiles[grid.tiles.length - 1];
        // One pixel of slack: the pixel extent is rounded before the grid is built.
        expect(first.west).toBeCloseTo(BBOX.west, 5);
        expect(first.north).toBeCloseTo(BBOX.north, 5);
        expect(last.east).toBeCloseTo(BBOX.east, 5);
        expect(last.south).toBeCloseTo(BBOX.south, 5);
    });

    it('o centro da grade fica no centro geografico em MERCATOR, nao em graus', () => {
        // The centre is computed in pixel space, so it is the Mercator midpoint;
        // south of the equator that sits slightly north of the degree midpoint.
        const yMid = (yOf(BBOX.north) + yOf(BBOX.south)) / 2;
        const n = Math.PI - (2 * Math.PI * yMid) / WORLD_PX;
        const mercLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        expect(grid.centerLat).toBeCloseTo(mercLat, 5);
        expect(grid.centerLng).toBeCloseTo((BBOX.west + BBOX.east) / 2, 5);
    });

    it('uma grade 1x1 devolve um tile com a bbox inteira', () => {
        const small = { west: 10, east: 10.005, south: 5, north: 5.005 };
        const one = make()._calculateTileGrid(small);
        expect(one).not.toBeNull();
        expect(one.tiles).toHaveLength(1);
        expect(one.tiles[0]).toMatchObject({ row: 0, col: 0 });
        expect(one.tiles[0].width).toBe(one.totalWidth);
        expect(one.tiles[0].height).toBe(one.totalHeight);
    });
});

// ============================================================================
// getTileInfo
// ============================================================================

describe('getTileInfo', () => {
    it('devolve null enquanto nao ha grade', () => {
        const g = make();
        expect(g.getTileInfo()).toBeNull();
        expect(g.hasBbox()).toBe(false);
        expect(g.isDrawing()).toBe(false);
    });

    it('o total e o produto de linhas por colunas', () => {
        const g = make();
        g._tileGrid = g._calculateTileGrid({ west: -43.30, east: -43.22, south: -22.94, north: -22.90 });
        const info = g.getTileInfo();
        expect(info.total).toBe(info.rows * info.cols);
        expect(info.zoom).toBe(ZOOM);
    });
});

// ============================================================================
// _generateKml
// ============================================================================

describe('_generateKml', () => {
    const tiles = [
        { row: 0, col: 0, north: -22.90, south: -22.91, east: -43.29, west: -43.30 },
        { row: 0, col: 1, north: -22.90, south: -22.91, east: -43.28, west: -43.29 },
    ];

    it('gera um GroundOverlay por tile, na ordem recebida', () => {
        const kml = make()._generateKml(tiles);
        const overlays = kml.match(/<GroundOverlay>/g);
        expect(overlays).toHaveLength(tiles.length);
        expect(kml.indexOf('tile_0_0')).toBeLessThan(kml.indexOf('tile_0_1'));
    });

    it('o href aponta para files/tile_<linha>_<coluna>.jpg', () => {
        const kml = make()._generateKml(tiles);
        expect(kml).toContain('<href>files/tile_0_0.jpg</href>');
        expect(kml).toContain('<href>files/tile_0_1.jpg</href>');
    });

    it('a LatLonBox carrega os quatro limites do tile', () => {
        const kml = make()._generateKml([tiles[0]]);
        expect(kml).toContain('<north>-22.9</north>');
        expect(kml).toContain('<south>-22.91</south>');
        expect(kml).toContain('<east>-43.29</east>');
        expect(kml).toContain('<west>-43.3</west>');
    });

    it('lista vazia ainda produz um documento KML valido, sem overlay', () => {
        const kml = make()._generateKml([]);
        expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(kml).toContain('</kml>');
        expect(kml).not.toContain('<GroundOverlay>');
    });

    it('os tiles reais da grade viram KML sem campo indefinido', () => {
        const grid = make()._calculateTileGrid({ west: -43.30, east: -43.22, south: -22.94, north: -22.90 });
        expect(grid.tiles.length).toBeGreaterThan(1);
        const kml = make()._generateKml(grid.tiles);
        expect(kml.match(/<GroundOverlay>/g)).toHaveLength(grid.tiles.length);
        expect(kml).not.toContain('undefined');
        expect(kml).not.toContain('NaN');
    });
});
