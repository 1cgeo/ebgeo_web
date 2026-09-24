// Path: tests/unit/meteorologia-fonte.test.js

/**
 * @fileoverview The weather source (`utilities/meteorologia/fonte-meteorologica.js`): what leaves the
 * browser, and what does not.
 *
 * The call goes from the browser straight to the source (owner, 2026-09-23), so these cases are the
 * sigilo rules of the proposal made mechanical: the point is rounded BEFORE the URL exists, the
 * request carries no credential, no Referer and nothing for the disk cache (trap A13: the source's
 * CORS accepts `authorization`, so a stamped token would leave with a 200), and a failure never
 * repeats the URL, which carries the coordinate.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    ALCANCE_FUTURO_DIAS,
    FalhaDaFonte,
    MODELO,
    OPCOES_DA_REQUISICAO,
    PASSO_DA_GRADE_GRAUS,
    VARIAVEIS_HORARIAS,
    arredondarPonto,
    criarFonteMeteorologica,
    diasNoAlcance,
    lerRodada,
    lerSerie,
    montarUrlDaPrevisao,
    montarUrlDaRodada,
    opcoesSemCredencial,
} from '../../src/js/utilities/meteorologia/fonte-meteorologica.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/open-meteo-2026');
const ler = (nome) => JSON.parse(readFileSync(join(FIXTURES, nome), 'utf8'));
const HORARIA = ler('horaria-utc.json');
const META = ler('meta.json');

const AGORA = Date.parse('2026-09-23T23:30:00Z');
const PONTO = { lat: -30.300575, lng: -53.400000 };

/**
 * A transport that answers the forecast and the run metadata from the recording, and records every
 * call it received.
 * @param {Object} [opcoes]
 */
function transporteGravado({ falharRodada = false } = {}) {
    const chamadas = [];
    const transporte = async (url, opcoes) => {
        chamadas.push({ url, opcoes });
        if (url.includes('/static/meta.json')) {
            if (falharRodada) throw new TypeError('Failed to fetch');
            return { ok: true, status: 200, json: async () => META };
        }
        return { ok: true, status: 200, json: async () => HORARIA };
    };
    return { transporte, chamadas };
}

describe('o ponto que sai do navegador é arredondado antes da URL existir', () => {
    it('um ponto real vira a célula de 0,1°', () => {
        expect(PASSO_DA_GRADE_GRAUS).toBe(0.1);
        expect(arredondarPonto(PONTO)).toEqual({ lat: -30.3, lng: -53.4 });
        expect(arredondarPonto({ lat: -0.04, lng: -0.04 })).toEqual({ lat: 0, lng: 0 });
        expect(Object.is(arredondarPonto({ lat: -0.04, lng: 0 }).lat, -0)).toBe(false);
    });

    it('bordas: latitude presa a ±90, longitude dobrada para [−180, 180)', () => {
        expect(arredondarPonto({ lat: 95, lng: 0 }).lat).toBe(90);
        expect(arredondarPonto({ lat: -90.04, lng: 0 }).lat).toBe(-90);
        expect(arredondarPonto({ lat: 0, lng: 179.96 }).lng).toBe(-180);
        expect(arredondarPonto({ lat: 0, lng: 190.2 }).lng).toBe(-169.8);
        expect(() => arredondarPonto({ lat: NaN, lng: 0 })).toThrow();
    });

    it('o arredondado nunca se afasta mais de meio passo, e nunca tem mais de uma casa', () => {
        fc.assert(fc.property(
            fc.double({ min: -89.9, max: 89.9, noNaN: true }),
            fc.double({ min: -179.9, max: 179.9, noNaN: true }),
            (lat, lng) => {
                const c = arredondarPonto({ lat, lng });
                const dLng = Math.abs(((c.lng - lng + 540) % 360) - 180);
                return Math.abs(c.lat - lat) <= 0.05 + 1e-9 && dLng <= 0.05 + 1e-9
                    && Number(c.lat.toFixed(1)) === c.lat && Number(c.lng.toFixed(1)) === c.lng;
            },
        ));
    });
});

describe('a URL', () => {
    it('leva a célula, o modelo fixo, a série em UTC e o vento em m/s, e nada da altitude', () => {
        const url = montarUrlDaPrevisao('https://api.open-meteo.com/', { lat: -30.3, lng: -53.4 }, ['2026-09-25', '2026-09-24']);
        expect(url.startsWith('https://api.open-meteo.com/v1/forecast?')).toBe(true);
        expect(url).toContain('latitude=-30.3&longitude=-53.4&');
        expect(url).toContain(`models=${MODELO}`);
        expect(url).toContain('timezone=GMT');
        expect(url).toContain('timeformat=unixtime');
        expect(url).toContain('wind_speed_unit=ms');
        expect(url).toContain(`hourly=${VARIAVEIS_HORARIAS.join(',')}`);
        // The last P day ends at 03:00 UTC of the next date, so the UTC range goes one further.
        expect(url).toContain('start_date=2026-09-24&end_date=2026-09-26');
        expect(url).not.toContain('elevation');
    });

    it('a rodada vem de um endereço sem coordenada', () => {
        const url = montarUrlDaRodada('https://api.open-meteo.com');
        expect(url).toBe('https://api.open-meteo.com/data/ncep_gfs013/static/meta.json');
        expect(url).not.toMatch(/lat|lon/);
    });
});

describe('o alcance da previsão', () => {
    it('vai de 90 dias atrás até 14 dias à frente da data UTC de hoje', () => {
        expect(ALCANCE_FUTURO_DIAS).toBe(14);
        // 23:30 UTC of 2026-09-23: today in UTC is the 23rd, even though P is still the 23rd too.
        expect(diasNoAlcance(['2026-10-07', '2026-10-08'], AGORA)).toEqual(['2026-10-07']);
        expect(diasNoAlcance(['2026-06-25', '2026-06-24'], AGORA)).toEqual(['2026-06-25']);
        expect(diasNoAlcance(['2026-02-30', 'ontem'], AGORA)).toEqual([]);
    });
});

describe('a requisição não leva nada que identifique a pessoa (armadilha A13)', () => {
    it('as opções fixas: sem credencial, sem Referer, sem cache em disco e SEM cabeçalho algum', () => {
        expect(OPCOES_DA_REQUISICAO).toEqual({
            method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
        });
        expect('headers' in OPCOES_DA_REQUISICAO).toBe(false);
        expect(opcoesSemCredencial(OPCOES_DA_REQUISICAO)).toBe(true);
    });

    it('controle negativo: o predicado recusa o que o cliente HTTP da aplicação montaria', () => {
        expect(opcoesSemCredencial({ ...OPCOES_DA_REQUISICAO, headers: { Authorization: 'Bearer x' } })).toBe(false);
        expect(opcoesSemCredencial({ ...OPCOES_DA_REQUISICAO, credentials: 'include' })).toBe(false);
        expect(opcoesSemCredencial({ ...OPCOES_DA_REQUISICAO, referrerPolicy: 'origin' })).toBe(false);
        expect(opcoesSemCredencial(null)).toBe(false);
    });

    it('toda chamada real sai com essas opções, e a URL nunca leva a coordenada clicada', async () => {
        const { transporte, chamadas } = transporteGravado();
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        await fonte.consultar(PONTO, ['2026-09-24', '2026-09-25', '2026-09-26']);
        expect(chamadas.length).toBe(2);
        for (const { url, opcoes } of chamadas) {
            expect(opcoesSemCredencial(opcoes)).toBe(true);
            expect(url).not.toContain('30.3005');
            expect(url).not.toContain('53.400000');
        }
    });
});

describe('consultar', () => {
    it('devolve a célula, a série, a rodada e os dias no alcance', async () => {
        const { transporte } = transporteGravado();
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        const p = await fonte.consultar(PONTO, ['2026-09-24', '2026-09-25', '2026-09-26']);
        expect(p.celula).toEqual({ lat: -30.3, lng: -53.4 });
        expect(p.noAlcance).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
        expect(p.serie.tempos).toHaveLength(96);
        expect(p.serie.elevacao).toBe(37);
        expect(p.rodada.inicioMs).toBe(META.last_run_initialisation_time * 1000);
    });

    it('a mesma célula, dias e rodada saem do cache de memória, sem nova chamada de previsão', async () => {
        const { transporte, chamadas } = transporteGravado();
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        await fonte.consultar(PONTO, ['2026-09-24', '2026-09-25', '2026-09-26']);
        await fonte.consultar({ lat: -30.31, lng: -53.44 }, ['2026-09-24', '2026-09-25', '2026-09-26']);
        expect(chamadas.filter((c) => c.url.includes('/v1/forecast')).length).toBe(1);
        expect(chamadas.filter((c) => c.url.includes('meta.json')).length).toBe(1);
    });

    it('sem dia no alcance, não há chamada nenhuma', async () => {
        const { transporte, chamadas } = transporteGravado();
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        const p = await fonte.consultar(PONTO, ['2027-01-10', '2027-01-11', '2027-01-12']);
        expect(p.serie).toBeNull();
        expect(p.noAlcance).toEqual([]);
        expect(chamadas).toHaveLength(0);
    });

    it('a rodada que falha vira carimbo sem rodada, nunca painel sem previsão', async () => {
        const { transporte } = transporteGravado({ falharRodada: true });
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        const p = await fonte.consultar(PONTO, ['2026-09-24']);
        expect(p.rodada).toBeNull();
        expect(p.serie).not.toBeNull();
    });
});

describe('as falhas têm motivo e nunca repetem a URL', () => {
    const casos = [
        ['rede', async () => { throw new TypeError('Failed to fetch'); }, null],
        ['http', async () => ({ ok: false, status: 502, json: async () => ({}) }), 502],
        ['formato', async (url) => (url.includes('meta.json')
            ? { ok: true, status: 200, json: async () => META }
            : { ok: true, status: 200, json: async () => ({ hourly: { time: [1, 2] } }) }), null],
        ['formato', async (url) => (url.includes('meta.json')
            ? { ok: true, status: 200, json: async () => META }
            : { ok: true, status: 200, json: async () => { throw new SyntaxError('JSON'); } }), null],
    ];

    it.each(casos)('%s', async (motivo, transporte, status) => {
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        const erro = await fonte.consultar(PONTO, ['2026-09-24']).catch((e) => e);
        expect(erro).toBeInstanceOf(FalhaDaFonte);
        expect(erro.motivo).toBe(motivo);
        expect(erro.status).toBe(status);
        // An ADDRESS, not the word: the reason `http` is part of the message by design.
        expect(erro.message).not.toMatch(/https?:\/\/|30\.3|53\.4|latitude/);
    });

    it('lerSerie recusa série de tamanho diferente do tempo, e lerRodada devolve nulo para lixo', () => {
        const ruim = structuredClone(HORARIA);
        ruim.hourly.temperature_2m.pop();
        expect(() => lerSerie(ruim)).toThrow(FalhaDaFonte);
        expect(lerRodada({})).toBeNull();
        expect(lerRodada({ last_run_initialisation_time: 10, update_interval_seconds: 60 }))
            .toEqual({ inicioMs: 10000, intervaloMs: 60000 });
    });
});

describe('o tempo limite (rede que descarta pacote em vez de recusar)', () => {
    /** A transport that never answers, but honours the abort signal, as `fetch` does. */
    const mudo = (url, opcoes) => new Promise((_, rejeitar) => {
        opcoes.signal.addEventListener('abort', () => rejeitar(opcoes.signal.reason));
    });

    it('cada chamada leva um sinal de tempo limite, e nada além disso muda nas opções', async () => {
        const { transporte, chamadas } = transporteGravado();
        const fonte = criarFonteMeteorologica({ base: 'https://api.open-meteo.com', transporte, agora: () => AGORA });
        await fonte.consultar(PONTO, ['2026-09-24']);
        for (const { opcoes } of chamadas) {
            expect(opcoes.signal).toBeInstanceOf(AbortSignal);
            const { signal: _sinal, ...resto } = opcoes;
            expect(resto).toEqual(OPCOES_DA_REQUISICAO);
            expect(opcoesSemCredencial(opcoes)).toBe(true);
        }
    });

    it('a previsão que não responde vira falha de rede no prazo, e não espera infinita', async () => {
        const fonte = criarFonteMeteorologica({
            base: 'https://api.open-meteo.com', transporte: mudo, agora: () => AGORA,
            tempoLimiteMs: { previsao: 60, rodada: 30 },
        });
        const inicio = Date.now();
        const erro = await fonte.consultar(PONTO, ['2026-09-24']).catch((e) => e);
        expect(erro).toBeInstanceOf(FalhaDaFonte);
        expect(erro.motivo).toBe('rede');
        expect(Date.now() - inicio).toBeLessThan(1000);
    });

    it('a rodada e a previsão saem JUNTAS: a previsão parte com a rodada ainda pendente', async () => {
        // An ORDER measure, not a clock: in series the run settles before the forecast starts, and
        // a timing threshold would pass that too whenever the forecast answers fast.
        let rodadaPendente = false;
        let previsaoPartiuComRodadaPendente = null;
        const transporte = async (url, opcoes) => {
            if (url.includes('meta.json')) {
                rodadaPendente = true;
                try {
                    return await mudo(url, opcoes);
                } finally {
                    rodadaPendente = false;
                }
            }
            previsaoPartiuComRodadaPendente = rodadaPendente;
            return { ok: true, status: 200, json: async () => HORARIA };
        };
        const fonte = criarFonteMeteorologica({
            base: 'https://api.open-meteo.com', transporte, agora: () => AGORA,
            tempoLimiteMs: { previsao: 2000, rodada: 50 },
        });
        const p = await fonte.consultar(PONTO, ['2026-09-24']);
        expect(previsaoPartiuComRodadaPendente).toBe(true);
        expect(p.rodada).toBeNull();
        expect(p.serie).not.toBeNull();
    });
});
