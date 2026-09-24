// Path: e2e-ui/cobertura-colar-simbolos.spec.js

/**
 * @fileoverview COBERTURA de copiar e colar (Ctrl+C / Ctrl+V pela interface) dos símbolos com raster,
 * num atlas de servidor com o colega. Campanha de cobertura de 2026-09-24
 * (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela colar só era provado num atlas local e pela op de store (`colar-registra-imagem-por-
 * feicao`, Medida de Coordenação e Declinação), sem colega. Aqui, para as quatro ferramentas: a
 * cópia nasce com id novo, vai ao Postgres, chega ao colega, e o colega desenha para o id NOVO o
 * mesmo raster que o autor (SHA-256 dos pixels), também depois do F5 do colega.
 */

import { collabTest, expect, readFeatures, selectFeatureUI } from './helpers/collab.fixtures.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });

const FERRAMENTAS = [
    { nome: 'Símbolo Militar', toolId: 'militarySymbol', ativo: 'militarysymbol', bucket: 'military_symbols' },
    { nome: 'Medida de Coordenação', toolId: 'coordination', ativo: 'coordinationmeasure', bucket: 'coordination_measures' },
    { nome: 'Símbolo de Engenharia', toolId: 'engineeringSymbol', ativo: 'engineeringsymbol', bucket: 'engineering_symbols' },
    { nome: 'Declinação Magnética', toolId: 'declination', ativo: 'declination', bucket: 'magnetic_declinations' },
];

const raster = (page, id) => page.evaluate(async (fid) => {
    const image = globalThis.__ebgeoMap?.getImage(fid);
    const bitmap = image?.data ?? image;
    if (!bitmap?.data || !bitmap.width) return null;
    const digest = await crypto.subtle.digest('SHA-256', bitmap.data);
    return { width: bitmap.width, height: bitmap.height,
        hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}, id);

async function criarPelaBarra(page, { toolId, ativo, bucket }) {
    const antes = new Set((await readFeatures(page, bucket)).map((f) => f.id));
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await page.locator(`.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, ativo);
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    let id = null;
    await expect.poll(async () => {
        id = (await readFeatures(page, bucket)).map((f) => f.id).find((x) => !antes.has(x)) ?? null;
        return id;
    }, { timeout: 15000 }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`${ferramenta.nome}: Ctrl+C / Ctrl+V chega ao colega com o mesmo raster`, async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const { bucket } = ferramenta;
        const original = await criarPelaBarra(A, ferramenta);

        await selectFeatureUI(A, original);
        await A.locator('#map-sig .maplibregl-canvas').hover();
        await A.keyboard.press('Control+c');
        await A.keyboard.press('Control+v');
        await expect(A.locator('.toast--success', { hasText: /colada/i })).toBeVisible({ timeout: 10000 });

        let copia = null;
        await expect.poll(async () => {
            copia = (await readFeatures(A, bucket)).map((f) => f.id).find((x) => x !== original) ?? null;
            return copia;
        }, { timeout: 15000, message: 'a colagem nao criou feicao' }).toBeTruthy();

        const rasterAutor = await expect.poll(() => raster(A, copia), { timeout: 15000 }).not.toBeNull().then(() => raster(A, copia));
        expect(rasterAutor.width).toBeGreaterThan(8);
        await expect.poll(async () => {
            const row = await collab.db.queryFeatureRow(copia);
            return row ? row.deleted_at === null : 'sem linha';
        }, { timeout: 30000 }).toBe(true);
        await expect.poll(() => raster(B, copia), { timeout: 30000, message: 'o colega nao desenhou a copia' }).toEqual(rasterAutor);

        await B.reload();
        await B.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => raster(B, copia), { timeout: 30000, message: 'depois do F5 o colega perdeu o raster da copia' }).toEqual(rasterAutor);
    });
}
