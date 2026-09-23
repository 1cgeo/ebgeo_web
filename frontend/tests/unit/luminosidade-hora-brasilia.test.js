// Path: tests/unit/luminosidade-hora-brasilia.test.js

/**
 * @fileoverview Brasília time, the civil day in P and the Quadro 4-5 cell format
 * (`utilities/luminosidade/hora-brasilia.js`).
 *
 * The traps this file pins: the civil day is P's and never UTC's (the declination tool records
 * tomorrow's date after 21:00 in Brasília); the minute is ROUNDED, and rounded BEFORE the date, so
 * 23:59:40 is 00:00 of the next day with its "(+1)"; absence is null and never `00:00`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    DESLOCAMENTO_BRASILIA_MIN,
    ROTULO_FUSO_BRASILIA,
    arredondarAoMinuto,
    avisoDeFusoDoNavegador,
    celulaHoraria,
    dataCivilP,
    dataIsoValida,
    dataPorExtenso,
    diaMes,
    diasEntre,
    horaMinutoP,
    marcaDeDia,
    meiaNoiteP,
    rotuloDoDia,
    rotuloRelativo,
    rotuloUtc,
    somarDias,
    textoDaCelula,
} from '../../src/js/utilities/luminosidade/hora-brasilia.js';

const utc = (iso) => Date.parse(iso);

describe('o fuso e a letra', () => {
    it('Brasília é UTC−3 fixo, letra P, e o rótulo diz os dois', () => {
        expect(DESLOCAMENTO_BRASILIA_MIN).toBe(-180);
        expect(ROTULO_FUSO_BRASILIA).toBe('Hora de Brasília (P, UTC−3)');
    });
});

describe('o dia civil em P', () => {
    it('02:59:59 UTC ainda é a véspera em P, e 03:00 UTC já é o dia', () => {
        expect(dataCivilP(utc('2026-09-24T02:59:59Z'))).toBe('2026-09-23');
        expect(dataCivilP(utc('2026-09-24T03:00:00Z'))).toBe('2026-09-24');
    });

    it('a virada de ano e o 29 de fevereiro', () => {
        expect(dataCivilP(utc('2027-01-01T02:30:00Z'))).toBe('2026-12-31');
        expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
        expect(somarDias('2026-02-28', 1)).toBe('2026-03-01');
        expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
    });

    it('meia-noite em P é 03:00 UTC, e ida e volta preserva a data (qualquer dia de 1900 a 2199)', () => {
        expect(meiaNoiteP('2026-09-24')).toBe(utc('2026-09-24T03:00:00Z'));
        fc.assert(fc.property(
            fc.integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2199, 11, 31) }),
            (ms) => {
                const iso = dataCivilP(ms);
                return dataCivilP(meiaNoiteP(iso)) === iso && dataCivilP(meiaNoiteP(iso) - 1) === somarDias(iso, -1);
            },
        ));
    });

    it('diasEntre é o inverso de somarDias', () => {
        fc.assert(fc.property(fc.integer({ min: -4000, max: 4000 }), (n) => diasEntre('2026-09-24', somarDias('2026-09-24', n)) === n));
    });

    it('a data é validada no calendário, e data inválida é bug do chamador', () => {
        expect(dataIsoValida('2026-02-29')).toBe(false);
        expect(dataIsoValida('2028-02-29')).toBe(true);
        expect(dataIsoValida('2026-13-01')).toBe(false);
        expect(dataIsoValida('24/09/2026')).toBe(false);
        expect(dataIsoValida(null)).toBe(false);
        expect(dataIsoValida(20260924)).toBe(false);
        expect(() => somarDias('2026-02-30', 1)).toThrow(/data inválida/);
        expect(() => meiaNoiteP(undefined)).toThrow(/data inválida/);
    });
});

describe('o minuto e a célula do Quadro 4-5', () => {
    it('arredonda ao minuto MAIS PRÓXIMO, como o USNO publica', () => {
        expect(horaMinutoP(utc('2026-09-24T08:13:29Z'))).toBe('05:13');
        expect(horaMinutoP(utc('2026-09-24T08:13:30Z'))).toBe('05:14');
        expect(arredondarAoMinuto(-30001)).toBe(-60000);
    });

    it('o arredondamento vem ANTES da data: 23:59:40 P é 00:00 do dia seguinte, com "(+1)"', () => {
        const c = celulaHoraria(utc('2026-09-25T02:59:40Z'), '2026-09-24');
        expect(c).toEqual({ texto: '00:00h', marca: '(+1)', deslocamentoDias: 1, textoLido: '00:00 do dia seguinte' });
        expect(textoDaCelula(c, 'não ocorre')).toBe('00:00h (+1)');
    });

    it('o mesmo dia não leva marca, e a véspera leva o sinal de menos tipográfico', () => {
        expect(celulaHoraria(utc('2026-09-24T08:13:00Z'), '2026-09-24')).toMatchObject({ texto: '05:13h', marca: '' });
        expect(celulaHoraria(utc('2026-09-24T01:00:00Z'), '2026-09-24')).toMatchObject({ marca: '(−1)', textoLido: '22:00 do dia anterior' });
        expect(marcaDeDia(2)).toBe('(+2)');
        expect(marcaDeDia(0)).toBe('');
        expect(marcaDeDia(0.5)).toBe('');
    });

    it('AUSÊNCIA É NULA e nunca vira 00:00', () => {
        for (const nada of [null, undefined, NaN, Infinity, -Infinity]) {
            expect(celulaHoraria(nada, '2026-09-24'), String(nada)).toBeNull();
        }
        expect(textoDaCelula(null, 'não ocorre')).toBe('não ocorre');
    });
});

describe('os rótulos', () => {
    it('dia da semana, dia e mês, e o rótulo relativo em dias civis', () => {
        expect(rotuloDoDia('2026-09-24')).toBe('qui 24/09');
        expect(rotuloDoDia('2026-09-26')).toBe('sáb 26/09');
        expect(dataPorExtenso('2026-09-24')).toBe('24/09/2026');
        expect(diaMes('2026-09-24')).toBe('24/09');
        expect(rotuloRelativo(0)).toBe('D');
        expect(rotuloRelativo(2)).toBe('D+2');
        expect(rotuloRelativo(-1)).toBe('D−1');
    });

    it('o rótulo UTC, com meia hora e sem deslocamento', () => {
        expect(rotuloUtc(-240)).toBe('UTC−4');
        expect(rotuloUtc(330)).toBe('UTC+5:30');
        expect(rotuloUtc(0)).toBe('UTC');
        expect(rotuloUtc(NaN)).toBe('UTC');
    });

    it('o aviso de fuso só aparece fora de P', () => {
        expect(avisoDeFusoDoNavegador(-180)).toBeNull();
        expect(avisoDeFusoDoNavegador(NaN)).toBeNull();
        expect(avisoDeFusoDoNavegador(-240)).toBe('Este computador está em UTC−4. Os horários deste painel estão em Brasília.');
        expect(avisoDeFusoDoNavegador(0)).toMatch(/^Este computador está em UTC\./);
    });
});
