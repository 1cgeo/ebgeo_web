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
async function fotoInline(page, { largura = 800, altura = 600 } = {}) {
    return page.evaluate(async ({ largura, altura }) => {
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, largura, altura);
        g.addColorStop(0, '#8a3c3c');
        g.addColorStop(1, '#3c6a8a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, largura, altura);
        const img = ctx.getImageData(0, 0, largura, altura);
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
    }, { largura, altura });
}

/**
 * Uma linha sincronizada cuja foto um CLIENTE ANTIGO escreveu inline, e que os dois clientes já têm.
 * @returns {Promise<{linha: string, foto: Object}>}
 */
async function linhaComFotoInline(collab, browser, opcoes = {}) {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });

    // O CLIENTE ANTIGO escreve a foto inline, pelo transporte de verdade.
    const foto = await fotoInline(A, opcoes);
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
    return { linha, foto };
}

collabTest('foto inline de atlas de servidor: a próxima edição a converte, a op sai sem bytes e o colega abre a foto', async ({ collab, browser }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const { linha, foto } = await linhaComFotoInline(collab, browser);

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

/**
 * O CENÁRIO DA REVISÃO (2026-09-24, item 1): num link de 40 kbps, renomear uma feição com foto inline
 * e, depois de a op de uma edição comum já ter tido tempo de chegar, clicar "Sair". Antes do conserto a
 * op saía em segundos e a foto em minutos: o censo de saída contava zero, "Sair" não perguntava nada,
 * e o namespace e a única cópia dos bytes morriam com o servidor já citando a foto. Agora a op espera a
 * foto, o censo conta a op e a subida, e "Sair" pergunta.
 */
collabTest('link lento: renomear a feição com foto inline e clicar "Sair" pergunta, e a foto chega depois', async ({ collab, browser, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const { linha } = await linhaComFotoInline(collab, browser, { largura: 1400, altura: 1050 });

    const cdp = await A.context().newCDPSession(A);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{ urlPattern: `${collab.baseUrl}/*`, latency: 300, downloadThroughput: 5000, uploadThroughput: 5000 }],
    });
    try {
        await selectAndRenameUI(A, linha, 'Renomeada no link lento');
        // Tempo de sobra para uma edição comum (um nome e três miniaturas, ~36 KB) chegar a 5000 B/s,
        // disputando o link com a subida da foto; a foto (~1 MB) leva minutos. Medido sem o conserto:
        // a 15 s a op ainda não tinha chegado, então o caso não media nada.
        await A.waitForTimeout(45000);
        const naLinha = await collab.db.queryFeatureRow(linha);
        // A foto que o servidor cita POR REFERÊNCIA (sem `data`); a inline traz os bytes na própria linha.
        const primeira = naLinha?.properties?.images?.[0];
        const citada = primeira && typeof primeira.data !== 'string' ? primeira.id : null;
        const temImagem = citada ? await collab.db.raw.oneOrNone('SELECT id FROM images WHERE id::text = $1', [citada]) : null;
        console.log(`FOTO_SAIR nome=${naLinha?.properties?.nome} citada=${citada ?? '-'} imagem=${temImagem ? 'sim' : 'nao'}`);
        expect(!citada || !!temImagem, 'o servidor não cita a foto sem os bytes').toBe(true);

        await A.locator('[data-testid="account-control"] .account-control__identity').click();
        await A.getByTestId('account-logout-btn').click();
        await expect(A.getByRole('alertdialog'), '"Sair" pergunta: há trabalho não enviado').toContainText('Sair com alterações pendentes?', { timeout: 15000 });
        await A.getByRole('button', { name: 'Continuar no EBGeo', exact: true }).click();
    } finally {
        await cdp.detach().catch(() => {});
    }

    // Sem o freio, a edição e a foto chegam juntas, e o colega abre a foto.
    await expect.poll(async () => (await collab.db.queryFeatureRow(linha))?.properties?.nome ?? null, { timeout: 180000 })
        .toBe('Renomeada no link lento');
    const convertida = (await collab.db.queryFeatureRow(linha)).properties.images[0];
    expect(convertida).not.toHaveProperty('data');
    expect((await collab.db.raw.oneOrNone('SELECT id FROM images WHERE id = $1', [convertida.id]))?.id).toBe(convertida.id);
    await pollPeerFeatureWhere(B, 'lines', linha, (props) => props?.images?.[0]?.id === convertida.id);
    await selectFeatureUI(B, linha);
    await B.locator('.feature-photo-gallery-grid img').first().click();
    const inteira = B.locator('.feature-photo-viewer img');
    await expect(inteira).toBeVisible();
    await expect.poll(() => inteira.evaluate((el) => el.naturalWidth), { timeout: 30000 }).toBe(1400);
});
