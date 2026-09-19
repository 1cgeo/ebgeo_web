// Real archive parser, migration, Chromium, HTTP and PostgreSQL. Only the upload-failure
// scenario intercepts a request. Synthetic archives make each damaged field intentional.
import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

test.describe.configure({ retries: 0 });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const oldMapId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const point = (id, source, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -15] }, properties: { id, source, ...extra } });
function document(version = '1.7') {
    return { version, maps: { Principal: { id: oldMapId, features: {
        images: [point('legacy-photo', 'image')],
        points: [point('legacy-point', 'point', { markerSymbol: 'custom:legacy-icon' })],
        magnetic_declinations: [point('declination', 'magnetic_declination', { declinacao: -21.3, convergencia: 0 })],
        barrier_lines: [{ ...point('barrier', 'barrier_line'), geometry: { type: 'LineString', coordinates: [[-47, -15], [-46, -14]] } }],
    } } }, customIcons: [{ id: 'legacy-icon', name: 'Icone antigo' }],
    briefings: [{ id: 'briefing', name: 'Briefing', slides: [{ id: 'slide', mapId: oldMapId }] }],
    cesium3d: { Principal: { markers: [{ id: 'marker', images: ['legacy-photo'] }] } } };
}
async function archive(data, { missing = false, masked = true } = {}) {
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(data));
    if (!missing) zip.file('images/legacy-photo.png', png);
    zip.file('images/legacy-icon.png', png);
    const raw = await zip.generateAsync({ type: 'uint8array' });
    return Array.from(masked ? Buffer.concat([Buffer.from('EBGXOR'), raw.map(byte => byte ^ 0xaa)]) : raw);
}
async function setup(page) {
    const state = readState();
    expect(state.skip, 'This audit requires the real disposable backend').toBeFalsy();
    const user = await createVerifiedUser({ prefix: 'migration', nome: 'Migration Audit' });
    await page.route('**/__migration_audit', route => route.fulfill({ contentType: 'text/html', body: '<title>Migration audit</title>' }));
    await page.goto('/__migration_audit');
    await page.evaluate(async ({ username, password }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        window.auditApi = new ApiClient({ baseUrl: '/api/v1' });
        await window.auditApi.login(username, password);
        window.auditImport = (await import('/src/js/projects/import-ebgeo.service.js')).importEbgeoAsAtlas;
    }, { baseUrl: state.baseUrl, username: user.username, password: user.password });
}

test('masked v1 import twice preserves images, legacy fields and references on the real server', async ({ page }) => {
    await setup(page);
    const result = await page.evaluate(async bytes => {
        const file = new File([new Uint8Array(bytes)], 'legacy.ebgeo');
        const imports = [];
        for (let i = 0; i < 2; i++) {
            const imported = await window.auditImport(file, { apiClient: window.auditApi });
            const pulled = await window.auditApi.pullSync(imported.atlasId, 0);
            const map = pulled.snapshot.maps[0];
            const photoId = map.features.images[0].properties.id;
            const iconId = map.features.points[0].properties.markerSymbol.slice('custom:'.length);
            const decoded = [];
            for (const id of [photoId, iconId]) {
                const blob = await window.auditApi.fetchImageBlob(imported.atlasId, id);
                const bitmap = await createImageBitmap(blob);
                decoded.push({ bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), width: bitmap.width, height: bitmap.height });
                bitmap.close();
            }
            imports.push({ imported, map, photoId, iconId, decoded, briefings: pulled.snapshot.briefings });
        }
        return imports;
    }, await archive(document()));
    expect(result[0].imported.atlasId).not.toBe(result[1].imported.atlasId);
    expect(result[0].photoId).not.toBe(result[1].photoId);
    expect(result[0].iconId).not.toBe(result[1].iconId);
    for (const item of result) {
        expect(item.imported.imageStats).toEqual({ total: 2, uploaded: 2, skipped: 0, failed: 0 });
        expect(item.decoded).toEqual([0, 1].map(() => ({ bytes: Array.from(png), width: 1, height: 1 })));
        expect(item.map.features.magnetic_declinations[0].properties).toMatchObject({ declination: -21.3, convergence: 0 });
        expect(item.map.features.coordination_lines).toHaveLength(1);
        expect(JSON.stringify(item.map.cesium3dData || item.map.cesium3d)).toContain(item.photoId);
        expect(JSON.stringify(item.briefings)).toContain(item.map.id);
        expect(JSON.stringify(item.briefings)).not.toContain(oldMapId);
    }
});

test('invalid versions and missing image bytes produce no server import request', async ({ page }) => {
    await setup(page);
    let posts = 0;
    page.on('request', request => { if (request.method() === 'POST' && /\/atlas\/imports?/.test(request.url())) posts++; });
    const files = await Promise.all([
        archive(document('1.2')), archive(document('future')),
        archive({ ...document(), atlas: { schemaVersion: '99.0' } }),
        archive(document(), { missing: true }),
    ]);
    const errors = await page.evaluate(async files => {
        const errors = [];
        for (const bytes of files) {
            try {
                await window.auditImport(new File([new Uint8Array(bytes)], 'invalid.ebgeo'), { apiClient: window.auditApi });
                errors.push(null);
            } catch (error) { errors.push(error.message); }
        }
        return errors;
    }, files);
    expect(errors.every(error => typeof error === 'string' && error.length > 0)).toBe(true);
    expect(posts).toBe(0);
});

test('connection loss during preparation publishes nothing; retry after reload resumes the same attempt', async ({ page }) => {
    await setup(page);
    const attempts = [];
    page.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/atlas/imports')) attempts.push(request.postDataJSON().id);
    });
    await page.route('**/atlas/imports/*/images', route => route.abort('connectionfailed'));
    const bytes = await archive(document('1.7'), { masked: false });
    const first = await page.evaluate(async bytes => {
        try { await window.auditImport(new File([new Uint8Array(bytes)], 'retry.ebgeo'), { apiClient: window.auditApi }); } catch (error) { return { stage: error.stage, attempts: await window.auditApi.listAtlas() }; }
    }, bytes);
    expect(first.stage).toBe('preparation');
    expect(first.attempts).toEqual([]);
    await page.unroute('**/atlas/imports/*/images');
    await page.reload();
    const retried = await page.evaluate(async bytes => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient(); api.loadStoredTokens();
        const { importEbgeoAsAtlas } = await import('/src/js/projects/import-ebgeo.service.js');
        const result = await importEbgeoAsAtlas(new File([new Uint8Array(bytes)], 'retry.ebgeo'), { apiClient: api });
        const pulled = await api.pullSync(result.atlasId, 0);
        const blob = await api.fetchImageBlob(result.atlasId, pulled.snapshot.maps[0].features.images[0].properties.id);
        return { result, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), atlas: await api.listAtlas() };
    }, bytes);
    expect(attempts).toHaveLength(1);
    expect(retried.atlas).toHaveLength(1);
    expect(retried.result.imageStats).toEqual({ total: 2, uploaded: 2, skipped: 0, failed: 0 });
    expect(retried.bytes).toEqual(Array.from(png));
});

test('a lost final response recovers the receipt and does not publish twice', async ({ page }) => {
    await setup(page);
    await page.route('**/atlas/imports/*/commit', async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort('connectionfailed');
    });
    const result = await page.evaluate(async bytes => {
        const imported = await window.auditImport(new File([new Uint8Array(bytes)], 'confirmed.ebgeo'), { apiClient: window.auditApi });
        return { imported, atlas: await window.auditApi.listAtlas() };
    }, await archive(document()));
    expect(result.atlas).toHaveLength(1);
    expect(result.atlas[0].id).toBe(result.imported.atlasId);
    expect(result.imported.imageStats.uploaded).toBe(2);
});

test('the chooser explains a preparation failure and remains on the atlas list', async ({ page }, testInfo) => {
    await setup(page);
    await page.goto('/atlas.html');
    const input = page.getByTestId('project-picker-import-input');
    await expect(input).toBeAttached();
    await page.route('**/atlas/imports/*/images', route => route.abort('connectionfailed'));
    await input.setInputFiles({ name: 'incomplete.ebgeo', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive(document())) });
    await expect(page.getByText(/concluir ou confirmar/)).toBeVisible();
    await expect(page).toHaveURL(/atlas\.html$/);
    await page.screenshot({ path: testInfo.outputPath('import-preparation-failed.png') });
});
