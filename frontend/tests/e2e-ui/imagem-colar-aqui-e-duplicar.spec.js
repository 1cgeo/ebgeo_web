// Path: e2e-ui/imagem-colar-aqui-e-duplicar.spec.js

/**
 * @fileoverview "COLAR AQUI" E "DUPLICAR SELEÇÃO" PELO MENU DE CONTEXTO REAL: a figura colada chega ao
 * colega com os BYTES, sob o id novo.
 *
 * As duas portas cunham id novo NO CLIENTE e sobem o blob por `uploadCopiedBlobsIfRemote`
 * (`store/upload-copied-blobs.js`) antes de a op da feição sair. A colagem por Ctrl+V tem teste de
 * navegador (`browser-collab-colar-imagem.spec.js`, pelo ClipboardManager chamado da página); o
 * "Colar Aqui" só tinha teste de integração com dublê (`colar-imagem-sobe-ao-servidor.repro`), e o
 * "Duplicar Seleção" nenhum com figura. Aqui as duas saem do MENU de contexto, clicado com o botão
 * direito no canvas, como a pessoa faz.
 *
 * O veredito, para cada cópia: o id é novo, a linha de `images` existe sob ele com o tamanho do
 * original, o colega lê por `getImage` o mesmo SHA-256 (ele nunca teve esses bytes por outra via)
 * e o mapa do colega desenha a figura (largura e cor, que separam do placeholder de 404).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-colar-aqui-e-duplicar --retries=0 --workers=1
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';
import {
    figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho, linhaDeImagem,
} from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const COR = [150, 60, 200];

/** Clica com o botão direito num ponto do canvas (fração da largura e da altura) e espera o menu. */
async function abrirMenuDeContexto(page, fx = 0.6, fy = 0.6) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    const at = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible({ timeout: 8000 });
    return menu;
}

/** Espera nascer UMA feição de imagem fora de `conhecidos` no autor, e a devolve. */
async function novaImagem(page, conhecidos) {
    let nova = null;
    await expect.poll(async () => {
        nova = (await readFeatures(page, 'images')).map((f) => f.id).find((id) => !conhecidos.has(id)) ?? null;
        return nova;
    }, { timeout: 15000, message: 'a cópia não nasceu' }).not.toBeNull();
    return nova;
}

/** Os bytes da cópia: no Postgres, no colega (SHA) e no desenho do colega. */
async function conferirCopia(collab, id, original, rotulo) {
    await expect.poll(() => linhaDeImagem(collab.db, id), { timeout: 30000, message: `${rotulo}: os bytes nunca subiram` })
        .toMatchObject({ id, size_bytes: original.size });
    const B = collab.peers[0];
    await expect.poll(async () => (await impressaoDoBlob(B, id))?.sha ?? null, { timeout: 30000,
        message: `${rotulo}: o colega não lê os bytes da cópia` }).toBe(original.sha);
    await esperarDesenho(B, id, COR, { rotulo: `${rotulo}, no colega:` });
}

collabTest.describe('Colar Aqui e Duplicar Seleção com uma figura, pelo menu de contexto', () => {
    collabTest('as duas cópias chegam ao colega com os bytes, sob id novo', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const png = await figuraSolida(A, COR);
        const id = await porImagemPelaFerramenta(A, { name: 'roxa.png', mimeType: 'image/png', buffer: png });
        await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.id ?? null, { timeout: 30000 }).toBe(id);
        const original = await impressaoDoBlob(A, id);

        // COPIAR a figura selecionada e COLAR AQUI noutro ponto do mapa.
        await A.keyboard.press('Escape');
        await selectFeatureUI(A, id);
        const menuCopia = await abrirMenuDeContexto(A);
        await menuCopia.locator('.context-menu-item', { hasText: /^Copiar Feiç/ }).first().click();
        const conhecidos = new Set((await readFeatures(A, 'images')).map((f) => f.id));
        const menuCola = await abrirMenuDeContexto(A, 0.75, 0.4);
        const colar = menuCola.locator('.context-menu-item', { hasText: /^Colar Aqui \(1\)$/ });
        await expect(colar).toBeVisible();
        await colar.click();
        const colada = await novaImagem(A, conhecidos);
        expect(colada).not.toBe(id);
        await conferirCopia(collab, colada, original, 'Colar Aqui');

        // DUPLICAR SELEÇÃO sobre a original.
        await A.keyboard.press('Escape');
        await selectFeatureUI(A, id);
        conhecidos.add(colada);
        const menuDup = await abrirMenuDeContexto(A);
        await menuDup.locator('.context-menu-item', { hasText: 'Duplicar Seleção' }).click();
        const duplicada = await novaImagem(A, conhecidos);
        await conferirCopia(collab, duplicada, original, 'Duplicar Seleção');

        // Controle: o original continua com os mesmos bytes no colega.
        await expect.poll(async () => (await impressaoDoBlob(collab.peers[0], id))?.sha ?? null, { timeout: 30000 }).toBe(original.sha);
    });
});
