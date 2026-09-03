// Path: tests/unit/nucleo-medida-coordenacao.test.js

/**
 * O Escalao e o Escalao Forca-Tarefa da medida de coordenacao viraram NUCLEO e Nucleo
 * Forca-Tarefa (MD33-M-02): uma elipse de tamanho fixo, que o simbolo de escalao CORTA
 * embaixo, com a identificacao abaixo dele.
 *
 * Estes testes guardam os piores casos que a montagem tem de aguentar, e cada um deles
 * REPROVA o desenho anterior, que era o simbolo de escalao sozinho:
 *
 * - o contorno e um arco ABERTO na largura do escalao, e nao uma elipse fechada. A elipse
 *   que passa por tras do escalao e o erro que a figura do manual nao comete;
 * - o desenho e simetrico na vertical em torno do centro da elipse, porque a camada ancora
 *   o ICONE pelo meio (`icon-anchor: center`). Sem a simetria a elipse sobe, e o ponto
 *   clicado deixa de ser o centro do nucleo;
 * - o texto de identificacao cai na MESMA altura nos treze escaloes, e o viewBox ja nasce
 *   grande o bastante para ele: texto que empurra o viewBox para baixo move o desenho
 *   inteiro em relacao ao ponto clicado;
 * - a situacao troca o tracado do CONTORNO e so dele. O simbolo de escalao tracejado seria
 *   outro simbolo;
 * - o escalao mais largo do catalogo (Teatro de Operacoes, 524 unidades) cabe na largura
 *   fixa da elipse;
 * - marcar Forca-Tarefa preserva o escalao ja escolhido, e a ida e a volta sao redondas.
 */

import { describe, it, expect } from 'vitest';
import {
    COORDINATION_POINTS_CATALOG,
    getAvailableTextFields
} from '@js/military_tools/coordination_measure_tool/coordination_points_catalog.js';
import { CoordinationMeasureGenerator } from '@js/military_tools/coordination_measure_tool/coordination_measure_generator.js';
import {
    ECHELON_CODES,
    UI_DATA
} from '@js/military_tools/coordination_measure_tool/coordination_measure_constants.js';
import {
    getPointsGroupedOptions,
    isNucleoFT,
    trocarFamiliaDoNucleo
} from '@js/military_tools/coordination_measure_tool/attributes/ui-components.helpers.js';

const gerador = new CoordinationMeasureGenerator();
const codigos = Object.keys(ECHELON_CODES);
const familias = ['ECHELON', 'ECHELON_FT'];
const todosOsNucleos = familias.flatMap(f => codigos.map(c => `${f}_${c}`));

/**
 * Lê o viewBox de um SVG.
 * @param {string} svg - SVG string
 * @returns {Object} { minX, minY, width, height, maxX, maxY }
 */
function lerViewBox(svg) {
    const encontrado = svg.match(/viewBox="([^"]+)"/);
    const v = encontrado[1].trim().split(/\s+/).map(Number);
    return { minX: v[0], minY: v[1], width: v[2], height: v[3], maxX: v[0] + v[2], maxY: v[1] + v[3] };
}

describe('catálogo do Núcleo', () => {
    it('tem os 26 pontos, com nome e categoria de Núcleo', () => {
        expect(todosOsNucleos).toHaveLength(26);

        for (const code of todosOsNucleos) {
            const ponto = COORDINATION_POINTS_CATALOG[code];
            expect(ponto, code).toBeDefined();
            expect(ponto.name).toMatch(/^Núcleo( FT)? - /);
            expect(ponto.category).toMatch(/^Núcleo( Força-Tarefa)?$/);
            expect(ponto.isNucleo).toBe(true);
        }
    });

    it('mantém os códigos ECHELON_*, que é o que projeto salvo guarda no disco', () => {
        expect(COORDINATION_POINTS_CATALOG.ECHELON_16).toBeDefined();
        expect(COORDINATION_POINTS_CATALOG.ECHELON_FT_16).toBeDefined();
        expect(COORDINATION_POINTS_CATALOG.ECHELON_16.echelonCode).toBe('16');
    });

    it('desenha um contorno marcado, e um só, em cada Núcleo', () => {
        for (const code of todosOsNucleos) {
            const svg = COORDINATION_POINTS_CATALOG[code].svg;
            expect(svg.match(/data-nucleo="contorno"/g), code).toHaveLength(1);
            // Elipse fechada seria a linha passando por tras do escalao.
            expect(svg, code).not.toContain('<ellipse');
        }
    });

    it('abre o contorno na largura do escalão, com as pontas na altura do corte', () => {
        for (const code of todosOsNucleos) {
            const svg = COORDINATION_POINTS_CATALOG[code].svg;
            const arco = svg.match(/d="M (-?[\d.]+) (-?[\d.]+) A ([\d.]+) ([\d.]+) 0 1 0 (-?[\d.]+) (-?[\d.]+)"/);

            expect(arco, `${code} sem arco aberto`).not.toBeNull();

            const [, x1, y1, rx, ry, x2, y2] = arco.map(Number);
            expect(x1, code).toBeGreaterThan(0);
            expect(x2, code).toBe(-x1);
            expect(y1, code).toBe(y2);
            // A ponta do arco fica sobre a elipse, entre o lado e o ponto mais baixo dela.
            expect(y1, code).toBeGreaterThan(0);
            expect(y1, code).toBeLessThanOrEqual(ry);
            expect(x1, code).toBeLessThanOrEqual(rx);
            // A elipse e a MESMA em todos: o que muda e onde ela abre.
            expect(rx, code).toBe(220);
            expect(ry, code).toBe(100);
        }
    });

    it('abre mais para o escalão mais largo, que é o que a figura do manual mostra', () => {
        const abertura = (code) => Number(COORDINATION_POINTS_CATALOG[code].svg.match(/d="M (-?[\d.]+) /)[1]);

        // Companhia (uma barra) < Batalhao (duas) < colchete de Forca-Tarefa < Teatro FT.
        expect(abertura('ECHELON_15')).toBeLessThan(abertura('ECHELON_16'));
        expect(abertura('ECHELON_16')).toBeLessThan(abertura('ECHELON_FT_16'));
        expect(abertura('ECHELON_FT_16')).toBeLessThan(abertura('ECHELON_FT_25'));
    });

    it('é simétrico em torno do centro da elipse, para o ícone ancorar nela', () => {
        for (const code of todosOsNucleos) {
            const caixa = lerViewBox(COORDINATION_POINTS_CATALOG[code].svg);
            expect(caixa.minY, `${code} na vertical`).toBe(-caixa.maxY);
            expect(caixa.minX, `${code} na horizontal`).toBe(-caixa.maxX);
            expect(COORDINATION_POINTS_CATALOG[code].anchor).toBe('center');
        }
    });

    it('põe o texto na mesma altura nos treze escalões de cada família', () => {
        for (const familia of familias) {
            const alturas = new Set(
                codigos.map(c => COORDINATION_POINTS_CATALOG[`${familia}_${c}`].textFields.identificacao.position.y)
            );
            expect(alturas.size, familia).toBe(1);
        }
    });

    it('cabe o escalão mais largo do catálogo dentro da largura fixa', () => {
        // Teatro de Operacoes: 488 unidades no normal, 524 no Forca-Tarefa.
        const larguraFixa = lerViewBox(COORDINATION_POINTS_CATALOG.ECHELON_16.svg).width;

        for (const familia of familias) {
            for (const c of codigos) {
                expect(lerViewBox(COORDINATION_POINTS_CATALOG[`${familia}_${c}`].svg).width, `${familia}_${c}`)
                    .toBe(larguraFixa);
            }
        }
    });

    it('oferece situação e identificação no formulário, sem mexer nos outros pontos', () => {
        expect(getAvailableTextFields('ECHELON_16')).toEqual(['status', 'identificacao']);
        expect(getAvailableTextFields('ECHELON_FT_25')).toEqual(['status', 'identificacao']);
        expect(getAvailableTextFields('130100')).toEqual(['tipo', 'identificacao', 'gdhIni', 'gdhFim']);
        expect(getAvailableTextFields('130600')).toEqual([]);
        expect(getAvailableTextFields('NAO_EXISTE')).toEqual([]);
    });

    it('não desenha a situação como texto, só a identificação', () => {
        const ponto = COORDINATION_POINTS_CATALOG.ECHELON_16;
        expect(Object.keys(ponto.textFields)).toEqual(['identificacao']);
        expect(gerador.hasExternalText({ status: 'preparado' }, ponto)).toBe(false);
        expect(gerador.hasExternalText({ identificacao: 'FT 3 Inf Bld' }, ponto)).toBe(true);
    });
});

describe('situação do Núcleo', () => {
    it.each([
        [null, 0],
        [undefined, 0],
        ['ocupado', 0],
        ['preparado', 1],
        ['preparado-nao-ocupado', 1]
    ])('situação %s produz %i tracejado', (status, esperado) => {
        const svg = gerador.aplicarSituacaoDoNucleo(COORDINATION_POINTS_CATALOG.ECHELON_16.svg, status);
        expect(svg.match(/stroke-dasharray/g) || []).toHaveLength(esperado);
    });

    it('traceja o contorno e deixa o símbolo de escalão contínuo', () => {
        const svg = gerador.aplicarSituacaoDoNucleo(
            COORDINATION_POINTS_CATALOG.ECHELON_FT_16.svg,
            'preparado-nao-ocupado'
        );

        expect(svg).toMatch(/data-nucleo="contorno"[^>]*stroke-dasharray/);
        expect(svg.slice(svg.indexOf("</path>"))).not.toContain('stroke-dasharray');
    });

    it('sobrevive à cor personalizada, que roda antes dela', () => {
        const pintado = gerador.applyCustomColor(COORDINATION_POINTS_CATALOG.ECHELON_16.svg, '#11FF00');
        const tracejado = gerador.aplicarSituacaoDoNucleo(pintado, 'preparado');

        expect(tracejado).toMatch(/data-nucleo="contorno"[^>]*stroke="rgb\(17, 255, 0\)"/);
        expect(tracejado).toMatch(/data-nucleo="contorno"[^>]*stroke-dasharray/);
        expect(tracejado).not.toMatch(/(stroke|fill)="(black|#000|#000000)"/);
    });
});

describe('identificação do Núcleo', () => {
    it.each([
        ['A'],
        ['FT 3 Inf Bld'],
        ['FORCA-TAREFA 3 BATALHAO DE INFANTARIA BLINDADO DO SUL']
    ])('não empurra o desenho na vertical com o texto %s', (texto) => {
        for (const familia of familias) {
            const ponto = COORDINATION_POINTS_CATALOG[`${familia}_16`];
            const antes = lerViewBox(ponto.svg);
            const depois = lerViewBox(gerador.addExternalTexts(ponto.svg, { identificacao: texto }, ponto));

            expect(depois.minY, familia).toBe(antes.minY);
            expect(depois.maxY, familia).toBe(antes.maxY);
            // O texto mais largo que a elipse alarga o desenho, mas para os dois lados.
            expect(depois.minX, familia).toBe(-depois.maxX);
        }
    });
});

describe('Força-Tarefa como caixa de marcação', () => {
    it('deixa uma única opção de Núcleo no combo de tipo, e nenhum Escalão', () => {
        const opcoes = getPointsGroupedOptions();

        expect(opcoes.filter(o => o.isEchelon)).toHaveLength(1);
        expect(opcoes.filter(o => o.isEchelon)[0].value).toBe('ECHELON');
        expect(opcoes.some(o => /Escal/.test(o.label))).toBe(false);
    });

    it('troca de família preservando o escalão, na ida e na volta', () => {
        for (const c of codigos) {
            const ida = trocarFamiliaDoNucleo(`ECHELON_${c}`, true);
            expect(ida).toBe(`ECHELON_FT_${c}`);
            expect(COORDINATION_POINTS_CATALOG[ida]).toBeDefined();
            expect(trocarFamiliaDoNucleo(ida, false)).toBe(`ECHELON_${c}`);
        }
    });

    it('é idempotente e cai no batalhão quando não há escalão anterior', () => {
        expect(trocarFamiliaDoNucleo('ECHELON_FT_18', true)).toBe('ECHELON_FT_18');
        expect(trocarFamiliaDoNucleo('ECHELON_18', false)).toBe('ECHELON_18');
        expect(trocarFamiliaDoNucleo(null, true)).toBe('ECHELON_FT_16');
        expect(trocarFamiliaDoNucleo(undefined, false)).toBe('ECHELON_16');
    });

    it('reconhece a família Força-Tarefa pelo código', () => {
        expect(isNucleoFT('ECHELON_FT')).toBe(true);
        expect(isNucleoFT('ECHELON_FT_16')).toBe(true);
        expect(isNucleoFT('ECHELON')).toBe(false);
        expect(isNucleoFT('ECHELON_16')).toBe(false);
        expect(isNucleoFT(null)).toBe(false);
    });
});

describe('nitidez do bitmap', () => {
    it.each([
        ['sem identificação', {}],
        ['com identificação longa', { identificacao: 'FORCA-TAREFA 3 BATALHAO DE INFANTARIA' }]
    ])('rasteriza acima do tamanho lógico e devolve a razão, %s', async (_, props) => {
        // O tamanho LOGICO e o que vai para a caixa de selecao e para o KMZ. Se ele
        // crescesse junto com o bitmap, o simbolo apareceria quatro vezes maior no mapa.
        const local = new CoordinationMeasureGenerator();
        let pedido = null;
        local.convertToPngBlob = async (svg, largura, altura) => {
            pedido = { largura, altura };
            return { tamanho: 'blob de mentira' };
        };

        const r = await local.generateSymbolBlob({ pointCode: 'ECHELON_16', ...props });

        expect(r.pixelRatio).toBeGreaterThan(1);
        expect(pedido.largura).toBe(r.width * r.pixelRatio);
        expect(pedido.altura).toBe(r.height * r.pixelRatio);
        expect(r.anchor).toBe('center');
    });

    it('dá ao Núcleo um quadro maior que o do ponto', async () => {
        const local = new CoordinationMeasureGenerator();
        local.convertToPngBlob = async () => ({});

        const nucleo = await local.generateSymbolBlob({ pointCode: 'ECHELON_16' });
        const generico = await local.generateSymbolBlob({ pointCode: '130100' });

        expect(generico.width).toBe(80);
        expect(nucleo.width).toBeGreaterThan(generico.width);
    });

    it('deixa respiro entre as linhas do colchete de Força-Tarefa, e o traço ainda se vê', () => {
        // Quem limita a espessura NAO e a comparacao com o ponto generico: e a densidade
        // de linhas do colchete de Forca-Tarefa, o caso mais apertado do catalogo. Ele tem
        // duas pernas mais as barras do escalao num vao estreito, e traco grosso demais
        // fecha os vaos e transforma o colchete num borrao.
        //
        // Reprova as duas pontas: o desenho de origem (traco 4 no quadro de 80, 0,70 px,
        // invisivel) e o que o chefe recusou por grosso (3,59 px, respiro de 1,4 px).
        const PISO_VISIVEL = 1.5;
        const RESPIRO_MINIMO = 0.5; // fracao do passo entre linhas que fica em branco

        const ponto = COORDINATION_POINTS_CATALOG.ECHELON_FT_17;
        const caixa = lerViewBox(ponto.svg);
        const escala = ponto.tamanhoBase / caixa.width;
        const traco = Number(ponto.svg.match(/stroke-width="([\d.]+)"/)[1]) * escala;

        // O colchete de FT nasce de um glifo de 224 unidades, reduzido pela escala do glifo.
        const LARGURA_DO_COLCHETE = 224 * 0.5;
        const LINHAS_NO_COLCHETE = 5;
        const passo = LARGURA_DO_COLCHETE * escala / LINHAS_NO_COLCHETE;

        expect(traco).toBeGreaterThanOrEqual(PISO_VISIVEL);
        expect(passo - traco).toBeGreaterThanOrEqual(passo * RESPIRO_MINIMO);
    });

    it('escreve a identificação num corpo legível, e nunca maior que o do ponto genérico', () => {
        // O corpo NAO se casa com o do ponto generico: o Nucleo e um simbolo largo e baixo,
        // e o corpo do generico sairia mais largo que a propria elipse. O que se protege
        // aqui e um PISO de legibilidade, que e o defeito de origem: com o quadro de 80 e
        // corpo 30 o texto saia com 5,2 px, e ninguem lia. O teto impede o contrario, o
        // texto virar o simbolo.
        const PISO_LEGIVEL = 12;

        const corpoNaTela = (codigo, campo) => {
            const ponto = COORDINATION_POINTS_CATALOG[codigo];
            const largura = lerViewBox(ponto.svg).width;
            return ponto.textFields[campo].fontSize * (ponto.tamanhoBase || 80) / largura;
        };

        const generico = corpoNaTela('130100', 'identificacao');

        for (const familia of familias) {
            const corpo = corpoNaTela(`${familia}_16`, 'identificacao');
            expect(corpo, familia).toBeGreaterThanOrEqual(PISO_LEGIVEL);
            expect(corpo, familia).toBeLessThanOrEqual(generico);
        }
    });

    it('só carrega a razão de quem a declara acima de 1', async () => {
        const { collectImageResourceRatios } = await import('@js/layers/feature-images.js');

        const razoes = collectImageResourceRatios({
            coordination_measures: [
                { properties: { id: 'nitido', pixelRatio: 4 } },
                { properties: { id: 'antigo' } },
                { properties: { id: 'um', pixelRatio: 1 } },
                { properties: { id: 'lixo', pixelRatio: 'quatro' } }
            ]
        });

        expect(razoes.get('nitido')).toBe(4);
        // Feicao salva antes da mudanca nao tem a chave, e vale 1: e o que mantem o
        // simbolo de projeto antigo do mesmo tamanho de sempre.
        expect(razoes.has('antigo')).toBe(false);
        expect(razoes.has('um')).toBe(false);
        expect(razoes.has('lixo')).toBe(false);
        expect(collectImageResourceRatios(undefined).size).toBe(0);
        expect(collectImageResourceRatios({}).size).toBe(0);
    });
});

describe('situação no formulário', () => {
    it('tem rótulo legível para cada valor gravado', () => {
        const definicao = UI_DATA.textFieldDefinitions.status;

        expect(definicao.options).toEqual(['ocupado', 'preparado', 'preparado-nao-ocupado']);
        for (const opcao of definicao.options) {
            expect(definicao.optionLabels[opcao], opcao).toBeTruthy();
        }
    });
});
