// Path: tests/helpers/main-profile-upgrade.mjs
// Opt-in production-build crossing: application gestures write data; IndexedDB is read only here.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir, cp, writeFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import setup from '../e2e-ui/global-setup.js';
import teardown from '../e2e-ui/global-teardown.js';
import { readState } from '../e2e-ui/state.js';
import { APP_PORT, APP_ORIGIN, BACKEND_PORT } from '../e2e-ui/constants.js';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mainRoot = resolve(process.env.EBGEO_MAIN_CHECKOUT || join(root, '../.claude/worktrees/migration-main-8b611113'));
const dataRoot = process.env.EBGEO_MIGRATION_DATA_DIR;
assert(dataRoot, 'Informe EBGEO_MIGRATION_DATA_DIR');
const output = resolve(process.env.EBGEO_PROFILE_OUTPUT || join(root, `test-results/main-profile-${Date.now()}`));
await mkdir(output, { recursive: true });
const profile = join(output, 'profile');
const report = { origin: APP_ORIGIN, mainRoot, output, stages: [], errors: [] };
report.commits = { main: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: mainRoot, encoding: 'utf8' }).trim(),
    integration: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), integrationIncludesLocalCorrections: true };
report.builds = {};
for (const [name, directory] of [['main', mainRoot], ['integration', root]]) {
    report.builds[name] = createHash('sha256').update(await readFile(join(directory, 'dist/index.html'))).digest('hex');
}
let server, context, page;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };

async function serve(directory) {
    if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
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
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(APP_PORT, 'localhost', resolve); });
    report.stages.push({ serve: directory, at: new Date().toISOString() });
}

async function launch() {
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    page = context.pages()[0] || await context.newPage();
    page.on('pageerror', error => report.errors.push({ url: page.url(), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') console.info('BROWSER_ERROR', message.text()); });
    await page.goto(APP_ORIGIN);
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
    const notice = page.locator('.server-notice--visible');
    await notice.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await notice.isVisible()) {
        report.stages.push({ notice: await notice.innerText() });
        await notice.getByRole('button').last().click();
    }
}

// Native read-only dump, independent of both applications and their serializers.
async function disk() {
    return page.evaluate(async () => {
        async function encode(value) {
            if (value instanceof Blob) return { $blob: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) };
            if (value instanceof ArrayBuffer) return { $arrayBuffer: Array.from(new Uint8Array(value)) };
            if (ArrayBuffer.isView(value)) return { $typed: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
            if (value instanceof Date) return { $date: value.toISOString() };
            if (Array.isArray(value)) return Promise.all(value.map(encode));
            if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.keys(value).sort().map(async key => [key, await encode(value[key])])));
            return value;
        }
        const databases = {};
        for (const { name } of (await indexedDB.databases()).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!name.startsWith('ebgeo')) continue;
            const db = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
            databases[name] = {};
            try {
                for (const store of db.objectStoreNames) {
                    const raw = await new Promise((resolve, reject) => {
                        const rows = []; const tx = db.transaction(store, 'readonly');
                        const r = tx.objectStore(store).openCursor();
                        r.onsuccess = () => { const c = r.result; if (c) { rows.push([c.key, c.value]); c.continue(); } };
                        tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error);
                    });
                    databases[name][store] = Object.fromEntries(await Promise.all(raw.map(async ([key, value]) => [key, await encode(value)])));
                }
            } finally { db.close(); }
        }
        return { databases, localStorage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])) };
    });
}

function rows(snapshot, name) { return snapshot.databases[name]?.keyvaluepairs || {}; }
function total(snapshot, suffix = '') {
    const maps = rows(snapshot, 'ebgeo_maps' + suffix);
    return { maps: Object.keys(maps).length, features: Object.values(maps).reduce((sum, map) => sum + Object.values(map.features || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0), 0), images: Object.keys(rows(snapshot, 'ebgeo_images' + suffix)).length };
}
async function save(name, value) { await writeFile(join(output, name + '.json'), JSON.stringify(value, null, 2)); }

function compare(before, after, suffix, bootNumber = 0) {
    const differences = [];
    for (const [db, stores] of Object.entries(before.databases)) {
        if (db === 'ebgeo') continue; // The legacy outbound queue is not atlas data.
        for (const [store, records] of Object.entries(stores)) {
            for (const [key, original] of Object.entries(records)) {
                const landed = after.databases[db + suffix]?.[store]?.[key];
                let expected = original;
                if (suffix && db === 'ebgeo_app_settings' && key === 'schemaVersion') expected = '3.0';
                if (suffix && db === 'ebgeo_atlas' && key === 'current_atlas') expected = { ...original, schemaVersion: '3.0' };
                // Opening the active map saves it once: only its sync revision/time advances.
                // All content, entity IDs, creation metadata and other maps stay exact.
                if (suffix && db === 'ebgeo_maps' && key === rows(before, 'ebgeo_app_settings').lastActiveMap) {
                    assert.equal(landed.sync.version, original.sync.version + bootNumber);
                    assert(landed.sync.updatedAt >= original.sync.updatedAt);
                    expected = { ...original, sync: { ...original.sync, version: landed.sync.version, updatedAt: landed.sync.updatedAt } };
                }
                if (JSON.stringify(landed) !== JSON.stringify(expected)) differences.push({ db, store, key, expected, landed });
            }
        }
    }
    for (const [key, value] of Object.entries(before.localStorage)) {
        if (after.localStorage[key] !== value) differences.push({ localStorage: key, expected: value, landed: after.localStorage[key] });
    }
    return differences;
}

try {
    await setup();
    assert.equal(readState().skip, false, 'Backend necessário');
    await serve(join(mainRoot, 'dist'));
    await launch();
    console.info('STAGE main loaded');
    await page.getByRole('button', { name: 'Mapas', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTitle('Abrir projeto (substitui atual)', { exact: true }).click();
    await (await chooser).setFiles(join(dataRoot, '03-completo-2.4.ebgeo'));
    console.info('STAGE file chosen');
    await expect(page.getByText('14 mapas carregados!', { exact: true })).toBeVisible({ timeout: 90000 });
    await expect.poll(async () => total(await disk()).features).toBe(805);
    report.stages.push({ mainImport: total(await disk()) });
    console.info('STAGE', JSON.stringify(report.stages.at(-1)));
    await page.getByRole('button', { name: 'Desenho', exact: true }).click();
    await page.getByRole('button', { name: 'Ponto', exact: true }).click();
    await page.locator('.maplibregl-canvas').click({ position: { x: 770, y: 420 } });
    await page.keyboard.press('Escape');
    await expect.poll(async () => total(await disk()).features).toBe(806);
    await page.locator('.maplibregl-canvas').click({ position: { x: 770, y: 420 } });
    await page.locator('.feature-identification-name').click();
    await page.locator('.feature-identification-name-input').fill('Ponto criado na main: ação e ç');
    await page.locator('.feature-identification-name-input').press('Enter');
    await page.locator('.maplibregl-canvas').click({ position: { x: 1000, y: 600 } });
    await expect.poll(async () => JSON.stringify(await disk()).includes('Ponto criado na main: ação e ç')).toBe(true);
    await page.locator('.maplibregl-canvas').click({ position: { x: 770, y: 420 } });
    await page.locator('.feature-description-add-btn').click();
    await page.locator('.feature-description-textarea').fill('Descrição persistida antes da atualização.');
    await page.locator('.feature-description-save-btn').click();
    await page.screenshot({ path: join(output, 'main-edited-point.png') });
    await page.locator('.maplibregl-canvas').click({ position: { x: 1000, y: 600 } });
    await save('main-edited', await disk());
    report.stages.push({ mainEdit: total(await disk()) });
    console.info('STAGE point edited');
    await context.close();
    await launch();
    await expect.poll(async () => total(await disk()).features).toBe(806);
    await page.getByRole('button', { name: 'Mapas', exact: true }).click();
    await expect(page.locator('#current-map-name-input')).toHaveValue(rows(await disk(), 'ebgeo_app_settings').lastActiveMap);
    await page.locator('#current-map-name-input').fill('Mapa acumulado');
    await page.locator('#current-map-name-input').press('Enter');
    await expect.poll(async () => Object.keys(rows(await disk(), 'ebgeo_maps'))).toContain('Mapa acumulado');
    await page.locator('#current-map-notes-btn').click();
    await page.locator('.map-notes-sidebar-edit-btn').click();
    await page.locator('.map-notes-sidebar-title-input').fill('Notas da segunda sessão');
    await page.locator('.map-notes-quill-editor .ql-editor').fill('Texto criado após fechar e reabrir a main.');
    await page.locator('.map-notes-sidebar-save-btn').click();
    await expect(page.getByText('Notas salvas com sucesso!', { exact: true })).toBeVisible();
    await context.close();
    await launch();
    const before = await disk();
    await save('before-upgrade', before);
    assert.equal(total(before).features, 806);
    assert(rows(before, 'ebgeo_maps')['Mapa acumulado']);
    assert(JSON.stringify(before).includes('Notas da segunda sessão'));
    assert(JSON.stringify(before).includes('Ponto criado na main: ação e ç'));
    report.stages.push({ mainThreeSessions: total(before), queuedOperations: Object.keys(before.databases.ebgeo?.operation_queue || {}).length });
    await page.screenshot({ path: join(output, 'main-before-upgrade.png') });
    await context.close();
    await cp(profile, join(output, 'profile-before-upgrade'), { recursive: true, errorOnExist: true, force: false });
    console.info('STAGE main profile saved; replacing server');
    await serve(join(root, 'dist'));
    await launch();
    for (let i = 0; i < 3; i++) {
        const after = await disk();
        const entries = Object.entries(rows(after, 'ebgeo_global')).filter(([key]) => key.startsWith('local_atlas:'));
        assert.equal(entries.length, 1);
        const suffix = '__' + entries[0][1].dbSuffix;
        const sourceDiff = compare(before, after, '');
        const targetDiff = compare(before, after, suffix, i + 1);
        await save(`differences-${i}`, { sourceDiff, targetDiff });
        await save(`after-upgrade-${i}`, after);
        assert.deepEqual(sourceDiff, []);
        assert.deepEqual(after.databases.ebgeo, before.databases.ebgeo);
        assert.deepEqual(targetDiff.map(({ db, key }) => ({ db, key })), []);
        assert.deepEqual(total(after, suffix), total(before));
        report.stages.push({ integrationBoot: i + 1, ...total(after, suffix), sourceDifferences: sourceDiff.length, targetDifferences: targetDiff.length });
        await page.screenshot({ path: join(output, `integration-${i}.png`) });
        if (i < 2) { await context.close(); await launch(); }
    }
    const baseline = await disk();
    const entry = Object.entries(rows(baseline, 'ebgeo_global')).find(([key]) => key.startsWith('local_atlas:'))[1];
    const suffix = '__' + entry.dbSuffix;
    await page.getByRole('button', { name: 'Desenho', exact: true }).click();
    await page.getByRole('button', { name: 'Ponto', exact: true }).click();
    await page.locator('.maplibregl-canvas').click({ position: { x: 900, y: 500 } });
    await page.keyboard.press('Escape');
    await expect.poll(async () => total(await disk(), suffix).features).toBe(807);
    await context.close();
    await launch();
    const edited = await disk();
    assert.equal(total(edited, suffix).features, 807);
    assert.deepEqual(compare(before, edited, ''), []);
    assert.deepEqual(edited.databases.ebgeo, before.databases.ebgeo);
    const originalMaps = rows(baseline, 'ebgeo_maps' + suffix);
    const editedMaps = rows(edited, 'ebgeo_maps' + suffix);
    for (const [key, originalMap] of Object.entries(originalMaps)) {
        for (const [type, list] of Object.entries(originalMap.features)) {
            if (!Array.isArray(list)) continue;
            for (const feature of list) {
                assert.deepEqual(editedMaps[key].features[type].find(item => item.properties.id === feature.properties.id), feature);
            }
        }
    }
    assert.deepEqual(rows(edited, 'ebgeo_images' + suffix), rows(baseline, 'ebgeo_images' + suffix));
    await save('after-new-integration-edit', edited);
    await page.screenshot({ path: join(output, 'integration-new-edit-reopened.png') });
    report.stages.push({ integrationNewEditReopened: total(edited, suffix), originalFeaturesAndImagesIntact: true });
    assert.deepEqual(report.errors, []);
    report.success = true;
} catch (error) {
    report.failure = error.stack;
    if (page) {
        await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
        await writeFile(join(output, 'failure.html'), await page.content().catch(() => '')).catch(() => {});
    }
    process.exitCode = 1;
} finally {
    await context?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await teardown();
    await save('report', report);
    console.info('PROFILE_REPORT', JSON.stringify(report));
}
