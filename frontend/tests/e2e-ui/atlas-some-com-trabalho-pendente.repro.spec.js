// Path: e2e-ui/atlas-some-com-trabalho-pendente.repro.spec.js

/**
 * @fileoverview REPRO (caça noturna de 2026-09-24): o atlas de servidor SOME debaixo de um colega
 * que tem trabalho ainda não enviado, e o trabalho dele não pode sumir junto.
 *
 * Dois caminhos, medidos com dois navegadores reais contra o backend real:
 *
 *   1. O DONO MANDA O ATLAS PARA A LIXEIRA. O servidor avisa a sala (`atlas_deleted`) e o colega
 *      desmonta o atlas (`_handleRemoteAtlasDeleted`, `account/account.control.js`) com
 *      `clearAllDataStore()`, que esvazia os dados E a fila. O que ele tinha desenhado e o servidor
 *      ainda não tinha recebido desaparecia sem aviso: a lixeira devolve ao dono o atlas do
 *      servidor, nunca o que só existia na máquina do colega.
 *   2. O DONO REVOGA O ACESSO DO COLEGA. O servidor fecha o socket dele com 4003 ("access
 *      revoked"), e o cliente tratava isso como queda de rede: reconectava para sempre, o selo dizia
 *      "N pendentes / reconectando", as edições seguintes continuavam entrando na fila e nenhuma
 *      frase dizia que elas nunca seriam enviadas. Medido: 45 s depois, ainda "reconectando"; um F5
 *      levava à lista com "Atlas não encontrado ou sem acesso" e a fila ficava num namespace que
 *      nenhuma tela mostra.
 *
 * O TRABALHO NÃO ENVIADO É FABRICADO SEGURANDO O ENVIO: a rota de sync do colega é abortada, então
 * o ponto que ele desenha fica na fila com o socket vivo, que é o estado de quem desenhou no
 * segundo anterior ao gesto do dono (ou numa rede lenta).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI } from './helpers/collab-helpers.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O dono age pela API, numa página que não boota nada do mapa. */
async function acaoDoDono(browser, creds, metodo, caminho, corpo) {
    const page = await browser.newPage();
    try {
        await page.goto('/atlas.html');
        return await page.evaluate(async ({ api, base, m, c, b }) => {
            const res = await fetch(`${base}/api/v1${c}`, {
                method: m,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.getAccessToken()}` },
                body: b ? JSON.stringify(b) : undefined,
            });
            return res.status;
        }, { api: await clienteNaPagina(page, creds), base: state.baseUrl, m: metodo, c: caminho, b: corpo });
    } finally {
        await page.close();
    }
}

/** Desenha um ponto com o envio segurado, e confirma que ele está na fila. */
async function desenharSemEnviar(page, atlasId) {
    await page.route(`**/api/v1/atlas/${atlasId}/sync`, (route) => route.abort());
    const id = await drawPointUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).pendentes;
    }), { timeout: 15000 }).toBeGreaterThan(0);
    return id;
}

/** O ponto `id` está num atlas LOCAL deste navegador? Lido do disco, atlas por atlas. */
function pontoEmAtlasLocal(page, id) {
    return page.evaluate(async (fid) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const achados = [];
        for (const entrada of await ns.readLocalAtlasRegistry()) {
            const escopo = ns.localScope(entrada.id, entrada.dbSuffix);
            await ns.getStoreFor(ns.StoreName.MAPS, escopo).iterate((doc) => {
                if ((doc?.features?.points ?? []).some((f) => f?.properties?.id === fid)) achados.push(entrada.name);
            });
        }
        return achados;
    }, id);
}

describeOrSkip('o atlas some com trabalho não enviado do colega', () => {
    test('lixeira: o que o colega não tinha enviado vira atlas local, e a lista diz isso', async ({ browser }) => {
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageB = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        const id = await desenharSemEnviar(pageB, seed.atlasId);

        expect(await acaoDoDono(browser, seed.userA, 'DELETE', `/atlas/${seed.atlasId}`)).toBe(204);

        await pageB.waitForURL(/atlas\.html/, { timeout: 30000 });
        const aviso = pageB.locator('.toast', { hasText: 'excluído' });
        await expect(aviso).toBeVisible({ timeout: 20000 });
        const texto = await aviso.innerText();
        console.info('LIXEIRA', texto);
        expect(texto, 'a frase diz onde foi parar o trabalho').toMatch(/guardad[ao]s? neste computador/);
        // O ATLAS LOCAL LEVA O NOME DO PROJETO, e não "Trabalho recuperado em <data>": o colega nunca
        // abriu o menu da conta, então o nome vem do registro do atlas montado.
        expect(await pontoEmAtlasLocal(pageB, id), 'o ponto não enviado está num atlas local com o nome do projeto')
            .toEqual(['Atlas Colaborativo']);

        // O DONO RESTAURA, e o colega que volta ao atlas lê a pergunta do resgate com a causa certa.
        expect(await acaoDoDono(browser, seed.userA, 'POST', `/atlas/${seed.atlasId}/restore`)).toBe(200);
        await pageB.unroute(`**/api/v1/atlas/${seed.atlasId}/sync`);
        await pageB.reload();
        await pageB.locator(`[data-testid="project-picker-item"][data-atlas-id="${seed.atlasId}"]`).click();
        const pergunta = pageB.locator('.confirm-modal-overlay, .choice-modal-overlay, [role="dialog"]', { hasText: 'trabalho guardado' });
        await expect(pergunta).toBeVisible({ timeout: 30000 });
        const frase = await pergunta.innerText();
        console.info('PERGUNTA', frase);
        expect(frase, 'a pergunta não conta uma sessão que não caiu').not.toMatch(/sessão caiu/);
        expect(frase).toContain('Atlas Colaborativo');
        await pageB.context().close();
    });

    test('revogação: o colega sai do atlas com o trabalho guardado, em vez de reconectar para sempre', async ({ browser }) => {
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageB = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        const id = await desenharSemEnviar(pageB, seed.atlasId);

        expect(await acaoDoDono(browser, seed.userA, 'DELETE',
            `/atlas/${seed.atlasId}/sharing/users/${seed.userB.id}`)).toBe(204);

        await pageB.waitForURL(/atlas\.html/, { timeout: 30000 });
        const aviso = pageB.locator('.toast', { hasText: 'acesso' });
        await expect(aviso).toBeVisible({ timeout: 20000 });
        const texto = await aviso.innerText();
        console.info('REVOGACAO', texto);
        expect(texto).toMatch(/guardad[ao]s? neste computador/);
        expect(await pontoEmAtlasLocal(pageB, id), 'o ponto não enviado está num atlas local').toHaveLength(1);
        await pageB.context().close();
    });

    // O COLEGA ESTAVA SEM REDE quando o dono mandou o atlas para a lixeira: o aviso da sala não
    // chega a ele. Medido em 2026-09-24: quem o tira do atlas ao voltar é o caminho que já existia
    // (a leitura HTTP do atlas responde 404 e o cliente anuncia o atlas como excluído), e o que este
    // caso cobra é o RESGATE nessa porta também, que é a mesma saída dos dois casos acima.
    test('lixeira com o colega SEM REDE: ao voltar, ele sai do atlas com o trabalho guardado', async ({ browser }) => {
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageB = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        // A QUEDA DE REDE, só no tempo real: todo socket novo é recusado enquanto `semRede` vale, e o
        // atual é derrubado. É o que o colega vive com a rede fora (o `setOffline` do Playwright não
        // derruba um WebSocket já aberto). O HTTP fica de pé, que é o caso do Wi-Fi que volta.
        let semRede = true;
        await pageB.context().routeWebSocket(/\/collab/, (ws) => {
            if (semRede) ws.close();
            else ws.connectToServer();
        });
        // O ENVIO TAMBÉM FICA SEM REDE. Recusar só o socket não segura o envio no Firefox: medido em
        // 2026-09-24, o ponto subiu por POST /sync 300 ms depois de desenhado (200, linha no
        // PostgreSQL) e antes da lixeira, e a saída sem resgate estava certa, porque não havia mais
        // nada a resgatar. Sem rede é sem as duas coisas, e é esse o caso que este teste cobra.
        await pageB.context().route('**/api/v1/atlas/*/sync', (route) => (semRede ? route.abort() : route.continue()));
        await pageB.evaluate(async () => {
            const { wsClient } = await import('/src/js/store/sync/ws-client.js');
            wsClient._socket?.close();
        });
        await expect(pageB.locator('[data-testid="sync-status-badge"]')).not.toHaveAttribute('data-state', 'online', { timeout: 30000 });
        const id = await drawPointUI(pageB, [-43.2, -22.9]);
        await pageB.keyboard.press('Escape');

        // O dono manda para a lixeira: o aviso da sala não alcança quem está sem rede.
        expect(await acaoDoDono(browser, seed.userA, 'DELETE', `/atlas/${seed.atlasId}`)).toBe(204);
        semRede = false;

        await pageB.waitForURL(/atlas.html/, { timeout: 90000 });
        const aviso = pageB.locator('.toast', { hasText: 'excluído' });
        await expect(aviso).toBeVisible({ timeout: 20000 });
        expect(await aviso.innerText()).toMatch(/guardad[ao]s? neste computador/);
        expect(await pontoEmAtlasLocal(pageB, id)).toEqual(['Atlas Colaborativo']);
        await pageB.context().close();
    });

    test('controle: revogado SEM trabalho pendente, o colega sai do atlas e a lista diz que o acesso acabou', async ({ browser }) => {
        test.setTimeout(180000);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const pageB = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        expect(await acaoDoDono(browser, seed.userA, 'DELETE',
            `/atlas/${seed.atlasId}/sharing/users/${seed.userB.id}`)).toBe(204);

        await pageB.waitForURL(/atlas\.html/, { timeout: 30000 });
        const aviso = pageB.locator('.toast', { hasText: 'acesso' });
        await expect(aviso).toBeVisible({ timeout: 20000 });
        expect(await aviso.innerText()).not.toMatch(/guardad/);
        await pageB.context().close();
    });
});
