// Path: e2e-ui/foto-anexa-formatos-offline-e-desfazer.spec.js

/**
 * @fileoverview A FOTO ANEXA PELA GALERIA REAL: os três formatos aceitos, a recusa do que não é
 * aceito, a foto posta SEM REDE, e a feição excluída e desfeita, sempre até os bytes no colega.
 *
 * A galeria (`sidebar/components/feature-photo-gallery.js` → `userDataManager.addImage`) aceita
 * JPEG, PNG e WebP e recusa o resto antes de ler. Até aqui o navegador só a exercitava com um PNG
 * de 1 px (`browser-collab-conversao-linear.spec.js`) e num envio de acervo
 * (`envio-com-fotos-anexas.repro.spec.js`). O que este arquivo mede, com a leitura da foto nos DOIS
 * formatos de armazenamento (data URL hoje, referência na fase 2 das fotos):
 *
 *   1. JPEG, PNG e WebP entram e o colega lê as três com os mesmos SHA-256; um GIF é recusado com a
 *      frase e nada muda.
 *   2. Uma foto posta com a conexão CAÍDA chega ao colega quando a conexão volta.
 *   3. A feição com as fotos é excluída e o Ctrl+Z a traz de volta COM as fotos, no autor e no
 *      colega.
 *   4. Remover UMA foto (botão da galeria, confirmado) chega ao colega, e o Ctrl+Z seguinte a devolve
 *      com os mesmos bytes nos dois (medido primeiro, afirmado depois: 4 de 4 nos dois lados).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test foto-anexa-formatos-offline-e-desfazer --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI, deleteFeatureUI } from './helpers/collab-helpers.js';
import { figuraSolida } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

/** As fotos anexas de uma feição do mapa corrente, em qualquer formato, como SHA-256 dos bytes. */
function fotosDe(page, featureId) {
    return page.evaluate(async (id) => {
        const store = await import('/src/js/store/index.js');
        const feicoes = await store.getCurrentMapFeatures();
        let alvo = null;
        for (const lista of Object.values(feicoes ?? {})) {
            if (Array.isArray(lista)) alvo = lista.find((f) => f?.properties?.id === id) ?? alvo;
        }
        if (!alvo) return null;
        const saida = [];
        for (const foto of alvo.properties?.images ?? []) {
            let blob = null;
            if (typeof foto?.data === 'string' && foto.data.startsWith('data:')) blob = await (await fetch(foto.data)).blob();
            else if (foto?.id) blob = await store.getImage(foto.id);
            if (!blob) { saida.push(null); continue; }
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            saida.push([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));
        }
        return saida;
    }, featureId);
}

async function esperarFotos(page, id, esperadas, rotulo) {
    let ultima = null;
    await expect.poll(async () => {
        ultima = await fotosDe(page, id);
        return ultima;
    }, { timeout: 30000, message: `${rotulo}: as fotos não são as esperadas` }).toEqual(esperadas)
        .catch((e) => { throw new Error(`${e.message}\nleitura: ${JSON.stringify(ultima)}`); });
}

/** Anexa um arquivo pela galeria do painel aberto e espera a contagem de fotos do autor subir. */
async function anexar(page, id, arquivo, esperado) {
    await page.locator('.feature-photo-gallery__file-input').setInputFiles(arquivo);
    await expect.poll(async () => (await fotosDe(page, id))?.length ?? 0, { timeout: 15000,
        message: `a foto ${arquivo.name} não entrou` }).toBe(esperado);
}

/** Derruba a conexão como a rede derruba (offline + o socket fechado) e devolve a função de volta. */
async function derrubarConexao(page) {
    await page.evaluate(async () => {
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        globalThis.__transicoes = [];
        connectionState.onStateChanged((e) => globalThis.__transicoes.push(`${e.previousState}->${e.currentState}`));
    });
    await page.context().setOffline(true);
    await page.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
    await expect.poll(() => page.evaluate(() => globalThis.__transicoes ?? []), { timeout: 30000 })
        .toContain('online->reconnecting');
    return async () => {
        await page.context().setOffline(false);
        await expect.poll(() => page.evaluate(() => globalThis.__transicoes ?? []), { timeout: 120000,
            message: 'a conexão não voltou' }).toContain('reconnecting->online');
    };
}

collabTest.describe('Foto anexa pela galeria real: formatos, sem rede, excluir e desfazer', () => {
    collabTest('JPEG, PNG e WebP; GIF recusado; foto sem rede; feição excluída e desfeita com as fotos', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await drawPointUI(A, [-43.2, -22.9]);
        await A.keyboard.press('Escape');
        await collab.expectFullSync({ entityId: id, type: 'points', operationType: 'create' });
        await selectFeatureUI(A, id);

        // 1. OS TRÊS FORMATOS.
        await anexar(A, id, { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await figuraSolida(A, [200, 40, 40], { tipo: 'image/jpeg', lado: 48 }) }, 1);
        await anexar(A, id, { name: 'b.png', mimeType: 'image/png', buffer: await figuraSolida(A, [40, 200, 40], { lado: 48 }) }, 2);
        await anexar(A, id, { name: 'c.webp', mimeType: 'image/webp', buffer: await figuraSolida(A, [40, 40, 200], { tipo: 'image/webp', lado: 48 }) }, 3);
        const tres = await fotosDe(A, id);
        expect(tres.every(Boolean), 'o autor não lê as próprias fotos').toBe(true);
        await esperarFotos(B, id, tres, 'colega, três formatos');

        // GIF: recusado com a frase, e nada muda.
        await A.locator('.feature-photo-gallery__file-input').setInputFiles({ name: 'd.gif', mimeType: 'image/gif', buffer: globalThis.Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64') });
        const recusa = A.locator('.toast', { hasText: 'tipo de arquivo' }).first();
        await expect(recusa, 'o GIF não foi recusado com a frase').toBeVisible({ timeout: 10000 });
        console.log(`RECUSA GIF: ${await recusa.innerText()}`);
        await A.waitForTimeout(1000);
        expect(await fotosDe(A, id)).toEqual(tres);

        // 2. SEM REDE.
        const voltar = await derrubarConexao(A);
        await anexar(A, id, { name: 'sem-rede.jpg', mimeType: 'image/jpeg', buffer: await figuraSolida(A, [230, 180, 30], { tipo: 'image/jpeg', lado: 48 }) }, 4);
        const quatro = await fotosDe(A, id);
        await voltar();
        await esperarFotos(B, id, quatro, 'colega, foto posta sem rede');

        // 3. EXCLUIR A FEIÇÃO E DESFAZER.
        await A.keyboard.press('Escape');
        await deleteFeatureUI(A, id);
        await expect.poll(async () => (await readFeatures(B, 'points')).some((f) => f.id === id), { timeout: 30000 }).toBe(false);
        await A.keyboard.press('Escape');
        await A.keyboard.press('Control+z');
        await esperarFotos(A, id, quatro, 'autor, depois de desfazer a exclusão');
        await esperarFotos(B, id, quatro, 'colega, depois de desfazer a exclusão');

        // 4. REMOVER UMA FOTO pelo botão da galeria; o Ctrl+Z a devolve.
        await selectFeatureUI(A, id);
        const primeira = A.locator('.feature-photo-gallery-grid .feature-photo-gallery-delete').first();
        await primeira.dispatchEvent('click');
        await A.locator('.confirm-modal-btn-confirm').click();
        await esperarFotos(B, id, quatro.slice(1), 'colega, depois de remover uma foto');
        await A.keyboard.press('Escape');
        await A.keyboard.press('Control+z');
        await esperarFotos(A, id, quatro, 'autor, depois de desfazer a remoção da foto');
        await esperarFotos(B, id, quatro, 'colega, depois de desfazer a remoção da foto');
    });
});
