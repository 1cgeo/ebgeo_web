// Path: e2e-ui/abertura-sem-tempo-real.repro.spec.js

/**
 * REPRO: when a proxy refuses the collab WebSocket upgrade and plain HTTP works, opening a server
 * atlas fails on every attempt, and the screen blamed the person's connection.
 *
 * Measured on 2026-09-23: the open pipeline pulls the snapshot over HTTP, then `connect` waits for
 * the socket's `connected` frame; the upgrade is refused, the handshake promise rejects
 * ("Conexão encerrada antes do handshake"), `openAtlasFromUrl` (`index.js`) sends the tab back to
 * `atlas.html?aviso=abertura-falhou`, and the chooser said "Não foi possível abrir o atlas.
 * Verifique sua conexão e tente de novo." on a page whose server list had just loaded fine. Trying
 * again repeats the round trip, forever. The code does know more than that: the server answered
 * over HTTP and only the live connection did not open, which is true for every way this happens
 * (a proxy, a firewall, an upgrade refused for the account), and what the person can do about it
 * is tell whoever runs the network.
 *
 * The refusal is simulated at the WebSocket layer: every collab socket of B is closed by the route
 * before the server ever sees it.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

collabTest('upgrade do WebSocket recusado: a abertura diz que o tempo real não abriu', async ({ collab }) => {
    const B = collab.peers[0];
    let sockets = 0;
    await B.routeWebSocket(/\/api\/v1\/collab/, (ws) => {
        sockets++;
        ws.close({ code: 1008, reason: 'blocked by proxy' });
    });
    // An F5 on the atlas: the socket of the new document is refused.
    await B.reload();
    await B.waitForURL(/\/atlas\.html/, { timeout: 60000 });
    expect(sockets).toBeGreaterThan(0);

    const toast = B.locator('.toast', { hasText: 'Não foi possível abrir o atlas' });
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
        .toBeGreaterThan(0.9);
    const texto = (await toast.innerText()).trim();
    console.log(`ABERTURA_SEM_TEMPO_REAL toast=${JSON.stringify(texto)} sockets=${sockets}`);
    expect(texto).toContain('conexão em tempo real');
    expect(texto).not.toContain('Verifique sua conexão');
});
