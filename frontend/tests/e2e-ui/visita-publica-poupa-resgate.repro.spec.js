// Path: e2e-ui/visita-publica-poupa-resgate.repro.spec.js

/**
 * @fileoverview A VISITA PÚBLICA ANÔNIMA A UM ATLAS NÃO APAGA O TRABALHO RESGATADO DAQUELE ATLAS.
 *
 * A SEQUÊNCIA, e todo passo dela é gesto comum: uma conta edita um atlas de servidor que é PÚBLICO;
 * a sessão cai com a edição ainda na fila, então `preserveUnsyncedWorkAsLocal` adota o namespace
 * `remote-<atlasId>` como atlas local e diz à pessoa que o trabalho foi guardado neste computador;
 * ainda deslogada, a pessoa abre o LINK PÚBLICO do mesmo atlas.
 *
 * O DEFEITO: o ramo anônimo de `openPublicAtlasFromUrl` (`src/js/index.js`) ativa o namespace e
 * chama `clearAllDataStore` sem perguntar nada, e aquele namespace É o slot resgatado
 * (`adoptRemoteAtlasAsLocal` move a reivindicação e zero bytes). A pergunta que existe para
 * exatamente isto, `confirmDiscardingRescuedWork`, morava só na outra porta (`openRemoteAtlas`, a
 * abertura PELA CONTA), e a visita pública é a única entrada em atlas de servidor que não passa por
 * ela. O slot continua na lista, com o nome de resgate, e sem a edição que ele existia para guardar.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. A edição é conferida no slot resgatado
 * ANTES da visita (controle positivo: o resgate aconteceu e guardou a feição), e depois dela pelo
 * mesmo leitor. O segundo caso confirma o descarte e exige que a visita de fato abra, o que separa
 * "o guarda funciona" de "o guarda recusa sempre".
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { realPointFeature } from '../helpers/real-fixtures.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const TITULO_DA_PERGUNTA = 'Este atlas tem trabalho guardado neste computador';

/** Entra pela interface de `atlas.html`, que recarrega a página já com a sessão do app. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/**
 * Uma conta com um atlas de servidor PUBLICADO, com uma feição semeada, e o app logado.
 * @returns {Promise<{atlasId: string, publicLink: string, featureId: string}>}
 */
async function semear(page) {
    const creds = await createVerifiedUser({ prefix: 'visita-resgate', nome: 'Visita e resgate' });
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/atlas.html');
    await entrarPelaInterface(page, creds);
    return page.evaluate(async ({ api, base }) => {
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const atlas = await api.createAtlas({ name: 'Atlas público com resgate' });
        const mapId = atlas.map_order?.[0];
        if (!mapId) throw new Error('O servidor não criou o mapa inicial do atlas.');
        const featureId = crypto.randomUUID();
        await api.pushOperations(atlas.id, [
            createOperation('feature', 'create', featureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'PONTO DO SERVIDOR' },
            }),
        ]);
        const res = await fetch(`${base}/api/v1/atlas/${atlas.id}/sharing/public`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${api.getAccessToken()}` },
        });
        const body = await res.json();
        return { atlasId: atlas.id, publicLink: body?.data?.publicLink, featureId };
    }, { api: await clienteNaPagina(page, creds), base: state.baseUrl });
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

/** Uma edição que fica PENDENTE: o envio de lote é cortado antes de ela nascer. */
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

/**
 * O slot local que reivindica o namespace do atlas, e os nomes de feição que ele guarda.
 *
 * Lido pelo ESCOPO do slot (`scopeOfLocalAtlas`), que resolve a geração do mesmo jeito que montar
 * o slot resolve: a pergunta é o que a pessoa encontra ao abrir o resgate, não o que a aba montou.
 * @returns {Promise<{slot: {id: string, name: string}|null, nomes: string[]}>}
 */
function lerResgate(page, atlasId) {
    return page.evaluate(async (id) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const local = await import('/src/js/store/local-atlas.api.js');
        const entrada = await local.localAtlasAdoptingRemote(id);
        if (!entrada) return { slot: null, nomes: [] };
        const escopo = local.scopeOfLocalAtlas(entrada);
        await ns.reconcileDurablePointers?.(escopo);
        const nomes = [];
        await ns.getStoreFor(ns.StoreName.MAPS, escopo).iterate((mapa) => {
            for (const p of mapa?.features?.points ?? []) nomes.push(p?.properties?.nome);
        });
        return { slot: { id: entrada.id, name: entrada.name }, nomes };
    }, atlasId);
}

/**
 * Uma edição no slot resgatado, que a aba tem montado depois do resgate.
 * @returns {Promise<string>} O nome da feição gravada.
 */
async function editarNoResgate(page, nome) {
    const escopo = await page.evaluate(async (n) => {
        const store = await import('/src/js/store/index.js');
        const ns = await import('/src/js/store/atlas-namespace.js');
        const f = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.3, -22.8] },
            properties: { id: crypto.randomUUID(), source: 'point', nome: n },
        };
        await store.addFeature('points', f);
        const e = ns.getActiveScope();
        return `${e?.kind}:${e?.dbSuffix}`;
    }, nome);
    expect(escopo, 'a aba ficou no slot resgatado').toMatch(/^local:remote-/);
    return nome;
}

/** A sessão cai sem gesto, com a edição na fila: o caminho que resgata. */
async function perderSessao(page) {
    await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        await store.getControl('account').handleSessionLost('Sua sessão expirou.');
    });
}

describeOrSkip('a visita pública anônima e o trabalho resgatado do mesmo atlas', () => {
    test.describe.configure({ retries: 0 });

    test('cancelar a pergunta deixa o resgate intacto', async ({ page }) => {
        test.setTimeout(240000);
        const { atlasId, publicLink } = await semear(page);
        expect(publicLink, 'o atlas foi publicado').toBeTruthy();
        await abrirOnline(page, atlasId);
        const feicao = await editarSemEnviar(page, 'EDICAO RESGATADA');
        await perderSessao(page);

        // O RESGATE É UM ATLAS LOCAL, e a pessoa continua trabalhando nele: esta edição não vira
        // op de fila (atlas local não sincroniza), então só o slot a guarda.
        const noLocal = await editarNoResgate(page, 'EDICAO FEITA NO RESGATE');

        const antes = await lerResgate(page, atlasId);
        process.stdout.write(`[resgate-antes] ${JSON.stringify(antes)}\n`);
        // CONTROLE POSITIVO: o resgate aconteceu e guardou as duas edições.
        expect(antes.slot, 'a queda da sessão resgatou o atlas como local').not.toBeNull();
        expect(antes.nomes, 'o slot resgatado guarda a edição pendente').toContain(feicao.properties.nome);
        expect(antes.nomes, 'o slot resgatado guarda a edição feita nele').toContain(noLocal);

        await page.unroute('**/atlas/*/sync');
        await page.goto(`/?atlasPublico=${publicLink}`);
        await page.waitForFunction(() => Boolean(globalThis.__ebgeoMap?.loaded?.()), null, { timeout: 60000 });

        const pergunta = page.locator('.confirm-modal-container', { hasText: TITULO_DA_PERGUNTA });
        const perguntou = await pergunta.waitFor({ state: 'visible', timeout: 20000 })
            .then(() => true, () => false);
        process.stdout.write(`[visita] perguntou=${perguntou}\n`);
        if (perguntou) await pergunta.getByRole('button', { name: 'Cancelar' }).click();
        await page.locator('.loading-background').waitFor({ state: 'hidden', timeout: 60000 });

        const depois = await lerResgate(page, atlasId);
        process.stdout.write(`[resgate-depois] ${JSON.stringify(depois)}\n`);
        expect(depois.slot, 'o slot resgatado continua reivindicando o namespace').not.toBeNull();
        expect(depois.nomes, 'a visita pública apagou a edição resgatada').toContain(feicao.properties.nome);
        expect(depois.nomes, 'a visita pública apagou a edição feita no resgate').toContain(noLocal);
        expect(perguntou, 'a visita perguntou antes de mexer no resgate').toBe(true);
    });

    test('confirmar o descarte abre a visita e solta o slot resgatado', async ({ page }) => {
        test.setTimeout(240000);
        const { atlasId, publicLink, featureId } = await semear(page);
        await abrirOnline(page, atlasId);
        const descartada = await editarSemEnviar(page, 'EDICAO DESCARTADA');
        await perderSessao(page);
        expect((await lerResgate(page, atlasId)).slot, 'o resgate aconteceu').not.toBeNull();

        await page.unroute('**/atlas/*/sync');
        await page.goto(`/?atlasPublico=${publicLink}`);
        const pergunta = page.locator('.confirm-modal-container', { hasText: TITULO_DA_PERGUNTA });
        await pergunta.waitFor({ state: 'visible', timeout: 60000 });
        await pergunta.getByRole('button', { name: 'Apagar e abrir' }).click();

        // A visita abriu de verdade: o escopo é o do atlas público e a feição do servidor chegou.
        // Nesta ordem, porque o slot resgatado TAMBÉM tem a feição do servidor: ler a feição antes
        // do escopo passaria olhando para o resgate.
        await expect.poll(() => page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const e = ns.getActiveScope();
            return `${e?.kind}:${e?.atlasId}`;
        }), { timeout: 30000 }).toBe(`remote:${atlasId}`);
        await expect.poll(() => page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            return (f?.points || []).map((p) => p.properties?.nome);
        }), { timeout: 30000 }).toContain('PONTO DO SERVIDOR');
        expect((await lerResgate(page, atlasId)).slot, 'o descarte soltou o slot resgatado').toBeNull();
        // "APAGAR" INCLUI A FILA: a edição pendente da conta que caiu não pode ser reprojetada no
        // mapa do visitante, e a fila do atlas fica vazia. Sem `clearQueue` no descarte, o retrato
        // reprojeta a intenção pendente e ela aparece na visita anônima.
        const naVisita = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            return (f?.points || []).map((p) => p.properties?.nome);
        });
        expect(naVisita, 'a edição descartada não aparece na visita').not.toContain(descartada.properties.nome);
        expect((await contarFila(page, atlasId)).ops, 'a fila do atlas foi esvaziada pelo descarte').toBe(0);
        expect(featureId).toBeTruthy();
    });
});
