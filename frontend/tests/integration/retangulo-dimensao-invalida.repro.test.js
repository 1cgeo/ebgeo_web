// Path: tests/integration/retangulo-dimensao-invalida.repro.test.js

/**
 * @fileoverview Repro for the two ways a rectangle could end up with properties that do not
 * describe the shape on screen.
 *
 * DEFECT 14 (non-finite dimension survives the minimum-size guard). `updateFromHandle` and
 * `calculatePreview` both guard with `if (width < 10 || height < 10) return null`. EVERY
 * comparison against NaN is false, so a NaN dimension walked straight past it and the method
 * returned a NON-NULL result whose `width` was NaN and whose polygon had four NaN vertices:
 * the feature disappears from the map, and the caller has no way to tell it apart from a
 * successful edit. `undefined` (a stored dimension that was never written) took the same
 * path. Fix: `Number.isFinite` FIRST, then the size threshold.
 *
 * DEFECT 16 (sync destroys a rotated rectangle). `synchronizePropertiesWithGeometry` derived
 * width and height from `extractCornersFromGeometry`, which returns the AXIS-ALIGNED bounding
 * box of the ring. For a 4000 x 1000 rectangle at bearing 45 the AABB side is ~3535 m on both
 * axes, so the properties came back as a near-square while `bearing` stayed at 45. Nothing
 * threw and nothing warned; re-deriving the geometry from those properties would have redrawn
 * the feature at the wrong size and shape. Fix: a rotated feature with stored centre, width
 * and height keeps them, and only its corner pair is refreshed; an unrotated one, whose AABB
 * genuinely IS the rectangle, keeps the old path.
 *
 * The turf stub below is an EXACT flat plane, so `destination` and (`distance`, `bearing`)
 * are perfect inverses. That is what makes the round-trip assertion in the last test mean
 * something: it measures the source's own bookkeeping, not geodesy.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('@tools', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});
vi.mock('../../src/js/tool_manager/index.js', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

const { default: AddRectangleGeometry } = await import(
    '../../src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js'
);

const KM_PER_DEG = 111.32;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

beforeAll(() => {
    globalThis.turf = {
        destination(origin, distanceKm, bearingDeg) {
            const rad = bearingDeg * D2R;
            return {
                geometry: {
                    coordinates: [
                        origin[0] + (distanceKm * Math.sin(rad)) / KM_PER_DEG,
                        origin[1] + (distanceKm * Math.cos(rad)) / KM_PER_DEG,
                    ],
                },
            };
        },
        distance(a, b) {
            const east = (b[0] - a[0]) * KM_PER_DEG;
            const north = (b[1] - a[1]) * KM_PER_DEG;
            return Math.sqrt(east * east + north * north);
        },
        bearing(a, b) {
            const east = (b[0] - a[0]) * KM_PER_DEG;
            const north = (b[1] - a[1]) * KM_PER_DEG;
            return Math.atan2(east, north) * R2D;
        },
    };
});

afterAll(() => { delete globalThis.turf; });

let geom;
beforeEach(() => { geom = new AddRectangleGeometry(); });

/** Silences the module's console noise for one call and returns the result. */
function quiet(fn) {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { return fn(); } finally { err.mockRestore(); warn.mockRestore(); }
}

/** @param {object} [overrides] @returns {object} a rectangle feature ready to edit */
function rectFeature(overrides = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[]] },
        properties: { center: [0, 0], width: 2000, height: 1000, bearing: 0, ...overrides },
    };
}

describe('REPRO: uma dimensao NAO-FINITA atravessava a guarda de tamanho minimo', () => {
    it('updateFromHandle e calculatePreview recusam NaN, Infinity e undefined', () => {
        const casos = [
            ['width-resize', [NaN, NaN], {}],
            ['height-resize', [NaN, NaN], {}],
            ['rotation', [0.01, 0.01], { height: undefined }],
            ['rotation', [0.01, 0.01], { width: Infinity }],
            ['rotation', [0.01, 0.01], { height: -Infinity }],
        ];
        expect(casos).toHaveLength(5);
        for (const [handle, pos, props] of casos) {
            const rotulo = `${handle} ${JSON.stringify(props)}`;
            expect(quiet(() => geom.updateFromHandle(handle, pos, rectFeature(props))), rotulo)
                .toBeNull();
            expect(quiet(() => geom.calculatePreview(handle, pos, rectFeature(props))), rotulo)
                .toBeNull();
        }
    });

    it('CONTROLE: um arrasto legitimo continua produzindo geometria FINITA', () => {
        const pos = globalThis.turf.destination([0, 0], 1.5, 0).geometry.coordinates;
        const out = geom.updateFromHandle('width-resize', pos, rectFeature());
        expect(out).not.toBeNull();
        expect(Number.isFinite(out.width)).toBe(true);
        for (const [lng, lat] of out.geometry.coordinates[0]) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(Number.isFinite(lat)).toBe(true);
        }
        // ...and the size threshold itself still bites, so the new guard did not replace it.
        const minusculo = globalThis.turf.destination([0, 0], 0.001, 0).geometry.coordinates;
        expect(quiet(() => geom.updateFromHandle('width-resize', minusculo, rectFeature())))
            .toBeNull();
    });
});

describe('REPRO: sincronizar um retangulo ROTACIONADO reescrevia o tamanho dele', () => {
    it('as propriedades sincronizadas ainda redesenham o MESMO anel', () => {
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 4000, 1000, 0, 45)
            .coordinates[0];
        const out = geom.synchronizePropertiesWithGeometry({
            geometry: { coordinates: [ring] },
            properties: { center: [0, 0], width: 4000, height: 1000, bearing: 45, nome: 'R1' },
        });

        expect(out.properties.width).toBe(4000);
        expect(out.properties.height).toBe(1000);
        expect(out.properties.bearing).toBe(45);
        expect(out.properties.nome).toBe('R1');

        // The property the AABB rewrite destroyed: geometry re-derived from the synced
        // properties reproduces the ring it came from, vertex by vertex.
        const redraw = geom.generateRotatedRectangleGeometry(
            out.properties.center, out.properties.width, out.properties.height, 0,
            out.properties.bearing
        );
        expect(redraw.coordinates[0]).toHaveLength(ring.length);
        expect(ring.length).toBe(5);
        for (let i = 0; i < ring.length; i += 1) {
            expect(redraw.coordinates[0][i][0], `lng ${i}`).toBeCloseTo(ring[i][0], 9);
            expect(redraw.coordinates[0][i][1], `lat ${i}`).toBeCloseTo(ring[i][1], 9);
        }
    });

    it('CONTROLE: um retangulo SEM rotacao continua sendo derivado da geometria', () => {
        // The AABB path is not dead: for an unrotated ring the bounding box IS the rectangle,
        // and the properties must still follow a geometry edited elsewhere.
        const out = geom.synchronizePropertiesWithGeometry({
            geometry: { coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] },
            properties: { center: [9, 9], width: 999999, height: 999999, bearing: 0 },
        });
        expect(out.properties.corner1).toEqual([0, 0]);
        expect(out.properties.corner2).toEqual([0.01, 0.01]);
        expect(out.properties.width).toBeLessThan(2000);
        expect(out.properties.center).toEqual([0.005, 0.005]);
    });

    it('nao muta a feicao de entrada em nenhum dos dois caminhos', () => {
        const rotacionada = {
            geometry: { coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            properties: { center: [0, 0], width: 4000, height: 1000, bearing: 45 },
        };
        geom.synchronizePropertiesWithGeometry(rotacionada);
        expect(rotacionada.properties.corner1).toBeUndefined();

        const alinhada = {
            geometry: { coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            properties: { width: 42 },
        };
        geom.synchronizePropertiesWithGeometry(alinhada);
        expect(alinhada.properties.width).toBe(42);
        expect(alinhada.properties.corner1).toBeUndefined();
    });
});
