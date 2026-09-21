// Path: tests/unit/pdf-declara-o-instante-temporal.test.js

/**
 * @fileoverview O PDF EXPORTADO COM O TEMPORAL LIGADO NAO DIZIA QUE INSTANTE RETRATAVA
 * (achado V8).
 *
 * O DEFEITO. Com a linha do tempo ligada, a folha impressa traz so as feicoes validas na celula
 * corrente: e' um RECORTE do dado, e ate 2026-09-21 ele saia sem declaracao nenhuma. Quem recebe
 * a carta impressa nao tem como distinguir "esta feicao nao existe" de "esta feicao nao valia
 * naquele instante", e a carta nao carrega nada que permita refazer a pergunta.
 *
 * A MONTAGEM DO TEXTO E' PURA (`temporalStampText`) porque ela e' a parte que erra, e e' a mesma
 * nos DOIS motores do mesmo painel: o GDAL, da folha unica, e o jsPDF, do mosaico. O rotulo sai
 * pela MESMA funcao da regua da barra (`formatTimelineLabel`), entao um mapa em modo RELATIVO
 * imprime "D+3" como a tela mostra, em vez de uma data absoluta que o leitor teria de converter.
 *
 * O QUE ESTE ARQUIVO PRENDE
 *  - o texto, nos dois modos e no desfecho nulo (temporal desligado, cursor nao numerico);
 *  - que o selo chega ao desenho do MOSAICO (`drawMosaicCartographicOverlay`) mesmo SEM legenda,
 *    porque a declaracao de recorte temporal nao depende de haver legenda;
 *  - que ele chega tambem a CAPA do mosaico (`drawCoverPage`), que e' a unica pagina lida antes
 *    de montar as folhas.
 *
 * O QUE ELE NAO ALCANCA, declarado: `composeLayout`, o caminho da folha unica, que constroi um
 * `document.createElement('canvas')` de verdade e mede texto. A parte dele que erra (o texto) e'
 * a mesma funcao pura testada aqui, e a fiacao e' uma linha de opcao.
 */

import { describe, it, expect } from 'vitest';
import {
    temporalStampText,
    drawMosaicCartographicOverlay,
} from '../../src/js/import_export/pdf-cartographic-elements.js';
import { drawCoverPage } from '../../src/js/import_export/pdf-mosaic-pages.js';
import { TEMPORAL_MODES } from '../../src/js/temporal/temporal.constants.js';

const T = new Date(2024, 10, 20, 14, 30, 0).getTime(); // 20/11/2024 14:30 local

describe('temporalStampText', () => {
    it('devolve nulo com o temporal desligado, mesmo com um cursor valido', () => {
        expect(temporalStampText(false, T, { unidade: 'HORA' })).toBeNull();
    });

    it('devolve nulo quando o cursor nao e um instante', () => {
        expect(temporalStampText(true, NaN, { unidade: 'HORA' })).toBeNull();
        expect(temporalStampText(true, undefined, { unidade: 'HORA' })).toBeNull();
        expect(temporalStampText(true, null, {})).toBeNull();
    });

    it('no modo absoluto imprime a data e a hora que a regua mostra', () => {
        const texto = temporalStampText(true, T, { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'HORA' });
        expect(texto).toBe('Instante retratado: 20/11/2024 14:30');
    });

    it('com unidade DIA imprime so a data, como a regua', () => {
        const texto = temporalStampText(true, T, { modo: TEMPORAL_MODES.ABSOLUTO, unidade: 'DIA' });
        expect(texto).toBe('Instante retratado: 20/11/2024');
    });

    it('no modo RELATIVO imprime D+N, e nao a data absoluta', () => {
        // E' esta metade que uma reescrita perde: imprimir a data num exercicio ancorado no Dia D
        // obriga o leitor a fazer a conta que a tela ja fez por ele.
        const origem = new Date(2024, 10, 17, 14, 30, 0).getTime();
        const texto = temporalStampText(true, T, {
            modo: TEMPORAL_MODES.RELATIVO,
            origem,
            unidade: 'DIA',
        });
        expect(texto).toBe('Instante retratado: D+3');
    });

    it('BORDA: contexto ausente nao lanca, e cai no formato absoluto padrao', () => {
        expect(temporalStampText(true, T, undefined)).toContain('20/11/2024');
        expect(temporalStampText(true, T, null)).toContain('20/11/2024');
    });

    it('BORDA: epoch zero e instante legitimo, nao ausencia', () => {
        expect(temporalStampText(true, 0, { unidade: 'HORA' })).not.toBeNull();
    });
});

// ============================================================================
// O selo chegando ao desenho
// ============================================================================

/** Contexto 2D de mentira: registra texto e geometria, como o das outras suites de PDF. */
function makeCtx() {
    const calls = [];
    let tx = 0;
    let ty = 0;
    const stack = [];
    return {
        calls,
        fillStyle: '', strokeStyle: '', font: '', lineWidth: 0,
        textAlign: '', textBaseline: '',
        save() { stack.push([tx, ty]); },
        restore() { const s = stack.pop(); if (s) { tx = s[0]; ty = s[1]; } },
        translate(x, y) { tx += x; ty += y; },
        scale() {},
        rotate() {},
        beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
        arc() {}, fill() {}, stroke() {},
        strokeRect() {}, fillRect() {},
        drawImage() {},
        fillText(text, x, y) { calls.push({ text, x: tx + x, y: ty + y }); },
        measureText(t) { return { width: String(t).length * 6 }; },
    };
}

const textos = (ctx) => ctx.calls.map((c) => c.text);

const overlayArgs = (over = {}) => ({
    offsetX: 0,
    offsetY: 0,
    mosaicW: 2000,
    mosaicH: 1400,
    frameInset: 0,
    title: null,
    showNorthArrow: false,
    showScaleBar: false,
    showLegend: false,
    featuresByType: {},
    scale: '1:25000',
    dpi: 200,
    ...over,
});

describe('drawMosaicCartographicOverlay escreve o instante', () => {
    it('desenha o selo mesmo SEM legenda, titulo, escala ou rosa dos ventos', () => {
        const ctx = makeCtx();
        drawMosaicCartographicOverlay(ctx, overlayArgs({ temporalStamp: 'Instante retratado: D+3' }));
        expect(textos(ctx)).toContain('Instante retratado: D+3');
    });

    it('CONTROLE DE VACUO: sem selo, o desenho fica mudo', () => {
        const ctx = makeCtx();
        drawMosaicCartographicOverlay(ctx, overlayArgs({ temporalStamp: null }));
        expect(ctx.calls).toEqual([]);
    });

    it('o selo fica no rodape CENTRAL, longe da escala (esquerda) e da legenda (direita)', () => {
        const ctx = makeCtx();
        drawMosaicCartographicOverlay(ctx, overlayArgs({
            temporalStamp: 'Instante retratado: 20/11/2024 14:30',
            showScaleBar: true,
            showLegend: true,
            featuresByType: { point: { count: 3, color: '#123456' } },
        }));
        const selo = ctx.calls.find((c) => c.text.startsWith('Instante retratado'));
        expect(selo).toBeDefined();
        // Horizontalmente centrado (o overlay e desenhado em unidades de 200 DPI: uiScale = 1).
        expect(selo.x).toBeCloseTo(1000, 0);
        // E no terco inferior da moldura.
        expect(selo.y).toBeGreaterThan(1400 * 0.66);
        expect(selo.y).toBeLessThan(1400);
    });
});

// ============================================================================
// A capa do mosaico
// ============================================================================

/** Documento jsPDF de mentira: so o que `drawCoverPage` usa. */
function makeDoc() {
    const texts = [];
    return {
        texts,
        setFont() {}, setFontSize() {}, setLineWidth() {},
        setTextColor() {}, setDrawColor() {}, setFillColor() {},
        line() {}, rect() {}, roundedRect() {}, triangle() {},
        splitTextToSize(t) { return [t]; },
        text(t, x, y) { texts.push({ t: Array.isArray(t) ? t.join(' ') : t, x, y }); },
    };
}

const coverArgs = (over = {}) => ({
    rows: 2, cols: 3, scaleLabel: '1:25.000', dpi: 300, orientation: 'landscape',
    title: 'Operação', pageW: 297, pageH: 210, ...over,
});

describe('drawCoverPage declara o instante', () => {
    it('escreve o selo na capa, que e a unica pagina lida antes de montar as folhas', () => {
        const doc = makeDoc();
        drawCoverPage(doc, coverArgs({ temporalStamp: 'Instante retratado: D+3' }));
        expect(doc.texts.map((x) => x.t)).toContain('Instante retratado: D+3');
    });

    it('CONTROLE DE VACUO: sem selo, nada com esse texto aparece', () => {
        const doc = makeDoc();
        drawCoverPage(doc, coverArgs());
        expect(doc.texts.some((x) => String(x.t).includes('Instante retratado'))).toBe(false);
        // E a capa continua desenhando o resto dela (o controle nao esta medindo uma capa vazia).
        expect(doc.texts.some((x) => String(x.t).includes('Mosaico para impressão'))).toBe(true);
    });

    it('CENSO: os DOIS motores do painel pedem o selo pelo mesmo caminho', async () => {
        // A fiacao e' uma linha em cada motor, e nenhum teste de node alcanca `composeLayout`
        // (ele constroi um canvas de verdade). Sem esta assercao, o motor da folha unica poderia
        // perder o selo sem que nada ficasse vermelho, e a divergencia entre os dois motores e'
        // exatamente a forma do defeito que o achado V8 descreve.
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const codigo = readFileSync(
            fileURLToPath(new URL('../../src/js/import_export/pdf-export.tab.js', import.meta.url)),
            'utf8',
        );
        expect(codigo.length).toBeGreaterThan(1000); // controle de vacuo
        const pedidos = codigo.match(/temporalStamp:\s*this\._temporalStamp\(\)/g) || [];
        expect(pedidos).toHaveLength(2); // folha unica (composeLayout) + mosaico (exportMosaicPdf)
    });

    it('o selo nao empurra os passos de montagem para fora da pagina', () => {
        const comSelo = makeDoc();
        drawCoverPage(comSelo, coverArgs({ temporalStamp: 'Instante retratado: 20/11/2024 14:30' }));
        const ultimo = comSelo.texts[comSelo.texts.length - 1];
        expect(ultimo.y).toBeLessThan(210);
    });
});
