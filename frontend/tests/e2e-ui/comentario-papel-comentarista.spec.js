// Path: e2e-ui/comentario-papel-comentarista.spec.js

/**
 * @fileoverview O COMENTARISTA COMENTA, RESPONDE E CUIDA DO QUE E' DELE, E NADA MAIS.
 *
 * Duas browsers reais: A e' o dono do atlas, B e' Comentarista. Todo gesto pela tela (Shift+C e
 * clique, a caixa de resposta, os botoes do cartao). O veredito e' o Postgres e o cartao de B:
 *  - B cria um comentario e responde ao de A, e os dois chegam ao servidor e a A;
 *  - no comentario de A, B nao ve Resolver nem Excluir (o posto some, a regra de afordancia);
 *  - no comentario dele, B resolve, e o servidor aceita.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test comentario-papel-comentarista --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.use({ collabOptions: { peers: 1, permission: 'comment', mapName: 'Mapa Tático' } });

const focar = (page, id) => page.evaluate(async (rootId) => {
    const { getControl } = await import('/src/js/store/control.registry.js');
    await getControl('commentOverlay').focusComment(rootId);
}, id);

const idsEm = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return Object.keys(await store.getComments(await store.getCurrentMapName()));
});

async function criarComentarioUI(page, texto, deslocamento = 0) {
    const antes = await idsEm(page);
    await page.keyboard.press('Shift+C');
    const caixa = await page.locator('#map-sig canvas').boundingBox();
    await page.mouse.click(caixa.x + caixa.width / 2 + deslocamento, caixa.y + caixa.height / 2);
    await page.getByTestId('comment-compose-input').fill(texto);
    await page.getByTestId('comment-compose-submit').click();
    let id = null;
    await expect.poll(async () => {
        id = (await idsEm(page)).find((k) => !antes.includes(k)) ?? null;
        return id;
    }, { timeout: 10000, message: 'o comentario nao nasceu' }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

const linha = (db, id) => db.raw.oneOrNone('SELECT status, author_id, parent_id, data->>\'text\' AS texto FROM comments WHERE id = $1 AND deleted_at IS NULL', [id]);

collabTest.describe('Comentarista nos comentarios espaciais', () => {
    collabTest('comenta, responde, nao modera o alheio e resolve o proprio', async ({ collab }) => {
        collabTest.setTimeout(150000);
        const A = collab.author;
        const B = collab.peers[0];

        // A comenta; B recebe.
        const deA = await criarComentarioUI(A, 'Comentario do dono');
        await expect.poll(async () => (await idsEm(B)).includes(deA), { timeout: 20000 }).toBe(true);

        // No comentario de A, B nao ve Resolver nem Excluir, e responde.
        await focar(B, deA);
        await expect(B.getByTestId('comment-thread')).toBeVisible({ timeout: 10000 });
        await expect(B.getByTestId('comment-resolve'), 'Resolver nao e desenhado para o Comentarista no comentario alheio').toHaveCount(0);
        await expect(B.getByTestId('comment-delete'), 'Excluir nao e desenhado para o Comentarista no comentario alheio').toHaveCount(0);
        await B.getByTestId('comment-reply-input').fill('Resposta do comentarista');
        await B.getByTestId('comment-reply-submit').click();
        await expect.poll(async () => (await collab.db.raw.any('SELECT id FROM comments WHERE parent_id = $1 AND deleted_at IS NULL', [deA])).length,
            { timeout: 20000, message: 'a resposta do comentarista nunca chegou ao servidor' }).toBe(1);
        await B.keyboard.press('Escape');

        // B cria o proprio comentario, que chega ao servidor com B como autor e a A.
        const deB = await criarComentarioUI(B, 'Comentario do comentarista', 120);
        await expect.poll(async () => (await linha(collab.db, deB))?.texto, { timeout: 20000 }).toBe('Comentario do comentarista');
        expect((await linha(collab.db, deB)).author_id).toBe(collab.userB.id);
        await expect.poll(async () => (await idsEm(A)).includes(deB), { timeout: 20000 }).toBe(true);

        // No proprio, B resolve, e o servidor aceita.
        await focar(B, deB);
        await expect(B.getByTestId('comment-resolve')).toHaveCount(1);
        await B.getByTestId('comment-resolve').click();
        await expect.poll(async () => (await linha(collab.db, deB))?.status, { timeout: 20000 }).toBe('resolved');
        const problemas = await B.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            return ((await operationQueue.getIssues?.()) ?? []).length;
        });
        expect(problemas, 'nenhuma recusa na fila de B').toBe(0);
    });
});
