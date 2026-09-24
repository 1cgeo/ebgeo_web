// Path: e2e-ui/foto-anexa-nas-copias.spec.js

/**
 * @fileoverview A FOTO ANEXA A UMA FEIÇÃO ACOMPANHA TODA CÓPIA DELA, e o colega a lê com os mesmos bytes.
 *
 * Hoje a foto anexa (`properties.images`, pela galeria do painel da feição) é um data URL DENTRO da
 * feição e viaja como texto na op dela, então toda cópia a leva de graça. Isso está mudando: a fase
 * 2 das fotos (agente rede, `hunt/fotos`) passa a guardá-la como REFERÊNCIA (`{ id, name,
 * thumbnail }`, bytes no banco de imagens e no servidor), e aí cada porta de cópia terá de levar os
 * bytes como leva os da feição de imagem, e o clone e o duplicar do servidor terão de reescrever o
 * id da foto. Este arquivo mede o COMPORTAMENTO nas duas formas, para que a troca de formato não
 * passe calada: a leitura da foto aceita data URL e referência ({@link fotosDe}), e o veredito é o
 * SHA-256 dos bytes da foto e a decodificação dela, nunca o formato.
 *
 * As portas: Duplicar Seleção (menu de contexto), mover para outra camada, copiar camada para outro
 * mapa, duplicar o mapa pela rota do servidor, clonar o atlas. Em todas, o COLEGA lê a foto da
 * cópia (no clone, quem abre é o autor, que é o dono da cópia).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test foto-anexa-nas-copias --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI } from './helpers/collab.fixtures.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';
import { figuraSolida } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const TEAL = [0, 150, 140];

/**
 * As fotos anexas de uma feição, em QUALQUER formato: data URL (hoje) ou referência a um blob
 * (fase 2 das fotos). Devolve, por foto, o SHA-256 dos bytes, o tipo e a largura decodificada.
 * @param {import('@playwright/test').Page} page
 * @param {string} featureId
 * @param {string|null} [mapName] - Mapa pelo NOME (lido do disco); nulo = mapa corrente.
 */
function fotosDe(page, featureId, mapName = null) {
    return page.evaluate(async ({ id, nome }) => {
        const store = await import('/src/js/store/index.js');
        const feicoes = nome ? (await store.getMapDataStore(nome))?.features ?? {} : await store.getCurrentMapFeatures();
        let alvo = null;
        for (const lista of Object.values(feicoes ?? {})) {
            if (!Array.isArray(lista)) continue;
            alvo = lista.find((f) => f?.properties?.id === id) ?? alvo;
        }
        if (!alvo) return null;
        const saida = [];
        for (const foto of alvo.properties?.images ?? []) {
            let blob = null;
            if (typeof foto?.data === 'string' && foto.data.startsWith('data:')) blob = await (await fetch(foto.data)).blob();
            else if (foto?.id) blob = await store.getImage(foto.id);
            if (!blob) { saida.push({ sha: null, formato: foto?.data ? 'data' : 'referencia' }); continue; }
            const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
            const bmp = await createImageBitmap(blob);
            saida.push({
                sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
                w: bmp.width,
                formato: foto?.data ? 'data' : 'referencia',
            });
        }
        return saida;
    }, { id: featureId, nome: mapName });
}

/** Espera `page` ler, na feição `id`, exatamente as fotos `esperadas` (mesmos SHA). */
async function esperarFotos(page, id, esperadas, rotulo, mapName = null) {
    let ultima = null;
    await expect.poll(async () => {
        ultima = await fotosDe(page, id, mapName);
        return (ultima ?? []).map((f) => f.sha);
    }, { timeout: 30000, message: `${rotulo}: as fotos da cópia não são as do original` }).toEqual(esperadas.map((f) => f.sha))
        .catch((e) => { throw new Error(`${e.message}\nleitura: ${JSON.stringify(ultima)}`); });
}

/** Os ids de feição de um balde num mapa pelo NOME. */
const idsNoMapa = (page, nome, balde) => page.evaluate(async ({ n, b }) => {
    const store = await import('/src/js/store/index.js');
    return ((await store.getMapDataStore(n))?.features?.[b] ?? []).map((f) => f.properties?.id);
}, { n: nome, b: balde });

const opDaStore = (page, nome, args) => page.evaluate(async ({ n, a }) => {
    const store = await import('/src/js/store/index.js');
    return store[n](...a);
}, { n: nome, a: args });

/** Duplica o mapa pelo menu do cartão, na aba Mapas. */
async function duplicarUI(page, mapa, nome) {
    if (!(await page.locator('.maps-tab').isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${mapa}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.locator('.menu-btn').click();
    await page.locator('.map-context-menu .map-context-menu-item', { hasText: 'Duplicar' }).click();
    const campo = page.locator('.prompt-modal-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    await campo.fill(nome);
    await page.locator('.prompt-modal-btn-confirm').click();
}

collabTest.describe('A foto anexa acompanha toda cópia da feição', () => {
    collabTest('duplicar seleção, mover de camada, copiar camada, duplicar mapa e clonar atlas', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];

        // O PONTO E A FOTO, pela galeria real do painel.
        const id = await drawPointUI(A, [-43.2, -22.9]);
        await A.keyboard.press('Escape');
        await selectFeatureUI(A, id);
        const foto = await figuraSolida(A, TEAL, { tipo: 'image/jpeg', lado: 64 });
        await A.locator('.feature-photo-gallery__file-input').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: foto });
        await expect(A.locator('.feature-photo-gallery-grid img').first()).toBeVisible({ timeout: 10000 });
        let original = null;
        await expect.poll(async () => {
            original = await fotosDe(A, id);
            return original?.length ?? 0;
        }, { timeout: 15000 }).toBe(1);
        expect(original[0].sha, 'o autor não lê a própria foto').toBeTruthy();
        collabTest.info().annotations.push({ type: 'formato-da-foto', description: original[0].formato });
        await esperarFotos(B, id, original, 'colega, original');
        await A.keyboard.press('Escape');

        // DUPLICAR SELEÇÃO (menu de contexto real).
        await selectFeatureUI(A, id);
        const box = await A.locator('#map-sig .maplibregl-canvas').boundingBox();
        await A.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6, { button: 'right' });
        const menu = A.locator('.context-menu');
        await expect(menu).toBeVisible({ timeout: 8000 });
        const antes = new Set(await idsNoMapa(A, collab.mapName, 'points'));
        await menu.locator('.context-menu-item', { hasText: 'Duplicar Seleção' }).click();
        let duplicada = null;
        await expect.poll(async () => {
            duplicada = (await idsNoMapa(A, collab.mapName, 'points')).find((x) => !antes.has(x)) ?? null;
            return duplicada;
        }, { timeout: 15000 }).not.toBeNull();
        await esperarFotos(B, duplicada, original, 'colega, Duplicar Seleção');
        await A.keyboard.press('Escape');

        // MOVER PARA OUTRA CAMADA.
        const camada = await opDaStore(A, 'createLayer', ['Camada da Foto']);
        const camadaId = camada?.id ?? camada;
        await opDaStore(A, 'moveFeaturesToLayer', [[{ type: 'point', id }], camadaId]);
        await expect.poll(async () => B.evaluate(async (fid) => {
            const store = await import('/src/js/store/index.js');
            return ((await store.getCurrentMapFeatures()).points ?? []).find((f) => f.properties?.id === fid)?.properties?.layerId ?? null;
        }, id), { timeout: 30000 }).toBe(camadaId);
        await esperarFotos(B, id, original, 'colega, depois de mudar de camada');

        // COPIAR A CAMADA PARA OUTRO MAPA.
        const DESTINO = 'Mapa Destino';
        await opDaStore(A, 'addMap', [DESTINO]);
        const copia = await opDaStore(A, 'transferLayerToMap', [camadaId, DESTINO, { mode: 'copy' }]);
        expect(copia?.success, JSON.stringify(copia)).toBe(true);
        let idNoDestino = null;
        await expect.poll(async () => {
            idNoDestino = (await idsNoMapa(A, DESTINO, 'points'))[0] ?? null;
            return idNoDestino;
        }, { timeout: 15000 }).not.toBeNull();
        await expect.poll(async () => (await idsNoMapa(B, DESTINO, 'points')), { timeout: 30000 }).toContain(idNoDestino);
        await esperarFotos(B, idNoDestino, original, 'colega, camada copiada para outro mapa', DESTINO);

        // DUPLICAR O MAPA pela rota do servidor.
        const NOME_COPIA = 'Mapa Tático (cópia)';
        await duplicarUI(A, collab.mapName, NOME_COPIA);
        await expect.poll(async () => (await idsNoMapa(B, NOME_COPIA, 'points')).length, { timeout: 30000 }).toBe(2);
        for (const idCopia of await idsNoMapa(B, NOME_COPIA, 'points')) {
            await esperarFotos(B, idCopia, original, 'colega, mapa duplicado', NOME_COPIA);
        }

        // CLONAR O ATLAS: o autor abre o clone.
        const clone = await A.evaluate(async (atlasId) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const r = await apiClient.cloneAtlas(atlasId, { name: 'Clone com foto' });
            return r?.atlas?.id ?? r?.id ?? null;
        }, collab.atlasId);
        expect(clone).toBeTruthy();
        await A.goto(`/?atlas=${clone}`);
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect.poll(async () => (await idsNoMapa(A, collab.mapName, 'points')).length, { timeout: 30000 }).toBe(2);
        for (const idClone of await idsNoMapa(A, collab.mapName, 'points')) {
            await esperarFotos(A, idClone, original, 'autor, no clone', collab.mapName);
        }
    });
});
