// Path: e2e-ui/sem-tempo-real.spec.js

/**
 * WITHOUT REAL TIME: a proxy that does not forward the WebSocket upgrade, with plain HTTP working.
 * The server atlas opens, the person's edit reaches the server and the colleague, the colleague's
 * edit reaches the person a few seconds later by the pull, the person is told, an F5 opens it again,
 * when the proxy starts forwarding the upgrade the live collaboration comes back by itself, and when
 * it refuses again and cuts the live socket the HTTP probe takes the atlas back to the mode with no
 * reload (owner's decision of 2026-09-25; the rules live in `src/js/store/sync/sem-tempo-real.js`).
 *
 * UNTIL THAT DATE A REPRO SPEC ASSERTED THE OPPOSITE (`abertura-sem-tempo-real.repro.spec.js`,
 * deleted with this one): the tab went back to the chooser with the sentence "o servidor respondeu,
 * mas a conexão em tempo real não abriu". That was the honest message for an atlas that could not
 * open without the socket.
 *
 * THE REFUSAL IS A REAL PROXY, NOT A ROUTE OF THE BROWSER, and the choice is deliberate. B's page
 * talks to the backend through {@link proxyQueNaoRepassaOUpgrade}, a reverse proxy in this process
 * that forwards every HTTP request untouched and, while blocked, forwards the upgrade the way an
 * nginx without the `Upgrade`/`Connection` directives does: as a plain GET with the hop-by-hop
 * headers dropped, whose ordinary answer the browser reads as a failed handshake. That is the
 * production case (three proxies on the way), it does not depend on the browser build (Playwright's
 * `routeWebSocket` also answers the protocol ping itself), and unblocking it is the proxy starting
 * to forward, which is what the network team's fix is. A's page talks to the backend directly.
 *
 * THE LIVE RETURN IS PROVEN BY ABSENCE: once B's badge says `online`, A's next edit must reach B
 * with no pull of B passing through the proxy, so it came by the socket.
 */

import http from 'node:http';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { collabTest, expect, drawPointUI, readFeatures } from './helpers/collab.fixtures.js';
import { currentMapKeyIsUuid } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

const badge = (page) => page.locator('[data-testid="sync-status-badge"]');

/** Hop-by-hop headers an nginx without the WebSocket directives does not forward. */
const SALTO_A_SALTO = ['connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version',
    'sec-websocket-extensions', 'sec-websocket-protocol'];

/**
 * A reverse proxy to `alvo` (the backend origin) on an ephemeral port of this machine.
 * @param {URL} alvo
 * @returns {Promise<{ url: string, estado: { bloqueado: boolean, recusados: number, repassados: number,
 *   pulls: number }, cortarSockets: () => void, fechar: () => Promise<void> }>}
 */
async function proxyQueNaoRepassaOUpgrade(alvo) {
    const destino = { host: alvo.hostname, port: Number(alvo.port) };
    const estado = { bloqueado: true, recusados: 0, repassados: 0, pulls: 0 };
    const conexoes = new Set();
    /** The sockets that passed (both ends), so a test can cut them as a proxy that drops them does. */
    const repassadas = new Set();

    const servidor = http.createServer((req, res) => {
        if (req.method === 'GET' && /\/sync\/\d+(?:\?|$)/.test(req.url)) estado.pulls += 1;
        const ida = http.request({ ...destino, method: req.method, path: req.url, headers: req.headers }, (volta) => {
            res.writeHead(volta.statusCode, volta.statusMessage, volta.headers);
            volta.pipe(res);
        });
        ida.on('error', () => res.destroy());
        req.pipe(ida);
    });

    servidor.on('upgrade', (req, socket, head) => {
        conexoes.add(socket);
        socket.on('close', () => conexoes.delete(socket));
        socket.on('error', () => socket.destroy());
        if (estado.bloqueado) {
            estado.recusados += 1;
            const headers = { ...req.headers };
            for (const nome of SALTO_A_SALTO) delete headers[nome];
            const ida = http.request({ ...destino, method: 'GET', path: req.url, headers }, (volta) => {
                const partes = [];
                volta.on('data', (parte) => partes.push(parte));
                volta.on('end', () => {
                    const corpo = Buffer.concat(partes);
                    socket.end(`HTTP/1.1 ${volta.statusCode} ${volta.statusMessage}\r\n`
                        + `Content-Type: ${volta.headers['content-type'] ?? 'text/plain'}\r\n`
                        + `Content-Length: ${corpo.length}\r\nConnection: close\r\n\r\n${corpo.toString('latin1')}`, 'latin1');
                });
            });
            ida.on('error', () => socket.destroy());
            ida.end();
            return;
        }
        estado.repassados += 1;
        repassadas.add(socket);
        socket.on('close', () => repassadas.delete(socket));
        const ida = net.connect(destino.port, destino.host, () => {
            const linhas = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
            for (let i = 0; i < req.rawHeaders.length; i += 2) linhas.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
            ida.write(`${linhas.join('\r\n')}\r\n\r\n`);
            if (head?.length) ida.write(head);
            socket.pipe(ida).pipe(socket);
        });
        conexoes.add(ida);
        repassadas.add(ida);
        ida.on('close', () => { conexoes.delete(ida); repassadas.delete(ida); });
        ida.on('error', () => socket.destroy());
    });

    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    const { port } = servidor.address();
    return {
        url: `http://127.0.0.1:${port}`,
        estado,
        cortarSockets: () => {
            for (const conexao of repassadas) conexao.destroy();
        },
        fechar: () => new Promise((resolve) => {
            for (const conexao of conexoes) conexao.destroy();
            servidor.close(() => resolve());
        }),
    };
}

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

/**
 * Where B stands after an opening: the chooser (the opening failed) or the badge's transport state.
 * Read as one value so a failed opening fails the wait with `seletor`, which names the defect.
 *
 * NEVER A BARE `getAttribute`: on the chooser there is no badge, and a locator read without a
 * timeout waits for the element, so the poll would hang there and report the last value it saw
 * (`offline`, from the map page before it navigated). The first negative control measured exactly
 * that, and a wait that names the wrong state is the instrument lying.
 */
async function ondeEsta(page) {
    if (/\/atlas\.html/.test(page.url())) return 'seletor';
    const selo = badge(page);
    if (await selo.count() === 0) return 'sem-selo';
    const estado = await selo.getAttribute('data-state', { timeout: 1000 }).catch(() => null);
    if (/\/atlas\.html/.test(page.url())) return 'seletor';
    return estado ?? 'sem-selo';
}

collabTest('WebSocket recusado pelo proxy: o atlas abre, sincroniza por HTTP e volta ao tempo real sozinho', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const proxy = await proxyQueNaoRepassaOUpgrade(new URL(collab.baseUrl));
    try {
        // 1. ABRIR: B passes to the proxy and reloads the atlas; its socket is now refused.
        await B.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${proxy.url}/api/v1`);
        await B.reload();
        await expect.poll(() => ondeEsta(B), { timeout: 60000, intervals: [250] }).toBe('sem-tempo-real');
        await expect.poll(() => currentMapKeyIsUuid(B), { timeout: 30000 }).toBe(true);
        expect(proxy.estado.recusados).toBeGreaterThan(0);

        // 2. O AVISO: the toast, readable (opacity), and the badge's own label.
        const aviso = B.locator('.toast', { hasText: 'Sem tempo real' });
        await expect(aviso).toBeVisible({ timeout: 15000 });
        await expect.poll(() => aviso.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 })
            .toBeGreaterThan(0.9);
        const textoDoAviso = (await aviso.innerText()).trim();
        await expect(badge(B)).toContainText('Sem tempo real', { timeout: 15000 });
        console.log(`SEM_TEMPO_REAL aviso=${JSON.stringify(textoDoAviso)} recusados=${proxy.estado.recusados}`);
        expect(textoDoAviso).toContain('avise o administrador');

        // 3. EDITAR: B draws; the point reaches the server (HTTP push) and A (A's socket).
        const deB = await drawPointUI(B, [-43.2, -22.9]);
        await expect.poll(() => noServidor(collab.db, deB), { timeout: 30000 }).toBe(true);
        await esperarFeicao(A, deB, 30000);

        // 4. RECEBER: A draws; the point reaches B by the pull, within seconds.
        const t0 = Date.now();
        const deA = await drawPointUI(A, [-43.21, -22.91]);
        await esperarFeicao(B, deA, 30000);
        const atrasoDoPull = Date.now() - t0;
        console.log(`SEM_TEMPO_REAL atraso da edicao do colega por pull: ${atrasoDoPull} ms`);
        expect(atrasoDoPull).toBeLessThan(20000);
        expect(await ondeEsta(B)).toBe('sem-tempo-real');

        // 5. F5: still blocked, the atlas opens again with both points.
        await B.reload();
        await expect.poll(() => ondeEsta(B), { timeout: 60000, intervals: [250] }).toBe('sem-tempo-real');
        await esperarFeicao(B, deA, 30000);
        await esperarFeicao(B, deB, 30000);

        // 6. O WS VOLTA: the proxy starts forwarding the upgrade; B's own backoff finds it.
        proxy.estado.bloqueado = false;
        const tVolta = Date.now();
        await expect.poll(() => ondeEsta(B), { timeout: 60000, intervals: [250] }).toBe('online');
        console.log(`SEM_TEMPO_REAL tempo real de volta em ${Date.now() - tVolta} ms (repassados=${proxy.estado.repassados})`);
        expect(proxy.estado.repassados).toBeGreaterThan(0);

        // 7. AO VIVO: A's next edit reaches B with no pull of B in between.
        const pullsAntes = proxy.estado.pulls;
        const t1 = Date.now();
        const aoVivo = await drawPointUI(A, [-43.22, -22.92]);
        await esperarFeicao(B, aoVivo, 15000);
        const atrasoAoVivo = Date.now() - t1;
        console.log(`SEM_TEMPO_REAL atraso ao vivo: ${atrasoAoVivo} ms, pulls de B depois da volta: ${proxy.estado.pulls - pullsAntes}`);
        expect(proxy.estado.pulls - pullsAntes).toBe(0);
        expect(atrasoAoVivo).toBeLessThan(10000);

        // 8. A SONDA: the proxy starts refusing again AND cuts the live socket, as one that drops
        //    upgraded connections does. B reconnects, is refused, and the HTTP probe takes it to the
        //    mode by itself (`SONDA_APOS_QUEDA_MS`, then one fresh attempt of the socket first), with
        //    no reload; the colleague's edits keep arriving by the pull.
        proxy.estado.bloqueado = true;
        const tQueda = Date.now();
        proxy.cortarSockets();
        await expect.poll(() => ondeEsta(B), { timeout: 90000, intervals: [250] }).toBe('sem-tempo-real');
        console.log(`SEM_TEMPO_REAL sonda: modo sem tempo real ${Date.now() - tQueda} ms depois do corte`);
        const depoisDaSonda = await drawPointUI(A, [-43.23, -22.93]);
        await esperarFeicao(B, depoisDaSonda, 30000);
    } finally {
        await proxy.fechar();
    }
});
