// Path: tests/e2e-ui/atlas-data-safety.scenario.js
// Opt-in audit: real browser storage and backend; pending writes are blocked only at HTTP push.
import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';
import { seedSharedAtlas, loginUI, openAtlasUI, drawPointUI } from './helpers/collab-helpers.js';

test.beforeAll(() => expect(readState().skip, 'backend de teste obrigatório').toBe(false));

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

async function logout(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.getByTestId('account-logout-btn').click();
    const confirm = page.getByRole('button', { name: 'Sair e descartar pendências', exact: true });
    await expect(page.getByTestId('account-login-btn').or(confirm).filter({ visible: true })).toBeVisible({ timeout: 30000 });
    if (await confirm.isVisible()) await confirm.click();
    await expect(page.getByTestId('account-login-btn')).toBeVisible({ timeout: 30000 });
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
    return { page, context, seed, local, before, localPoint, remote: await activeScope(page) };
}

test('local A e B sobrevivem à entrada remota e logout; servidor preserva ponto sincronizado', async ({ browser }, testInfo) => {
    const c = await prepare(browser);
    try {
        const { page, local, before, remote, seed } = c;
        const remotePoint = await drawPointUI(page, [-43.2, -22.9]);
        await page.keyboard.press('Escape');
        console.info('SAFETY remote point drawn');
        await expect.poll(async () => page.evaluate(async () =>
            (await import('/src/js/session/unsynced-work-exit.js')).countPendingOperations()), { timeout: 30000 }).toBe(0);
        const serverSnapshot = await page.evaluate(async id => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            return apiClient.pullSync(id, 0);
        }, seed.atlasId);
        expect(JSON.stringify(serverSnapshot)).toContain(remotePoint);
        console.info('SAFETY server received point');
        const second = await page.evaluate(async () => (await import('/src/js/store/local-atlas.api.js')).createLocalAtlas('Local B revisão'));
        expect(second.ok).toBe(true);
        await switchLocal(page, second.atlas.id);
        console.info('SAFETY local B mounted');
        const scopeB = await activeScope(page);
        const pointB = await drawPointUI(page, [-43.4, -22.7]);
        await page.keyboard.press('Escape');
        await imageSentinel(page, 'LOCAL B');
        await switchLocal(page, local.atlasId);
        console.info('SAFETY local A mounted');
        expect(featureIds(await stored(page, local))).toEqual(featureIds(before));
        await page.evaluate(async id => (await import('/src/js/account/open-atlas.service.js')).openRemoteAtlas(id), seed.atlasId);
        console.info('SAFETY remote reopened');
        await logout(page);
        expect(featureIds(await stored(page, local))).toEqual(featureIds(before));
        expect((await stored(page, local)).images).toEqual(before.images);
        expect(featureIds(await stored(page, scopeB))).toContain(pointB);
        expect((await stored(page, scopeB)).images['same-key-isolation-proof'].bytes).toEqual([...Buffer.from('LOCAL B')]);
        expect(featureIds(await stored(page, remote))).toEqual([]);
        // Independent authenticated client: logging out the UI cannot delete server entities.
        const afterServer = await page.evaluate(async ({ seed, base }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const client = new ApiClient({ baseUrl: base + '/api/v1' });
            await client.login(seed.userA.username, seed.userA.password);
            return client.pullSync(seed.atlasId, 0);
        }, { seed, base: readState().baseUrl });
        expect(JSON.stringify(afterServer)).toContain(remotePoint);
        await testInfo.attach('isolamento.json', { body: JSON.stringify({ local, scopeB, remote, localPoint: c.localPoint, pointB, remotePoint, serverPreserved: true }), contentType: 'application/json' });
    } finally { await c.context.close(); }
});

test('pendência no remoto deixado para trás é descartada após confirmar saída pelo local', async ({ browser }, testInfo) => {
    const c = await prepare(browser);
    try {
        const id = await pendingPoint(c.page);
        const pending = await stored(c.page, c.remote);
        expect(featureIds(pending)).toContain(id);
        const server = await c.page.evaluate(async atlasId =>
            (await import('/src/js/store/sync/api-client.js')).apiClient.pullSync(atlasId, 0), c.seed.atlasId);
        expect(JSON.stringify(server), 'a alteração ainda não chegou ao servidor').not.toContain(id);
        await switchLocal(c.page, c.local.atlasId);
        expect(featureIds(await stored(c.page, c.remote))).toContain(id);
        await logout(c.page);
        await expect.poll(async () => featureIds(await stored(c.page, c.remote)), { timeout: 30000 }).not.toContain(id);
        const after = await stored(c.page, c.remote);
        await testInfo.attach('pendencia-remoto-inativo.json', { body: JSON.stringify({ id, before: pending, after }), contentType: 'application/json' });
        expect(featureIds(await stored(c.page, c.local))).toEqual(featureIds(c.before));
        expect(featureIds(after), 'descarte confirmado deve alcançar o remoto inativo').not.toContain(id);
        expect(after.operationQueue).toEqual({});
    } finally { await c.context.close(); }
});

test('saída confirmada descarta pendências sem depender de criar um atlas de resgate', async ({ browser }, testInfo) => {
    const c = await prepare(browser);
    try {
        const id = await pendingPoint(c.page);
        const before = await stored(c.page, c.remote);
        await c.page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            const global = ns.getGlobalStore();
            const original = global.setItem.bind(global);
            global.setItem = (key, value) => key.startsWith('local_atlas:')
                ? Promise.reject(new DOMException('Quota de teste no registro do resgate', 'QuotaExceededError'))
                : original(key, value);
        });
        await logout(c.page);
        await expect.poll(async () => featureIds(await stored(c.page, c.remote)), { timeout: 30000 }).not.toContain(id);
        const after = await stored(c.page, c.remote);
        const veto = await c.page.evaluate(id => localStorage.getItem('ebgeo_rescue_veto:' + id), c.seed.atlasId);
        expect(veto, 'a saída voluntária não tenta resgatar').toBeNull();
        await testInfo.attach('resgate-com-quota.json', { body: JSON.stringify({ id, veto, before, after }), contentType: 'application/json' });
        expect(featureIds(await stored(c.page, c.local))).toEqual(featureIds(c.before));
        expect(featureIds(after), 'o usuário confirmou o descarte').not.toContain(id);
        expect(after.operationQueue).toEqual({});
    } finally { await c.context.close(); }
});
