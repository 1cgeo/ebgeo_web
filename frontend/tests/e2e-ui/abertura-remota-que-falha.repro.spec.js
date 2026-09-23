// Path: e2e-ui/abertura-remota-que-falha.repro.spec.js

/**
 * @fileoverview A ABERTURA DE ATLAS DE SERVIDOR QUE FALHA NO BOOT NAO APAGA NADA, e a aba termina
 * num estado que funciona (decisao do dono Q1, 2026-09-23).
 *
 * O DEFEITO, lido no codigo e medido aqui: quando `openAtlasFromUrl` (`src/js/index.js`) falhava
 * depois de a abertura ter montado o namespace remoto, a cadeia de roteamento caia em
 * `enterLocalMapOnBoot` (a aba tinha a intencao "Mapa local") ou em `openAtlasChooserOnBoot`, e os
 * dois chamavam um wipe do escopo MONTADO com os padroes de `clearAllDataStore`, que esvaziam a
 * fila de saida. O escopo montado, naquele instante, era o do atlas que acabara de falhar: a fila
 * que a proxima abertura deveria entregar era apagada por uma falha de rede. E no ramo da intencao
 * a aba ainda ficava MORTA: escopo remoto, origem local, toda escrita recusada.
 *
 * QUATRO CASOS, e cada um responde uma pergunta diferente:
 *
 *   1. SEM a intencao: a falha leva ao seletor, e a fila do atlas sobrevive, e a reabertura
 *      seguinte a ENTREGA ao servidor (o que prova que ela nao so ficou no disco, ficou utilizavel).
 *   2. COM a intencao: a fila sobrevive, e a aba termina num atlas LOCAL de verdade: escopo local,
 *      origem local, uma escrita que grava, e o indicador dizendo `local`.
 *   3. O MESMO WIPE ALCANCAVA UM SLOT LOCAL: uma aba num atlas local com a intencao, e OUTRA aba
 *      abrindo um atlas de servidor (o marcador de origem e da instalacao). O F5 da primeira apagava
 *      o atlas LOCAL dela, porque o boot perguntava ao marcador e nao ao escopo montado.
 *   4. A CADEIA DE 2026-09-22 (a matriz de transicoes, Chromium): uma saida da conta em `atlas.html`
 *      que navega antes de o espelho de descarte assentar deixa `{discarded: true}` no disco, a
 *      proxima abertura do mesmo atlas morre em `AbortError` dentro do `connect`, e com a intencao
 *      herdada a aba fica no mapa com a luz parada em `offline`/`sem-conexao`. O atraso do espelho
 *      e INJETADO (a remocao do espelho espera 2 s), porque a corrida natural perde so as vezes e
 *      uma medida probabilistica nao e medida.
 *
 * A LEITURA DA FILA E CRUA, pelo nome do banco (`ebgeo__remote-<id>`, store `operation_queue`,
 * chaves `op_`), e nao pela API da store: a pergunta e o que ficou NO DISCO, e a store e justamente
 * quem esta sob suspeita. A existencia do banco e conferida antes por `indexedDB.databases()`,
 * porque abrir um banco que nao existe o CRIA, e o instrumento passaria a fabricar o que mede.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PROJETOS = '/atlas.html';
const INTENCAO = 'ebgeo_local_intent';

/** Entra pela interface de `atlas.html`, que recarrega a pagina ja com a sessao do app. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/**
 * Semeia uma conta e um atlas de servidor, e deixa o APP logado na pagina de atlas.
 *
 * A SESSAO DO APP E O SUJEITO destes casos (o boot por `?atlas=` precisa dela), entao ela nasce
 * pela INTERFACE de `atlas.html`, que nao boota o mapa e por isso nao tem corrida com a fase -1.
 * Nao por `sessaoDoApp`: a pagina de protocolo daquele helper e servida por `route.fulfill`, e o
 * Chromium 149 a trata como fora do espaco de enderecos local, recusando o `fetch` ao backend em
 * 127.0.0.1 ("Permission was denied for this request to access the `loopback` address space"),
 * medido em 2026-09-23. O atlas nasce pelo cliente de transporte do teste, que nao grava sessao.
 * @returns {Promise<{creds: Object, atlasId: string}>}
 */
async function semear(page, prefixo) {
    const creds = await createVerifiedUser({ prefix: prefixo, nome: 'Abertura que falha' });
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto(PROJETOS);
    await entrarPelaInterface(page, creds);
    const atlasId = await page.evaluate(async ({ api }) => {
        const atlas = await api.createAtlas({ name: 'Servidor da abertura que falha' });
        return atlas.id;
    }, { api: await clienteNaPagina(page, creds) });
    return { creds, atlasId };
}

/** Abre o atlas pelo deep link e espera a sincronia de pe e o mapa DO ATLAS ativo. */
async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
}

/** Quantas operacoes (`op_`) o banco de fila daquele atlas guarda, lido cru. */
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
                    resolve({ existe: true, ops: 0, semStore: true });
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

/** Uma chave do banco global, lida crua (o espelho de descarte mora ali). */
function lerGlobal(page, chave) {
    return page.evaluate(async (k) => {
        const bancos = await indexedDB.databases();
        if (!bancos.some((b) => b.name === 'ebgeo_global')) return null;
        return new Promise((resolve, reject) => {
            const pedido = indexedDB.open('ebgeo_global');
            pedido.onerror = () => reject(pedido.error);
            pedido.onsuccess = () => {
                const db = pedido.result;
                // O store padrao do localforage; o banco tem tambem o de deteccao de Blob.
                const nomeStore = 'keyvaluepairs';
                if (!db.objectStoreNames.contains(nomeStore)) { db.close(); resolve(null); return; }
                const leitura = db.transaction(nomeStore, 'readonly').objectStore(nomeStore).get(k);
                leitura.onerror = () => { db.close(); reject(leitura.error); };
                leitura.onsuccess = () => { db.close(); resolve(leitura.result ?? null); };
            };
        });
    }, chave);
}

/** Uma edicao que fica PENDENTE: o envio de lote e cortado antes de ela nascer. */
async function editarSemEnviar(page, nome) {
    await page.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
        ? route.abort('connectionfailed') : route.continue()));
    const feicao = realPointFeature({ nome });
    await page.evaluate(async (f) => {
        const store = await import('/src/js/store/index.js');
        await store.addFeature('points', f);
    }, feicao);
    return feicao;
}

/** O estado de fim do boot, lido na propria pagina. */
function lerEstado(page) {
    return page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const { isRemoteStoreSync } = await import('/src/js/store/store-origin.js');
        const badge = document.querySelector('[data-testid="sync-status-badge"]');
        const escopo = ns.getActiveScope();
        return {
            caminho: location.pathname,
            escopo: escopo ? `${escopo.kind}:${escopo.atlasId}` : null,
            origemRemota: isRemoteStoreSync(),
            dataState: badge?.getAttribute('data-state') ?? null,
            dataWork: badge?.getAttribute('data-work') ?? null,
        };
    });
}

/** Tenta uma escrita no escopo montado e diz o desfecho, sem lancar. */
function tentarEscrever(page, nome) {
    return page.evaluate(async (n) => {
        const store = await import('/src/js/store/index.js');
        const ns = await import('/src/js/store/atlas-namespace.js');
        const f = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { id: crypto.randomUUID(), source: 'point', nome: n },
        };
        try {
            await store.addFeature('points', f);
        } catch (erro) {
            return { gravou: false, erro: `${erro?.name}: ${String(erro?.message).slice(0, 80)}` };
        }
        const nomes = [];
        await ns.getStore(ns.StoreName.MAPS).iterate((mapa) => {
            for (const p of mapa?.features?.points ?? []) nomes.push(p?.properties?.nome);
        });
        return { gravou: nomes.includes(n), erro: null };
    }, nome);
}

/** Espera o fim da cadeia de roteamento do boot: a cortina baixou. */
async function esperarBootAssentar(page) {
    await page.waitForFunction(() => Boolean(globalThis.__ebgeoMap?.loaded?.()), null, { timeout: 60000 });
    await page.locator('.loading-background').waitFor({ state: 'hidden', timeout: 60000 });
}

describeOrSkip('a abertura remota que falha preserva a fila e termina num estado que funciona', () => {
    // A falha e INJETADA e deterministica, entao repetir um caso que falhou so esconderia a
    // regressao que ele existe para pegar.
    test.describe.configure({ retries: 0 });

    test('1. sem a intencao: seletor, fila intacta, e a reabertura seguinte a entrega', async ({ page }) => {
        test.setTimeout(240000);
        const { atlasId } = await semear(page, 'falha-seletor');
        await abrirOnline(page, atlasId);
        const feicao = await editarSemEnviar(page, 'PENDENTE SELETOR');
        const antes = await contarFila(page, atlasId);

        await page.route(`**/atlas/${atlasId}/sync/protocol`, (route) => route.abort('connectionfailed'));
        const falhou = page.waitForEvent('console', {
            predicate: (m) => m.text().includes('[boot] atlas open from URL failed'), timeout: 60000,
        });
        await page.goto(`/?atlas=${atlasId}`);
        await falhou;
        await page.waitForURL('**/atlas.html**', { timeout: 60000 });
        await expect(page.locator('[data-testid="project-picker-item"]').first()).toBeVisible({ timeout: 30000 });
        const depois = await contarFila(page, atlasId);
        // O MOTIVO CHEGA AO SELETOR: o toast do mapa morre com a navegacao, e o codigo viaja em
        // `?aviso=`. Espera-se a OPACIDADE, e nao a visibilidade do Playwright: o toast nasce
        // transparente e anima (ver `.claude/rules/testing.md`).
        const aviso = page.locator('.toast', { hasText: 'Não foi possível abrir o atlas' });
        const avisoChegou = await expect.poll(() => aviso.first().evaluate(
            (el) => Number(getComputedStyle(el).opacity)).catch(() => 0), { timeout: 10000 })
            .toBeGreaterThan(0.9).then(() => true, () => false);
        const textoDoAviso = avisoChegou ? (await aviso.first().innerText()).replace(/\s+/g, ' ') : null;
        process.stdout.write(`[r1-seletor] ${JSON.stringify({ antes, depois, textoDoAviso })}\n`);

        await page.unroute(`**/atlas/${atlasId}/sync/protocol`);
        await page.unroute('**/atlas/*/sync');
        await abrirOnline(page, atlasId);
        const entregue = await expect.poll(() => page.evaluate(async ({ id, fid }) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            return JSON.stringify(await apiClient.pullSync(id, 0)).includes(fid);
        }, { id: atlasId, fid: feicao.properties.id }), { timeout: 30000 }).toBe(true).then(() => true, () => false);
        process.stdout.write(`[r1-seletor] entregue=${entregue}\n`);

        expect(antes.ops, 'a edicao ficou pendente antes da reabertura').toBeGreaterThan(0);
        expect(depois.ops, 'a abertura que falhou apagou a fila do atlas').toBe(antes.ops);
        expect(entregue, 'a reabertura seguinte entregou a edicao ao servidor').toBe(true);
        // A FRASE INTEIRA, e nada alem dela: o seletor nao sabe se a abertura apagou algo antes de
        // falhar (o ramo do slot resgatado e o reparo de descarte apagam ANTES do `connect`), entao
        // uma promessa de preservacao aqui seria afirmar o que o codigo nao sabe.
        expect(textoDoAviso, 'o seletor nao disse por que a pessoa chegou la')
            .toBe('Não foi possível abrir o atlas. Verifique sua conexão e tente de novo.');
    });

    test('2. com a intencao: fila intacta e um atlas local de verdade, que grava', async ({ page }) => {
        test.setTimeout(240000);
        const { atlasId } = await semear(page, 'falha-local');
        await abrirOnline(page, atlasId);
        await editarSemEnviar(page, 'PENDENTE LOCAL');
        const antes = await contarFila(page, atlasId);
        await page.evaluate((k) => sessionStorage.setItem(k, '1'), INTENCAO);

        await page.route(`**/atlas/${atlasId}/sync/protocol`, (route) => route.abort('connectionfailed'));
        const falhou = page.waitForEvent('console', {
            predicate: (m) => m.text().includes('[boot] atlas open from URL failed'), timeout: 60000,
        });
        await page.goto(`/?atlas=${atlasId}`);
        await falhou;
        await esperarBootAssentar(page);
        const depois = await contarFila(page, atlasId);
        // A luz repinta pela batida periodica (3 s) e nao por evento, entao a leitura espera um
        // pouco mais que uma batida antes de valer.
        const luz = await expect.poll(async () => (await lerEstado(page)).dataWork, { timeout: 8000 })
            .toBe('local').then(() => 'local', async () => (await lerEstado(page)).dataWork);
        const estado = await lerEstado(page);
        const escrita = await tentarEscrever(page, 'ESCRITA DEPOIS DA FALHA');
        process.stdout.write(`[r1-local] ${JSON.stringify({ antes, depois, luz, estado, escrita })}\n`);

        expect(antes.ops, 'a edicao ficou pendente antes da reabertura').toBeGreaterThan(0);
        expect(depois.ops, 'a abertura que falhou apagou a fila do atlas').toBe(antes.ops);
        expect(estado.escopo?.startsWith('local:'), `a aba ficou num escopo remoto: ${estado.escopo}`).toBe(true);
        expect(estado.origemRemota).toBe(false);
        expect(escrita, 'a aba ficou num estado em que nenhuma escrita grava').toEqual({ gravou: true, erro: null });
        expect(luz, 'a luz ficou congelada na ultima pintura remota').toBe('local');
    });

    test('3. o F5 de uma aba LOCAL nao apaga o atlas local por causa do marcador de outra aba', async ({ context }) => {
        test.setTimeout(240000);
        const a = await context.newPage();
        const { atlasId } = await semear(a, 'falha-marcador');
        // A aba A entra no atlas local pelo seletor, que e o caminho que grava a intencao.
        await a.goto(PROJETOS);
        await a.locator('[data-testid="local-atlas-item"]').first().click();
        await esperarBootAssentar(a);
        const escrita = await tentarEscrever(a, 'LOCAL DA ABA A');
        const escopoA = (await lerEstado(a)).escopo;

        // A aba B abre um atlas de servidor, e isso regrava o marcador de origem DA INSTALACAO.
        const b = await context.newPage();
        await b.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await abrirOnline(b, atlasId);

        await a.reload();
        await esperarBootAssentar(a);
        await a.waitForTimeout(1500);
        const depois = await a.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const nomes = [];
            await ns.getStore(ns.StoreName.MAPS).iterate((mapa) => {
                for (const p of mapa?.features?.points ?? []) nomes.push(p?.properties?.nome);
            });
            const escopo = ns.getActiveScope();
            return { escopo: escopo ? `${escopo.kind}:${escopo.atlasId}` : null, nomes };
        });
        process.stdout.write(`[r1-marcador] ${JSON.stringify({ escrita, escopoA, depois })}\n`);

        expect(escrita.gravou, 'controle: a aba A gravou no atlas local').toBe(true);
        expect(depois.escopo).toBe(escopoA);
        expect(depois.nomes, 'o F5 apagou o atlas LOCAL da aba A').toContain('LOCAL DA ABA A');
    });

    test('4. a cadeia de 2026-09-22: saida em atlas.html, espelho atrasado, e a proxima abertura', async ({ page }) => {
        test.setTimeout(300000);
        const { creds, atlasId } = await semear(page, 'falha-cadeia');
        // A intencao nasce como na matriz: um atlas local aberto pelo seletor.
        await page.goto(PROJETOS);
        await page.locator('[data-testid="local-atlas-item"]').first().click();
        await esperarBootAssentar(page);
        await abrirOnline(page, atlasId);

        // A saida pelo seletor, com a remocao do ESPELHO atrasada 2 s: e a janela que a navegacao
        // de `endSession` fechava antes de a remocao assentar.
        await page.goto(PROJETOS);
        await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
        await page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const global = ns.getGlobalStore();
            const original = global.removeItem.bind(global);
            global.removeItem = (chave, ...resto) => (String(chave).startsWith('write_epoch:')
                ? new Promise((r) => setTimeout(r, 2000)).then(() => original(chave, ...resto))
                : original(chave, ...resto));
        });
        await page.locator('[data-testid="app-bar-logout"]').click();
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 60000 });
        await esperarBootAssentar(page);
        const espelho = await lerGlobal(page, `write_epoch:remote-${atlasId}`);
        const intencao = await page.evaluate((k) => sessionStorage.getItem(k), INTENCAO);

        // Entra de novo pela interface e abre o MESMO atlas.
        await page.goto(PROJETOS);
        await entrarPelaInterface(page, creds);
        const cartao = page.locator('[data-testid="project-picker-item"]', { hasText: 'Servidor da abertura que falha' });
        await expect(cartao).toBeVisible({ timeout: 30000 });
        const falhas = [];
        page.on('console', (m) => { if (m.text().includes('[boot] atlas open from URL failed')) falhas.push(m.text().slice(0, 200)); });
        await cartao.click();
        const online = await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 20000 }).then(() => true, () => false);
        const estado = await lerEstado(page).catch((e) => ({ ilegivel: String(e).slice(0, 80) }));
        process.stdout.write(`[r2-cadeia] ${JSON.stringify({ espelho, intencao, online, falhas, estado })}\n`);

        expect(espelho, 'o espelho de descarte sobreviveu a saida da conta').toBeNull();
        expect(intencao, 'a intencao "Mapa local" sobreviveu a saida da conta').toBeNull();
        expect(falhas, 'a reabertura do atlas falhou').toEqual([]);
        expect(online, 'a reabertura do atlas nao ficou online').toBe(true);
    });
});
