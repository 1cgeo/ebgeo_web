// Path: e2e-ui/browser-admin-catalog.spec.js

/**
 * Browser click-through of the ADMIN PANEL → Catálogo tab, in real Chromium against the REAL
 * spawned backend. The catalog manages METADATA only (the `config` JSONB, edited as JSON) — never
 * files. A global admin registers a `data_layer` resource through the JSON editor; it appears in the
 * list and propagates into GET /config (dataLayers). A second test deletes it; a third confirms the
 * 360 tab loads (metadata view, no bundle upload).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

async function seedAdmin(page, baseUrl, dbName) {
    await page.goto('/');
    const creds = await page.evaluate(async (url) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        const username = `catadmin_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Cat Admin' });
        return { username, password: 'Sup3r-Secret-Pw!' };
    }, baseUrl);
    await createDb(dbName).raw.none(
        "UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER($1)", [creds.username]);
    return creds;
}

async function loginAndOpenCatalog(page, baseUrl, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.locator('[data-testid="project-picker-cancel"]').click();
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.locator('[data-testid="admin-tab-catalog"]').click();
    await expect(page.locator('[data-testid="admin-cat-data_layer"]')).toBeVisible({ timeout: 5000 });
}

describeOrSkip('Admin panel — Catálogo tab (real browser + real backend)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('registers a data layer (JSON config) and it propagates to GET /config', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `dl_${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="admin-cat-data_layer"]').click();
        await page.locator('[data-testid="admin-catalog-new"]').click();
        await expect(page.locator('[data-testid="admin-catalog-form"]')).toBeVisible({ timeout: 5000 });

        await page.locator('[data-testid="admin-catalog-id"]').fill(id);
        await page.locator('[data-testid="admin-catalog-name"]').fill('Camada de Teste');
        // The JSON editor is prefilled with a valid data_layer template — set a concrete config.
        await page.locator('[data-testid="admin-catalog-config"]').fill(JSON.stringify({
            source: { type: 'vector', url: '/cms/martin/teste' },
            sourceLayer: 'teste',
            minzoom: 4,
            maxzoom: 18,
        }));
        await page.locator('[data-testid="admin-catalog-save"]').click();

        // Back to the list; the new resource is shown.
        await expect(page.locator('[data-testid="admin-catalog-list"]')).toContainText(id, { timeout: 10000 });

        // Reload and confirm the resource propagated into GET /config (dataLayers).
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
        const found = await page.evaluate(async (layerId) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const cfg = await apiClient.getConfig();
            return (cfg.dataLayers?.layers ?? []).some((l) => l.id === layerId);
        }, id);
        expect(found).toBe(true);
    });

    test('deletes a catalog resource', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `dl_${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="admin-cat-data_layer"]').click();
        await page.locator('[data-testid="admin-catalog-new"]').click();
        await page.locator('[data-testid="admin-catalog-id"]').fill(id);
        await page.locator('[data-testid="admin-catalog-name"]').fill('Para Excluir');
        await page.locator('[data-testid="admin-catalog-config"]').fill('{"source":{"type":"vector","url":"/x"},"sourceLayer":"x"}');
        await page.locator('[data-testid="admin-catalog-save"]').click();
        await expect(page.locator('[data-testid="admin-catalog-list"]')).toContainText(id, { timeout: 10000 });

        const row = page.locator('[data-testid="admin-catalog-row"]', { hasText: id });
        await row.locator('[data-testid="admin-catalog-delete"]').click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();
        await expect(page.locator('[data-testid="admin-catalog-row"]', { hasText: id })).toHaveCount(0, { timeout: 10000 });
    });

    test('the 360 tab loads the metadata view', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);
        await page.locator('[data-testid="admin-cat-sv360"]').click();
        await expect(page.locator('[data-testid="admin-360-list"]')).toBeVisible({ timeout: 10000 });
    });

    test('a basemap style override is validated and propagates to basemapStyles (F6)', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `bm_${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="admin-cat-basemap"]').click();
        await page.locator('[data-testid="admin-catalog-new"]').click();
        await page.locator('[data-testid="admin-catalog-id"]').fill(id);
        await page.locator('[data-testid="admin-catalog-name"]').fill('Basemap Custom');

        // An invalid MapLibre style (version 7) is blocked inline before any save.
        await page.locator('[data-testid="admin-catalog-config"]').fill('{"enabled":true,"style":{"version":7,"sources":{},"layers":[]}}');
        await page.locator('[data-testid="admin-catalog-save"]').click();
        await expect(page.locator('[data-testid="admin-catalog-error"]')).toContainText('Estilo MapLibre inválido', { timeout: 5000 });

        // A valid style saves and propagates into basemapStyles.
        await page.locator('[data-testid="admin-catalog-config"]').fill(JSON.stringify({
            enabled: true,
            priority: 9,
            style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background' }] },
        }));
        await page.locator('[data-testid="admin-catalog-save"]').click();
        await expect(page.locator('[data-testid="admin-catalog-list"]')).toContainText(id, { timeout: 10000 });

        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
        const styleOk = await page.evaluate(async (bid) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const cfg = await apiClient.getConfig();
            const s = cfg.basemapStyles?.[bid];
            return !!s && s.version === 8 && Array.isArray(s.layers);
        }, id);
        expect(styleOk).toBe(true);
    });

    test('uploads a thumbnail for a data layer — embedded as a data URL in config', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginAndOpenCatalog(page, state.baseUrl, admin);

        const id = `dl_${Math.random().toString(36).slice(2, 8)}`;
        await page.locator('[data-testid="admin-cat-data_layer"]').click();
        await page.locator('[data-testid="admin-catalog-new"]').click();
        await page.locator('[data-testid="admin-catalog-id"]').fill(id);
        await page.locator('[data-testid="admin-catalog-name"]').fill('Com Thumb');
        await page.locator('[data-testid="admin-catalog-config"]').fill('{"source":{"type":"vector","url":"/x"},"sourceLayer":"x"}');

        // Pick a tiny PNG; the form downscales it and embeds it as a data URL (no out-of-band serving).
        const png = globalThis.Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        await page.locator('[data-testid="admin-catalog-thumbnail"]')
            .setInputFiles({ name: 't.png', mimeType: 'image/png', buffer: png });
        await expect(page.locator('.admin-thumb__preview'))
            .toHaveAttribute('src', /^data:image/, { timeout: 5000 });

        await page.locator('[data-testid="admin-catalog-save"]').click();
        await expect(page.locator('[data-testid="admin-catalog-list"]')).toContainText(id, { timeout: 10000 });

        // The stored resource carries the thumbnail as an embedded data URL.
        const thumb = await page.evaluate(async (rid) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const items = await apiClient.listResources('data_layer');
            return (items || []).find((r) => r.id === rid)?.config?.thumbnail ?? null;
        }, id);
        expect(thumb).toMatch(/^data:image/);
    });
});
