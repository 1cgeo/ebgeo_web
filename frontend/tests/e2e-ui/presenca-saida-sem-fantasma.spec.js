// Path: e2e-ui/presenca-saida-sem-fantasma.spec.js

/**
 * DUAS BROWSERS, BACKEND REAL: quem fecha a aba sai da lista de quem está online, e FICA fora
 * (relato do dono, 2026-09-22: "ainda diz que tem usuário presente mesmo que depois de sair").
 *
 * O ELO QUE ESTE SPEC MEDE NO NAVEGADOR. O servidor anuncia `user_left` na hora e manda o cursor
 * num lote por sala, no tique seguinte. Um quadro que chegou antes do fechamento saía DEPOIS do
 * anúncio, e o armazém de presença do par (`setCursor`) recriava a pessoa sem nome, para sempre. O
 * conserto tem duas metades: o servidor descarta o cursor pendente de quem sai
 * (`descartarCursorPendente`) e o cliente recusa quadro atrasado de chave que acabou de sair
 * (`_isLateForDeparted`). Os casos de node prendem cada metade sozinha
 * (`backend/tests/ws/presenca-fantasma-apos-saida.repro.test.js` e
 * `frontend/tests/integration/presence-store.test.js`); este é o par ponta a ponta.
 *
 * O FECHAMENTO É O DO NAVEGADOR: `page.close()` descarrega o documento, e o navegador fecha o
 * socket sozinho, sem o `leave` da aplicação. É a saída que o dono fez.
 *
 * A ESPERA É POR ESTADO: o `user_left` do fechado no socket do observador, depois uma janela maior
 * que o lote de cursor do servidor (100 ms por padrão), e só então a leitura do armazém.
 *
 * O CONTEXTO DE VISUALIZADOR vai junto como piso de fiação: o quadro `viewer_context` de um identificador
 * que não existe no catálogo chega ao par como superfície sem recurso. O nome e o recorte por
 * destinatário são medidos contra o banco em `backend/tests/ws/presenca-contexto-do-visualizador.test.js`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Conecta um WsClient real dentro da página e, no observador, alimenta um PresenceStore real com
 * os quadros na ordem em que chegam, como `presence-bridge` faz no app.
 * @param {import('@playwright/test').Page} page
 * @param {Object} cfg
 */
function conectar(page, cfg) {
    return page.evaluate(async ({ baseUrl, username, password, atlasId, clientId, observar }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { WsClient } = await import('/src/js/store/sync/ws-client.js');
        const { ConnectionState } = await import('/src/js/store/sync/connection-state.js');
        const { PresenceStore } = await import('/src/js/presence/presence-store.js');

        const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await api.login(username, password);
        const store = new PresenceStore();
        const presenca = [];
        const ws = new WsClient({
            apiClient: api,
            connectionState: new ConnectionState(),
            socketFactory: (url) => new WebSocket(url),
            clientId,
            heartbeatMs: 1e7,
        });
        if (observar) {
            ws.on('connected', (m) => store.setInitial(m.usersOnline || []));
            ws.on('presence', (m) => {
                presenca.push(m);
                if (m.type === 'user_joined') store.userJoined(m.user || m);
                if (m.type === 'user_left') store.userLeft(m);
                if (m.type === 'user_away') store.userAway(m);
                if (m.type === 'user_back') store.userBack(m);
            });
            ws.on('cursor', (m) => store.setCursor(m));
            ws.on('viewerContext', (m) => store.setViewer(m));
        }
        await ws.connect(atlasId);
        window.__presenca = { api, ws, store, presenca };
        return true;
    }, cfg);
}

describeOrSkip('presença: quem fecha a aba não volta à lista (duas browsers, backend real)', () => {
    test('o cursor enviado logo antes de fechar não ressuscita quem saiu', async ({ browser }) => {
        const dono = await createVerifiedUser({ prefix: 'fantasma', nome: 'Fantasma Dono' });
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const seed = await seedPage.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);
            const atlas = await api.createAtlas({ name: 'Atlas do fantasma' });
            await api.pushOperations(atlas.id, [createOperation('map', 'create', crypto.randomUUID(), null, { name: 'M1' })]);
            return { atlasId: atlas.id };
        }, { baseUrl: state.baseUrl, u: dono });
        await seedPage.close();

        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        for (const page of [pageA, pageB]) {
            await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
            await page.goto('/');
        }

        const cidA = `obs-${crypto.randomUUID().slice(0, 8)}`;
        const cidB = `sai-${crypto.randomUUID().slice(0, 8)}`;
        const base = { baseUrl: state.baseUrl, username: dono.username, password: dono.password, atlasId: seed.atlasId };
        await conectar(pageA, { ...base, clientId: cidA, observar: true });
        await conectar(pageB, { ...base, clientId: cidB, observar: false });

        // B está na lista de A, e o contexto de visualizador dele chega.
        await expect.poll(() => pageA.evaluate((cid) => window.__presenca.store.getUsers()
            .some((u) => u.clientId === cid), cidB)).toBe(true);
        await pageB.evaluate(() => window.__presenca.ws.sendViewer({ surface: '3d', tilesetId: 'nao-existe-no-catalogo' }));
        await expect.poll(() => pageA.evaluate((cid) => window.__presenca.store.getUsers()
            .find((u) => u.clientId === cid)?.viewer ?? null, cidB)).toEqual({ surface: '3d', recurso: null });

        // O mouse ainda andando no instante em que a aba fecha.
        await pageB.evaluate((mapId) => {
            for (let i = 0; i < 5; i++) {
                window.__presenca.ws.sendCursor({ position: { lng: -43 - i / 100, lat: -22.9 }, mapId });
            }
        }, 'M1');
        await pageB.close();

        // O anúncio da saída chega...
        await expect.poll(() => pageA.evaluate((cid) => window.__presenca.presenca
            .some((m) => m.type === 'user_left' && m.clientId === cid), cidB), { timeout: 10000 }).toBe(true);
        // ...e, passado mais que um lote de cursor inteiro, a pessoa continua fora.
        await pageA.waitForTimeout(800);
        const restantes = await pageA.evaluate((cid) => window.__presenca.store.getUsers()
            .filter((u) => u.clientId === cid).length, cidB);
        console.log(`[presenca-fantasma] entradas de ${cidB} no armazém do observador: ${restantes}`);
        expect(restantes).toBe(0);

        await pageA.evaluate(() => window.__presenca.ws.disconnect());
        await ctxA.close();
        await ctxB.close();
    });
});
