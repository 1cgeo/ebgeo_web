// Path: tests/helpers/main-profile-envio.mjs
// Opt-in: a rich acervo written by the REAL build of main, carried to the integration build on the
// same origin, then sent to the server from atlas.html and compared field by field with what the
// person sees after the atlas opens. IndexedDB is read natively and never written by this script.
// Run from frontend/, with a fresh `npm run build` and the main worktree's dist (EBGEO_MAIN_CHECKOUT
// points elsewhere): EBGEO_UI_E2E_APP_PORT=… EBGEO_UI_E2E_BACKEND_PORT=… EBGEO_MIGRATION_DATA_DIR=…
// node tests/helpers/main-profile-envio.mjs. Output: report.json and compare-*.json under test-results/.
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
import { createVerifiedUser } from '../e2e-ui/helpers/accounts.js';

/** `EBGEO_BROWSER=firefox` runs both builds in Firefox. */
const BROWSER = process.env.EBGEO_BROWSER === 'firefox' ? firefox : chromium;

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mainRoot = resolve(process.env.EBGEO_MAIN_CHECKOUT
    || join(root, '../.claude/worktrees/migration-main-8b611113'));
const dataRoot = process.env.EBGEO_MIGRATION_DATA_DIR;
assert(dataRoot, 'Informe EBGEO_MIGRATION_DATA_DIR');
const FIXTURE = process.env.EBGEO_ENVIO_FIXTURE || '03-completo-2.4.ebgeo';
const output = resolve(process.env.EBGEO_PROFILE_OUTPUT || join(root, `test-results/main-envio-${Date.now()}`));
await mkdir(output, { recursive: true });
const profile = join(output, 'profile');
const report = { origin: APP_ORIGIN, mainRoot, output, stages: [], errors: [], console: [] };
let server, context, page;
let servedFrom = null;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.pbf': 'application/x-protobuf', '.data': 'application/octet-stream' };

async function serve(directory, label) {
    if (server) {
        server.closeAllConnections();
        await new Promise((ok, ko) => server.close(e => e ? ko(e) : ok()));
    }
    servedFrom = label;
    server = createServer(async (req, res) => {
        if (req.url.startsWith('/api/')) {
            const proxied = request({ hostname: '127.0.0.1', port: BACKEND_PORT, path: req.url, method: req.method, headers: req.headers }, reply => {
                res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
            });
            proxied.on('error', () => { res.writeHead(502); res.end(); });
            req.pipe(proxied);
            return;
        }
        try {
            const pathname = decodeURIComponent(new URL(req.url, APP_ORIGIN).pathname);
            const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(directory + sep) || !(await stat(file)).isFile()) { res.writeHead(404); res.end(); return; }
            res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
            res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
            res.end(await readFile(file));
        } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((ok, ko) => { server.once('error', ko); server.listen(APP_PORT, 'localhost', ok); });
    report.stages.push({ serve: label, at: new Date().toISOString() });
}

async function launch(path = '/') {
    context = await BROWSER.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => report.errors.push({ build: servedFrom, url: page.url(), message: error.message }));
    page.on('console', message => {
        const t = message.text();
        if (message.type() === 'error' || message.type() === 'warning') report.console.push({ build: servedFrom, type: message.type(), text: t.slice(0, 400) });
    });
    await page.addInitScript(() => {
        const guardar = (texto) => {
            try {
                const atual = JSON.parse(localStorage.getItem('__toasts__') || '[]');
                atual.push(texto); localStorage.setItem('__toasts__', JSON.stringify(atual));
            } catch { /* ignore */ }
        };
        const observar = () => new MutationObserver((ms) => {
            for (const m of ms) {
for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                const alvo = n.classList?.contains('toast') ? n : n.querySelector?.('.toast');
                if (alvo) guardar(`${alvo.className}\n${alvo.textContent}`);
            }
}
        }).observe(document.body, { childList: true, subtree: true });
        if (document.body) observar(); else document.addEventListener('DOMContentLoaded', observar, { once: true });
    });
    await page.goto(APP_ORIGIN + path);
}

async function waitMap() {
    // The progress card and the recovery screen share one testid; only the second is an outcome.
    await page.waitForFunction(() => {
        const s = document.querySelector('[data-testid="migration-recovery"]');
        if (s && !/Preparando seus dados/.test(s.textContent)) return true;
        return Boolean(document.querySelector('#nav-btn-zoom-in'));
    }, null, { timeout: 180000 });
    if (!await page.locator('#nav-btn-zoom-in').count()) {
        report.recoveryScreen = await page.locator('[data-testid="migration-recovery"]').innerText().catch(() => '');
        assert.fail('a tela de recuperação apareceu no lugar do mapa: ' + report.recoveryScreen);
    }
    const notice = page.locator('.server-notice--visible');
    await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await notice.isVisible().catch(() => false)) await notice.getByRole('button').last().click().catch(() => {});
}

// Native read-only dump. Blobs become {type,size,sha} so images compare by content.
async function disk() {
    return page.evaluate(async () => {
        async function sha(buf) {
            const d = await crypto.subtle.digest('SHA-256', buf);
            return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
        }
        async function encode(value) {
            if (value instanceof Blob) return { $blob: value.type, size: value.size, sha: await sha(await value.arrayBuffer()) };
            if (value instanceof ArrayBuffer) return { $arrayBuffer: value.byteLength, sha: await sha(value) };
            if (ArrayBuffer.isView(value)) return { $typed: value.constructor.name, size: value.byteLength };
            if (Array.isArray(value)) return Promise.all(value.map(encode));
            if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async k => [k, await encode(value[k])])));
            return value;
        }
        const databases = {};
        for (const { name } of (await indexedDB.databases()).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!name || !name.startsWith('ebgeo')) continue;
            const db = await new Promise((ok, ko) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
            databases[name] = {};
            try {
                for (const store of db.objectStoreNames) {
                    const raw = await new Promise((ok, ko) => {
                        const out = []; const tx = db.transaction(store, 'readonly');
                        const r = tx.objectStore(store).openCursor();
                        r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } };
                        tx.oncomplete = () => ok(out); tx.onerror = () => ko(tx.error);
                    });
                    databases[name][store] = Object.fromEntries(await Promise.all(raw.map(async ([k, v]) => [k, await encode(v)])));
                }
            } finally { db.close(); }
        }
        return { databases, localStorage: Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])) };
    });
}
const rows = (snap, name) => snap.databases[name]?.keyvaluepairs || {};
function totalFeatures(maps) {
    return Object.values(maps).reduce((s, m) => s + Object.values(m?.features || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0), 0);
}
async function save(name, value) { await writeFile(join(output, name + '.json'), JSON.stringify(value, null, 2)); }

// ---- Comparison ------------------------------------------------------------------------------
const IGNORED_PROPS = new Set(['layerId', 'groupId', 'createdAt', 'updatedAt', 'version', 'sync']);
function diffValues(a, b, path, out) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffValues(a[k], b[k], `${path}.${k}`, out);
        return;
    }
    out.push({ path, local: a, remote: b });
}
function mapByName(maps) {
    const out = {};
    for (const [key, doc] of Object.entries(maps)) out[doc?.name && !/^[0-9a-f-]{36}$/i.test(doc.name) ? doc.name : key] = { key, doc };
    return out;
}
function compareAtlas(local, remote, localSuffix, remoteSuffix) {
    const summary = { maps: {}, propertyLoss: {}, structural: [] };
    const lMaps = rows(local, 'ebgeo_maps' + localSuffix);
    const rMaps = rows(remote, 'ebgeo_maps' + remoteSuffix);
    const lByName = {};
    for (const [key, doc] of Object.entries(lMaps)) lByName[key] = { key, doc };
    const rByName = mapByName(rMaps);
    summary.localMaps = Object.keys(lByName).sort();
    summary.remoteMaps = Object.keys(rByName).sort();
    for (const [name, { key: lk, doc: ld }] of Object.entries(lByName)) {
        const r = rByName[name];
        if (!r) { summary.structural.push({ map: name, missing: 'map' }); continue; }
        const rd = r.doc;
        const m = { features: {}, fields: [] };
        for (const field of ['baseLayer', 'zoom', 'center_lat', 'center_long', 'bearing', 'pitch']) {
            if (JSON.stringify(ld[field]) !== JSON.stringify(rd[field])) m.fields.push({ field, local: ld[field], remote: rd[field] });
        }
        const buckets = new Set([...Object.keys(ld.features || {}), ...Object.keys(rd.features || {})]);
        for (const b of buckets) {
            const ll = Array.isArray(ld.features?.[b]) ? ld.features[b] : [];
            const rl = Array.isArray(rd.features?.[b]) ? rd.features[b] : [];
            if (ll.length !== rl.length) m.features[b] = { local: ll.length, remote: rl.length };
            const rById = new Map(rl.map(f => [f?.properties?.id, f]));
            for (const f of ll) {
                let g = rById.get(f?.properties?.id);
                if (!g && b === 'images') g = rl.find(x => x?.properties?.nome === f?.properties?.nome && JSON.stringify(x.geometry) === JSON.stringify(f.geometry));
                if (!g) { (m.missingIds ||= []).push(`${b}:${f?.properties?.id}`); continue; }
                if (JSON.stringify(f.geometry) !== JSON.stringify(g.geometry)) (summary.propertyLoss[`${b}.geometry`] ||= []).push(`${name}:${f.properties.id}`);
                const diffs = [];
                for (const k of new Set([...Object.keys(f.properties || {}), ...Object.keys(g.properties || {})])) {
                    if (IGNORED_PROPS.has(k)) continue;
                    if (b === 'images' && k === 'id') continue;
                    if (JSON.stringify(f.properties[k]) !== JSON.stringify(g.properties[k])) diffs.push(k);
                }
                for (const k of diffs) {
                    const entry = summary.propertyLoss[`${b}.${k}`] ||= { count: 0, sample: null };
                    entry.count++;
                    if (!entry.sample) entry.sample = { map: name, id: f.properties.id, local: f.properties[k], remote: g.properties[k] };
                }
            }
        }
        // Side stores, keyed by map key locally and by map id remotely.
        const side = (db, key) => [rows(local, db + localSuffix)[key.replace('$', lk)], rows(remote, db + remoteSuffix)[key.replace('$', r.key)]];
        const sides = {
            layers: side('ebgeo_layers', 'layers_$'),
            activeLayer: side('ebgeo_layers', 'activeLayer_$'),
            groups: side('ebgeo_groups', '$'),
            cesium3d: side('ebgeo_cesium3d', 'cesium3d_$'),
            streetview360: side('ebgeo_streetview360', 'streetview360_$'),
            notes: side('ebgeo_app_settings', 'map_notes_$'),
            grid: side('ebgeo_app_settings', 'gridStyle_$'),
            temporal: [rows(local, 'ebgeo_app_settings' + localSuffix)[`temporal_${name}`], rows(remote, 'ebgeo_app_settings' + remoteSuffix)[`temporal_${name}`]],
            locked: [rows(local, 'ebgeo_app_settings' + localSuffix)[`mapLocked_${name}`], rows(remote, 'ebgeo_app_settings' + remoteSuffix)[`mapLocked_${name}`]],
        };
        m.sides = {};
        for (const [s, [a, b]] of Object.entries(sides)) {
            if (a == null && b == null) continue;
            const out = [];
            diffValues(a, b, s, out);
            m.sides[s] = out.length ? { differences: out.length, first: out.slice(0, 6), local: a === undefined ? 'undefined' : undefined } : 'equal';
        }
        summary.maps[name] = m;
    }
    for (const name of Object.keys(rByName)) if (!lByName[name]) summary.structural.push({ map: name, extra: 'map' });
    // Atlas-wide stores.
    const lBr = Object.values(rows(local, 'ebgeo_briefings' + localSuffix));
    const rBr = Object.values(rows(remote, 'ebgeo_briefings' + remoteSuffix));
    summary.briefings = { local: lBr.length, remote: rBr.length, detail: [] };
    for (const b of lBr) {
        const g = rBr.find(x => x?.name === b?.name) || rBr.find(x => x?.id === b?.id);
        if (!g) { summary.briefings.detail.push({ name: b?.name, missing: true }); continue; }
        const out = [];
        diffValues({ ...b, slides: undefined, createdAt: undefined, updatedAt: undefined, id: undefined, sync: undefined },
            { ...g, slides: undefined, createdAt: undefined, updatedAt: undefined, id: undefined, sync: undefined }, 'briefing', out);
        const ls = b.slides || []; const rs = g.slides || [];
        const slideDiffs = [];
        for (let i = 0; i < Math.max(ls.length, rs.length); i++) {
            const so = [];
            const strip = s => s && ({ ...s, id: undefined, createdAt: undefined, updatedAt: undefined, sync: undefined });
            diffValues(strip(ls[i]), strip(rs[i]), `slide[${i}]`, so);
            if (so.length) slideDiffs.push(...so.slice(0, 8));
        }
        summary.briefings.detail.push({ name: b.name, slides: [ls.length, rs.length], fieldDiffs: out, slideDiffs });
    }
    const lImg = rows(local, 'ebgeo_images' + localSuffix.replace(/__generation-[^_]+$/, ''));
    summary.images = { local: Object.keys(lImg).length };
    const lSet = rows(local, 'ebgeo_app_settings' + localSuffix);
    const rSet = rows(remote, 'ebgeo_app_settings' + remoteSuffix);
    const out = [];
    diffValues(lSet.custom_icons, rSet.custom_icons, 'custom_icons', out);
    summary.customIcons = out.length ? out.slice(0, 5) : 'equal';
    summary.mapOrder = { local: lSet.mapOrder, remote: rSet.mapOrder };
    summary.mapBadgeColors = { local: lSet.mapBadgeColors, remote: rSet.mapBadgeColors };
    return summary;
}

try {
    await setup();
    assert.equal(readState().skip, false, 'Backend necessário');
    await serve(join(mainRoot, 'dist'), 'main');
    await launch('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
    const notice = page.locator('.server-notice--visible');
    await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await notice.isVisible()) await notice.getByRole('button').last().click();
    await page.getByRole('button', { name: 'Mapas', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTitle('Abrir projeto (substitui atual)', { exact: true }).click();
    await (await chooser).setFiles(join(dataRoot, FIXTURE));
    await expect(page.getByText(/mapas? carregados?!/)).toBeVisible({ timeout: 120000 });
    await page.waitForTimeout(3000);
    const before = await disk();
    await save('main-disk', before);
    const mainTotal = totalFeatures(rows(before, 'ebgeo_maps'));
    report.stages.push({ main: { maps: Object.keys(rows(before, 'ebgeo_maps')).length, features: mainTotal, images: Object.keys(rows(before, 'ebgeo_images')).length, briefings: Object.keys(rows(before, 'ebgeo_briefings')).length } });
    console.info('STAGE main', JSON.stringify(report.stages.at(-1)));
    await context.close();

    await serve(join(root, 'dist'), 'integration');
    await launch('/');
    await waitMap();
    const migrated = await disk();
    await save('integration-disk', migrated);
    const state = rows(migrated, 'ebgeo_global').legacy_transition_v1;
    assert(state?.destination, 'transição não registrada');
    const localSuffix = '__' + state.destination;
    report.stages.push({ migrated: { suffix: localSuffix, features: totalFeatures(rows(migrated, 'ebgeo_maps' + localSuffix)) } });
    console.info('STAGE migrated', JSON.stringify(report.stages.at(-1)));
    const migratedCompare = compareAtlas(before, migrated, '', localSuffix);
    await save('compare-main-vs-migrated', migratedCompare);

    const conta = await createVerifiedUser({ prefix: 'envio' });
    await page.goto(APP_ORIGIN + '/atlas.html');
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(conta.username);
    await page.locator('[data-testid="login-password"]').fill(conta.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="local-atlas-item"]').first()).toBeVisible({ timeout: 30000 });
    const cartao = page.locator('[data-testid="local-atlas-item"]').first();
    await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
    await page.locator('[data-testid="local-atlas-send-to-server"]').click();
    await page.locator('[data-testid="local-atlas-name-input"]').fill('Envio rico da main');
    await page.locator('[data-testid="local-atlas-name-confirm"]').click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(output, 'after-send-click.png') });
    // A missing-image question may appear; accept it if so and record.
    const confirm = page.locator('.confirm-modal-confirm, [data-testid="confirm-modal-confirm"]');
    await confirm.first().waitFor({ state: 'visible', timeout: 15000 }).then(async () => {
        report.stages.push({ confirm: await page.locator('.confirm-modal-message').first().innerText().catch(() => '') });
        await confirm.first().click();
    }).catch(() => {});
    // Success navigates; a warning (pruned catalog refs, missing images) stays on the list.
    await page.waitForFunction(() => /[?&]atlas=/.test(location.search)
        || JSON.parse(localStorage.getItem('__toasts__') || '[]').some(t => /enviado ao servidor|não foi|falhou/i.test(t)),
    null, { timeout: 300000 });
    let atlasId = new URL(page.url()).searchParams.get('atlas');
    if (!atlasId) {
        report.stages.push({ stayedOnList: await page.evaluate(() => JSON.parse(localStorage.getItem('__toasts__') || '[]')) });
        const list = await fetch(`${readState().baseUrl}/api/v1/atlas`, { headers: { Authorization: `Bearer ${conta.accessToken}` } }).then(r => r.json());
        const items = list?.data?.atlases ?? list?.data ?? list;
        atlasId = (Array.isArray(items) ? items : []).find(a => a.name === 'Envio rico da main')?.id;
        assert(atlasId, 'o atlas enviado não aparece na lista do servidor: ' + JSON.stringify(list).slice(0, 400));
        await page.goto(`${APP_ORIGIN}/?atlas=${atlasId}`);
    }
    await waitMap();
    await page.waitForTimeout(5000);
    const toasts = await page.evaluate(() => JSON.parse(localStorage.getItem('__toasts__') || '[]'));
    report.stages.push({ sent: atlasId, toasts });
    console.info('STAGE sent', atlasId, JSON.stringify(toasts));
    const remote = await disk();
    await save('remote-disk', remote);
    const genKey = Object.keys(remote.localStorage).find(k => k.endsWith('remote-' + atlasId));
    const gen = genKey ? JSON.parse(remote.localStorage[genKey]).active : null;
    const remoteSuffix = `__remote-${atlasId}` + (gen ? `__generation-${gen}` : '');
    report.stages.push({ remoteSuffix, remoteFeatures: totalFeatures(rows(remote, 'ebgeo_maps' + remoteSuffix)) });
    const summary = compareAtlas(migrated, remote, localSuffix, remoteSuffix);
    summary.remoteImages = Object.keys(rows(remote, `ebgeo_images__remote-${atlasId}`)).length;
    await save('compare-migrated-vs-server', summary);
    report.summary = summary;
    report.success = true;
} catch (error) {
    report.failure = error.stack;
    if (page) {
        await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
        report.toastsAtFailure = await page.evaluate(() => JSON.parse(localStorage.getItem('__toasts__') || '[]')).catch(e => String(e));
    }
    process.exitCode = 1;
} finally {
    await context?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
    await teardown();
    await save('report', report);
    console.info('REPORT_AT', output);
}
