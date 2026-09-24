// Path: e2e-ui/visita-publica-depois-conta-ve-tudo.repro.spec.js

/**
 * @fileoverview QUEM VISITOU UM ATLAS PELO LINK PÚBLICO E DEPOIS ENTRA PELA CONTA VÊ O ATLAS INTEIRO.
 *
 * O retrato do servidor é recortado POR QUEM PEDE: um retrato de nível `read` (Visualizador,
 * visitante de link público) não traz os comentários espaciais (`getAtlasSnapshot`,
 * `backend/src/modules/sync/sync.service.js`), e as definições de camada de catálogo vêm filtradas
 * pelo predicado de acesso de quem pede. Desde que o `connect` passou a pedir só a CAUDA quando há
 * uma geração completa no disco (`_durablePullCursor`, `src/js/store/sync/sync-engine.js`), a
 * geração gravada pela VISITA passou a valer como "completa" para a CONTA que entra depois no mesmo
 * atlas, neste mesmo computador: o dono entra, e os comentários anteriores à visita não aparecem.
 *
 * A SEQUÊNCIA é de três cliques: abrir o link público, "Entrar", escolher o atlas em "Meus Atlas".
 * Nenhum boot deslogado acontece no meio (o login é na página de atlas), então a varredura que
 * apagaria o namespace da visita não roda.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';
import { clienteNaPagina } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Entra pela interface de `atlas.html`. */
async function entrarPelaInterface(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="app-bar-logout"]')).toBeVisible({ timeout: 30000 });
}

/** Os textos dos comentários do mapa corrente, lidos da store (a coleção é chaveada por id). */
function comentarios(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const lista = await store.getComments();
        return Object.values(lista ?? {}).map((c) => c?.texto ?? c?.text ?? null);
    });
}

describeOrSkip('a visita pública e a conta que entra depois no mesmo atlas', () => {
    test.describe.configure({ retries: 0 });

    test('o dono que entra depois da visita vê os comentários que a visita não recebeu', async ({ page }) => {
        test.setTimeout(240000);
        const dono = await createVerifiedUser({ prefix: 'visita-conta', nome: 'Dono do atlas público' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/atlas.html');
        const semente = await page.evaluate(async ({ api, base }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const atlas = await api.createAtlas({ name: 'Atlas público comentado' });
            const mapId = atlas.map_order?.[0];
            if (!mapId) throw new Error('O servidor não criou o mapa inicial do atlas.');
            await api.pushOperations(atlas.id, [
                createOperation('comment', 'create', crypto.randomUUID(), mapId, {
                    texto: 'COMENTARIO DO DONO', lng: -43.18, lat: -22.91, resolvido: false,
                }),
            ]);
            const res = await fetch(`${base}/api/v1/atlas/${atlas.id}/sharing/public`, {
                method: 'POST', headers: { Authorization: `Bearer ${api.getAccessToken()}` },
            });
            return { atlasId: atlas.id, publicLink: (await res.json())?.data?.publicLink };
        }, { api: await clienteNaPagina(page, dono), base: state.baseUrl });
        expect(semente.publicLink, 'o atlas foi publicado').toBeTruthy();

        // 1. A VISITA, anônima.
        await page.goto(`/?atlasPublico=${semente.publicLink}`);
        await expect.poll(() => page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const e = ns.getActiveScope();
            return `${e?.kind}:${e?.atlasId}`;
        }), { timeout: 60000 }).toBe(`remote:${semente.atlasId}`);
        await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);
        // CONTROLE: o visitante de fato não recebe comentário (é o recorte do servidor).
        expect(await comentarios(page), 'o visitante não recebe comentários').toEqual([]);

        // 2. "ENTRAR" e 3. escolher o atlas: pela página de atlas, sem boot deslogado no meio.
        await page.goto('/atlas.html');
        await entrarPelaInterface(page, dono);
        await page.goto(`/?atlas=${semente.atlasId}`);
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => currentMapKeyIsUuid(page), { timeout: 30000 }).toBe(true);

        const vistos = await expect.poll(() => comentarios(page), { timeout: 15000 })
            .toContain('COMENTARIO DO DONO').then(() => true, () => false);
        process.stdout.write(`[visita-conta] ${JSON.stringify({ vistos, agora: await comentarios(page) })}\n`);
        expect(vistos, 'o dono não vê o próprio comentário depois de ter visitado o link público').toBe(true);
    });
});
