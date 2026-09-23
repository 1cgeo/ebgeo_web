// Path: tests/e2e-ui/release-large-atlas.scenario.js

/**
 * @fileoverview Opt-in release scenario: an atlas map with TENS OF THOUSANDS of features, opened by
 * a real client, edited, reloaded and listed. It came from the launch audit of 2026-09-22 and
 * entered the repository by the owner's decision D2 of 2026-09-23. It runs only through
 * `playwright.release-large-atlas.config.js` (`npm run test:e2e:atlas-grande`); the normal
 * `test:e2e:ui` never collects a `*.scenario.js`.
 *
 * TWO FAMILIES, because the feature list takes two different paths:
 *   - UNGROUPED, 1 000 and 10 000 points: each one becomes a `.feature-item` of its layer;
 *   - ONE GROUP holding everything, 10 000 and 30 000 points: each one becomes a
 *     `.group-feature-item`, and the organizer (`organizeFeaturesByLayers`) is timed five times on
 *     the live store. Its DOM count (121 741 nodes for 30 000 grouped features, 2026-09-22) is the
 *     figure cited in `docs/wiki/desempenho-do-mapa-2d.md` for the unvirtualized list.
 *
 * WHAT EVERY CASE ASSERTS, at four stages (initial snapshot, edit confirmed by SQL, reload, list):
 * the client's IndexedDB holds exactly the seeded ids (count AND a SHA-256 of the sorted set), the
 * MapLibre source carries all of them, one property edit made through the store reaches
 * PostgreSQL, the list draws one row per feature, and no page threw.
 *
 * THE SEED GOES STRAIGHT INTO POSTGRESQL, on purpose: pushing 30 000 creates through the sync
 * endpoint would measure the push, not the opening of a large atlas, and would take longer than the
 * case itself. The rows are what the snapshot serves, so the client under test receives them
 * through the real `connect` path.
 *
 * THE TIMINGS ARE PRINTED, NOT ASSERTED. Each stage logs `elapsedMs` and the DOM node count
 * (`[large-atlas]`, `[large-group-organize]`) and writes `large-atlas.json`; `heap` is Chromium's
 * `performance.memory` and is null in Firefox. They were taken on a busy machine and are an order
 * of magnitude, not a budget.
 */

import { test, expect } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, openLayersTab } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
test.beforeAll(() => expect(state.skip, 'backend de teste obrigatório').toBe(false));

/** Order-independent fingerprint of an id set. */
const hash = (ids) => createHash('sha256').update(ids.slice().sort().join('\n')).digest('hex');

const EDITED_NAME = 'Edited large atlas';

/**
 * Inserts `count` points into the seeded map, in batches of 1 000, and optionally one group holding
 * all of them.
 * @param {ReturnType<typeof createDb>} db
 * @param {string} mapId
 * @param {number} count
 * @param {{ grouped: boolean }} options
 * @returns {Promise<string[]>} The ids, in insertion order.
 */
async function seedPoints(db, mapId, count, { grouped }) {
    const records = Array.from({ length: count }, (_, i) => {
        const id = randomUUID();
        return {
            id,
            geometry: { type: 'Point', coordinates: [-43.2 + (i % 100) * 0.0001, -22.9 + Math.floor(i / 100) * 0.0001] },
            properties: {
                id, source: 'point', nome: `Point ${i}`, size: 6, color: '#ff5500', visivel: true,
                layerId: 'default', createdAt: Date.now(),
            },
        };
    });
    for (let offset = 0; offset < count; offset += 1000) {
        await db.raw.none(`INSERT INTO features (id, map_id, feature_type, geometry, properties)
            SELECT id, $1::uuid, 'point', geometry, properties
            FROM jsonb_to_recordset($2::jsonb) AS r(id uuid, geometry jsonb, properties jsonb)`,
        [mapId, JSON.stringify(records.slice(offset, offset + 1000))]);
    }
    if (grouped) {
        const groupId = randomUUID();
        await db.raw.none('INSERT INTO groups (id, map_id, name) VALUES ($1, $2, $3)', [groupId, mapId, 'Large group']);
        await db.raw.none('INSERT INTO group_features (group_id, feature_id) SELECT $1, id FROM features WHERE map_id = $2',
            [groupId, mapId]);
    }
    return records.map((record) => record.id);
}

const CASES = [
    { count: 1000, grouped: false },
    { count: 10000, grouped: false },
    { count: 10000, grouped: true },
    { count: 30000, grouped: true },
];

for (const { count, grouped } of CASES) {
    const label = grouped ? `${count} points in one group` : `${count} ungrouped points`;
    test(`large atlas, ${label}: initial snapshot, local edit, reload and layer list`, async ({ browser }, testInfo) => {
        test.setTimeout(600000);
        const db = createDb(state.dbName);
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const ids = await seedPoints(db, seed.mapId, count, { grouped });
        const expectedHash = hash(ids);
        const started = Date.now();
        let page;
        const report = { count, grouped, browser: testInfo.project.name, errors: [], stages: [] };
        const measure = async (stage) => {
            const stored = await page.evaluate(async (mapId) => {
                const { getRepository } = await import('/src/js/store/repositories/index.js');
                return (await getRepository().getMap(mapId)).features.points.map((row) => row.properties.id);
            }, seed.mapId);
            expect(stored.length).toBe(count);
            expect(hash(stored)).toBe(expectedHash);
            const ui = await page.evaluate(() => ({
                nodes: document.querySelectorAll('*').length,
                heap: performance.memory?.usedJSHeapSize ?? null,
            }));
            report.stages.push({ stage, elapsedMs: Date.now() - started, ...ui });
            console.log('[large-atlas]', JSON.stringify({ label, ...report.stages.at(-1) }));
        };
        try {
            page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
            page.on('pageerror', (error) => report.errors.push(error.message));
            await expect(page.locator('.loading-background')).toHaveCount(0);
            await measure('initial snapshot');

            await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.195, -22.895], zoom: 13 }));
            await expect.poll(() => page.evaluate(async () =>
                (await globalThis.__ebgeoMap.getSource('points')?.getData())?.features.length), { timeout: 60000 }).toBe(count);

            const editStart = Date.now();
            await page.evaluate(async ({ id, name }) => {
                const store = await import('/src/js/store/index.js');
                await store.updateFeatureProperty('points', id, 'nome', name);
            }, { id: ids[0], name: EDITED_NAME });
            report.editMs = Date.now() - editStart;
            await expect.poll(async () => (await db.raw.one('SELECT properties FROM features WHERE id = $1', [ids[0]])).properties.nome,
                { timeout: 60000 }).toBe(EDITED_NAME);
            await measure('edited and confirmed by SQL');

            await page.reload();
            await expect(page.locator('.loading-background')).toHaveCount(0, { timeout: 60000 });
            await expect.poll(() => page.evaluate(() => !!globalThis.__ebgeoMap?.getZoom), { timeout: 60000 }).toBe(true);
            await measure('reload');

            if (grouped) {
                report.organizeMs = await page.evaluate(async () => {
                    const store = await import('/src/js/store/index.js');
                    const { organizeFeaturesByLayers } = await import('/src/js/features_tab/feature-organizer.service.js');
                    const features = await store.getCurrentMapFeatures();
                    const samples = [];
                    for (let i = 0; i < 5; i += 1) {
                        const t = performance.now();
                        const layers = await organizeFeaturesByLayers(features);
                        samples.push({
                            ms: performance.now() - t,
                            grouped: layers.reduce((n, layer) => n + [...layer.groups.values()]
                                .reduce((sum, group) => sum + group.features.length, 0), 0),
                        });
                    }
                    return samples;
                });
                expect(report.organizeMs.map((row) => row.grouped)).toEqual(Array(5).fill(count));
                console.log('[large-group-organize]', JSON.stringify(report.organizeMs));
            }

            const listStart = Date.now();
            await openLayersTab(page);
            await expect(page.locator(grouped ? '.group-feature-item' : '.feature-item')).toHaveCount(count, { timeout: 90000 });
            report.listMs = Date.now() - listStart;
            await measure('layer list');
            await page.screenshot({ path: testInfo.outputPath('large-atlas.png') });
            expect(report.errors).toEqual([]);
        } finally {
            await writeFile(testInfo.outputPath('large-atlas.json'), JSON.stringify(report, null, 2));
            await page?.context().close();
            await closeDb();
        }
    });
}
