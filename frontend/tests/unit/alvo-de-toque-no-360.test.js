// Path: tests/unit/alvo-de-toque-no-360.test.js

/**
 * @fileoverview O ALVO CLICÁVEL DO 360 SOB UM DEDO, que alcançava um terço dos marcadores.
 *
 * DOIS DEFEITOS, e o primeiro é de ORDEM. `assignHitRadii` dá a todo marcador um raio de clique
 * maior que o desenho e nunca menor que uma ponta de dedo, e ela era chamada logo abaixo do laço
 * que projeta as SETAS de navegação. Os POIs e os comentários entram na lista DEPOIS dela, então
 * saíam sem `hitRadius` nenhum. Nada quebrava, porque o hit tester tem um fallback
 * (`radius * HIT_RADIUS_MULTIPLIER`) — e é justamente o fallback que fez o defeito passar calado
 * por não ter piso: um POI com o tamanho padrão de 12 px recebia 18 px de raio, ou seja, 36 px de
 * diâmetro, e quem tivesse escolhido `markerSize` 6 ficava com 18 px de diâmetro, contra os 44 px
 * que a régua de toque pede.
 *
 * O SEGUNDO É DE TAMANHO. O piso era só relativo (2,4% da altura do canvas), o que é generoso numa
 * tela alta e curto numa deitada, que é a orientação em que um tablet costuma ficar: a 768 de
 * altura ele dá 18,4 px de raio, isto é, 36,9 px de diâmetro.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA: que o dedo de fato acerte. Isso é pixel e é do Playwright; aqui é
 * a aritmética do raio e a ORDEM da chamada dentro de `render`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { StreetViewNavigator } from '../../src/js/street_view_tool/navigation/navigator.js';
import { StreetViewHitTester } from '../../src/js/street_view_tool/navigation/hit-tester.js';
import { NAV_CONSTANTS } from '../../src/js/street_view_tool/navigation/constants.js';

/** Tablet deitado: é a moldura em que o piso relativo fica curto. */
const LARGURA = 1024;
const ALTURA = 768;

/** O navegador reduzido ao que `assignHitRadii` toca: o canvas e a própria função. */
const navegadorStub = (altura = ALTURA) => ({
    canvas: { width: LARGURA, height: altura },
    assignHitRadii: StreetViewNavigator.prototype.assignHitRadii,
});

/**
 * Liga ou desliga o ponteiro grosso para o módulo `utilities/tablet-mode.js`, que pergunta ao
 * `window.matchMedia`. Em node não existe `window`, então o padrão do processo é ponteiro FINO, e
 * é por isso que o caso da mesa não precisa de preparo nenhum.
 */
function comPonteiroGrosso(grosso) {
    globalThis.window = { matchMedia: (q) => ({ matches: grosso && q.includes('coarse') }) };
}

afterEach(() => { delete globalThis.window; });

describe('assignHitRadii: o piso do alvo', () => {
    it('na MESA o piso é o relativo, e o multiplicador manda quando o ícone é grande', () => {
        const nav = navegadorStub();
        const marcadores = [
            { radius: 6 },   // POI pequeno, escolhido pela pessoa
            { radius: 12 },  // POI padrão
            { radius: 40 },  // ícone grande: aqui quem manda é o multiplicador
        ];
        nav.assignHitRadii(marcadores);

        const piso = ALTURA * NAV_CONSTANTS.HIT_RADIUS_MIN_REL;
        expect(piso).toBeCloseTo(18.432, 3);
        expect(marcadores[0].hitRadius).toBeCloseTo(piso, 6);
        expect(marcadores[1].hitRadius).toBeCloseTo(piso, 6);
        expect(marcadores[2].hitRadius).toBeCloseTo(40 * NAV_CONSTANTS.HIT_RADIUS_MULTIPLIER, 6);
    });

    it('sob um DEDO nenhum alvo fica abaixo de 44 px de diâmetro', () => {
        comPonteiroGrosso(true);
        const nav = navegadorStub();
        const marcadores = [{ radius: 6 }, { radius: 12 }, { radius: 15 }];
        nav.assignHitRadii(marcadores);

        for (const m of marcadores) {
            expect(m.hitRadius * 2, `alvo de ${m.hitRadius * 2} px`).toBeGreaterThanOrEqual(44);
        }
        // CONTROLE NEGATIVO DA MEDIÇÃO: com o piso relativo sozinho os três ficariam abaixo, que
        // é exatamente o estado anterior. Sem esta linha o caso acima passaria também num dia em
        // que alguém aumentasse a altura do canvas e o piso relativo já bastasse.
        expect(ALTURA * NAV_CONSTANTS.HIT_RADIUS_MIN_REL * 2).toBeLessThan(44);
    });

    it('a tela ALTA continua com o alvo maior: os dois pisos convivem pelo máximo', () => {
        comPonteiroGrosso(true);
        // Tablet em retrato, 1366 de altura: o piso relativo dá 32,8 px de raio, acima dos 22.
        const nav = navegadorStub(1366);
        const marcadores = [{ radius: 6 }];
        nav.assignHitRadii(marcadores);

        expect(marcadores[0].hitRadius).toBeCloseTo(1366 * NAV_CONSTANTS.HIT_RADIUS_MIN_REL, 6);
        expect(marcadores[0].hitRadius).toBeGreaterThan(NAV_CONSTANTS.HIT_RADIUS_MIN_PX_TOUCH);
    });

    it('o piso vale para o ÍCONE que o hit tester de fato consulta', () => {
        // Ponta a ponta com o consumidor real: sem esta ligação, `assignHitRadii` poderia estar
        // certa e o hit tester continuar lendo o fallback, que foi o defeito de POI e comentário.
        comPonteiroGrosso(true);
        const nav = navegadorStub();
        const poi = { screenX: 500, screenY: 400, distance: 10, radius: 12 };
        nav.assignHitRadii([poi]);

        const tester = new StreetViewHitTester();
        tester.setMarkers([poi]);

        // 21 px do centro: dentro dos 22 do piso de toque, e FORA dos 18 que o fallback dava.
        expect(tester.testPoint(521, 400)).toBe(poi);
        expect(12 * NAV_CONSTANTS.HIT_RADIUS_MULTIPLIER).toBeLessThan(21);
    });
});

describe('a ORDEM da chamada dentro de `render`', () => {
    // ESTE CASO É ESTRUTURAL, e é assim de propósito: o defeito não está na aritmética, e sim em
    // QUANDO ela roda. Reproduzi-lo por comportamento exigiria `render()` inteiro, com renderer,
    // minimap e barramento falsos, para medir uma linha de posição.
    const fonte = readFileSync(
        new URL('../../src/js/street_view_tool/navigation/navigator.js', import.meta.url),
        'utf8',
    );

    it('o piso é atribuído depois do ÚLTIMO marcador entrar na lista', () => {
        const chamada = fonte.indexOf('this.assignHitRadii(markers)');
        const entrega = fonte.indexOf('this.hitTester.setMarkers(markers)');
        const ultimoPush = fonte.lastIndexOf('markers.push(projected)');

        expect(chamada, '`assignHitRadii(markers)` sumiu de `render`').toBeGreaterThan(0);
        expect(entrega).toBeGreaterThan(0);
        expect(ultimoPush).toBeGreaterThan(0);

        expect(chamada, 'o piso voltou a ser atribuído antes de POI e comentário entrarem')
            .toBeGreaterThan(ultimoPush);
        expect(chamada, 'o piso passou a ser atribuído depois de o hit tester já ter a lista')
            .toBeLessThan(entrega);
    });

    it('e há UMA chamada só, senão a comparação acima fala da errada', () => {
        const ocorrencias = fonte.split('this.assignHitRadii(markers)').length - 1;
        expect(ocorrencias).toBe(1);
    });
});

describe('o limiar que separa toque de arrasto', () => {
    it('o do dedo é maior que o do mouse, e os dois são finitos', () => {
        // Um dedo sempre desliza ao encostar e ao sair; com os 5 px do mouse, tocar numa seta de
        // navegação era lido como arrasto e a navegação não acontecia, sem nada na tela dizendo
        // por quê. A leitura do limiar é do PRÓPRIO evento (`pointerType`), e não do aparelho,
        // porque um tablet com caneta ou com mouse ligado alterna os dois na mesma sessão.
        expect(Number.isFinite(NAV_CONSTANTS.DRAG_THRESHOLD_PX)).toBe(true);
        expect(Number.isFinite(NAV_CONSTANTS.DRAG_THRESHOLD_PX_TOUCH)).toBe(true);
        expect(NAV_CONSTANTS.DRAG_THRESHOLD_PX_TOUCH)
            .toBeGreaterThan(NAV_CONSTANTS.DRAG_THRESHOLD_PX);
        expect(NAV_CONSTANTS.DRAG_THRESHOLD_PX_TOUCH).toBeGreaterThanOrEqual(10);
    });

    it('e quem escolhe entre os dois lê o `pointerType` do evento', () => {
        // Estrutural pela mesma razão do bloco acima: `handlePointerDown` registra ouvintes no
        // `document`, que não existe no ambiente node desta suíte.
        const fonte = readFileSync(
            new URL('../../src/js/street_view_tool/navigation/navigator.js', import.meta.url),
            'utf8',
        );
        expect(fonte).toMatch(/event\.pointerType === 'mouse'/);
        expect(fonte).toContain('NAV_CONSTANTS.DRAG_THRESHOLD_PX_TOUCH');
        // E o número velho não sobrou solto em lugar nenhum do arquivo.
        expect(fonte).not.toMatch(/const DRAG_THRESHOLD = /);
    });
});
