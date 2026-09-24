// Path: tests/helpers/main-aba-aberta.mjs
// Opt-in: a tab of the REAL main build stays open while the origin starts serving the
// integration build, and a second tab opens the new version. Measures what the person sees in
// the new tab, what the old tab writes afterwards, and whether that write reaches the atlas the
// new version opens once the old tab is gone. IndexedDB is read natively, never written.
// Run from frontend/, with a fresh `npm run build`: EBGEO_UI_E2E_APP_PORT=… EBGEO_UI_E2E_BACKEND_PORT=…
// [EBGEO_RUNS=n] [EBGEO_TRAVAR_MS=ms] [EBGEO_BROWSER=firefox] node tests/helpers/main-aba-aberta.mjs
import { chromium, firefox, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import setup from '../e2e-ui/global-setup.js';
import teardown from '../e2e-ui/global-teardown.js';
import { readState } from '../e2e-ui/state.js';
import { APP_PORT, APP_ORIGIN, BACKEND_PORT } from '../e2e-ui/constants.js';

/** `EBGEO_BROWSER=firefox` runs both builds in Firefox. */
const BROWSER = process.env.EBGEO_BROWSER === 'firefox' ? firefox : chromium;

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mainRoot = resolve(process.env.EBGEO_MAIN_CHECKOUT
    || join(root, '../.claude/worktrees/migration-main-8b611113'));
const output = resolve(process.env.EBGEO_PROFILE_OUTPUT || join(root, `test-results/main-aba-aberta-${Date.now()}`));
const RUNS = Number(process.env.EBGEO_RUNS || 1);
const BUSY_MS = Number(process.env.EBGEO_MAIN_BUSY_MS || 0);
/**
 * Hangs the old tab's main thread for this many ms while the new one waits (a HUNG tab). A tab frozen
 * by CDP (`Page.setWebLifecycleState`) is NOT this: measured on 2026-09-23 in headless Chromium,
 * a frozen page still answers BroadcastChannel, so it keeps the new tab waiting until it is closed,
 * which is what the wait screen asks for.
 */
const TRAVAR_MS = Number(process.env.EBGEO_TRAVAR_MS || 0);
const CONGELAR = TRAVAR_MS > 0;
await mkdir(output, { recursive: true });
const report = { origin: APP_ORIGIN, output, runs: [] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf', '.data': 'application/octet-stream' };
let server;

/** Serves `directories` in order: the first that has the file answers (old assets kept on disk). */
async function serve(directories) {
    if (server) { server.closeAllConnections(); await new Promise((ok, ko) => server.close(e => e ? ko(e) : ok())); }
    server = createServer(async (req, res) => {
        if (req.url.startsWith('/api/')) {
            const proxied = request({ hostname: '127.0.0.1', port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers }, reply => {
                res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
            });
            proxied.on('error', () => { res.writeHead(502); res.end(); });
            req.pipe(proxied);
            return;
        }
        const pathname = decodeURIComponent(new URL(req.url, APP_ORIGIN).pathname);
        for (const directory of directories) {
            try {
                const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
                if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) continue;
                res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
                res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
                res.end(await readFile(file));
                return;
            } catch { /* next */ }
        }
        res.writeHead(404); res.end();
    });
    await new Promise((ok, ko) => { server.once('error', ko); server.listen(APP_PORT, 'localhost', ok); });
}

function disk(page) {
    return page.evaluate(async () => {
        const databases = {};
        for (const { name } of (await indexedDB.databases())) {
            if (!name || !name.startsWith('ebgeo')) continue;
            const db = await new Promise((ok, ko) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
            databases[name] = {};
            try {
                for (const store of db.objectStoreNames) {
                    databases[name][store] = await new Promise((ok, ko) => {
                        const out = {}; const tx = db.transaction(store, 'readonly');
                        const r = tx.objectStore(store).openCursor();
                        r.onsuccess = () => { const c = r.result; if (c) { const v = c.value; out[c.key] = v instanceof Blob ? { blob: v.size } : v; c.continue(); } };
                        tx.oncomplete = () => ok(out); tx.onerror = () => ko(tx.error);
                    });
                }
            } finally { db.close(); }
        }
        return { databases };
    });
}
const rows = (snap, name) => snap.databases[name]?.keyvaluepairs || {};
function names(snap, suffix) {
    const out = [];
    for (const doc of Object.values(rows(snap, 'ebgeo_maps' + suffix))) {
        for (const list of Object.values(doc?.features || {})) if (Array.isArray(list)) for (const f of list) out.push(f?.properties?.nome);
    }
    return out.filter(Boolean).sort();
}

async function activateTool(page, label) {
    const tool = page.getByRole('button', { name: label, exact: true });
    if (!(await tool.isVisible().catch(() => false))) {
        await page.getByRole('button', { name: 'Desenho', exact: true }).click();
        await tool.waitFor({ state: 'visible', timeout: 10000 });
    }
    await tool.click();
}

/** Same gesture as `main-round-trip.mjs`: draw, name, save, deselect; exit condition is the DISK. */
async function drawNamedPoint(page, position, nome, suffix = '') {
    await activateTool(page, 'Ponto');
    await page.locator('.maplibregl-canvas').click({ position });
    await page.keyboard.press('Escape');
    await expect.poll(async () => {
        const teto = { timeout: 4000 };
        try {
            await page.locator('.maplibregl-canvas').click({ position, ...teto });
            const salvar = page.locator('.feature-panel .attr-modern-btn-save').first();
            if (!await salvar.isVisible({ timeout: 8000 }).catch(() => false)) return 'sem salvar';
            const display = page.locator('.feature-identification-name').first();
            if (!await display.isVisible(teto).catch(() => false)) return 'sem painel';
            const antes = await display.textContent(teto).catch(() => null);
            await display.dispatchEvent('click', undefined, teto);
            const input = page.locator('.feature-identification-name-input:not(.feature-identification-name-input--hidden)').first();
            if (!await input.isVisible(teto).catch(() => false)) return 'sem campo';
            await input.fill(antes === nome ? `${nome} (rascunho)` : nome, teto);
            await input.press('Enter', teto);
            await salvar.dispatchEvent('click', undefined, teto);
            await page.locator('.maplibregl-canvas').click({ position: { x: 1120, y: 300 }, ...teto });
        } catch (error) { return `gesto: ${error.message.split('\n')[0]}`; }
        return names(await disk(page), suffix).filter(n => n === nome).length;
    }, { timeout: 120000, intervals: [750] }).toBe(1);
}

async function outcome(page, timeout = 120000) {
    await page.waitForFunction(() => {
        const s = document.querySelector('[data-testid="migration-recovery"]');
        if (s && !/Preparando seus dados/.test(s.textContent)) return true;
        return Boolean(document.querySelector('#nav-btn-zoom-in'));
    }, null, { timeout });
    const recovery = await page.locator('[data-testid="migration-recovery"]').innerText().catch(() => null);
    const overlay = await page.locator('.tab-lock-overlay--visible').innerText().catch(() => null);
    return { map: await page.locator('#nav-btn-zoom-in').count() > 0 && !recovery, recovery, overlay };
}

async function run(index) {
    const r = { index, steps: {} };
    report.runs.push(r);
    const profile = join(output, `profile-${index}`);
    await serve([join(mainRoot, 'dist')]);
    const context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    try {
        const a = context.pages()[0] || await context.newPage();
        const errors = [];
        a.on('pageerror', e => errors.push({ tab: 'A-main', message: e.message }));
        await a.goto(APP_ORIGIN);
        await expect(a.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
        await a.waitForTimeout(2000); // main's tab-lock probe window (1.5 s) must close to answer PING
        await drawNamedPoint(a, { x: 560, y: 380 }, 'Antes do deploy');
        r.steps.mainAntes = names(await disk(a), '');

        // THE DEPLOY: the origin serves the integration; old assets stay reachable for tab A.
        await serve([join(root, 'dist'), join(mainRoot, 'dist')]);
        if (BUSY_MS) a.evaluate(ms => { const end = Date.now() + ms; while (Date.now() < end) { /* busy */ } }, BUSY_MS).catch(() => {});
        const b = await context.newPage();
        b.on('pageerror', e => errors.push({ tab: 'B-integracao', message: e.message }));
        await b.goto(APP_ORIGIN);
        r.steps.bPrimeiro = await outcome(b);
        r.steps.bPrimeiro.botoes = await b.locator('[data-testid="migration-recovery"] button').allInnerTexts().catch(() => []);
        await b.screenshot({ path: join(output, `run${index}-b-primeiro.png`) });
        let snap = await disk(b);
        r.steps.transicaoAposB = rows(snap, 'ebgeo_global').legacy_transition_v1?.status ?? null;

        if (CONGELAR) {
            // THE BROWSER FREEZES THE OLD TAB (hidden-tab freezing): it stops answering, and the new
            // tab must not wait forever. Then it thaws and writes, which is the late write the
            // transition absorbs or rescues.
            const t0 = Date.now();
            const travada = a.evaluate((ms) => { const fim = Date.now() + ms; while (Date.now() < fim) { /* hung */ } }, TRAVAR_MS)
                .catch(() => {});
            await expect(b.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
            await expect(b.locator('[data-testid="migration-recovery"]')).toHaveCount(0, { timeout: 60000 });
            r.steps.bSeguiuComAntigaTravadaMs = Date.now() - t0;
            await travada;
        }
        // THE OLD TAB KEEPS WORKING after the new version opened.
        await a.bringToFront();
        await drawNamedPoint(a, { x: 700, y: 440 }, 'Aba antiga depois do deploy');
        r.steps.mainDepois = names(await disk(a), '');
        await b.bringToFront();
        await b.waitForTimeout(1500);
        r.steps.bDepoisDaEscritaAntiga = await outcome(b, 20000);

        // The person closes the old tab. The new one goes on BY ITSELF (no click, no reload) when it
        // was waiting; when it had already gone on (frozen variant) the late write enters on reload.
        await a.close();
        const t1 = Date.now();
        if (CONGELAR) await b.reload();
        await expect(b.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
        await expect(b.locator('[data-testid="migration-recovery"]')).toHaveCount(0, { timeout: 90000 });
        r.steps.bSeguiuSozinhaMs = Date.now() - t1;
        r.steps.bRecarregada = await outcome(b);
        await b.waitForTimeout(3000);
        snap = await disk(b);
        const state = rows(snap, 'ebgeo_global').legacy_transition_v1;
        const entries = Object.entries(rows(snap, 'ebgeo_global')).filter(([k]) => k.startsWith('local_atlas:')).map(([, v]) => v);
        r.steps.final = {
            status: state?.status, late: state?.late ?? null, lateConflict: state?.lateConflict ?? null,
            atlas: entries.map(e => ({ name: e.name, dbSuffix: e.dbSuffix })),
            porAtlas: Object.fromEntries(entries.map(e => [e.name + ' ' + e.dbSuffix, names(snap, '__' + e.dbSuffix)])),
            legado: names(snap, ''),
        };
        await b.screenshot({ path: join(output, `run${index}-b-final.png`) });
        r.errors = errors;
        const everywhere = Object.values(r.steps.final.porAtlas).flat();
        r.ok = r.steps.bRecarregada.map && ['Antes do deploy', 'Aba antiga depois do deploy'].every(n => everywhere.includes(n));
    } finally {
        await context.close().catch(() => {});
    }
    console.info('RUN', index, JSON.stringify(r));
}

try {
    await setup();
    assert.equal(readState().skip, false, 'Backend necessário');
    for (let i = 0; i < RUNS; i++) {
        try { await run(i); } catch (error) { report.runs.at(-1).failure = error.stack; console.info('RUN_FAIL', i, error.message); }
    }
} finally {
    if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
    await teardown();
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.info('REPORT_AT', output);
}
