// Path: tests/unit/viewshed-3d-geometria.test.js
//
// A ARITMETICA DO VIEWSHED 3D, que ate 2026-09-15 so se media por captura de tela.
//
// Ela decidia o DESENHO e vivia dentro de duas funcoes que puxam a loja e o Cesium, ou seja, fora
// do alcance de qualquer teste de node: o corte de um setor largo em dois ou tres pedacos, o
// estreitamento de cada costura, o campo de visao da camera do observador e a malha do
// tronco. A decisao D15 as tirou de la para `services/viewshed-geometry.js`, um folha de ZERO
// imports, e este arquivo e o que elas ganharam em troca.
//
// O QUE ESTE ARQUIVO NAO PROVA, e vale dizer para ninguem confundir as camadas: ele nao prova que
// o desenho sai certo. Quem prova isso e `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`, que
// computa um viewshed real e compara a imagem. Aqui se provam os NUMEROS que entram naquele
// desenho, e a diferenca importa: um numero certo alimentando um shader errado passa nos dois
// lugares diferentes, e por isso existem os dois.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    subViewshedLayout,
    observerFovDegrees,
    frustumOutlineAngles,
    directionFromAngles,
    MAX_SINGLE_VIEWSHED_ANGLE,
    SEAM_NARROWING_DEGREES,
    MAX_FRUSTUM_FOV_DEGREES,
} from '@js/3d_models_viewer_tool/services/viewshed-geometry.js';

describe('subViewshedLayout: o corte do setor e o estreitamento da costura', () => {
    it('ate 150 graus e UM pedaco, e um pedaco NAO e estreitado', () => {
        // A assimetria e o ponto: sem vizinho nao ha costura, entao estreitar encolheria a
        // resposta que a pessoa pediu. O caso de 120 graus e o padrao do produto.
        for (const angulo of [1, 45, 120, 149.9, MAX_SINGLE_VIEWSHED_ANGLE]) {
            const l = subViewshedLayout(angulo);
            expect(l.count, `${angulo} graus`).toBe(1);
            expect(l.subAngle).toBeCloseTo(angulo, 10);
            expect(l.renderAngle, `${angulo} graus nao pode ser estreitado`).toBeCloseTo(angulo, 10);
            expect(l.offsets).toEqual([0]);
        }
    });

    it('a fronteira de 150 graus e ESTRITA de um lado so', () => {
        // Um degrau de fronteira e onde `<=` e `<` divergem, e e onde um teste de exemplo paga o
        // que vale. Exatamente 150 cabe em um; um epsilon acima ja sao dois.
        expect(subViewshedLayout(150).count).toBe(1);
        expect(subViewshedLayout(150.0001).count).toBe(2);
        expect(subViewshedLayout(300).count).toBe(2);
        expect(subViewshedLayout(300.0001).count).toBe(3);
    });

    it('acima de 150 graus vira dois pedacos, cada um com a folga da costura descontada', () => {
        const l = subViewshedLayout(240);
        expect(l.count).toBe(2);
        expect(l.subAngle).toBe(120);
        expect(l.renderAngle).toBe(120 - SEAM_NARROWING_DEGREES);
        expect(l.offsets).toEqual([-60, 60]);
    });

    it('acima de 300 graus vira tres pedacos, e o do meio fica na direcao central', () => {
        const l = subViewshedLayout(360);
        expect(l.count).toBe(3);
        expect(l.subAngle).toBe(120);
        expect(l.renderAngle).toBe(120 - SEAM_NARROWING_DEGREES);
        // O PASSO E O SUB-ANGULO INTEIRO, e nao a metade dele: e isso que poe um pedaco
        // exatamente na direcao de visada. Escrever `[-subAngle/2, 0, subAngle/2]` aqui deixaria
        // um terco do setor sem cobertura e sobreporia o resto, e o sintoma seria um leque com
        // buraco, longe desta linha.
        expect(l.offsets).toEqual([-120, 0, 120]);
    });

    it('a folga, quando existe, sai POR PEDACO e nao por emenda', () => {
        // ESTA PROPRIEDADE NASCEU ERRADA E O TESTE A CORRIGIU, que e o unico jeito honesto de
        // escrever a linha abaixo. A intuicao (e a primeira versao deste caso) diz "uma folga por
        // COSTURA", ou seja, N-1 vezes; o contra-exemplo que o fast-check encolheu ate
        // 150.00000000000003 mostra que sao N vezes. O motivo e que cada pedaco e estreitado
        // INTEIRO e renderizado centrado no seu deslocamento, entao ele encolhe meia folga de cada
        // lado: nas emendas as duas metades somam a folga, mas nas duas bordas EXTERNAS do setor
        // sobra um recuo de meia folga que ninguem pediu.
        //
        // COM A FOLGA EM ZERO, DESDE 2026-09-16, ESSE RECUO NAO EXISTE MAIS: um setor de 240 graus
        // desenha 240. Ele desenhava 239,8 com a folga de 0,1 e 237 com a de 1,5. O caso continua
        // aqui porque a propriedade e sobre a FORMA da conta, e e ela que reprova quem repuser uma
        // folga achando que a paga so uma vez.
        fc.assert(
            fc.property(fc.double({ min: 1, max: 360, noNaN: true }), (total) => {
                const l = subViewshedLayout(total);
                const perdido = l.count > 1 ? l.count * SEAM_NARROWING_DEGREES : 0;
                expect(l.renderAngle * l.count).toBeCloseTo(total - perdido, 6);
            }),
            { numRuns: 300 },
        );
    });

    it('os pedacos vizinhos ENCOSTAM, e a folga da emenda e ZERO por decisao medida', () => {
        // A conta que importa para o desenho: a borda direita do pedaco da esquerda e a borda
        // esquerda do pedaco da direita, com o estreitamento aplicado, distam SEAM_NARROWING_DEGREES.
        const l = subViewshedLayout(240);
        const bordaDireitaDoPrimeiro = l.offsets[0] + l.renderAngle / 2;
        const bordaEsquerdaDoSegundo = l.offsets[1] - l.renderAngle / 2;
        expect(bordaEsquerdaDoSegundo - bordaDireitaDoPrimeiro).toBeCloseTo(SEAM_NARROWING_DEGREES, 10);

        // E A CONSTANTE E ZERO, ASSERIDO AQUI EM ABSOLUTO. A linha acima sozinha passa com
        // QUALQUER folga (ela compara a conta consigo mesma), e foi por isso que este arquivo
        // seguiu verde enquanto a emenda abria uma cunha cega de 0,1 grau na direcao de visada:
        // uma fresta continua de 3 a 4 px que cortava ate a sombra de um obstaculo posto em cima
        // dela (medido em 2026-09-16, em oito aberturas). Qualquer valor positivo aqui e chao que
        // NENHUM sub-viewshed analisa; o valor seguro e zero, porque o erro residual entre os dois
        // pedacos ja tem o sinal da SOBREPOSICAO. A tabela medida esta no cabecalho da constante e
        // a prova em pixel em `frontend/tests/e2e-ui/viewshed-3d-pixel.spec.js`.
        expect(SEAM_NARROWING_DEGREES).toBe(0);
    });

    it('os deslocamentos sao simetricos e cobrem o setor pedido', () => {
        fc.assert(
            fc.property(fc.double({ min: 1, max: 360, noNaN: true }), (total) => {
                const l = subViewshedLayout(total);
                expect(l.offsets).toHaveLength(l.count);
                const soma = l.offsets.reduce((a, b) => a + b, 0);
                expect(soma).toBeCloseTo(0, 6);
                // A borda externa do conjunto, medida pelo sub-angulo NOMINAL (nao pelo
                // renderizado), e exatamente metade do setor de cada lado.
                const borda = Math.max(...l.offsets) + l.subAngle / 2;
                expect(borda).toBeCloseTo(total / 2, 6);
            }),
            { numRuns: 300 },
        );
    });

    it('entrada invalida cai no padrao de 120 graus em vez de virar NaN', () => {
        // `x ?? 0` nao protege contra NaN, e o arquivo de regras da casa avisa isso por extenso.
        for (const ruim of [undefined, null, NaN, 0, -30, Infinity, 'cento e vinte']) {
            const l = subViewshedLayout(ruim);
            expect(Number.isFinite(l.subAngle), String(ruim)).toBe(true);
            expect(l.count).toBe(1);
            expect(l.subAngle).toBe(120);
        }
    });
});

describe('observerFovDegrees: o campo de visao da camera de profundidade', () => {
    it('e a MAIOR das duas aberturas, porque um frustum so tem de conter as duas', () => {
        expect(observerFovDegrees(120, 90)).toBe(120);
        expect(observerFovDegrees(60, 140)).toBe(140);
        expect(observerFovDegrees(100, 100)).toBe(100);
    });

    it('trava em 170 graus, porque um frustum perspectivo degenera perto de 180', () => {
        expect(observerFovDegrees(360, 90)).toBe(MAX_FRUSTUM_FOV_DEGREES);
        expect(observerFovDegrees(90, 179.9)).toBe(MAX_FRUSTUM_FOV_DEGREES);
        expect(observerFovDegrees(171, 171)).toBe(MAX_FRUSTUM_FOV_DEGREES);
        // E o teto e um TETO, nao um valor: logo abaixo dele nada e cortado.
        expect(observerFovDegrees(169.5, 10)).toBe(169.5);
    });

    it('nunca devolve zero, negativo ou NaN', () => {
        fc.assert(
            fc.property(
                fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(undefined, null, 0, -1)),
                fc.oneof(fc.double({ noNaN: false }), fc.constantFrom(undefined, null, 0, -1)),
                (h, v) => {
                    const fov = observerFovDegrees(h, v);
                    expect(Number.isFinite(fov)).toBe(true);
                    expect(fov).toBeGreaterThan(0);
                    expect(fov).toBeLessThanOrEqual(MAX_FRUSTUM_FOV_DEGREES);
                },
            ),
            { numRuns: 400 },
        );
    });
});

describe('directionFromAngles: a direcao de um par (azimute, elevacao)', () => {
    /** Base ortonormal simples, para que a conta possa ser conferida a olho. */
    const F = { x: 0, y: 1, z: 0 };
    const R = { x: 1, y: 0, z: 0 };
    const U = { x: 0, y: 0, z: 1 };

    const norma = (v) => Math.hypot(v.x, v.y, v.z);

    it('o par (0, 0) e a propria direcao de visada', () => {
        const d = directionFromAngles(F, R, U, 0, 0);
        expect(d.x).toBeCloseTo(0, 12);
        expect(d.y).toBeCloseTo(1, 12);
        expect(d.z).toBeCloseTo(0, 12);
    });

    it('azimute positivo gira para a DIREITA, e elevacao positiva para CIMA', () => {
        const direita = directionFromAngles(F, R, U, 90, 0);
        expect(direita.x).toBeCloseTo(1, 12);
        expect(direita.y).toBeCloseTo(0, 12);

        const cima = directionFromAngles(F, R, U, 0, 90);
        expect(cima.z).toBeCloseTo(1, 12);
        expect(cima.y).toBeCloseTo(0, 12);
    });

    it('a saida e SEMPRE unitaria, que e o que torna a multiplicacao pela distancia correta', () => {
        // Se ela nao fosse, o arco distante do tronco deixaria de ficar a `distance` metros e o
        // desenho passaria a mentir sobre o alcance da analise. Invariante, nao exemplo.
        fc.assert(
            fc.property(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -90, max: 90, noNaN: true }),
                (az, el) => {
                    expect(norma(directionFromAngles(F, R, U, az, el))).toBeCloseTo(1, 10);
                },
            ),
            { numRuns: 500 },
        );
    });

    it('o AZIMUTE e recuperavel da direcao, que e o eixo que o shader mede', () => {
        // O teste horizontal do shader projeta o ponto no plano perpendicular ao "para cima" e
        // mede o angulo contra a visada. Esta propriedade e exatamente essa conta, ao contrario:
        // se ela quebrar, a borda do leque deixa de cair onde a malha a desenha.
        fc.assert(
            fc.property(
                fc.double({ min: -89, max: 89, noNaN: true }),
                fc.double({ min: -80, max: 80, noNaN: true }),
                (az, el) => {
                    const d = directionFromAngles(F, R, U, az, el);
                    const recuperado = (Math.atan2(d.x, d.y) * 180) / Math.PI;
                    expect(recuperado).toBeCloseTo(az, 8);
                },
            ),
            { numRuns: 500 },
        );
    });

    it('espelhar o azimute espelha a direcao, sem deriva de sinal', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -170, max: 170, noNaN: true }),
                fc.double({ min: -85, max: 85, noNaN: true }),
                (az, el) => {
                    const a = directionFromAngles(F, R, U, az, el);
                    const b = directionFromAngles(F, R, U, -az, el);
                    expect(b.x).toBeCloseTo(-a.x, 10);
                    expect(b.y).toBeCloseTo(a.y, 10);
                    expect(b.z).toBeCloseTo(a.z, 10);
                },
            ),
            { numRuns: 300 },
        );
    });
});

describe('frustumOutlineAngles: a malha do tronco', () => {
    it('com 8 subdivisoes sao 9 meridianos, 9 paralelos e 4 arestas de apice', () => {
        const linhas = frustumOutlineAngles(120, 90);
        expect(linhas).toHaveLength(9 + 9 + 4);
        expect(linhas.filter((l) => l.apex)).toHaveLength(4);
        for (const l of linhas.filter((l) => !l.apex)) {
            expect(l.points).toHaveLength(9);
        }
    });

    it('a malha nunca sai do setor pedido, e TOCA as quatro bordas', () => {
        // As duas metades sao necessarias. Sem a primeira, um tronco maior que a analise passaria;
        // sem a segunda, um tronco menor tambem, e o desenho subdeclararia o que foi calculado.
        fc.assert(
            fc.property(
                fc.double({ min: 1, max: 360, noNaN: true }),
                fc.double({ min: 1, max: 180, noNaN: true }),
                (h, v) => {
                    const pontos = frustumOutlineAngles(h, v).flatMap((l) => l.points);
                    const azimutes = pontos.map((p) => p.azimuth);
                    const elevacoes = pontos.map((p) => p.elevation);
                    expect(Math.max(...azimutes)).toBeCloseTo(h / 2, 6);
                    expect(Math.min(...azimutes)).toBeCloseTo(-h / 2, 6);
                    expect(Math.max(...elevacoes)).toBeCloseTo(v / 2, 6);
                    expect(Math.min(...elevacoes)).toBeCloseTo(-v / 2, 6);
                },
            ),
            { numRuns: 200 },
        );
    });

    it('uma subdivisao invalida degrada para UMA, em vez de produzir uma malha vazia', () => {
        // Zero subdivisoes daria divisao por zero e NaN em todo ponto; a malha sumiria da tela sem
        // erro nenhum, que e a forma de falha que este arquivo inteiro existe para evitar.
        for (const ruim of [0, -5, NaN, undefined, 0.4]) {
            const linhas = frustumOutlineAngles(120, 90, ruim);
            const pontos = linhas.flatMap((l) => l.points);
            expect(pontos.length, String(ruim)).toBeGreaterThan(0);
            for (const p of pontos) {
                expect(Number.isFinite(p.azimuth), String(ruim)).toBe(true);
                expect(Number.isFinite(p.elevation), String(ruim)).toBe(true);
            }
        }
    });

    it('as quatro arestas de apice sao os quatro CANTOS, e nao quatro pontos quaisquer', () => {
        const h = 120;
        const v = 90;
        const cantos = frustumOutlineAngles(h, v)
            .filter((l) => l.apex)
            .map((l) => `${l.points[0].azimuth},${l.points[0].elevation}`)
            .sort();
        expect(cantos).toEqual([`-60,-45`, `-60,45`, `60,-45`, `60,45`].sort());
    });
});
