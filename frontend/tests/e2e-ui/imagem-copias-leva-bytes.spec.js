// Path: e2e-ui/imagem-copias-leva-bytes.spec.js

/**
 * @fileoverview TODA CÓPIA DE UMA FEIÇÃO DE IMAGEM LEVA OS BYTES, e o colega os lê.
 *
 * A figura da ferramenta de imagem é o único dado do produto cujo conteúdo NÃO viaja na op da
 * feição: a op leva a geometria e as propriedades, e os bytes moram na tabela `images` sob o id da
 * feição, subidos à parte pela rota bulk. Toda cópia, portanto, tem de copiar DUAS coisas, e a
 * segunda falha calada: uma cópia sem bytes chega ao colega com `map.hasImage` verdadeiro (o 404
 * instala o placeholder de erro sob o mesmo id) e desenha um X vermelho.
 *
 * O que cada caso mede, sempre pela impressão SHA-256 do blob que `store.getImage` devolve (que
 * cai no servidor quando o cache local erra) comparada com a do ORIGINAL, e pelo bitmap que o mapa
 * registrou (largura e cor, que separam a figura do placeholder):
 *
 *   1. DUPLICAR MAPA pela rota do servidor (atlas de servidor, desde 2026-09-23): a cópia é feita
 *      no SERVIDOR (`withPreparedImageCopies`), com id novo e a feição com o mesmo id do blob.
 *   2. CLONAR ATLAS: idem, noutro atlas, e quem abre o clone é o autor.
 *   3. MOVER PARA OUTRA CAMADA e COPIAR / MOVER CAMADA PARA OUTRO MAPA: a cópia é feita no CLIENTE
 *      (`uploadCopiedBlobsIfRemote`), com id novo; o mover mantém o id e não pode soltar o blob.
 *   4. EXCLUIR E DESFAZER: a figura volta COM os bytes no autor, no colega e depois de um F5.
 *
 * O backend já mede a cópia de bytes no servidor (`backend/tests/integration/atlas-clone-images.repro.test.js`),
 * mas por HTTP e sem navegador: nenhum teste abria a cópia numa tela e perguntava ao colega.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-copias-leva-bytes --retries=0 --workers=1
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { deleteFeatureUI } from './helpers/collab-helpers.js';
import {
    LADO, figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho, linhaDeImagem,
} from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const VERMELHO = [210, 40, 40];
const AZUL = [40, 60, 210];
const VERDE = [40, 180, 70];
const LARANJA = [230, 140, 30];

/** Um id que ninguém criou: o controle de que `getImage` não devolve qualquer coisa. */
const INVENTADO = '00000000-0000-4000-8000-000000000000';

/** Cria a figura pela ferramenta e espera os bytes no Postgres. Devolve id e impressão do autor. */
async function criarFigura(collab, cor, nome) {
    const A = collab.author;
    const png = await figuraSolida(A, cor);
    const id = await porImagemPelaFerramenta(A, { name: nome, mimeType: 'image/png', buffer: png });
    await A.keyboard.press('Escape');
    await expect.poll(() => linhaDeImagem(collab.db, id), { timeout: 30000, message: 'os bytes nunca chegaram ao servidor' })
        .toMatchObject({ id, mime_type: 'image/png' });
    // A FEIÇÃO também, e não só os bytes: a op dela fica PREPARADA até o blob confirmar e sai no
    // disparo seguinte, então os bytes no servidor ainda não dizem que a feição está lá. Uma cópia
    // feita pelo servidor nessa janela sai SEM a figura (medido: 1 clone em 3), porque ele copia o
    // que ELE tem; esse é outro assunto, registrado no relatório, e aqui a cópia espera.
    await expect.poll(async () => (await collab.db.raw.oneOrNone('SELECT deleted_at FROM features WHERE id = $1', [id])) ? 'viva' : 'ausente',
        { timeout: 30000, message: 'a feição nunca chegou ao servidor' }).toBe('viva');
    const original = await impressaoDoBlob(A, id);
    expect(original, 'o autor não lê a própria figura').not.toBeNull();
    expect(original.w).toBe(LADO);
    return { id, original };
}

/** Espera a impressão de `id` em `page` igualar a do original, e devolve a última leitura. */
async function esperarMesmosBytes(page, id, original, rotulo) {
    let ultima = null;
    await expect.poll(async () => {
        ultima = await impressaoDoBlob(page, id);
        return ultima?.sha ?? null;
    }, { timeout: 30000, message: `${rotulo}: os bytes de ${id} não são os do original` }).toBe(original.sha)
        .catch((erro) => { throw new Error(`${erro.message}\nleitura: ${JSON.stringify(ultima)}\noriginal: ${JSON.stringify(original)}`); });
    return ultima;
}

/** O id das feições de imagem de um mapa, pelo NOME, lido do disco (o mapa pode não ser o corrente). */
const imagensDoMapaPorNome = (page, nome) => page.evaluate(async (n) => {
    const store = await import('/src/js/store/index.js');
    const data = await store.getMapDataStore(n);
    return (data?.features?.images || []).map((f) => ({ id: f.properties?.id, layerId: f.properties?.layerId }));
}, nome);

/** Duplica o mapa pelo menu do cartão, na aba Mapas (o mesmo gesto de `duplicar-mapa-no-servidor.repro.spec.js`). */
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

/**
 * Entra no mapa pelo CARTÃO da aba Mapas, que é o gesto da pessoa. Trocar só pela store
 * (`setCurrentMap`) muda o mapa corrente sem redesenhar as feições no MapLibre, e mediria o
 * instrumento em vez do produto.
 */
async function entrarNoMapa(page, nome) {
    if (!(await page.locator('.maps-tab').isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await cartao.click();
    await expect.poll(() => page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync()),
        { timeout: 15000 }).toBe(nome);
}

/** F5 de verdade: a barra de endereços carrega `?atlas=`, e o boot reabre o atlas por ela. */
async function recarregar(page) {
    await page.reload();
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
}

/** Chama uma op da store REAL na página. */
const opDaStore = (page, nome, args) => page.evaluate(async ({ n, a }) => {
    const store = await import('/src/js/store/index.js');
    return store[n](...a);
}, { n: nome, a: args });

collabTest.describe('Toda cópia de feição de imagem leva os BYTES, e o colega os lê', () => {
    collabTest('DUPLICAR MAPA pela rota do servidor: a cópia tem os mesmos bytes, no autor, no colega e depois de F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const { id, original } = await criarFigura(collab, VERMELHO, 'vermelho.png');

        const NOME_COPIA = 'Mapa Tático (cópia)';
        await duplicarUI(A, collab.mapName, NOME_COPIA);

        // O servidor: um mapa novo, com UMA feição de imagem de id NOVO, e a linha de bytes sob ele.
        const idDoMapaCopia = async () => (await collab.db.raw.oneOrNone(
            'SELECT id FROM maps WHERE atlas_id = $1 AND name = $2 AND deleted_at IS NULL', [collab.atlasId, NOME_COPIA]))?.id ?? null;
        await expect.poll(idDoMapaCopia, { timeout: 30000, message: 'a cópia nunca chegou ao servidor' }).toBeTruthy();
        const mapaCopia = await idDoMapaCopia();
        const noServidor = await collab.db.raw.any(
            "SELECT id, properties->>'id' AS prop_id FROM features WHERE map_id = $1 AND feature_type = 'image' AND deleted_at IS NULL", [mapaCopia]);
        expect(noServidor, 'a cópia tem UMA feição de imagem').toHaveLength(1);
        const idCopia = noServidor[0].id;
        expect(idCopia, 'a cópia tem id próprio').not.toBe(id);
        expect(noServidor[0].prop_id, 'properties.id da cópia é o id da linha (o blob é procurado por ele)').toBe(idCopia);
        expect(await linhaDeImagem(collab.db, idCopia), 'os bytes da cópia existem no servidor')
            .toMatchObject({ id: idCopia, atlas_id: collab.atlasId, mime_type: 'image/png', size_bytes: original.size });

        // O AUTOR entra na cópia (o comando já troca para ela): mesmos bytes, e o mapa desenha a figura.
        await expect.poll(async () => (await imagensDoMapaPorNome(A, NOME_COPIA)).map((f) => f.id), { timeout: 30000 })
            .toEqual([idCopia]);
        await esperarMesmosBytes(A, idCopia, original, 'autor');
        await esperarDesenho(A, idCopia, VERMELHO, { rotulo: 'autor, na cópia:' });

        // O COLEGA nunca teve estes bytes por outra via: se `getImage` devolve o SHA do original,
        // foi o servidor que os copiou.
        await expect.poll(async () => (await imagensDoMapaPorNome(B, NOME_COPIA)).map((f) => f.id), { timeout: 30000 })
            .toEqual([idCopia]);
        await esperarMesmosBytes(B, idCopia, original, 'colega');
        await entrarNoMapa(B, NOME_COPIA);
        await esperarDesenho(B, idCopia, VERMELHO, { rotulo: 'colega, na cópia:' });

        // F5 no colega: a cópia continua desenhando a figura.
        await recarregar(B);
        await entrarNoMapa(B, NOME_COPIA);
        await esperarMesmosBytes(B, idCopia, original, 'colega depois do F5');
        await esperarDesenho(B, idCopia, VERMELHO, { rotulo: 'colega depois do F5:' });

        // Controles: o original continua resolvendo, e um id inventado não resolve.
        await esperarMesmosBytes(B, id, original, 'colega, original');
        expect(await impressaoDoBlob(B, INVENTADO), 'getImage devolveu bytes para um id que ninguém criou').toBeNull();
    });

    collabTest('CLONAR ATLAS: o clone abre com os mesmos bytes, sob id novo', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const { id, original } = await criarFigura(collab, AZUL, 'azul.png');

        // O mesmo pedido que "Fazer uma cópia" do seletor de atlas faz (`atlas-drive.js`).
        const clone = await A.evaluate(async ({ atlasId }) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const r = await apiClient.cloneAtlas(atlasId, { name: 'Atlas clonado com figura' });
            return { id: r?.atlas?.id ?? r?.id ?? null, bruto: r };
        }, { atlasId: collab.atlasId });
        expect(clone.id, `o clone não devolveu id: ${JSON.stringify(clone.bruto)}`).toBeTruthy();
        expect(clone.id).not.toBe(collab.atlasId);

        const noClone = await collab.db.raw.any(
            `SELECT f.id FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.feature_type = 'image' AND f.deleted_at IS NULL`, [clone.id]);
        expect(noClone, 'o clone tem UMA feição de imagem').toHaveLength(1);
        const idClone = noClone[0].id;
        expect(idClone).not.toBe(id);
        expect(await linhaDeImagem(collab.db, idClone), 'os bytes do clone moram no atlas do clone')
            .toMatchObject({ atlas_id: clone.id, size_bytes: original.size });

        // O autor ABRE o clone pela barra de endereços, como o seletor faz.
        await A.goto(`/?atlas=${clone.id}`);
        await expect(A.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect.poll(async () => (await readFeatures(A, 'images')).map((f) => f.id), { timeout: 30000 }).toEqual([idClone]);
        await esperarMesmosBytes(A, idClone, original, 'autor, no clone');
        await esperarDesenho(A, idClone, AZUL, { rotulo: 'autor, no clone:' });

        // Controle: dentro do clone o id do ORIGINAL não resolve (o cache local é do namespace do
        // clone, e a leitura no servidor é escopada pelo atlas aberto), então o desenho acima não
        // pode ter vindo do blob antigo.
        expect(await impressaoDoBlob(A, id), 'o id do original resolveu dentro do clone').toBeNull();
    });

    collabTest('MOVER PARA OUTRA CAMADA e COPIAR / MOVER CAMADA PARA OUTRO MAPA: o colega lê os bytes em cada passo', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const { id, original } = await criarFigura(collab, VERDE, 'verde.png');

        // MOVER PARA OUTRA CAMADA (mesmo mapa): mesmo id, os bytes não mudam, e o colega desenha.
        const camada = await opDaStore(A, 'createLayer', ['Camada da Figura']);
        const camadaId = camada?.id ?? camada;
        expect(camadaId).toBeTruthy();
        // A fachada da store devolve void aqui (só emite LAYERS_CHANGED), então o veredito é lido no disco.
        await opDaStore(A, 'moveFeaturesToLayer', [[{ type: 'image', id }], camadaId]);
        await expect.poll(async () => (await readFeatures(A, 'images')).find((f) => f.id === id)?.props?.layerId,
            { timeout: 15000 }).toBe(camadaId);
        await expect.poll(async () => (await readFeatures(B, 'images')).find((f) => f.id === id)?.props?.layerId,
            { timeout: 30000 }).toBe(camadaId);
        await esperarMesmosBytes(B, id, original, 'colega, depois de mudar de camada');
        await esperarDesenho(B, id, VERDE, { rotulo: 'colega, depois de mudar de camada:' });

        // COPIAR A CAMADA PARA OUTRO MAPA: id NOVO cunhado no cliente, bytes subidos à parte.
        const DESTINO = 'Mapa Destino';
        await opDaStore(A, 'addMap', [DESTINO]);
        const copia = await opDaStore(A, 'transferLayerToMap', [camadaId, DESTINO, { mode: 'copy' }]);
        expect(copia?.success, JSON.stringify(copia)).toBe(true);
        let idCopia = null;
        await expect.poll(async () => {
            idCopia = (await imagensDoMapaPorNome(A, DESTINO)).find((f) => f.layerId === copia.targetLayerId)?.id ?? null;
            return idCopia;
        }, { timeout: 15000 }).toBeTruthy();
        expect(idCopia).not.toBe(id);
        await expect.poll(() => linhaDeImagem(collab.db, idCopia), { timeout: 30000, message: 'os bytes da cópia nunca subiram' })
            .toMatchObject({ id: idCopia, size_bytes: original.size });
        await expect.poll(async () => (await imagensDoMapaPorNome(B, DESTINO)).map((f) => f.id), { timeout: 30000 })
            .toContain(idCopia);
        await esperarMesmosBytes(B, idCopia, original, 'colega, cópia no outro mapa');

        // MOVER A CAMADA PARA O OUTRO MAPA: mesmo id, e o autor NÃO pode ter soltado o blob local.
        const mover = await opDaStore(A, 'transferLayerToMap', [camadaId, DESTINO, { mode: 'move' }]);
        expect(mover?.success, JSON.stringify(mover)).toBe(true);
        await expect.poll(async () => (await imagensDoMapaPorNome(A, DESTINO)).map((f) => f.id).sort(), { timeout: 15000 })
            .toEqual([id, idCopia].sort());
        const noAutor = await impressaoDoBlob(A, id);
        expect(noAutor?.sha, 'o autor perdeu os bytes da figura que moveu').toBe(original.sha);
        expect(noAutor?.local, 'o mover soltou o blob LOCAL do autor (releaseImages)').toBe(true);
        await expect.poll(async () => (await imagensDoMapaPorNome(B, DESTINO)).map((f) => f.id).sort(), { timeout: 30000 })
            .toEqual([id, idCopia].sort());
        await entrarNoMapa(B, DESTINO);
        await esperarDesenho(B, id, VERDE, { rotulo: 'colega, figura movida:' });
        await esperarDesenho(B, idCopia, VERDE, { rotulo: 'colega, figura copiada:' });
    });

    collabTest('EXCLUIR E DESFAZER: a figura volta com os bytes no autor, no colega e depois de F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const { id, original } = await criarFigura(collab, LARANJA, 'laranja.png');
        await esperarDesenho(B, id, LARANJA, { rotulo: 'colega, antes de excluir:' });

        await deleteFeatureUI(A, id);
        await expect.poll(async () => (await readFeatures(B, 'images')).some((f) => f.id === id), { timeout: 30000 }).toBe(false);

        await A.keyboard.press('Escape');
        await A.keyboard.press('Control+z');
        await expect.poll(async () => (await readFeatures(A, 'images')).some((f) => f.id === id), { timeout: 15000 }).toBe(true);

        await esperarMesmosBytes(A, id, original, 'autor, depois de desfazer');
        await esperarDesenho(A, id, LARANJA, { rotulo: 'autor, depois de desfazer:' });
        await expect.poll(async () => (await readFeatures(B, 'images')).some((f) => f.id === id), { timeout: 30000 }).toBe(true);
        await esperarMesmosBytes(B, id, original, 'colega, depois de desfazer');
        await esperarDesenho(B, id, LARANJA, { rotulo: 'colega, depois de desfazer:' });
        // `?? 'sem-linha'` aqui confundiria a linha VIVA (deleted_at nulo) com a ausência de linha.
        await expect.poll(async () => {
            const linha = await collab.db.raw.oneOrNone('SELECT deleted_at FROM features WHERE id = $1', [id]);
            return linha ? linha.deleted_at : 'sem-linha';
        }, { timeout: 30000, message: 'a feição desfeita não voltou a viver no servidor' }).toBeNull();

        for (const [rotulo, page] of [['autor', A], ['colega', B]]) {
            await recarregar(page);
            await esperarMesmosBytes(page, id, original, `${rotulo} depois do F5`);
            await esperarDesenho(page, id, LARANJA, { rotulo: `${rotulo} depois do F5:` });
        }
    });
});
