// Path: tests/unit/arrow-geometry-turf-real.test.js

/**
 * @fileoverview A seta de DUAS pontas medida contra o TURF DE VERDADE.
 *
 * POR QUE ESTE ARQUIVO EXISTE, e por que ele não é um luxo. O irmão
 * `arrow-geometry.test.js` dirige a mesma classe com um stub planar, e o stub é
 * CEGO para a única coisa que a cauda pode quebrar: a ordem em que os três
 * vértices dela entram no anel. Emitidos na ordem errada, o polígono vira uma
 * gravata borboleta (o anel se cruza), e nada no stub muda: a contagem de
 * vértices é a mesma, o anel fecha do mesmo jeito, todas as asserções de lá
 * continuam verdes. Pior: o `lineOffset` do stub tem o sinal INVERTIDO em
 * relação ao turf real (positivo move para o NORTE, ou seja para a ESQUERDA de
 * um percurso para leste, enquanto o turf real move para a DIREITA), então um
 * raciocínio sobre lados feito lá dá a resposta trocada.
 *
 * O QUE ELE PRENDE
 * - o SINAL do `lineOffset` do turf vendorizado, que é a premissa de que a ordem
 *   `cornerRight → tip → cornerLeft` depende. Se uma atualização do vendor
 *   inverter esse sinal, é aqui que se descobre, com o nome do defeito escrito,
 *   em vez de num relato de "a seta ficou torta";
 * - AUSÊNCIA de auto-interseção (`turf.kinks`) na seta reta, no "V", na largura
 *   negativa, na seta com o clamp mordendo e nas duas metades do aeromóvel;
 * - o SEMIPLANO em que a cauda entra, re-derivado aqui por produto vetorial das
 *   coordenadas cruas, sem chamar de volta o módulo sob teste;
 * - que o bico e a cauda apontam para LADOS OPOSTOS, medido por `turf.bearing`
 *   geodésico, e que a cauda mede o comprimento que `resolveHeadLengths` diz.
 *
 * O QUE ELE NÃO É. Não é uma segunda suíte da classe: tudo que o stub já mede
 * (contagem, flag estritamente `=== true`, clamp aritmético, alça) fica lá, que
 * é onde roda em milissegundos. Aqui só entra o que EXIGE geodesia real.
 *
 * COMO O TURF CHEGA. Ele é global puro no produto (`utilities/turf-loader.js`
 * baixa `vendors/turf.min.js` sob demanda e nada faz `import '@turf/...'`), e não
 * está no `package.json`. Então o bundle UMD vendorizado é lido do disco e
 * avaliado com `vm.runInThisContext`, que é o caminho que faz o ramo global do
 * UMD publicar `globalThis.turf` (não há `module` nem `define` no escopo de um
 * script do `vm`). Se ele não publicar, este arquivo FALHA ALTO no `beforeAll`:
 * um turf ausente deixaria a classe inteira lançar e cair nos `catch` que
 * devolvem LineString, e a suíte poderia passar medindo o socorro em vez da
 * geometria.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
    },
}));

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR = resolve(FRONT, 'public', 'vendors', 'turf.min.js');

beforeAll(() => {
    const source = readFileSync(VENDOR, 'utf8');
    runInThisContext(source, { filename: VENDOR });

    // FALHA ALTO, de propósito. Sem esta guarda um vendor que mudasse de formato
    // (ESM, ou um UMD que preferisse outro ramo) deixaria `turf` indefinido, e a
    // classe cairia nos próprios `catch`: a suíte ficaria verde medindo o
    // socorro. O erro nomeia o arquivo porque ele é o que se troca.
    if (typeof globalThis.turf?.kinks !== 'function') {
        throw new Error(
            `O bundle vendorizado nao publicou globalThis.turf com kinks(): ${VENDOR}. ` +
            'Sem turf real este arquivo nao mede nada; conserte a carga em vez de pular.'
        );
    }
});

afterAll(() => { delete globalThis.turf; });

const { default: AddArrowGeometry } = await import('../../src/js/military_tools/arrow_tool/add_arrow_geometry.js');

const geom = new AddArrowGeometry();

// ============================================================================
// Re-derivações independentes (nunca compostas a partir do módulo sob teste)
// ============================================================================

/**
 * Área com sinal do triângulo (a, b, p) em graus crus. Positiva quando `p` está à
 * ESQUERDA do percurso a→b, que em rumo de bússola é o lado `bearing - 90`.
 * @param {Array<number>} a - Início do segmento [lng, lat]
 * @param {Array<number>} b - Fim do segmento [lng, lat]
 * @param {Array<number>} p - Ponto de prova [lng, lat]
 * @returns {number} Positiva à esquerda, negativa à direita, zero se colinear
 */
function cross(a, b, p) {
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

/** Quantas auto-interseções o anel tem. Zero é o único valor aceitável. */
function kinkCount(geometry) {
    if (geometry.type === 'Polygon') {
        return turf.kinks(turf.polygon(geometry.coordinates)).features.length;
    }
    return geometry.coordinates.reduce(
        (total, rings) => total + turf.kinks(turf.polygon(rings)).features.length,
        0,
    );
}

const ringOf = (g) => g.coordinates[0];
/** Os três vértices da cauda: sempre os últimos antes do fechamento. */
const tailOf = (ring) => ring.slice(-4, -1);

/**
 * O bico do anel, achado sem contar vértices à mão. `lineOffset` NÃO preserva a
 * contagem de vértices para todo eixo, então um índice fixo a partir do fim
 * mediria outro ponto num "V" ou num eixo de duas pontas. O corpo esquerdo vem
 * primeiro no anel, e seu tamanho é re-derivado aqui chamando o turf direto, sem
 * perguntar nada ao módulo sob teste.
 * @param {Array} ring - Anel do polígono gerado
 * @param {Array} coords - Eixo da seta
 * @param {number} width - Largura em metros
 * @returns {Array<number>} A coordenada do bico
 */
function headTipOf(ring, coords, width) {
    const corpoEsquerdo = turf.lineOffset(
        turf.lineString(coords), Math.abs(width / 2), { units: 'meters' },
    ).geometry.coordinates.length;
    return ring[corpoEsquerdo + 1];
}

// Eixo de ~20 km em latitude brasileira: as duas cabeças (1875 m cada, para
// `width: 500`) cabem folgadas, então nenhum destes casos mede o clamp.
const RETA = [[-43.2, -22.9], [-43.1, -22.9], [-43.0, -22.9]];
const VE = [[-43.2, -22.9], [-43.1, -22.85], [-43.0, -22.9]];
const CURTA = [[-43.2, -22.9], [-43.19, -22.9]];

// ============================================================================

describe('turf real: a premissa de que a ordem dos vértices depende', () => {
    it('CONTROLE: `lineOffset` POSITIVO vai para a DIREITA do percurso', () => {
        // Percurso para o LESTE; direita é o SUL, ou seja latitude MENOR. É esta
        // linha que justifica emitir a cauda como cornerRight, tip, cornerLeft:
        // o anel chega no primeiro vértice pelo lado `bearing - 90`, que do ponto
        // de vista do rumo INVERTIDO da cauda é o `tailBearing + 90`.
        const offset = turf.lineOffset(turf.lineString([[0, 0], [0.05, 0]]), 100, { units: 'meters' });
        expect(offset.geometry.coordinates[0][1]).toBeLessThan(0);
    });

    it('CONTROLE: o corpo da seta chega ao primeiro vértice pelo lado ESQUERDO do percurso', () => {
        // `rightLine` é o offset NEGATIVO (esquerda do percurso) e entra no anel
        // invertido, então o último vértice do corpo é o primeiro dele.
        const ring = ringOf(geom.generateSingleArrow(RETA, { width: 500 }));
        const ultimoDoCorpo = ring[ring.length - 2];
        expect(cross(RETA[0], RETA[1], ultimoDoCorpo)).toBeGreaterThan(0);
    });
});

describe('turf real: a cauda não faz gravata borboleta', () => {
    const casos = [
        ['reta', RETA, { width: 500 }],
        ['V', VE, { width: 500 }],
        ['largura negativa', RETA, { width: -500 }],
        ['eixo curto, com o clamp mordendo', CURTA, { width: 500 }],
        ['razão de cabeça grande', RETA, { width: 500, headLengthRatio: 4 }],
    ];

    it.each(casos)('%s: ZERO auto-interseções com a flag ligada', (_nome, coords, props) => {
        const comFlag = geom.generateSingleArrow(coords, { ...props, doubleHeaded: true });
        expect(comFlag.type).toBe('Polygon');
        expect(kinkCount(comFlag)).toBe(0);
    });

    it.each(casos)('%s: a flag não ACRESCENTA interseção nenhuma', (_nome, coords, props) => {
        // Asserção relativa ao lado do absoluto acima: se um dia o corpo da seta
        // passar a se cruzar sozinho (offset de um "V" fechado faz isso), o
        // absoluto acusa a seta inteira e este aqui diz de quem é a culpa.
        const sem = geom.generateSingleArrow(coords, props);
        const com = geom.generateSingleArrow(coords, { ...props, doubleHeaded: true });
        expect(kinkCount(com)).toBe(kinkCount(sem));
    });

    it('CONTROLE NEGATIVO: trocar a ordem dos três vértices FAZ a gravata borboleta', () => {
        // Sem isto o `toBe(0)` acima seria cobertura vazia: prova que `kinks`
        // discrimina, montando à mão o anel que a ordem errada produziria.
        const ring = [...ringOf(geom.generateSingleArrow(RETA, { width: 500, doubleHeaded: true }))];
        const [cornerRight, tip, cornerLeft] = tailOf(ring);
        ring.splice(ring.length - 4, 3, cornerLeft, tip, cornerRight);
        expect(turf.kinks(turf.polygon([ring])).features.length).toBeGreaterThan(0);
    });
});

describe('turf real: onde a cauda cai', () => {
    const ring = () => ringOf(geom.generateSingleArrow(RETA, { width: 500, doubleHeaded: true }));

    it('o primeiro vértice da cauda fica no MESMO semiplano em que o anel chegou', () => {
        // Este é o invariante que impede o cruzamento, re-derivado por produto
        // vetorial das coordenadas cruas em vez de perguntado ao módulo.
        const r = ring();
        const chegada = r[r.length - 5];
        const [cornerRight] = tailOf(r);
        expect(Math.sign(cross(RETA[0], RETA[1], cornerRight)))
            .toBe(Math.sign(cross(RETA[0], RETA[1], chegada)));
        expect(cross(RETA[0], RETA[1], cornerRight)).toBeGreaterThan(0);
    });

    it('o último vértice da cauda fica no semiplano do fechamento, que é o OPOSTO', () => {
        const r = ring();
        const cornerLeft = tailOf(r)[2];
        expect(Math.sign(cross(RETA[0], RETA[1], cornerLeft)))
            .toBe(Math.sign(cross(RETA[0], RETA[1], r[0])));
        expect(cross(RETA[0], RETA[1], cornerLeft)).toBeLessThan(0);
    });
});

describe('turf real: a cauda mede o que resolveHeadLengths promete', () => {
    it('eixo folgado: a cauda tem o comprimento NOMINAL', () => {
        // width 500 → base 1250 m, nominal = 1250 * 1.5 = 1875 m.
        const r = ringOf(geom.generateSingleArrow(RETA, { width: 500, doubleHeaded: true }));
        const tip = tailOf(r)[1];
        expect(turf.distance(turf.point(RETA[0]), turf.point(tip), { units: 'meters' }))
            .toBeCloseTo(1875, 0);
    });

    it('a cauda aponta para TRÁS: rumo oposto ao do primeiro segmento', () => {
        const r = ringOf(geom.generateSingleArrow(RETA, { width: 500, doubleHeaded: true }));
        const tip = tailOf(r)[1];
        const rumoDaCauda = turf.bearing(turf.point(RETA[0]), turf.point(tip));
        const rumoDoEixo = turf.bearing(turf.point(RETA[0]), turf.point(RETA[1]));
        // Diferenca normalizada para [0, 360): oposto e 180. A folga de meio grau
        // paga a convergencia dos meridianos ao longo dos 20 km do eixo, que faz o
        // rumo de volta nao ser o de ida mais 180 exatos (medido: ~0,04 grau).
        const delta = (((rumoDaCauda - rumoDoEixo) % 360) + 360) % 360;
        expect(Math.abs(delta - 180)).toBeLessThan(0.5);
    });

    it('eixo curto: bico e cauda somados NÃO passam do eixo', () => {
        const eixo = turf.length(turf.lineString(CURTA), { units: 'meters' });
        const r = ringOf(geom.generateSingleArrow(CURTA, { width: 500, doubleHeaded: true }));
        const tailTip = tailOf(r)[1];
        const headTip = headTipOf(r, CURTA, 500);

        const cauda = turf.distance(turf.point(CURTA[0]), turf.point(tailTip), { units: 'meters' });
        const bico = turf.distance(turf.point(CURTA[1]), turf.point(headTip), { units: 'meters' });

        // Controle: sem o clamp cada uma seria 1875 m num eixo de ~1030 m.
        expect(cauda).toBeLessThan(1875);
        expect(cauda + bico).toBeLessThanOrEqual(eixo * 1.001);
    });

    it('a seta de UMA cabeça continua sem clamp, mesmo em eixo curto', () => {
        const r = ringOf(geom.generateSingleArrow(CURTA, { width: 500 }));
        const headTip = headTipOf(r, CURTA, 500);
        expect(turf.distance(turf.point(CURTA[1]), turf.point(headTip), { units: 'meters' }))
            .toBeCloseTo(1875, 0);
    });
});

describe('turf real: o aeromóvel de duas pontas', () => {
    // O stub não tem `lineSlice` nem `lineIntersect`, então lá o aeromóvel cai
    // sempre no socorro. Aqui ele roda de verdade, que é a única forma de medir
    // em qual das duas metades a cauda entrou.
    const airmobile = (props) => geom.generateSingleArrow(RETA, {
        width: 500, airmobile: true, ...props,
    });

    it('CONTROLE: o caminho cruzado de fato roda (MultiPolygon, não o socorro)', () => {
        expect(airmobile({}).type).toBe('MultiPolygon');
    });

    it('a cauda entra na metade TRASEIRA e a da frente fica idêntica', () => {
        const sem = airmobile({});
        const com = airmobile({ doubleHeaded: true });
        expect(com.coordinates[0][0].length - sem.coordinates[0][0].length).toBe(3);
        expect(com.coordinates[1]).toEqual(sem.coordinates[1]);
    });

    it('nenhuma das duas metades ganha auto-interseção', () => {
        expect(kinkCount(airmobile({ doubleHeaded: true }))).toBe(kinkCount(airmobile({})));
    });
});
