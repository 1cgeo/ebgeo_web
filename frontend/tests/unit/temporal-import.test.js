// Path: tests/unit/temporal-import.test.js

/**
 * @fileoverview Leitura temporal da importação (GeoJSON, CSV, KML, GPX).
 *
 * REESCRITO em 2026-09-21 pelo achado I10 da auditoria do sistema temporal. A
 * versão anterior comparava toda data esperada contra `Date.parse(...)`, que é
 * o MESMO instrumento que estava sob teste: o leitor podia estar lendo
 * `05/11/2024` como 11 de maio e o teste continuava verde, porque os dois lados
 * da igualdade erravam junto. Aqui todo esperado é um epoch literal, montado
 * com `new Date(ano, mes, dia, ...)` para data local ou `Date.UTC` para
 * instante zulu, de modo que o teste não depende do fuso de quem o roda (nesta
 * máquina, UTC-3).
 *
 * O que esta suíte PRENDE, além da leitura de cada formato real de entrada:
 *  - I3: ponto-chave de trajetória sem coordenada é DESCARTADO. `Number(null)`
 *    e `Number('')` valem 0, e 0 é uma latitude e uma longitude perfeitamente
 *    finitas (golfo da Guiné), então o ponto passava em toda validação a jusante
 *    e a feição móvel atravessava o Atlântico na reprodução;
 *  - M6 (= I9): janela com fim ANTERIOR ao início perde o fim, e a perda é
 *    CONTÁVEL. Com o fim antes do início nenhum cursor satisfaz o predicado de
 *    visibilidade: a feição sumia para sempre do 3D, do 360 e da legenda do PDF
 *    enquanto continuava desenhada no mapa;
 *  - I10c: a precedência entre chaves concorrentes (`when` contra `begin`) era a
 *    ordem de inserção do objeto, ou seja, as mesmas duas colunas em outra ordem
 *    produziam outra janela. Agora é declarada e está asserida nos dois sentidos
 *    de inserção.
 */

import { describe, it, expect } from 'vitest';
import {
    extractTemporalProperties,
    extractGpxTimes,
    buildTrajectoryFromGpxFeature,
    sanitizeImportedTrajectory,
    START_KEY_ORDER,
    END_KEY_ORDER,
    INSTANT_KEY_ORDER,
    TEMPORAL_SOURCE_KEYS,
} from '../../src/js/temporal/temporal-import.js';

// Instantes de controle, todos literais.
const JAN_01_2024_LOCAL = new Date(2024, 0, 1).getTime();
const FEV_01_2024_LOCAL = new Date(2024, 1, 1).getTime();
const MAR_01_2024_LOCAL = new Date(2024, 2, 1).getTime();
const MAR_10_2024_LOCAL = new Date(2024, 2, 10).getTime();
const MAI_05_2024_ZULU = Date.UTC(2024, 4, 5, 12, 0);

// ============================================================================
// extractTemporalProperties — um caso por formato real de entrada
// ============================================================================

describe('extractTemporalProperties — formatos de entrada', () => {
    it('devolve {} quando não há dado temporal', () => {
        expect(extractTemporalProperties({ nome: 'x' })).toEqual({});
        expect(extractTemporalProperties(null)).toEqual({});
        expect(extractTemporalProperties('texto')).toEqual({});
    });

    it('lê os nomes canônicos em camelCase, com ISO sem fuso como LOCAL', () => {
        const out = extractTemporalProperties({
            temporalInicio: '2024-01-01T00:00',
            temporalFim: '2024-02-01T00:00',
        });
        expect(out).toEqual({ temporalInicio: JAN_01_2024_LOCAL, temporalFim: FEV_01_2024_LOCAL });
    });

    it('lê as variantes snake_case com epoch ms', () => {
        expect(extractTemporalProperties({ temporal_inicio: 1000, temporal_fim: 2000 }))
            .toEqual({ temporalInicio: 1000, temporalFim: 2000 });
    });

    it('lê TimeSpan begin/end do KML como só-data LOCAL', () => {
        const out = extractTemporalProperties({ begin: '2024-03-01', end: '2024-03-10' });
        expect(out).toEqual({ temporalInicio: MAR_01_2024_LOCAL, temporalFim: MAR_10_2024_LOCAL });
    });

    it('lê TimeStamp <when> do KML como instante de início, com o fuso escrito', () => {
        const out = extractTemporalProperties({ when: '2024-05-05T12:00:00Z' });
        expect(out.temporalInicio).toBe(MAI_05_2024_ZULU);
        expect(out.temporalFim).toBeUndefined();
    });

    it('lê a coluna de CSV em pt-BR com data brasileira', () => {
        const out = extractTemporalProperties({ dataInicio: '05/11/2024', dataFim: '25/12/2024' });
        expect(out).toEqual({
            temporalInicio: new Date(2024, 10, 5).getTime(),
            temporalFim: new Date(2024, 11, 25).getTime(),
        });
    });

    it('é insensível à caixa do nome da coluna', () => {
        expect(extractTemporalProperties({ BEGIN: 1000, END: 2000 }))
            .toEqual({ temporalInicio: 1000, temporalFim: 2000 });
        expect(extractTemporalProperties({ Data_Inicio: 1000 }))
            .toEqual({ temporalInicio: 1000 });
    });

    it('ignora valor ilegível e não inventa janela', () => {
        expect(extractTemporalProperties({ begin: 'not-a-date' })).toEqual({});
        expect(extractTemporalProperties({ begin: '' })).toEqual({});
        expect(extractTemporalProperties({ begin: null })).toEqual({});
    });

    it('uma coluna ilegível não impede outra, de pior posto, de valer', () => {
        // `temporalinicio` tem posto melhor que `start`, mas não é legível.
        const out = extractTemporalProperties({ temporalInicio: 'lixo', start: 1000 });
        expect(out).toEqual({ temporalInicio: 1000 });
    });
});

// ============================================================================
// I10c — precedência declarada entre chaves concorrentes
// ============================================================================

describe('I10c: precedência entre chaves concorrentes', () => {
    it('as listas de precedência estão publicadas e sem repetição', () => {
        for (const lista of [START_KEY_ORDER, END_KEY_ORDER, INSTANT_KEY_ORDER]) {
            expect(lista.length).toBeGreaterThan(0);
            expect(new Set(lista).size).toBe(lista.length);
            expect(lista.every((k) => k === k.toLowerCase())).toBe(true);
        }
        // As três juntas são exatamente o vocabulário exportado.
        expect(TEMPORAL_SOURCE_KEYS.size)
            .toBe(START_KEY_ORDER.length + END_KEY_ORDER.length + INSTANT_KEY_ORDER.length);
    });

    it('chave de INÍCIO vence chave de INSTANTE, nas duas ordens de inserção', () => {
        const comWhenAntes = extractTemporalProperties({ when: 1000, begin: 2000 });
        const comBeginAntes = extractTemporalProperties({ begin: 2000, when: 1000 });
        expect(comWhenAntes).toEqual({ temporalInicio: 2000 });
        expect(comBeginAntes).toEqual({ temporalInicio: 2000 });
    });

    it('o nome canônico vence o estrangeiro, nas duas ordens de inserção', () => {
        expect(extractTemporalProperties({ start: 1000, temporalInicio: 2000 }))
            .toEqual({ temporalInicio: 2000 });
        expect(extractTemporalProperties({ temporalInicio: 2000, start: 1000 }))
            .toEqual({ temporalInicio: 2000 });
        expect(extractTemporalProperties({ end: 9000, temporalFim: 8000 }))
            .toEqual({ temporalFim: 8000 });
        expect(extractTemporalProperties({ temporalFim: 8000, end: 9000 }))
            .toEqual({ temporalFim: 8000 });
    });

    it('o nome em pt-BR vence o estrangeiro, nas duas ordens de inserção', () => {
        expect(extractTemporalProperties({ start: 1000, inicio: 2000 }))
            .toEqual({ temporalInicio: 2000 });
        expect(extractTemporalProperties({ inicio: 2000, start: 1000 }))
            .toEqual({ temporalInicio: 2000 });
    });

    it('o instante só preenche o início quando nenhuma chave de início valeu', () => {
        expect(extractTemporalProperties({ when: 1000, end: 5000 }))
            .toEqual({ temporalInicio: 1000, temporalFim: 5000 });
        expect(extractTemporalProperties({ timestamp: 1000, when: 2000 }))
            .toEqual({ temporalInicio: 2000 });
    });
});

// ============================================================================
// M6 (= I9) — janela invertida
// ============================================================================

describe('M6/I9: fim anterior ao início perde o fim, e a perda é contável', () => {
    it('descarta o fim e mantém o início', () => {
        const out = extractTemporalProperties({ begin: 5000, end: 1000 });
        expect(out).toEqual({ temporalInicio: 5000 });
        expect(out.temporalFim).toBeUndefined();
    });

    it('não troca os dois nomes: 5000 não vira fim', () => {
        const out = extractTemporalProperties({ begin: 5000, end: 1000 });
        expect(out.temporalFim).not.toBe(5000);
    });

    it('fim IGUAL ao início é janela legítima e sobrevive', () => {
        expect(extractTemporalProperties({ begin: 5000, end: 5000 }))
            .toEqual({ temporalInicio: 5000, temporalFim: 5000 });
    });

    it('o importador consegue CONTAR a degradação', () => {
        const report = {};
        extractTemporalProperties({ begin: 5000, end: 1000 }, report);
        extractTemporalProperties({ begin: 1000, end: 5000 }, report);
        extractTemporalProperties({ begin: 9000, end: 8000 }, report);
        expect(report.invertidas).toBe(2);
    });

    it('conta também a célula reconhecida e ilegível, e não conta a vazia', () => {
        const report = {};
        extractTemporalProperties({ begin: 'lixo', end: '25/13/2024' }, report);
        extractTemporalProperties({ begin: '', end: null }, report);
        expect(report.naoLidas).toBe(2);
        expect(report.invertidas).toBeUndefined();
    });

    it('sem report, a degradação continua acontecendo sem lançar', () => {
        expect(() => extractTemporalProperties({ begin: 5000, end: 1000 })).not.toThrow();
    });
});

// ============================================================================
// GPX
// ============================================================================

describe('extractGpxTimes', () => {
    it('lê coordinateProperties.times', () => {
        const f = { properties: { coordinateProperties: { times: ['a', 'b'] } } };
        expect(extractGpxTimes(f)).toEqual(['a', 'b']);
    });
    it('cai para coordTimes e depois times', () => {
        expect(extractGpxTimes({ properties: { coordTimes: ['x'] } })).toEqual(['x']);
        expect(extractGpxTimes({ properties: { times: ['y'] } })).toEqual(['y']);
    });
    it('devolve [] quando não há', () => {
        expect(extractGpxTimes({ properties: {} })).toEqual([]);
        expect(extractGpxTimes({})).toEqual([]);
    });
});

describe('buildTrajectoryFromGpxFeature', () => {
    it('pareia os vértices da LineString com os tempos deles', () => {
        const feature = {
            geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
            properties: {
                coordinateProperties: {
                    times: ['2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z'],
                },
            },
        };
        const traj = buildTrajectoryFromGpxFeature(feature);
        expect(traj).toHaveLength(2);
        expect(traj[0]).toEqual({ t: Date.UTC(2024, 0, 1, 0, 0), lng: 0, lat: 0 });
        expect(traj[1]).toEqual({ t: Date.UTC(2024, 0, 1, 1, 0), lng: 10, lat: 10 });
    });

    it('descarta o vértice sem tempo válido', () => {
        const feature = {
            geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
            properties: { coordTimes: ['2024-01-01T00:00:00Z', 'bad'] },
        };
        expect(buildTrajectoryFromGpxFeature(feature)).toHaveLength(1);
    });

    it('devolve [] para geometria que não é trilha', () => {
        expect(buildTrajectoryFromGpxFeature({ geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} })).toEqual([]);
        expect(buildTrajectoryFromGpxFeature({})).toEqual([]);
    });

    it('dizima o sub-minuto para a resolução de um minuto (mantendo as pontas)', () => {
        const secs = [0, 10, 20, 30, 60, 120];
        const feature = {
            geometry: { type: 'LineString', coordinates: secs.map((_, i) => [i, i]) },
            properties: {
                coordinateProperties: {
                    times: secs.map((s) => new Date(s * 1000).toISOString()),
                },
            },
        };
        expect(buildTrajectoryFromGpxFeature(feature).map((k) => k.t)).toEqual([0, 60_000, 120_000]);
    });
});

// ============================================================================
// I3 — coordenada de ponto-chave
// ============================================================================

describe('I3: ponto-chave sem coordenada é descartado, nunca zerado', () => {
    it('devolve [] para o que não é array', () => {
        expect(sanitizeImportedTrajectory(null)).toEqual([]);
        expect(sanitizeImportedTrajectory(undefined)).toEqual([]);
        expect(sanitizeImportedTrajectory('x')).toEqual([]);
    });

    it('passa uma trajetória numérica limpa (idempotente)', () => {
        const traj = [
            { t: 0, lng: 1, lat: 2 },
            { t: 120_000, lng: 3, lat: 4 },
        ];
        expect(sanitizeImportedTrajectory(traj)).toEqual(traj);
    });

    it('lê tempo e coordenada em texto', () => {
        const out = sanitizeImportedTrajectory([
            { t: '2024-01-01T00:00:00Z', lng: '10', lat: '20' },
            { t: '2024-01-01T00:02:00Z', lng: ' 11.5 ', lat: 21 },
        ]);
        expect(out).toEqual([
            { t: Date.UTC(2024, 0, 1, 0, 0), lng: 10, lat: 20 },
            { t: Date.UTC(2024, 0, 1, 0, 2), lng: 11.5, lat: 21 },
        ]);
    });

    it('DESCARTA o ponto-chave cuja coordenada é nula, vazia ou não numérica', () => {
        const entrada = [
            { t: 0, lng: 1, lat: 2 },
            { t: 30_000, lng: null, lat: 10 },
            { t: 60_000, lng: 10, lat: undefined },
            { t: 90_000, lng: '', lat: 10 },
            { t: 100_000, lng: '   ', lat: 10 },
            { t: 110_000, lng: 'abc', lat: 10 },
            { t: 115_000, lng: false, lat: 10 },
            { t: 118_000, lng: [], lat: 10 },
            { t: 119_000, lng: {}, lat: 10 },
            { t: 180_000, lng: 3, lat: 4 },
        ];
        const out = sanitizeImportedTrajectory(entrada);
        expect(out).toEqual([
            { t: 0, lng: 1, lat: 2 },
            { t: 180_000, lng: 3, lat: 4 },
        ]);
        // Nenhum ponto-chave INVENTADO em 0,0.
        expect(out.some((k) => k.lng === 0 && k.lat === 0)).toBe(false);
    });

    it('um ponto-chave sem coordenada nenhuma não vira a origem do mapa', () => {
        expect(sanitizeImportedTrajectory([{ t: 1000 }])).toEqual([]);
        expect(sanitizeImportedTrajectory([{ t: 1000, lng: null, lat: null }])).toEqual([]);
    });

    it('descarta o ponto-chave sem tempo válido', () => {
        const out = sanitizeImportedTrajectory([
            { t: 0, lng: 1, lat: 2 },
            { t: 'not-a-date', lng: 5, lat: 6 },
            { t: 60_000, lng: NaN, lat: 6 },
            { t: 120_000, lng: 7, lat: 8 },
        ]);
        expect(out.map((k) => k.t)).toEqual([0, 120_000]);
    });

    it('dizima o sub-minuto para a resolução de um minuto', () => {
        const traj = [0, 10_000, 20_000, 60_000, 120_000].map((t) => ({ t, lng: t, lat: t }));
        expect(sanitizeImportedTrajectory(traj).map((k) => k.t)).toEqual([0, 60_000, 120_000]);
    });
});
