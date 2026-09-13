// Path: e2e-ui/browser-atlas-url.spec.js

/**
 * Frente 3 — URL por atlas (`?atlas=<uuid>&map=<uuid>`). Two boot paths (real browser + backend):
 *   1. Logged in → the deep link opens that atlas and lands on the REQUESTED map (not just the first).
 *   2. Logged out → the deep link is remembered, login is prompted, and after auth it RESUMES straight
 *      to that atlas (no project picker).
 * Also asserts the address bar reflects the atlas/map after connecting.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI, readFeatures } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/**
 * Seeds a VERIFIED user (Node side — o token de confirmação só existe como linha no Postgres)
 * + an atlas with EXACTLY the given named maps (UUID-keyed). Returns ids keyed by name.
 *
 * O "EXATAMENTE" É A PARTE QUE PRECISOU DE CONSERTO, em 2026-09-13. Desde `e70ccf3c`
 * ("Protege dados remotos e corrige contratos e camadas padrão", 2026-09-12) `POST /atlas`
 * SEMEIA um mapa padrão ("Mapa 1", com as camadas padrão): o atlas não nasce mais vazio. Este
 * ajudante continuava criando os mapas pedidos POR CIMA daquele, então quem pedisse um mapa
 * recebia um atlas com DOIS, e o caso do link profundo sem `&map=` passou a medir qual dos dois
 * a abertura escolhe — uma pergunta que ele não faz e cuja resposta ele não conhece.
 *
 * A CORREÇÃO É ADOTAR O MAPA PADRÃO como o PRIMEIRO nome pedido (uma op de renomeação), em vez
 * de deixá-lo ao lado. O atlas volta a ter exatamente os mapas que esta função nomeia, e a
 * ordem do atlas (`map_order`, que o servidor preenche na criação) começa por ele.
 */
async function seedUserAtlas(page, baseUrl, maps) {
    const user = await createVerifiedUser({ prefix: 'url', nome: 'URL Tester' });
    return page.evaluate(async ({ base, mapNames, u }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(u.username, u.password);
        const atlas = await api.createAtlas({ name: 'URL Atlas' });
        // O mapa que o servidor semeou, pelo `map_order` que ele devolve na criação.
        const [defaultMapId] = Array.isArray(atlas?.map_order) ? atlas.map_order : [];
        const ops = [];
        const mapIds = {};
        mapNames.forEach((name, index) => {
            const adota = index === 0 && Boolean(defaultMapId);
            const id = adota ? defaultMapId : crypto.randomUUID();
            mapIds[name] = id;
            ops.push(createOperation('map', adota ? 'update' : 'create', id, null, { name }));
        });
        await api.pushOperations(atlas.id, ops);
        return { username: u.username, password: u.password, atlasId: atlas.id, mapIds };
    }, { base: baseUrl, mapNames: maps, u: user });
}

describeOrSkip('Atlas deep link (?atlas=&map=)', () => {
    test('logged in: opens the atlas and lands on the requested map; URL reflects it', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Mapa Um', 'Mapa Dois']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await loginUI(page, seed.username, seed.password); // token persisted; picker visible

        // Deep link straight to the SECOND map — the requested map must win over the first/last.
        await page.goto(`/?atlas=${seed.atlasId}&map=${seed.mapIds['Mapa Dois']}`);
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 25000 });
        await expect.poll(() => currentMapName(page), { timeout: 15000 }).toBe('Mapa Dois');

        const url = new URL(page.url());
        expect(url.searchParams.get('atlas')).toBe(seed.atlasId);
        expect(url.searchParams.get('map')).toBe(seed.mapIds['Mapa Dois']);
    });

    test('logged in WITH unsaved local work: the deep link opens the atlas and PRESERVES the local work', async ({ page }) => {
        test.setTimeout(180000);
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Servidor']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await loginUI(page, seed.username, seed.password);
        await goToLocalMapUI(page); // logged in, local store

        // Create unsaved local work, then hit the deep link via a reload.
        const pontoId = await drawPointUI(page, [-43.2, -22.9]);
        expect(await readFeatures(page, 'points')).toHaveLength(1);
        await page.goto(`/?atlas=${seed.atlasId}`);

        // Este caso pedia um diálogo de três botões (cancelar / salvar / descartar) antes de o deep
        // link "substituir" o trabalho local. Ele foi REMOVIDO em 2026-08-16 junto com a ameaça que
        // enunciava: desde o namespace por atlas, `activateRemoteAtlas` monta `remote-<atlasId>`
        // ANTES do `clearAllDataStore`, então o wipe esvazia o atlas que está sendo ABERTO e o slot
        // local guarda todos os bytes. Os três `data-testid` de escolha não existem mais em `src/`,
        // então as asserções antigas eram impassáveis.
        //
        // A propriedade que valia a pena continua a mesma, e é ela que ficou: entrar por deep link
        // com trabalho local não salvo NÃO destrói esse trabalho. O irmão
        // `abrir-servidor-preserva-local.spec.js` afirma isto para a entrada pelo menu da conta; a
        // entrada por URL é outro caminho de boot (`openAtlasFromUrl`), e é por isso que este caso
        // segue ganhando o seu lugar em vez de ser apagado.
        await expect(page.locator('.modal-container', { hasText: 'trabalho local não salvo' }))
            .toHaveCount(0);
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 30000 });

        // Premissa: o atlas do servidor abriu VAZIO. Sem ela o ponto encontrado no fim poderia ser
        // o do próprio atlas remoto, e o caso passaria medindo a coisa errada.
        expect(await readFeatures(page, 'points')).toHaveLength(0);

        // O ponto continua no atlas local, alcançável pelo caminho do usuário.
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-item"]').first())
            .toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-item"]').first().click();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });

        const local = await readFeatures(page, 'points');
        expect(local).toHaveLength(1);
        expect(local[0].id).toBe(pontoId);
    });

    test('logged out: prompts login, then resumes straight to the atlas', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Mapa Único']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });

        // Anonymous boot WITH the deep link → the boot remembers it and opens the login modal.
        await page.goto(`/?atlas=${seed.atlasId}`);
        await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 20000 });

        await page.locator('[data-testid="login-username"]').fill(seed.username);
        await page.locator('[data-testid="login-password"]').fill(seed.password);
        await page.locator('[data-testid="login-submit"]').click();

        // Resumes to the atlas itself — NOT the project picker.
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 25000 });
        await expect.poll(() => currentMapName(page), { timeout: 15000 }).toBe('Mapa Único');
        await expect(page.locator('[data-testid="project-picker-modal"]')).toHaveCount(0);
    });
});
