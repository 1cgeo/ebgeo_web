// Path: tests/unit/circle-create-handles.test.js
/**
 * @fileoverview Covers the one symbol the backlog leaves open in the circle tool:
 * `createHandles` of `frontend/src/js/draw_tools/circle_tool/add_circle_geometry.js`
 * ("só o que tests/unit/circle-geometry.test.js não pegou"). Everything else in that
 * file (validate, generateCircleGeometry, getBoundingBox, updateFromHandle,
 * calculatePreview, normalizeCenter, isValidCenter) is already pinned there; this
 * suite deliberately does not duplicate any of it.
 *
 * WHAT THIS SUITE PINS
 * - The RETURN SHAPE, which is the odd one in the tool family: a single Feature
 *   object, not an array of them (rectangle/ellipse/line all return arrays).
 * - The handle placement: due east of the centre, at radius metres converted with
 *   the flat 111320 m/deg constant and divided by cos(lat).
 * - The null path when the centre cannot be normalised.
 * - The three ways a caller can get a NaN handle without any error: a missing
 *   radius, a non-finite radius, and a centre at the pole.
 *
 * WHAT THIS SUITE DOES NOT REACH
 * - No turf and no MapLibre are involved; `createHandles` is pure arithmetic plus
 *   an object literal. `BaseGeometry` is mocked away (the `@tools` barrel drags
 *   DOM-coupled modules in), and `calculateDistance` is never called on this path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
    },
}));
vi.mock('../../src/js/tool_manager/index.js', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
    },
}));

const { default: AddCircleGeometry } = await import(
    '../../src/js/draw_tools/circle_tool/add_circle_geometry.js'
);

// The flat metres-per-degree constant the source uses.
const M_PER_DEG = 111320;

let geom;
beforeEach(() => {
    geom = new AddCircleGeometry();
});

function circleFeature(overrides = {}) {
    return { properties: { id: 'c1', center: [0, 0], radius: 1000, ...overrides } };
}

function quiet(fn) {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        return fn();
    } finally {
        err.mockRestore();
    }
}

describe('AddCircleGeometry.createHandles', () => {
    it('returns ONE Feature object, not an array', () => {
        // The rest of the tool family returns arrays from their handle builders;
        // any call site that spreads or iterates this one gets nothing.
        const handle = geom.createHandles(circleFeature());
        expect(Array.isArray(handle)).toBe(false);
        expect(handle.type).toBe('Feature');
        expect(handle.geometry.type).toBe('Point');
    });

    it('carries the id and the handle metadata the editor dispatches on', () => {
        const handle = geom.createHandles(circleFeature());
        expect(handle.id).toBe('circle-handle-c1-radius');
        expect(handle.properties).toEqual({
            role: 'handle',
            handleType: 'radius',
            handleId: 'radius-main',
            featureId: 'c1',
            mode: 'circle_editing',
            meta: 'vertex',
            user_isEditingHandle: true,
        });
    });

    it('places the handle due EAST of the centre, at the radius', () => {
        const handle = geom.createHandles(circleFeature({ center: [10, 0], radius: 1000 }));
        const [lng, lat] = handle.geometry.coordinates;
        expect(lat).toBe(0);
        expect(lng - 10).toBeCloseTo(1000 / M_PER_DEG, 12);
        expect(lng).toBeGreaterThan(10);
    });

    it('applies the cos(lat) correction, so the offset grows away from the equator', () => {
        const atEquator = geom.createHandles(circleFeature({ center: [0, 0] }));
        const atSixty = geom.createHandles(circleFeature({ center: [0, 60] }));
        const spanEq = atEquator.geometry.coordinates[0];
        const span60 = atSixty.geometry.coordinates[0];
        expect(span60 / spanEq).toBeCloseTo(1 / Math.cos(60 * Math.PI / 180), 9);
        // The latitude is untouched: the handle stays on the centre's parallel.
        expect(atSixty.geometry.coordinates[1]).toBe(60);
    });

    it('property: the offset is linear in the radius at any fixed latitude', () => {
        fc.assert(fc.property(
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: 1, max: 100000, noNaN: true }),
            (lat, radius) => {
                const one = geom.createHandles(circleFeature({ center: [0, lat], radius }));
                const two = geom.createHandles(circleFeature({ center: [0, lat], radius: radius * 2 }));
                expect(two.geometry.coordinates[0]).toBeCloseTo(one.geometry.coordinates[0] * 2, 9);
            }
        ));
    });

    it('accepts a JSON-string centre, through normalizeCenter', () => {
        const handle = geom.createHandles(circleFeature({ center: '[5,5]' }));
        expect(handle.geometry.coordinates[1]).toBe(5);
    });

    it('returns null when the centre cannot be normalised', () => {
        expect(quiet(() => geom.createHandles(circleFeature({ center: null })))).toBeNull();
        expect(quiet(() => geom.createHandles(circleFeature({ center: '5' })))).toBeNull();
        expect(quiet(() => geom.createHandles(circleFeature({ center: [0] })))).toBeNull();
    });

    it('CONTROLE: the happy path is reachable, so the null cases above mean something', () => {
        expect(geom.createHandles(circleFeature())).not.toBeNull();
    });

    it('OBSERVADO: a missing or non-finite radius yields a NaN handle, with no error', () => {
        // `radius / 111320` is never guarded, so the handle lands nowhere and the
        // editor gets a Point it cannot draw.
        for (const radius of [undefined, NaN, Infinity, -Infinity, 'abc']) {
            const handle = geom.createHandles(circleFeature({ radius }));
            expect(handle, `radius ${radius}`).not.toBeNull();
            const lng = handle.geometry.coordinates[0];
            expect(Number.isFinite(lng), `radius ${radius} produces a finite lng`).toBe(false);
        }
    });

    it('OBSERVADO: null radius is the odd one out — it becomes 0, not NaN', () => {
        // `null / 111320` is 0, so the handle collapses onto the centre instead of
        // going NaN like the other three.
        const handle = geom.createHandles(circleFeature({ radius: null }));
        expect(handle.geometry.coordinates[0]).toBe(0);
    });

    it('OBSERVADO: at the pole cos(lat) is 6.1e-17, so the handle flies off but stays finite', () => {
        const handle = geom.createHandles(circleFeature({ center: [0, 90] }));
        const lng = handle.geometry.coordinates[0];
        expect(Number.isFinite(lng)).toBe(true);
        expect(lng).toBeGreaterThan(1e14);
    });

    it('OBSERVADO: a missing feature id is interpolated as the literal "undefined"', () => {
        const handle = geom.createHandles(circleFeature({ id: undefined }));
        expect(handle.id).toBe('circle-handle-undefined-radius');
        expect(handle.properties.featureId).toBeUndefined();
    });
});
