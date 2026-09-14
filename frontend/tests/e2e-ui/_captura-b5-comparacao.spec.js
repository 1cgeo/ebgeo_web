// Path: e2e-ui/_captura-b5-comparacao.spec.js

/**
 * @fileoverview CAPTURA da comparação entre a cópia local e a do servidor na linha de conflito de
 * feição (B5, item 1). NÃO É GUARDA DE REGRESSÃO: é o laço aprovado de verificação de UI, uma
 * captura dirigindo app e backend reais para ser LIDA como imagem.
 *
 * ESTE ARQUIVO FICOU PARA O COORDENADOR RODAR. A porta 3912 é de outra sessão, então ele nunca foi
 * executado aqui, e NENHUMA afirmação sobre o que as imagens mostram foi feita. Rode com
 * `npm run test:e2e:ui -- _captura-b5-comparacao`, de dentro de `frontend/`, LEIA as duas imagens
 * em `test-results/` e APAGUE este arquivo depois.
 *
 * O QUE OLHAR NAS IMAGENS, na ordem em que o caso as tira:
 *   1. `b5-1-comparacao.png` — a linha de conflito de feição no painel de pendências, com o bloco
 *      "Sua cópia e a do servidor:" abaixo do motivo do servidor: o tipo da geometria, a contagem
 *      de vértices dos DOIS lados e a distância entre os centros em metros, mais a lista dos campos
 *      de propriedade que diferem. O que precisa se ler de longe é que o bloco NOMEIA os dois lados
 *      ("2 vértices aqui, 3 vértices no servidor") em vez de dar um delta, e que ele é texto, sem
 *      canvas nem miniatura de mapa.
 *   2. `b5-2-sem-servidor.png` — o mesmo painel com um conflito cujo recibo NÃO trouxe
 *      `serverData`. O bloco continua desenhado e diz que o servidor não devolveu o conteúdo
 *      atual, porque um bloco que some se lê como "não há diferença", que é o contrário do que
 *      aconteceu.
 *
 * COMO O CONFLITO É PRODUZIDO, e por que ele é real. B sai da rede, edita a MESMA feição que A vai
 * editar (mesma unidade de disputa: a geometria e as propriedades), A edita primeiro e o servidor
 * avança a fronteira daquela unidade; B volta, a fila dele empurra a op declarando a base VELHA, o
 * servidor recusa com `status: 'conflict'` e o recibo carrega o `serverData` lido da linha viva
 * (`canonicalFeature`, `backend/src/modules/sync/feature-conflicts.js`). É esse recibo que a fila
 * guarda como problema durável e que o painel lê. Nada aqui é semeado à mão: se o caminho de
 * recusa mudar, a captura sai vazia em vez de sair bonita.
 *
 * A EDIÇÃO DE GEOMETRIA É PROGRAMÁTICA, e isso é declarado pela mesma razão que
 * `browser-collab-crdt-conflict.spec.js` declara: não existe gesto único de UI que ponha uma linha
 * em coordenadas EXATAS, e a comparação precisa de um deslocamento conhecido para que a leitura da
 * imagem possa conferir o número. A recoloração e o desenho da linha passam pela UI real.
 *
 * O PAINEL É ABERTO PELO CRACHÁ DE SYNC, que é como a pessoa chega nele; o segundo caso força o
 * `serverData` ausente reescrevendo o problema JÁ GUARDADO na fila, porque o servidor de hoje
 * sempre serializa a feição e não há como pedir a ele que não o faça.
 */

import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

/** Drives a store op on `page` through the app's REAL store facade (no-UI escape, flagged above). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Substitui a geometria de uma linha, ponto a ponto, pelo caminho de escrita real da store. */
function moveLine(page, id, coordinates) {
    return page.evaluate(async ({ featureId, coords }) => {
        const store = await import('/src/js/store/index.js');
        const atual = (await store.getCurrentMapFeatures()).lines
            .find((f) => f.properties?.id === featureId);
        if (!atual) throw new Error(`linha ${featureId} não está na store desta página`);
        await store.updateFeature('lines', {
            ...atual,
            geometry: { ...atual.geometry, coordinates: coords },
        });
    }, { featureId: id, coords: coordinates });
}

/** Abre o painel pelo crachá de sync, que é o caminho da pessoa. */
async function abrirPainel(page) {
    await page.getByTestId('sync-status-badge').click();
    await expect(page.getByTestId('pendencias-painel')).toBeVisible({ timeout: 15000 });
}

collabTest.describe('Captura: a comparação local x servidor na linha de conflito', () => {
    collabTest('o bloco com geometria e propriedades, e a ausência declarada', async ({ collab }, testInfo) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        // 1) A desenha a linha pela UI real e ela chega aos dois.
        const featureId = await drawLineUI(A, [[-43.20, -22.90], [-43.19, -22.90]]);
        await collab.expectFullSync({ entityId: featureId, type: 'lines', operationType: 'create' });

        // 2) B sai da rede e edita a linha: geometria (três vértices, deslocada) e uma
        //    propriedade. A base que ele declara é a que ele observou antes de sair.
        await B.context().setOffline(true);
        await B.waitForTimeout(1500);
        await moveLine(B, featureId, [[-43.20, -22.905], [-43.195, -22.905], [-43.19, -22.905]]);
        await applyStoreOp(B, 'updateFeatureProperty', ['lines', featureId, 'lineColor', '#00ff00']);

        // 3) A edita a MESMA feição enquanto B está fora: mesma unidade, base mais nova.
        await moveLine(A, featureId, [[-43.20, -22.90], [-43.185, -22.90]]);
        await applyStoreOp(A, 'updateFeatureProperty', ['lines', featureId, 'lineColor', '#ff0000']);
        await A.waitForTimeout(2000);

        // 4) B volta: a fila empurra a op com a base velha e o servidor a recusa por conflito.
        await B.context().setOffline(false);
        await expect
            .poll(async () => B.evaluate(async () => {
                const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
                const problemas = await operationQueue.getProblems();
                return problemas.filter((p) => p?.result?.conflict).length;
            }), { timeout: 45000 })
            .toBeGreaterThan(0);

        // O `serverData` do recibo é a LINHA VIVA: sem ele não há par a desenhar, e a imagem
        // mostraria o segundo caso em vez do primeiro.
        const temServerData = await B.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            const problemas = await operationQueue.getProblems();
            return problemas.some((p) => p?.result?.conflict?.serverData?.geometry);
        });
        expect(temServerData, 'o recibo de conflito precisa trazer a feição do servidor').toBe(true);

        await abrirPainel(B);
        const comparacao = B.getByTestId('pendencias-comparacao').first();
        await expect(comparacao).toBeVisible();
        await expect(comparacao).toContainText('Sua cópia e a do servidor');
        await expect(comparacao).toContainText('no servidor');
        await B.screenshot({ path: testInfo.outputPath('b5-1-comparacao.png'), fullPage: true });

        // 5) A AUSÊNCIA DECLARADA. O servidor de hoje sempre serializa a feição, então o único
        //    jeito honesto de ver este estado é apagar o `serverData` do problema JÁ GUARDADO e
        //    reabrir o painel: é exatamente o que um servidor mais antigo que esta tela produziria.
        await B.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            const problemas = await operationQueue.getProblems();
            for (const problema of problemas) {
                if (!problema?.result?.conflict) continue;
                // `recordIssue` recebe a OPERAÇÃO, não o id dela.
                await operationQueue.recordIssue(problema.operation, {
                    ...problema.result,
                    conflict: { ...problema.result.conflict, serverData: null },
                });
            }
        });
        await B.reload();
        await B.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), { timeout: 60000 });
        await abrirPainel(B);
        const ausente = B.locator('.pendencias__comparacao-linha--ausente').first();
        await expect(ausente).toBeVisible();
        await B.screenshot({ path: testInfo.outputPath('b5-2-sem-servidor.png'), fullPage: true });

        console.info('Capturas em', testInfo.outputDir);
    });
});
