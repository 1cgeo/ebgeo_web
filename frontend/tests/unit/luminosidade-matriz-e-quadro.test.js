// Path: tests/unit/luminosidade-matriz-e-quadro.test.js

/**
 * @fileoverview The light model's edges and the text the panel and the saved table write
 * (`utilities/luminosidade/matriz-pitcic.model.js`, `quadro-pitcic.js`).
 *
 * The reference against USNO lives in `luminosidade-referencia-usno.test.js`; this file pins what
 * the reference cannot reach: inputs a caller can get wrong, the fallbacks of the night of D (driven
 * by a synthetic ephemeris, because no Brazilian point produces them), the screen states E2, E3 and
 * E4 of the proposal, and the CSV.
 */

import { describe, it, expect } from 'vitest';
import { efemerides } from '../../src/js/utilities/luminosidade/efemerides.js';
import {
    CriterioDaNoite,
    MotivoSolar,
    criarCalculadora,
    matrizPitcic,
    nomeDaFase,
    normalizarPonto,
    passagemDaNoite,
    sobreposicao,
} from '../../src/js/utilities/luminosidade/matriz-pitcic.model.js';
import {
    linhaDaIluminacao,
    linhasDaFig410,
    linhasDoQuadro,
    nomeDoArquivoCsv,
    resumoDaEspiada,
    tabelaCsv,
} from '../../src/js/utilities/luminosidade/quadro-pitcic.js';
import { notaDoCriterioDaNoite } from '../../src/js/utilities/luminosidade/luminosidade-phrases.js';
import { MS_POR_DIA, diaDoPainel, somarDias } from '../../src/js/utilities/hora-brasilia.js';

const BRASILIA = { lat: -15.78, lng: -47.929167 };
const PORTO_ALEGRE = { lat: -30.0346, lng: -51.2177 };
const FERRAZ = { lat: -62.0847, lng: -58.3928 };
const MIN = 60000;

/** The text of each cell of a row, on one line. */
const textos = (linha) => linha.celulas.map((c) => (c.marca ? `${c.texto} ${c.marca}` : c.texto));

// ============================================================================================
// INPUTS
// ============================================================================================

describe('o ponto e a fase: entradas que o chamador pode errar', () => {
    it('a longitude dá a volta, e a latitude fora de ±90 ou não numérica é bug do chamador', () => {
        expect(normalizarPonto({ lat: 10, lng: 190 })).toEqual({ lat: 10, lng: -170 });
        expect(normalizarPonto({ lat: 10, lng: -190 })).toEqual({ lat: 10, lng: 170 });
        expect(normalizarPonto({ lat: 10, lng: 180 })).toEqual({ lat: 10, lng: 180 });
        expect(normalizarPonto({ lat: -90, lng: -180 })).toEqual({ lat: -90, lng: -180 });
        expect(normalizarPonto({ lat: 0, lng: 540 })).toEqual({ lat: 0, lng: 180 });
        expect(() => normalizarPonto({ lat: 91, lng: 0 })).toThrow(/latitude/);
        expect(() => normalizarPonto({ lat: NaN, lng: 0 })).toThrow(/numéricas/);
        expect(() => normalizarPonto(null)).toThrow(/numéricas/);
    });

    it('as fronteiras das janelas centradas ficam em 45°, 135°, 225° e 315°', () => {
        expect(nomeDaFase(0)).toBe('nova');
        expect(nomeDaFase(0.1249)).toBe('nova');
        expect(nomeDaFase(0.125)).toBe('crescente');
        expect(nomeDaFase(0.3749)).toBe('crescente');
        expect(nomeDaFase(0.375)).toBe('cheia');
        expect(nomeDaFase(0.625)).toBe('minguante');
        expect(nomeDaFase(0.875)).toBe('nova');
        expect(nomeDaFase(0.9999)).toBe('nova');
        expect(nomeDaFase(1)).toBe('nova');
        expect(nomeDaFase(-0.1)).toBe('nova');
        expect(nomeDaFase(NaN)).toBeNull();
        expect(nomeDaFase(Infinity)).toBeNull();
    });

    it('data D inválida e número de dias inválido são recusados alto', () => {
        expect(() => matrizPitcic('2026-02-30', BRASILIA, efemerides)).toThrow(/data D inválida/);
        expect(() => matrizPitcic('2026-09-24', BRASILIA, efemerides, { dias: 0 })).toThrow(/dias inválido/);
    });
});

// ============================================================================================
// THE NIGHT AND THE PASSAGE
// ============================================================================================

describe('a passagem que cobre a noite', () => {
    const noite = { inicio: 10 * MIN, fim: 100 * MIN };

    it('a sobreposição conta em minutos inteiros: 14 segundos de Lua antes do fim da noite são zero', () => {
        expect(sobreposicao({ nasce: 100 * MIN - 14000, poe: 900 * MIN }, noite)).toBe(0);
        expect(sobreposicao({ nasce: 99 * MIN, poe: 900 * MIN }, noite)).toBe(MIN);
    });

    it('ponta aberta conta como infinita, e o empate fica com a primeira passagem', () => {
        expect(sobreposicao({ nasce: null, poe: 50 * MIN }, noite)).toBe(40 * MIN);
        expect(sobreposicao({ nasce: 50 * MIN, poe: null }, noite)).toBe(50 * MIN);
        const a = { nasce: 0, poe: 30 * MIN };
        const b = { nasce: 80 * MIN, poe: 200 * MIN };
        expect(passagemDaNoite(noite, [a, b])).toBe(a);
        expect(passagemDaNoite(noite, [{ nasce: 200 * MIN, poe: 300 * MIN }])).toBeNull();
    });

    /**
     * A synthetic ephemeris: every solar day has the same shape, with the events named in `nulos`
     * missing, noon at 15:00 UTC, and the Sun's altitude at noon and at midnight as given.
     */
    function efemeridesSinteticas({ nulos = [], alturaMeioDia = 60, alturaMeiaNoite = -40 } = {}) {
        const deslocamentos = {
            primeiraClaridade: -8, icmn: -7.5, inicioCivil: -7, nascer: -6.5,
            por: 6.5, fimCivil: 7, fcvn: 7.5, ultimaClaridade: 8,
        };
        return {
            horariosDoSol(instanteMs) {
                const meioDia = Math.floor(instanteMs / MS_POR_DIA) * MS_POR_DIA + 15 * 3600000;
                const out = { meioDia };
                for (const [k, h] of Object.entries(deslocamentos)) out[k] = nulos.includes(k) ? null : meioDia + h * 3600000;
                return out;
            },
            alturaDoSol(instanteMs) {
                const h = ((instanteMs / 3600000) % 24 + 24) % 24;
                return Math.abs(h - 15) < 1 ? alturaMeioDia : alturaMeiaNoite;
            },
            eventosDaLuaNoDiaUtc: () => ({ nasce: null, poe: null, sempreAcima: false, sempreAbaixo: true }),
            iluminacaoDaLua: () => ({ fracao: 0.5, fase: 0.25, crescente: true }),
        };
    }

    it('sem crepúsculo náutico a noite cai para o civil, depois para o horizonte, e a nota diz qual', () => {
        const civil = criarCalculadora({ lat: 0, lng: -45 }, efemeridesSinteticas({ nulos: ['icmn', 'fcvn'] }));
        expect(civil.noiteDe('2026-06-01').criterio).toBe(CriterioDaNoite.CIVIL);
        const horizonte = criarCalculadora({ lat: 0, lng: -45 },
            efemeridesSinteticas({ nulos: ['icmn', 'fcvn', 'inicioCivil', 'fimCivil'] }));
        expect(horizonte.noiteDe('2026-06-01').criterio).toBe(CriterioDaNoite.HORIZONTE);
        expect(notaDoCriterioDaNoite(CriterioDaNoite.HORIZONTE)).toMatch(/do pôr ao nascer do Sol/);
        expect(notaDoCriterioDaNoite(CriterioDaNoite.NAUTICO)).toBeNull();
    });

    it('noite polar: a noite vai de meio-dia a meio-dia; sol da meia-noite: não há noite', () => {
        const todos = ['primeiraClaridade', 'icmn', 'inicioCivil', 'nascer', 'por', 'fimCivil', 'fcvn', 'ultimaClaridade'];
        const polar = criarCalculadora({ lat: -80, lng: 0 },
            efemeridesSinteticas({ nulos: todos, alturaMeioDia: -5, alturaMeiaNoite: -30 }));
        const n = polar.noiteDe('2026-06-21');
        expect(n.criterio).toBe(CriterioDaNoite.NOITE_POLAR);
        expect(n.fim - n.inicio).toBe(MS_POR_DIA);
        expect(polar.diaSolar('2026-06-21').motivos.nascer).toBe(MotivoSolar.NUNCA_SOBE);

        const meiaNoite = criarCalculadora({ lat: 80, lng: 0 },
            efemeridesSinteticas({ nulos: todos, alturaMeioDia: 30, alturaMeiaNoite: 5 }));
        expect(meiaNoite.noiteDe('2026-06-21')).toBeNull();
        expect(meiaNoite.diaSolar('2026-06-21').motivos.icmn).toBe(MotivoSolar.NUNCA_DESCE);
        const coluna = matrizPitcic('2026-06-21', { lat: 80, lng: 0 },
            efemeridesSinteticas({ nulos: todos, alturaMeioDia: 30, alturaMeiaNoite: 5 }), { dias: 1 }).colunas[0];
        expect(coluna.lua.semNoite).toBe(true);
        expect(textos(linhasDoQuadro({ colunas: [coluna], dataD: '2026-06-21' })[3])).toEqual(['sem noite']);
    });
});

// ============================================================================================
// THE SCREEN STATES, with the real ephemeris
// ============================================================================================

describe('os estados da tela, com as efemérides reais', () => {
    it('E1, Brasília em 24/09/2026: a matriz, com os minutos do USNO', () => {
        const m = matrizPitcic('2026-09-24', BRASILIA, efemerides);
        const [icmn, fcvn, fase, ini, fim] = linhasDoQuadro(m);
        expect(textos(icmn)).toEqual(['05:13h', '05:12h', '05:12h']);
        expect(textos(fcvn)).toEqual(['18:54h', '18:54h', '18:55h']);
        expect(textos(fase)).toEqual(['cheia', 'cheia', 'cheia']);
        expect(textos(ini)).toEqual(['16:29h', '17:20h', '18:13h']);
        expect(textos(fim)).toEqual(['05:04h (+1)', '05:41h (+1)', '06:19h (+1)']);
        expect(icmn.celulas[0].dica).toMatch(/400 metros/);
        expect(fim.celulas[0].textoLido).toBe('05:04 do dia seguinte');
        expect(textos(linhaDaIluminacao(m))).toEqual(['97% ↑', '100% ↑', '100% ↓']);
        expect(linhasDaFig410(m).map((l) => l.rotulo)[0]).toBe('Primeira claridade (Sol a −18°)');
    });

    it('E2, Ferraz em 21/12/2026: ICMN e FCVN "não ocorre", com o motivo, e o resto do dia existe', () => {
        const m = matrizPitcic('2026-12-21', FERRAZ, efemerides, { dias: 1 });
        const [icmn, fcvn] = linhasDoQuadro(m);
        expect(textos(icmn)).toEqual(['não ocorre']);
        expect(textos(fcvn)).toEqual(['não ocorre']);
        expect(icmn.celulas[0].dica).toBe('O Sol não desce 12° abaixo do horizonte nesta data.');
        expect(icmn.celulas[0].vazia).toBe(true);
        const nascer = linhasDaFig410(m).find((l) => l.chave === 'nascer');
        expect(nascer.celulas[0].vazia).toBe(false);
        expect(notaDoCriterioDaNoite(m.colunas[0].noite.criterio)).toMatch(/pôr ao nascer/);
    });

    it('E3, Porto Alegre: a primeira noite de 2026 sem luar diz "sem luar" nas duas células, com o motivo', () => {
        let data = '2026-01-01';
        let coluna = null;
        for (let i = 0; i < 60 && !coluna; i++, data = somarDias(data, 1)) {
            const c = matrizPitcic(data, PORTO_ALEGRE, efemerides, { dias: 1 }).colunas[0];
            if (c.lua.semLuar) coluna = c;
        }
        expect(coluna, 'nenhuma noite sem luar em dois meses').not.toBeNull();
        const linhas = linhasDoQuadro({ colunas: [coluna], dataD: coluna.data });
        expect(textos(linhas[3])).toEqual(['sem luar']);
        expect(textos(linhas[4])).toEqual(['sem luar']);
        expect(linhas[3].celulas[0].dica).toBe('A Lua fica abaixo do horizonte durante toda a noite.');
    });

    it('a espiada do celular responde de relance', () => {
        const m = matrizPitcic('2026-09-24', BRASILIA, efemerides);
        expect(resumoDaEspiada(m)).toEqual({
            sol: 'ICMN 05:13h · FCVN 18:54h',
            lua: 'Lua cheia · luar 16:29h a 05:04h (+1)',
        });
    });
});

// ============================================================================================
// DAY D AND THE SAVED TABLE
// ============================================================================================

describe('o dia D do painel', () => {
    it('é a data escolhida, ou hoje em P (22:30 em Brasília ainda é hoje; 00:30 já é amanhã)', () => {
        expect(diaDoPainel({ escolhidoNoPainel: '2026-10-01', agoraMs: 0 })).toEqual({ dataD: '2026-10-01', origem: 'painel' });
        expect(diaDoPainel({ escolhidoNoPainel: null, agoraMs: Date.parse('2026-09-24T01:30:00Z') }))
            .toEqual({ dataD: '2026-09-23', origem: 'hoje' });
        expect(diaDoPainel({ escolhidoNoPainel: '2026-02-30', agoraMs: Date.parse('2026-09-24T03:30:00Z') }))
            .toEqual({ dataD: '2026-09-24', origem: 'hoje' });
    });
});

describe('Salvar tabela: o CSV', () => {
    const m = matrizPitcic('2026-09-24', BRASILIA, efemerides);
    const csv = tabelaCsv(m);
    const linhas = csv.trimEnd().split('\n');

    it('segue a convenção da casa: vírgula, toda célula entre aspas, e o BOM fica com quem baixa', () => {
        expect(csv.charCodeAt(0)).not.toBe(0xfeff);
        expect(linhas[0]).toBe('"Dados de luminosidade (PITCIC, Quadro 4-5)"');
        expect(linhas).toContain('"","D 24/09/2026","D+1 25/09/2026","D+2 26/09/2026"');
    });

    it('o ponto vai como dois números simples, sem o apóstrofo da guarda de fórmula, e o fuso vai junto', () => {
        expect(linhas[1]).toBe('"Latitude","-15.780000"');
        expect(linhas[2]).toBe('"Longitude","-47.929167"');
        expect(linhas[3]).toBe('"Fuso","Hora de Brasília (P, UTC−3)"');
        expect(csv).not.toMatch(/"'-/);
    });

    it('a coordenada no formato do mapa entra quando ele não é decimal', () => {
        const comDms = tabelaCsv(m, { coordenada: '15º46\'48.0" S 47º55\'45.0" O' });
        expect(comDms.split('\n')[3]).toBe('"Coordenada","15º46\'48.0"" S 47º55\'45.0"" O"');
    });

    it('os cinco campos doutrinários, a Fig 4-10 e o cálculo auxiliar ficam em blocos com título', () => {
        expect(linhas).toContain('"ICMN","05:13h","05:12h","05:12h"');
        expect(linhas).toContain('"Fim do luar","05:04h (+1)","05:41h (+1)","06:19h (+1)"');
        expect(linhas).toContain('"Crepúsculos e claridade (Fig 4-10)"');
        const auxiliar = linhas.indexOf('"Cálculo auxiliar, fora do PITCIC"');
        const iluminacao = linhas.findIndex((l) => l.startsWith('"Iluminação da Lua'));
        expect(auxiliar).toBeGreaterThan(linhas.indexOf('"Fim do luar","05:04h (+1)","05:41h (+1)","06:19h (+1)"'));
        expect(iluminacao).toBeGreaterThan(auxiliar);
        expect(linhas.at(-1)).toMatch(/^"Horizonte teórico ao nível do mar/);
    });

    it('o nome do arquivo diz o dia e o ponto', () => {
        expect(nomeDoArquivoCsv(m)).toBe('luminosidade_2026-09-24_-15.78000_-47.92917.csv');
    });
});
