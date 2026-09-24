// Path: e2e-ui/desfazer-preserva-edicao-do-par.repro.spec.js

/**
 * @fileoverview O CTRL+Z DE UM USUARIO NAO PODE DESFAZER O QUE O COLEGA FEZ DEPOIS.
 *
 * A HIPOTESE. A entrada de desfazer de uma edicao de feicao guarda a feicao INTEIRA de antes
 * (`recordAction({ type: 'update', oldFeature, newFeature })`, em `store/feature.operations.js`), e
 * `_executeUndoAction` (`store/store-state-manager.js`) a regrava inteira por `updateFeature`. Se um
 * colega mudou OUTRO campo da mesma feicao entre a edicao e o Ctrl+Z, a feicao de antes carrega o
 * valor VELHO desse campo, e o desfazer o grava de volta: a op sai do cliente com base atualizada
 * (o cliente ja' recebeu a edicao do colega), entao o servidor nao tem como acusar disputa e aplica.
 *
 * O GESTO, todo pela tela: A desenha uma linha e a recolore pelo painel; B a renomeia pelo painel;
 * A desfaz (botao da barra, a mesma porta do Ctrl+Z). O esperado e' a COR voltar e o NOME do colega ficar, no cliente de A, no de B e
 * no Postgres.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test desfazer-preserva-edicao-do-par --retries=0 --workers=1
 */

import {
    collabTest, expect, drawLineUI, readFeatures, selectAndRecolorUI, selectAndRenameUI,
} from './helpers/collab.fixtures.js';

const LINHA = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COR_DE_A = '#ff0000';
const NOME_DE_B = 'Eixo do colega';

const lerLinha = async (page, id) => (await readFeatures(page, 'lines')).find((f) => f.id === id)?.props ?? null;

collabTest.describe('Desfazer depois da edicao do colega', () => {
    collabTest('Ctrl+Z de A desfaz a COR de A e mantem o NOME que B deu depois', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawLineUI(A, LINHA);
        expect(id, 'A desenhou a linha').toBeTruthy();
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
        const corOriginal = String((await lerLinha(A, id)).lineColor).toLowerCase();
        const nomeOriginal = (await lerLinha(A, id)).nome ?? null;

        // A recolore (a entrada de desfazer de A nasce aqui).
        await collab.clearTraces();
        await selectAndRecolorUI(A, id, COR_DE_A);
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'update' });
        await A.keyboard.press('Escape');

        // B renomeia a MESMA linha, depois.
        await collab.clearTraces();
        await selectAndRenameUI(B, id, NOME_DE_B);
        await collab.expectFullSyncFrom(B, { entityId: id, type: 'lines', operationType: 'update' });
        await expect.poll(async () => (await lerLinha(A, id))?.nome, { timeout: 15000 }).toBe(NOME_DE_B);
        await B.keyboard.press('Escape');

        // A desfaz a propria recoloracao, pelo atalho real.
        await collab.clearTraces();
        // O botao da barra e' a MESMA porta do atalho (`map/undo-redo.runner.js`), sem depender de
        // onde o foco ficou depois do painel.
        await A.locator('.toolbar-standalone-btn[data-tool-id="undo"]').click();
        await expect.poll(async () => String((await lerLinha(A, id))?.lineColor).toLowerCase(),
            { timeout: 15000, message: 'o Ctrl+Z de A nao desfez a cor' }).toBe(corOriginal);
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'update' });
        await expect.poll(async () => String((await lerLinha(B, id))?.lineColor).toLowerCase(), { timeout: 15000 })
            .toBe(corOriginal);

        const linhaA = await lerLinha(A, id);
        const linhaB = await lerLinha(B, id);
        const row = await collab.db.queryFeatureRow(id);
        console.log(`\n===== RETRATO =====\n${JSON.stringify({
            nomeOriginal, corOriginal,
            A: { nome: linhaA?.nome, cor: linhaA?.lineColor },
            B: { nome: linhaB?.nome, cor: linhaB?.lineColor },
            servidor: { nome: row?.properties?.nome, cor: row?.properties?.lineColor },
        }, null, 2)}\n`);

        expect.soft(linhaA?.nome, 'o nome de B continua no cliente de A').toBe(NOME_DE_B);
        expect.soft(linhaB?.nome, 'o nome de B continua no cliente de B').toBe(NOME_DE_B);
        expect.soft(row?.properties?.nome, 'o nome de B continua no servidor').toBe(NOME_DE_B);
    });
});
