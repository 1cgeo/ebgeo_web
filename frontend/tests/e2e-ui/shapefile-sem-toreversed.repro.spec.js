// Path: e2e-ui/shapefile-sem-toreversed.repro.spec.js

/**
 * @fileoverview Importar pelo ARRASTAR um shapefile com furo, num navegador sem
 * `Array.prototype.toReversed` (Chrome e Edge 105 a 109, que recebem o pacote moderno do
 * `@vitejs/plugin-legacy` sem polyfill nenhum).
 *
 * A causa e o conserto estão em `frontend/src/js/vendor/shpjs.js` e no par de nó
 * `tests/unit/shapefile-sem-toreversed.repro.test.js`. Este spec mede a mesma coisa pela porta que a
 * pessoa usa: o arquivo solto no mapa, o aviso que ela lê e a feição que fica no mapa. A superfície
 * do Chrome 109 é simulada apagando o método antes de qualquer script da página; o worker do
 * MapLibre não recebe o apagamento, e não precisa, porque o `shpjs` roda na página.
 *
 * Antes do conserto, medido no pacote de produção: o aviso "Não foi possível importar o arquivo:
 * Erro ao processar Shapefile: o.ring.toReversed is not a function" e zero feição.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { buildHoleShapefileZip } from '../helpers/shapefile-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
test.describe.configure({ retries: 0 });

describeOrSkip('Shapefile com furo, num navegador sem toReversed', () => {
    test('o arquivo arrastado para o mapa importa o polígono com o furo', async ({ page }) => {
        await page.addInitScript(() => {
            delete Array.prototype.toReversed;
            globalThis.__semToReversedNoInicio = typeof Array.prototype.toReversed === 'undefined';
        });
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 60000 });
        // CONTROLE DO INSTRUMENTO: a página nasceu sem o método, e o que existe agora (se existe) não
        // é o nativo. Sem isto o caso mediria o método do próprio navegador.
        expect(await page.evaluate(() => globalThis.__semToReversedNoInicio)).toBe(true);
        expect(await page.evaluate(() => String(Array.prototype.toReversed ?? '').includes('[native code]'))).toBe(false);

        const bytes = Array.from(await buildHoleShapefileZip());
        await page.evaluate((b) => {
            const file = new File([new Uint8Array(b)], 'area.zip', { type: 'application/zip' });
            const dados = new DataTransfer();
            dados.items.add(file);
            const alvo = document.getElementById('map-sig');
            for (const tipo of ['dragenter', 'dragover', 'drop']) {
                alvo.dispatchEvent(new DragEvent(tipo, { bubbles: true, cancelable: true, dataTransfer: dados, clientX: 600, clientY: 300 }));
            }
        }, bytes);

        const aviso = page.locator('.toast', { hasText: /importad|importar/i }).first();
        await expect(aviso).toBeVisible({ timeout: 30000 });
        const texto = await aviso.innerText();
        console.log(`[shapefile] aviso="${texto}"`);
        expect(texto).not.toMatch(/não foi possível/i);

        // A feição sai do mesmo gesto que escreveu o aviso, mas a gravação pode chegar um instante depois.
        let poligono = null;
        await expect.poll(async () => {
            poligono = await page.evaluate(async () => {
                const store = await import('/src/js/store/index.js');
                // O mapa local deste contexto nasce vazio, então o único polígono é o importado.
                const lista = (await store.getCurrentMapFeatures())?.polygons ?? [];
                return lista.length === 1
                    ? { tipo: lista[0].geometry?.type, aneis: lista[0].geometry?.coordinates?.length }
                    : null;
            });
            return poligono;
        }, { timeout: 15000 }).not.toBeNull();
        expect(poligono, 'o polígono importado está no mapa').toEqual({ tipo: 'Polygon', aneis: 2 });
    });
});
