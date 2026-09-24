// Path: e2e-ui/browser-collab-analise-edicao.repro.spec.js

/**
 * @fileoverview EDITAR uma visada ou um viewshed num atlas de servidor, com dois navegadores.
 *
 * O DEFEITO (medido em 2026-09-23). Toda edição das duas ferramentas de análise que não seja a
 * criação passa por `batchUpdateLOSFeatures` / `batchUpdateVisibilityFeatures`
 * (`batchUpdateAnalysisFeatures`, `store/feature.operations.js`): o "Salvar" do painel
 * (`saveFeatures`), o arraste de uma ponta (`applyHandleEdit`) e o recálculo por parâmetro. Essa
 * função grava a entrada e a saída no disco e NÃO registra operação nenhuma, nem da ENTRADA. Num atlas
 * de servidor a edição existia só naquele computador: o par nunca a via, o servidor guardava o
 * valor velho, e o próximo retrato (F5, reconexão) a desfazia no próprio autor, sem aviso.
 *
 * O caso edita pelo gesto que passa por ali sem ambiguidade, a ALTURA DO OBSERVADOR na aba
 * Parâmetros (que dispara o recálculo), nas DUAS ferramentas, e afirma o valor em três lugares
 * independentes: a linha do Postgres, o store do par e o store do autor depois de F5. (Renomear
 * pelo painel NÃO serve de repro: o nome é gravado por outro caminho, que já registra a op, e um
 * primeiro rascunho deste arquivo passou verde sem o conserto por isso.)
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import {
    prepararTerreno, desocupar, tracarVisada, tracarViewshed, balde, alturaNoStore, mudarAlturaDoObservador,
} from './helpers/analise-terreno.js';

collabTest.describe.configure({ retries: 0 });

async function alturaNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.observerHeight ?? null;
}

collabTest('recalcular a visada e o viewshed pela aba Parametros chega ao servidor, ao par e sobrevive ao F5', async ({ collab }) => {
    collabTest.setTimeout(600000);
    const A = collab.author;
    const B = collab.peers[0];

    await prepararTerreno(A);
    const losId = await tracarVisada(A);
    await desocupar(A);
    const visId = await tracarViewshed(A);
    await desocupar(A);

    // As duas entradas chegaram ao servidor com a altura de nascença: é o ponto de partida.
    await expect.poll(() => alturaNoServidor(collab, losId), { timeout: 30000 }).toBe(1.5);
    await expect.poll(() => alturaNoServidor(collab, visId), { timeout: 30000 }).not.toBe(null);

    await mudarAlturaDoObservador(A, 'los', losId, 50, 20000);
    await desocupar(A);
    await mudarAlturaDoObservador(A, 'visibility', visId, 40, 60000);
    await expect(A.locator('.visibility-progress-modal--visible')).toHaveCount(0, { timeout: 60000 });
    await desocupar(A);

    await expect.poll(() => alturaNoServidor(collab, losId), { timeout: 30000, message: 'o servidor nao recebeu a edicao da visada' })
        .toBe(50);
    await expect.poll(() => alturaNoServidor(collab, visId), { timeout: 30000, message: 'o servidor nao recebeu a edicao do viewshed' })
        .toBe(40);
    await expect.poll(() => alturaNoStore(B, 'los', losId), { timeout: 30000, message: 'o par nao recebeu a edicao da visada' })
        .toBe(50);
    await expect.poll(() => alturaNoStore(B, 'visibility', visId), { timeout: 30000, message: 'o par nao recebeu a edicao do viewshed' })
        .toBe(40);
    // A saída do par é derivada da entrada NOVA: as metades carregam a altura nova.
    await expect.poll(async () => (await balde(B, 'processed_los')).map((f) => f.props.observerHeight), { timeout: 15000 })
        .toEqual([50, 50]);

    await A.reload();
    await expect.poll(() => alturaNoStore(A, 'los', losId), { timeout: 30000, message: 'o F5 desfez a edicao da visada no autor' })
        .toBe(50);
    await expect.poll(() => alturaNoStore(A, 'visibility', visId), { timeout: 30000, message: 'o F5 desfez a edicao do viewshed no autor' })
        .toBe(40);
    await expect.poll(async () => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).problemas;
    }), { timeout: 10000 }).toBe(0);
});
