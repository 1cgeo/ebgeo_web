// Path: tests/e2e-ui/viewer-360-cancel-marker.spec.js

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readState } from './state.js';
import { seedSv360Photo } from './helpers/catalog-seed.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';
import { STATE_FILE } from './constants.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend');

async function seedPanorama() {
    const photo = await seedSv360Photo(state.dbName);
    const db = createDb(state.dbName);
    const photoId = crypto.randomUUID().replace(/^(.{14})./, '$15');
    await db.raw.none('UPDATE sv360.photos SET id = $1 WHERE id = $2', [photoId, photo.photoId]);
    const require = createRequire(new URL('../../../backend/package.json', import.meta.url));
    const Database = require('better-sqlite3');
    const sharp = require('sharp');
    const pixels = await sharp({ create: { width: 512, height: 256, channels: 3, background: '#547b92' } }).webp().toBuffer();
    const dir = path.resolve(fileURLToPath(new URL('../../../backend/', import.meta.url)), process.env.SV360_DB_DIR ?? 'data/sv360');
    mkdirSync(dir, { recursive: true });
    const filename = path.join(dir, `${photo.slug}_tiles.db`);
    // SQLite workers keep this file open on Windows. Remove it only after the
    // harness stops the backend, even when a browser assertion fails.
    const runState = readState();
    writeFileSync(STATE_FILE, JSON.stringify({ ...runState, temporaryFiles: [...(runState.temporaryFiles ?? []), filename] }));
    const sqlite = new Database(filename);
    try {
        sqlite.exec('CREATE TABLE tiles (photo_id TEXT, level INTEGER, x INTEGER, y INTEGER, webp BLOB, PRIMARY KEY(photo_id, level, x, y))');
        sqlite.prepare('INSERT INTO tiles VALUES (?, 0, 0, 0, ?)').run(photoId, pixels);
    } finally { sqlite.close(); }
    await db.raw.none(`INSERT INTO sv360.photo_pyramids
        (photo_id, tile_size, max_level, width, height, quality, tile_count, total_bytes)
        VALUES ($1, 512, 0, 512, 256, 80, 1, $2)`, [photoId, pixels.length]);
    return { ...photo, photoId };
}

test('Escape and chip close cancel marker placement, then M can activate it again', async ({ browser }, info) => {
    const { photoName, photoId } = await seedPanorama();
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    try {
        // openClient uses a cross-origin bearer session. Panorama fetches use the
        // app origin's cookie, as in production; establish it through real login.
        const login = await page.request.post('/api/v1/auth/login', {
            data: { username: seed.userA.username, password: seed.userA.password },
        });
        expect(login.ok()).toBe(true);
        const metadata = await page.request.get(`${state.baseUrl}/api/v1/sv360/photos/${photoId}`);
        expect(metadata.status(), await metadata.text()).toBe(200);
        await page.evaluate(async (name) => {
            const api = await import('/src/js/street_view_tool/streetview-api.service.js');
            await api.fetchPhotoMetadata(name);
            const viewer = await import('/src/js/street_view_tool/street_view_viewer.js');
            await viewer.openViewer360WithPhoto(name);
        }, photoId);
        await expect.poll(() => page.evaluate(async () => {
            const viewer = await import('/src/js/street_view_tool/street_view_viewer.js');
            return viewer.getNavigator()?.cameraConfig?.img;
        })).toBe(photoName);
        const viewer = page.locator('#street-view-container');
        const button = page.locator('#add-marker-360');
        const chip = page.locator('#active-tool-chip-360');
        const canvas = page.locator('#streetview-nav-canvas');
        const count = () => page.evaluate(async (name) => {
            const store = await import('/src/js/store/index.js');
            return (await store.getMarkers360(name)).length;
        }, photoName);
        for (const action of ['Escape', 'close']) {
            await button.click();
            await expect(button).toHaveClass(/active/);
            await expect(viewer).toHaveClass(/marker-tool-active/);
            if (action === 'Escape') await page.keyboard.press('Escape');
            else await page.locator('#active-tool-chip-360-close').click();
            await expect(button).not.toHaveClass(/active/);
            await expect(chip).toBeHidden();
            await expect(viewer).toBeVisible();
            await expect(viewer).not.toHaveClass(/marker-tool-active/);
            await canvas.click({ position: { x: 600, y: 300 } });
            expect(await count()).toBe(0);
        }
        await page.screenshot({ path: info.outputPath('360-marker-cancelled.png') });
        // Positive control: this same canvas and photo really can create a marker.
        await page.keyboard.press('m');
        await expect(button).toHaveClass(/active/);
        // Exceed the former delayed hide: reactivation must keep its chip visible.
        await page.waitForTimeout(250);
        await expect(chip).toBeVisible();
        await canvas.click({ position: { x: 600, y: 300 } });
        await expect.poll(count).toBe(1);
        await expect(chip).toBeHidden();
    } finally {
        await page.context().close();
        await closeDb();
    }
});
