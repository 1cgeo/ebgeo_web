// Path: e2e-ui/comentario-rascunho-thread-excluida.repro.spec.js

/**
 * @fileoverview A RESPOSTA QUE A PESSOA ESCREVIA NAO SOME QUANDO O COLEGA EXCLUI A CONVERSA.
 *
 * O DEFEITO, medido: B escreve uma resposta no cartao da conversa; A exclui a conversa. A recarga do
 * overlay de B (`_reload`, `comment_tool/comment-overlay.js`) fechava o cartao porque a raiz sumiu, e
 * o texto de B ia junto, sem aviso nenhum (cartao 0, caixa ausente, nenhum toast). O caminho de
 * envio ja' sabia recusar mantendo o texto (`AVISO_RESPOSTA_RECUSADA`), mas a pessoa nunca chegava
 * a ele.
 *
 * O GESTO, todo pela tela: comentario por Shift+C e clique; a resposta na caixa do cartao; a
 * exclusao pelo botao Excluir do cartao de A.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test comentario-rascunho-thread-excluida --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const TEXTO = 'Resposta longa que eu estava escrevendo';

const focar = (page, id) => page.evaluate(async (rootId) => {
    const { getControl } = await import('/src/js/store/control.registry.js');
    await getControl('commentOverlay').focusComment(rootId);
}, id);

const existeEm = (page, id) => page.evaluate(async (rid) => {
    const store = await import('/src/js/store/index.js');
    return Boolean((await store.getComments(await store.getCurrentMapName()))[rid]);
}, id);

collabTest('B escreve uma resposta e A exclui a conversa: o texto de B fica, com aviso', async ({ collab }) => {
    collabTest.setTimeout(120000);
    const A = collab.author;
    const B = collab.peers[0];

    await A.keyboard.press('Shift+C');
    const caixa = await A.locator('#map-sig canvas').boundingBox();
    await A.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await A.getByTestId('comment-compose-input').fill('Conversa');
    await A.getByTestId('comment-compose-submit').click();
    let id = null;
    await expect.poll(async () => {
        id = await A.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return Object.keys(await store.getComments(await store.getCurrentMapName()))[0] ?? null;
        });
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    await expect.poll(() => existeEm(B, id), { timeout: 20000 }).toBe(true);

    await focar(B, id);
    await B.getByTestId('comment-reply-input').fill(TEXTO);
    await focar(A, id);
    await A.getByTestId('comment-delete').click();
    await expect.poll(() => existeEm(B, id), { timeout: 20000 }).toBe(false);

    // O aviso e' o sinal de que a recarga de B ja' tratou a exclusao.
    const aviso = B.locator('.toast', { hasText: 'Outra pessoa excluiu este comentário' });
    const avisou = await aviso.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
    const caixaDeB = B.getByTestId('comment-reply-input');
    const retrato = {
        avisou,
        cartao: await B.locator('[data-testid="comment-thread"]').count(),
        rascunho: (await caixaDeB.count()) ? await caixaDeB.inputValue() : null,
    };
    console.log(`RETRATO ${JSON.stringify(retrato)}`);
    expect(retrato.rascunho, 'o texto de B continua na caixa').toBe(TEXTO);
    expect(retrato.avisou, 'B e avisado').toBe(true);

    // Enviar e recusado, mantendo o texto, e nada chega ao servidor.
    await B.getByTestId('comment-reply-submit').click();
    await expect(B.locator('.toast', { hasText: 'Não foi possível responder' })).toBeVisible({ timeout: 5000 });
    await expect(caixaDeB).toHaveValue(TEXTO);
    expect((await collab.db.raw.one('SELECT count(*)::int AS n FROM comments WHERE parent_id = $1 AND deleted_at IS NULL', [id])).n,
        'nenhuma resposta orfa no servidor').toBe(0);
});
