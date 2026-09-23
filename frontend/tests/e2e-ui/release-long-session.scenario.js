// Path: tests/e2e-ui/release-long-session.scenario.js

/**
 * @fileoverview Opt-in release scenario: NINETY WALL-CLOCK MINUTES of two real clients sharing one
 * atlas, and the question is whether any edit is lost on the way. It came from the launch audit of
 * 2026-09-22 and entered the repository by the owner's decision D2 of 2026-09-23. It runs only
 * through `playwright.release-long-session.config.js` (`npm run test:e2e:sessao-longa`); the normal
 * `test:e2e:ui` never collects a `*.scenario.js`.
 *
 * THE SCHEDULE (181 ticks of 30 s):
 *   - every tick, each client writes one point through the real store and the scenario asserts it
 *     in THAT client's IndexedDB at once (362 writes in total);
 *   - B loses the network at minutes 13 to 16, 43 to 46 and 73 to 76. The outage is `setOffline`
 *     PLUS an explicit close of the live socket, because Firefox keeps an already open WebSocket
 *     delivering frames under `setOffline(true)` (see the Firefox section of the README);
 *   - while both are online, both clients must hold the SAME id set, within 120 s;
 *   - A reloads at minutes 30, 60 and 90, and both reload at the end;
 *   - after the final reloads, each client draws one point through the REAL toolbar and canvas,
 *     and the peer must receive it (364 features);
 *   - PostgreSQL must hold exactly those 364 ids, each client must have renewed its access token
 *     at least three times without a new login, and no page may have thrown.
 *
 * WHY THE 362 ARE STORE WRITES AND ONLY THE LAST TWO ARE GESTURES: the subject here is the session
 * and the transport (renewal, outage, reconnection, reload), not drawing, which has its own specs
 * (`drawing-*.spec.js`). The two final gestures prove that the RESTORED interfaces still draw and
 * synchronize, which is what a user returning after ninety minutes does first.
 *
 * THE PREMISE IS CHECKED AT MINUTE ZERO, NOT AT MINUTE NINETY: the renewal count only means
 * something under the product's default access-token lifetime (15 min, `JWT_ACCESS_EXPIRY`). The
 * backend of this layer inherits the environment of whoever launches Playwright, so a
 * `JWT_ACCESS_EXPIRY` left in the shell would change the subject silently and surface only as a
 * low renewal count ninety minutes later.
 *
 * THE INSTRUMENT DEFECT THAT COST A WHOLE RUN (2026-09-23, Firefox, 1.6 h): the final gesture
 * clicked the canvas right after clicking the tool button, while the point tool still arrives
 * through `import()` (measured at about 2.8 s in Firefox against 0.78 s in Chromium). The run ended
 * with 362 of 363 features, all queues empty and both clients online. A negative control on the
 * same day, in Firefox, reproduced the mechanism in isolation: without the wait 0 of 3 gestures
 * created the point, with it 3 of 3. The gesture now waits for `data-active` (as the
 * `drawing-*.spec.js` files do), which is written only after the tool's `activate()` has returned.
 *
 * ARTIFACTS in the test output directory: `session-samples.json` (every 10 min; in Chromium it
 * carries CDP heap and DOM counters, in Firefox the memory array is empty because CDP does not
 * exist there), `session-<tick>.png`, `session-final.json`, and, pass or fail, `diagnostics.json`
 * and `final-<client>.png` with socket, token and queue state of both clients.
 */

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, readFeatures } from './helpers/collab-helpers.js';
import { readIdbEntity } from './helpers/idb.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
test.beforeAll(() => expect(state.skip, 'backend de teste obrigatório').toBe(false));

/** One tick of the schedule. */
const TICK_MS = 30000;
/** Ticks 0..180 inclusive: 181 ticks, ninety minutes. */
const LAST_TICK = 180;
/** Position inside each 60-tick half hour where B goes offline and comes back (minutes 13 and 16). */
const OUTAGE_FROM = 26;
const OUTAGE_TO = 32;
/** The product default the renewal count is measured under (`JWT_ACCESS_EXPIRY=15m`). */
const ACCESS_TOKEN_SECONDS = 15 * 60;
/** Ninety minutes under a 15-minute token: at least three renewals per client, measured 5 to 6. */
const MIN_REFRESHES = 3;
/** Convergence budget; the slowest reconnection measured in the audit took 51 s. */
const CONVERGENCE_MS = 120000;

/**
 * Lifetime, in seconds, of the access token the page holds right now (`exp - iat` of the JWT).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number|null>}
 */
function accessTokenLifetime(page) {
    return page.evaluate(async () => {
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const token = apiClient.getAccessToken();
        if (!token) return null;
        const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const claims = JSON.parse(atob(payload));
        return claims.exp - claims.iat;
    });
}

/**
 * The sorted id set of the points of the page's CURRENT map.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
async function pointIds(page) {
    return (await readFeatures(page, 'points')).map((feature) => feature.id).sort();
}

test('90 real minutes: refreshed sessions and offline queues preserve every edit', async ({ browser, browserName }, testInfo) => {
    test.setTimeout(100 * 60 * 1000);
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
    const pages = [A, B];
    const refreshes = [0, 0];
    const errors = [];
    const samples = [];
    const ids = [];
    for (const [index, page] of pages.entries()) {
        page.on('response', (response) => {
            if (/\/auth\/refresh(?:\?|$)/.test(response.url()) && response.status() === 200) refreshes[index] += 1;
        });
        page.on('pageerror', (error) => errors.push({ client: index, message: error.message }));
    }
    const sessions = browserName === 'chromium'
        ? await Promise.all(pages.map((page) => page.context().newCDPSession(page)))
        : [];

    // After a reload "the loader is gone" is not "the app is ready": the map control, the online
    // badge and the atlas map (by its UUID key) all have to be there before the store is read.
    const ready = async (page) => {
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: CONVERGENCE_MS });
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: CONVERGENCE_MS });
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: CONVERGENCE_MS });
        await expect.poll(() => page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapIdSync()), { timeout: CONVERGENCE_MS }).toBe(seed.mapId);
    };
    const converged = async (page) => {
        await expect.poll(() => pointIds(page), { timeout: CONVERGENCE_MS }).toEqual([...ids].sort());
    };

    await Promise.all(pages.map(ready));
    for (const page of pages) {
        expect(await accessTokenLifetime(page),
            'a cena mede a renovação sob o prazo padrão do token de acesso (15 min); '
            + 'um JWT_ACCESS_EXPIRY no ambiente de quem lançou o Playwright muda o sujeito').toBe(ACCESS_TOKEN_SECONDS);
    }

    const started = Date.now();
    let offline = false;
    const db = createDb(state.dbName);
    try {
        for (let tick = 0; tick <= LAST_TICK; tick += 1) {
            const due = started + tick * TICK_MS;
            while (Date.now() < due) await new Promise((resolve) => setTimeout(resolve, Math.min(1000, due - Date.now())));
            const phase = tick % 60;
            if (phase === OUTAGE_FROM) {
                await B.context().setOffline(true);
                await B.evaluate(async () => {
                    const { wsClient } = await import('/src/js/store/sync/ws-client.js');
                    wsClient._socket?.close(4000, 'network fault injection');
                });
                offline = true;
            }
            if (phase === OUTAGE_TO) {
                await B.context().setOffline(false);
                offline = false;
            }
            for (const [index, page] of pages.entries()) {
                // Real user activity keeps the inactivity policy apart from access-token expiry.
                await page.mouse.move(400 + (tick % 50), 260 + index * 30);
                const id = randomUUID();
                await page.evaluate(async ({ id, tick, index }) => {
                    const store = await import('/src/js/store/index.js');
                    await store.addFeature('points', {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2 + tick * 0.00001, -22.9 + index * 0.0001] },
                        properties: { id, source: 'point', nome: `Sessao ${index} / ${tick}`, color: '#0066cc' },
                    });
                }, { id, tick, index });
                ids.push(id);
                expect((await readIdbEntity(page, { entityId: id, mapId: seed.mapId, storage: 'points' })).found).toBe(true);
            }
            if (!offline) {
                for (const page of pages) await converged(page);
            }
            if (phase === OUTAGE_TO) {
                console.log(`[session-reconnect] minute=${((Date.now() - started) / 60000).toFixed(1)} refreshes=${refreshes.join('/')}`);
            }
            if (tick > 0 && tick % 60 === 0) {
                await A.reload();
                await ready(A);
                await converged(A);
            }
            if (tick % 20 === 0) {
                const memory = await Promise.all(sessions.map(async (session) => ({
                    heap: await session.send('Runtime.getHeapUsage'),
                    dom: await session.send('Memory.getDOMCounters'),
                })));
                samples.push({ elapsedMs: Date.now() - started, features: ids.length, refreshes: [...refreshes], memory });
                await writeFile(testInfo.outputPath('session-samples.json'), JSON.stringify(samples, null, 2));
                await A.screenshot({ path: testInfo.outputPath(`session-${tick}.png`) });
            }
            console.log(`[session-soak] minute=${((Date.now() - started) / 60000).toFixed(1)} features=${ids.length} `
                + `offline=${offline} refreshes=${refreshes.join('/')}`);
        }

        for (const page of pages) {
            await page.reload();
            await ready(page);
            await converged(page);
        }

        // The restored interfaces must still create and synchronize a REAL drawing.
        for (const page of pages) {
            const draw = page.locator('.toolbar-group[data-group-id="draw"]');
            await draw.locator('.toolbar-group-btn').click();
            await expect(draw.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 30000 });
            const tool = draw.locator('.toolbar-tool-btn[data-tool-id="point"]');
            await tool.click();
            // The tool arrives through import(); a canvas click before `data-active` reaches the
            // selection router and draws nothing (the 362/363 of 2026-09-23, in the fileoverview).
            await expect(tool).toHaveAttribute('data-active', 'true', { timeout: 60000 });
            await page.mouse.click(630, 340);
            await expect.poll(async () => (await readFeatures(page, 'points')).length, { timeout: CONVERGENCE_MS })
                .toBe(ids.length + 1);
            const fresh = (await readFeatures(page, 'points')).find((feature) => !ids.includes(feature.id));
            expect(fresh).toBeTruthy();
            ids.push(fresh.id);
            for (const peer of pages) await converged(peer);
        }

        const rows = await db.raw.any('SELECT id FROM features WHERE map_id = $1 AND deleted_at IS NULL', [seed.mapId]);
        expect(rows.map((row) => row.id).sort()).toEqual([...ids].sort());
        expect(refreshes.every((count) => count >= MIN_REFRESHES),
            `cada cliente renova o token de 15 min sem novo login (${refreshes.join('/')})`).toBe(true);
        expect(errors).toEqual([]);
        await writeFile(testInfo.outputPath('session-final.json'), JSON.stringify({
            elapsedMs: Date.now() - started, atlasId: seed.atlasId, features: ids.length, refreshes, errors,
        }, null, 2));
    } finally {
        const diagnostics = await Promise.all(pages.map(async (page, index) => {
            await page.screenshot({ path: testInfo.outputPath(`final-${index}.png`) }).catch(() => {});
            return page.evaluate(async () => {
                const { wsClient: ws } = await import('/src/js/store/sync/ws-client.js');
                const { apiClient: api } = await import('/src/js/store/sync/api-client.js');
                const { operationQueue: queue } = await import('/src/js/store/sync/operation-queue.js');
                return {
                    url: location.href,
                    online: navigator.onLine,
                    text: document.body.innerText.slice(-4000),
                    ws: {
                        state: ws._conn.getState(), want: ws._wantConnected, attempts: ws._reconnectAttempts,
                        ready: ws._socket?.readyState, buffered: ws._socket?.bufferedAmount, pong: ws._pongPending,
                    },
                    auth: {
                        refreshPending: Boolean(api._refreshing), cooldown: api._refreshCooldownUntil - Date.now(),
                        hasToken: Boolean(api._accessToken), hasRefresh: Boolean(api._refreshToken),
                    },
                    queue: { counts: await queue.countByState(), ops: await queue.getAll(), issues: await queue.getIssues() },
                };
            }).catch((error) => ({ error: error.message }));
        }));
        await writeFile(testInfo.outputPath('diagnostics.json'), JSON.stringify({ diagnostics, ids, refreshes, errors }, null, 2));
        await B.context().setOffline(false).catch(() => {});
        await Promise.all(pages.map((page) => page.context().close()));
        await closeDb();
    }
});
