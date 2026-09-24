// Path: e2e-ui/lote-acima-do-teto-do-servidor.repro.spec.js

/**
 * REPRO: a batch above the server's body ceiling (10 MB, `backend/src/app.js`) held the whole
 * outbound queue forever, behind a message that blamed the connection.
 *
 * The server answers such a push with 413. `sync-engine.js` treated 400 and 422 as permanent
 * refusals (isolate, then keep the indivisible piece as a durable issue so the queue moves on),
 * and 413 fell into the generic branch: the queue re-sent the same head batch on every flush, the
 * edits made afterwards never left the machine, and after three failures the toast said the
 * changes would be sent "quando a conexão voltar", which never happens for a body that does not
 * fit. A large import is the natural way to produce one: the gesture batch goes whole.
 *
 * Real backend, real limit, no interception.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(180000);

function hugeTrack(vertices) {
    const coords = [];
    for (let i = 0; i < vertices; i++) coords.push([-43.2 + i * 0.00000123456789, -22.9 + (i % 97) * 0.000123456789]);
    return coords;
}

collabTest('um lote acima de 10 MB não segura as edições seguintes', async ({ collab }) => {
    const B = collab.peers[0];
    const syncUrl = `${collab.baseUrl}/api/v1/atlas/${collab.atlasId}/sync`;
    const pushes = [];
    B.on('response', (res) => {
        if (res.request().method() === 'POST' && res.url() === syncUrl) {
            pushes.push({ status: res.status(), bytes: res.request().postDataBuffer()?.byteLength ?? 0 });
        }
    });

    const bigId = crypto.randomUUID();
    const big = realFeature('line', { id: bigId, nome: 'Importação enorme' });
    big.geometry.coordinates = hugeTrack(330000);
    await B.evaluate(async (feature) => {
        const store = await import('/src/js/store/index.js');
        await store.addFeature('lines', feature);
    }, big);
    await expect.poll(() => pushes.some((p) => p.status === 413), { timeout: 30000 }).toBe(true);

    const smallId = crypto.randomUUID();
    await B.evaluate(async (feature) => {
        const store = await import('/src/js/store/index.js');
        await store.addFeature('lines', feature);
    }, realFeature('line', { id: smallId, nome: 'Depois' }));

    try {
        await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(smallId)), { timeout: 60000, intervals: [2000] }).toBe(true);
    } finally {
        console.log(`LOTE_ACIMA_DO_TETO pushes=${JSON.stringify(pushes.slice(0, 12))} total=${pushes.length}`);
    }
    // The large one did not reach the server, and it is not lost: it is a durable issue the
    // pendências panel names.
    expect(await collab.db.queryFeatureRow(bigId)).toBeNull();
    const issues = await B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.getIssues()).map((i) => ({ entityId: i.operation?.entityId, reason: i.result?.reason }));
    });
    expect(issues.map((i) => i.entityId)).toContain(bigId);
});
