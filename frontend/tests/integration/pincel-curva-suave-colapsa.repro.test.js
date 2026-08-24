// Path: tests/integration/pincel-curva-suave-colapsa.repro.test.js

/**
 * @fileoverview Regression test for `simplifyLine` throwing away the shape of a
 * brush stroke instead of simplifying it.
 *
 * ROOT CAUSE. The deviation of a candidate point was measured against the chord of
 * its two ORIGINAL neighbours (`points[i - 1]`, `points[i + 1]`), a chord that
 * slides along with the candidate. On any smooth curve every point is locally
 * straight by that measure, so every point was dropped and the stroke collapsed to
 * [first, last] however far it bowed away from that final chord. This is
 * Reumann-Witkam without carrying the last KEPT point, which is the whole of the
 * algorithm.
 *
 * FIX (2026-08-24). The anchor is the last point actually kept, so the chord grows
 * until the accumulated deviation crosses the tolerance.
 *
 * WHAT THIS DRIVES. `AddBrushGeometry.simplifyLine` on strokes shaped like the ones
 * the control produces (a point every 3 px of drag, converted here at zoom 15), and
 * it measures the ERROR of the output against the input, which is what "simplify"
 * has to bound. The `@tools` barrel is mocked because it drags MapLibre in.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddBrushGeometry } = await import('../../src/js/draw_tools/brush_tool/add_brush_geometry.js');

const geom = new AddBrushGeometry();

/** Degrees covered by 3 px (the control's MIN_DISTANCE_PX) at zoom 15. */
const STEP = (3 * 360) / 2 ** 23;

/** Largest distance from any original point to the simplified polyline. */
function worstError(points, simplified) {
    let worst = 0;
    for (const p of points) {
        let best = Infinity;
        for (let i = 0; i < simplified.length - 1; i++) {
            best = Math.min(best, geom.calculatePointLineDistance(p, simplified[i], simplified[i + 1]));
        }
        worst = Math.max(worst, best);
    }
    return worst;
}

/** A gentle arc, the shape a wrist makes: 400 samples, radius 200 steps. */
function gentleArc() {
    const radius = 200 * STEP;
    return Array.from({ length: 400 }, (_, i) => {
        const t = (i * STEP) / radius;
        return [radius * Math.sin(t), radius * (1 - Math.cos(t))];
    });
}

describe('repro: o pincel colapsava uma curva suave em dois pontos', () => {
    it('controle: a curva realmente se afasta da corda [primeiro, ultimo]', () => {
        const stroke = gentleArc();
        const chordDistance = geom.calculatePointLineDistance(stroke[200], stroke[0], stroke[399]);
        expect(stroke).toHaveLength(400);
        // Two orders of magnitude past the default tolerance: dropping the middle
        // is loss of shape, not simplification.
        expect(chordDistance).toBeGreaterThan(100 * 0.00001);
    });

    // MEASURED, and worth knowing before someone reads the tolerance as a bound:
    // Reumann-Witkam does NOT guarantee it globally. It bounds the deviation from
    // the chord [anchor, next], and the error against the emitted polyline lands
    // higher (8.2e-5 here, tolerance 1e-5). What the fix buys is two orders of
    // magnitude: the old collapse to [first, last] left 1.18e-2, about 1,3 km.
    // Douglas-Peucker is the algorithm that bounds the output error, and swapping
    // to it is a different decision from this one.
    it('a curva suave sobrevive, e o erro cai duas ordens de grandeza', () => {
        const stroke = gentleArc();
        const out = geom.simplifyLine(stroke, 0.00001);

        expect(out.length).toBeGreaterThan(2);
        expect(out.length).toBeLessThan(stroke.length);
        expect(out[0]).toBe(stroke[0]);
        expect(out[out.length - 1]).toBe(stroke[399]);
        expect(worstError(stroke, out)).toBeLessThan(0.0001);
        // Control: the old behaviour, [first, last], is what this beats.
        expect(worstError(stroke, [stroke[0], stroke[399]])).toBeGreaterThan(0.01);
    });

    it('a reta continua colapsando em duas pontas: a correcao nao desliga a simplificacao', () => {
        const straight = Array.from({ length: 400 }, (_, i) => [i * STEP, 0]);
        expect(geom.simplifyLine(straight, 0.00001)).toEqual([[0, 0], [399 * STEP, 0]]);
    });

    it('traco de mao livre encolhe e o erro fica na ordem da tolerancia', () => {
        // Deterministic pseudo-noise: a flake here would be a stroke nobody can
        // reproduce, and the constitution asks for the losing interleaving to be
        // made deterministic rather than sampled.
        let seed = 42;
        const noise = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648 - 0.5;
        };
        const stroke = Array.from({ length: 400 }, (_, i) => [
            i * STEP + noise() * STEP * 0.3,
            Math.sin(i / 25) * 40 * STEP + noise() * STEP * 0.3,
        ]);

        const out = geom.simplifyLine(stroke, 0.00001);
        expect(out.length).toBeLessThan(stroke.length);
        expect(worstError(stroke, out)).toBeLessThan(0.00002);
    });
});
