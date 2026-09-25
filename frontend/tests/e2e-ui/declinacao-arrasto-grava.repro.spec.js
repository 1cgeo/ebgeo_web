// Path: e2e-ui/declinacao-arrasto-grava.repro.spec.js

/**
 * @fileoverview ARRASTAR A DECLINAÇÃO MAGNÉTICA GRAVA A POSIÇÃO PELO PRÓPRIO GESTO, como nas outras
 * ferramentas de símbolo. Achado ao medir o caso Declinação de `cobertura-simbolos-taticos.spec.js`,
 * que reprovava cerca de 1 vez em 4 com "o arrasto nao moveu a feicao".
 *
 * A CAUSA: o arrasto (`tool_manager/move_handler.js`) grava a feição movida por
 * `selectionManager.updateSelectedFeatures()`, que chama `control.updateFeatures(features, true)`.
 * O controle da Declinação não tinha esse método, e caía no vazio do `BaseControl`: o gesto só
 * remendava a FONTE do mapa. A posição chegava à store por acaso, quando o painel da feição salvava
 * (a reconstrução depois do arrasto regrava a versão da fonte, porque o `hasFeatureChanged` herdado
 * é sempre verdadeiro). Dois jeitos de perder o arrasto, os dois medidos:
 *  - uma reconstrução das fontes a partir da store (`layers/remote-feature-render.js`, na op de um
 *    colega) entre o arrasto e o salvamento do painel repunha a geometria antiga, e o painel então
 *    gravava a antiga com as propriedades do WMM novas (a sonda viu a entrada de desfazer com a
 *    geometria de antes dos dois lados). É o vermelho intermitente da cobertura;
 *  - com o painel RECOLHIDO por uma aba da barra lateral (a feição continua selecionada), não há
 *    conteúdo antigo para salvar quando o arrasto reabre o painel, e nada grava a posição até a
 *    próxima desseleção. É este caso, e ele é determinístico: não depende de corrida.
 *
 * O CONSERTO TEM DUAS METADES, e a segunda só apareceu depois da primeira: o controle ganhou o
 * `updateFeatures` (store primeiro, depois a fonte, com o WMM da posição nova na mesma escrita), e
 * o salvamento do painel passou a gravar só o que o painel editou. Só com a primeira metade, o
 * salvamento que regravava a cópia da fonte ainda corria com o arrasto: 3 de 8 da cobertura
 * reprovaram, agora em "Ctrl+Z nao desfez o arrasto" e no servidor com a posição antiga. A segunda
 * metade é presa em `tests/unit/declination-color-preview.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { readFeatures, selectFeatureUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const BUCKET = 'magnetic_declinations';

/** A feição na store da página, ou null. */
const naStore = (page, id) => page.evaluate(async ({ b, fid }) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures())[b] ?? []).find((x) => x.properties?.id === fid);
    return f ? JSON.parse(JSON.stringify({ c: f.geometry.coordinates, latitude: f.properties.latitude })) : null;
}, { b: BUCKET, fid: id });

/** A feição na FONTE do mapa (o que está desenhado), ou null. */
const naFonte = (page, id) => page.evaluate(async (fid) => {
    const data = await globalThis.__ebgeoMap.getSource('magnetic_declinations')?.getData();
    const f = data?.features?.find((x) => x.properties?.id === fid);
    return f ? JSON.parse(JSON.stringify({ c: f.geometry.coordinates, latitude: f.properties.latitude })) : null;
}, id);

async function criarDeclinacao(page) {
    const antes = new Set((await readFeatures(page, BUCKET)).map((f) => f.id));
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="declination"]').click();
    await esperarFerramentaPronta(page, 'declination');
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    let id = null;
    await expect.poll(async () => {
        id = (await readFeatures(page, BUCKET)).map((f) => f.id).find((x) => !antes.has(x)) ?? null;
        return id;
    }, { timeout: 15000, message: 'a declinacao nao nasceu' }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

describeOrSkip('arrastar a Declinação Magnética', () => {
    test.describe.configure({ retries: 0 });

    test('com o painel recolhido e a feição selecionada, o arrasto chega à store', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        const id = await criarDeclinacao(page);

        await selectFeatureUI(page, id);
        // O painel recolhe e a feição continua selecionada: é o que `expandSidebar` faz de propósito.
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 10000 });
        await expect.poll(() => page.evaluate(async () => {
            const { getStateManager } = await import('/src/js/store/index.js');
            return getStateManager().getSelectedFeatures().map((f) => String(f.id));
        }), { timeout: 10000, message: 'a feicao deixou de estar selecionada' }).toEqual([String(id)]);

        const antes = await naStore(page, id);
        const de = await page.evaluate((c) => {
            const map = globalThis.__ebgeoMap;
            const r = map.getCanvas().getBoundingClientRect();
            const p = map.project(c);
            return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
        }, antes.c);
        await page.mouse.move(de.x, de.y);
        await page.mouse.down();
        await page.mouse.move(de.x + 40, de.y + 20, { steps: 6 });
        await page.mouse.move(de.x + 80, de.y + 40, { steps: 6 });
        await page.mouse.up();

        // O GESTO TERMINOU quando a fonte desenha a posição nova com o WMM recalculado nela (o
        // recálculo é o último passo do arrasto, `syncEditHandlesAfterDrag`).
        let fonte = null;
        await expect.poll(async () => {
            fonte = await naFonte(page, id);
            return Boolean(fonte && fonte.c[0] !== antes.c[0] && fonte.latitude !== antes.latitude);
        }, { timeout: 15000, message: 'o arrasto nao chegou a fonte' }).toBe(true);

        await expect.poll(async () => (await naStore(page, id))?.c, {
            timeout: 5000, message: 'o arrasto ficou so na fonte: a store guarda a posicao antiga',
        }).toEqual(fonte.c);
        expect((await naStore(page, id)).latitude, 'o WMM da posicao nova nao chegou a store').toBe(fonte.latitude);
    });
});
