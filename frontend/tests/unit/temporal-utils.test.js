import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    unitToMs,
    clampCursor,
    quantizeCursor,
    buildTicks,
    cursorToFraction,
    fractionToCursor,
    epochToDatetimeLocal,
    datetimeLocalToEpoch,
    toEpoch,
    formatInstant,
    computeTemporalExtent,
    resolveTimelineBounds,
    DEFAULT_TIMELINE_SPAN_UNITS,
    unitLetter,
    epochToOffset,
    offsetToEpoch,
    formatRelative,
    formatTimelineLabel,
    formatDTG,
} from '../../src/js/temporal/temporal.utils.js';
import { TEMPORAL_MODES } from '../../src/js/temporal/temporal.constants.js';

describe('formatDTG', () => {
    it('formats a military GDH in Zulu (DDHHMM<MON><YY>)', () => {
        const epoch = Date.UTC(2024, 10, 20, 14, 0); // 2024-11-20 14:00 UTC
        expect(formatDTG(epoch, 'military')).toBe('201400NOV24');
        expect(formatDTG(epoch)).toBe('201400NOV24'); // military is the default
    });

    it('formats a coordination GDH (DDHHMMZ <MON>)', () => {
        const epoch = Date.UTC(2024, 5, 12, 14, 0); // 2024-06-12 14:00 UTC
        expect(formatDTG(epoch, 'coordination')).toBe('121400Z JUN');
    });

    it('uses UTC, not local time', () => {
        // 23:30Z on the 1st stays the 1st/23:30 regardless of the test runner zone.
        const epoch = Date.UTC(2024, 0, 1, 23, 30);
        expect(formatDTG(epoch, 'military')).toBe('012330JAN24');
    });

    it('returns empty string for a non-finite epoch', () => {
        expect(formatDTG(NaN)).toBe('');
        expect(formatDTG(undefined)).toBe('');
    });
});

describe('unitToMs', () => {
    it('maps known units', () => {
        expect(unitToMs('MINUTO')).toBe(60_000);
        expect(unitToMs('HORA')).toBe(3_600_000);
        expect(unitToMs('DIA')).toBe(86_400_000);
        expect(unitToMs('SEMANA')).toBe(604_800_000);
    });
    it('falls back to HORA for unknown units', () => {
        expect(unitToMs('XYZ')).toBe(3_600_000);
        expect(unitToMs(undefined)).toBe(3_600_000);
    });
});

describe('clampCursor', () => {
    it('clamps to bounds', () => {
        expect(clampCursor(50, 100, 200)).toBe(100);
        expect(clampCursor(250, 100, 200)).toBe(200);
        expect(clampCursor(150, 100, 200)).toBe(150);
    });
    it('ignores null bounds', () => {
        expect(clampCursor(50, null, null)).toBe(50);
        expect(clampCursor(50, null, 40)).toBe(40);
        expect(clampCursor(50, 60, null)).toBe(60);
    });
    it('property: result is always within finite bounds', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1000, max: 1000 }),
                fc.integer({ min: -1000, max: 0 }),
                fc.integer({ min: 0, max: 1000 }),
                (cursor, lo, hi) => {
                    const r = clampCursor(cursor, lo, hi);
                    return r >= lo && r <= hi;
                }
            )
        );
    });
});

describe('quantizeCursor', () => {
    const DAY = 86_400_000;

    it('snaps down to the cell start, measured from origin', () => {
        // origin 1000, day-sized cells: anything in [1000, 1000+DAY) → 1000.
        expect(quantizeCursor(1000, DAY, 1000)).toBe(1000);
        expect(quantizeCursor(1000 + DAY / 2, DAY, 1000)).toBe(1000);
        expect(quantizeCursor(1000 + DAY, DAY, 1000)).toBe(1000 + DAY);
        expect(quantizeCursor(1000 + DAY + 1, DAY, 1000)).toBe(1000 + DAY);
    });

    it('defaults origin to 0', () => {
        expect(quantizeCursor(DAY + 5, DAY)).toBe(DAY);
        expect(quantizeCursor(DAY - 5, DAY)).toBe(0);
    });

    it('handles cursors before the origin (floors toward -∞)', () => {
        expect(quantizeCursor(-1, DAY, 0)).toBe(-DAY);
        expect(quantizeCursor(-DAY, DAY, 0)).toBe(-DAY);
        expect(quantizeCursor(-DAY - 1, DAY, 0)).toBe(-2 * DAY);
    });

    it('returns the raw cursor when snapping is disabled or inputs are non-finite', () => {
        expect(quantizeCursor(1234, 0, 0)).toBe(1234);
        expect(quantizeCursor(1234, -DAY, 0)).toBe(1234);
        expect(quantizeCursor(NaN, DAY, 0)).toBeNaN();
        expect(quantizeCursor(Infinity, DAY, 0)).toBe(Infinity);
        // Non-finite origin falls back to a 0 grid rather than producing NaN.
        expect(quantizeCursor(DAY + 5, DAY, NaN)).toBe(DAY);
    });

    it('property: result is a cell boundary ≤ cursor and within one step of it', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1_000_000, max: 1_000_000 }),
                fc.integer({ min: 1, max: 100_000 }),
                fc.integer({ min: -1_000_000, max: 1_000_000 }),
                (cursor, step, origin) => {
                    const q = quantizeCursor(cursor, step, origin);
                    return (
                        q <= cursor &&
                        cursor - q < step &&
                        Number.isInteger((q - origin) / step)
                    );
                }
            )
        );
    });
});

describe('buildTicks', () => {
    it('returns evenly spaced ticks', () => {
        const ticks = buildTicks(0, 3 * 3_600_000, 'HORA');
        expect(ticks).toEqual([0, 3_600_000, 7_200_000, 10_800_000]);
    });
    it('returns [] for invalid ranges', () => {
        expect(buildTicks(100, 100, 'HORA')).toEqual([]);
        expect(buildTicks(200, 100, 'HORA')).toEqual([]);
        expect(buildTicks(NaN, 100, 'HORA')).toEqual([]);
    });
    it('caps tick density', () => {
        const ticks = buildTicks(0, 100_000 * 60_000, 'MINUTO', 50);
        expect(ticks.length).toBeLessThanOrEqual(51);
    });
});

describe('cursorToFraction / fractionToCursor', () => {
    it('round-trips through the [inicio,fim] range', () => {
        const inicio = 1000;
        const fim = 5000;
        for (const c of [1000, 2000, 3000, 5000]) {
            const f = cursorToFraction(c, inicio, fim);
            expect(fractionToCursor(f, inicio, fim)).toBeCloseTo(c, 6);
        }
    });
    it('clamps fractions to [0,1]', () => {
        expect(cursorToFraction(-100, 0, 100)).toBe(0);
        expect(cursorToFraction(500, 0, 100)).toBe(1);
    });
    it('handles degenerate ranges', () => {
        expect(cursorToFraction(50, 100, 100)).toBe(0);
    });
});

describe('epochToDatetimeLocal / datetimeLocalToEpoch', () => {
    it('round-trips at minute precision (local zone)', () => {
        // Pick an epoch truncated to the minute to avoid sub-minute loss.
        const epoch = Math.floor(Date.now() / 60000) * 60000;
        const str = epochToDatetimeLocal(epoch);
        expect(str).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(datetimeLocalToEpoch(str)).toBe(epoch);
    });
    it('returns empty/null on invalid input', () => {
        expect(epochToDatetimeLocal(NaN)).toBe('');
        expect(datetimeLocalToEpoch('')).toBeNull();
        expect(datetimeLocalToEpoch('not-a-date')).toBeNull();
    });
});

describe('toEpoch', () => {
    it('passes through finite numbers (epoch ms)', () => {
        expect(toEpoch(1_700_000_000_000)).toBe(1_700_000_000_000);
    });
    it('treats bare integer strings as canonical epoch ms (no seconds guessing)', () => {
        expect(toEpoch('1700000000000')).toBe(1_700_000_000_000);
        // A pre-2001 ms timestamp must NOT be rescaled (regression: < 1e12 heuristic).
        expect(toEpoch('500000000000')).toBe(500_000_000_000);
        expect(toEpoch('-700000000000')).toBe(-700_000_000_000);
    });
    it('parses ISO-8601 strings', () => {
        expect(toEpoch('2024-01-01T00:00:00Z')).toBe(Date.parse('2024-01-01T00:00:00Z'));
    });
    it('parses Date objects', () => {
        const d = new Date('2024-06-15T12:00:00Z');
        expect(toEpoch(d)).toBe(d.getTime());
    });
    it('returns null on empty/unparseable', () => {
        expect(toEpoch('')).toBeNull();
        expect(toEpoch(null)).toBeNull();
        expect(toEpoch(undefined)).toBeNull();
        expect(toEpoch('garbage')).toBeNull();
        expect(toEpoch(NaN)).toBeNull();
    });
});

describe('formatInstant', () => {
    it('returns em-dash for non-finite', () => {
        expect(formatInstant(NaN)).toBe('—');
        expect(formatInstant(null)).toBe('—');
    });
    it('omits time for coarse units', () => {
        const epoch = new Date(2024, 0, 15, 14, 30).getTime();
        expect(formatInstant(epoch, 'DIA')).toBe('15/01/2024');
        expect(formatInstant(epoch, 'HORA')).toBe('15/01/2024 14:30');
    });
});

describe('computeTemporalExtent', () => {
    it('returns null with no temporal data', () => {
        expect(computeTemporalExtent([{ properties: { nome: 'x' } }])).toBeNull();
        expect(computeTemporalExtent([])).toBeNull();
        expect(computeTemporalExtent(null)).toBeNull();
    });
    it('spans temporalInicio/Fim and trajectory keypoints', () => {
        const features = [
            { properties: { temporalInicio: 100, temporalFim: 500 } },
            { properties: { trajetoria: [{ t: 50, lng: 0, lat: 0 }, { t: 900, lng: 1, lat: 1 }] } },
        ];
        expect(computeTemporalExtent(features)).toEqual({ min: 50, max: 900 });
    });
    it('accepts bare property objects', () => {
        expect(computeTemporalExtent([{ temporalInicio: 10, temporalFim: 20 }])).toEqual({ min: 10, max: 20 });
    });
});

describe('unitLetter', () => {
    it('maps each unit to its military letter', () => {
        expect(unitLetter('MINUTO')).toBe('M');
        expect(unitLetter('HORA')).toBe('H');
        expect(unitLetter('DIA')).toBe('D');
        expect(unitLetter('SEMANA')).toBe('S');
    });
    it('falls back to HORA letter for unknown units', () => {
        expect(unitLetter('XYZ')).toBe('H');
        expect(unitLetter(undefined)).toBe('H');
    });
});

describe('epochToOffset / offsetToEpoch', () => {
    it('round-trips through an origin + unit', () => {
        const origem = 1_700_000_000_000;
        for (const n of [-3, 0, 5, 300, 5.3]) {
            const epoch = offsetToEpoch(n, origem, 'HORA');
            expect(epochToOffset(epoch, origem, 'HORA')).toBeCloseTo(n, 6);
        }
    });
    it('computes offsets in the chosen unit', () => {
        expect(offsetToEpoch(2, 0, 'DIA')).toBe(2 * 86_400_000);
        expect(epochToOffset(2 * 86_400_000, 0, 'DIA')).toBe(2);
    });
    it('returns null on non-finite inputs', () => {
        expect(epochToOffset(NaN, 0, 'HORA')).toBeNull();
        expect(epochToOffset(100, null, 'HORA')).toBeNull();
        expect(offsetToEpoch(NaN, 0, 'HORA')).toBeNull();
        expect(offsetToEpoch(5, null, 'HORA')).toBeNull();
    });
});

describe('formatRelative', () => {
    it('formats offset 0 as the bare unit letter', () => {
        expect(formatRelative(0, 0, 'DIA')).toBe('D');
    });
    it('formats positive/negative integer offsets', () => {
        expect(formatRelative(300 * 86_400_000, 0, 'DIA')).toBe('D+300');
        expect(formatRelative(-2 * 86_400_000, 0, 'DIA')).toBe('D-2');
        expect(formatRelative(2 * 3_600_000, 0, 'HORA')).toBe('H+2');
    });
    it('formats fractional offsets with a pt-BR comma', () => {
        expect(formatRelative(5.3 * 3_600_000, 0, 'HORA')).toBe('H+5,3');
    });
    it('returns em-dash when undeterminable', () => {
        expect(formatRelative(NaN, 0, 'HORA')).toBe('—');
        expect(formatRelative(100, null, 'HORA')).toBe('—');
    });
});

describe('formatTimelineLabel', () => {
    const epoch = new Date(2024, 0, 15, 14, 30).getTime();
    it('uses relative offsets in relative mode with a finite origin', () => {
        const origem = new Date(2024, 0, 10, 14, 30).getTime();
        expect(formatTimelineLabel(epoch, { modo: TEMPORAL_MODES.RELATIVO, origem, unidade: 'DIA' })).toBe('D+5');
    });
    it('falls back to the absolute date in absolute mode', () => {
        expect(formatTimelineLabel(epoch, { modo: TEMPORAL_MODES.ABSOLUTO, origem: null, unidade: 'DIA' })).toBe('15/01/2024');
    });
    it('falls back to absolute when relative origin is missing', () => {
        expect(formatTimelineLabel(epoch, { modo: TEMPORAL_MODES.RELATIVO, origem: null, unidade: 'DIA' })).toBe('15/01/2024');
    });
});

describe('resolveTimelineBounds', () => {
    it('uses explicit config bounds when present', () => {
        expect(resolveTimelineBounds({ inicio: 0, fim: 1000, unidade: 'HORA' }, [])).toEqual({ inicio: 0, fim: 1000 });
    });
    it('derives missing bounds from the exact feature extent (no padding)', () => {
        const features = [{ properties: { temporalInicio: 100, temporalFim: 200 } }];
        const r = resolveTimelineBounds({ inicio: null, fim: null, unidade: 'MINUTO' }, features);
        expect(r.inicio).toBe(100);
        expect(r.fim).toBe(200);
    });
    it('returns null ONLY when nothing at all is known', () => {
        expect(resolveTimelineBounds({ inicio: null, fim: null, unidade: 'HORA' }, [])).toBeNull();
        expect(resolveTimelineBounds(null, null)).toBeNull();
        expect(resolveTimelineBounds({ inicio: NaN, fim: undefined, unidade: 'HORA' }, [])).toBeNull();
    });
    it('guarantees fim > inicio', () => {
        const r = resolveTimelineBounds({ inicio: 500, fim: 500, unidade: 'HORA' }, []);
        expect(r.fim).toBeGreaterThan(r.inicio);
    });
});

/**
 * REPRO do achado C3 da auditoria do sistema temporal (2026-09-21).
 *
 * Com APENAS um dos dois limites preenchido e sem feição temporal no mapa, a
 * resolução devolvia nulo, e o controlador lia esse nulo como "não se sabe
 * nada" e inventava uma janela de 24 passos a partir de `Date.now()` —
 * recalculada a cada `LAYERS_CHANGED`, ou seja, a cada acender e apagar de
 * camada, de modo que os rótulos da régua andavam sozinhos enquanto o valor que
 * a pessoa tinha digitado ficava na config sendo ignorado.
 *
 * Um limite configurado é uma resposta REAL: o que falta se completa a partir
 * dele. Só dois nulos sem feição temporal continuam devolvendo nulo.
 */
describe('C3: um limite configurado sozinho NÃO é descartado', () => {
    const HORA = 3_600_000;
    const DIA = 86_400_000;

    it('só o início: o fim é completado, e o início é EXATAMENTE o configurado', () => {
        const r = resolveTimelineBounds({ inicio: 1000, fim: null, unidade: 'HORA' }, []);
        expect(r).not.toBeNull();
        expect(r.inicio).toBe(1000);
        expect(r.fim).toBe(1000 + DEFAULT_TIMELINE_SPAN_UNITS * HORA);
    });

    it('só o fim: o início é completado para trás, e o fim é o configurado', () => {
        const r = resolveTimelineBounds({ inicio: null, fim: 1_000_000, unidade: 'DIA' }, []);
        expect(r).not.toBeNull();
        expect(r.fim).toBe(1_000_000);
        expect(r.inicio).toBe(1_000_000 - DEFAULT_TIMELINE_SPAN_UNITS * DIA);
    });

    it('o vão completado usa a UNIDADE da config', () => {
        const minuto = resolveTimelineBounds({ inicio: 0, fim: null, unidade: 'MINUTO' }, []);
        const semana = resolveTimelineBounds({ inicio: 0, fim: null, unidade: 'SEMANA' }, []);
        expect(minuto.fim).toBe(DEFAULT_TIMELINE_SPAN_UNITS * 60_000);
        expect(semana.fim).toBe(DEFAULT_TIMELINE_SPAN_UNITS * 604_800_000);
    });

    it('a resposta não depende do relógio: duas chamadas dão o mesmo', () => {
        const cfg = { inicio: 1000, fim: null, unidade: 'HORA' };
        expect(resolveTimelineBounds(cfg, [])).toEqual(resolveTimelineBounds(cfg, []));
    });

    it('a feição temporal continua tendo precedência sobre o vão padrão', () => {
        const features = [{ properties: { temporalInicio: 1000, temporalFim: 7000 } }];
        const r = resolveTimelineBounds({ inicio: 1000, fim: null, unidade: 'HORA' }, features);
        expect(r).toEqual({ inicio: 1000, fim: 7000 });
    });

    it('extensão degenerada ainda garante fim > inicio', () => {
        const features = [{ properties: { temporalInicio: 500, temporalFim: 500 } }];
        const r = resolveTimelineBounds({ inicio: 500, fim: null, unidade: 'HORA' }, features);
        expect(r.fim).toBeGreaterThan(r.inicio);
    });
});
