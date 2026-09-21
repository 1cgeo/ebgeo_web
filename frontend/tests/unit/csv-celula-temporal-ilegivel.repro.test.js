// Path: tests/unit/csv-celula-temporal-ilegivel.repro.test.js

/**
 * @fileoverview REPRO do achado I5 da auditoria do sistema temporal
 * (2026-09-21): a célula temporal ilegível do CSV sumia DUAS vezes.
 *
 * A causa: a coluna mapeada como temporal é RESERVADA, isto é, ela é retirada
 * do laço que copia as demais colunas para os atributos da feição, porque o
 * valor dela vai virar a janela de validade. Quando o valor não era legível ele
 * não virava janela, e como a coluna já estava reservada ele também não sobrava
 * como atributo: o texto que a pessoa digitou desaparecia da importação inteira.
 * O aviso do painel, além disso, só contava coordenada inválida, de modo que
 * nada na tela dizia que alguma coisa tinha sido perdida.
 *
 * O conserto tem duas metades e as duas estão aqui: o texto cru sobrevive como
 * atributo comum sob o nome da própria coluna, e as duas degradações que uma
 * coluna temporal pode sofrer (não lida, e janela invertida) são CONTADAS, com
 * a frase que o painel mostra derivada da mesma contagem.
 */

import { describe, it, expect } from 'vitest';
import { csvToGeoJSON } from '../../src/js/import_export/csv/csv-to-geojson.js';
// A frase mora no modulo temporal, casa unica compartilhada com o importador geral.
import { describeTemporalIssues } from '../../src/js/temporal/temporal-import.js';

const baseConfig = {
    separator: ',',
    coordinateFormat: 'latlong_dd',
    columnMapping: { latitude: 'lat', longitude: 'lng' },
    temporalMapping: { inicio: 'inicio', fim: 'fim' },
};

const props = (r) => r.geoJSON.features[0].properties;

describe('I5: a célula temporal ilegível sobrevive como atributo', () => {
    it('lê a data brasileira e NÃO deixa a coluna virar atributo', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,05/11/2024,25/12/2024';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(props(r)).toEqual({
            nome: 'Alfa',
            temporalInicio: new Date(2024, 10, 5).getTime(),
            temporalFim: new Date(2024, 11, 25).getTime(),
        });
        expect(r.temporalIssues.naoLidas).toBe(0);
        expect(r.temporalIssues.invertidas).toBe(0);
    });

    it('o texto que não parseia continua na feição, sob o nome da coluna', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,ontem,25/12/2024';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(props(r).inicio).toBe('ontem');
        expect(props(r).temporalInicio).toBeUndefined();
        expect(props(r).temporalFim).toBe(new Date(2024, 11, 25).getTime());
        expect(r.temporalIssues.naoLidas).toBe(1);
    });

    it('conta uma vez por CÉLULA, em todas as linhas', () => {
        const csvText = [
            'nome,lat,lng,inicio,fim',
            'Alfa,-22.5,-44.5,ontem,amanha',
            'Bravo,-22.6,-44.6,05/11/2024,25/12/2024',
            'Charlie,-22.7,-44.7,sei la,25/12/2024',
        ].join('\n');
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(r.temporalIssues.naoLidas).toBe(3);
        expect(r.geoJSON.features).toHaveLength(3);
    });

    it('célula VAZIA é ausência, não degradação: não conta e não vira atributo', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,,';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(r.temporalIssues.naoLidas).toBe(0);
        expect(props(r)).toEqual({ nome: 'Alfa' });
    });

    it('o GDH que o produto escreve é lido, e não vira o ano 10800', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,010800MAR24,';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(props(r).temporalInicio).toBe(Date.UTC(2024, 2, 1, 8, 0));
        expect(r.temporalIssues.naoLidas).toBe(0);
    });
});

describe('I5 + M6: janela invertida no CSV', () => {
    it('descarta o fim, preserva o texto dele e conta a linha', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,25/12/2024,05/11/2024';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(props(r).temporalInicio).toBe(new Date(2024, 11, 25).getTime());
        expect(props(r).temporalFim).toBeUndefined();
        expect(props(r).fim).toBe('05/11/2024');
        expect(r.temporalIssues.invertidas).toBe(1);
        expect(r.temporalIssues.naoLidas).toBe(0);
    });

    it('janela em ordem sobrevive inteira', () => {
        const csvText = 'nome,lat,lng,inicio,fim\nAlfa,-22.5,-44.5,05/11/2024,25/12/2024';
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(r.temporalIssues.invertidas).toBe(0);
        expect(props(r).temporalFim).toBe(new Date(2024, 11, 25).getTime());
    });
});

describe('I5: o aviso do painel nasce da mesma contagem', () => {
    it('cala quando nada foi degradado', () => {
        expect(describeTemporalIssues({})).toEqual([]);
        expect(describeTemporalIssues({ naoLidas: 0, invertidas: 0 })).toEqual([]);
        expect(describeTemporalIssues()).toEqual([]);
    });

    it('nomeia a célula não lida, com singular e plural em pt-BR', () => {
        expect(describeTemporalIssues({ naoLidas: 1 })).toEqual([
            '1 célula de data não reconhecida: o texto foi mantido como atributo',
        ]);
        expect(describeTemporalIssues({ naoLidas: 4 })).toEqual([
            '4 células de data não reconhecidas: o texto foi mantido como atributo',
        ]);
    });

    it('nomeia a janela invertida, com singular e plural em pt-BR', () => {
        expect(describeTemporalIssues({ invertidas: 1 })).toEqual([
            '1 linha com fim anterior ao início: o fim foi descartado',
        ]);
        expect(describeTemporalIssues({ invertidas: 2 })).toEqual([
            '2 linhas com fim anterior ao início: o fim foi descartado',
        ]);
    });

    it('as duas juntas saem como duas frases, na ordem declarada', () => {
        expect(describeTemporalIssues({ naoLidas: 2, invertidas: 1 }))
            .toHaveLength(2);
    });

    it('a saída de uma importação real alimenta a frase sem tradução no meio', () => {
        const csvText = [
            'nome,lat,lng,inicio,fim',
            'Alfa,-22.5,-44.5,ontem,25/12/2024',
            'Bravo,-22.6,-44.6,25/12/2024,05/11/2024',
        ].join('\n');
        const r = csvToGeoJSON({ ...baseConfig, csvText });
        expect(describeTemporalIssues(r.temporalIssues)).toEqual([
            '1 célula de data não reconhecida: o texto foi mantido como atributo',
            '1 linha com fim anterior ao início: o fim foi descartado',
        ]);
    });
});
