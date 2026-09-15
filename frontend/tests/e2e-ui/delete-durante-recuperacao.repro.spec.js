// Path: e2e-ui/delete-durante-recuperacao.repro.spec.js

/**
 * @fileoverview UM DELETE NÃO PODE EVAPORAR PORQUE O ATLAS ESTAVA SE RECUPERANDO.
 *
 * O defeito, medido em 2026-09-15: abrir um atlas de servidor responde DOIS retratos (o mesmo
 * par que `refusingDuringRecovery`, em `store/map.operations.js`, já pagou no caminho de
 * preferências), e enquanto o segundo estagia uma geração ele segura `pauseStoreWrites` para o
 * escopo. Nessa janela `beginStoreWrite` recusa toda transação, e o gesto de apagar fazia o
 * seguinte, sem uma linha vermelha em lugar nenhum:
 *
 *   1. `deleteFeatures` de cada ferramenta (dezessete cópias das mesmas três linhas) engole a
 *      recusa num `catch` que só faz `console.error`;
 *   2. e remove os ids da fonte do MapLibre MESMO ASSIM, então o mapa passa a mostrar uma
 *      exclusão que nenhuma operação carregou;
 *   3. a store continua com a feição, o servidor nunca soube de nada, e o par também não;
 *   4. e a pessoa não é avisada, porque este é o ÚNICO ramo de `runTransaction` que recusa sem
 *      emitir evento nenhum, e CONTINUA sendo: anunciar dali cobriria também as escritas que a
 *      pessoa nunca pediu (`switchMap` grava um mapa-base dentro desta mesma janela), então quem
 *      anuncia é o gesto. O porquê está no cabeçalho de `whenStoreWritesResume`.
 *
 * O QUE ESTE ARQUIVO PROVA, e o que ele NÃO prova. Prova: o mecanismo existe e produz esse
 * desfecho, porque a pausa é a MESMA que `applyRemoteSnapshot` toma
 * (`store/write-coordinator.js`), tomada à mão no instante exato do gesto. Não prova: que foi ele
 * que fez a fase 5 de `browser-collab-three-client-flow.spec.js` reprovar UMA VEZ EM DEZESSEIS em
 * 15/09, sempre no cliente que acabara de reabrir o atlas, com "o autor nunca registrou
 * apply.persist" e nada mais. A assinatura casa (o elo 1 da cadeia quebrado porque operação
 * nenhuma nasceu, sem erro em lugar nenhum), mas aquele vermelho não foi pego em flagrante: 32
 * rodadas isoladas depois não o reproduziram.
 *
 * É JUSTAMENTE POR ISSO QUE A INTERLEAVING AQUI É FORÇADA. Uma janela de centenas de
 * milissegundos não converge por repetição, então repetir mais não era o caminho para diagnóstico
 * nenhum; forçar a corrida perdedora é.
 *
 * CONTROLE NEGATIVO: retirar a espera de `deleteSelectedFeatures`
 * (`tool_manager/selection_manager.js`) põe este caso vermelho na asserção de que a feição
 * continua DESENHADA durante a pausa, porque sem ela o controle já apagou a fonte.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawLineUI, selectFeatureUI, readFeatures } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const COORDS = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

/** A feição está DESENHADA agora? (a fonte do MapLibre é o que a pessoa vê) */
const naFonte = (page, id) => page.evaluate(async (fid) => {
    const src = globalThis.__ebgeoMap?.getSource('lines');
    if (!src || typeof src.getData !== 'function') return null;
    const data = await src.getData();
    return ((data && data.features) || []).some((f) => f.properties?.id === fid);
}, id);

/** A feição está PERSISTIDA agora? (a store é o que sobrevive ao F5 e o que vira op de saída) */
const naStore = async (page, id) => (await readFeatures(page, 'lines')).some((f) => f.id === id);

describeOrSkip('apagar uma feição com o atlas em recuperação (Chromium real)', () => {
    test('o gesto espera a recuperação e apaga de verdade, em vez de apagar só o desenho', async ({ page }) => {
        test.setTimeout(120000);

        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });

        const id = await drawLineUI(page, COORDS);
        expect(await naFonte(page, id), 'a linha nasceu desenhada').toBe(true);
        expect(await naStore(page, id), 'a linha nasceu persistida').toBe(true);

        await selectFeatureUI(page, id);

        // A RECUPERAÇÃO, tomada à mão no instante do gesto. É a mesma pausa de
        // `applyRemoteSnapshot`, pelo mesmo escopo ativo que ele usa.
        const pausou = await page.evaluate(async () => {
            const coordenador = await import('/src/js/store/write-coordinator.js');
            const espaco = await import('/src/js/store/atlas-namespace.js');
            const escopo = espaco.getActiveScope();
            if (!escopo) return { ok: false, motivo: 'sem escopo ativo' };
            globalThis.__pausaDeRecuperacao = coordenador.pauseStoreWrites(escopo);
            return { ok: true, pausado: coordenador.storeWritesPaused(escopo) };
        });
        expect(pausou, 'a pausa de recuperação ficou de pé').toMatchObject({ ok: true, pausado: true });

        // O gesto inteiro: Delete, e o diálogo destrutivo confirmado. Nada aqui espera o fim da
        // exclusão de propósito, porque o que se mede é justamente o que ela faz enquanto espera.
        await page.keyboard.press('Delete');
        const confirmar = page.locator('.confirm-modal-btn-confirm');
        await expect(confirmar).toBeVisible({ timeout: 5000 });
        await confirmar.click();
        await page.waitForTimeout(1200);

        // ESTA É A ASSERÇÃO QUE O DEFEITO REPROVAVA: com a recuperação de pé o desenho não pode
        // mentir. Antes do conserto a fonte já tinha perdido a linha aqui, com a store intacta.
        expect(await naFonte(page, id), 'a linha continua DESENHADA enquanto o atlas se recupera').toBe(true);
        expect(await naStore(page, id), 'e continua PERSISTIDA, porque nada foi apagado ainda').toBe(true);

        // Terminada a recuperação, o gesto que esperou termina o serviço.
        await page.evaluate(() => { globalThis.__pausaDeRecuperacao?.resume?.(); });

        await expect
            .poll(() => naStore(page, id), { timeout: 15000, message: 'a exclusão acontece de verdade depois da recuperação' })
            .toBe(false);
        await expect
            .poll(() => naFonte(page, id), { timeout: 15000, message: 'e o desenho acompanha a store' })
            .toBe(false);
    });
});
