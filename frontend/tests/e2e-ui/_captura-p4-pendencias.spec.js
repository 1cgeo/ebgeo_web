// Path: e2e-ui/_captura-p4-pendencias.spec.js

/**
 * CAPTURA dos quatro consertos do lote P4 que se veem na tela, para leitura da imagem.
 *
 * ELE NAO FOI EXECUTADO POR QUEM O ESCREVEU. A porta 3912 estava em uso por outro agente nesta
 * maquina, e rodar dois backends de Playwright na mesma porta e a colisao que
 * `frontend/tests/e2e-ui/backend.js` recusa em voz alta. Entao ele fica para o coordenador RODAR,
 * LER as imagens e APAGAR o arquivo, que e o contrato de um spec de captura. Nada aqui foi
 * verificado por imagem ainda, e nenhum resultado dele deve ser relatado antes disso.
 *
 * ELE NAO ASSERE APARENCIA, e e por isso que o nome comeca com `_`: as asserções existem so para
 * garantir que o estado foi alcancado antes do disparo, senao a foto seria de um painel vazio com
 * cara de painel pronto. A logica ja esta presa em node:
 *   - `frontend/tests/unit/sync-status-control.test.js` (pre-carregamento e aviso do clique, A1);
 *   - `frontend/tests/unit/pendencias-linhas.test.js` (topo em duas linhas e lugar do aviso, A2);
 *   - `frontend/tests/unit/blob-upload-frases.test.js` mais
 *     `frontend/tests/integration/blob-upload-queue.test.js` (frase da figura, A3).
 *   - A4 nao aparece aqui: ele e do Resumo da aba Diagnostico, e a captura dele e a de B9.
 *
 * O QUE SE QUER LER EM CADA IMAGEM, e que nenhum teste de node responde:
 *
 *   1. `p4-painel-topo.png` - A FILEIRA DE CONTADORES INTEIRA, sem nada por cima dela, e o
 *      "Exportar tudo" numa LINHA PROPRIA abaixo. Na captura de B5d dois baloes laranja cobriam
 *      dois dos quatro chips. Aqueles baloes eram avisos de `sync-flush.js` (um por operacao
 *      recusada, 8 s cada), que nascem em `top-center` acima de todo modal; por isso esta foto
 *      espera a faixa de avisos esvaziar antes de disparar. Se ainda houver balao na imagem, o que
 *      falta e mover AQUELA faixa, que e de outro dono, e o achado continua aberto.
 *
 *   2. `p4-aviso-no-rodape.png` - O AVISO DO PROPRIO PAINEL, agora no RODAPE. Sem conexao,
 *      "Aceitar o servidor" continua desenhado, `aria-disabled`, e o clique responde nomeando o
 *      estado. A frase tem de aparecer ABAIXO da lista, nunca sobre os contadores.
 *
 *   3. `p4-figura-em-pt-br.png` - A LINHA DA FIGURA PENDENTE. Ela dizia `Failed to fetch`. Agora
 *      diz que a rede nao completou o envio e que ele e retomado sozinho. Nenhuma palavra em
 *      ingles na linha.
 *
 *   4. `p4-painel-offline.png` - O PAINEL ABERTO SEM REDE. Este e o A1: o modulo do painel viaja
 *      pela rede e era baixado no clique, entao sem rede o clique nao abria NADA. Aqui a rede e
 *      desligada ANTES do clique, e o painel abre assim mesmo, porque foi pre-carregado quando a
 *      luz saiu do verde.
 *
 * COMO OS ESTADOS SAO MONTADOS, e onde o caminho e real: o roteiro e o mesmo de
 * `_captura-b5d-pendencias.spec.js` (apagado em 6234a5c4), porque ele ja provou montar as tres
 * classes com o servidor real. Conflito por dois clientes na mesma unidade; recusa de politica por
 * envelope enfileirado direto (o gate do cliente espelha o do servidor, entao a op de store
 * recusaria antes e nenhuma recusa de SERVIDOR chegaria a fila); figura pendente pela porta real
 * (`enfileirarBlob`) com a rede desligada.
 *
 * DUAS ARMADILHAS MEDIDAS NA CAPTURA ANTERIOR, e as duas continuam valendo: `setOffline` NAO
 * derruba um WebSocket ja aberto para 127.0.0.1, entao `connectionState` segue ONLINE e o comando
 * aparece liberado com toda razao (por isso o socket e fechado a mao antes da foto 2); e
 * `toast--visible` e posta no INICIO da transicao, entao disparar na hora pega o aviso a meio
 * caminho (por isso ha uma espera de opacidade antes da foto).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const CRACHA = '[data-testid="sync-status-badge"]';
const PAINEL = '[data-testid="pendencias-painel"]';
const LINHA = '[data-testid="pendencias-linha"]';
const CONTADORES = '[data-testid="pendencias-contadores"]';

/** Dirige uma op do store pela fachada REAL do app. */
function applyStoreOp(page, nome, args) {
    return page.evaluate(async ({ n, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[n](...a);
    }, { n: nome, a: args });
}

/** Espera a faixa de avisos do topo esvaziar, para a foto do topo do painel ser do painel. */
async function semAvisosNoTopo(page) {
    await expect
        .poll(() => page.locator('.toast--top').count(), {
            timeout: 30000,
            message: 'a faixa de avisos do topo esvaziou',
        })
        .toBe(0);
}

describeOrSkip('P4: captura dos consertos do painel de pendências', () => {
    test.afterAll(async () => { await closeDb(); });

    test('topo desobstruído, aviso no rodapé, figura em pt-BR e painel offline', async ({ browser }) => {
        test.setTimeout(180000);
        const { atlasId, mapId, userA, userB } = await seedSharedAtlas(browser, state.baseUrl);
        const paginaA = await openClient(browser, state.baseUrl, atlasId, userA);
        const paginaB = await openClient(browser, state.baseUrl, atlasId, userB);

        // ── 1. A cria a camada e o servidor a versiona ───────────────────────────────────
        const camada = await applyStoreOp(paginaA, 'createLayer', ['Camada disputada']);
        const layerId = camada?.id;
        expect(layerId, 'A criou a camada').toBeTruthy();
        await expect.poll(
            async () => (await applyStoreOp(paginaB, 'getLayers', [])).some((l) => l.id === layerId),
            { timeout: 30000, message: 'a camada de A chegou em B' },
        ).toBe(true);

        // B RECARREGA: é o snapshot que carimba a revisão confirmada do lado de quem não autorou, e
        // sem base declarada não existe disputa, só ordem de chegada.
        await paginaB.reload();
        await expect(paginaB.locator(CRACHA)).toHaveAttribute('data-state', 'online', { timeout: 30000 });

        // ── 2. O conflito ────────────────────────────────────────────────────────────────
        await paginaB.context().setOffline(true);
        await applyStoreOp(paginaA, 'renameLayer', [layerId, 'Camada do Alfa']);
        await applyStoreOp(paginaB, 'renameLayer', [layerId, 'Camada do Bravo']);

        // ── 3. A recusa de política, pelo flush real (ver o cabeçalho) ───────────────────
        await paginaB.evaluate(async (id) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            await operationQueue.enqueue(createOperation('map', 'update', id, null, { locked: true }));
        }, mapId);

        await paginaB.context().setOffline(false);
        await expect.poll(
            async () => paginaB.evaluate(async () => {
                const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
                return (await operationQueue.getIssues()).length;
            }),
            { timeout: 60000, message: 'o servidor recusou as duas operações de B' },
        ).toBeGreaterThanOrEqual(2);

        // ── 4. A figura pendente, pela porta real, com a rede desligada ──────────────────
        // A REDE DESLIGADA É O QUE PRODUZ A FRASE: o transporte falha, `uploadImagesInChunks` conta
        // um chunk sem resposta e a causa vira REDE, que é exatamente o caso cuja mensagem crua era
        // `Failed to fetch`.
        await paginaB.context().setOffline(true);
        await paginaB.evaluate(async (id) => {
            const { enfileirarBlob } = await import('/src/js/store/sync/blob-upload-queue.js');
            const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
            await enfileirarBlob({
                imageId: '33333333-3333-4333-8333-333333333333',
                blob: new Blob([bytes], { type: 'image/png' }),
                atlasId: id,
            });
        }, atlasId);
        await paginaB.context().setOffline(false);

        // ── 5. FOTO 1: o topo do painel, sem nada por cima ───────────────────────────────
        await semAvisosNoTopo(paginaB);
        await paginaB.locator(CRACHA).click();
        await expect(paginaB.locator(PAINEL)).toBeVisible({ timeout: 10000 });
        await expect.poll(
            () => paginaB.locator(LINHA).count(),
            { timeout: 30000, message: 'as três pendências apareceram na lista' },
        ).toBeGreaterThanOrEqual(3);
        // A fileira de contadores é um elemento PRÓPRIO desde este lote: se ela não existir, a
        // separação não chegou à tela e a foto não vale.
        await expect(paginaB.locator(CONTADORES)).toBeVisible();
        await semAvisosNoTopo(paginaB);
        await paginaB.locator('#pendencias-panel').screenshot({
            path: 'test-results/p4-painel-topo.png',
        });

        // ── 6. FOTO 2 e 3: a recusa por estado, com o aviso no rodapé ────────────────────
        // O SOCKET É FECHADO À MÃO: `setOffline` não derruba o que já está aberto, e sem a queda o
        // comando aparece liberado, com toda razão.
        await paginaB.context().setOffline(true);
        await paginaB.evaluate(async () => {
            const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
            await syncEngine.disconnect();
        });
        const aceitar = paginaB.locator('[data-acao="aceitar"]').first();
        await expect(aceitar).toHaveAttribute('aria-disabled', 'true', { timeout: 30000 });
        // `dispatchEvent` e não `click()`: o Playwright lê `aria-disabled` como desabilitado e
        // esperaria para sempre por um botão que a casa desenha assim de propósito.
        await aceitar.dispatchEvent('click');
        const aviso = paginaB.locator('.toast--warning').last();
        await expect(aviso).toBeVisible({ timeout: 10000 });
        // A opacidade é posta no INÍCIO da transição: sem esta espera a foto pega o aviso a meio
        // caminho e ele parece desenhado por baixo do painel.
        await expect
            .poll(() => aviso.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
            .toBeGreaterThan(0.9);
        await paginaB.screenshot({ path: 'test-results/p4-aviso-no-rodape.png' });

        const figura = paginaB.locator(`${LINHA}[data-classe="upload-pendente"]`).first();
        await expect(figura).toBeVisible();
        await expect(figura).not.toContainText('Failed to fetch');
        await figura.screenshot({ path: 'test-results/p4-figura-em-pt-br.png' });

        // ── 7. FOTO 4: o painel aberto SEM REDE ──────────────────────────────────────────
        // O painel é fechado e reaberto com a rede desligada. Antes deste lote o clique baixaria o
        // módulo e o download falharia, e nada abriria: o `catch` só escrevia no console.
        await paginaB.evaluate(async () => {
            const { fecharPainelDePendencias } =
                await import('/src/js/account/pendencias/pendencias-panel.js');
            fecharPainelDePendencias();
        });
        await expect(paginaB.locator(PAINEL)).toBeHidden({ timeout: 10000 });
        await paginaB.locator(CRACHA).click();
        await expect(paginaB.locator(PAINEL)).toBeVisible({ timeout: 10000 });
        await paginaB.screenshot({ path: 'test-results/p4-painel-offline.png' });

        await paginaB.context().setOffline(false);
        await paginaA.context().close();
        await paginaB.context().close();
    });
});
