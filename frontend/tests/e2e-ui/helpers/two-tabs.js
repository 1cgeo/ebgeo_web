// Path: e2e-ui/helpers/two-tabs.js

/**
 * @fileoverview TWO TABS OF THE SAME USER, in ONE browser context.
 *
 * WHY THIS EXISTS, AND WHY THE COLLAB HELPERS CANNOT DO IT. Every multi-client spec in this
 * folder opens `browser.newContext()` per participant (16 call sites). A context is a PROFILE:
 * separate cookies, separate localStorage, separate IndexedDB. That is exactly right for "two
 * users collaborating" and exactly wrong for "one user with two tabs open", because it isolates
 * the two things the tab-lock and the atlas namespace arbitrate over. `context.newPage()` does
 * not appear once in `tests/e2e-ui/`, so the requirement "two tabs in DIFFERENT atlases work,
 * two tabs in the SAME atlas collide" had zero coverage at every layer.
 *
 * WHAT IT MEASURES, AND BY WHICH PATH. The load-bearing reads here go to `indexedDB` directly
 * (`indexedDB.databases()` and a raw `open`/`getAll`), never through an app module:
 *
 *   - a probe that does `import('/src/js/store/atlas-namespace.js')` can receive a DIFFERENT
 *     module instance than the running app when Vite serves a freshly edited file with an HMR
 *     `?t=` query, so the `_activeScope` it reads is not necessarily the app's. `activeScopeOf`
 *     is kept for DIAGNOSTICS and is labelled as such; no assertion should rest on it alone.
 *   - `indexedDB.databases()` is a fact of the browser profile, shared by both tabs, and cannot
 *     be faked by a stale module.
 *
 * TWO WAYS THIS INSTRUMENT COULD LIE, both closed on purpose:
 *
 *   - `indexedDB.databases()` is not implemented on every engine, and where it is missing it
 *     would return `undefined`, making every "database X must NOT exist" assertion pass
 *     vacuously. `idbDatabaseNames` THROWS instead of returning an empty list.
 *   - reading a database with `indexedDB.open(name)` CREATES it when absent, so a reader used
 *     as an existence check would manufacture the very database it is asked about (the same
 *     defect `clearAtlasDatabases` has, recorded as D4 in `docs/decisions/fase-multiaba-2026-08.md`). Every read
 *     here is gated on the name being present in `databases()` first, and returns
 *     `{ exists: false }` without opening anything.
 *
 * The blocking overlay is matched by CSS class because `utilities/tab-lock.js` puts no
 * `data-testid` on it and E0 may not touch `src/`. That coupling FAILS SAFE: if the class is
 * renamed, the case that asserts the overlay VISIBLE (A2) goes red, never green.
 *
 * THREE MECHANISMS HERE EXIST BECAUSE A MEASUREMENT CAUGHT THE PREVIOUS VERSION LYING, and
 * each is documented at its own function: `pendingGate` (a `test.fail` case that fails for
 * the WRONG reason now reprova a rodada instead of passing as "expected"), `classifySamples`
 * (a read that could not run is its own category, never evidence of destruction) and
 * `tabDiagnostic` (blocked / fell to the project picker / never booted stop sharing one
 * assertion).
 *
 * THREE MORE WERE ADDED WHEN THE FILE'S FLAKE WAS HUNTED (2026-08-15), and each closes a way
 * the run died for a reason that was not the app: `evaluateStable` (a read that lands during a
 * navigation the SCENARIO ITSELF causes is retried, not counted), `closeTabContexts` (a pending
 * case used to leak its whole browser context into every later case of the worker) and the
 * BUDGET inside `pendingGate` (a pending case can no longer be killed by the runner's clock,
 * which `test.fail()` does not cover). The observability that names the fourth cause,
 * `hmrEventsOf`, is here too.
 *
 * TWO CONSUMERS, ONE INSTRUMENT. `browser-multi-tab-namespace.spec.js` asks which databases
 * exist and what is inside them; `browser-multi-tab-teardown-queue.spec.js` asks what happens to
 * the OUTBOUND QUEUE when the neighbour tab moves, and to a live tab when the neighbour destroys
 * the databases under it. The second set needs three reads the first did not: `queueDbOf` (the
 * queue is the one store with a named object store, and its legacy address is the bare `ebgeo`),
 * `waitForOverlayTitle` (blocked and frozen share one element and one CSS class — only the TEXT
 * separates them) and `sampleIdbKeys` (the question after a destruction is "did they come BACK",
 * and a single read at the end cannot answer it: the recreation it guards against is a write
 * that can arrive at any point in the seconds that follow).
 */

import { test, expect } from '@playwright/test';
import { APP_ORIGIN } from '../constants.js';

/** The blocking overlay, only while it is actually up (the element survives hidden). */
export const BLOCK_OVERLAY_SELECTOR = '.tab-lock-overlay.tab-lock-overlay--visible';

/** Default object store localforage uses when the descriptor names none. */
const LOCALFORAGE_STORE = 'keyvaluepairs';

/**
 * The object store the outbound queue lives in. The queue is the ONLY descriptor in
 * `atlas-namespace.js` with a named store, so every other read here defaults to `keyvaluepairs`.
 */
export const QUEUE_STORE = 'operation_queue';

/**
 * Queue database of one scope suffix.
 *
 * Mirrors `resolveDbName(StoreName.OPERATION_QUEUE, scope)` WITHOUT importing it, for the same
 * reason `atlasDbNames` does: an expectation derived from the code under test proves nothing. The
 * legacy suffix keeps the bare name `ebgeo`, which is why the ordinary installation moved zero
 * bytes when the queue became physical.
 * @param {string} dbSuffix - '' for the legacy/local slot #1, `remote-<atlasId>` for a server atlas.
 * @returns {string}
 */
export const queueDbOf = (dbSuffix) => (dbSuffix === '' ? 'ebgeo' : `ebgeo__${dbSuffix}`);

/**
 * Wording of the FROZEN overlay (`TEARDOWN_OVERLAY.title` in `utilities/tab-lock.js`).
 *
 * Copied rather than imported, and the copy is the point: the two overlay states share one
 * element and one CSS class, so `blocked === true` cannot tell "another tab holds this atlas"
 * (reversible, offers a handoff) from "the databases under this tab are being destroyed"
 * (final, offers a reload). The TEXT is the only signal that separates them in the DOM, and a
 * test that read it from the source module would agree with a renamed string by construction.
 */
// "projeto" → "atlas" em 2026-08-16 (0bbc3aee), quando o vocabulário da UI inteiro trocou. A cópia
// deliberada acima é o que fez a troca aparecer: ela reprovou com `overlayTitle` recebido e esperado
// diferindo por UMA palavra, que é exatamente o sinal que um import teria engolido. Ao mexer no
// título em `utilities/tab-lock.js`, mexa aqui no MESMO commit.
export const TEARDOWN_OVERLAY_TITLE = 'Este atlas foi encerrado em outra aba';

/** Wording of the ordinary blocked overlay (`BLOCKED_OVERLAY.title`), same reasoning. */
export const BLOCKED_OVERLAY_TITLE = 'EBGeo está aberto em outra aba';

/**
 * Contexts handed out by `createTabContext`, so `closeTabContexts` can end them all.
 *
 * WHY IT IS NOT ENOUGH TO CALL `ctx.close()` AT THE END OF EACH CASE, which is what the spec
 * used to do: the four `test.fail` cases go through `pendingGate`, which THROWS the expected
 * failure, so their `ctx.close()` was unreachable by construction. Measured consequence: a
 * worker running the file to the end carried four live contexts — eight tabs, their WebSockets,
 * their 1.5 s auto-flush loops and their MapLibre canvases — through every later case, on one
 * worker. That is the "sustained load" a heavy spec is then blamed for.
 * @type {Set<import('@playwright/test').BrowserContext>}
 */
const openContexts = new Set();

/**
 * Closes every context `createTabContext` opened, whatever the case did. Call from an
 * `afterEach`, never from the case body.
 */
export async function closeTabContexts() {
    const all = [...openContexts];
    openContexts.clear();
    await Promise.all(all.map((ctx) => ctx.close().catch(() => {})));
}

/**
 * Opens a context whose pages are TABS of one browser profile: one cookie jar, one
 * localStorage (so the JWT of tab 1 is the session of tab 2) and one IndexedDB.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} baseUrl - Backend base URL from `readState()`.
 * @param {Object} [options]
 * @param {boolean} [options.trace=false] - Turn the SyncLedger tracer on for both tabs.
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
export async function createTabContext(browser, baseUrl, { trace = false } = {}) {
    const ctx = await browser.newContext();
    openContexts.add(ctx);
    ctx.once('close', () => openContexts.delete(ctx));
    // On the CONTEXT, not the page: a per-page addInitScript has to be repeated for every tab
    // and the one that is forgotten boots against the dev backend instead of the throwaway one.
    await ctx.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    if (trace) {
        await ctx.addInitScript(() => { window.__EBGEO_TRACE__ = true; });
    }
    return ctx;
}

/**
 * Everything one tab did that only the dev server could have caused, per page.
 * @type {WeakMap<import('@playwright/test').Page, {sockets: string[], modules: string[], navigations: string[]}>}
 */
const devServerEvents = new WeakMap();

/** A module Vite re-serves after an invalidation carries a millisecond epoch as `?t=`. */
const HMR_MODULE_QUERY = /[?&]t=\d{13}(&|$)/;

/**
 * What the DEV SERVER did to one tab, as opposed to what the app did.
 *
 * The two entries that matter are `sockets` (a WebSocket back to the app origin is the Vite HMR
 * channel — the app's own socket goes to the backend origin) and `modules` (a module re-fetched
 * with `?t=<epoch>` is an HMR invalidation, i.e. the page's code was swapped mid-measurement).
 * Both must be EMPTY under `vite.e2e.config.js`; the spec asserts it, because "no reload
 * happened" and "reloads happen but not in this run" are otherwise the same observation.
 * @param {import('@playwright/test').Page} page
 * @returns {{sockets: string[], modules: string[], navigations: string[]}}
 */
export function hmrEventsOf(page) {
    return devServerEvents.get(page) || { sockets: [], modules: [], navigations: [] };
}

/**
 * Opens one more TAB in the same context and navigates it.
 * @param {import('@playwright/test').BrowserContext} ctx
 * @param {string} [url='/'] - Path relative to `baseURL`.
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function openTab(ctx, url = '/') {
    const page = await ctx.newPage();
    const record = { sockets: [], modules: [], navigations: [] };
    devServerEvents.set(page, record);
    page.on('websocket', (ws) => {
        if (ws.url().startsWith(APP_ORIGIN.replace(/^http/, 'ws'))) record.sockets.push(ws.url());
    });
    page.on('request', (req) => {
        const url_ = req.url();
        if (url_.startsWith(APP_ORIGIN) && HMR_MODULE_QUERY.test(url_)) record.modules.push(url_);
    });
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) record.navigations.push(frame.url());
    });
    await page.goto(url);
    return page;
}

/** Errors that mean "the page moved under the read", not "the read is wrong". */
const NAVIGATED_UNDER_READ = /Execution context was destroyed|Cannot find context with specified id/i;

/**
 * `page.evaluate` that survives a navigation the SCENARIO ITSELF causes.
 *
 * MEASURED, and it is the reason this exists: A3 logs tab A out while tab B is live, which kills
 * tab B's session and makes tab B navigate. Every read of tab B fired in that window died with
 * `Execution context was destroyed`, and in one of four serial runs it killed A3's GATE — before
 * the assertion the case exists for, with the sampled evidence (44 `absent` readings) already in
 * hand. `pendingGate` then reported it honestly as "not the named defect", which turned a
 * `test.fail` case green, which reprova a rodada. The navigation is EXPECTED here; only the read
 * has to be retried, and only for that error.
 * @template T
 * @param {import('@playwright/test').Page} page
 * @param {Function} fn
 * @param {*} [arg]
 * @param {{attempts?: number}} [options]
 * @returns {Promise<T>}
 */
async function evaluateStable(page, fn, arg, { attempts = 3 } = {}) {
    let last;
    for (let i = 0; i < attempts; i += 1) {
        try {
            return await page.evaluate(fn, arg);
        } catch (e) {
            last = e;
            if (!NAVIGATED_UNDER_READ.test(String(e && e.message ? e.message : e))) throw e;
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        }
    }
    throw last;
}

/**
 * What a tab ended up doing, once it stopped changing its mind.
 *
 * IT DOES NOT RACE map-load AGAINST overlay-visible, and that is deliberate: `map_sig.js` sets
 * `globalThis.__ebgeoMap` before `initTabLock` runs, so a blocked tab reaches "map loaded"
 * FIRST and a race would report it as mounted. Instead it waits for either signal and then
 * lets the lock settle (`SETTLE_MS` is 300 ms in `utilities/tab-lock.js`) before reading the
 * overlay, which is the state that decides.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {number} [options.timeout=30000]
 * @param {number} [options.settleMs=1500] - Well over the lock's 300 ms settle window.
 * @returns {Promise<{ blocked: boolean, mapLoaded: boolean, syncState: string|null, url: string }>}
 */
export async function tabVerdict(page, { timeout = 30000, settleMs = 1500 } = {}) {
    const never = () => new Promise(() => {});
    let timer = null;
    const mapUp = page
        .waitForFunction(
            () => !!(globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function'
                && globalThis.__ebgeoMap.loaded()),
            null,
            { timeout },
        )
        .catch(never);
    const overlayUp = page.locator(BLOCK_OVERLAY_SELECTOR)
        .waitFor({ state: 'visible', timeout })
        .catch(never);
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, timeout); });
    await Promise.race([mapUp, overlayUp, deadline]);
    if (timer) clearTimeout(timer);

    await page.waitForTimeout(settleMs);
    return evaluateStable(page, () => {
        const overlay = document.querySelector('.tab-lock-overlay');
        const badge = document.querySelector('[data-testid="sync-status-badge"]');
        return {
            blocked: !!overlay && overlay.classList.contains('tab-lock-overlay--visible'),
            mapLoaded: !!(globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function'
                && globalThis.__ebgeoMap.loaded()),
            syncState: badge ? badge.getAttribute('data-state') : null,
            url: window.location.href,
        };
    });
}

/**
 * Every IndexedDB database of this origin, by name.
 *
 * THROWS where `indexedDB.databases()` is unavailable instead of answering "none": an empty
 * list makes every absence assertion in the multi-tab spec pass without measuring anything,
 * which is the "cobertura vazia" failure mode the constitution names.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} Sorted names.
 */
export async function idbDatabaseNames(page) {
    const names = await evaluateStable(page, async () => {
        if (typeof indexedDB.databases !== 'function') return null;
        const list = await indexedDB.databases();
        return list.map((d) => d.name).filter(Boolean).sort();
    });
    if (names === null) {
        throw new Error(
            'indexedDB.databases() is unavailable in this browser: the two-tab instrument '
            + 'cannot measure which namespaces exist, and an empty answer would pass silently.',
        );
    }
    return names;
}

/**
 * Names of the per-atlas databases of one scope suffix, in the order of `STORE_DESCRIPTORS`.
 * Mirrors `resolveDbName` without importing it, so the expectation is written out where the
 * test can read it (an assertion that derives its expected value from the code under test
 * proves nothing).
 * @param {string} dbSuffix - '' for the legacy/local slot #1, `remote-<atlasId>` for a server atlas.
 * @returns {string[]}
 */
export function atlasDbNames(dbSuffix) {
    const bases = [
        'ebgeo_atlas', 'ebgeo_maps', 'ebgeo_images', 'ebgeo_app_settings', 'ebgeo_groups',
        'ebgeo_layers', 'ebgeo_cesium3d', 'ebgeo_streetview360', 'ebgeo_briefings', 'ebgeo_comments',
    ];
    return dbSuffix === '' ? bases : bases.map((b) => `${b}__${dbSuffix}`);
}

/** The `ebgeo_maps` database of one scope suffix. */
export const mapsDbOf = (dbSuffix) => atlasDbNames(dbSuffix)[1];

/** The scope suffix of a server atlas (`remoteScope` builds the same string). */
export const remoteSuffix = (atlasId) => `remote-${atlasId}`;

/**
 * Raw read of one localforage database, WITHOUT creating it.
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @param {string} [storeName='keyvaluepairs']
 * @returns {Promise<{ exists: boolean, keys: string[], missingStore?: boolean }>}
 */
export async function readIdbKeys(page, dbName, storeName = LOCALFORAGE_STORE) {
    const names = await idbDatabaseNames(page);
    if (!names.includes(dbName)) return { exists: false, keys: [] };
    return evaluateStable(page, ({ name, store }) => new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onerror = () => reject(new Error(`open ${name} failed`));
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(store)) {
                db.close();
                resolve({ exists: true, keys: [], missingStore: true });
                return;
            }
            const tx = db.transaction(store, 'readonly');
            const all = tx.objectStore(store).getAllKeys();
            all.onsuccess = () => {
                const keys = all.result.map(String);
                db.close();
                resolve({ exists: true, keys });
            };
            all.onerror = () => { db.close(); reject(new Error(`getAllKeys ${name} failed`)); };
        };
    }), { name: dbName, store: storeName });
}

/**
 * Every feature id stored in a maps database, read straight from IndexedDB.
 *
 * This is the leak detector: "the point drawn in atlas X must not be inside the databases of
 * atlas Y" is a statement about bytes on disk, and reading it through the app store would ask
 * the very layer under test whether it did the right thing.
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @returns {Promise<{ exists: boolean, mapKeys: string[], featureIds: string[] }>}
 */
export async function readIdbFeatureIds(page, dbName) {
    const names = await idbDatabaseNames(page);
    if (!names.includes(dbName)) return { exists: false, mapKeys: [], featureIds: [] };
    return evaluateStable(page, ({ name, store }) => new Promise((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onerror = () => reject(new Error(`open ${name} failed`));
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(store)) {
                db.close();
                resolve({ exists: true, mapKeys: [], featureIds: [] });
                return;
            }
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            const keysReq = os.getAllKeys();
            const valsReq = os.getAll();
            tx.oncomplete = () => {
                const ids = [];
                for (const value of valsReq.result || []) {
                    const buckets = value && value.features;
                    if (!buckets || typeof buckets !== 'object') continue;
                    for (const arr of Object.values(buckets)) {
                        if (!Array.isArray(arr)) continue;
                        for (const f of arr) {
                            const id = f && f.properties && f.properties.id;
                            if (id) ids.push(String(id));
                        }
                    }
                }
                db.close();
                resolve({ exists: true, mapKeys: (keysReq.result || []).map(String), featureIds: ids });
            };
            tx.onerror = () => { db.close(); reject(new Error(`read ${name} failed`)); };
        };
    }), { name: dbName, store: LOCALFORAGE_STORE });
}

/**
 * Samples one feature's presence in a database repeatedly, for a window.
 *
 * WHY SAMPLING AND NOT A SINGLE READ AFTER THE FACT. "Did tab B's data survive what tab A did"
 * asked once, at the end, is a race and it MEASURES AS ONE: in series, A3 read the surviving
 * state 1 time in 4 (the purge empties the databases, and tab B — still live and connected —
 * writes its map back a moment later, which is precisely the recreation E2 has to prevent). A
 * probabilistic answer is not an answer, so the question becomes "was it EVER destroyed during
 * the window", which is the invariant anyway and is detected deterministically.
 *
 * Start it BEFORE the destructive act and await it after, so the window covers the act itself.
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @param {string} featureId
 * @param {Object} [options]
 * @param {number} [options.durationMs=15000]
 * @param {number} [options.intervalMs=150]
 * @returns {Promise<Array<{exists: boolean, has: boolean}>>}
 */
export async function sampleFeatureInDb(page, dbName, featureId, { durationMs = 8000, intervalMs = 150 } = {}) {
    const samples = [];
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
        try {
            const r = await readIdbFeatureIds(page, dbName);
            samples.push({ kind: r.exists ? (r.featureIds.includes(featureId) ? 'has' : 'gone') : 'absent' });
        } catch (e) {
            // A READ THAT COULD NOT RUN IS NOT A MEASUREMENT, in either direction. Counting
            // it as "the data is gone" was wrong and it MISFIRED: the tab navigates during
            // the window (its session dies with the other tab's logout) and `page.evaluate`
            // then throws "Execution context was destroyed" — a pattern indistinguishable, to
            // the old counter, from an actual wipe. It is reported as its own category and
            // never as evidence of destruction.
            samples.push({ kind: 'unreadable', error: String(e && e.message ? e.message : e) });
        }
        await page.waitForTimeout(intervalMs);
    }
    return samples;
}

/**
 * Splits a sample series into the three answers it can carry.
 * @param {Array<{kind: string}>} samples
 * @returns {{ has: number, gone: number, absent: number, unreadable: number, total: number,
 *   destroyed: number }} `destroyed` counts only samples that READ the database and did not
 *   find the feature, i.e. the only evidence of destruction there is.
 */
export function classifySamples(samples) {
    const count = (k) => samples.filter((s) => s.kind === k).length;
    return {
        has: count('has'),
        gone: count('gone'),
        absent: count('absent'),
        unreadable: count('unreadable'),
        total: samples.length,
        destroyed: count('gone') + count('absent'),
    };
}

/**
 * What a tab IS, in one round trip, for a gate that must not confuse its failure modes.
 *
 * A gate asserting only "the badge is not online" cannot tell a BLOCKED tab from a tab that
 * fell through to the project picker from a tab that never booted; all three end on the same
 * assertion. This returns every one of those facts at once, so the assertion diff names which
 * happened. MEASURED: in one of six serial runs tab B landed on `atlas.html`, and the
 * error read "element(s) not found" — an answer that pointed nowhere.
 *
 * `overlayTitle` is what separates the two states of that one overlay (blocked vs frozen); it is
 * null while no overlay was ever built.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ blocked: boolean, overlayTitle: string|null, syncState: string|null,
 *   page: string, mapLoaded: boolean, url: string, title: string }>}
 */
export function tabDiagnostic(page) {
    return evaluateStable(page, () => {
        const overlay = document.querySelector('.tab-lock-overlay');
        const badge = document.querySelector('[data-testid="sync-status-badge"]');
        const path = window.location.pathname;
        return {
            blocked: !!overlay && overlay.classList.contains('tab-lock-overlay--visible'),
            overlayTitle: overlay?.querySelector('.tab-lock-overlay__title')?.textContent ?? null,
            syncState: badge ? badge.getAttribute('data-state') : null,
            // `atlas.html` desde 2026-08-16 (era `projetos.html`). Enquanto dizia `projetos`, este
            // rótulo classificava a tela de atlas como `mapa`, isto é, o diagnóstico que existe para
            // orientar a investigação de uma falha apontava para a página errada. Nenhum caso
            // reprovou por isso, porque nada assere este campo: instrumento errado e calado.
            page: path.includes('atlas.html') ? 'atlas' : (path.includes('admin') ? 'admin' : 'mapa'),
            mapLoaded: !!(globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function'
                && globalThis.__ebgeoMap.loaded()),
            url: window.location.href,
            title: document.title,
        };
    });
}

/**
 * Waits until a tab shows the overlay with `title`, and answers WHAT IT BECAME either way.
 *
 * IT NEVER THROWS, and that is the whole reason it exists instead of a
 * `expect(locator).toHaveText(...)`. The scenario that uses it (a sibling tab logging out) can
 * legitimately end with this tab on `atlas.html`, with its execution context destroyed
 * mid-read, or still online — and a locator assertion reports all of those as "element(s) not
 * found", which points nowhere. The caller asserts on the returned snapshot, so the diff names
 * the state instead of the selector. A read that could not run at all comes back as `error`,
 * never as "no overlay".
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} title - Expected `.tab-lock-overlay__title` text.
 * @param {Object} [options]
 * @param {number} [options.timeout=30000]
 * @param {number} [options.intervalMs=250]
 * @returns {Promise<Object>} The last diagnostic read, plus `{ matched: boolean }`.
 */
export async function waitForOverlayTitle(page, title, { timeout = 30000, intervalMs = 250 } = {}) {
    const end = Date.now() + timeout;
    let last = { matched: false, error: 'nenhuma leitura chegou a rodar' };
    while (Date.now() < end) {
        try {
            const diag = await tabDiagnostic(page);
            last = { ...diag, matched: diag.blocked && diag.overlayTitle === title };
            if (last.matched) return last;
        } catch (e) {
            last = { matched: false, error: String(e && e.message ? e.message : e) };
        }
        await page.waitForTimeout(intervalMs).catch(() => {});
    }
    return last;
}

/**
 * Samples the KEYS of one database repeatedly, for a window, without ever creating it.
 *
 * The sibling of `sampleFeatureInDb`, for the question that comes AFTER a destruction rather
 * than during one: "did these databases come BACK". Asked once at the end it is a race — the
 * recreation this guards against is a write arriving from a tab that did not stop, and that
 * write can land at any point in the seconds that follow. Asked over a window, "it never came
 * back" is decided by the whole series.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dbName
 * @param {Object} [options]
 * @param {string} [options.storeName='keyvaluepairs']
 * @param {number} [options.durationMs=6000]
 * @param {number} [options.intervalMs=200]
 * @returns {Promise<Array<{kind: string, n?: number, error?: string}>>} `absent` (no such
 *   database), `empty` (it exists and holds no key), `keys` (it holds `n` keys), `unreadable`.
 */
export async function sampleIdbKeys(page, dbName, {
    storeName = LOCALFORAGE_STORE, durationMs = 6000, intervalMs = 200,
} = {}) {
    const samples = [];
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
        try {
            const r = await readIdbKeys(page, dbName, storeName);
            if (!r.exists) samples.push({ kind: 'absent' });
            else if (r.keys.length === 0) samples.push({ kind: 'empty' });
            else samples.push({ kind: 'keys', n: r.keys.length });
        } catch (e) {
            // A read that could not run is not a measurement, in either direction (same rule as
            // `sampleFeatureInDb`): counting it as "empty" would read a dead execution context
            // as proof that nothing was recreated, which is the assertion we want to earn.
            samples.push({ kind: 'unreadable', error: String(e && e.message ? e.message : e) });
        }
        await page.waitForTimeout(intervalMs);
    }
    return samples;
}

/**
 * Splits a `sampleIdbKeys` series into the four answers it can carry.
 * @param {Array<{kind: string, n?: number}>} samples
 * @returns {{ absent: number, empty: number, withKeys: number, unreadable: number, total: number,
 *   readable: number, maxKeys: number }} `withKeys` is the only evidence of a live (or
 *   recreated) database there is; `readable` is the count the caller must assert is non-trivial.
 */
export function classifyKeySamples(samples) {
    const count = (k) => samples.filter((s) => s.kind === k).length;
    const unreadable = count('unreadable');
    return {
        absent: count('absent'),
        empty: count('empty'),
        withKeys: count('keys'),
        unreadable,
        total: samples.length,
        readable: samples.length - unreadable,
        maxKeys: samples.reduce((m, s) => Math.max(m, s.n || 0), 0),
    };
}

/**
 * Runs a case whose GATE is expected to fail today, in a way that cannot hide a broken harness.
 *
 * THE PROBLEM IT SOLVES. `test.fail()` marks the whole test, so ANY throw counts as the
 * expected failure: a timeout in setup, a renamed selector, a navigation that destroys the
 * execution context. The file's own rule ("read the attached error, it must be the named
 * assertion") is discipline, and discipline was MEASURED to lapse: over six serial runs, one
 * fail-marked case died in `page.evaluate: Execution context was destroyed` with the gate
 * never evaluated, and another tripped on an earlier assertion — both reported, contentedly,
 * as "expected failures".
 *
 * THE MECHANISM. Playwright reports a fail-marked test that PASSES as a run failure. So this
 * helper throws ONLY when the gate failed for the named reason; a broken setup or a failure
 * with any other message RETURNS NORMALLY, which turns the case green, which turns the run
 * red. The evidence is attached either way.
 *
 * THE BUDGET, AND THE HOLE IT CLOSES. `test.fail()` does NOT cover a TIMEOUT: measured in this
 * repo on Playwright 1.61, a fail-marked case killed by the runner's clock is scored `timedOut`
 * against an expected `failed` and reprova a rodada, while the same case failing an assertion
 * is scored as expected. So a pending gate that merely HANGS took the whole run down, and the
 * next real regression would be read as "é o flake de sempre". This helper therefore never lets
 * the runner's clock be what ends the case: it races setup and gate against a deadline of
 * `testInfo.timeout - reserveMs` and, when that deadline wins, calls `test.skip()` AT RUNTIME.
 *
 * `test.skip()` inside the body is Playwright's own escape: it aborts the case and scores it
 * `skipped`, which matches the expected status of a skipped test and leaves the run green,
 * while the reporter prints it as a skip with the reason attached. That is deliberately NOT a
 * pass. A skipped gate measured NOTHING that run, the reason says so in as many words, and the
 * file's opening meta-case already establishes that a skip is not a pass.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Object} spec
 * @param {() => Promise<*>} spec.setup - Everything that must work today. A throw here is a
 *   harness failure, never the defect.
 * @param {(ctx: *) => Promise<void>} spec.gate - The single assertion the etapa closes.
 * @param {string} spec.marca - Substring the gate's failure message must contain.
 * @param {number} [spec.reserveMs=20000] - Slack left to the runner for teardown and reporting.
 * @returns {Promise<{ passed: boolean, context: * }>} `passed` is true only when the gate
 *   itself succeeded, i.e. the defect closed. The context is handed back so the caller can
 *   go on with the rest of the gate instead of building the scenario a second time.
 */
export async function pendingGate(testInfo, { setup, gate, marca, reserveMs = 20000 }) {
    const deadline = Date.now() + Math.max(5000, testInfo.timeout - reserveMs);

    /**
     * Runs one phase against the shared deadline. Never rejects: the phase's own rejection is
     * folded into the result, and the losing promise is neutered so a late throw from an
     * abandoned browser call cannot surface as an unhandled rejection after the case ended.
     * @param {() => Promise<*>} phase
     * @returns {Promise<{done: boolean, value?: *, error?: *}>}
     */
    const withinBudget = async (phase) => {
        const settled = phase().then(
            (value) => ({ done: true, value }),
            (error) => ({ done: true, error }),
        );
        const left = deadline - Date.now();
        if (left <= 0) return { done: false };
        let timer = null;
        const expired = new Promise((resolve) => { timer = setTimeout(() => resolve({ done: false }), left); });
        const result = await Promise.race([settled, expired]);
        if (timer) clearTimeout(timer);
        return result;
    };

    /**
     * Ends the case as a SKIP, with the reason on the record. Not a pass: nothing was measured.
     * @param {string} fase
     * @returns {Promise<never>}
     */
    const semOrcamento = async (fase) => {
        const razao = `ORÇAMENTO ESTOURADO em ${fase}: o portão pendente "${marca}" não mediu nada `
            + 'nesta rodada. Um caso pendente morto pelo relógio do runner reprovaria a rodada '
            + '(test.fail não cobre timeout), então ele é PULADO, e um pulo não é um verde.';
        await testInfo.attach(`ORÇAMENTO ESTOURADO (${fase}) — nada foi medido`, {
            body: razao, contentType: 'text/plain',
        });
        test.skip(true, razao);
        throw new Error('unreachable');
    };

    const montagem = await withinBudget(setup);
    if (!montagem.done) await semOrcamento('setup');
    if (montagem.error) {
        await testInfo.attach('SETUP QUEBRADO (isto NÃO é o defeito esperado)', {
            body: String(montagem.error.stack ? montagem.error.stack : montagem.error),
            contentType: 'text/plain',
        });
        return { passed: false, context: null };
    }
    const context = montagem.value;

    const medicao = await withinBudget(() => gate(context));
    if (!medicao.done) await semOrcamento('gate');
    const erro = medicao.error ?? null;

    if (!erro) {
        await testInfo.attach('O GATE PASSOU', {
            body: `O defeito parece fechado. Remova o test.fail() desta spec no MESMO commit.\nmarca: ${marca}`,
            contentType: 'text/plain',
        });
        return { passed: true, context };
    }

    const mensagem = String(erro.message ?? erro);
    if (!mensagem.includes(marca)) {
        await testInfo.attach('O GATE CAIU POR OUTRO MOTIVO (isto NÃO é o defeito esperado)', {
            body: `esperada a asserção contendo:\n  ${marca}\n\nrecebido:\n${erro.stack ?? mensagem}`,
            contentType: 'text/plain',
        });
        return { passed: false, context };
    }

    throw erro;
}

/**
 * DIAGNOSTIC ONLY — which scope the app module believes is mounted in this tab.
 *
 * Deliberately not load-bearing: it resolves `atlas-namespace.js` through the dev server, and a
 * probe importing a module the app already holds can receive a second instance (HMR `?t=`), in
 * which case `_activeScope` is the probe's, not the app's. Use it to explain a failure, never to
 * decide one; the deciding read is `idbDatabaseNames`.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ kind: string, atlasId: string|null, dbSuffix: string }|null>}
 */
export function activeScopeOf(page) {
    return page.evaluate(async () => {
        try {
            const ns = await import('/src/js/store/atlas-namespace.js');
            return ns.getActiveScope();
        } catch {
            return null;
        }
    });
}

/** Logs out through the real account menu (the only UI path). */
export async function logoutUI(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    const btn = page.locator('[data-testid="account-logout-btn"]');
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();
    await expect(page.locator('[data-testid="account-login-btn"]')).toBeVisible({ timeout: 20000 });
}

/**
 * Attaches the measured namespace picture to the report, so a failure carries the evidence
 * instead of only the assertion that tripped.
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @returns {Promise<string[]>} The names, for the caller to assert on.
 */
export async function attachNamespaces(testInfo, page, label) {
    const names = await idbDatabaseNames(page);
    await testInfo.attach(`indexedDB.databases() — ${label}`, {
        body: names.join('\n'),
        contentType: 'text/plain',
    });
    return names;
}
