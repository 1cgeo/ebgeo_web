// Path: tests/helpers/main-rollback-novo.mjs
// Opt-in: the ROLLBACK of production to the previous version. The person works in the new version,
// production goes back to the REAL build of main and the person only OPENS it, then production comes
// forward again. Measures which atlas opens and whether a "Recuperado" is born. EBGEO_MODE=existente
// starts from work done in main before the deploy; the default starts from a person who only ever
// used the new version. IndexedDB is read natively, never written.
// Run from frontend/, with a fresh `npm run build`: EBGEO_UI_E2E_APP_PORT=… EBGEO_UI_E2E_BACKEND_PORT=…
// [EBGEO_MODE=existente] [EBGEO_BROWSER=firefox] node tests/helpers/main-rollback-novo.mjs
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

async function writeNotes(page, title, body) {
    await page.getByRole('button', { name: 'Mapas', exact: true }).click();
    await page.locator('#current-map-notes-btn').click();
    await page.locator('.map-notes-sidebar-edit-btn').click();
    await page.locator('.map-notes-sidebar-title-input').fill(title);
    await page.locator('.map-notes-quill-editor .ql-editor').fill(body);
    await page.locator('.map-notes-sidebar-save-btn').click();
    await expect(page.getByText(/^Notas salvas(?: com sucesso!|.)$/)).toBeVisible({ timeout: 20000 });
}

function notasPorEscopo(snap) {
    const out = {};
    for (const [db, stores] of Object.entries(snap.databases)) {
        if (!db.startsWith('ebgeo_app_settings')) continue;
        for (const [k, v] of Object.entries(stores.keyvaluepairs || {})) if (k.startsWith('map_notes_')) out[db + ' ' + k] = v?.title;
    }
    return out;
}

async function run(index) {
    const r = { index, steps: {} };
    report.runs.push(r);
    const profile = join(output, `profile-${index}`);
    let context;
    let page;
    if (process.env.EBGEO_MODE === 'existente') {
        // 0) A person of the previous version has work in it before the deploy.
        await serve([join(mainRoot, 'dist')]);
        context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
        page = context.pages()[0] || await context.newPage();
        await page.goto(APP_ORIGIN);
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
        await page.waitForTimeout(2000);
        await drawNamedPoint(page, { x: 560, y: 380 }, 'Feito na main antes do deploy');
        await context.close();
    }
    // 1) The new version: migrates (when there is anything) and the person works in it.
    await serve([join(root, 'dist')]);
    context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    page = context.pages()[0] || await context.newPage();
    await page.goto(APP_ORIGIN);
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
    await writeNotes(page, 'Trabalho feito na versão nova', 'Corpo.');
    const antes = await disk(page);
    r.steps.passo1 = notasPorEscopo(antes);
    await context.close();
    // 2) ROLLBACK: the origin serves main again; the person only OPENS it.
    await serve([join(mainRoot, 'dist')]);
    context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    page = context.pages()[0] || await context.newPage();
    await page.goto(APP_ORIGIN);
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(4000);
    const depois = await disk(page);
    r.steps.passo2 = { notas: notasPorEscopo(depois), legado: Object.keys(rows(depois, 'ebgeo_maps')) };
    // WHAT MAIN WROTE by only opening: every unsuffixed record that differs.
    const mudou = [];
    for (const db of new Set([...Object.keys(antes.databases), ...Object.keys(depois.databases)])) {
        if (db.includes('__') || db === 'ebgeo_global') continue;
        const a = antes.databases[db]?.keyvaluepairs || {}; const b = depois.databases[db]?.keyvaluepairs || {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const va = JSON.stringify(a[k]); const vb = JSON.stringify(b[k]);
            if (va === vb) continue;
            const campos = [];
            if (a[k] && b[k] && typeof a[k] === 'object') for (const c of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) if (JSON.stringify(a[k][c]) !== JSON.stringify(b[k][c])) campos.push(c);
            mudou.push({ db, k, novo: a[k] === undefined, campos: campos.slice(0, 8), antes: va?.slice(0, 160), depois: vb?.slice(0, 160) });
        }
    }
    r.steps.mainEscreveuAoAbrir = mudou;
    await page.screenshot({ path: join(output, `run${index}-main-rollback.png`) });
    await context.close();
    // 3) FORWARD again.
    await serve([join(root, 'dist')]);
    context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 } });
    page = context.pages()[0] || await context.newPage();
    const toasts = [];
    page.on('console', (m) => { if (/Atualiza/.test(m.text())) toasts.push(m.text().slice(0, 300)); });
    await page.goto(APP_ORIGIN);
    await page.waitForFunction(() => {
        const s = document.querySelector('[data-testid="migration-recovery"]');
        if (s && !/Preparando seus dados/.test(s.textContent)) return true;
        return Boolean(document.querySelector('#nav-btn-zoom-in'));
    }, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    const snap = await disk(page);
    const global = rows(snap, 'ebgeo_global');
    const entries = Object.entries(global).filter(([k]) => k.startsWith('local_atlas:')).map(([, v]) => v);
    r.steps.passo3 = {
        recovery: await page.locator('[data-testid="migration-recovery"]').innerText().catch(() => null),
        toast: await page.locator('.toast').allInnerTexts().catch(() => []),
        console: toasts,
        atlas: entries.map(e => ({ name: e.name, dbSuffix: e.dbSuffix })),
        atual: global.current_local_atlas ?? Object.entries(global).find(([k]) => /current/i.test(k))?.[1],
        notas: notasPorEscopo(snap),
        titulo: await page.locator('#current-map-name-input').inputValue().catch(() => null),
    };
    await page.screenshot({ path: join(output, `run${index}-volta.png`) });
    await context.close();
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
