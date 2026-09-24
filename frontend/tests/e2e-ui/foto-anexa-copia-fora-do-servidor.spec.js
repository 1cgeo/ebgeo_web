// Path: e2e-ui/foto-anexa-copia-fora-do-servidor.spec.js

/**
 * A CÓPIA QUE SAI DO SERVIDOR LEVA A FOTO DO COLEGA (2026-09-24, item 2 da segunda revisão das
 * fotos anexas).
 *
 * Uma foto por referência existe neste navegador só se alguém aqui a anexou ou abriu: a do colega
 * desce do servidor sob demanda. "Salvar como local" copiava os bancos como estavam e o resgate
 * adotava o namespace sem mover um byte, então a foto que o colega nunca abriu ficava, no atlas
 * local, só com a miniatura, para sempre, enquanto o diálogo dizia que o conteúdo ia inteiro.
 *
 * Os casos dirigem a tela real contra o backend real: o autor anexa, o colega recebe a referência
 * SEM abrir a foto (premissa conferida no disco dele), e então o colega faz a cópia. O que se mede é
 * o que a pessoa vê: a foto INTEIRA (largura natural da foto, não da miniatura) aberta na cópia
 * local, e, quando os bytes não podem vir, a foto NOMEADA na frase antes de a cópia existir, ou no
 * aviso do resgate.
 */

import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI, drawPointUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(240000);

const LARGURA = 640;
const ALTURA = 480;
const NOME_DA_FOTO = 'foto-do-colega.jpg';

/** Faz uma foto na página do autor, guarda e sobe sob `id`, e devolve o item de referência. */
async function semearFotoPorReferencia(page, atlasId) {
    return page.evaluate(async ({ atlasId, largura, altura, nome }) => {
        const store = await import('/src/js/store/index.js');
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgb(20, 120, 200)';
        ctx.fillRect(0, 0, largura, altura);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        const thumb = document.createElement('canvas');
        thumb.width = 150;
        thumb.height = 150;
        thumb.getContext('2d').drawImage(canvas, 0, 0, 150, 150);
        const id = generateUUID();
        await store.storeImage(id, blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const res = await apiClient.bulkUploadImages(atlasId, [{ localId: id, filename: nome, mimeType: 'image/jpeg', data: btoa(bin) }]);
        if (res?.mapping?.[id] !== id) throw new Error(`upload did not keep the id: ${JSON.stringify(res)}`);
        return {
            id, name: nome, type: 'image/jpeg', size: blob.size,
            thumbnail: thumb.toDataURL('image/jpeg', 0.7), addedAt: Date.now(),
        };
    }, { atlasId, largura: LARGURA, altura: ALTURA, nome: NOME_DA_FOTO });
}

/** O autor anexa a foto a uma linha nova, e o colega recebe a REFERÊNCIA sem abrir a foto. */
async function fotoDoColegaNaTela(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
    const foto = await semearFotoPorReferencia(A, collab.atlasId);
    await A.evaluate(async ({ linha, foto }) => {
        const store = await import('/src/js/store/index.js');
        await store.updateFeatureProperty('lines', linha, 'images', [foto]);
    }, { linha, foto });
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.[0]?.id,
        { timeout: 30000 }).toBe(foto.id);
    // PREMISSA: o colega NÃO tem os bytes. Sem ela o caso mediria uma cópia que já estava completa.
    expect(await bytesNoAtlasMontado(B, foto.id), 'o colega nunca abriu a foto').toBeNull();
    return { linha, foto };
}

/** Tamanho do blob `id` no banco de imagens do atlas montado, ou null. */
function bytesNoAtlasMontado(page, id) {
    return page.evaluate(async (fid) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const blob = await ns.getStore(ns.StoreName.IMAGES).getItem(fid);
        return blob ? blob.size : null;
    }, id);
}

/** Tamanho do blob `id` no banco de imagens do atlas LOCAL chamado `nome`, ou null. */
function bytesNoAtlasLocal(page, nome, id) {
    return page.evaluate(async ({ nome, fid }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const entrada = (await ns.readLocalAtlasRegistry()).find((a) => a.name === nome);
        if (!entrada) return 'sem atlas local com esse nome';
        const blob = await ns.getStoreFor(ns.StoreName.IMAGES, ns.localScope(entrada.id, entrada.dbSuffix)).getItem(fid);
        return blob ? blob.size : null;
    }, { nome, fid: id });
}

/** Abre o diálogo de "Salvar como local" e devolve o texto dele. */
async function abrirSalvarComoLocal(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const salvar = page.locator('[data-testid="maps-save-local"]');
    await expect(salvar).toBeVisible({ timeout: 30000 });
    await salvar.click();
    const dialogo = page.locator('.confirm-modal-overlay, [role="dialog"]', { hasText: 'Guardar uma cópia deste atlas' }).first();
    await expect(dialogo).toBeVisible({ timeout: 60000 });
    return (await dialogo.innerText()).trim();
}

collabTest('"Salvar como local" traz a foto que o colega nunca abriu, e a cópia a mostra inteira', async ({ collab }) => {
    const B = collab.peers[0];
    const { linha, foto } = await fotoDoColegaNaTela(collab);

    const texto = await abrirSalvarComoLocal(B);
    console.log(`SALVAR_LOCAL dialogo=${JSON.stringify(texto)}`);
    expect(texto, 'nada falta, nada é anunciado como perdido').not.toContain('miniatura');
    await B.locator('.confirm-modal-btn-confirm').click();
    const NOME = 'Copia com a foto';
    await expect(B.locator('.prompt-modal-input')).toBeVisible({ timeout: 30000 });
    await B.locator('.prompt-modal-input').fill(NOME);
    await B.locator('.prompt-modal-btn-confirm').click();
    await expect(B.locator('.toast', { hasText: `local "${NOME}" criada` })).toBeVisible({ timeout: 60000 });

    expect(await bytesNoAtlasLocal(B, NOME, foto.id), 'os bytes estão no banco da cópia local').toBe(foto.size);

    // O QUE A PESSOA VÊ: a cópia, aberta, não tem servidor onde cair, e mostra a foto inteira.
    await B.goto('/atlas.html');
    const cartao = B.locator('[data-testid="local-atlas-item"]', { hasText: NOME });
    await expect(cartao).toBeVisible({ timeout: 60000 });
    await cartao.click();
    await expect(B.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 60000 });
    await B.waitForFunction(() => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function', null, { timeout: 60000 });
    const escopo = await B.evaluate(async () => (await import('/src/js/store/atlas-namespace.js')).getActiveScope()?.kind);
    expect(escopo, 'a leitura é da cópia LOCAL').toBe('local');
    await selectFeatureUI(B, linha);
    const miniatura = B.locator('.feature-photo-gallery-grid img').first();
    await expect(miniatura).toBeVisible({ timeout: 15000 });
    await miniatura.click();
    const inteira = B.locator('.feature-photo-viewer img');
    await expect(inteira).toBeVisible();
    await expect.poll(() => inteira.evaluate((el) => el.naturalWidth), {
        timeout: 15000, message: 'a foto inteira, não a miniatura',
    }).toBe(LARGURA);
});

collabTest('"Salvar como local" sem rede para a foto: o diálogo NOMEIA a foto que fica só com a miniatura', async ({ collab }) => {
    const B = collab.peers[0];
    const { foto } = await fotoDoColegaNaTela(collab);
    await B.route(`**/api/v1/atlas/${collab.atlasId}/images/**`, (route) => route.abort('connectionfailed'));

    const texto = await abrirSalvarComoLocal(B);
    console.log(`SALVAR_LOCAL_SEM_FOTO dialogo=${JSON.stringify(texto)}`);
    expect(texto).toContain(`"${NOME_DA_FOTO}"`);
    expect(texto).toContain('só com a miniatura');
    expect(await bytesNoAtlasMontado(B, foto.id)).toBeNull();
    await B.locator('.confirm-modal-btn-cancel').click();
});

collabTest('resgate quando o dono exclui o atlas: o aviso diz que a foto do colega ficou só com a miniatura', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    await fotoDoColegaNaTela(collab);
    // TRABALHO NÃO ENVIADO: o envio do colega fica segurado, então o ponto dele fica na fila.
    await B.route(`**/api/v1/atlas/${collab.atlasId}/sync`, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await drawPointUI(B, [-43.18, -22.88]);
    await B.keyboard.press('Escape');
    await expect.poll(() => B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 15000 }).toBeGreaterThan(0);

    await A.evaluate(async (atlasId) => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        await apiClient.deleteAtlas(atlasId);
    }, collab.atlasId);

    await B.waitForURL(/atlas\.html/, { timeout: 60000 });
    const aviso = B.locator('.toast', { hasText: 'excluído' });
    await expect(aviso).toBeVisible({ timeout: 30000 });
    await expect.poll(() => aviso.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    const texto = (await aviso.innerText()).trim();
    console.log(`RESGATE_SEM_FOTO aviso=${JSON.stringify(texto)}`);
    expect(texto).toMatch(/guardad[ao]s? neste computador/);
    expect(texto).toContain('só com a miniatura');
});

collabTest('controle: com a foto já aberta pelo colega, o resgate não anuncia perda de foto', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const { linha, foto } = await fotoDoColegaNaTela(collab);
    // O colega ABRE a foto: o visualizador a baixa e guarda no disco dele.
    await selectFeatureUI(B, linha);
    await B.locator('.feature-photo-gallery-grid img').first().click();
    await expect.poll(() => B.locator('.feature-photo-viewer img').evaluate((el) => el.naturalWidth), { timeout: 15000 }).toBe(LARGURA);
    await expect.poll(() => bytesNoAtlasMontado(B, foto.id), { timeout: 15000 }).toBe(foto.size);
    await B.keyboard.press('Escape');

    await B.route(`**/api/v1/atlas/${collab.atlasId}/sync`, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await drawPointUI(B, [-43.18, -22.88]);
    await B.keyboard.press('Escape');
    await expect.poll(() => B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 15000 }).toBeGreaterThan(0);

    await A.evaluate(async (atlasId) => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        await apiClient.deleteAtlas(atlasId);
    }, collab.atlasId);

    await B.waitForURL(/atlas\.html/, { timeout: 60000 });
    const aviso = B.locator('.toast', { hasText: 'excluído' });
    await expect(aviso).toBeVisible({ timeout: 30000 });
    const texto = (await aviso.innerText()).trim();
    console.log(`RESGATE_COM_FOTO aviso=${JSON.stringify(texto)}`);
    expect(texto).toMatch(/guardad[ao]s? neste computador/);
    expect(texto).not.toContain('miniatura');
});
