// Path: e2e-ui/first-person-collaboration.spec.js
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { seedTileset } from './helpers/catalog-seed.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const museum = new URL('../../public/3d/primeira-pessoa/museu-1cgeo/cena.sog', import.meta.url);
test.describe.configure({ retries: 0, timeout: 180000 });
test.use({ screenshot: 'only-on-failure', trace: 'retain-on-failure' });
test.skip(state.skip || !existsSync(museum), 'Requires the locally installed museum splat and real backend');

async function openMuseum(page, pose) {
    await page.bringToFront();
    await page.evaluate(async (pose) => {
        const viewer = await import('/src/js/first_person_3d_tool/first_person_viewer.js');
        await viewer.openFirstPersonViewer('museu-1cgeo', { pose });
    }, pose);
    await expect(page.locator('#first-person-container')).toBeVisible();
    await expect(page.locator('#first-person-loading')).toBeHidden();
}

test('museum: walker presence, sidebar comment, peer persistence and reopening', async ({ browser }, info) => {
    const db = createDb(state.dbName);
    await seedTileset(state.dbName, { id: 'museu-1cgeo', name: 'Sala Histórica General Malan' });
    await db.raw.none('UPDATE tilesets SET config = $1 WHERE id = $2', [{
        viewer: 'firstPerson', forma3d: 'indoor', basePath: '/3d/primeira-pessoa/museu-1cgeo', fov: 60,
        locate: { lon: -51.2, lat: -30.03 }, poseInicial: { x: 3.82, y: 0.55, z: 1.42, yaw: 0, pitch: 0 },
    }, 'museu-1cgeo']);
    const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'comment' });
    await db.raw.none("UPDATE users SET nome = 'Felipe de Carvalho Diniz', nome_guerra = 'Diniz', rank_id = (SELECT id FROM ranks WHERE nome_abrev = 'Maj' LIMIT 1) WHERE id = $1", [seed.userA.id]);
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
    try {
        await A.setViewportSize({ width: 1000, height: 720 });
        await B.setViewportSize({ width: 1000, height: 720 });
        await test.step('open author museum', () => openMuseum(A));
        await test.step('open peer museum', () => openMuseum(B, { x: 3.82, y: 0.55, z: 3.42, yaw: 0, pitch: 0 }));
        await expect(B.locator('.fp3d-person')).toContainText('Maj Diniz', { timeout: 15000 });
        const readPeer = () => B.evaluate(async () => {
            const { presenceStore } = await import('/src/js/presence/presence-store.js');
            return presenceStore.getCursors('fp', 'museu-1cgeo').find((p) => p.userName === 'Maj Diniz')?.position;
        });
        const before = await readPeer();
        const canvas = A.locator('#first-person-canvas');
        const box = await canvas.boundingBox();
        await A.mouse.move(box.x + 100, box.y + 100);
        await A.mouse.move(box.x + box.width - 100, box.y + box.height - 100);
        await expect.poll(async () => {
            const p = await readPeer(); return Math.hypot(p.x - before.x, p.z - before.z);
        }).toBeLessThan(0.01);
        await A.bringToFront();
        await A.keyboard.down('KeyW');
        await expect.poll(async () => {
            const p = await readPeer(); return Math.hypot(p.x - before.x, p.z - before.z);
        }).toBeGreaterThan(0.15);
        await A.keyboard.up('KeyW');

        // Use the existing sidebar control; no extra comment button in the viewer.
        await A.locator('[data-tab="mapas"]').click();
        await A.locator('[data-testid="comments-new"]').click();
        await expect(A.locator('#first-person-container')).toHaveClass(/fp3d-commenting/);
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await expect(A.locator('.comment-card--compose textarea')).toBeVisible();
        await A.locator('.comment-card--compose textarea').fill('Revisar vitrine do museu');
        await A.locator('.comment-card--compose .comment-composer__btn--primary').click();
        await expect.poll(async () => (await db.raw.any('SELECT data FROM comments WHERE map_id = $1', [seed.mapId])).length).toBe(1);
        const [saved] = await db.raw.any('SELECT id, data FROM comments WHERE map_id = $1', [seed.mapId]);
        expect(saved.data).toMatchObject({ surface: 'fp', tilesetId: 'museu-1cgeo', text: 'Revisar vitrine do museu' });
        expect([saved.data.x, saved.data.y, saved.data.z].every(Number.isFinite)).toBe(true);
        await expect.poll(() => B.evaluate(async (id) => {
            const store = await import('/src/js/store/index.js');
            return (await store.getComments(store.getCurrentMapNameSync()))[id]?.text;
        }, saved.id)).toBe('Revisar vitrine do museu');
        await B.evaluate(async (id) => (await import('/src/js/first_person_3d_tool/first_person_viewer.js')).focusFirstPersonComment(id), saved.id);
        await expect(B.locator('.comment-card')).toContainText('Revisar vitrine');
        await B.locator('.comment-card textarea').fill('Conferido');
        await B.locator('.comment-card .comment-composer__btn--primary').click();
        await expect.poll(async () => (await db.raw.any('SELECT id FROM comments WHERE map_id = $1', [seed.mapId])).length).toBe(2);
        await B.screenshot({ path: info.outputPath('museum-comments-presence.png') });
        await B.locator('#close-first-person-button').click();
        await openMuseum(B);
        await B.evaluate(async (id) => (await import('/src/js/first_person_3d_tool/first_person_viewer.js')).focusFirstPersonComment(id), saved.id);
        await expect(B.locator('.comment-card')).toContainText('Conferido');
        await B.locator('.comment-card textarea').click();
        await expect(B.locator('.comment-card')).toBeVisible();
        await B.locator('#first-person-canvas').click({ position: { x: 30, y: 120 } });
        await expect(B.locator('.comment-card')).toHaveCount(0);
        await A.locator('#close-first-person-button').click();
        await expect(B.locator('.fp3d-person')).toHaveCount(0);
    } finally {
        await Promise.allSettled([A.context().close(), B.context().close()]);
        await closeDb();
    }
});
