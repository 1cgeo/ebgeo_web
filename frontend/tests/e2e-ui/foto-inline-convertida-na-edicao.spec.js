// Path: e2e-ui/foto-inline-convertida-na-edicao.spec.js

/**
 * FASE 2c DAS FOTOS ANEXAS, A REDE DE SEGURANÇA (decisão do dono de 2026-09-24): a feição de um atlas
 * de SERVIDOR que ainda carrega uma foto INLINE (escrita por um cliente anterior à fase 2b, que é
 * todo o acervo de hoje) a converte na PRÓXIMA edição. A edição sai com a referência e a miniatura;
 * os bytes sobem sozinhos pela fila durável, sob um id novo; o colega abre a foto inteira.
 *
 * O cliente antigo é simulado pelo transporte real: uma op de feição com a foto em `data`, empurrada
 * por uma terceira página, que é exatamente o que um navegador com o build anterior manda. A edição
 * que converte é um GESTO de interface (renomear pelo painel).
 */

import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { selectAndRenameUI, selectFeatureUI, pollPeerFeatureWhere } from './helpers/collab-helpers.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(240000);

/** A JPEG made by the page's own encoder, and a thumbnail, both as data URLs (the inline shape). */
async function fotoInline(page) {
    return page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 800, 600);
        g.addColorStop(0, '#8a3c3c');
        g.addColorStop(1, '#3c6a8a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 800, 600);
        const img = ctx.getImageData(0, 0, 800, 600);
        let x = 11;
        for (let i = 0; i < img.data.length; i += 4) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            const n = (x % 31) - 15;
            img.data[i] += n;
            img.data[i + 1] += n;
            img.data[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
        const data = canvas.toDataURL('image/jpeg', 0.9);
        const mini = document.createElement('canvas');
        mini.width = 150;
        mini.height = 113;
        mini.getContext('2d').drawImage(canvas, 0, 0, 150, 113);
        const thumbnail = mini.toDataURL('image/jpeg', 0.7);
        return { id: crypto.randomUUID(), name: 'vistoria-antiga.jpg', type: 'image/jpeg', size: 1, data, thumbnail, addedAt: 1 };
    });
}

collabTest('foto inline de atlas de servidor: a próxima edição a converte, a op sai sem bytes e o colega abre a foto', async ({ collab, browser }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });

    // 1) O CLIENTE ANTIGO escreve a foto inline, pelo transporte de verdade.
    const foto = await fotoInline(A);
    const linhaNoServidor = await collab.db.raw.one(
        'SELECT geometry, properties, version FROM features WHERE id = $1', [linha]);
    const legado = await browser.newPage();
    try {
        await legado.goto('/atlas.html');
        const api = await clienteNaPagina(legado, collab.userA);
        // The v2 envelope the product sends: the patch is computed against the confirmed version.
        await legado.evaluate(async ({ api: cliente, atlasId, mapId, id, geometry, properties, version, foto: inline }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const anterior = { type: 'Feature', geometry, properties: { ...properties, confirmedVersion: Number(version) } };
            const data = { ...anterior, properties: { ...anterior.properties, images: [inline] } };
            await cliente.pushOperations(atlasId, [createOperation('feature', 'update', id, mapId, data, anterior)]);
        }, { api, atlasId: collab.atlasId, mapId: collab.mapId, id: linha, ...linhaNoServidor, foto });
        await expect.poll(async () => (await collab.db.queryFeatureRow(linha))?.properties?.images?.[0]?.data?.slice(0, 15) ?? null,
            { timeout: 15000 }).toBe('data:image/jpeg');
    } finally {
        await legado.close();
    }
    const temInline = (props) => props?.images?.[0]?.data?.startsWith('data:image/jpeg') === true;
    await pollPeerFeatureWhere(A, 'lines', linha, temInline);
    await pollPeerFeatureWhere(B, 'lines', linha, temInline);

    // 2) A EDIÇÃO: renomear pelo painel. Mede o que A empurra dali em diante.
    const trecho = foto.data.slice(foto.data.indexOf(',') + 1000, foto.data.indexOf(',') + 1200);
    const pushes = [];
    A.on('request', (req) => {
        if (req.method() === 'POST' && req.url().endsWith(`/atlas/${collab.atlasId}/sync`)) {
            const corpo = req.postData() ?? '';
            pushes.push({ bytes: globalThis.Buffer.byteLength(corpo), levaAFoto: corpo.includes(trecho) });
        }
    });
    await selectAndRenameUI(A, linha, 'Renomeada');

    await expect.poll(async () => (await collab.db.queryFeatureRow(linha))?.properties?.nome ?? null, { timeout: 30000 }).toBe('Renomeada');
    const convertida = (await collab.db.queryFeatureRow(linha)).properties.images[0];
    console.log(`FOTO_INLINE_CONVERTIDA inline=${foto.data.length} pushes=${JSON.stringify(pushes)} id=${convertida.id}`);
    expect(convertida, 'o servidor guarda a referência, sem os bytes').not.toHaveProperty('data');
    expect(convertida.id, 'id NOVO: o inline pode existir em outro atlas clonado').not.toBe(foto.id);
    expect(convertida.thumbnail).toBe(foto.thumbnail);
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.some((p) => p.levaAFoto), 'nenhum push depois da conversão leva a foto').toBe(false);

    // 3) Os bytes sobem sozinhos, sob o id novo, e o colega abre a foto inteira.
    await expect.poll(async () => (await collab.db.raw.oneOrNone('SELECT id FROM images WHERE id = $1', [convertida.id]))?.id ?? null,
        { timeout: 60000 }).toBe(convertida.id);
    const noA = (await readFeatures(A, 'lines')).find((f) => f.id === linha).props.images[0];
    expect(noA).not.toHaveProperty('data');
    expect(noA.id).toBe(convertida.id);

    await pollPeerFeatureWhere(B, 'lines', linha, (props) => props?.images?.[0]?.id === convertida.id);
    await selectFeatureUI(B, linha);
    await B.locator('.feature-photo-gallery-grid img').first().click();
    const inteira = B.locator('.feature-photo-viewer img');
    await expect(inteira).toBeVisible();
    await expect.poll(() => inteira.evaluate((el) => el.naturalWidth), { timeout: 30000 }).toBe(800);
});
