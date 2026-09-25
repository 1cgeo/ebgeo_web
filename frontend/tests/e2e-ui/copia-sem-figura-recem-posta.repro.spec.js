// Path: e2e-ui/copia-sem-figura-recem-posta.repro.spec.js

/**
 * @fileoverview REPRO: UMA CÓPIA FEITA PELO SERVIDOR LOGO DEPOIS DE PÔR UMA FIGURA SAÍA SEM ELA, CALADA.
 *
 * O DEFEITO, medido em 2026-09-24 (1 clone em 3 no primeiro rodar de
 * `imagem-copias-leva-bytes.spec.js`, que então esperava só os BYTES no servidor). A op de uma
 * feição de imagem nasce PREPARADA e só sai depois que o blob dela confirma (a fila de blob,
 * `store/sync/blob-upload-queue.js`), e as duas cópias feitas no SERVIDOR (clonar o atlas e, num
 * atlas de servidor, duplicar um mapa) copiam o que o SERVIDOR tem. Nenhuma das duas portas sabia
 * da fila deste computador:
 *
 *   - "Copiar no servidor" em `atlas.html` (`AtlasDrive._duplicate`) não lia fila nenhuma;
 *   - "Duplicar" do mapa (`MapManager._duplicateOnServer`) fazia `syncEngine.flush()` antes da
 *     rota, e o flush NÃO solta a op retida atrás do blob.
 *
 * Num link lento a figura leva dezenas de segundos para subir, e a cópia saía sem ela, sem aviso.
 *
 * O GESTO, determinístico: a rota bulk (a que leva os bytes) é SEGURADA pelo teste, então a figura
 * fica pendente pelo tempo que o caso quiser. O veredito em cada porta:
 *
 *   1. Copiar no servidor com a figura presa: a página AVISA antes de copiar; cancelar não cria
 *      nada; "Copiar mesmo assim" cria a cópia (sem a figura, como o aviso diz); e reabrir o atlas
 *      envia a figura ao ORIGINAL, que é a ação que o aviso manda fazer.
 *   2. Duplicar o mapa um instante depois de pôr a figura: a porta ESPERA a figura subir e a cópia
 *      a tem, com os mesmos bytes.
 *   3. Duplicar o mapa com a figura presa além do prazo: avisa, e cancelar não cria mapa.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test copia-sem-figura-recem-posta --retries=0 --workers=1
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, linhaDeImagem } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const ROTA_BULK = '**/atlas/*/images/bulk';
const AVISO = 'ainda não enviadas';

/**
 * Segura toda subida de bytes da página até `soltar()`. As pendentes seguem ao servidor na hora da
 * soltura, e as seguintes passam direto.
 */
async function segurarSubidas(page) {
    const presas = [];
    let solta = false;
    const handler = (route) => { if (solta) route.continue(); else presas.push(route); };
    await page.route(ROTA_BULK, handler);
    return {
        presas,
        async soltar() {
            solta = true;
            for (const r of presas.splice(0)) await r.continue().catch(() => {});
            await page.unroute(ROTA_BULK, handler);
        },
    };
}

/** Põe a figura e confirma que ela está PRESA: local sim, servidor não (nem bytes, nem feição). */
async function porFiguraPresa(collab, cor) {
    const A = collab.author;
    const png = await figuraSolida(A, cor);
    const id = await porImagemPelaFerramenta(A, { name: 'presa.png', mimeType: 'image/png', buffer: png });
    await A.keyboard.press('Escape');
    // Dois disparos do flush (1,5 s cada) sem a feição chegar: ela está retida atrás do blob.
    await A.waitForTimeout(3500);
    expect(await linhaDeImagem(collab.db, id), 'os bytes chegaram apesar de a rota estar segura').toBeNull();
    expect(await collab.db.queryFeatureRow(id), 'a feição chegou ao servidor antes dos bytes').toBeNull();
    return id;
}

const idDoMapaPorNome = async (collab, nome) => (await collab.db.raw.oneOrNone(
    'SELECT id FROM maps WHERE atlas_id = $1 AND name = $2 AND deleted_at IS NULL', [collab.atlasId, nome]))?.id ?? null;

const imagensDoMapaNoServidor = (collab, mapId) => collab.db.raw.any(
    "SELECT id FROM features WHERE map_id = $1 AND feature_type = 'image' AND deleted_at IS NULL", [mapId]);

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

/** Abre o menu ⋯ do cartão do atlas de servidor e clica em "Copiar no servidor". */
async function copiarNoServidorUI(page, atlasId) {
    const cartao = page.locator(`[data-testid="project-picker-item"][data-atlas-id="${atlasId}"]`);
    await expect(cartao).toBeVisible({ timeout: 20000 });
    await cartao.hover();
    await cartao.locator('xpath=following-sibling::*[@data-testid="project-picker-menu"]').click();
    await page.locator('[data-testid="project-picker-duplicate"]').click();
}

/**
 * As cópias criadas DESDE `desde`, pelo relógio do banco. O corte por instante é o que isola as
 * rodadas: com `--repeat-each` o banco é o mesmo, e a cópia legítima de uma rodada anterior ("copiar
 * mesmo assim cria") era contada como a que o cancelar teria criado (2 de 3 em 2026-09-25).
 */
const copiasNoServidor = (collab, desde) => collab.db.raw.any(
    "SELECT id FROM atlas WHERE name LIKE '%(cópia)' AND deleted_at IS NULL AND id <> $1 AND created_at >= $2",
    [collab.atlasId, desde]);

collabTest.describe('Cópia feita pelo servidor com uma figura ainda subindo', () => {
    collabTest('COPIAR NO SERVIDOR: avisa antes; cancelar não cria; copiar mesmo assim cria; reabrir envia a figura', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const inicio = (await collab.db.raw.one('SELECT now() AS t')).t;
        const A = collab.author;
        const segura = await segurarSubidas(A);
        const id = await porFiguraPresa(collab, [220, 40, 160]);

        await A.goto('/atlas.html');
        await copiarNoServidorUI(A, collab.atlasId);
        const aviso = A.locator('.confirm-modal-overlay');
        await expect(aviso, 'a cópia saiu sem avisar que a figura ainda não foi enviada').toBeVisible({ timeout: 10000 });
        await expect(aviso).toContainText(AVISO);
        // O CORPO leva a AÇÃO, e é ele que a pessoa precisa ler.
        await expect(aviso).toContainText('A cópia não as terá');
        await expect.poll(() => aviso.locator('.confirm-modal-container').evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
        console.log(`AVISO: ${await aviso.innerText()}`);
        await A.screenshot({ path: collabTest.info().outputPath('aviso-1.png') });
        await aviso.locator('.confirm-modal-btn-cancel').click();
        await A.waitForTimeout(1500);
        expect(await copiasNoServidor(collab, inicio), 'cancelar criou uma cópia').toHaveLength(0);

        await copiarNoServidorUI(A, collab.atlasId);
        await expect(aviso).toBeVisible({ timeout: 10000 });
        await aviso.locator('.confirm-modal-btn-confirm').click();
        await expect.poll(async () => (await copiasNoServidor(collab, inicio)).length, { timeout: 15000 }).toBe(1);
        const [copia] = await copiasNoServidor(collab, inicio);
        const naCopia = await collab.db.raw.any(
            `SELECT f.id FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.feature_type = 'image' AND f.deleted_at IS NULL`, [copia.id]);
        expect(naCopia, 'o aviso disse que a cópia não teria a figura').toHaveLength(0);

        // A AÇÃO QUE O AVISO MANDA: abrir o atlas envia a figura ao original.
        await segura.soltar();
        await A.goto(`/?atlas=${collab.atlasId}`);
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect.poll(() => linhaDeImagem(collab.db, id), { timeout: 30000, message: 'reabrir o atlas não enviou a figura' })
            .toMatchObject({ id });
        await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.id ?? null, { timeout: 30000 }).toBe(id);
    });

    collabTest('DUPLICAR MAPA um instante depois de pôr a figura: espera a figura subir e a cópia a tem', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const segura = await segurarSubidas(A);
        const id = await porFiguraPresa(collab, [40, 170, 90]);
        const original = await impressaoDoBlob(A, id);

        const NOME = 'Cópia com figura recente';
        await duplicarUI(A, collab.mapName, NOME);
        // A figura sobe DEPOIS do clique, dentro do prazo da porta.
        await A.waitForTimeout(1500);
        await segura.soltar();

        await expect.poll(() => idDoMapaPorNome(collab, NOME), { timeout: 30000, message: 'a cópia nunca foi criada' }).toBeTruthy();
        const copia = await idDoMapaPorNome(collab, NOME);
        const imagens = await imagensDoMapaNoServidor(collab, copia);
        expect(imagens, 'a cópia saiu sem a figura posta um instante antes').toHaveLength(1);
        await expect.poll(async () => (await impressaoDoBlob(A, imagens[0].id))?.sha ?? null, { timeout: 30000 }).toBe(original.sha);
        await expect(A.locator('.confirm-modal-overlay')).toHaveCount(0);
    });

    collabTest('DUPLICAR MAPA com a figura presa além do prazo: avisa, e cancelar não cria mapa', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        await segurarSubidas(A);
        await porFiguraPresa(collab, [230, 120, 20]);

        const NOME = 'Cópia que não sai';
        await duplicarUI(A, collab.mapName, NOME);
        const aviso = A.locator('.confirm-modal-overlay');
        await expect(aviso, 'a cópia saiu sem avisar que a figura ainda não foi enviada').toBeVisible({ timeout: 30000 });
        await expect(aviso).toContainText(AVISO);
        // O CORPO leva a AÇÃO, e é ele que a pessoa precisa ler.
        await expect(aviso).toContainText('A cópia não as terá');
        await expect.poll(() => aviso.locator('.confirm-modal-container').evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
        console.log(`AVISO: ${await aviso.innerText()}`);
        await A.screenshot({ path: collabTest.info().outputPath('aviso-2.png') });
        await aviso.locator('.confirm-modal-btn-cancel').click();
        await A.waitForTimeout(2000);
        expect(await idDoMapaPorNome(collab, NOME), 'cancelar criou o mapa').toBeNull();
        expect((await readFeatures(A, 'images')).length, 'a figura continua no mapa do autor').toBe(1);
    });
});
