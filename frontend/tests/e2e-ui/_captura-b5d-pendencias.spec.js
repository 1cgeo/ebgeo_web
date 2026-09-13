// Path: e2e-ui/_captura-b5d-pendencias.spec.js

/**
 * CAPTURA do painel de pendências (bloco B5, item 5), para leitura da imagem.
 *
 * ELE NÃO ASSERE APARÊNCIA, e é por isso que o nome começa com `_`: o laço aprovado para UI é
 * dirigir o app e o backend REAIS com o Playwright e depois LER a imagem produzida. As asserções
 * daqui existem só para garantir que o estado foi de fato alcançado antes do disparo, senão a
 * imagem seria de um painel vazio com cara de painel pronto. A lógica já está presa em node
 * (`frontend/tests/unit/pendencias-linhas.test.js`, 23 casos, e
 * `frontend/tests/integration/pendencias-acoes.test.js`, 22 casos).
 *
 * ELE É TEMPORÁRIO por contrato: quem rodar e LER as imagens APAGA este arquivo. A convenção da
 * casa é que o spec de captura não sobrevive à leitura, senão a suíte acumula casos que ninguém
 * olha e que só custam tempo de rodada.
 *
 * O QUE SE QUER LER NA IMAGEM, e que nenhum teste de node responde:
 *   - as três classes se distinguem de relance (cor da borda, crachá) sem virar semáforo de
 *     natal, e a linha de conflito não fica indistinguível da de recusa;
 *   - a linha cabe: classe, item, mapa, motivo do servidor e unidades em disputa, sem a frase do
 *     servidor empurrando os botões para fora;
 *   - o comando bloqueado por estado se lê como bloqueado E como clicável (é `aria-disabled`, e o
 *     clique responde com a frase), que é justamente o par que a regra da casa pede e que um
 *     `disabled` cinza destruiria;
 *   - o contador do topo e o título com a contagem concordam com o número de linhas.
 *
 * COMO OS TRÊS ESTADOS SÃO MONTADOS, e onde o caminho é real e onde não é:
 *
 *   1. CONFLITO: real, dois clientes, a mesma unidade. B recarrega para receber a revisão pelo
 *      SNAPSHOT (é ele que carimba a base do lado de quem não autorou), fica offline, e enquanto
 *      isso A renomeia a camada, movendo a revisão no servidor. B renomeia por cima, declarando a
 *      base velha, e ao voltar a conexão o servidor recusa NOMEANDO a unidade `nome`. Nada é
 *      escrito à mão em disco.
 *   2. RECUSA de política: o envelope nasce na fábrica REAL e viaja pelo flush REAL, mas é
 *      enfileirado direto, sem passar pela op de store. A razão é que o gate do cliente espelha o
 *      do servidor: travar mapa é exclusivo do dono (`canLockMaps`), então a op de store recusaria
 *      antes e nenhuma recusa de servidor chegaria à fila. O que se está encenando aqui é a
 *      chegada da recusa do SERVIDOR ao painel, não o gesto.
 *   3. UPLOAD PENDENTE: real, pela mesma porta que o produto usa ao colar uma figura
 *      (`enfileirarBlob`), com a rede desligada, que é o estado que um envio interrompido deixa.
 *
 * O QUE ELE NÃO ALCANÇA, declarado: a linha de QUARENTENA PRESERVADA exige um logout confirmado
 * com problema na fila, que troca de sessão no meio da captura e derrubaria as outras três; e a
 * comparação visual de geometria de conflito não existe ainda (segue pendente no documento 03).
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

/** Dirige uma op do store pela fachada REAL do app. */
function applyStoreOp(page, nome, args) {
    return page.evaluate(async ({ n, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[n](...a);
    }, { n: nome, a: args });
}

describeOrSkip('B5d: captura do painel de pendências', () => {
    test.afterAll(async () => { await closeDb(); });

    test('conflito, recusa e upload pendente na mesma lista', async ({ browser }) => {
        test.setTimeout(180000);
        const { atlasId, mapId, userA, userB } = await seedSharedAtlas(browser, state.baseUrl);
        const paginaA = await openClient(browser, state.baseUrl, atlasId, userA);
        const paginaB = await openClient(browser, state.baseUrl, atlasId, userB);

        // ── 1. A cria a camada e o servidor a versiona ───────────────────────────────────
        // `createLayer` devolve a CAMADA, não o id (o objeto atravessa o `evaluate` como JSON).
        const camada = await applyStoreOp(paginaA, 'createLayer', ['Camada disputada']);
        const layerId = camada?.id;
        expect(layerId, 'A criou a camada').toBeTruthy();
        await expect.poll(
            async () => (await applyStoreOp(paginaB, 'getLayers', [])).some((l) => l.id === layerId),
            { timeout: 30000, message: 'a camada de A chegou em B' },
        ).toBe(true);

        // B RECARREGA: é o snapshot que carimba a revisão confirmada do lado de quem não autorou,
        // e sem base declarada não existe disputa, só ordem de chegada.
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

        // ── 4. O upload pendente, pela porta real, com a rede desligada ──────────────────
        await paginaB.context().setOffline(true);
        await paginaB.evaluate(async (id) => {
            const { enfileirarBlob } = await import('/src/js/store/sync/blob-upload-queue.js');
            const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
            await enfileirarBlob({
                imageId: '22222222-2222-4222-8222-222222222222',
                blob: new Blob([bytes], { type: 'image/png' }),
                atlasId: id,
            });
        }, atlasId);

        // ── 5. O painel ──────────────────────────────────────────────────────────────────
        await paginaB.locator(CRACHA).click();
        await expect(paginaB.locator(PAINEL)).toBeVisible({ timeout: 10000 });
        await expect.poll(
            () => paginaB.locator(LINHA).count(),
            { timeout: 30000, message: 'as três pendências apareceram na lista' },
        ).toBeGreaterThanOrEqual(3);

        await paginaB.locator('#pendencias-panel').screenshot({
            path: 'test-results/b5d-painel-pendencias.png',
        });

        // A MESMA TELA COM A RECUSA DE ESTADO NA CARA: sem conexão, "Aceitar o servidor" continua
        // desenhado e recusa o clique com a frase. É o par que a regra da casa pede, e é o que
        // mais importa ler na imagem, porque um `disabled` cinza pareceria igual e seria o erro.
        const aceitar = paginaB.locator('[data-acao="aceitar"]').first();
        await expect(aceitar).toHaveAttribute('aria-disabled', 'true');
        // `dispatchEvent` e não `click()`: o Playwright lê `aria-disabled` como desabilitado e
        // esperaria para sempre por um botão que a casa desenha assim de propósito.
        await aceitar.dispatchEvent('click');
        await paginaB.screenshot({ path: 'test-results/b5d-recusa-por-estado.png' });

        await paginaB.context().setOffline(false);
        await paginaA.context().close();
        await paginaB.context().close();
    });
});
