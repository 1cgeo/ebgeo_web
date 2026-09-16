// Path: e2e-ui/smoke.spec.js

/**
 * Browser smoke: the real app boots in a real browser (served by Vite) and mounts
 * a MapLibre canvas. Uncaught page errors are surfaced as a SOFT assertion (the
 * app fetches external tiles that 404 in the sandbox — those are network errors,
 * not page errors, so they don't fail the smoke).
 *
 * O CANVAS TEM DE SER O DO MAPA, e a versão anterior pedia `locator('canvas').first()`, isto é,
 * QUALQUER canvas da página. A diferença nunca apareceu em Chromium e apareceu inteira no
 * primeiro dia de Firefox (2026-09-15): o boot travava antes de o mapa montar, `#map-sig` ficava
 * VAZIO, e este caso passava em 4,5 s por causa de um canvas decorativo. Foi lido como "o app
 * boota e desenha no Firefox" e mandou a investigação para o lado errado por um bom tempo.
 * `#map-sig canvas` é o sinal que discrimina, e é o único que o nome deste arquivo promete.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('App smoke (real browser)', () => {
    test('boots and renders a map canvas without an uncaught error', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const response = await page.goto('/');
        expect(response?.ok()).toBeTruthy();

        await expect(page.locator('#map-sig canvas').first()).toBeAttached({ timeout: 30000 });

        expect.soft(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    });
});
