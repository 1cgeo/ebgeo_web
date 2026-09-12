// Path: tests/e2e-ui/browser-confirm-logout.spec.js
// Opt-in audit: real browser storage and backend; pending writes are blocked only at HTTP push.
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, loginUI, openAtlasUI, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeAll(() => expect(state.skip, 'backend de teste obrigatório').toBe(false));
test.describe.configure({ retries: 0, timeout: 90000 });

async function activeScope(page) {
    return page.evaluate(async () => (await import('/src/js/store/atlas-namespace.js')).getActiveScope());
}

async function stored(page, scope) {
    return page.evaluate(async scope => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const data = {};
        const names = new Set((await indexedDB.databases()).map(db => db.name));
        for (const id of [ns.StoreName.MAPS, ns.StoreName.IMAGES, ns.StoreName.OPERATION_QUEUE]) {
            const records = {};
            const name = ns.resolveDbName(id, scope);
            if (names.has(name)) {
                const db = await new Promise((resolve, reject) => {
                    const open = indexedDB.open(name);
                    open.onupgradeneeded = () => open.transaction.abort();
                    open.onsuccess = () => resolve(open.result);
                    open.onerror = () => open.error?.name === 'AbortError' ? resolve(null) : reject(open.error);
                });
                if (!db) { data[id] = records; continue; }
                try {
                    const storeName = id === ns.StoreName.OPERATION_QUEUE ? 'operation_queue' : 'keyvaluepairs';
                    const rows = await new Promise((resolve, reject) => {
                        const rows = [];
                        if (!db.objectStoreNames.contains(storeName)) { resolve(rows); return; }
                        const tx = db.transaction(storeName, 'readonly');
                        const cursor = tx.objectStore(storeName).openCursor();
                        cursor.onsuccess = () => { const c = cursor.result; if (c) { rows.push([c.key, c.value]); c.continue(); } };
                        tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error);
                    });
                    for (const [key, value] of rows) {
                        records[key] = value instanceof Blob ? { type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] } : value;
                    }
                } finally { db.close(); }
            }
            data[id] = records;
        }
        return data;
    }, scope);
}

function featureIds(data) {
    return Object.values(data.maps).flatMap(map => Object.values(map.features || {}).flatMap(list =>
        Array.isArray(list) ? list.map(feature => feature.properties.id) : [])).sort();
}

async function imageSentinel(page, value) {
    await page.evaluate(async value => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        await ns.getStore(ns.StoreName.IMAGES).setItem('same-key-isolation-proof', new Blob([value], { type: 'text/plain' }));
    }, value);
}

async function switchLocal(page, atlasId) {
    const result = await page.evaluate(async atlasId => {
        const { switchAtlas } = await import('/src/js/account/open-atlas.service.js');
        return switchAtlas({ kind: 'local', atlasId });
    }, atlasId);
    expect(result.ok).toBe(true);
}

async function pendingPoint(page) {
    await page.route('**/api/v1/atlas/*/sync', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
    const id = await drawPointUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    await expect.poll(async () => page.evaluate(async () =>
        (await import('/src/js/session/unsynced-work-exit.js')).countPendingOperations())).toBeGreaterThan(0);
    return id;
}

async function prepare(browser) {
    const state = readState();
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(base => { window.__EBGEO_BACKEND_URL__ = base + '/api/v1'; }, state.baseUrl);
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded(), null, { timeout: 30000 });
    const localPoint = await drawPointUI(page, [-43.3, -22.8]);
    await page.keyboard.press('Escape');
    await imageSentinel(page, 'LOCAL ORIGINAL');
    const local = await activeScope(page);
    const before = await stored(page, local);
    await loginUI(page, seed.userA.username, seed.userA.password);
    await openAtlasUI(page, seed.atlasId);
    console.info('SAFETY prepared local and remote');
    expect(featureIds(await stored(page, local))).toContain(localPoint);
    expect((await stored(page, local)).images).toEqual(before.images);
    return { page, context, seed, state, local, before, localPoint, remote: await activeScope(page) };
}

async function askLogout(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.getByTestId('account-logout-btn').click();
    await expect(page.getByRole('alertdialog')).toContainText('Sair com alterações pendentes?');
}

for (const fromLocal of [false, true]) {
    test(`cancelar e confirmar descarte, atlas ${fromLocal ? 'local' : 'remoto'} montado`, async ({ browser }, testInfo) => {
        const c = await prepare(browser);
        try {
            const { page, remote, local, before, seed, state } = c;
            const point = await pendingPoint(page);
            const pending = await stored(page, remote);
            if (fromLocal) await switchLocal(page, local.atlasId);
            await askLogout(page);
            await page.screenshot({ path: testInfo.outputPath('confirmacao-pendencias.png') });
            await page.getByRole('button', { name: 'Continuar no EBGeo', exact: true }).click();
            expect(await stored(page, remote)).toEqual(pending);
            await expect(page.getByTestId('account-login-btn')).toBeHidden();
            await askLogout(page);
            await page.getByRole('button', { name: 'Sair e descartar pendências', exact: true }).click();
            await expect(page.getByTestId('account-login-btn')).toBeVisible({ timeout: 30000 });
            const discarded = await stored(page, remote);
            expect(featureIds(discarded)).not.toContain(point);
            expect(discarded.operationQueue).toEqual({});
            const localAfter = await stored(page, local);
            expect(featureIds(localAfter)).toEqual(featureIds(before));
            expect(localAfter.images).toEqual(before.images);
            const server = await page.evaluate(async ({ base, user, atlasId }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const client = new ApiClient({ baseUrl: base + '/api/v1' });
                await client.login(user.username, user.password);
                return client.pullSync(atlasId, 0);
            }, { base: state.baseUrl, user: seed.userA, atlasId: seed.atlasId });
            expect(JSON.stringify(server)).not.toContain(point);
            await page.unroute('**/api/v1/atlas/*/sync');
            await loginUI(page, seed.userA.username, seed.userA.password);
            await openAtlasUI(page, seed.atlasId);
            expect(featureIds(await stored(page, remote))).not.toContain(point);
            const reopened = await page.evaluate(async atlasId =>
                (await import('/src/js/store/sync/api-client.js')).apiClient.pullSync(atlasId, 0), seed.atlasId);
            expect(JSON.stringify(reopened)).not.toContain(point);
        } finally { await c.context.close(); }
    });
}

test('sair da lista de atlas confirma e descarta a pendência de outra aba', async ({ browser }) => {
    const c = await prepare(browser);
    try {
        const point = await pendingPoint(c.page);
        const chooser = await c.context.newPage();
        await chooser.addInitScript(base => { window.__EBGEO_BACKEND_URL__ = base + '/api/v1'; }, c.state.baseUrl);
        await chooser.goto('/atlas.html');
        await chooser.getByTestId('app-bar-logout').click();
        await expect(chooser.getByRole('alertdialog')).toContainText('Sair com alterações pendentes?');
        await chooser.getByRole('button', { name: 'Continuar no EBGeo', exact: true }).click();
        expect(featureIds(await stored(c.page, c.remote))).toContain(point);
        await chooser.getByTestId('app-bar-logout').click();
        await chooser.getByRole('button', { name: 'Sair e descartar pendências', exact: true }).click();
        await expect(chooser.getByTestId('account-login-btn')).toBeVisible({ timeout: 30000 });
        const discarded = await stored(chooser, c.remote);
        expect(featureIds(discarded)).not.toContain(point);
        expect(discarded.operationQueue).toEqual({});
        expect(featureIds(await stored(chooser, c.local))).toContain(c.localPoint);
    } finally { await c.context.close(); }
});
