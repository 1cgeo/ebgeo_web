// Path: tests/integration/rotacao-de-texto-negativa.repro.test.js

/**
 * @fileoverview Regression test for the text rotation handle writing NEGATIVE
 * rotations into the feature.
 *
 * ROOT CAUSE. `calculateRotationFromHandle` reads the handle direction with
 * `turf.bearing`, whose contract is [-180, 180], and turns it into a rotation with
 * `rotation = bearing - 270`. That expression lands in [-450, -90] for the whole
 * turf range, so it is ALWAYS negative, and the wrap that followed was a single
 * `if (rotation < 0) rotation += 360`. One addition cannot lift a number that may
 * be two turns short: the output lived in [-90, 270] instead of [0, 360). Dragging
 * the handle through the last quadrant (a text rotated 271 to 359 degrees) stored
 * -89 to -1, and no rotation in [271, 359] was reachable at all.
 *
 * FIX (2026-08-24). Modulo instead of a single addition, plus a final `% 360` so
 * that rounding 359.5 or more cannot reintroduce 360.
 *
 * WHAT THIS DRIVES. The production pair, in the order the tool uses it: the app
 * draws the handle with `calculateRotationHandlePosition` and reads the drag back
 * with `updateFromHandle` -> `calculateRotationFromHandle`. `turf` is a vendored
 * global in the app; the stub here is the standard great-circle bearing, which is
 * the CONTRACT the production code was written against, not a copy of the code
 * under test. `measureTextSize` needs a canvas, so it is replaced by a fixed box.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const { default: AddTextGeometry } = await import('../../src/js/draw_tools/text_tool/add_text_geometry.js');

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle initial bearing in [-180, 180]: the contract of turf.bearing. */
function sphericalBearing([lng1, lat1], [lng2, lat2]) {
    const dLng = toRad(lng2 - lng1);
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const y = Math.sin(dLng) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
    return toDeg(Math.atan2(y, x));
}

const geom = new AddTextGeometry();
geom.measureTextSize = () => ({ width: 100, height: 20 });

/** Text feature at the given position, rotated by `rotation` degrees. */
const textFeature = (lng, lat, rotation) => ({
    geometry: { coordinates: [lng, lat] },
    properties: { id: 'f1', text: 'ordem', size: 16, rotation, createdAtZoom: 12 },
});

beforeAll(() => { globalThis.turf = { bearing: sphericalBearing }; });
afterAll(() => { delete globalThis.turf; });

describe('repro: a alca de rotacao do texto gravava rotacao negativa', () => {
    // The user drags the handle to where the tool itself would have drawn it for a
    // given rotation, and the tool must read back the same rotation.
    const roundTrip = (lng, lat, rotation) => {
        const feature = textFeature(lng, lat, rotation);
        const handle = geom.calculateRotationHandlePosition(feature, 12);
        return geom.updateFromHandle('rotation', handle, feature).rotation;
    };

    it('controle: a alca e desenhada em direcoes diferentes para rotacoes diferentes', () => {
        const at0 = geom.calculateRotationHandlePosition(textFeature(0, 0, 0), 12);
        const at90 = geom.calculateRotationHandlePosition(textFeature(0, 0, 90), 12);
        const at300 = geom.calculateRotationHandlePosition(textFeature(0, 0, 300), 12);
        expect(at0).not.toEqual(at90);
        expect(at0).not.toEqual(at300);
        expect(at90).not.toEqual(at300);
    });

    it('o ultimo quadrante volta como 271..359, nunca como numero negativo', () => {
        for (let rotation = 271; rotation <= 359; rotation++) {
            const out = roundTrip(0, 0, rotation);
            expect(out).toBe(rotation);
        }
    });

    it('os 360 graus fecham o round-trip no equador, e nenhum sai da faixa [0, 360)', () => {
        const seen = new Set();
        for (let rotation = 0; rotation < 360; rotation++) {
            const out = roundTrip(0, 0, rotation);
            expect(out).toBeGreaterThanOrEqual(0);
            expect(out).toBeLessThan(360);
            expect(out).toBe(rotation);
            seen.add(out);
        }
        expect(seen.size).toBe(360);
    });

    // Longe do equador o desenho da alca e PLANO (dx/dy em grau) e a leitura e
    // geodesica, entao sobra um erro de ate 2 graus. Ele e anterior a esta correcao
    // e nao e o assunto dela; o que a correcao garante e a FAIXA.
    it('fora do equador a faixa continua valida, com folga de 2 graus no round-trip', () => {
        for (let rotation = 0; rotation < 360; rotation += 1) {
            const out = roundTrip(-44.5, -22.9, rotation);
            expect(out).toBeGreaterThanOrEqual(0);
            expect(out).toBeLessThan(360);
            const drift = Math.min(Math.abs(out - rotation), 360 - Math.abs(out - rotation));
            expect(drift).toBeLessThanOrEqual(2);
        }
    });
});
