// Path: tests/unit/meteorologia-agregacao-e-quadro.test.js

/**
 * @fileoverview The weather panel's day values and quadro (`utilities/meteorologia/`).
 *
 * THE INDEPENDENT PATH is the first block: the same GFS run was asked twice on 2026-09-23, once as
 * an hourly series in UTC and once as the source's OWN daily aggregates in Brasília's zone
 * (`tests/fixtures/open-meteo-2026/`). What this module computes from the first must equal the
 * second, so the day cut in P (trap A2), the vector mean of the wind (A4) and every max, min, sum
 * and mean are checked against numbers nobody here wrote. The coordinate of the recording has no
 * relation to Brazil on purpose; the day cut is P's whatever the place.
 *
 * The rest pins what the recording cannot reach: the negative controls of A2 and A4, zero against
 * null (A5), the calm day and the text of every cell.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { VARIAVEIS_HORARIAS, lerSerie } from '../../src/js/utilities/meteorologia/fonte-meteorologica.js';
import {
    MotivoMeteorologico,
    RUMOS,
    agregarDia,
    direcaoPredominante,
    rumoDe,
} from '../../src/js/utilities/meteorologia/agregacao-meteorologica.js';
import {
    carimboDaFonte,
    montarQuadro,
    nomeDoArquivoCsv,
    numero,
    resumoDaEspiada,
    tabelaCsv,
    textoDePrecipitacao,
    textoDeVisibilidade,
} from '../../src/js/utilities/meteorologia/quadro-meteorologico.js';
import { meiaNoiteP } from '../../src/js/utilities/hora-brasilia.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/open-meteo-2026');
const ler = (nome) => JSON.parse(readFileSync(join(FIXTURES, nome), 'utf8'));

const HORARIA = ler('horaria-utc.json');
const DIARIA = ler('diaria-brasilia.json').daily;
const META = ler('meta.json');
const DATAS = ['2026-09-24', '2026-09-25', '2026-09-26'];

/**
 * A synthetic series of whole P days, every variable at a constant, with overrides by hour index.
 * @param {string} primeiroDia
 * @param {number} dias
 * @param {Object<string, number|null>} base
 * @returns {import('../../src/js/utilities/meteorologia/fonte-meteorologica.js').SerieHoraria}
 */
function serieSintetica(primeiroDia, dias, base) {
    const inicio = meiaNoiteP(primeiroDia);
    const n = dias * 24;
    const tempos = Array.from({ length: n }, (_, i) => inicio + i * 3600000);
    const valores = {};
    for (const v of VARIAVEIS_HORARIAS) valores[v] = Array.from({ length: n }, () => base[v] ?? 0);
    return { tempos, valores, elevacao: 100, grade: { lat: 0, lng: 0 } };
}

describe('caminho independente: a agregação reproduz os agregados diários da própria fonte', () => {
    const serie = lerSerie(HORARIA);

    it('a gravação é uma rodada só, e as duas chamadas cobrem os mesmos três dias de P', () => {
        expect(DIARIA.time.map((t) => t * 1000)).toEqual(DATAS.map(meiaNoiteP));
        expect(Number.isFinite(META.last_run_initialisation_time)).toBe(true);
        expect(serie.tempos.length).toBe(96);
    });

    it.each(DATAS.map((d, i) => [d, i]))('%s', (data, i) => {
        const dia = agregarDia(serie, data);
        expect(dia.completo).toBe(true);
        expect(dia.temperaturaMax.valor).toBe(DIARIA.temperature_2m_max[i]);
        expect(dia.temperaturaMin.valor).toBe(DIARIA.temperature_2m_min[i]);
        expect(dia.precipitacao.valor).toBeCloseTo(DIARIA.precipitation_sum[i], 6);
        expect(dia.probabilidade.valor).toBe(DIARIA.precipitation_probability_max[i]);
        expect(dia.codigoDeTempo.valor).toBe(DIARIA.weather_code[i]);
        expect(dia.vento.valor.velocidade).toBeCloseTo(DIARIA.wind_speed_10m_mean[i], 2);
        // The source rounds its dominant direction to a whole degree.
        expect(Math.abs(dia.vento.valor.direcao - DIARIA.wind_direction_10m_dominant[i])).toBeLessThanOrEqual(1);
        expect(dia.rajada.valor.velocidade).toBe(DIARIA.wind_gusts_10m_max[i]);
        expect(dia.umidadeMax.valor).toBe(DIARIA.relative_humidity_2m_max[i]);
        expect(dia.umidadeMin.valor).toBe(DIARIA.relative_humidity_2m_min[i]);
        expect(Math.round(dia.nebulosidade.valor)).toBe(DIARIA.cloud_cover_mean[i]);
        expect(dia.pressao.valor).toBeCloseTo(DIARIA.pressure_msl_mean[i], 1);
        expect(dia.visibilidade.valor.metros).toBe(DIARIA.visibility_min[i]);
    });

    it('controle negativo de A4: a média vetorial SEM peso erra a direção da fonte no primeiro dia', () => {
        const inicio = meiaNoiteP(DATAS[0]);
        const idx = serie.tempos.map((t, i) => [t, i]).filter(([t]) => t >= inicio && t < inicio + 86400000).map(([, i]) => i);
        const direcoes = idx.map((i) => serie.valores.wind_direction_10m[i]);
        const semPeso = direcaoPredominante(direcoes, direcoes.map(() => 1));
        expect(Math.abs(semPeso - DIARIA.wind_direction_10m_dominant[0])).toBeGreaterThan(10);
    });
});

describe('o dia é o de P, e não o UTC (armadilha A2)', () => {
    it('uma chuva às 01:00 UTC do dia 25 é da noite do dia 24 em P', () => {
        const serie = serieSintetica('2026-09-24', 2, {});
        const umaDaManhaUtc = Date.parse('2026-09-25T01:00:00Z');
        const i = serie.tempos.indexOf(umaDaManhaUtc);
        expect(i).toBeGreaterThan(-1);
        serie.valores.precipitation[i] = 12;
        expect(agregarDia(serie, '2026-09-24').precipitacao.valor).toBe(12);
        expect(agregarDia(serie, '2026-09-25').precipitacao.valor).toBe(0);
    });

    it('controle negativo: cortado pelo dia UTC, o mesmo total cairia no dia 25', () => {
        const serie = serieSintetica('2026-09-24', 2, {});
        serie.valores.precipitation[serie.tempos.indexOf(Date.parse('2026-09-25T01:00:00Z'))] = 12;
        const inicioUtc = Date.parse('2026-09-25T00:00:00Z');
        const somaUtc = serie.tempos
            .map((t, i) => (t >= inicioUtc && t < inicioUtc + 86400000 ? serie.valores.precipitation[i] : 0))
            .reduce((a, b) => a + b, 0);
        expect(somaUtc).toBe(12);
    });

    it('um dia com 23 horas não é completo, e nenhum campo sai calculado', () => {
        const serie = serieSintetica('2026-09-24', 1, { temperature_2m: 20 });
        serie.tempos.pop();
        for (const v of VARIAVEIS_HORARIAS) serie.valores[v].pop();
        const dia = agregarDia(serie, '2026-09-24');
        expect(dia.completo).toBe(false);
        expect(dia.temperaturaMax).toEqual({ valor: null, motivo: MotivoMeteorologico.INCOMPLETO });
    });
});

describe('zero é valor e nulo é ausência (armadilha A5)', () => {
    it('um dia seco soma 0 mm, e não nulo', () => {
        const dia = agregarDia(serieSintetica('2026-09-24', 1, { precipitation: 0 }), '2026-09-24');
        expect(dia.precipitacao).toEqual({ valor: 0, motivo: null });
    });

    it('uma hora nula anula só aquele campo, com motivo', () => {
        const serie = serieSintetica('2026-09-24', 1, { precipitation: 1, temperature_2m: 20 });
        serie.valores.precipitation[5] = null;
        const dia = agregarDia(serie, '2026-09-24');
        expect(dia.precipitacao).toEqual({ valor: null, motivo: MotivoMeteorologico.INCOMPLETO });
        expect(dia.temperaturaMax.valor).toBe(20);
    });
});

describe('a direção do vento (armadilha A4)', () => {
    it('350° e 10° com a mesma força dão norte, e não sul', () => {
        expect(direcaoPredominante([350, 10], [5, 5])).toBeCloseTo(0, 6);
        expect(rumoDe(direcaoPredominante([350, 10], [5, 5]))).toBe('N');
    });

    it('um dia sem vento algum não tem direção predominante', () => {
        const dia = agregarDia(serieSintetica('2026-09-24', 1, { wind_speed_10m: 0, wind_direction_10m: 90 }), '2026-09-24');
        expect(dia.vento.valor.direcao).toBeNull();
        expect(dia.vento.motivo).toBe(MotivoMeteorologico.CALMO);
    });

    it('os 16 rumos são os do Quadro 4-5, e cada setor tem 22,5°', () => {
        expect(RUMOS).toHaveLength(16);
        expect(rumoDe(337.5)).toBe('N-NW');
        expect(rumoDe(348.74)).toBe('N-NW');
        expect(rumoDe(348.76)).toBe('N');
        expect(rumoDe(-90)).toBe('W');
        expect(rumoDe(720 + 45)).toBe('NE');
    });

    it('o resultado fica sempre em [0, 360)', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0.1, max: 40, noNaN: true })), { minLength: 1, maxLength: 24 }),
            (pares) => {
                const d = direcaoPredominante(pares.map(([a]) => a), pares.map(([, v]) => v));
                return d === null || (d >= 0 && d < 360);
            },
        ));
    });
});

describe('o texto das células', () => {
    it('números em pt-BR, sem "-0"', () => {
        expect(numero(1.25, 1)).toBe('1,3');
        expect(numero(-0.04, 1)).toBe('0,0');
        expect(numero(-0.4, 0)).toBe('0');
        expect(numero(-3.6, 0)).toBe('-4');
    });

    it('precipitação: zero, décimos abaixo de 10 mm, inteiros acima', () => {
        expect(textoDePrecipitacao(0)).toBe('0 mm');
        expect(textoDePrecipitacao(0.04)).toBe('0 mm');
        expect(textoDePrecipitacao(0.2)).toBe('0,2 mm');
        expect(textoDePrecipitacao(12.34)).toBe('12 mm');
    });

    it('visibilidade: o teto do GFS é "24 km ou mais"', () => {
        expect(textoDeVisibilidade(24140)).toBe('24 km ou mais');
        expect(textoDeVisibilidade(15000)).toBe('15 km');
        expect(textoDeVisibilidade(8500)).toBe('8,5 km');
        expect(textoDeVisibilidade(900)).toBe('900 m');
    });
});

describe('o quadro', () => {
    const previsao = {
        celula: { lat: 45.1, lng: 10 },
        noAlcance: DATAS,
        serie: lerSerie(HORARIA),
        rodada: { inicioMs: META.last_run_initialisation_time * 1000, intervaloMs: 21600000 },
    };

    it('enquanto a previsão não chega, toda célula diz "…"', () => {
        const q = montarQuadro({ dataD: DATAS[0], datas: DATAS, previsao: null });
        expect(q.colunas.map((c) => c.relativo)).toEqual(['D', 'D+1', 'D+2']);
        for (const l of [...q.principais, ...q.auxiliares]) {
            expect(l.celulas.map((c) => c.texto)).toEqual(['…', '…', '…']);
        }
        expect(resumoDaEspiada(q)).toBeNull();
    });

    it('um dia fora do alcance diz "sem previsão", e os outros seguem com número', () => {
        const q = montarQuadro({ dataD: DATAS[0], datas: DATAS, previsao: { ...previsao, noAlcance: DATAS.slice(0, 2) } });
        const temperatura = q.principais.find((l) => l.chave === 'temperaturaMax').celulas;
        expect(temperatura.map((c) => c.texto)).toEqual(['25 °C', '23 °C', 'sem previsão']);
        expect(temperatura[2].vazia).toBe(true);
        expect(temperatura[2].dica).toMatch(/alcance/);
    });

    it('as células da gravação', () => {
        const q = montarQuadro({ dataD: DATAS[0], datas: DATAS, previsao });
        const linha = (chave) => q.principais.find((l) => l.chave === chave).celulas.map((c) => c.texto);
        expect(linha('tempo')).toEqual(['Nublado', 'Garoa fraca', 'Nublado']);
        expect(linha('precipitacao')).toEqual(['0 mm', '0,2 mm', '0 mm']);
        expect(linha('temperaturaMin')).toEqual(['13 °C', '13 °C', '12 °C']);
        expect(linha('vento')).toEqual(['NE 1,8 m/s', 'E 3,5 m/s', 'E-SE 2,0 m/s']);
        expect(linha('visibilidade')).toEqual(['24 km ou mais', '24 km ou mais', '24 km ou mais']);
        expect(q.principais.find((l) => l.chave === 'tempo').quebra).toBe(true);
        expect(resumoDaEspiada(q)).toEqual({ tempo: 'Nublado · 13 a 25 °C', vento: 'Ventos NE 1,8 m/s · 0 mm' });
    });

    it('um dia calmo diz "Vento calmo" na espiada, e não "Ventos calmo"', () => {
        const serie = serieSintetica('2026-09-24', 1, { wind_speed_10m: 0, wind_direction_10m: 90, temperature_2m: 20 });
        const q = montarQuadro({ dataD: '2026-09-24', datas: ['2026-09-24'], previsao: { celula: { lat: 0, lng: 0 }, noAlcance: ['2026-09-24'], serie, rodada: null } });
        expect(resumoDaEspiada(q).vento).toBe('Vento calmo · 0 mm');
        expect(q.principais.find((l) => l.chave === 'vento').celulas[0].texto).toBe('calmo');
    });

    it('o carimbo diz o modelo, a rodada em P e o ponto que saiu, nunca o clicado', () => {
        const texto = carimboDaFonte(previsao);
        expect(texto).toBe('Modelo GFS (NOAA), rodada de 23/09 às 15:00h P. Ponto consultado: 45.1, 10.0 '
            + '(arredondado a 0,1°), altitude de referência 37 m.');
        expect(carimboDaFonte({ ...previsao, rodada: null })).toMatch(/rodada não informada/);
    });

    it('o CSV leva o ponto, o fuso, a fonte, a licença e a ressalva', () => {
        const q = montarQuadro({ dataD: DATAS[0], datas: DATAS, previsao });
        const csv = tabelaCsv(q, { ponto: { lat: -30.300575, lng: -53.4 }, previsao });
        // Every cell quoted (`escapeCsvCell`), and a plain negative number keeps no apostrophe.
        expect(csv).toContain('"Latitude","-30.300575"');
        expect(csv).toContain('Hora de Brasília (P, UTC−3)');
        expect(csv).toContain('CC BY 4.0');
        expect(csv).toContain('"NE 1,8 m/s"');
        expect(csv).toMatch(/neblina de vale/);
        expect(nomeDoArquivoCsv('2026-09-24', { lat: -15.78, lng: -47.929166 }))
            .toBe('meteorologia_2026-09-24_-15.78000_-47.92917.csv');
    });
});
