// Path: tests/unit/importacao-degradacao-temporal-avisa.repro.test.js

/**
 * @fileoverview REPRO da metade que faltava dos achados M6 (= I9), I2 e M4 da
 * auditoria do sistema temporal (2026-09-21): a importação GERAL degradava em
 * SILÊNCIO.
 *
 * O contador existia e ninguém o lia. `extractTemporalProperties` passou a
 * descartar o fim de uma janela invertida e a recusar a célula que nenhum
 * leitor entende, e ganhou um `report` opcional que conta as duas coisas; mas
 * `import.control.js` chamava a função SEM o report, então o GeoJSON, o KML e o
 * GPX perdiam dado exatamente como antes, sem uma palavra na tela. Só o CSV
 * falava, porque o painel dele conta por conta própria.
 *
 * As duas metades que esta suíte prende:
 *  - a PURA: o report é UM POR LOTE e acumula ao longo das N feições, e as
 *    frases saem da MESMA função que o CSV usa, que mora em
 *    `temporal/temporal-import.js` e não no módulo de CSV (o importador geral
 *    não pode depender do caminho de CSV para dizer o que perdeu). Inclui a
 *    borda do lote LIMPO, que precisa não avisar nada: aviso que aparece quando
 *    nada aconteceu treina a ignorar aviso;
 *  - a FIAÇÃO, por leitura ESTRUTURAL do texto de `import.control.js`. Aquele
 *    módulo arrasta JSZip, shpjs, togeojson e a store inteira, então carregá-lo
 *    aqui mediria os duplos de teste e não o produto; o que precisa ser verdade
 *    é que o report nasce no lote, viaja até o leitor e é lido uma vez no fim.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    extractTemporalProperties,
    describeTemporalIssues,
} from '../../src/js/temporal/temporal-import.js';

// ============================================================================
// A parte PURA: um report por lote
// ============================================================================

/** Roda um lote de linhas importadas como `importGeoJSON` roda: um report só. */
function importarLote(linhas) {
    const report = { naoLidas: 0, invertidas: 0 };
    const saida = linhas.map((props) => extractTemporalProperties(props, report));
    return { report, saida };
}

describe('o report é UM por lote e acumula ao longo das feições', () => {
    it('lote LIMPO não conta nada e não diz nada (a borda)', () => {
        const { report, saida } = importarLote([
            { begin: '05/11/2024', end: '25/12/2024' },
            { when: '2024-05-05T12:00:00Z' },
            { nome: 'sem tempo nenhum' },
            { begin: '', end: null },
        ]);
        expect(report).toEqual({ naoLidas: 0, invertidas: 0 });
        expect(describeTemporalIssues(report)).toEqual([]);
        expect(saida[0].temporalFim).toBe(new Date(2024, 11, 25).getTime());
    });

    it('lote MISTO soma as duas degradações ao longo das linhas', () => {
        const { report } = importarLote([
            { begin: '05/11/2024', end: '25/12/2024' },   // limpa
            { begin: '25/12/2024', end: '05/11/2024' },   // invertida
            { begin: 'ontem', end: '25/12/2024' },        // uma célula ilegível
            { begin: 'ontem', end: 'amanha' },            // duas células ilegíveis
            { begin: '010800MAR24' },                     // GDH, legítimo
            { begin: 9000, end: 8000 },                   // invertida
        ]);
        expect(report).toEqual({ naoLidas: 3, invertidas: 2 });
    });

    it('a contagem do lote é a soma, não o último valor visto', () => {
        // Um report POR FEIÇÃO daria 1 e 1 aqui; o de lote dá 3 e 2, e é essa
        // diferença que o aviso precisa mostrar num arquivo de milhares de linhas.
        const { report } = importarLote([
            { begin: 'lixo' }, { begin: 'lixo' }, { begin: 'lixo' },
            { begin: 5000, end: 1000 }, { begin: 5000, end: 1000 },
        ]);
        expect(report.naoLidas).toBe(3);
        expect(report.invertidas).toBe(2);
    });

    it('o lote misto vira DUAS frases, e o limpo vira nenhuma', () => {
        const misto = importarLote([
            { begin: 'ontem', end: '25/12/2024' },
            { begin: 5000, end: 1000 },
        ]).report;
        expect(describeTemporalIssues(misto)).toEqual([
            '1 célula de data não reconhecida: o texto foi mantido como atributo',
            '1 linha com fim anterior ao início: o fim foi descartado',
        ]);

        const limpo = importarLote([{ begin: 1000, end: 5000 }]).report;
        expect(describeTemporalIssues(limpo)).toEqual([]);
    });

    it('a frase acompanha o plural de um lote grande', () => {
        const { report } = importarLote(
            Array.from({ length: 7 }, () => ({ begin: 'lixo' }))
        );
        expect(describeTemporalIssues(report)).toEqual([
            '7 células de data não reconhecidas: o texto foi mantido como atributo',
        ]);
    });

    it('o lote degradado ainda IMPORTA a feição, com o que sobrou', () => {
        // A degradação não pode virar descarte: o início continua valendo.
        const { saida } = importarLote([{ begin: 5000, end: 1000 }]);
        expect(saida[0]).toEqual({ temporalInicio: 5000 });
    });

    it('report ausente não quebra nem conta (o chamador de uma feição só)', () => {
        expect(() => extractTemporalProperties({ begin: 5000, end: 1000 })).not.toThrow();
        expect(describeTemporalIssues(null)).toEqual([]);
        expect(describeTemporalIssues(undefined)).toEqual([]);
    });
});

// ============================================================================
// A FIAÇÃO, por leitura estrutural
// ============================================================================

const CONTROL_PATH = fileURLToPath(
    new URL('../../src/js/import_export/import.control.js', import.meta.url)
);
const fonte = readFileSync(CONTROL_PATH, 'utf8');

describe('a fiação de import.control.js', () => {
    it('CONTROLE: o arquivo foi lido e é o que se pensa', () => {
        // Sem isto, um caminho errado devolveria string vazia e todo `toMatch`
        // abaixo reprovaria por outro motivo, ou um `not.toMatch` passaria vazio.
        expect(fonte.length).toBeGreaterThan(1000);
        expect(fonte).toContain('async importGeoJSON(');
        expect(fonte).toContain('async prepareFeatureForImportAsync(');
    });

    it('importa a frase do módulo TEMPORAL, nunca do módulo de CSV', () => {
        expect(fonte).toMatch(
            /import\s*\{[^}]*\bdescribeTemporalIssues\b[^}]*\}\s*from\s*'@js\/temporal\/temporal-import\.js'/
        );
        expect(fonte).not.toMatch(/from\s*'[^']*csv-to-geojson\.js'/);
    });

    it('importa showWarning, que é o canal do aviso não fatal', () => {
        expect(fonte).toMatch(
            /import\s*\{[^}]*\bshowWarning\b[^}]*\}\s*from\s*'@utils\/toast_service\.js'/
        );
    });

    it('o report NASCE no lote, zerado nos dois campos', () => {
        expect(fonte).toMatch(
            /const\s+temporalReport\s*=\s*\{\s*naoLidas:\s*0\s*,\s*invertidas:\s*0\s*\}/
        );
    });

    it('o report VIAJA: o laço por feição o passa adiante', () => {
        expect(fonte).toMatch(
            /prepareFeatureForImportAsync\(\s*feature\s*,\s*targetType\s*,\s*typeCounters\s*,\s*importLayerId\s*,\s*temporalReport\s*,?\s*\)/
        );
        expect(fonte).toMatch(
            /prepareFeatureForImportAsync\([^)]*temporalReport\s*=\s*null\s*\)/
        );
    });

    it('o report CHEGA ao leitor, que é quem o incrementa', () => {
        expect(fonte).toMatch(
            /extractTemporalProperties\(\s*temporalSource\s*,\s*temporalReport\s*\)/
        );
    });

    it('o report é LIDO uma vez, e cada frase vira um aviso', () => {
        expect(fonte).toMatch(
            /for\s*\(\s*const\s+\w+\s+of\s+describeTemporalIssues\(\s*temporalReport\s*\)\s*\)/
        );
        expect(fonte).toMatch(/showWarning\(\s*\w+\s*\)/);
    });

    it('o aviso mora DENTRO de importGeoJSON, que é o lote e tem três chamadores', () => {
        // Pendurá-lo num dos chamadores (o seletor de arquivo, ou uma das duas
        // chamadas da aba de importação) deixaria os outros dois mudos.
        const inicio = fonte.indexOf('async importGeoJSON(');
        const leitura = fonte.indexOf('describeTemporalIssues(temporalReport)');
        const nascimento = fonte.indexOf('const temporalReport =');
        expect(inicio).toBeGreaterThan(-1);
        expect(nascimento).toBeGreaterThan(inicio);
        expect(leitura).toBeGreaterThan(nascimento);
    });
});
