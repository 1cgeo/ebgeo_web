// Path: e2e-ui/cauda-longa-em-link-lento.repro.spec.js

/**
 * REPRO: a peer on a slow DOWNLINK that reconnects behind a tail above the cap must converge,
 * and not loop on an uncompressed snapshot frame.
 *
 * The incremental pull answers a tail above `PULL_TAIL_MAX_OPS` (500) with the snapshot. Over
 * the SOCKET that snapshot is one uncompressed frame of the whole atlas (the collaboration
 * `WebSocketServer` runs without `perMessageDeflate`), and the client asks for its tail over the
 * socket on every reconnect. On a slow downlink the frame outlives the heartbeat: the socket is
 * cut mid-frame, the reconnect asks from the SAME cursor and is queued the SAME frame, forever.
 * Since the fix the socket answers a tail over the cap with the small frame the client already
 * reads as "re-pull the atlas over HTTP" (`atlas_updated`), and the snapshot comes compressed
 * over HTTP, which this spec does not throttle.
 *
 * The downlink is simulated at the WebSocket layer (`routeWebSocket`), as in the network front's
 * `ws-quadro-grande-em-link-lento.repro.spec.js`: server-to-client frames are delivered IN ORDER
 * at 5000 bytes per second (40 kbps). The drop is simulated by the same route: B's socket is
 * closed and new ones are refused while A writes, and then let through the slow downlink.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(420000);

/** 40 kbps, in bytes per second. */
const DOWNLINK_BYTES_PER_S = 5000;
/** Above `PULL_TAIL_MAX_OPS` (500). */
const FEICOES = 600;

function trilha(vertices, semente) {
    const coords = [];
    for (let i = 0; i < vertices; i++) {
        coords.push([-43.2 + semente * 0.001 + i * 0.0000123456789, -22.9 + Math.sin((i + semente) / 50) * 0.0123456789]);
    }
    return coords;
}

/**
 * Routes every NEW collab socket of `page`: refused while `log.fora` is set, otherwise through a
 * downlink of `bytesPerS`.
 */
async function rotaControlada(page, bytesPerS, t0) {
    const log = { sockets: 0, recusados: 0, frames: [], closes: [], fora: false, atual: null };
    await page.routeWebSocket(/\/api\/v1\/collab/, (ws) => {
        if (log.fora) {
            log.recusados++;
            ws.close({ code: 1013, reason: 'fora do ar' });
            return;
        }
        log.sockets++;
        log.atual = ws;
        const server = ws.connectToServer();
        let chain = Promise.resolve();
        let busyUntil = 0;
        let open = true;
        ws.onMessage((m) => server.send(m));
        ws.onClose((code, reason) => {
            open = false;
            log.closes.push({ at: Date.now() - t0, by: 'page', code, reason });
            ws.close({ code, reason });
            server.close({ code, reason });
        });
        server.onMessage((m) => {
            const bytes = typeof m === 'string' ? new TextEncoder().encode(m).byteLength : m.length;
            busyUntil = Math.max(busyUntil, Date.now()) + (bytes / bytesPerS) * 1000;
            const due = busyUntil;
            let type = '?';
            try { type = JSON.parse(m).type; } catch { /* binary */ }
            chain = chain.then(async () => {
                await delay(Math.max(0, due - Date.now()));
                if (!open) return;
                log.frames.push({ at: Date.now() - t0, bytes, type });
                try { ws.send(m); } catch { /* page side closed */ }
            });
        });
        server.onClose((code, reason) => {
            chain = chain.then(() => {
                if (!open) return;
                open = false;
                log.closes.push({ at: Date.now() - t0, by: 'server', code, reason });
                ws.close({ code, reason });
            });
        });
    });
    return log;
}

collabTest('par que reconecta em link de 40 kbps atrás de uma cauda acima do teto converge sem laço', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const t0 = Date.now();
    const log = await rotaControlada(B, DOWNLINK_BYTES_PER_S, t0);

    // The route patches the page's WebSocket at document start: B reloads behind it.
    await B.reload();
    await expect.poll(() => log.sockets, { timeout: 30000 }).toBe(1);
    await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 60000 }).toBe(true);

    // B CAI: o socket fecha e os novos sao recusados enquanto A escreve.
    log.fora = true;
    await log.atual.close({ code: 4000, reason: 'queda' });

    // A escreve 600 feicoes. Direto pelo cliente HTTP do app, em pushes de 50 ops avulsas: o que
    // este spec mede e a volta de B, e o caminho da loja de A (lotes de 150 feicoes pesadas) so
    // acrescentaria minutos de envio sob carga sem mudar o que chega a B.
    const ids = [];
    const feicoes = [];
    for (let k = 0; k < FEICOES; k++) {
        const id = crypto.randomUUID();
        ids.push(id);
        const f = realFeature('line', { id, nome: `Trilha ${k}` });
        f.geometry.coordinates = trilha(150, k);
        feicoes.push(f);
    }
    await A.evaluate(async (lista) => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
        const store = await import('/src/js/store/index.js');
        const atlasId = syncEngine.atlasId;
        const mapId = store.getCurrentMapIdSync();
        for (let i = 0; i < lista.length; i += 50) {
            const ops = lista.slice(i, i + 50).map((f) => ({
                protocolVersion: 2, id: crypto.randomUUID(), entityType: 'feature', operationType: 'create',
                entityId: f.properties.id, mapId, timestamp: Date.now(), clientId: 'autor-do-spec', data: f,
            }));
            await apiClient.pushOperations(atlasId, ops);
        }
    }, feicoes);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(ids.at(-1))), { timeout: 60000 }).toBe(true);
    await expect.poll(async () => Boolean(await collab.db.queryFeatureRow(ids[0])), { timeout: 30000 }).toBe(true);

    // B VOLTA, pelo enlace lento.
    const socketsAntes = log.sockets;
    log.fora = false;

    const noB = async () => {
        const presentes = new Set((await readFeatures(B, 'lines')).map((f) => f.id));
        return ids.filter((id) => presentes.has(id)).length;
    };
    try {
        await expect.poll(noB, { timeout: 150000, intervals: [3000] }).toBe(ids.length);
    } finally {
        const grandes = log.frames.filter((f) => f.bytes > 50000);
        console.log(`CAUDA_LONGA sockets=${log.sockets} recusados=${log.recusados} socketsDepois=${log.sockets - socketsAntes} `
            + `quadrosGrandes=${JSON.stringify(grandes)} closes=${JSON.stringify(log.closes)} `
            + `tipos=${JSON.stringify([...new Set(log.frames.map((f) => f.type))])}`);
    }
    expect(log.sockets - socketsAntes, 'converged without a reconnection loop').toBeLessThanOrEqual(3);
    expect(log.frames.some((f) => f.type === 'sync_response' && f.bytes > 50000),
        'no snapshot frame crossed the socket').toBe(false);
});
