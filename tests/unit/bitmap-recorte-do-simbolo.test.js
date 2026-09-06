// Path: tests/unit/bitmap-recorte-do-simbolo.test.js

/**
 * O bitmap do simbolo militar e o da medida de coordenacao passaram a ser RECORTADOS no
 * desenho: o quadro de destino segue dando a escala, mas o canvas deixou de ser o quadro
 * inteiro e virou o tamanho ajustado, sem faixa transparente em volta.
 *
 * Isto importa porque a caixa de selecao e o clique sao o retangulo do bitmap: o quadro
 * de um simbolo mais largo que alto tinha um terco de altura vazio, e a caixa aparecia
 * bem maior que o desenho.
 *
 * Estes testes prendem as tres pecas puras da mudanca:
 * - `fitDrawSize`, o tamanho ajustado, que agora e tambem o do canvas;
 * - `iconOffsetFor`, o deslocamento que poe o ponto de ancoragem do DESENHO sobre a
 *   coordenada quando o meio do bitmap nao serve;
 * - `applyGeneratedBitmap`, o unico escritor das chaves de bitmap na feicao.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { fitDrawSize } from '@js/military_tools/svg-to-png.js';
import { iconOffsetFor } from '@js/military_tools/coordination_measure_tool/coordination_measure_generator.js';
import { COORDINATION_POINTS_CATALOG } from '@js/military_tools/coordination_measure_tool/coordination_points_catalog.js';
import { iconScreenQuad } from '@js/tool_manager/helpers/hit-test.model.js';
import {
    SYMBOL_BITMAP_VERSION,
    hasCurrentBitmap,
    applyGeneratedBitmap
} from '@js/military_tools/bitmap-version.js';

describe('fitDrawSize', () => {
    it('devolve o quadro inteiro quando a proporção é a mesma', () => {
        expect(fitDrawSize(200, 200, 100, 100)).toEqual({ width: 100, height: 100 });
        expect(fitDrawSize(88, 168, 44, 84)).toEqual({ width: 44, height: 84 });
        // Ate 1% de diferenca de proporcao o quadro vale como igual, que e a tolerancia
        // com que o gerador arredonda o canvas.
        expect(fitDrawSize(88, 168, 168, 320)).toEqual({ width: 168, height: 320 });
    });

    it('encosta na largura quando o desenho é mais largo que o quadro', () => {
        // Quadro amigo: 78 por 53 unidades num quadro de 100, e a altura sai proporcional.
        expect(fitDrawSize(78, 53, 100, 100)).toEqual({ width: 100, height: 68 });
    });

    it('encosta na altura quando o desenho é mais alto que o quadro', () => {
        expect(fitDrawSize(53, 78, 100, 100)).toEqual({ width: 68, height: 100 });
    });

    it('nunca devolve medida menor que um pixel', () => {
        // Um desenho muito achatado num quadro pequeno arredondaria para zero, e o
        // canvas de altura zero devolve um bitmap vazio.
        expect(fitDrawSize(1000, 1, 3, 3)).toEqual({ width: 3, height: 1 });
        expect(fitDrawSize(1, 1000, 3, 3)).toEqual({ width: 1, height: 3 });
    });

    it('recusa medida não finita ou não positiva, com o erro de sempre', () => {
        const invalidos = [0, -1, NaN, Infinity, null, undefined, '100'];

        for (const lixo of invalidos) {
            expect(() => fitDrawSize(lixo, 100, 100, 100), `original width ${lixo}`)
                .toThrow('Invalid image dimensions');
            expect(() => fitDrawSize(100, lixo, 100, 100), `original height ${lixo}`)
                .toThrow('Invalid image dimensions');
            expect(() => fitDrawSize(100, 100, lixo, 100), `target width ${lixo}`)
                .toThrow('Invalid image dimensions');
            expect(() => fitDrawSize(100, 100, 100, lixo), `target height ${lixo}`)
                .toThrow('Invalid image dimensions');
        }
    });

    it('cabe no quadro e ENCOSTA nele, que é o que faz o recorte', () => {
        const medida = fc.integer({ min: 1, max: 4000 });

        fc.assert(fc.property(medida, medida, medida, medida, (ow, oh, tw, th) => {
            const { width, height } = fitDrawSize(ow, oh, tw, th);

            expect(Number.isInteger(width)).toBe(true);
            expect(Number.isInteger(height)).toBe(true);
            expect(width).toBeGreaterThanOrEqual(1);
            expect(height).toBeGreaterThanOrEqual(1);
            expect(width).toBeLessThanOrEqual(tw);
            expect(height).toBeLessThanOrEqual(th);
            // Sem faixa transparente: um dos lados e o proprio quadro.
            expect(width === tw || height === th).toBe(true);
        }));
    });
});

describe('iconOffsetFor', () => {
    const quadro = { minX: -234, minY: -114, width: 468, height: 254 };

    it('devolve zero quando o ponto de ancoragem é o meio do bitmap', () => {
        expect(iconOffsetFor(quadro, { x: 0, y: 13 }, 0.212)).toEqual([0, 0]);
    });

    it('desce o ícone quando o desenho desce mais do que sobe', () => {
        // Meio do quadro em y = 13; a elipse esta em y = 0, acima dele. O icone tem de
        // descer 13 unidades de escala para a elipse subir ate a coordenada.
        expect(iconOffsetFor(quadro, { x: 0, y: 0 }, 0.212)).toEqual([0, 2.76]);
    });

    it('desloca também na horizontal, com sinal para a direita', () => {
        expect(iconOffsetFor({ minX: 0, minY: 0, width: 100, height: 100 }, { x: 10, y: 90 }, 2))
            .toEqual([80, -80]);
    });

    it('arredonda em duas casas, e não devolve zero negativo', () => {
        const offset = iconOffsetFor(
            { minX: 0, minY: 0, width: 100, height: 100 },
            { x: 50.001, y: 49.999 },
            1
        );

        expect(offset).toEqual([0, 0]);
        expect(Object.is(offset[0], -0)).toBe(false);
        expect(Object.is(offset[1], -0)).toBe(false);
    });

    it('vale [0, 0] sem ponto de ancoragem, ou com entrada inutilizável', () => {
        expect(iconOffsetFor(quadro, undefined, 0.212)).toEqual([0, 0]);
        expect(iconOffsetFor(quadro, null, 0.212)).toEqual([0, 0]);
        expect(iconOffsetFor(undefined, { x: 0, y: 0 }, 0.212)).toEqual([0, 0]);
        expect(iconOffsetFor(quadro, { x: 0, y: 0 }, NaN)).toEqual([0, 0]);
        expect(iconOffsetFor(quadro, { x: 0, y: 0 }, Infinity)).toEqual([0, 0]);
        expect(iconOffsetFor(quadro, { x: NaN, y: 0 }, 0.212)).toEqual([0, 0]);
        expect(iconOffsetFor({ minX: 0, minY: NaN, width: 10, height: 10 }, { x: 0, y: 0 }, 1))
            .toEqual([0, 0]);
    });
});

describe('applyGeneratedBitmap', () => {
    it('grava tamanho e carimba a versão do bitmap', () => {
        const properties = { id: 'a' };

        const devolvido = applyGeneratedBitmap(properties, { blob: {}, width: 100, height: 68 });

        expect(devolvido).toBe(properties);
        expect(properties.width).toBe(100);
        expect(properties.height).toBe(68);
        expect(properties.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);
    });

    it('não inventa razão de pixel nem âncora quando o gerador não os traz', () => {
        // E o caso do simbolo militar, que rasteriza 1:1 e ancora pelo meio.
        const properties = {};

        applyGeneratedBitmap(properties, { width: 100, height: 68 });

        expect('pixelRatio' in properties).toBe(false);
        expect('anchor' in properties).toBe(false);
    });

    it('grava razão de pixel e âncora quando o gerador os traz', () => {
        const properties = {};

        applyGeneratedBitmap(properties, {
            width: 99, height: 54, pixelRatio: 4, anchor: 'center'
        });

        expect(properties.pixelRatio).toBe(4);
        expect(properties.anchor).toBe('center');
    });

    it('ignora razão de pixel inválida, em vez de gravar lixo', () => {
        for (const lixo of [0, -2, NaN, 'quatro', null]) {
            const properties = { pixelRatio: 4 };
            applyGeneratedBitmap(properties, { width: 10, height: 10, pixelRatio: lixo });
            expect(properties.pixelRatio, String(lixo)).toBe(4);
        }
    });

    it('grava o deslocamento só quando ele desloca de fato', () => {
        const properties = {};

        applyGeneratedBitmap(properties, { width: 99, height: 54, iconOffset: [0, 2.76] });
        expect(properties.iconOffset).toEqual([0, 2.76]);
    });

    it('APAGA o deslocamento quando ele é nulo, para a feição antiga ficar igual', () => {
        // `[0, 0]` gravado mudaria a forma no disco de toda feicao que nao desloca nada.
        for (const nulo of [[0, 0], undefined, null, [NaN, 1], 'perto', [1]]) {
            const properties = { iconOffset: [0, 9] };
            applyGeneratedBitmap(properties, { width: 10, height: 10, iconOffset: nulo });
            expect('iconOffset' in properties, JSON.stringify(nulo)).toBe(false);
        }
    });

    it('APAGA um imageUrl velho, para a base64 do bitmap não morar na feição', () => {
        // `imageUrl` era uma copia em base64 do PROPRIO desenho, que ninguem lia e que ia
        // junto em todo `.ebgeo`. A feicao antiga perde a chave na proxima regeracao.
        const properties = { imageUrl: 'data:image/png;base64,VELHO' };

        applyGeneratedBitmap(properties, { blob: {}, width: 10, height: 10 });

        expect('imageUrl' in properties).toBe(false);
    });

    it('aguenta propriedades ou resultado ausentes', () => {
        expect(applyGeneratedBitmap(null, { width: 1, height: 1 })).toBe(null);
        expect(applyGeneratedBitmap(undefined, { width: 1, height: 1 })).toBe(undefined);

        const properties = { width: 80 };
        expect(applyGeneratedBitmap(properties, null)).toBe(properties);
        expect(properties.width).toBe(80);
        expect('bitmapVersion' in properties).toBe(false);
    });
});

describe('hasCurrentBitmap', () => {
    it('só aprova quem carrega a versão corrente', () => {
        expect(hasCurrentBitmap({ bitmapVersion: SYMBOL_BITMAP_VERSION })).toBe(true);
        // Feicao gravada antes do recorte nao tem a chave: e a que precisa regerar.
        expect(hasCurrentBitmap({})).toBe(false);
        expect(hasCurrentBitmap({ bitmapVersion: 1 })).toBe(false);
        expect(hasCurrentBitmap({ bitmapVersion: String(SYMBOL_BITMAP_VERSION) })).toBe(false);
        expect(hasCurrentBitmap(null)).toBe(false);
        expect(hasCurrentBitmap(undefined)).toBe(false);
    });
});

describe('sinal do deslocamento, do gerador ate a replica do clique', () => {
    /**
     * Le o viewBox de um SVG.
     * @param {string} svg - SVG string
     * @returns {Object} { minX, minY, width, height }
     */
    function lerViewBox(svg) {
        const v = svg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
        return { minX: v[0], minY: v[1], width: v[2], height: v[3] };
    }

    it('prende a convencao de sinal entre o gerador e a replica do hit-test: a elipse do Nucleo real cai sobre a coordenada', () => {
        // Duas pecas de modulos diferentes tem de concordar no SINAL do mesmo numero:
        // `iconOffsetFor` PRODUZ o `iconOffset` que vai para as propriedades, e
        // `iconScreenQuad` — a replica do desenho do MapLibre que a caixa de selecao e
        // o clique usam — o CONSOME. Um sinal trocado em qualquer das duas passa em
        // todo teste de unidade das duas e so aparece no mapa, com a caixa saltando
        // para o lado oposto do desenho.
        //
        // O caso e o do catalogo de verdade, nao um quadro inventado: o Nucleo de
        // Batalhao, cujo desenho desce muito mais do que sobe.
        const TOPO = 114; // unidades de SVG acima da elipse (`montarNucleo`: ceil(100 + 11/2 + 8))

        const ponto = COORDINATION_POINTS_CATALOG.ECHELON_16;
        const caixa = lerViewBox(ponto.svg);
        const escala = ponto.escalaLogica;

        // O quadro justo comeca em -114 em TODO Nucleo: e o que poe a origem do SVG
        // (o centro da elipse) a 114 unidades da borda de cima.
        expect(caixa.minY).toBe(-TOPO);

        const iconOffset = iconOffsetFor(caixa, ponto.anchorSvg, escala);

        const quad = iconScreenQuad({
            anchor: { x: 0, y: 0 },
            displayWidth: caixa.width * escala,
            displayHeight: caixa.height * escala,
            iconSize: 1,
            iconAnchor: 'center',
            iconOffset
        });

        const ys = quad.map(c => c.y);
        const topoDoQuad = Math.min(...ys);
        const baseDoQuad = Math.max(...ys);
        const meioDoQuad = (topoDoQuad + baseDoQuad) / 2;

        // 1. O sinal: y de tela cresce para BAIXO, e o desenho desce mais do que sobe,
        //    entao o meio do bitmap fica ABAIXO da coordenada — dy positivo.
        expect(iconOffset[1]).toBeGreaterThan(0);
        expect(meioDoQuad).toBeCloseTo(iconOffset[1], 10);
        expect(meioDoQuad).toBeGreaterThan(0);

        // 2. O efeito: a origem do SVG, que esta TOPO unidades abaixo da borda de cima
        //    do quadro, cai exatamente sobre a ancora. A folga e o arredondamento de
        //    duas casas do proprio `iconOffset`.
        expect(topoDoQuad + TOPO * escala).toBeCloseTo(0, 2);
        expect(Math.abs(topoDoQuad + TOPO * escala)).toBeLessThanOrEqual(0.005);
        expect(topoDoQuad).toBeLessThan(0);
        expect(baseDoQuad).toBeGreaterThan(0);

        // 3. Na horizontal o desenho e simetrico, entao nada se desloca.
        expect(iconOffset[0]).toBe(0);
        expect(Math.min(...quad.map(c => c.x))).toBeCloseTo(-caixa.width * escala / 2, 10);
    });
});
