// Real Chromium, IndexedDB, HTTP and WebSocket. Delays/failures are injected at
// individual boundaries; assertions read each atlas independently by its scope.
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { realPointFeature } from '../helpers/real-fixtures.js';

test.describe.configure({ retries: 0, timeout: 90000 });

async function setup(page) {
    const state = readState();
    expect(state.skip).toBeFalsy();
    const user = await createVerifiedUser({ prefix: 'switch', nome: 'Atlas Switch Audit' });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.__ebgeoSwitchAtlas === 'function' && window.__ebgeoMap?.loaded());
    await page.locator('.loading-background').waitFor({ state: 'hidden' });
    return page.evaluate(async ({ username, password, feature }) => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const store = await import('/src/js/store/index.js');
        const local = await import('/src/js/store/local-atlas.api.js');
        const service = await import('/src/js/account/open-atlas.service.js');
        const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const a = ns.getActiveScope();
        const put = async label => {
            const value = structuredClone(feature);
            value.properties.nome = label;
            await store.addFeature('points', value);
            await ns.getStore(ns.StoreName.IMAGES).setItem('same-image', new Blob([label]));
        };
        await put('LOCAL A');
        const created = await local.createLocalAtlas('Local B auditoria');
        if (!created.ok) throw new Error(created.message);
        await service.switchAtlas({ kind: 'local', atlasId: created.atlas.id });
        const b = ns.getActiveScope();
        await put('LOCAL B');
        await service.switchAtlas({ kind: 'local', atlasId: a.atlasId });
        await syncEngine.login({ username, password });
        const remote = await apiClient.createAtlas({ name: 'Remoto auditoria de troca' });
        window.audit = { ns, store, service, syncEngine, apiClient, a, b, remote };
        return { a, b, remote, featureId: feature.properties.id };
    }, { username: user.username, password: user.password, feature: realPointFeature() });
}

async function originals(page) {
    return page.evaluate(async () => {
        const { ns, a, b } = window.audit;
        const result = [];
        for (const scope of [a, b]) {
            const maps = [];
            await ns.getStoreFor(ns.StoreName.MAPS, scope).iterate(map => { maps.push(map); });
            result.push({ names: maps.flatMap(map => (map.features?.points || []).map(f => f.properties.nome)),
                image: await (await ns.getStoreFor(ns.StoreName.IMAGES, scope).getItem('same-image')).text() });
        }
        return result;
    });
}

test('local/local: queued switch back is not lost during rendering; identical IDs remain isolated', async ({ page }) => {
    const seeded = await setup(page);
    const result = await page.evaluate(async () => {
        const { store, service, ns, a, b } = window.audit;
        const control = store.getControl('BaseLayerControl');
        const original = control.switchMap.bind(control);
        let entered;
        let release;
        const waiting = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        let first = true;
        control.switchMap = async (...args) => {
            await original(...args);
            if (first) { first = false; entered(); await gate; }
        };
        try {
            const toB = service.switchAtlas({ kind: 'local', atlasId: b.atlasId });
            await waiting;
            let secondDone = false;
            const toA = service.switchAtlas({ kind: 'local', atlasId: a.atlasId }).then(value => { secondDone = true; return value; });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const during = { id: ns.getActiveScope().atlasId, secondDone };
            release();
            const results = await Promise.all([toB, toA]);
            return { during, results, final: ns.getActiveScope().atlasId };
        } finally { control.switchMap = original; release(); }
    });
    expect(result.during).toEqual({ id: seeded.b.atlasId, secondDone: false });
    expect(result.results.every(r => r.ok && r.changed)).toBe(true);
    expect(result.final).toBe(seeded.a.atlasId);
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
});

test('remote/local/remote: pending edit stays in its queue and reaches only its original server atlas', async ({ page }) => {
    const seeded = await setup(page);
    await page.evaluate(async () => window.audit.service.switchAtlas({ kind: 'remote', atlasId: window.audit.remote.id }));
    await page.route('**/atlas/*/sync', route => route.request().method() === 'POST' ? route.abort('connectionfailed') : route.continue());
    const feature = realPointFeature({ nome: 'EDICAO PENDENTE REMOTA' });
    await page.evaluate(async feature => { await window.audit.store.addFeature('points', feature); }, feature);
    const pending = await page.evaluate(async () => {
        const { service, ns, a, remote } = window.audit;
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        await service.switchAtlas({ kind: 'local', atlasId: a.atlasId });
        return operationQueue.forScope(ns.remoteScope(remote.id)).getAll();
    });
    expect(JSON.stringify(pending)).toContain(feature.properties.id);
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
    // A failed reopening must keep both the local atlases and the remote outbox recoverable.
    const pullRoute = `**/atlas/${seeded.remote.id}/sync/*`;
    await page.route(pullRoute, route => route.abort('connectionfailed'));
    const failed = await page.evaluate(async () => {
        const { service, remote, ns } = window.audit;
        let rejected = false;
        try {
            await service.switchAtlas({ kind: 'remote', atlasId: remote.id });
        } catch {
            rejected = true;
        }
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return { rejected, scope: ns.getActiveScope().kind, queue: await operationQueue.forScope(ns.remoteScope(remote.id)).getAll() };
    });
    expect(failed.rejected).toBe(true);
    expect(failed.scope).toBe('remote');
    expect(JSON.stringify(failed.queue)).toContain(feature.properties.id);
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
    await page.unroute(pullRoute);
    await page.unroute('**/atlas/*/sync');
    await page.evaluate(async () => window.audit.service.switchAtlas({ kind: 'remote', atlasId: window.audit.remote.id }));
    await expect.poll(async () => page.evaluate(async () => {
        const { apiClient, remote } = window.audit;
        return JSON.stringify(await apiClient.pullSync(remote.id, 0));
    }), { timeout: 30000 }).toContain(feature.properties.id);
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
    expect(seeded.remote.id).toBeTruthy();
});

test('local/remote/local: slow initial pull cannot finish over a later local destination', async ({ page }) => {
    const seeded = await setup(page);
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { entered = resolve; });
    await page.route(`**/atlas/${seeded.remote.id}/sync/*`, async route => { entered(); await gate; await route.continue(); });
    const opening = page.evaluate(async () => window.audit.service.switchAtlas({ kind: 'remote', atlasId: window.audit.remote.id }));
    await waiting;
    await page.evaluate(() => {
        window.audit.localDone = false;
        window.audit.returning = window.audit.service.switchAtlas({ kind: 'local', atlasId: window.audit.b.atlasId })
            .then(value => { window.audit.localDone = true; return value; });
    });
    expect(await page.evaluate(() => window.audit.localDone)).toBe(false);
    release();
    expect((await opening).ok).toBe(true);
    expect((await page.evaluate(async () => window.audit.returning)).ok).toBe(true);
    expect(await page.evaluate(() => ({ id: window.audit.ns.getActiveScope().atlasId, engine: window.audit.syncEngine.atlasId })))
        .toEqual({ id: seeded.b.atlasId, engine: null });
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
});

test('local/local: a refused IndexedDB pointer write preserves both atlases and allows a retry', async ({ page }) => {
    const seeded = await setup(page);
    const result = await page.evaluate(async () => {
        const { ns, service, b } = window.audit;
        const global = ns.getGlobalStore();
        const original = global.setItem.bind(global);
        global.setItem = (key, value) => key === ns.GlobalKey.CURRENT_LOCAL_ATLAS
            ? Promise.reject(new DOMException('Quota de teste', 'QuotaExceededError')) : original(key, value);
        let error;
        try {
            await service.switchAtlas({ kind: 'local', atlasId: b.atlasId });
        } catch (caught) {
            error = caught.name;
        } finally {
            global.setItem = original;
        }
        const stayed = ns.getActiveScope().atlasId;
        const retried = await service.switchAtlas({ kind: 'local', atlasId: b.atlasId });
        return { error, stayed, retried };
    });
    expect(result.error).toBe('QuotaExceededError');
    expect(result.stayed).toBe(seeded.a.atlasId);
    expect(result.retried.ok).toBe(true);
    expect(await originals(page)).toEqual([{ names: ['LOCAL A'], image: 'LOCAL A' }, { names: ['LOCAL B'], image: 'LOCAL B' }]);
});
