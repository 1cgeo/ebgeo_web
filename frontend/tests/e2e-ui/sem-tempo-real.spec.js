// Path: e2e-ui/sem-tempo-real.spec.js

/**
 * WITHOUT REAL TIME: a proxy refuses the collab WebSocket upgrade and plain HTTP works. The server
 * atlas opens, the person edits, the edits reach the server and the colleague, the colleague's
 * edits reach the person a few seconds later, an F5 opens it again, and when the socket comes back
 * the normal mode returns by itself (owner's decision, 2026-09-24; the rules live in
 * `src/js/store/sync/sem-tempo-real.js`).
 *
 * UNTIL THAT DATE THIS SPEC ASSERTED THE OPPOSITE, and it was right about the product it measured:
 * `abertura-sem-tempo-real.repro.spec.js` blocked the socket the same way and required the tab to
 * go back to the chooser with the sentence "o servidor respondeu, mas a conexão em tempo real não
 * abriu". That was the honest message for an atlas that could not open without the socket. It is
 * replaced by this file, because opening without the socket is now the behaviour.
 *
 * THE REFUSAL IS AT THE WEBSOCKET LAYER: every collab socket of B is closed by the route before the
 * server sees it, which is what a proxy that drops the upgrade does. HTTP is untouched. Unblocking
 * lets the route forward the socket to the server, so B's own backoff (up to 30 s) finds it.
 */

import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

const badge = (page) => page.locator('[data-testid="sync-status-badge"]');

/** Waits until the feature `id` is in the page's current map. */
async function esperarFeicao(page, id, timeout) {
    await expect.poll(async () => (await readFeatures(page, 'points')).some((f) => f.id === id), { timeout, intervals: [250] })
        .toBe(true);
}

/** Whether the server holds the feature `id`, read straight from the database. */
async function noServidor(db, id) {
    const linha = await db.queryFeatureRow(id);
    return Boolean(linha) && linha.deleted_at == null;
}

collabTest('WebSocket bloqueado: o atlas abre, sincroniza por HTTP e volta ao tempo real sozinho', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const estado = { bloqueado: true, recusados: 0, repassados: 0 };

    await B.routeWebSocket(/\/api\/v1\/collab/, (ws) => {
        if (estado.bloqueado) {
            estado.recusados++;
            ws.close({ code: 1008, reason: 'blocked by proxy' });
            return;
        }
        estado.repassados++;
        const server = ws.connectToServer();
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => ws.send(m));
        ws.onClose((code, reason) => server.close({ code, reason }));
        server.onClose((code, reason) => ws.close({ code, reason }));
    });

    // 1. ABRIR: an F5 on the atlas, whose socket is now refused.
    await B.reload();
    await expect(badge(B)).toHaveAttribute('data-state', 'sem-tempo-real', { timeout: 60000 });
    expect(B.url()).not.toMatch(/atlas\.html/);
    await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 30000 }).toBe(true);
    expect(estado.recusados).toBeGreaterThan(0);
    const rotulo = (await badge(B).innerText()).trim();
    console.log(`SEM_TEMPO_REAL badge=${JSON.stringify(rotulo)} recusados=${estado.recusados}`);
    expect(rotulo).toContain('Sem tempo real');

    // 2. EDITAR: B draws, and the point reaches the server (HTTP push) and A (A's socket).
    const deB = await drawPointUI(B, [-43.2, -22.9]);
    await expect.poll(() => noServidor(collab.db, deB), { timeout: 30000 }).toBe(true);
    await esperarFeicao(A, deB, 30000);

    // 3. RECEBER: A draws, and the point reaches B by the periodic pull, within seconds.
    const t0 = Date.now();
    const deA = await drawPointUI(A, [-43.21, -22.91]);
    await esperarFeicao(B, deA, 30000);
    const atrasoDoPull = Date.now() - t0;
    console.log(`SEM_TEMPO_REAL atraso da edicao do colega por pull: ${atrasoDoPull} ms`);
    expect(atrasoDoPull).toBeLessThan(20000);
    await expect(badge(B)).toHaveAttribute('data-state', 'sem-tempo-real');

    // 4. F5: still blocked, the atlas opens again with both points.
    await B.reload();
    await expect(badge(B)).toHaveAttribute('data-state', 'sem-tempo-real', { timeout: 60000 });
    await esperarFeicao(B, deA, 30000);
    await esperarFeicao(B, deB, 30000);

    // 5. O WS VOLTA: B's own backoff finds the socket, with no gesture.
    estado.bloqueado = false;
    const tVolta = Date.now();
    await expect(badge(B)).toHaveAttribute('data-state', 'online', { timeout: 60000 });
    console.log(`SEM_TEMPO_REAL tempo real de volta em ${Date.now() - tVolta} ms (repassados=${estado.repassados})`);

    // And the next edit of A arrives live, not by the pull.
    const t1 = Date.now();
    const aoVivo = await drawPointUI(A, [-43.22, -22.92]);
    await esperarFeicao(B, aoVivo, 15000);
    console.log(`SEM_TEMPO_REAL atraso ao vivo: ${Date.now() - t1} ms`);
    expect(Date.now() - t1).toBeLessThan(10000);
});
