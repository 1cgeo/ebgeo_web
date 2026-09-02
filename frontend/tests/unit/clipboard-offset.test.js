// Path: tests/unit/clipboard-offset.test.js
// ONDE UM "Colar Aqui" CAI, e as duas formas de errar isso sem que nada avise.
//
// A PRIMEIRA é o antimeridiano. O caminho ingênuo (`(min + max) / 2` sobre as longitudes)
// transforma um conjunto copiado em cima da linha de data no centro do MUNDO INTEIRO,
// espelhado: 179.9 e -179.9 viram centro ZERO, do outro lado do planeta, e a colagem
// aterrissa na África. O teste que prova isso tem de afirmar o valor ABSOLUTO (≈ ±180), não
// que "é diferente do anterior": um centro em zero é um número perfeitamente bem-formado.
//
// A SEGUNDA é o `_temporalHome`, e é a que não se descobre olhando a tela. `cleanFeature`
// (`store/repository.utils.js`) reescreve a geometria de um Point A PARTIR do `_temporalHome`
// na entrada do repositório. Copiar durante o playback e colar em outro lugar produzia, sem
// erro nenhum, uma cópia por cima da original: a geometria transladada era descartada na
// persistência e o toast de sucesso continuava aparecendo.
//
// O ALCANCE DESTE ARQUIVO É A ARITMÉTICA, nunca a fiação. Que `paste()` de fato CHAME estas
// três funções é assunto de `colar-nao-anuncia-sucesso-recusado.repro.test.js` e do
// Playwright; um verde aqui com o chamador errado continua verde.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    pasteAnchor,
    offsetToTarget,
    translatePositionProperties,
} from '../../src/js/tool_manager/clipboard-offset.js';

/** Feature shell carrying only what these functions read. */
const feat = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const point = (lng, lat) => feat({ type: 'Point', coordinates: [lng, lat] });

// ============================================================================
// pasteAnchor
// ============================================================================

describe('pasteAnchor', () => {
    it('a single point IS its own anchor', () => {
        expect(pasteAnchor([point(-43.2, -22.9)])).toEqual([-43.2, -22.9]);
    });

    it('a rectangle anchors on the centre of its bounding box', () => {
        const rect = feat({
            type: 'Polygon',
            coordinates: [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
        });
        expect(pasteAnchor([rect])).toEqual([5, 10]);
    });

    it('several features anchor on the UNION of their boxes, not on the first', () => {
        const anchor = pasteAnchor([point(0, 0), point(10, 20), point(-10, -20)]);
        expect(anchor).toEqual([0, 0]);

        // Control: drop the third and the answer MUST move, or the union is not being read.
        expect(pasteAnchor([point(0, 0), point(10, 20)])).toEqual([5, 10]);
    });

    it('descends into every nesting depth (MultiPolygon with a hole)', () => {
        const multi = feat({
            type: 'MultiPolygon',
            coordinates: [
                [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
                [[[6, 6], [10, 6], [10, 10], [6, 10], [6, 6]]],
            ],
        });
        expect(pasteAnchor([multi])).toEqual([5, 5]);
    });

    it('ANTIMERIDIAN: 179.9 and -179.9 anchor at ±180, never at 0', () => {
        const anchor = pasteAnchor([point(179.9, 10), point(-179.9, 10)]);
        // The span is [179.9, 180.1]; its centre 180 wraps to -180, which is the SAME
        // meridian. Zero would be the far side of the planet.
        expect(Math.abs(anchor[0])).toBeCloseTo(180, 9);
        expect(anchor[1]).toBeCloseTo(10, 9);
    });

    it('an empty set has no anchor', () => {
        expect(pasteAnchor([])).toBeNull();
        expect(pasteAnchor(null)).toBeNull();
        expect(pasteAnchor(undefined)).toBeNull();
    });

    it('a feature with no usable geometry is SKIPPED, and one good feature still decides', () => {
        const anchor = pasteAnchor([
            feat(null),
            feat({ type: 'Point' }),
            feat({ type: 'Ponto Inventado', coordinates: [999, 999] }),
            point(7, 8),
        ]);
        expect(anchor).toEqual([7, 8]);
    });

    it('a set whose coordinates are ALL non-finite has no anchor (never NaN)', () => {
        const anchor = pasteAnchor([
            point(NaN, 0),
            point(0, Infinity),
            feat({ type: 'LineString', coordinates: [['a', 'b'], [null, null]] }),
        ]);
        expect(anchor).toBeNull();
    });

    it('mixes finite and non-finite positions of the SAME feature, keeping the finite ones', () => {
        const line = feat({
            type: 'LineString',
            coordinates: [[0, 0], [NaN, 5], [10, 10]],
        });
        expect(pasteAnchor([line])).toEqual([5, 5]);
    });
});

// ============================================================================
// offsetToTarget
// ============================================================================

describe('offsetToTarget', () => {
    it('measures from the anchor to the target', () => {
        expect(offsetToTarget([10, 20], { lng: 15, lat: 25 })).toEqual({ dx: 5, dy: 5 });
    });

    it('accepts the target as a pair as well as {lng, lat}', () => {
        expect(offsetToTarget([10, 20], [15, 25])).toEqual({ dx: 5, dy: 5 });
    });

    it('an anchor equal to the target is a zero offset', () => {
        expect(offsetToTarget([-43.2, -22.9], { lng: -43.2, lat: -22.9 })).toEqual({ dx: 0, dy: 0 });
    });

    it('ANTIMERIDIAN: 179.9 to -179.9 travels +0.2 east, not -359.8 west', () => {
        const offset = offsetToTarget([179.9, 0], { lng: -179.9, lat: 0 });
        expect(offset.dx).toBeCloseTo(0.2, 9);
        expect(offset.dy).toBe(0);
    });

    it('exactly opposite meridians resolve to -180 (the wrap convention, not 0 and not +180)', () => {
        expect(offsetToTarget([0, 0], { lng: 180, lat: 0 }).dx).toBe(-180);
    });

    it('refuses a missing or non-finite half rather than producing NaN', () => {
        expect(offsetToTarget(null, { lng: 1, lat: 2 })).toBeNull();
        expect(offsetToTarget([1, 2], null)).toBeNull();
        expect(offsetToTarget([1, 2], { lng: NaN, lat: 2 })).toBeNull();
        expect(offsetToTarget([1, 2], { lng: 1, lat: undefined })).toBeNull();
        expect(offsetToTarget([NaN, 2], { lng: 1, lat: 2 })).toBeNull();
    });
});

// ============================================================================
// translatePositionProperties
// ============================================================================

describe('translatePositionProperties', () => {
    it('a feature with no position-bearing property yields an EMPTY patch', () => {
        expect(translatePositionProperties({ nome: 'Ponto', cor: '#fff' }, 5, 5)).toEqual({});
        expect(translatePositionProperties(null, 5, 5)).toEqual({});
        expect(translatePositionProperties(undefined, 5, 5)).toEqual({});
    });

    it('moves every trajectory keypoint and keeps its `t` (and any other field)', () => {
        const patch = translatePositionProperties({
            trajetoria: [
                { t: 1000, lng: 0, lat: 0 },
                { t: 2000, lng: 1, lat: 1 },
                { t: 3000, lng: 2, lat: 2, rotulo: 'chegada' },
            ],
        }, 5, -5);

        expect(patch.trajetoria).toEqual([
            { t: 1000, lng: 5, lat: -5 },
            { t: 2000, lng: 6, lat: -4 },
            { t: 3000, lng: 7, lat: -3, rotulo: 'chegada' },
        ]);
    });

    it('moves `_temporalHome`, which is what stops the copy landing on the original', () => {
        const patch = translatePositionProperties({
            trajetoria: [{ t: 0, lng: 0, lat: 0 }],
            _temporalHome: [-43.2, -22.9],
        }, 1, 2);

        expect(patch._temporalHome).toEqual([-42.2, -20.9]);
    });

    it('moves `_temporalHome` even for a feature with NO trajectory', () => {
        // The persisted home is what `cleanFeature` reads; a feature can carry one while its
        // trajectory is momentarily absent, and losing the move there is the silent case.
        const patch = translatePositionProperties({ _temporalHome: [0, 0] }, 3, 4);
        expect(patch).toEqual({ _temporalHome: [3, 4] });
    });

    it('clamps the trajectory latitude to the pole instead of mirroring over it', () => {
        const patch = translatePositionProperties({
            trajetoria: [{ t: 0, lng: 0, lat: 80 }],
        }, 0, 30);
        expect(patch.trajetoria[0].lat).toBe(90);
    });

    it('ONE broken keypoint refuses the WHOLE trajectory, and the patch omits it', () => {
        const patch = translatePositionProperties({
            trajetoria: [
                { t: 0, lng: 0, lat: 0 },
                { t: 1, lng: 'oeste', lat: 0 },
            ],
            _temporalHome: [1, 1],
        }, 5, 5);

        // Half a route is worse than an unmoved one: the trajectory is left as it was...
        expect(patch.trajetoria).toBeUndefined();
        // ...and the home, which is independent, still travels.
        expect(patch._temporalHome).toEqual([6, 6]);
    });

    it('an empty trajectory is left out of the patch entirely', () => {
        expect(translatePositionProperties({ trajetoria: [] }, 1, 1)).toEqual({});
    });

    it('a non-finite offset degrades to "pasted in place", never to NaN coordinates', () => {
        const props = { trajetoria: [{ t: 0, lng: 0, lat: 0 }], _temporalHome: [0, 0] };
        expect(translatePositionProperties(props, NaN, 1)).toEqual({});
        expect(translatePositionProperties(props, 1, Infinity)).toEqual({});
    });

    it('never mutates the input properties', () => {
        const props = {
            trajetoria: [{ t: 0, lng: 0, lat: 0 }],
            _temporalHome: [0, 0],
        };
        translatePositionProperties(props, 10, 10);
        expect(props.trajetoria).toEqual([{ t: 0, lng: 0, lat: 0 }]);
        expect(props._temporalHome).toEqual([0, 0]);
    });
});

// ============================================================================
// INVARIANTS (fast-check)
// ============================================================================

describe('paste anchoring invariants', () => {
    const finiteLng = fc.double({ min: -179, max: 179, noNaN: true });
    const finiteLat = fc.double({ min: -85, max: 85, noNaN: true });

    it('ROUND-TRIP: moving a single point by its own offset lands it on the target', () => {
        // This is the property "Colar Aqui" exists to keep, and it holds MODULO 360, which is
        // not a weakening. The delta is the SHORTEST one, so an anchor at -179 sent to +179
        // travels -2 and the raw sum is -181: the same meridian, expressed unwrapped. The
        // tools add the delta raw and MapLibre draws an unwrapped longitude in the right
        // place, so asserting the raw sum would be asserting a normalization nobody performs.
        fc.assert(fc.property(finiteLng, finiteLat, finiteLng, finiteLat, (aLng, aLat, tLng, tLat) => {
            const anchor = pasteAnchor([point(aLng, aLat)]);
            const { dx, dy } = offsetToTarget(anchor, { lng: tLng, lat: tLat });

            const gap = Math.abs(((anchor[0] + dx - tLng) % 360 + 360) % 360);
            expect(Math.min(gap, 360 - gap)).toBeLessThan(1e-6);
            expect(anchor[1] + dy).toBeCloseTo(tLat, 6);
        }));
    });

    it('the anchor of any finite point set stays inside its own latitude range', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(finiteLng, finiteLat), { minLength: 1, maxLength: 20 }),
            (pairs) => {
                const anchor = pasteAnchor(pairs.map(([lng, lat]) => point(lng, lat)));
                const lats = pairs.map(([, lat]) => lat);
                expect(anchor[1]).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9);
                expect(anchor[1]).toBeLessThanOrEqual(Math.max(...lats) + 1e-9);
            },
        ));
    });

    it('the longitude delta is NEVER the long way round (|dx| <= 180)', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            (from, to) => {
                const { dx } = offsetToTarget([from, 0], { lng: to, lat: 0 });
                expect(Math.abs(dx)).toBeLessThanOrEqual(180);
            },
        ));
    });

    it('IDEMPOTENCE: a zero offset leaves every keypoint numerically where it was', () => {
        // NUMERICALLY, and not `toEqual`, because of `-0`: IEEE addition normalizes
        // `-0 + 0` to `+0`, so a keypoint authored at longitude -0 comes back at +0. That is
        // the same meridian and the same pixel; asserting object equality here would fail on
        // a sign that carries no geographic meaning, and "fix" it by removing the addition.
        fc.assert(fc.property(
            fc.array(fc.tuple(finiteLng, finiteLat, fc.integer()), { minLength: 1, maxLength: 10 }),
            (kps) => {
                const trajetoria = kps.map(([lng, lat, t]) => ({ t, lng, lat }));
                const patch = translatePositionProperties({ trajetoria }, 0, 0);

                expect(patch.trajetoria).toHaveLength(trajetoria.length);
                patch.trajetoria.forEach((kp, i) => {
                    expect(kp.t).toBe(trajetoria[i].t);
                    expect(kp.lng).toBeCloseTo(trajetoria[i].lng, 12);
                    expect(kp.lat).toBeCloseTo(trajetoria[i].lat, 12);
                });
            },
        ));
    });
});
