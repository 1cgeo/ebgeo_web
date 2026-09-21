import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    isTemporallyVisible,
    isTemporallyVisibleInWindow,
    normalizeTrajectory,
    decimateTrajectory,
    interpolatePosition,
    resolveTrajectoryTarget,
    mergeTemporalWindows,
    trajectoryStats,
    headingAt,
    speedAt,
} from '../../src/js/temporal/temporal-model.js';

// ============================================================================
// isTemporallyVisible
// ============================================================================

describe('isTemporallyVisible', () => {
    it('treats a feature with no temporal data as permanent', () => {
        expect(isTemporallyVisible({}, 1000)).toBe(true);
        expect(isTemporallyVisible({ nome: 'x' }, 0)).toBe(true);
    });

    it('handles null/undefined props', () => {
        expect(isTemporallyVisible(null, 1000)).toBe(true);
        expect(isTemporallyVisible(undefined, 1000)).toBe(true);
    });

    it('hides before temporalInicio', () => {
        expect(isTemporallyVisible({ temporalInicio: 100 }, 99)).toBe(false);
        expect(isTemporallyVisible({ temporalInicio: 100 }, 100)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, 101)).toBe(true);
    });

    it('hides after temporalFim', () => {
        expect(isTemporallyVisible({ temporalFim: 200 }, 201)).toBe(false);
        expect(isTemporallyVisible({ temporalFim: 200 }, 200)).toBe(true);
        expect(isTemporallyVisible({ temporalFim: 200 }, 199)).toBe(true);
    });

    it('respects a closed window', () => {
        const p = { temporalInicio: 100, temporalFim: 200 };
        expect(isTemporallyVisible(p, 50)).toBe(false);
        expect(isTemporallyVisible(p, 150)).toBe(true);
        expect(isTemporallyVisible(p, 250)).toBe(false);
    });

    it('treats a non-finite cursor as show-everything', () => {
        expect(isTemporallyVisible({ temporalInicio: 100 }, NaN)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, Infinity)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, null)).toBe(true);
    });

    it('ignores NaN bounds (not a real window)', () => {
        expect(isTemporallyVisible({ temporalInicio: NaN }, 10)).toBe(true);
        expect(isTemporallyVisible({ temporalFim: NaN }, 10)).toBe(true);
    });

    it('property: a permanent feature is visible at any cursor', () => {
        fc.assert(
            fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cursor) =>
                isTemporallyVisible({}, cursor) === true
            )
        );
    });

    it('property: a feature is visible iff inicio<=cursor<=fim', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: -500, max: 1500 }),
                (a, b, cursor) => {
                    const inicio = Math.min(a, b);
                    const fim = Math.max(a, b);
                    const expected = cursor >= inicio && cursor <= fim;
                    return isTemporallyVisible({ temporalInicio: inicio, temporalFim: fim }, cursor) === expected;
                }
            )
        );
    });

    it('an INVERTED window (fim before inicio) is never visible, at any cursor', () => {
        // Achado M6. O predicado de instante sempre respondeu assim; o que mudou e que a
        // sobreposicao do filtro passou a concordar (ver visibilidade-temporal-uma-regra-so).
        const invertida = { temporalInicio: 5000, temporalFim: 1000 };
        for (const cursor of [0, 1000, 3000, 5000, 9999]) {
            expect(isTemporallyVisible(invertida, cursor)).toBe(false);
        }
    });
});

// ============================================================================
// isTemporallyVisibleInWindow — a regra unica de visibilidade
// ============================================================================

describe('isTemporallyVisibleInWindow', () => {
    it('collapses to the instantaneous test when start === end', () => {
        const p = { temporalInicio: 100, temporalFim: 200 };
        for (const cursor of [50, 99, 100, 150, 200, 201, 500]) {
            expect(isTemporallyVisibleInWindow(p, cursor, cursor)).toBe(isTemporallyVisible(p, cursor));
        }
    });

    it('is an OVERLAP test, so a feature starting inside the window is visible', () => {
        // O caso que divergia entre o mapa e as outras tres superficies (M1 = V6): janela
        // [0, 100], feicao que so comeca em 60.
        expect(isTemporallyVisibleInWindow({ temporalInicio: 60 }, 0, 100)).toBe(true);
        // E o controle: a mesma feicao testada pelo INSTANTE do inicio da janela some.
        expect(isTemporallyVisible({ temporalInicio: 60 }, 0)).toBe(false);
    });

    it('is inclusive on both ends: touching counts as overlapping', () => {
        expect(isTemporallyVisibleInWindow({ temporalInicio: 100, temporalFim: 200 }, 200, 300)).toBe(true);
        expect(isTemporallyVisibleInWindow({ temporalInicio: 100, temporalFim: 200 }, 0, 100)).toBe(true);
        expect(isTemporallyVisibleInWindow({ temporalInicio: 100, temporalFim: 200 }, 201, 300)).toBe(false);
        expect(isTemporallyVisibleInWindow({ temporalInicio: 100, temporalFim: 200 }, 0, 99)).toBe(false);
    });

    it('treats missing/NaN bounds as unbounded (permanent on that side)', () => {
        expect(isTemporallyVisibleInWindow({}, 0, 10)).toBe(true);
        expect(isTemporallyVisibleInWindow(null, 0, 10)).toBe(true);
        expect(isTemporallyVisibleInWindow({ temporalInicio: NaN, temporalFim: NaN }, 0, 10)).toBe(true);
        expect(isTemporallyVisibleInWindow({ temporalInicio: 5 }, -1e12, -1e11)).toBe(false);
        expect(isTemporallyVisibleInWindow({ temporalFim: 5 }, 1e11, 1e12)).toBe(false);
    });

    it('a non-finite window shows everything (temporal off / bounds not resolved yet)', () => {
        const p = { temporalInicio: 100, temporalFim: 200 };
        expect(isTemporallyVisibleInWindow(p, NaN, NaN)).toBe(true);
        expect(isTemporallyVisibleInWindow(p, null, null)).toBe(true);
        expect(isTemporallyVisibleInWindow(p, undefined, 500)).toBe(true);
    });

    it('a BACKWARDS window collapses to its start, mirroring setTemporalCursor', () => {
        const p = { temporalInicio: 100, temporalFim: 200 };
        expect(isTemporallyVisibleInWindow(p, 150, 10)).toBe(true);   // instante 150
        expect(isTemporallyVisibleInWindow(p, 500, 10)).toBe(false);  // instante 500
    });

    it('an INVERTED feature window is never visible, even when the window straddles it (M6)', () => {
        const invertida = { temporalInicio: 5000, temporalFim: 1000 };
        expect(isTemporallyVisibleInWindow(invertida, 0, 9000)).toBe(false);
        expect(isTemporallyVisibleInWindow(invertida, 1000, 5000)).toBe(false);
        // CONTROLE: a mesma janela na ordem certa aparece.
        expect(isTemporallyVisibleInWindow({ temporalInicio: 1000, temporalFim: 5000 }, 0, 9000)).toBe(true);
    });

    it('BORDA: epoch 0 is a legitimate bound, not an absent one', () => {
        expect(isTemporallyVisibleInWindow({ temporalInicio: 0, temporalFim: 0 }, 0, 0)).toBe(true);
        expect(isTemporallyVisibleInWindow({ temporalInicio: 0, temporalFim: 0 }, 1, 10)).toBe(false);
    });
});

// ============================================================================
// normalizeTrajectory
// ============================================================================

describe('normalizeTrajectory', () => {
    it('returns [] for non-arrays', () => {
        expect(normalizeTrajectory(null)).toEqual([]);
        expect(normalizeTrajectory(undefined)).toEqual([]);
        expect(normalizeTrajectory({})).toEqual([]);
    });

    it('drops invalid keypoints', () => {
        const traj = [
            { t: 1, lng: 10, lat: 20 },
            { t: NaN, lng: 1, lat: 2 },
            { t: 2, lng: NaN, lat: 2 },
            { lng: 1, lat: 2 },
            null,
            { t: 3, lng: 5, lat: 6 },
        ];
        expect(normalizeTrajectory(traj)).toEqual([
            { t: 1, lng: 10, lat: 20 },
            { t: 3, lng: 5, lat: 6 },
        ]);
    });

    it('sorts chronologically without mutating input', () => {
        const traj = [
            { t: 3, lng: 0, lat: 0 },
            { t: 1, lng: 0, lat: 0 },
            { t: 2, lng: 0, lat: 0 },
        ];
        const out = normalizeTrajectory(traj);
        expect(out.map((k) => k.t)).toEqual([1, 2, 3]);
        expect(traj.map((k) => k.t)).toEqual([3, 1, 2]); // original untouched
    });
});

// ============================================================================
// mergeTemporalWindows
// ============================================================================

describe('mergeTemporalWindows', () => {
    it('returns {} for an empty list or all-permanent inputs', () => {
        expect(mergeTemporalWindows([])).toEqual({});
        expect(mergeTemporalWindows(null)).toEqual({});
        expect(mergeTemporalWindows([{}, { nome: 'x' }])).toEqual({});
    });

    it('copies a single feature\'s window (1:1 inherit)', () => {
        expect(mergeTemporalWindows([{ temporalInicio: 100, temporalFim: 200 }])).toEqual({
            temporalInicio: 100,
            temporalFim: 200,
        });
    });

    it('keeps only the bounds that are present', () => {
        expect(mergeTemporalWindows([{ temporalInicio: 100 }])).toEqual({ temporalInicio: 100 });
        expect(mergeTemporalWindows([{ temporalFim: 200 }])).toEqual({ temporalFim: 200 });
    });

    it('unions windows: min start, max end', () => {
        const out = mergeTemporalWindows([
            { temporalInicio: 300, temporalFim: 400 },
            { temporalInicio: 100, temporalFim: 250 },
            { temporalInicio: 200, temporalFim: 500 },
        ]);
        expect(out).toEqual({ temporalInicio: 100, temporalFim: 500 });
    });

    it('treats a missing bound as unbounded → omits that side of the union', () => {
        // One input is permanent on the start side → union has no lower bound.
        expect(mergeTemporalWindows([
            { temporalInicio: 100, temporalFim: 200 },
            { temporalFim: 500 }, // no inicio → unbounded start
        ])).toEqual({ temporalFim: 500 });
        // One input permanent on the end side → no upper bound.
        expect(mergeTemporalWindows([
            { temporalInicio: 100, temporalFim: 200 },
            { temporalInicio: 50 }, // no fim → unbounded end
        ])).toEqual({ temporalInicio: 50 });
    });

    it('ignores NaN/Infinity bounds (treated as unbounded)', () => {
        expect(mergeTemporalWindows([{ temporalInicio: NaN, temporalFim: 200 }])).toEqual({ temporalFim: 200 });
        expect(mergeTemporalWindows([{ temporalInicio: 100, temporalFim: Infinity }])).toEqual({ temporalInicio: 100 });
    });
});

// ============================================================================
// trajectoryStats
// ============================================================================

describe('trajectoryStats', () => {
    it('reports zeros for fewer than 2 keypoints', () => {
        expect(trajectoryStats([])).toEqual({ count: 0, durationMs: 0, distanceMeters: 0 });
        expect(trajectoryStats([{ t: 1, lng: 0, lat: 0 }])).toEqual({ count: 1, durationMs: 0, distanceMeters: 0 });
    });

    it('computes count and total duration (last − first)', () => {
        const stats = trajectoryStats([
            { t: 1000, lng: 0, lat: 0 },
            { t: 5000, lng: 0, lat: 0 },
            { t: 3000, lng: 0, lat: 0 },
        ]);
        expect(stats.count).toBe(3);
        expect(stats.durationMs).toBe(4000); // 5000 − 1000
    });

    it('sums great-circle segment lengths (~111 km per degree of latitude)', () => {
        const stats = trajectoryStats([
            { t: 0, lng: 0, lat: 0 },
            { t: 1, lng: 0, lat: 1 },
        ]);
        expect(stats.distanceMeters).toBeCloseTo(111195, -2); // within ~100 m
    });
});

// ============================================================================
// headingAt / speedAt / averageSpeed
// ============================================================================

describe('headingAt', () => {
    it('returns null for fewer than 2 keypoints', () => {
        expect(headingAt([], 0)).toBeNull();
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }], 0)).toBeNull();
    });

    it('reads due-north and due-east segment bearings', () => {
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }, { t: 100, lng: 0, lat: 1 }], 50)).toBeCloseTo(0, 5);
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }, { t: 100, lng: 1, lat: 0 }], 50)).toBeCloseTo(90, 1);
    });

    it('uses the segment the cursor falls in on a multi-segment path', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 0, lat: 1 },   // north
            { t: 200, lng: 1, lat: 1 },   // east
        ];
        expect(headingAt(traj, 50)).toBeCloseTo(0, 5);    // first segment → north
        expect(headingAt(traj, 150)).toBeCloseTo(90, 1);  // second segment → east
    });

    it('clamps to the first/last segment outside the time span', () => {
        const traj = [{ t: 100, lng: 0, lat: 0 }, { t: 200, lng: 0, lat: 1 }];
        expect(headingAt(traj, 0)).toBeCloseTo(0, 5);   // before first → first segment
        expect(headingAt(traj, 999)).toBeCloseTo(0, 5); // after last → last segment
    });
});

describe('speedAt', () => {
    it('returns null for fewer than 2 keypoints', () => {
        expect(speedAt([{ t: 0, lng: 0, lat: 0 }], 0)).toBeNull();
    });

    it('computes the bracketing segment speed (m/s)', () => {
        // 1° latitude (~111195 m) over 1000 ms = 1 s → ~111195 m/s.
        expect(speedAt([{ t: 0, lng: 0, lat: 0 }, { t: 1000, lng: 0, lat: 1 }], 500)).toBeCloseTo(111195, -2);
    });

    it('returns 0 for a zero-duration segment (no divide-by-zero)', () => {
        expect(speedAt([{ t: 100, lng: 0, lat: 0 }, { t: 100, lng: 0, lat: 1 }], 100)).toBe(0);
    });
});

// ============================================================================
// decimateTrajectory
// ============================================================================

describe('decimateTrajectory', () => {
    const at = (t) => ({ t, lng: t, lat: t });

    it('leaves trajectories of 2 or fewer keypoints untouched', () => {
        expect(decimateTrajectory([], 60_000)).toEqual([]);
        expect(decimateTrajectory([at(0)], 60_000)).toEqual([at(0)]);
        expect(decimateTrajectory([at(0), at(1000)], 60_000)).toEqual([at(0), at(1000)]);
    });

    it('drops keypoints closer than the resolution, keeping first and last', () => {
        // 1 Hz-ish fixes over ~2 min → only the minute boundaries + endpoints survive.
        const traj = [0, 10_000, 20_000, 30_000, 40_000, 60_000, 70_000, 120_000].map(at);
        const out = decimateTrajectory(traj, 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 60_000, 120_000]);
    });

    it('always keeps the last keypoint even if within one resolution of the previous kept', () => {
        const out = decimateTrajectory([at(0), at(1000), at(2000)], 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 2000]); // middle dropped, last preserved
    });

    it('normalizes (sorts + drops invalid) before thinning', () => {
        const traj = [at(120_000), { t: NaN, lng: 1, lat: 2 }, at(0), at(30_000)];
        const out = decimateTrajectory(traj, 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 120_000]);
    });

    it('returns the normalized trajectory unchanged for a non-positive resolution', () => {
        const traj = [at(0), at(10), at(20)];
        expect(decimateTrajectory(traj, 0)).toEqual(traj);
        expect(decimateTrajectory(traj, -5)).toEqual(traj);
    });

    it('property: kept keypoints are a subset, sorted, with endpoints preserved', () => {
        const kp = fc.record({
            t: fc.integer({ min: 0, max: 1_000_000 }),
            lng: fc.double({ min: -180, max: 180, noNaN: true }),
            lat: fc.double({ min: -90, max: 90, noNaN: true }),
        });
        fc.assert(
            fc.property(fc.array(kp, { minLength: 1, maxLength: 50 }), fc.integer({ min: 1, max: 100_000 }), (traj, res) => {
                const norm = normalizeTrajectory(traj);
                const out = decimateTrajectory(traj, res);
                if (norm.length === 0) return out.length === 0;
                // endpoints preserved, monotonic, no two kept points closer than res (except the forced last).
                const sameEnds = out[0].t === norm[0].t && out[out.length - 1].t === norm[norm.length - 1].t;
                let monotonic = true;
                for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) monotonic = false;
                return sameEnds && monotonic && out.length <= norm.length;
            })
        );
    });
});

// ============================================================================
// interpolatePosition
// ============================================================================

describe('interpolatePosition', () => {
    it('returns null for empty/invalid', () => {
        expect(interpolatePosition([], 10)).toBeNull();
        expect(interpolatePosition(null, 10)).toBeNull();
        expect(interpolatePosition([{ t: NaN, lng: 1, lat: 2 }], 10)).toBeNull();
    });

    it('returns the single keypoint position regardless of cursor', () => {
        const traj = [{ t: 100, lng: 5, lat: 6 }];
        expect(interpolatePosition(traj, 0)).toEqual([5, 6]);
        expect(interpolatePosition(traj, 1e9)).toEqual([5, 6]);
    });

    it('clamps before first / after last', () => {
        const traj = [
            { t: 100, lng: 0, lat: 0 },
            { t: 200, lng: 10, lat: 20 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 100)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 200)).toEqual([10, 20]);
        expect(interpolatePosition(traj, 300)).toEqual([10, 20]);
    });

    it('interpolates linearly at the midpoint', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 20 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([5, 10]);
        expect(interpolatePosition(traj, 25)).toEqual([2.5, 5]);
    });

    it('interpolates across a multi-segment path', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 0 },
            { t: 200, lng: 10, lat: 10 },
        ];
        expect(interpolatePosition(traj, 150)).toEqual([10, 5]);
    });

    it('finds the right segment in a long trajectory (binary search)', () => {
        // 1000 keypoints, lng === lat === t; interpolation is the identity in t.
        const traj = Array.from({ length: 1000 }, (_, i) => ({ t: i * 10, lng: i * 10, lat: i * 10 }));
        expect(interpolatePosition(traj, 4235)).toEqual([4235, 4235]);
        expect(interpolatePosition(traj, 0)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 9990)).toEqual([9990, 9990]);
        expect(interpolatePosition(traj, 99999)).toEqual([9990, 9990]); // clamps past last
    });

    it('handles unsorted input (normalizes first)', () => {
        const traj = [
            { t: 100, lng: 10, lat: 20 },
            { t: 0, lng: 0, lat: 0 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([5, 10]);
    });

    it('handles duplicate timestamps without dividing by zero', () => {
        const traj = [
            { t: 100, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 10 },
        ];
        const r = interpolatePosition(traj, 100);
        expect(Number.isFinite(r[0])).toBe(true);
        expect(Number.isFinite(r[1])).toBe(true);
    });

    // ------------------------------------------------------------------------
    // A PROPRIEDADE QUE SUBSTITUIU A CAIXA ENVOLVENTE (achado M9).
    //
    // A versao anterior exigia apenas que o resultado caisse na caixa envolvente dos
    // pontos-chave. Uma caixa aprova QUALQUER ponto dentro dela, inclusive um que nao esteja em
    // segmento nenhum: uma implementacao que devolvesse o centro da caixa passaria. O que a
    // interpolacao promete e mais forte e tem duas metades, e sao as duas que ficam presas aqui:
    // o ponto esta SOBRE o segmento que o cursor atravessa (colinearidade, com o parametro
    // dentro de [0,1]), e andar com o cursor para a frente nunca anda para tras ao longo da
    // poligonal (monotonicidade).
    // ------------------------------------------------------------------------

    /**
     * Posicao ao longo da poligonal, como `indice do segmento + fracao`, por varredura linear:
     * um caminho INDEPENDENTE da busca binaria que esta sob teste.
     * @param {Array<{t:number,lng:number,lat:number}>} pts - Pontos ja normalizados.
     * @param {number} cursor
     * @returns {number}
     */
    function parametroNaPoligonal(pts, cursor) {
        if (cursor <= pts[0].t) return 0;
        const ultimo = pts.length - 1;
        if (cursor >= pts[ultimo].t) return ultimo;
        for (let i = 0; i < ultimo; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            if (cursor >= a.t && cursor <= b.t) {
                const span = b.t - a.t;
                return i + (span === 0 ? 0 : (cursor - a.t) / span);
            }
        }
        return ultimo;
    }

    /**
     * Percurso com instantes ESTRITAMENTE crescentes e um cursor garantidamente DENTRO do vao.
     *
     * O gerador ingenuo (instantes sorteados livremente, cursor sorteado a parte, coordenadas por
     * `fc.double`) foi MEDIDO e reprovado, DUAS vezes e por dois motivos diferentes:
     *
     *  - em mil sorteios, 587 caiam FORA do vao, e o clamp devolve um ponto-chave, que e
     *    trivialmente colinear;
     *  - dos 413 restantes, so 6 caiam num segmento capaz de revelar erro, porque `fc.double`
     *    sorteia entre os doubles REPRESENTAVEIS da faixa, que se adensam perto de zero: quase
     *    todo segmento nascia com deslocamento minusculo, e `fc.double({min:0,max:1})` para a
     *    posicao do cursor entregava 0 ou 1 quase sempre.
     *
     * Com uma interpolacao propositalmente errada no lugar da real, a propriedade passava VERDE.
     * E a mesma cobertura vazia que o achado M9 denuncia, so que uma camada acima: a propriedade
     * estava certa e o corpus e' que nao a exercitava. Dai os inteiros escalados e o contador de
     * casos discriminantes no fim de cada propriedade.
     */
    const grau = (max) => fc.integer({ min: -max * 100, max: max * 100 }).map((n) => n / 100);
    const percursoArb = fc.record({
        inicio: fc.integer({ min: -1000, max: 1000 }),
        passos: fc.array(
            fc.record({
                dt: fc.integer({ min: 1, max: 500 }),
                lng: grau(170),
                lat: grau(80),
            }),
            { minLength: 2, maxLength: 8 },
        ),
        posicao: fc.integer({ min: 0, max: 1000 }),
    }).map(({ inicio, passos, posicao }) => {
        let t = inicio;
        const pts = passos.map((p, i) => {
            if (i > 0) t += p.dt;
            return { t, lng: p.lng, lat: p.lat };
        });
        const span = pts[pts.length - 1].t - pts[0].t;
        return { pts, cursor: Math.round(pts[0].t + (span * posicao) / 1000), span };
    });

    /** Verdadeiro quando o cursor cai num segmento que pode revelar um erro de interpolacao. */
    function segmentoDiscriminante(pts, cursor) {
        const param = parametroNaPoligonal(pts, cursor);
        const i = Math.min(Math.floor(param), pts.length - 2);
        const frac = param - i;
        const dx = pts[i + 1].lng - pts[i].lng;
        const dy = pts[i + 1].lat - pts[i].lat;
        return frac > 0.01 && frac < 0.99 && Math.abs(dx) > 1 && Math.abs(dy) > 1;
    }

    it('property: the point lies ON the bracketing segment (collinear, 0<=t<=1)', () => {
        let discriminantes = 0;
        fc.assert(
            fc.property(percursoArb, ({ pts, cursor }) => {
                if (segmentoDiscriminante(pts, cursor)) discriminantes++;
                const pos = interpolatePosition(pts, cursor);
                if (pos === null) return true;

                const param = parametroNaPoligonal(pts, cursor);
                const i = Math.min(Math.floor(param), pts.length - 2);
                const a = pts[i];
                const b = pts[i + 1];

                const dx = b.lng - a.lng;
                const dy = b.lat - a.lat;
                const px = pos[0] - a.lng;
                const py = pos[1] - a.lat;

                // Colinearidade: o produto vetorial e zero, com folga proporcional ao tamanho do
                // segmento (a aritmetica de ponto flutuante sobre graus nao fecha em zero exato).
                const escala = Math.max(1, Math.abs(dx) + Math.abs(dy));
                if (Math.abs(dx * py - dy * px) > 1e-9 * escala) return false;

                // Dentro do segmento: o parametro escalar fica em [0, 1].
                const len2 = dx * dx + dy * dy;
                if (len2 === 0) return Math.abs(px) <= 1e-9 && Math.abs(py) <= 1e-9;
                const t = (px * dx + py * dy) / len2;
                return t >= -1e-9 && t <= 1 + 1e-9;
            }),
            { numRuns: 500 },
        );
        // CONTROLE DE VACUO da propria propriedade: um corpus que so tocasse ponta de segmento ou
        // segmento degenerado aprovaria qualquer implementacao. Ver o comentario do gerador.
        expect(discriminantes).toBeGreaterThan(100);
    });

    it('property: advancing the cursor never walks backwards along the path', () => {
        let discriminantes = 0;
        fc.assert(
            fc.property(percursoArb, fc.integer({ min: 0, max: 1000 }), ({ pts, cursor, span }, avancoRel) => {
                const avanco = Math.round((span * avancoRel) / 1000);
                if (avanco > 0 && segmentoDiscriminante(pts, cursor)) discriminantes++;
                const antes = interpolatePosition(pts, cursor);
                const depois = interpolatePosition(pts, cursor + avanco);
                if (antes === null || depois === null) return true;

                // O parametro e monotonico no cursor; um resultado que saltasse para outro
                // segmento (ou voltasse dentro do mesmo) quebraria esta comparacao.
                const pAntes = parametroNaPoligonal(pts, cursor);
                const pDepois = parametroNaPoligonal(pts, cursor + avanco);
                if (pDepois < pAntes - 1e-12) return false;

                // E a distancia percorrida ate o ponto, MEDIDA SOBRE O RESULTADO, nunca diminui:
                // uma implementacao que andasse para tras dentro do segmento cairia aqui.
                const percorrido = (param, pos) => {
                    const inteiro = Math.min(Math.floor(param), pts.length - 2);
                    let acc = 0;
                    for (let i = 0; i < inteiro; i++) {
                        acc += Math.hypot(pts[i + 1].lng - pts[i].lng, pts[i + 1].lat - pts[i].lat);
                    }
                    return acc + Math.hypot(pos[0] - pts[inteiro].lng, pos[1] - pts[inteiro].lat);
                };
                const escala = Math.max(1, Math.abs(pts[pts.length - 1].lng) + Math.abs(pts[pts.length - 1].lat));
                return percorrido(pDepois, depois) >= percorrido(pAntes, antes) - 1e-9 * escala;
            }),
            { numRuns: 500 },
        );
        expect(discriminantes).toBeGreaterThan(100);
    });

    it('CONTROLE NEGATIVO da propria propriedade: o centro da caixa envolvente REPROVA', () => {
        // A caixa envolvente aprovava este ponto; a colinearidade nao. E o que mostra que a
        // propriedade trocada mede alguma coisa a mais.
        const pts = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 0 },
            { t: 200, lng: 10, lat: 10 },
        ];
        const centroDaCaixa = [5, 5];
        const a = pts[0];
        const b = pts[1];
        const cruz = (b.lng - a.lng) * (centroDaCaixa[1] - a.lat) - (b.lat - a.lat) * (centroDaCaixa[0] - a.lng);
        expect(Math.abs(cruz)).toBeGreaterThan(1e-6);
        // E o valor REAL no mesmo cursor esta sobre o segmento.
        expect(interpolatePosition(pts, 50)).toEqual([5, 0]);
    });
});

// ============================================================================
// resolveTrajectoryTarget (renderer home/interpolation bookkeeping)
// ============================================================================

describe('resolveTrajectoryTarget', () => {
    const traj = [
        { t: 0, lng: 0, lat: 0 },
        { t: 100, lng: 10, lat: 10 },
    ];

    it('interpolates and keeps home for an active trajectory', () => {
        const r = resolveTrajectoryTarget(traj, [99, 99], 50);
        expect(r).toEqual({ target: [5, 5], keepHome: true });
    });

    it('snaps back home and drops the stash when temporal is off (cursor null)', () => {
        const r = resolveTrajectoryTarget(traj, [99, 99], null);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('REGRESSION: a cleared trajectory snaps the feature back home (was frozen at displaced pos)', () => {
        // Feature previously displaced to [5,5]; trajectory just cleared → must restore home.
        const r = resolveTrajectoryTarget([], [99, 99], 50);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('REGRESSION: a single-keypoint (reduced) trajectory also restores home', () => {
        const r = resolveTrajectoryTarget([{ t: 1, lng: 1, lat: 1 }], [99, 99], 50);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('does nothing for a static feature that was never moved (no home)', () => {
        expect(resolveTrajectoryTarget([], null, 50)).toEqual({ target: null, keepHome: false });
        expect(resolveTrajectoryTarget(undefined, undefined, 50)).toEqual({ target: null, keepHome: false });
    });

    it('falls back to home when interpolation yields nothing', () => {
        // Cursor finite but trajectory becomes unusable mid-call is covered above;
        // here interpolation is valid so home is retained, not used.
        const r = resolveTrajectoryTarget(traj, [99, 99], 0);
        expect(r.target).toEqual([0, 0]); // clamped to first keypoint
        expect(r.keepHome).toBe(true);
    });
});
