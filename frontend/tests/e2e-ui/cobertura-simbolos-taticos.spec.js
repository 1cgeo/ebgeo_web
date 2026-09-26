// Path: e2e-ui/cobertura-simbolos-taticos.spec.js

/**
 * @fileoverview COBERTURA das quatro ferramentas de símbolo da barra Militar, num atlas de servidor
 * com dois usuários: Símbolo Militar, Medida de Coordenação, Símbolo de Engenharia e Declinação
 * Magnética. Campanha de cobertura de 2026-09-24.
 *
 * UM CASO POR FERRAMENTA, e o mesmo roteiro em todas, pela interface: criar pela barra; o colega
 * ver o RASTER regenerado (comparado por SHA-256 dos pixels, nunca por `hasImage`, que o
 * placeholder de erro também satisfaz); o Tamanho do painel; um atributo pela aba Atributos;
 * arrastar; desfazer o arrasto; F5 nos dois; excluir. Cada etapa é conferida em TRÊS lugares: no
 * store de quem fez, na linha do Postgres e no store do colega.
 *
 * Antes desta campanha só o Símbolo de Engenharia tinha colega vendo o raster e F5 nos dois
 * (`engineering-symbol-collaboration.spec.js`); estilo, atributos, arrastar, desfazer o arrasto e
 * excluir não tinham spec de navegador para nenhuma das quatro.
 */

import { collabTest, expect, readFeatures, selectFeatureUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });

const FERRAMENTAS = [
    { nome: 'Símbolo Militar', toolId: 'militarySymbol', ativo: 'militarysymbol', bucket: 'military_symbols' },
    { nome: 'Medida de Coordenação', toolId: 'coordination', ativo: 'coordinationmeasure', bucket: 'coordination_measures' },
    { nome: 'Símbolo de Engenharia', toolId: 'engineeringSymbol', ativo: 'engineeringsymbol', bucket: 'engineering_symbols' },
    { nome: 'Declinação Magnética', toolId: 'declination', ativo: 'declination', bucket: 'magnetic_declinations' },
];

/** SHA-256 dos pixels da imagem que o mapa desenha sob o id da feição. */
const raster = (page, id) => page.evaluate(async (fid) => {
    const image = globalThis.__ebgeoMap?.getImage(fid);
    const bitmap = image?.data ?? image;
    if (!bitmap?.data || !bitmap.width) return null;
    const digest = await crypto.subtle.digest('SHA-256', bitmap.data);
    return { width: bitmap.width, height: bitmap.height,
        hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') };
}, id);

/** A feição no store da página, ou null. */
async function noStore(page, bucket, id) {
    return page.evaluate(async ({ b, fid }) => {
        const s = await import('/src/js/store/index.js');
        const f = (await s.getCurrentMapFeatures())[b] ?? [];
        const x = f.find((y) => y.properties?.id === fid);
        return x ? JSON.parse(JSON.stringify({ geometry: x.geometry, props: x.properties })) : null;
    }, { b: bucket, fid: id });
}

/** A linha no Postgres, ou null. */
async function noServidor(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row ? { geometry: row.geometry, props: row.properties, apagada: row.deleted_at !== null } : null;
}

const coords = (x) => x?.geometry?.coordinates?.map((c) => Math.round(c * 1e6) / 1e6) ?? null;

/** Cria pela barra, clicando no centro do mapa, e devolve o id novo. */
async function criarPelaBarra(page, { toolId, ativo, bucket }) {
    const antes = new Set((await readFeatures(page, bucket)).map((f) => f.id));
    await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 13 }));
    await page.locator('.toolbar-group[data-group-id="military"] .toolbar-group-btn').click();
    await expect(page.locator('.toolbar-group[data-group-id="military"] .toolbar-popup'))
        .toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await page.locator(`.toolbar-group[data-group-id="military"] .toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, ativo);
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45);
    let id = null;
    await expect.poll(async () => {
        id = (await readFeatures(page, bucket)).map((f) => f.id).find((x) => !antes.has(x)) ?? null;
        return id;
    }, { timeout: 15000, message: `${toolId} nao criou feicao` }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

/** O pixel de viewport onde a feição (um ponto) está desenhada agora. */
async function pixelDa(page, bucket, id) {
    const f = await noStore(page, bucket, id);
    return page.evaluate((c) => {
        const map = globalThis.__ebgeoMap;
        const r = map.getCanvas().getBoundingClientRect();
        const p = map.project(c);
        return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
    }, f.geometry.coordinates);
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`${ferramenta.nome}: criar, colega vê o raster, estilo, atributo, arrastar, desfazer, F5 e excluir`, async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const { bucket } = ferramenta;

        // 1) CRIAR pela barra, e o colega vê o MESMO raster sem nunca ter usado a ferramenta.
        const id = await criarPelaBarra(A, ferramenta);
        await expect.poll(() => noServidor(collab, id).then((r) => r && !r.apagada), { timeout: 30000 }).toBe(true);
        await expect.poll(() => noStore(B, bucket, id).then(Boolean), { timeout: 30000 }).toBe(true);
        const rasterA = await raster(A, id);
        expect(rasterA?.width, 'o autor desenha o raster').toBeGreaterThan(8);
        await expect.poll(() => raster(B, id), { timeout: 30000, message: 'o colega nao regenerou o mesmo raster' })
            .toEqual(rasterA);

        // 2) ESTILO: Tamanho pelo painel.
        await selectFeatureUI(A, id);
        const painel = A.locator('.feature-panel[data-expanded="true"]');
        const tamanho = painel.locator('.attr-modern-slider', { hasText: 'Tamanho' }).locator('.attr-modern-slider-input').first();
        await tamanho.fill('2');
        await tamanho.press('Tab');
        const salvar = painel.locator('.attr-modern-btn-save').first();
        if (await salvar.isVisible().catch(() => false)) await salvar.click();
        await expect.poll(() => noServidor(collab, id).then((r) => r?.props?.size), { timeout: 30000, message: 'o Tamanho nao chegou ao servidor' }).toBe(2);
        await expect.poll(() => noStore(B, bucket, id).then((r) => r?.props?.size), { timeout: 30000 }).toBe(2);

        // 3) ATRIBUTO pela aba Atributos. "Salvar" fecha o painel, então a feição é aberta de novo.
        await selectFeatureUI(A, id);
        await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
        const aba = painel.locator('.feature-tab-content[data-tab-id="atributos"]');
        await aba.locator('.feature-attributes-add-btn').click();
        const [chave, valor] = await aba.locator('.feature-attributes-inline-input').all();
        await chave.fill('efetivo');
        await valor.fill('120');
        await aba.locator('.feature-attributes-inline-confirm').click();
        await expect.poll(() => noServidor(collab, id).then((r) => r?.props?.attributes), { timeout: 30000 }).toEqual({ efetivo: '120' });
        await expect.poll(() => noStore(B, bucket, id).then((r) => r?.props?.attributes), { timeout: 30000 }).toEqual({ efetivo: '120' });

        // 4) ARRASTAR com a feição selecionada, e o colega recebe a posição nova.
        const original = coords(await noStore(A, bucket, id));
        const de = await pixelDa(A, bucket, id);
        await A.mouse.move(de.x, de.y);
        await A.mouse.down();
        await A.mouse.move(de.x + 40, de.y + 20, { steps: 6 });
        await A.mouse.move(de.x + 80, de.y + 40, { steps: 6 });
        await A.mouse.up();
        await expect.poll(async () => coords(await noStore(A, bucket, id)), { timeout: 15000, message: 'o arrasto nao moveu a feicao' })
            .not.toEqual(original);
        const movida = coords(await noStore(A, bucket, id));
        await expect.poll(async () => coords(await noServidor(collab, id)), { timeout: 30000 }).toEqual(movida);
        await expect.poll(async () => coords(await noStore(B, bucket, id)), { timeout: 30000 }).toEqual(movida);

        // 5) DESFAZER o arrasto: volta para a posição original nos três lugares.
        await A.keyboard.press('Escape');
        await A.locator('#map-sig .maplibregl-canvas').focus().catch(() => {});
        await A.keyboard.press('Control+z');
        await expect.poll(async () => coords(await noStore(A, bucket, id)), { timeout: 15000, message: 'Ctrl+Z nao desfez o arrasto' })
            .toEqual(original);
        await expect.poll(async () => coords(await noServidor(collab, id)), { timeout: 30000 }).toEqual(original);
        await expect.poll(async () => coords(await noStore(B, bucket, id)), { timeout: 30000 }).toEqual(original);
        // O desfazer do arrasto não leva junto o estilo nem o atributo.
        expect((await noStore(A, bucket, id)).props.size).toBe(2);
        expect((await noStore(A, bucket, id)).props.attributes).toEqual({ efetivo: '120' });

        // 6) F5 NOS DOIS: tudo volta do disco e o colega regenera o mesmo raster do autor.
        for (const page of [A, B]) {
            await page.reload();
            await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
            await expect.poll(async () => {
                const f = await noStore(page, bucket, id);
                return f ? { size: f.props.size, attributes: f.props.attributes, c: coords(f) } : null;
            }, { timeout: 30000 }).toEqual({ size: 2, attributes: { efetivo: '120' }, c: original });
        }
        const rasterDepois = await expect.poll(() => raster(A, id), { timeout: 30000 }).not.toBeNull().then(() => raster(A, id));
        await expect.poll(() => raster(B, id), { timeout: 30000, message: 'depois do F5 o colega desenha outro raster' })
            .toEqual(rasterDepois);

        // 7) EXCLUIR pela interface: some do colega e o servidor marca apagada.
        await deleteFeatureUI(A, id);
        await expect.poll(() => noStore(A, bucket, id), { timeout: 15000 }).toBeNull();
        await expect.poll(() => noServidor(collab, id).then((r) => r?.apagada), { timeout: 30000 }).toBe(true);
        await expect.poll(() => noStore(B, bucket, id), { timeout: 30000 }).toBeNull();
    });
}
