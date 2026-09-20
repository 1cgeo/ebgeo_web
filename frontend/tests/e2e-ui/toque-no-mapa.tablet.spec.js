// Path: e2e-ui/toque-no-mapa.tablet.spec.js

/**
 * @fileoverview O MAPA SOB UM DEDO, medido em vez de afirmado.
 *
 * Até 2026-09-20 a única camada que exercita a interface rodava só em contexto de MESA, então
 * toda a metade de toque do produto era verificada por LEITURA de código. Foi lendo que se
 * descobriu que arrastar vértice de linha e polígono não funcionava com o dedo, que a medição
 * de distância não tinha como ser fechada e que o menu de dois dedos nascia fora da tela. Este
 * arquivo roda sob `playwright.tablet.config.js`, cujo contexto tem tela de toque de verdade,
 * e mede os três consertos daquele dia.
 *
 * O PRIMEIRO CASO É O CONTROLE DO INSTRUMENTO, e sem ele todo o resto seria fé: ele afirma que
 * o contexto de fato casa `(pointer: coarse)` e cai na FAIXA DO TABLET. Um config mal montado
 * (sem `hasTouch`, ou com viewport de telefone) deixaria os outros casos passando pelo caminho
 * de MESA, verdes e medindo outra coisa.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA, e a lista vale tanto quanto o que ele prova: ele é Chromium
 * com toque, não um iPad. Nada aqui diz se o Safari sintetiza `dblclick` de um toque duplo, se
 * o toque longo vira `contextmenu`, nem se um dedo de nove milímetros acerta um alvo de
 * dezesseis pixels. Ver o cabeçalho do config.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boota o app e espera o mapa 2D responder. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** Ativa uma ferramenta pelo grupo e pelo id, com TOQUE e nunca com clique. */
async function ativarFerramenta(page, grupo, ferramenta) {
    const botaoDoGrupo = page.locator(`.toolbar-group[data-group-id="${grupo}"] .toolbar-group-btn`);
    await botaoDoGrupo.tap();
    const item = page.locator(
        `.toolbar-group[data-group-id="${grupo}"] .toolbar-tool-btn[data-tool-id="${ferramenta}"]`,
    );
    await expect(item).toBeVisible({ timeout: 10000 });
    await item.tap();
}

/** Um toque na tela do mapa, em coordenada de viewport. */
async function tocarNoMapa(page, x, y) {
    await page.touchscreen.tap(x, y);
}

describeOrSkip('o mapa sob um dedo (tablet)', () => {
    test('CONTROLE DO INSTRUMENTO: o contexto é de toque e cai na faixa do tablet', async ({ page }) => {
        await bootApp(page);

        const ambiente = await page.evaluate(() => ({
            grosso: window.matchMedia('(pointer: coarse)').matches,
            semHover: window.matchMedia('(hover: none)').matches,
            // A MESMA consulta de `utilities/tablet-mode.js`. Escrita à mão aqui de propósito:
            // importar o módulo dentro da página acoplaria o caso ao empacotador, e o que se
            // quer medir é o AMBIENTE, não o módulo.
            faixaDeTablet: window.matchMedia(
                '(pointer: coarse) and (min-width: 481px) and (min-height: 441px)',
            ).matches,
            toque: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
            largura: window.innerWidth,
        }));

        expect(ambiente.grosso, 'sem ponteiro grosso o resto mede o caminho de mesa').toBe(true);
        expect(ambiente.semHover).toBe(true);
        expect(ambiente.toque).toBe(true);
        expect(ambiente.faixaDeTablet, 'o viewport caiu fora da faixa: é telefone ou mesa').toBe(true);
        expect(ambiente.largura).toBeGreaterThan(480);
    });

    test('o painel EMPURRA o mapa em vez de deitar por cima dele', async ({ page }) => {
        await bootApp(page);

        const antes = await page.evaluate(() => ({
            recuo: getComputedStyle(document.querySelector('#map-sig')).marginLeft,
            marca: document.body.dataset.tabletPanel ?? '',
            larguraDoCanvas: globalThis.__ebgeoMap.getCanvas().clientWidth,
        }));
        expect(antes.recuo, 'o mapa já nasce recuado, e não deveria').toBe('0px');

        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').tap();
        await expect(page.locator('.maps-tab #current-map-name-input')).toBeVisible({ timeout: 10000 });

        // O RECUO E A MARCA SÃO ESTADO, então se espera por eles e não por tempo: o painel tem
        // transição de CSS, e `map.resize()` é chamado no mesmo instante em que a marca entra.
        await expect.poll(
            () => page.evaluate(() => document.body.dataset.tabletPanel ?? ''),
            { timeout: 10000 },
        ).toBe('open');

        const depois = await page.evaluate(() => ({
            recuo: parseFloat(getComputedStyle(document.querySelector('#map-sig')).marginLeft),
            larguraDoCanvas: globalThis.__ebgeoMap.getCanvas().clientWidth,
        }));

        // O NÚMERO NÃO É CRAVADO, e a razão é que ele vem do painel: a largura muda com a
        // janela (400px, 340 abaixo de 1024). O que se mede é a PROPRIEDADE — o mapa recuou, e
        // o canvas encolheu junto, que é o que distingue empurrar de só deslocar a câmera.
        expect(depois.recuo, 'o painel voltou a deitar por cima do mapa').toBeGreaterThan(200);
        expect(depois.larguraDoCanvas).toBeLessThan(antes.larguraDoCanvas);
        expect(antes.larguraDoCanvas - depois.larguraDoCanvas).toBeGreaterThan(200);
    });

    test('a medição de distância FECHA com o dedo, pelo botão de concluir', async ({ page }) => {
        await bootApp(page);
        await ativarFerramenta(page, 'utility', 'measureDistance');

        // O BOTÃO SÓ NASCE EM APARELHO DE TOQUE (o `show()` pergunta por `isTouchDevice`), e é
        // por isso que este caso só existe aqui: no config de mesa ele não estaria na tela.
        const finalizar = page.locator('.drawing-finish-btn');
        await expect(finalizar).toBeVisible({ timeout: 10000 });

        // Dois toques no mapa, longe da barra lateral e da barra de ferramentas.
        await tocarNoMapa(page, 500, 380);
        await tocarNoMapa(page, 700, 460);

        // COM DOIS VÉRTICES ELE ACEITA. Antes disso o próprio ajudante o mantém inerte, o que
        // é outro assunto (ver a ressalva do commit do botão).
        await expect(finalizar).toBeEnabled({ timeout: 10000 });
        await finalizar.tap();

        // O PAINEL DE RESULTADO É O DESFECHO QUE FALTAVA: sem ele, a medição podia ser começada
        // e não terminada, porque as duas únicas saídas eram clique direito e clique duplo.
        await expect(page.locator('.measurement-results-panel')).toBeVisible({ timeout: 10000 });
    });
});
