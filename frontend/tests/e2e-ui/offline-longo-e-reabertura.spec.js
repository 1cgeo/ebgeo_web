// Path: e2e-ui/offline-longo-e-reabertura.spec.js

/**
 * Two ways a long absence from the network ends, with work queued, measured end to end.
 *
 *  1. THE ACCESS TOKEN EXPIRED WHILE OFFLINE. The token lives 15 minutes; a laptop closed on a
 *     patrol comes back with it long dead. Waiting 15 minutes is not a test, so the token in the
 *     client is replaced by one that is expired by its own clock AND refused by the server (same
 *     subject, `exp` in the past, a signature the server rejects): the proactive renewal
 *     (`_ensureFreshAccessToken`) and the reactive one (401, refresh, retry) are both on the path.
 *     The refresh token is the real one. Criterion: the queue drains exactly once, the socket
 *     comes back, nothing becomes a durable issue, and the session is not ended.
 *
 *  2. THE TAB WAS CLOSED OFFLINE WITH A FULL QUEUE and opened again later, back online, with the
 *     token expired meanwhile too. Criterion: the queued creates and the edit that followed them
 *     reach the server in order (the edit is on the server, over the create), exactly once, and
 *     both clients converge.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(240000);

const coords = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

/** Replaces the access token (memory and storage) by an expired one of the same subject. */
async function expireAccessToken(page) {
    return page.evaluate(async () => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const token = apiClient.getAccessToken();
        const [head, body] = token.split('.');
        const b64 = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
        const enc = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const payload = JSON.parse(b64(body));
        const now = Math.floor(Date.now() / 1000);
        const expired = `${head}.${enc({ ...payload, iat: now - 1000, exp: now - 60 })}.assinatura-invalida`;
        apiClient._accessToken = expired;
        const stored = JSON.parse(localStorage.getItem('ebgeo_auth') || '{}');
        localStorage.setItem('ebgeo_auth', JSON.stringify({ ...stored, accessToken: expired }));
        return { sub: payload.sub, hadRefresh: Boolean(stored.refreshToken) };
    });
}

async function queueState(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        const { sessionContext } = await import('/src/js/store/sync/session-context.js');
        return {
            ops: (await operationQueue.getAll()).length,
            issues: (await operationQueue.getIssues()).length,
            conexao: connectionState.getState(),
            autenticado: sessionContext.isAuthenticated(),
        };
    });
}

async function drawn(page) {
    const before = new Set((await readFeatures(page, 'lines')).map((f) => f.id));
    await drawLineUI(page, coords);
    let id;
    await expect.poll(async () => {
        id = (await readFeatures(page, 'lines')).map((f) => f.id).find((x) => !before.has(x));
        return Boolean(id);
    }).toBe(true);
    return id;
}

collabTest('token vencido durante offline longo: a fila sobe uma vez, a sessão continua', async ({ collab }) => {
    const B = collab.peers[0];
    const requests = [];
    B.on('response', (res) => {
        const u = res.url();
        if (/\/auth\/refresh$|\/sync$/.test(u) && res.request().method() === 'POST') {
            requests.push(`${u.endsWith('/refresh') ? 'refresh' : 'push'} ${res.status()}`);
        }
    });
    await B.context().setOffline(true);
    await B.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
    const ids = [await drawn(B), await drawn(B)];
    await B.evaluate(async (id) => {
        const store = await import('/src/js/store/index.js');
        await store.updateFeatureProperty('lines', id, 'lineColor', '#123456');
    }, ids[0]);
    const token = await expireAccessToken(B);
    expect(token.hadRefresh).toBe(true);
    expect((await queueState(B)).ops).toBeGreaterThanOrEqual(3);
    await delay(3000);
    await B.context().setOffline(false);

    await expect.poll(async () => (await queueState(B)).ops, { timeout: 90000 }).toBe(0);
    const final = await queueState(B);
    console.log(`OFFLINE_LONGO token requests=${JSON.stringify(requests)} final=${JSON.stringify(final)}`);
    expect(final.issues).toBe(0);
    expect(final.autenticado).toBe(true);
    await expect.poll(async () => (await queueState(B)).conexao, { timeout: 90000 }).toBe('online');
    for (const id of ids) expect(await collab.db.queryFeatureRow(id)).not.toBeNull();
    expect((await collab.db.queryFeatureRow(ids[0])).properties.lineColor).toBe('#123456');
    const dup = await collab.db.raw.any('SELECT op_id FROM operations WHERE atlas_id = $1 GROUP BY op_id HAVING COUNT(*) > 1', [collab.atlasId]);
    expect(dup).toEqual([]);
    await expect.poll(async () => (await readFeatures(collab.author, 'lines')).find((f) => f.id === ids[0])?.props?.lineColor,
        { timeout: 30000 }).toBe('#123456');
});

collabTest('aba fechada offline com fila e reaberta depois: replay na ordem, uma vez só', async ({ collab }) => {
    const B = collab.peers[0];
    const ctx = B.context();
    const url = B.url();
    await ctx.setOffline(true);
    await B.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
    const ids = [await drawn(B), await drawn(B), await drawn(B)];
    await B.evaluate(async (id) => {
        const store = await import('/src/js/store/index.js');
        await store.updateFeatureProperty('lines', id, 'lineColor', '#654321');
    }, ids[2]);
    expect((await queueState(B)).ops).toBeGreaterThanOrEqual(4);
    await expireAccessToken(B);
    await B.close();

    await delay(5000);
    await ctx.setOffline(false);
    const B2 = await ctx.newPage();
    await B2.addInitScript((u) => { window.__EBGEO_BACKEND_URL__ = u; }, `${collab.baseUrl}/api/v1`);
    await B2.addInitScript(() => { window.__EBGEO_TRACE__ = true; });
    await B2.goto(url);
    await expect.poll(async () => {
        for (const id of ids) if (!(await collab.db.queryFeatureRow(id))) return false;
        return true;
    }, { timeout: 90000, intervals: [2000] }).toBe(true);
    expect((await collab.db.queryFeatureRow(ids[2])).properties.lineColor).toBe('#654321');
    await expect.poll(async () => (await queueState(B2)).ops, { timeout: 60000 }).toBe(0);
    const final = await queueState(B2);
    console.log(`OFFLINE_LONGO reabertura final=${JSON.stringify(final)} url=${B2.url()}`);
    expect(final.issues).toBe(0);
    const dup = await collab.db.raw.any('SELECT op_id FROM operations WHERE atlas_id = $1 GROUP BY op_id HAVING COUNT(*) > 1', [collab.atlasId]);
    expect(dup).toEqual([]);
    await expect.poll(async () => (await readFeatures(collab.author, 'lines')).find((f) => f.id === ids[2])?.props?.lineColor,
        { timeout: 30000 }).toBe('#654321');
    await B2.close();
});
