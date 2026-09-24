// Path: e2e-ui/figura-aparece-na-hora-em-link-lento.repro.spec.js

/**
 * REPRO: on a slow link the image tool kept the picture off its author's screen for the whole
 * upload, and the three ways that order could go wrong once it is reversed.
 *
 * The tool awaited the upload before writing the feature (`add_image_control.js`). Measured on
 * 2026-09-23 on the 40 kbps link the product targets: a 138 KB picture appeared 38.7 s after the
 * gesture, with nothing on screen meanwhile. Now the tool registers the pendency (awaited: record on
 * disk, id held) and writes the feature at once, and the feature's operation stays prepared until
 * the server confirms the bytes. The cases below are the conditions of that change:
 *
 *  1. the picture appears for the author at once, from the local blob, and the peer NEVER receives
 *     the feature before its bytes (the database is sampled during the whole upload: a feature row
 *     without its image row is a hole);
 *  2. an F5 in the middle of the upload resumes it under the SAME id, and the peer gets the picture;
 *  3. deleting, or undoing, the picture during the upload sends no delete ahead of its create and
 *     leaves no orphan operation, no durable issue and no live feature behind;
 *  4. a definitive refusal on the FIRST attempt (the gap `blob-upload-queue.js` used to declare)
 *     names the figure in a short notice, becomes a durable issue, and does not hold the queue.
 *
 * The link is real: CDP throttling (Chromium only) at 5000 B/s on the backend origin of the
 * author; the peer is on a normal link. The picture goes through the real tool: toolbar, click on
 * the map, file chooser.
 */

import { collabTest, expect, readFeatures, deleteFeatureUI, drawLineUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

const B64 = globalThis.Buffer;
const ALVO = [-53.4, -30.0];
const LADO = 200;

/** A noisy PNG of LADO x LADO, made in the page (a real encoder), about 140 KB. */
async function fotoRuidosa(page) {
    const base64 = await page.evaluate(async (lado) => {
        const canvas = document.createElement('canvas');
        canvas.width = lado;
        canvas.height = lado;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(lado, lado);
        for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }, LADO);
    return { name: 'foto.png', mimeType: 'image/png', buffer: B64.from(base64, 'base64') };
}

async function linkLento(page, baseUrl) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{ urlPattern: `${baseUrl}/*`, latency: 300, downloadThroughput: 5000, uploadThroughput: 5000 }],
    });
    return cdp;
}

/** The real gesture. Returns the new feature's id and how long the author waited to see it. */
async function inserirFoto(page, arquivo) {
    const antes = new Set((await readFeatures(page, 'images')).map((f) => f.id));
    const grupo = page.locator('.toolbar-group[data-group-id="draw"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator('.toolbar-tool-btn[data-tool-id="image"]').click();
    await esperarFerramentaPronta(page, 'image');
    const seletor = page.waitForEvent('filechooser', { timeout: 10000 });
    await clicarNoMapaUI(page, ALVO);
    const t0 = Date.now();
    await (await seletor).setFiles(arquivo);
    let id = null;
    await expect.poll(async () => {
        id = (await readFeatures(page, 'images')).map((f) => f.id).find((x) => !antes.has(x)) ?? null;
        return id !== null;
    }, { timeout: 15000, intervals: [250], message: 'a figura apareceu para quem a inseriu' }).toBe(true);
    return { id, esperaMs: Date.now() - t0 };
}

/** Feature row and image row of `id` on the server, read together. */
async function noServidor(db, id) {
    return db.raw.one(`SELECT (SELECT count(*) FROM features WHERE id = $1 AND deleted_at IS NULL)::int AS feicao,
        (SELECT count(*) FROM features WHERE id = $1)::int AS qualquer,
        (SELECT count(*) FROM images WHERE id = $1)::int AS imagem`, [id]);
}

/** Largura do bitmap que o mapa do par desenha para `id` (o marcador de erro tem 64). */
function larguraNoPar(page, id) {
    return page.evaluate((fid) => {
        const map = globalThis.__ebgeoMap;
        const bruta = map?.getImage?.(fid);
        return (bruta?.data ?? bruta)?.width ?? null;
    }, id);
}

async function filaDoAutor(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return { ops: (await operationQueue.getAll()).length, issues: (await operationQueue.getIssues()).map((i) => i.result?.reason) };
    });
}

collabTest('a figura aparece na hora para quem insere, e o par nunca recebe a feição antes dos bytes', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const arquivo = await fotoRuidosa(A);
    const cdp = await linkLento(A, collab.baseUrl);
    try {
        const { id, esperaMs } = await inserirFoto(A, arquivo);
        console.log(`FIGURA_NA_HORA bytes=${arquivo.buffer.length} esperaMs=${esperaMs}`);
        expect(esperaMs, 'a figura aparece em segundos, não depois da subida inteira').toBeLessThan(5000);

        // During the whole upload: a feature row without its image row is a hole on the peer.
        const limite = Date.now() + 180000;
        let estado = await noServidor(collab.db, id);
        while (!estado.feicao && Date.now() < limite) {
            expect(estado.qualquer, 'nenhuma feição chega ao servidor antes dos bytes').toBe(0);
            await A.waitForTimeout(500);
            estado = await noServidor(collab.db, id);
        }
        expect(estado.feicao).toBe(1);
        expect(estado.imagem, 'quando a feição chega, os bytes já estão lá').toBe(1);
        await expect.poll(() => larguraNoPar(B, id), { timeout: 30000 }).toBe(LADO);
        await expect.poll(async () => (await filaDoAutor(A)).ops, { timeout: 30000 }).toBe(0);
        expect((await filaDoAutor(A)).issues).toEqual([]);
    } finally {
        await cdp.detach().catch(() => {});
    }
});

collabTest('F5 no meio da subida retoma sob o mesmo id, e o par recebe a figura', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const arquivo = await fotoRuidosa(A);
    const cdp = await linkLento(A, collab.baseUrl);
    const { id } = await inserirFoto(A, arquivo);
    await A.waitForTimeout(3000);
    expect((await noServidor(collab.db, id)).imagem, 'o F5 cai com a subida em curso').toBe(0);
    await cdp.detach().catch(() => {});
    await A.reload();
    await expect.poll(async () => (await noServidor(collab.db, id)), { timeout: 120000, intervals: [1000] })
        .toMatchObject({ feicao: 1, imagem: 1 });
    await expect.poll(() => larguraNoPar(B, id), { timeout: 30000 }).toBe(LADO);
    await expect.poll(async () => (await filaDoAutor(A)).ops, { timeout: 30000 }).toBe(0);
    expect((await filaDoAutor(A)).issues).toEqual([]);
});

collabTest('excluir a figura durante a subida não manda o delete antes do create nem deixa op órfã', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const arquivo = await fotoRuidosa(A);
    const cdp = await linkLento(A, collab.baseUrl);
    try {
        const { id } = await inserirFoto(A, arquivo);
        if ((await A.locator('.feature-panel[data-expanded="true"]').count()) > 0) {
            await A.keyboard.press('Escape');
            await A.waitForTimeout(350);
        }
        await deleteFeatureUI(A, id);
        await expect.poll(async () => (await readFeatures(A, 'images')).some((f) => f.id === id), { timeout: 10000 }).toBe(false);
        expect((await noServidor(collab.db, id)).imagem, 'o delete acontece com a subida em curso').toBe(0);

        await expect.poll(async () => (await filaDoAutor(A)).ops, { timeout: 180000, intervals: [1000] }).toBe(0);
        const fila = await filaDoAutor(A);
        const servidor = await noServidor(collab.db, id);
        const recibos = await collab.db.raw.any(
            `SELECT r.result->>'status' AS status, r.result->>'reason' AS reason FROM sync_receipts r
             JOIN operations o ON o.op_id = r.op_id WHERE o.entity_id = $1`, [id]).catch(() => []);
        console.log(`FIGURA_EXCLUIDA fila=${JSON.stringify(fila)} servidor=${JSON.stringify(servidor)} recibos=${JSON.stringify(recibos)}`);
        expect(fila.issues, 'nenhum problema durável').toEqual([]);
        expect(servidor.feicao, 'a figura não existe viva no servidor').toBe(0);
        expect((await readFeatures(B, 'images')).some((f) => f.id === id)).toBe(false);
    } finally {
        await cdp.detach().catch(() => {});
    }
});

collabTest('desfazer a figura durante a subida não deixa op órfã nem figura viva no servidor', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const arquivo = await fotoRuidosa(A);
    const cdp = await linkLento(A, collab.baseUrl);
    try {
        const { id } = await inserirFoto(A, arquivo);
        if ((await A.locator('.feature-panel[data-expanded="true"]').count()) > 0) {
            await A.keyboard.press('Escape');
            await A.waitForTimeout(350);
        }
        // Out of the image tool first (a click on the map would open its file chooser again).
        await A.keyboard.press('Escape');
        await A.waitForTimeout(300);
        await A.keyboard.press('Control+z');
        await expect.poll(async () => (await readFeatures(A, 'images')).some((f) => f.id === id), { timeout: 10000 }).toBe(false);
        expect((await noServidor(collab.db, id)).imagem, 'o desfazer acontece com a subida em curso').toBe(0);

        await expect.poll(async () => (await filaDoAutor(A)).ops, { timeout: 180000, intervals: [1000] }).toBe(0);
        const fila = await filaDoAutor(A);
        const servidor = await noServidor(collab.db, id);
        console.log(`FIGURA_DESFEITA fila=${JSON.stringify(fila)} servidor=${JSON.stringify(servidor)}`);
        expect(fila.issues, 'nenhum problema durável').toEqual([]);
        expect(servidor.feicao, 'a figura não existe viva no servidor').toBe(0);
        expect((await readFeatures(B, 'images')).some((f) => f.id === id)).toBe(false);
    } finally {
        await cdp.detach().catch(() => {});
    }
});

collabTest('recusa definitiva na primeira tentativa: aviso nomeia a figura, vira pendência e a fila anda', async ({ collab }) => {
    const A = collab.author;
    const arquivo = await fotoRuidosa(A);
    // The server's own refusal shape for one item (201, the item in `failed`), answered at once:
    // the refusal lands around the feature's birth, which is the interleaving the gap was about.
    await A.route('**/atlas/*/images/bulk', async (route) => {
        const { images } = route.request().postDataJSON();
        await route.fulfill({
            status: 201, contentType: 'application/json',
            body: JSON.stringify({ data: { uploaded: [], mapping: {},
                failed: images.map((i) => ({ localId: i.localId, error: 'Invalid file type: image/gif' })) } }),
        });
    });
    const { id } = await inserirFoto(A, arquivo);
    const nome = (await readFeatures(A, 'images')).find((f) => f.id === id)?.props?.nome;
    const toast = A.locator('.toast', { hasText: 'não foi enviada ao servidor' });
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    const texto = (await toast.innerText()).trim();
    console.log(`FIGURA_RECUSADA nome=${nome} toast=${JSON.stringify(texto)}`);
    expect(texto).toContain(`A figura "${nome}"`);
    expect(texto).toContain('pendências');

    await expect.poll(async () => (await filaDoAutor(A)).issues.length, { timeout: 20000 }).toBe(1);
    expect((await noServidor(collab.db, id)).qualquer, 'a feição sem figura não sai').toBe(0);
    // The queue is not held behind it.
    await A.unroute('**/atlas/*/images/bulk');

    const linha = await drawLineUI(A, [[-53.45, -30.05], [-53.35, -29.95]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
});
