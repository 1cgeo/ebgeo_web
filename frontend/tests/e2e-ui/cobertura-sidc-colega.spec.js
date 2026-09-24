// Path: e2e-ui/cobertura-sidc-colega.spec.js

/**
 * @fileoverview COBERTURA da troca de SIDC do Símbolo Militar pelo campo do modal "Configurar
 * Símbolo", com o colega. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela o SIDC só mudava por op de store (`browser-collab-feature-mutations`), e nenhum spec
 * conferia que o colega redesenha o raster depois de uma troca feita pela interface. Aqui a
 * identidade padrão (dígitos 3 e 4 do SIDC) passa de amigo (03) para hostil (06) pelo campo SIDC,
 * e o raster do autor muda, o do colega fica IGUAL ao do autor (SHA-256), e os dois sobrevivem ao
 * F5 nos dois.
 */

import { collabTest, expect, readFeatures, selectFeatureUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const raster = (page, id) => page.evaluate(async (fid) => {
    const image = globalThis.__ebgeoMap?.getImage(fid);
    const bitmap = image?.data ?? image;
    if (!bitmap?.data || !bitmap.width) return null;
    const digest = await crypto.subtle.digest('SHA-256', bitmap.data);
    return { width: bitmap.width, height: bitmap.height,
        hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}, id);

const sidcDe = async (page, id) => (await readFeatures(page, 'military_symbols')).find((f) => f.id === id)?.props?.sidc ?? null;

collabTest('SIDC trocado pelo campo do modal: o colega redesenha o mesmo raster, e o F5 nos dois mantém', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const antes = await expect.poll(() => raster(A, id), { timeout: 15000 }).not.toBeNull().then(() => raster(A, id));
    await expect.poll(() => raster(B, id), { timeout: 30000 }).toEqual(antes);

    await selectFeatureUI(A, id);
    await A.getByRole('button', { name: 'Configurar Símbolo', exact: true }).click();
    const modal = A.locator('.symbol-selector-modal-container');
    const campo = modal.locator('.symbol-selector-sidc-input');
    await expect(campo).toBeVisible({ timeout: 10000 });
    const atual = (await campo.inputValue()).replace(/\s/g, '');
    expect(atual.slice(2, 4), `SIDC inicial ${atual}`).toBe('03');
    const hostil = `${atual.slice(0, 2)}06${atual.slice(4)}`;
    await campo.fill(hostil);
    await expect(modal.locator('.symbol-selector-sidc-status')).toContainText('SIDC', { timeout: 5000 });
    await modal.locator('.symbol-selector-btn-apply').click();
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    await expect.poll(async () => (await sidcDe(A, id))?.replace(/\s/g, '').slice(2, 4), { timeout: 15000 }).toBe('06');
    const sidcNovo = await sidcDe(A, id);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.sidc ?? null, { timeout: 30000 }).toBe(sidcNovo);
    await expect.poll(() => sidcDe(B, id), { timeout: 30000 }).toBe(sidcNovo);
    await expect.poll(async () => (await raster(A, id))?.hash, { timeout: 15000, message: 'o raster do autor nao mudou' }).not.toBe(antes.hash);
    const depois = await raster(A, id);
    await expect.poll(() => raster(B, id), { timeout: 30000, message: 'o colega nao redesenhou o raster novo' }).toEqual(depois);

    for (const page of [A, B]) {
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => sidcDe(page, id), { timeout: 30000 }).toBe(sidcNovo);
        await expect.poll(() => raster(page, id), { timeout: 30000 }).toEqual(depois);
    }
});
