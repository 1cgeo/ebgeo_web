// Path: e2e-ui/sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js

/**
 * @fileoverview A SESSÃO QUE CAI SEM GESTO NÃO APAGA A FILA DE UM ATLAS QUE A ABA JÁ DEIXOU.
 *
 * A SEQUÊNCIA, com gestos comuns: a pessoa edita o atlas A com a rede ruim (a edição fica na fila),
 * vai para o atlas B, e a sessão cai (inatividade, ou uma renovação que falhou de vez). A troca de
 * atlas PROMETE que a fila de A fica guardada para a próxima abertura de A
 * (`switchToExistingLocalAtlas`, "A FILA DE SAIDA NAO E LIMPA"; `openRemoteAtlas` não esvazia nada).
 *
 * O DEFEITO: o caminho involuntário (`AccountControl._handleLogout({ involuntary: true })`) conta e
 * resgata SÓ o atlas montado. Com B sem pendência, ele segue para o ramo de descarte e chama
 * `discardRemoteAtlasNamespaces`, que destrói todo namespace remoto não reivindicado, o de A
 * inclusive, com a edição dentro. Nenhum aviso: o caminho involuntário não fala de descarte, e a
 * pessoa nunca clicou em "Sair".
 *
 * O INSTRUMENTO LÊ O DISCO CRU (`ebgeo__remote-<A>`, store `operation_queue`) e o registro local
 * pela API de leitura do disco: a pergunta é se a edição de A ainda existe em algum lugar desta
 * máquina, e a store é justamente quem está sob suspeita.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Entra pela interface de `atlas.html`, que recarrega a página já com a sessão do app. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/** Uma conta com três atlas de servidor, e o app logado. */
async function semear(page) {
    const creds = await createVerifiedUser({ prefix: 'sessao-outro', nome: 'Sessão e outro atlas' });
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/atlas.html');
    await entrarPelaInterface(page, creds);
    return page.evaluate(async ({ api }) => {
        const a = await api.createAtlas({ name: 'Atlas A deixado com fila' });
        const c = await api.createAtlas({ name: 'Atlas C deixado com fila' });
        const b = await api.createAtlas({ name: 'Atlas B aberto' });
        return { a: a.id, c: c.id, b: b.id };
    }, { api: await clienteNaPagina(page, creds) });
}

/** Abre o atlas pelo deep link e espera a sincronia de pé e o mapa DO ATLAS ativo. */
async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
}

/** Quantas operações (`op_`) o banco de fila daquele atlas guarda, lido cru. */
function contarFila(page, atlasId) {
    return page.evaluate(async (nome) => {
        const bancos = await indexedDB.databases();
        if (!bancos.some((b) => b.name === nome)) return { existe: false, ops: 0 };
        return new Promise((resolve, reject) => {
            const pedido = indexedDB.open(nome);
            pedido.onerror = () => reject(pedido.error);
            pedido.onsuccess = () => {
                const db = pedido.result;
                if (!db.objectStoreNames.contains('operation_queue')) {
                    db.close();
                    resolve({ existe: true, ops: 0 });
                    return;
                }
                const chaves = db.transaction('operation_queue', 'readonly')
                    .objectStore('operation_queue').getAllKeys();
                chaves.onerror = () => { db.close(); reject(chaves.error); };
                chaves.onsuccess = () => {
                    const todas = chaves.result.map(String);
                    db.close();
                    resolve({ existe: true, ops: todas.filter((k) => k.startsWith('op_')).length });
                };
            };
        });
    }, `ebgeo__remote-${atlasId}`);
}

/** O slot local que reivindica o namespace do atlas, e os nomes de feição que ele guarda. */
function lerResgate(page, atlasId) {
    return page.evaluate(async (id) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const local = await import('/src/js/store/local-atlas.api.js');
        const entrada = await local.localAtlasAdoptingRemote(id);
        if (!entrada) return { slot: null, nomes: [] };
        const escopo = local.scopeOfLocalAtlas(entrada);
        await ns.reconcileDurablePointers(escopo);
        const nomes = [];
        await ns.getStoreFor(ns.StoreName.MAPS, escopo).iterate((mapa) => {
            for (const p of mapa?.features?.points ?? []) nomes.push(p?.properties?.nome);
        });
        return { slot: { id: entrada.id, name: entrada.name }, nomes };
    }, atlasId);
}

/** Abre o atlas, corta o envio DELE e deixa uma edição pendente. */
async function deixarPendente(page, atlasId, nome) {
    await abrirOnline(page, atlasId);
    await page.route(`**/atlas/${atlasId}/sync`, (route) => (route.request().method() === 'POST'
        ? route.abort('connectionfailed') : route.continue()));
    const feicao = realPointFeature({ nome });
    await page.evaluate(async (f) => {
        const store = await import('/src/js/store/index.js');
        await store.addFeature('points', f);
    }, feicao);
    const fila = await contarFila(page, atlasId);
    expect(fila.ops, `a edição de ${nome} ficou na fila`).toBeGreaterThan(0);
    return nome;
}

describeOrSkip('a sessão perdida e a fila de um atlas que a aba já deixou', () => {
    test.describe.configure({ retries: 0 });

    test('as edições pendentes de A e C sobrevivem à queda da sessão com B, limpo, montado', async ({ page }) => {
        test.setTimeout(300000);
        const { a, c, b } = await semear(page);

        // Só o envio de A e de C é cortado: B sincroniza normalmente, e é justamente B sem
        // pendência que leva o caminho involuntário ao ramo de descarte.
        const emA = await deixarPendente(page, a, 'PENDENTE EM A');
        const emC = await deixarPendente(page, c, 'PENDENTE EM C');

        await abrirOnline(page, b);
        // CONTROLE: a troca de atlas guardou as duas filas, que é a promessa da troca.
        expect((await contarFila(page, a)).ops, 'a troca preservou a fila de A').toBeGreaterThan(0);
        expect((await contarFila(page, c)).ops, 'a troca preservou a fila de C').toBeGreaterThan(0);
        const ponteiroAntes = await page.evaluate(async () => {
            const local = await import('/src/js/store/local-atlas.api.js');
            return local.getCurrentLocalAtlasId();
        });

        await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.getControl('account').handleSessionLost('Sua sessão expirou por inatividade.');
        });

        const resgateA = await lerResgate(page, a);
        const resgateC = await lerResgate(page, c);
        const resgateB = await lerResgate(page, b);
        const aviso = page.locator('.toast', { hasText: 'outros atlas' });
        const textoDoAviso = await aviso.first().innerText({ timeout: 10000 }).catch(() => null);
        process.stdout.write(`[sessao-perdida] ${JSON.stringify({ resgateA, resgateC, resgateB, textoDoAviso })}
`);
        expect(resgateA.slot, 'a edição pendente de A foi guardada como atlas local').not.toBeNull();
        expect(resgateA.nomes, 'o atlas local guarda a edição de A').toContain(emA);
        expect(resgateC.slot, 'a edição pendente de C foi guardada como atlas local').not.toBeNull();
        expect(resgateC.nomes, 'o atlas local guarda a edição de C').toContain(emC);
        // O LIMPO NÃO ENTRA: zero pendência não vira atlas local.
        expect(resgateB.slot, 'o atlas sem pendência não virou atlas local').toBeNull();
        expect(textoDoAviso, 'o aviso nomeia os dois atlas resgatados').toContain('Atlas A deixado com fila');
        expect(textoDoAviso).toContain('Atlas C deixado com fila');

        // O resgate não mexe no atlas em que a pessoa estava: o ponteiro local é o de antes.
        const ponteiroDepois = await page.evaluate(async () => {
            const local = await import('/src/js/store/local-atlas.api.js');
            return local.getCurrentLocalAtlasId();
        });
        expect(ponteiroDepois, 'o ponteiro do atlas local corrente não foi movido').toBe(ponteiroAntes);

        // IDEMPOTÊNCIA: uma segunda queda não resgata de novo o que já é atlas local.
        const segunda = await page.evaluate(async () => {
            const exit = await import('/src/js/session/unsynced-work-exit.js');
            const local = await import('/src/js/store/local-atlas.api.js');
            const ns = await import('/src/js/store/atlas-namespace.js');
            const antes = (await ns.readLocalAtlasRegistry()).length;
            const r = await exit.preserveUnsyncedWorkOfOtherAtlases();
            const depois = (await ns.readLocalAtlasRegistry()).length;
            return { antes, depois, resgatados: r.rescued.length, local: typeof local };
        });
        expect(segunda.resgatados, 'nada é resgatado duas vezes').toBe(0);
        expect(segunda.depois).toBe(segunda.antes);
    });

    test('o boot com a sessão morta (credencial recusada) resgata a fila antes de varrer', async ({ page }) => {
        test.setTimeout(300000);
        const { a } = await semear(page);
        const emA = await deixarPendente(page, a, 'PENDENTE EM A NO BOOT');

        // A SESSÃO MORREU COM O NAVEGADOR FECHADO: o servidor recusa a credencial guardada (401 no
        // `/auth/me` e na renovação), então o boot limpa os tokens e segue deslogado até a varredura.
        const recusa = (route) => route.fulfill({
            status: 401, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } }),
        });
        await page.route('**/auth/me', recusa);
        await page.route('**/auth/refresh', recusa);
        // Pelo deep link, e nao pela URL nua: com tokens guardados a URL nua vai para atlas.html antes
        // de o mapa bootar, e a varredura que se quer medir e a do boot do MAPA.
        await page.goto(`/?atlas=${a}`);
        await page.waitForFunction(() => Boolean(globalThis.__ebgeoMap?.loaded?.()), null, { timeout: 60000 });
        await page.locator('.loading-background').waitFor({ state: 'hidden', timeout: 60000 });

        const resgate = await lerResgate(page, a);
        const tokens = await page.evaluate(() => Boolean(localStorage.getItem('ebgeo_auth')));
        process.stdout.write(`[boot-sessao-morta] ${JSON.stringify({ resgate, tokens })}
`);
        expect(tokens, 'CONTROLE: o boot tratou a credencial como morta').toBe(false);
        expect(resgate.slot, 'a edição pendente de A foi guardada como atlas local no boot').not.toBeNull();
        expect(resgate.nomes).toContain(emA);
    });
});
