// Path: e2e-ui/boot-em-aba-oculta.spec.js

/**
 * O MAPA QUE BOOTA NUMA ABA OCULTA ESPERA A ABA APARECER (relato do dono, 2026-09-24).
 *
 * A MapLibre aplica um estilo novo no PRÓXIMO QUADRO DE ANIMAÇÃO (`Style.loadJSON` espera um
 * `requestAnimationFrame`), mesmo um estilo embutido, e o navegador não entrega quadro a uma aba
 * oculta. Uma página recarregada em segundo plano ficava com o estilo parado, a espera de 10 s de
 * `switchLayer` expirava ("Timeout loading style for layer: osm"), e o boot seguia sobre um estilo
 * que não tinha carregado: `setupMapFeatures` e `reapplyAtlasAppearance` lançavam "Style is not
 * done loading." e o mapa voltava SEM as camadas da aplicação até a próxima troca de mapa.
 *
 * A aba oculta é emulada como o navegador a trata: `visibilityState` diz oculta e nenhum quadro de
 * animação é entregue até ela aparecer, enquanto os temporizadores continuam correndo (numa aba de
 * fundo real eles são espaçados, não parados). É isso que torna a corrida DETERMINÍSTICA: a
 * interleaving perdedora é sempre a mesma, em vez de depender de quando a pessoa troca de aba.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// Hidden past BOTH give-ups of the old boot: `index.js` stops waiting for the map's `load` after
// 15 s and paints anyway, and `switchLayer` then waited 10 s for a style that could not arrive.
// A shorter hiding (14 s was the first try) never reaches the bug and passes on the broken code.
const OCULTA_POR_MS = 32000;

/** Init script: the tab starts hidden, and `window.__mostrarAba()` shows it. */
function emularAbaOculta() {
    let oculta = true;
    const pendentes = new Map();
    let proximoId = 0;
    const rafReal = window.requestAnimationFrame.bind(window);
    const cancelReal = window.cancelAnimationFrame.bind(window);
    Object.defineProperty(Document.prototype, 'visibilityState', {
        configurable: true,
        get: () => (oculta ? 'hidden' : 'visible'),
    });
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => oculta });
    window.requestAnimationFrame = (cb) => {
        if (!oculta) return rafReal(cb);
        proximoId -= 1;
        pendentes.set(proximoId, cb);
        return proximoId;
    };
    window.cancelAnimationFrame = (id) => {
        if (id < 0) pendentes.delete(id);
        else cancelReal(id);
    };
    window.__mostrarAba = () => {
        oculta = false;
        document.dispatchEvent(new Event('visibilitychange'));
        for (const cb of pendentes.values()) rafReal(cb);
        pendentes.clear();
    };
}

describeOrSkip('boot numa aba oculta', () => {
    // The race is the subject: a retry would hide the losing interleaving.
    test.describe.configure({ retries: 0 });

    test('o mapa monta as camadas da aplicação quando a aba aparece, sem erro de estilo', async ({ page }) => {
        test.setTimeout(120000);
        const errosDeEstilo = [];
        const anotar = (texto) => {
            if (/Style is not done loading|Timeout loading style/.test(texto)) errosDeEstilo.push(texto);
        };
        page.on('console', (msg) => anotar(msg.text()));
        page.on('pageerror', (err) => anotar(err.message));

        await page.addInitScript(emularAbaOculta);
        await page.goto('/');
        // The time IS the subject here: the tab stays hidden past the old 10 s give-up.
        await page.waitForTimeout(OCULTA_POR_MS);
        const antes = await page.evaluate(() => ({
            fonte: globalThis.__ebgeoMap?.getSource('points') ?? null,
            cortina: Boolean(document.querySelector('#initial-loader')),
        }));
        expect(antes.fonte, 'nada da aplicação monta enquanto a aba está oculta').toBeNull();
        // Before the fix the boot gave up, threw, and dropped the curtain over an empty map.
        expect(antes.cortina, 'a tela de carregamento fica enquanto o mapa não montou').toBe(true);

        await page.evaluate(() => window.__mostrarAba());

        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
        await expect.poll(
            () => page.evaluate(() => Boolean(globalThis.__ebgeoMap?.getSource('points'))),
            { timeout: 30000, message: 'as sources da aplicação existem depois de a aba aparecer' },
        ).toBe(true);
        expect(errosDeEstilo).toEqual([]);
    });
});
