// Path: tests/unit/calibracao-espelha-marcador-andar.test.js
//
// AS DUAS COPIAS DO MARCADOR DE ANDAR TEM DE CONCORDAR NUMERO A NUMERO.
//
// A pagina de calibracao (`src/js/calibration/`) carrega uma copia da geometria
// do visualizador (`src/js/street_view_tool/navigation/`). A duplicacao e
// deliberada: a calibracao e um porte do `ebgeo_360` e nao pode arrastar a store
// nem o MapLibre do mapa. O preco e que uma correcao feita de um lado nao chega
// ao outro, e nada quebra quando isso acontece: o operador calibra vendo um
// arranjo e o visualizador desenha outro, cada um verde na sua suite.
//
// Este arquivo importa AS DUAS e exige o mesmo numero das duas. Ele e o unico
// guarda contra a divergencia, entao mede as tres coisas que divergiriam em
// silencio: a altura do icone quando o alvo troca de andar, o texto do andar de
// destino e o arranjo da fila que junta os dois.
//
// Comparacao sozinha nao basta (duas copias erradas do mesmo jeito passariam),
// entao cada bloco leva tambem uma asercao ABSOLUTA, com os numeros medidos na
// tela de 1200x800 e FOV 75 que estao nas mensagens dos commits de origem.

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { StreetViewProjector as ProjetorVisualizador }
    from '@js/street_view_tool/navigation/projector.js';
import { NAV_CONSTANTS as CONSTANTES_VISUALIZADOR }
    from '@js/street_view_tool/navigation/constants.js';
import {
    rotuloDeAndar as rotuloVisualizador,
    drawArmillarySphere as desenhaVisualizador,
} from '@js/street_view_tool/navigation/renderer.js';
import { StreetViewNavigator } from '@js/street_view_tool/navigation/navigator.js';

import { StreetViewProjector as ProjetorCalibracao }
    from '@js/calibration/projector.js';
import { NAV_CONSTANTS as CONSTANTES_CALIBRACAO }
    from '@js/calibration/constants.js';
import {
    rotuloDeAndar as rotuloCalibracao,
    drawArmillarySphere as desenhaCalibracao,
} from '@js/calibration/renderer.js';
import { layoutDirections as layoutCalibracao } from '@js/calibration/navigator.js';

// A tela onde os numeros de controle foram medidos.
const LARGURA = 1200;
const ALTURA = 800;
const FOV = 75;

const projetorVisualizador = new ProjetorVisualizador(LARGURA, ALTURA);
const projetorCalibracao = new ProjetorCalibracao(LARGURA, ALTURA);

/** Converte graus de elevacao em pixels na tela de referencia. */
function emPixels(projetor, graus) {
    return projetor.focalLength(FOV) * Math.tan((graus * Math.PI) / 180);
}

describe('as constantes de andar sao as mesmas nas duas copias', () => {
    // As seis que entram na conta da altura. Divergir em qualquer uma move o
    // icone sem mover nada mais, que e o defeito impossivel de ver no diff.
    const CHAVES = [
        'ANDAR_MARGEM_RAIOS',
        'ANDAR_NUMERO_RAIO_MIN',
        'HORIZON_BASE_DEPRESSION_DEG',
        'HORIZON_CEILING_ELEVATION_DEG',
        'HORIZON_ANGULAR_NEAR',
        'HORIZON_RANK_DECAY',
    ];

    test('nenhuma delas falta em nenhum dos dois lados', () => {
        // Sem isto o `equal` abaixo passaria com as duas AUSENTES, que e
        // exatamente o estado de antes do porte: undefined === undefined.
        for (const chave of CHAVES) {
            assert.ok(Number.isFinite(CONSTANTES_VISUALIZADOR[chave]),
                `${chave} ausente no visualizador`);
            assert.ok(Number.isFinite(CONSTANTES_CALIBRACAO[chave]),
                `${chave} ausente na calibracao`);
        }
    });

    test('e as duas valem o mesmo', () => {
        for (const chave of CHAVES) {
            assert.equal(CONSTANTES_CALIBRACAO[chave], CONSTANTES_VISUALIZADOR[chave],
                `${chave} divergiu entre calibracao e visualizador`);
        }
    });

    test('os valores sao os do commit de origem', () => {
        assert.equal(CONSTANTES_CALIBRACAO.ANDAR_MARGEM_RAIOS, 1.5);
        assert.equal(CONSTANTES_CALIBRACAO.ANDAR_NUMERO_RAIO_MIN, 11);
    });
});

describe('elevacaoComAndar da o mesmo numero nas duas copias', () => {
    const POSTOS = [0, 0.5, 1, 2, 3, 5, 20];
    const DEGRAUS = [-6, -2, -1, 0, 1, 2, 6];

    test('em toda a grade de posto e degrau', () => {
        let comparacoes = 0;
        for (const posto of POSTOS) {
            for (const degrau of DEGRAUS) {
                assert.equal(
                    projetorCalibracao.elevacaoComAndar(posto, degrau),
                    projetorVisualizador.elevacaoComAndar(posto, degrau),
                    `divergiu no posto ${posto} com degrau ${degrau}`,
                );
                comparacoes++;
            }
        }
        // O verde de um laco vazio nao prova nada.
        assert.equal(comparacoes, POSTOS.length * DEGRAUS.length);
    });

    test('e tambem nos degraus que nao sao numero', () => {
        // Projeto sem andar declarado: os 28 acervos externos caem aqui, e os
        // dois lados tem de continuar desenhando o marcador de sempre.
        for (const vazio of [null, undefined, NaN]) {
            const daCalibracao = projetorCalibracao.elevacaoComAndar(1, vazio);
            assert.equal(daCalibracao, projetorVisualizador.elevacaoComAndar(1, vazio),
                `divergiu com degrau ${String(vazio)}`);
            assert.equal(daCalibracao, projetorCalibracao.elevationDeg(1),
                `degrau ${String(vazio)} devia cair na escada comum`);
        }
    });

    test('o numero de controle: subir um andar no primeiro posto da +4,20 graus', () => {
        // 38,3 px na tela de 1200x800 com FOV 75, contra os -2,20 graus da regra
        // antiga. E o valor citado na mensagem do commit de origem.
        for (const [nome, projetor] of [['calibracao', projetorCalibracao],
                                        ['visualizador', projetorVisualizador]]) {
            assert.ok(Math.abs(projetor.elevacaoComAndar(0, 1) - 4.20) < 0.005,
                `${nome}: esperado +4,20 graus, veio ${projetor.elevacaoComAndar(0, 1)}`);
            assert.ok(Math.abs(emPixels(projetor, projetor.elevacaoComAndar(0, 1)) - 38.3) < 0.1,
                `${nome}: esperado 38,3 px, veio ${emPixels(projetor, projetor.elevacaoComAndar(0, 1))}`);
            assert.equal(projetor.elevacaoComAndar(0, -1), -projetor.elevacaoComAndar(0, 1),
                `${nome}: descer tem de espelhar subir`);
            assert.equal(projetor.elevacaoComAndar(0, 0), projetor.elevationDeg(0),
                `${nome}: mesmo andar nao pode mover o icone`);
        }
    });

    test('o numero de controle: no segundo posto sao +7,08 graus', () => {
        for (const [nome, projetor] of [['calibracao', projetorCalibracao],
                                        ['visualizador', projetorVisualizador]]) {
            assert.ok(Math.abs(projetor.elevacaoComAndar(1, 1) - 7.08) < 0.005,
                `${nome}: esperado +7,08 graus, veio ${projetor.elevacaoComAndar(1, 1)}`);
            assert.ok(Math.abs(emPixels(projetor, projetor.elevacaoComAndar(1, 1)) - 64.7) < 0.1,
                `${nome}: esperado 64,7 px, veio ${emPixels(projetor, projetor.elevacaoComAndar(1, 1))}`);
        }
    });

    test('a folga do primeiro icone e de meio raio dele, nos dois lados', () => {
        for (const [nome, projetor] of [['calibracao', projetorCalibracao],
                                        ['visualizador', projetorVisualizador]]) {
            const raio = projetor.angularRadiusDeg(0);
            const folga = Math.abs(projetor.elevacaoComAndar(0, -1)) - raio;
            assert.ok(Math.abs(folga - raio * 0.5) < 1e-9,
                `${nome}: raio ${raio}, folga ${folga}`);
        }
    });
});

describe('rotuloDeAndar da o mesmo texto nas duas copias', () => {
    // Os rotulos sao os medidos em photos.floor_label do beira_rio. O ultimo
    // par e a borda que separa "ausente" de "zero", onde a regra homonima de
    // `calibration/project-map.js` DIVERGE de proposito (la o nivel 0 vira
    // "Ext"): sao dois contratos, e este teste vigia so o do marcador.
    const CASOS = [
        [6, '6º andar', '6'],
        [1, '1º andar', '1'],
        // Dois algarismos: a tabela inteira era de um digito, entao uma copia
        // podia perder o `match(/^\d+/)` e escrever '1' para o 10o andar sem
        // nenhum teste virar vermelho. Medido por mutacao.
        [10, '10º andar', '10'],
        [11, '11º andar', '11'],
        [0, 'Externo', 'E'],
        [0, 'Campo', 'C'],
        [5, null, '5'],
        [0, null, '0'],
        [0, '   ', '0'],
        [-1, null, '-1'],
        [null, null, null],
        [undefined, undefined, null],
        [NaN, null, null],
    ];

    test('e o texto e o esperado, nao apenas o mesmo dos dois lados', () => {
        for (const [nivel, rotulo, esperado] of CASOS) {
            assert.equal(rotuloCalibracao(nivel, rotulo), esperado,
                `calibracao: nivel ${String(nivel)}, rotulo ${String(rotulo)}`);
            assert.equal(rotuloVisualizador(nivel, rotulo), esperado,
                `visualizador: nivel ${String(nivel)}, rotulo ${String(rotulo)}`);
        }
        assert.equal(CASOS.length, 13);
    });
});

/**
 * Contexto de canvas que so ANOTA o que foi pedido, chamada por chamada.
 *
 * Existe porque o que diverge no desenho nao e funcao pura: e a decisao de
 * encolher a seta e escrever o texto, tomada dentro do drawArmillarySphere. Sem
 * espiao ela so apareceria no olho de quem usa, do lado que ninguem abriu.
 *
 * @returns {{log: Array}} Contexto falso com o registro das chamadas
 */
function ctxEspiao() {
    const log = [];
    const ctx = { log };
    const metodos = ['save', 'restore', 'beginPath', 'closePath', 'stroke', 'fill',
        'arc', 'ellipse', 'setLineDash', 'moveTo', 'lineTo', 'fillText', 'strokeText'];
    for (const nome of metodos) {
        ctx[nome] = (...args) => { log.push([nome, ...args]); };
    }
    const propriedades = ['font', 'lineWidth', 'strokeStyle', 'fillStyle', 'textAlign',
        'textBaseline', 'globalAlpha', 'shadowColor', 'shadowBlur', 'lineCap', 'lineJoin'];
    for (const nome of propriedades) {
        Object.defineProperty(ctx, nome, {
            set(valor) { log.push([nome, valor]); },
            get() { return null; },
        });
    }
    return ctx;
}

/** Roda os dois desenhos com o mesmo estado e devolve os dois registros. */
function desenhaNosDois(raio, estado) {
    const daCalibracao = ctxEspiao();
    const doVisualizador = ctxEspiao();
    desenhaCalibracao(daCalibracao, raio, estado);
    desenhaVisualizador(doVisualizador, raio, estado);
    return { daCalibracao: daCalibracao.log, doVisualizador: doVisualizador.log };
}

describe('o marcador desenhado e o mesmo nas duas copias', () => {
    const ESTADOS = [
        ['sobe para o 5o, marcador grande', 30, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar' }],
        ['desce para o Externo', 30, { floorDelta: -6, floorLevel: 0, floorLabel: 'Externo' }],
        ['sem rotulo, cai no nivel', 30, { floorDelta: -2, floorLevel: 4, floorLabel: null }],
        ['marcador pequeno, sem texto', 6, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar' }],
        ['mesmo andar, marcador de sempre', 30, { floorDelta: 0, floorLevel: 1, floorLabel: '1º andar' }],
        ['alvo oculto', 30, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar', hidden: true }],
        ['realcado', 30, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar', highlighted: true }],
    ];

    test('chamada por chamada, em todos os estados que importam', () => {
        for (const [nome, raio, estado] of ESTADOS) {
            const { daCalibracao, doVisualizador } = desenhaNosDois(raio, estado);
            assert.ok(daCalibracao.length > 0, `${nome}: a calibracao nao desenhou nada`);
            assert.deepStrictEqual(daCalibracao, doVisualizador,
                `${nome}: o desenho da calibracao divergiu do visualizador`);
        }
        assert.equal(ESTADOS.length, 7);
    });

    test('e o texto do destino sai onde foi especificado, nos dois', () => {
        // Asercao absoluta: se as DUAS copias perdessem o texto, a comparacao
        // acima continuaria verde.
        const { daCalibracao, doVisualizador } = desenhaNosDois(
            30, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar' });

        for (const [nome, log] of [['calibracao', daCalibracao], ['visualizador', doVisualizador]]) {
            const textos = log.filter(c => c[0] === 'fillText' || c[0] === 'strokeText');
            assert.ok(textos.length > 0, `${nome}: nenhum texto desenhado`);
            for (const [, texto, x, y] of textos) {
                assert.equal(texto, '5', `${nome}: o texto tinha de ser o destino`);
                assert.ok(Math.abs(x - 30 * 0.34) < 1e-9, `${nome}: x do texto veio ${x}`);
                assert.equal(y, 0, `${nome}: y do texto veio ${y}`);
            }
        }
    });

    test('e a seta encolhe e recua para a esquerda quando o texto entra', () => {
        const { daCalibracao, doVisualizador } = desenhaNosDois(
            30, { floorDelta: 1, floorLevel: 5, floorLabel: '5º andar' });

        for (const [nome, log] of [['calibracao', daCalibracao], ['visualizador', doVisualizador]]) {
            const pontos = log.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo');
            assert.ok(pontos.length > 0, `${nome}: nenhuma linha de seta`);
            // O recuo e -r*0.42, entao a haste (x=0 na geometria) cai em -12,6.
            assert.ok(pontos.some(([, x]) => Math.abs(x - (-30 * 0.42)) < 1e-9),
                `${nome}: a haste da seta nao recuou para -12,6`);
            assert.ok(!pontos.some(([, x]) => x === 0),
                `${nome}: sobrou linha centrada, sinal de que a seta nao recuou`);
        }
    });
});

describe('o arranjo da fila coloca o icone do mesmo lado nas duas copias', () => {
    // DUAS filas de dois: no terceiro posto o icone ja cai abaixo do limite de
    // legibilidade e nem entra no arranjo. O `sobe_so` esta sozinho na direcao
    // dele, que e o caso que separa de verdade, porque a regra antiga punha
    // TODO primeiro icone abaixo da linha.
    const camera = { lon: 0, lat: 0, floor_level: 3 };
    const fila = [
        { id: 'perto', bearing: 340.0, distance: 2, floor_level: 3 },
        { id: 'desce', bearing: 340.2, distance: 5, floor_level: 1 },
        { id: 'base', bearing: 90.0, distance: 3, floor_level: 3 },
        { id: 'sobe', bearing: 90.2, distance: 6, floor_level: 5 },
        { id: 'sobe_so', bearing: 200.0, distance: 4, floor_level: 6 },
    ];

    /** Arranjo do visualizador, por um stub com o que o layout realmente toca. */
    function layoutDoVisualizador() {
        const nav = {
            projector: new ProjetorVisualizador(LARGURA, ALTURA),
            cameraConfig: camera,
            canvas: { width: LARGURA, height: ALTURA },
            resolveTargetVector: StreetViewNavigator.prototype.resolveTargetVector,
            layoutDirections: StreetViewNavigator.prototype.layoutDirections,
            deltaDeAndar: StreetViewNavigator.prototype.deltaDeAndar,
        };
        return nav.layoutDirections(fila, FOV);
    }

    test('mesmos alvos, mesmo posto, mesmo raio e mesma altura', () => {
        const doVisualizador = layoutDoVisualizador();
        const daCalibracao = layoutCalibracao(
            fila, FOV, new ProjetorCalibracao(LARGURA, ALTURA), camera);

        assert.deepStrictEqual(
            [...daCalibracao.keys()].sort(), [...doVisualizador.keys()].sort(),
            'as duas copias nem desenham os mesmos alvos',
        );
        assert.ok(daCalibracao.size >= 4, `arranjo pequeno demais: ${daCalibracao.size}`);

        for (const [id, aqui] of daCalibracao) {
            const la = doVisualizador.get(id);
            assert.equal(aqui.rank, la.rank, `${id}: posto divergiu`);
            assert.equal(aqui.radius, la.radius, `${id}: raio divergiu`);
            assert.equal(aqui.elevationDeg, la.elevationDeg, `${id}: altura divergiu`);
        }
    });

    test('quem sobe fica acima da linha e quem desce fica abaixo, nos dois', () => {
        // Absoluto, porque duas copias que ignorassem o degrau juntas passariam
        // na comparacao acima: as duas cairiam na escada comum da fila.
        const arranjos = [['calibracao', layoutCalibracao(
            fila, FOV, new ProjetorCalibracao(LARGURA, ALTURA), camera)],
        ['visualizador', layoutDoVisualizador()]];

        for (const [nome, layout] of arranjos) {
            assert.ok(layout.get('desce').elevationDeg < 0, `${nome}: quem desce subiu`);
            assert.ok(layout.get('sobe').elevationDeg > 0, `${nome}: quem sobe afundou`);
            assert.ok(layout.get('sobe_so').elevationDeg > 0,
                `${nome}: o alvo que sobe sozinho na direcao nasceu abaixo da linha`);
            // O do mesmo andar segue na escada comum, sem margem nenhuma.
            assert.ok(layout.get('perto').elevationDeg < 0,
                `${nome}: o alvo do mesmo andar saiu do lugar`);
        }
    });

    test('a calibracao mede o degrau contra a camera que recebe, e nao a do modulo', () => {
        // A vista de tras da calibracao passa a PROPRIA camera. Sem o parametro
        // ela mediria o degrau contra a foto errada, e o icone iria para o lado
        // oposto ao que o operador ve.
        const doQuinto = layoutCalibracao(
            fila, FOV, new ProjetorCalibracao(LARGURA, ALTURA),
            { lon: 0, lat: 0, floor_level: 5 });

        assert.ok(doQuinto.get('desce').elevationDeg < 0,
            'olhando do 5o andar, o alvo do 1o continua descendo');
        assert.notEqual(
            doQuinto.get('sobe').elevationDeg,
            layoutCalibracao(fila, FOV, new ProjetorCalibracao(LARGURA, ALTURA), camera)
                .get('sobe').elevationDeg,
            'o mesmo alvo, olhado de dois andares diferentes, caiu na mesma altura',
        );
    });
});
