// No browser-side source imports: every app action runs from the built production bundle.
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadEbgeoFixture, buildLegacyEntries } from '../helpers/ebgeo-fixture.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';
import { verifyServerBackup } from '../helpers/release-backup.js';
import { readState } from './state.js';
import { startBackend } from './backend.js';
import { STATE_FILE } from './constants.js';

const directory = process.env.EBGEO_MIGRATION_DATA_DIR;
if (!directory) throw new Error('Informe EBGEO_MIGRATION_DATA_DIR.');
const archive = join(directory, '03-completo-2.4.ebgeo');
const hash = () => createHash('sha256').update(readFileSync(archive)).digest('hex');

test.beforeEach(async () => {
    const state = readState();
    // A consistent backup intentionally stops the source. Restart from the NEXT
    // worker: Playwright terminates descendants of the previous worker on Windows.
    // Only this explicit marker permits recovery; an unexpected server crash fails.
    if (state.stoppedForBackup) {
        const resumed = await startBackend({ corsOrigin: 'https://127.0.0.1:44431',
            port: Number(new URL(state.baseUrl).port), dbName: state.dbName, preserveDatabase: true });
        writeFileSync(STATE_FILE, JSON.stringify({ ...state, ...resumed, stoppedForBackup: false }));
    }
    expect((await fetch(state.baseUrl + '/api/v1/health')).status).toBe(200);
});

async function disk(page) {
    return page.evaluate(async () => {
        async function rows(name, pairs = false) {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(name);
                req.onupgradeneeded = () => req.transaction.abort();
                req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
            });
            try {
                return await new Promise((resolve, reject) => {
                    const store = db.transaction('keyvaluepairs').objectStore('keyvaluepairs');
                    const req = pairs ? store.openCursor() : store.getAll();
                    const values = [];
                    req.onsuccess = () => {
                        if (!pairs) { resolve(req.result); return; }
                        const cursor = req.result;
                        if (!cursor) { resolve(values); return; }
                        values.push([cursor.key, cursor.value]);
                        cursor.continue();
                    };
                    req.onerror = () => reject(req.error);
                });
            } finally { db.close(); }
        }
        const names = (await indexedDB.databases()).map(db => db.name);
        const result = {};
        for (const name of names.filter(name => name.startsWith('ebgeo_maps'))) {
            const maps = await rows(name);
            const features = maps.flatMap(map => Object.values(map.features || {}).flatMap(list => Array.isArray(list) ? list : []));
            result[name] = { maps: maps.length, features: features.length, ids: features.map(feature => feature.properties?.id).sort() };
        }
        const registry = names.includes('ebgeo_global') ? await rows('ebgeo_global', true) : [];
        const localDatabases = registry.filter(([key]) => key.startsWith('local_atlas:'))
            .map(([, entry]) => entry.dbSuffix ? `ebgeo_maps__${entry.dbSuffix}` : 'ebgeo_maps');
        return { maps: result, names, localDatabases, secure: isSecureContext, locks: Boolean(navigator.locks) };
    });
}

test('pacote de produção HTTPS migra o acervo 2.4 e preserva os bancos originais após reiniciar', async ({ page }) => {
    const fixture = await loadEbgeoFixture(archive);
    const entries = buildLegacyEntries(fixture, { schemaVersion: '2.4', atlasName: 'Ensaio HTTPS', imageValue: bytes => Array.from(bytes) });
    const names = { maps: 'ebgeo_maps', images: 'ebgeo_images', settings: 'ebgeo_app_settings',
        atlas: 'ebgeo_atlas', groups: 'ebgeo_groups', layers: 'ebgeo_layers', cesium3d: 'ebgeo_cesium3d',
        streetview360: 'ebgeo_streetview360', briefings: 'ebgeo_briefings', comments: 'ebgeo_comments' };
    await page.goto('/__seed__');
    await expect(page.getByTestId('legacy-seed')).toBeAttached();
    expect(await page.evaluate(() => isSecureContext && Boolean(navigator.locks))).toBe(true);
    await page.evaluate(async ({ entries, names }) => {
        for (const [id, values] of Object.entries(entries)) {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(names[id], 2);
                req.onupgradeneeded = () => req.result.createObjectStore('keyvaluepairs');
                req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction('keyvaluepairs', 'readwrite');
                for (const [key, value] of Object.entries(values)) {
                    tx.objectStore('keyvaluepairs').put(
                        id === 'images' ? new Blob([new Uint8Array(value)], { type: 'image/png' }) : value, key);
                }
                tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
            db.close();
        }
    }, { entries, names });
    const before = await disk(page);
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
    await page.reload();
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 60000 });
    const after = await disk(page);
    expect(after.secure && after.locks).toBe(true);
    expect(after.maps.ebgeo_maps).toEqual(before.maps.ebgeo_maps);
    const migrated = Object.entries(after.maps).filter(([name]) => name.includes('__upgrade-'));
    expect(migrated).toHaveLength(1);
    expect(migrated[0][1]).toEqual(before.maps.ebgeo_maps);
    expect(migrated[0][1]).toMatchObject({ maps: 14, features: 805 });
});

test('HTTPS: importar, enviar ao servidor, reiniciar, editar sem rede, recuperar e restaurar backup', async ({ page, context }, testInfo) => {
    const originalHash = hash();
    const errors = [], sockets = [], warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
    page.on('websocket', ws => sockets.push(ws.url()));
    await page.goto('/atlas.html');
    await expect(page.getByTestId('local-atlas-file-input')).toBeAttached({ timeout: 30000 });
    await page.getByTestId('local-atlas-file-input').setInputFiles(archive);
    await expect(page.getByText('14 mapas carregados.', { exact: true })).toBeVisible({ timeout: 90000 });
    const local = await disk(page);
    expect(Object.values(local.maps).some(map => map.features === 805)).toBe(true);
    expect(local.localDatabases.length).toBeGreaterThan(0);
    expect(local.localDatabases.some(name => local.maps[name]?.features === 805)).toBe(true);
    const credentials = await createVerifiedUser({ prefix: 'release', nome: 'Ensaio de release' });
    await page.getByTestId('account-login-btn').click();
    await page.getByTestId('login-username').fill(credentials.username);
    await page.getByTestId('login-password').fill(credentials.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL('**/atlas.html');
    await page.getByTestId('projects-local-map').click();
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 30000 });
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.getByTestId('account-save-server-btn').click();
    await page.getByTestId('create-atlas-name').fill('Acervo real HTTPS');
    await page.getByTestId('create-atlas-confirm').click();
    await expect(page.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'online', { timeout: 90000 });
    await page.waitForURL(/[?&]atlas=/);
    const atlasId = new URL(page.url()).searchParams.get('atlas');
    const api = new ApiClient({ baseUrl: readState().baseUrl + '/api/v1' });
    await api.login(credentials.username, credentials.password);
    const count = snapshot => snapshot.maps.reduce((n, map) => n + Object.values(map.features || {}).reduce((n, list) => n + list.length, 0), 0);
    expect(count((await api.pullSync(atlasId, 0)).snapshot)).toBe(805);
    await page.reload();
    await expect(page.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
    // This isolated backend intentionally serves no external basemap tiles.
    await page.waitForFunction(() => typeof globalThis.__ebgeoMap?.getZoom === 'function', null, { timeout: 30000 });
    // Fail writes at the proxy boundary while retaining normal UI and durable queue.
    await context.route('**/api/v1/atlas/*/sync', route => route.request().method() === 'POST' ? route.abort() : route.continue());
    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click({ timeout: 15000 });
    await page.locator('[data-tool-id="point"]').click({ timeout: 15000 });
    await expect(page.locator('[data-tool-id="point"]')).toHaveAttribute('data-active', 'true').catch(error => {
        error.message += '\nDiagnóstico: ' + JSON.stringify({ errors, warnings: warnings.slice(-20) });
        throw error;
    });
    const canvas = page.locator('canvas.maplibregl-canvas');
    await canvas.click({ position: { x: 650, y: 350 } });
    await page.keyboard.press('Escape');
    await expect.poll(async () => Object.values((await disk(page)).maps).some(map => map.features === 806), { timeout: 20000 }).toBe(true);
    expect(count((await api.pullSync(atlasId, 0)).snapshot)).toBe(805);
    await page.reload();
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 30000 });
    expect(Object.values((await disk(page)).maps).some(map => map.features === 806)).toBe(true);
    await context.unroute('**/api/v1/atlas/*/sync');
    await expect.poll(async () => count((await api.pullSync(atlasId, 0)).snapshot), { timeout: 30000 }).toBe(806);
    const snapshot = (await api.pullSync(atlasId, 0)).snapshot;
    expect(sockets.some(url => url.startsWith('wss://'))).toBe(true);
    expect(errors).toEqual([]);
    const finalDisk = await disk(page);
    // An atomic import leaves the replaced, empty preparation slot on disk until
    // its old mount is released. That retired slot may be collected on navigation.
    // Preserve EVERY published local atlas, including empty ones, by its durable
    // registry identity; counting every temporary database measured garbage retention.
    expect(finalDisk.localDatabases).toEqual(expect.arrayContaining(local.localDatabases));
    for (const name of local.localDatabases) expect(finalDisk.maps[name]).toEqual(local.maps[name]);
    await context.close(); // no writer remains during the backup
    const backup = await verifyServerBackup({ atlasId, credentials, snapshot, outputDir: testInfo.outputPath('backup') });
    await testInfo.attach('release.json', { body: JSON.stringify({ sourceSha256: originalHash, maps: 14, features: 806, https: true, websocketTLS: true, backup }, null, 2), contentType: 'application/json' });
    expect(hash()).toBe(originalHash);
    console.info('RELEASE_BACKUP', JSON.stringify(backup));
});
