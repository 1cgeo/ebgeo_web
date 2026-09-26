// Path: e2e-ui/resgate-envia-pendencias.repro.spec.js

/**
 * @fileoverview DEPOIS DE UM RESGATE, A MESMA CONTA MANDA A FILA DE VOLTA AO ATLAS DE ONDE ELA VEIO
 * (decisão do dono de 2026-09-26).
 *
 * A SEQUÊNCIA: a conta edita um atlas de servidor, a edição fica na fila, a sessão cai sem gesto e
 * `preserveUnsyncedWorkAsLocal` adota o namespace como atlas local. A mesma conta entra de novo e
 * abre o mesmo atlas. Até esta data a pergunta tinha duas saídas, Cancelar e "Apagar e abrir", e o
 * texto mandava a pessoa pelo caminho longo do "Enviar ao servidor", que cria um atlas NOVO. Agora
 * há a terceira, "Enviar as pendências", que devolve o namespace ao atlas sem esvaziá-lo, e a fila
 * sai no envio seguinte.
 *
 * AS DUAS CONDIÇÕES, medidas aqui pela tela: a saída aparece para a conta que escreveu a fila, e
 * some quando a cópia resgatada foi editada depois do resgate (o que foi feito nela não está em fila
 * nenhuma, e o retrato do servidor o apagaria na entrada).
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: a edição pendente é conferida no SERVIDOR
 * (pelo pull de um cliente próprio do teste, nunca pela memória do app), então uma saída que só
 * reabrisse o atlas sem mandar a fila ficaria vermelha.
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

async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/** Uma conta com um atlas de servidor, e o app logado em `atlas.html`. */
async function semear(page) {
    const creds = await createVerifiedUser({ prefix: 'resgate-envia', nome: 'Resgate que envia' });
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/atlas.html');
    await entrarPelaInterface(page, creds);
    const atlasId = await page.evaluate(async (api) => (await api.createAtlas({ name: 'Atlas com resgate' })).id,
        await clienteNaPagina(page, creds));
    return { creds, atlasId };
}

async function abrirOnline(page, atlasId) {
    await page.goto(`/?atlas=${atlasId}`);
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
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

async function perderSessao(page) {
    await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        await store.getControl('account').handleSessionLost('Sua sessão expirou.');
    });
    await expect.poll(() => page.evaluate(async (id) => {
        const local = await import('/src/js/store/local-atlas.api.js');
        return Boolean(await local.localAtlasAdoptingRemote(id));
    }, page.__atlasId), { timeout: 30000, message: 'a queda da sessão não resgatou o atlas' }).toBe(true);
}

/** Os nomes dos pontos que o SERVIDOR tem no atlas, pelo pull de um cliente do teste. */
function nomesNoServidor(page, creds, atlasId) {
    return clienteNaPagina(page, creds).then((api) => page.evaluate(async ({ cliente, id }) => {
        const r = await cliente.pullSync(id, 0);
        return (r.snapshot?.maps ?? []).flatMap((m) => (m.features?.points ?? []).map((p) => p.properties?.nome));
    }, { cliente: api, id: atlasId }));
}

/** Entra de novo e abre o atlas pelo deep link; devolve a pergunta. */
async function voltarEAbrir(page, creds, atlasId) {
    await page.unroute('**/atlas/*/sync');
    await page.goto('/atlas.html');
    await entrarPelaInterface(page, creds);
    await page.goto(`/?atlas=${atlasId}`);
    const pergunta = page.locator('.confirm-modal-container', { hasText: TITULO_DA_PERGUNTA });
    await pergunta.waitFor({ state: 'visible', timeout: 60000 });
    return pergunta;
}

describeOrSkip('resgate: enviar as pendências a este atlas', () => {
    test.describe.configure({ retries: 0 });

    test('a mesma conta, com a cópia intocada, manda a edição pendente ao servidor', async ({ page }) => {
        test.setTimeout(240000);
        const { creds, atlasId } = await semear(page);
        page.__atlasId = atlasId;
        await abrirOnline(page, atlasId);
        const pendente = await editarSemEnviar(page, 'EDICAO PENDENTE');
        await perderSessao(page);
        expect(await nomesNoServidor(page, creds, atlasId), 'a edição não tinha chegado').not.toContain(pendente.properties.nome);

        const pergunta = await voltarEAbrir(page, creds, atlasId);
        const botoes = await pergunta.getByRole('button').allInnerTexts();
        process.stdout.write(`[pergunta] ${JSON.stringify(botoes)}\n`);
        expect(botoes).toEqual(['Cancelar', 'Apagar e abrir', 'Enviar as pendências']);
        await pergunta.getByRole('button', { name: 'Enviar as pendências' }).click();

        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => nomesNoServidor(page, creds, atlasId), {
            timeout: 30000, message: 'a fila resgatada não chegou ao servidor',
        }).toContain(pendente.properties.nome);
        const aviso = page.locator('.toast', { hasText: 'voltaram para este atlas' }).first();
        await expect(aviso).toBeVisible({ timeout: 10000 });
        expect(await page.evaluate(async (id) => {
            const local = await import('/src/js/store/local-atlas.api.js');
            return Boolean(await local.localAtlasAdoptingRemote(id));
        }, atlasId), 'o slot resgatado foi solto').toBe(false);
    });

    test('a cópia editada depois do resgate não oferece o envio', async ({ page }) => {
        test.setTimeout(240000);
        const { creds, atlasId } = await semear(page);
        page.__atlasId = atlasId;
        await abrirOnline(page, atlasId);
        await editarSemEnviar(page, 'EDICAO PENDENTE');
        await perderSessao(page);
        // A pessoa segue trabalhando no atlas local resgatado: esta edição não vira op de fila.
        await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.addFeature('points', {
                type: 'Feature', geometry: { type: 'Point', coordinates: [-43.3, -22.8] },
                properties: { id: crypto.randomUUID(), source: 'point', nome: 'EDICAO NO RESGATE' },
            });
        });

        const pergunta = await voltarEAbrir(page, creds, atlasId);
        const botoes = await pergunta.getByRole('button').allInnerTexts();
        process.stdout.write(`[pergunta-editada] ${JSON.stringify(botoes)}\n`);
        expect(botoes).toEqual(['Cancelar', 'Apagar e abrir']);
        await pergunta.getByRole('button', { name: 'Cancelar' }).click();
    });
});
