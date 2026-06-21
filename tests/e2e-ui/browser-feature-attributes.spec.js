// Path: e2e-ui/browser-feature-attributes.spec.js

/**
 * Browser-level feature CUSTOM ATTRIBUTES transport test. Drives the REAL frontend
 * transport modules (api-client / operation-factory), imported live from the Vite dev
 * server INSIDE real Chromium, against the REAL spawned backend. Every assertion is
 * grounded in observable backend state read back through `api.pullSync` — no mocks.
 *
 * A feature is a GeoJSON Feature; its custom attributes live as loose keys on
 * `properties`. The backend persists a feature `update` op by REPLACING the whole
 * `properties` JSONB (whole-feature last-write-wins — see UPDATE_FIELDS.feature +
 * the "updates feature properties" twin in the backend `features.test.js`). So every
 * attribute mutation is an `update` op carrying the FULL feature with the desired
 * final `properties` object:
 *   - ADD a custom attribute   → update with `properties.<key>` present;
 *   - EDIT its value           → update with `properties.<key>` = new value;
 *   - DELETE the attribute     → update with `properties.<key>` ABSENT.
 *
 * Coverage (§17.11–13 + §18.4–6 of docs/acoes-interface-multiusuario.md):
 *   - §17.11 add a custom attribute to one feature (single feature update);
 *   - §17.12 edit that attribute's value (last-write-wins by key);
 *   - §17.13 delete that attribute (key vanishes from the snapshot properties);
 *   - §18.5 batch "add column": update N features adding the SAME key to all;
 *   - §18.6 batch "delete column": update N features removing the key from all;
 *   - NEGATIVE (§18.6 permission / IDOR): a SECOND user without access to the first
 *     user's atlas cannot push an attribute edit into it — the write is gated
 *     (`requireAtlasPermission('write')` → 403, `pushOperations` rejects).
 *
 * Each test self-provisions its own user(s) + atlas + map for full isolation.
 * The transport is driven entirely through `page.evaluate`; no UI clicks.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature custom attributes (real Chromium + real backend, transport via page.evaluate)', () => {
    test('add → edit → delete a custom attribute on one feature, all verified via pullSync', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `attr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Attr User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Attr Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // A point feature carries its custom attributes as loose keys on properties.
            const featureId = crypto.randomUUID();
            const makeFeature = (props) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Ponto', ...props },
            });

            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', featureId, mapId, makeFeature({})),
            ]);

            const readProps = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const f = (map?.features?.points || []).find((p) => p.properties.id === featureId);
                return f?.properties || null;
            };

            // ---- §17.11 ADD: introduce a brand-new custom attribute ----------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', featureId, mapId, makeFeature({ unidade: '1º BIS' })),
            ]);
            const afterAdd = await readProps();

            // ---- §17.12 EDIT: change the attribute's value (LWW by key) ------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', featureId, mapId, makeFeature({ unidade: '2º BIS' })),
            ]);
            const afterEdit = await readProps();

            // ---- §17.13 DELETE: drop the attribute (key absent in the update) -
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', featureId, mapId, makeFeature({})),
            ]);
            const afterDelete = await readProps();

            return {
                hasToken: Boolean(api.getAccessToken()),
                addValue: afterAdd?.unidade ?? null,
                addKept: afterAdd?.nome ?? null,
                editValue: afterEdit?.unidade ?? null,
                deleteHadKey: afterDelete ? Object.prototype.hasOwnProperty.call(afterDelete, 'unidade') : null,
                deleteKept: afterDelete?.nome ?? null,
            };
        }, state.baseUrl);

        expect(result.hasToken).toBe(true);
        // ADD: the new key is present with its value, and prior props survive.
        expect(result.addValue).toBe('1º BIS');
        expect(result.addKept).toBe('Ponto');
        // EDIT: the value changed in place (last-write-wins by key).
        expect(result.editValue).toBe('2º BIS');
        // DELETE: the key is gone from the persisted properties, others survive.
        expect(result.deleteHadKey).toBe(false);
        expect(result.deleteKept).toBe('Ponto');
    });

    test('batch add column then delete column across N features, verified via pullSync', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `col_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Column User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Column Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // Seed N point features in ONE atomic batch.
            const N = 4;
            const ids = Array.from({ length: N }, () => crypto.randomUUID());
            const makeFeature = (id, props) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: `P-${id.slice(0, 4)}`, ...props },
            });
            await api.pushOperations(
                atlas.id,
                ids.map((id) => createOperation('feature', 'create', id, mapId, makeFeature(id, {}))),
            );

            const readPoints = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                return map?.features?.points || [];
            };

            const propsOf = (points, id) =>
                points.find((p) => p.properties.id === id)?.properties || null;

            // ---- §18.5 ADD COLUMN: same key added to ALL features (batch) ----
            await api.pushOperations(
                atlas.id,
                ids.map((id, i) =>
                    createOperation('feature', 'update', id, mapId, makeFeature(id, { prioridade: i + 1 })),
                ),
            );
            const afterAddColumn = await readPoints();

            // ---- §18.6 DELETE COLUMN: same key removed from ALL features ------
            await api.pushOperations(
                atlas.id,
                ids.map((id) => createOperation('feature', 'update', id, mapId, makeFeature(id, {}))),
            );
            const afterDeleteColumn = await readPoints();

            return {
                count: afterAddColumn.length,
                everyHasColumn: ids.every((id) => {
                    const p = propsOf(afterAddColumn, id);
                    return p != null && Object.prototype.hasOwnProperty.call(p, 'prioridade');
                }),
                // values are per-feature distinct, proving each feature was updated.
                values: ids.map((id) => propsOf(afterAddColumn, id)?.prioridade ?? null),
                everyLostColumn: ids.every((id) => {
                    const p = propsOf(afterDeleteColumn, id);
                    return p != null && !Object.prototype.hasOwnProperty.call(p, 'prioridade');
                }),
                // the features themselves survive the column delete (only the key drops).
                survivors: ids.every((id) => propsOf(afterDeleteColumn, id) != null),
                deleteCount: afterDeleteColumn.length,
            };
        }, state.baseUrl);

        // ADD COLUMN: every feature gained the key, with its own per-feature value.
        expect(result.count).toBe(4);
        expect(result.everyHasColumn).toBe(true);
        expect(result.values).toEqual([1, 2, 3, 4]);
        // DELETE COLUMN: the key is gone everywhere, but the features remain.
        expect(result.everyLostColumn).toBe(true);
        expect(result.survivors).toBe(true);
        expect(result.deleteCount).toBe(4);
    });

    test('NEGATIVE: a second user cannot edit an attribute on another user\'s atlas (write is gated)', async ({
        browser,
    }) => {
        // ---- Owner (user A) seeds an atlas + map + feature ------------------
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await pageA.goto('/');
        const owner = await pageA.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `owner_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Attr Owner' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Owner Attr Atlas' });
            const mapId = crypto.randomUUID();
            const featureId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
                createOperation('feature', 'create', featureId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: featureId, source: 'point', nome: 'Owned', unidade: 'orig' },
                }),
            ]);
            // Stash the authenticated owner client so a later evaluate on this SAME page
            // (same window) can pull the snapshot with the owner token still in hand.
            window.__attrOwnerApi = api;
            return { atlasId: atlas.id, mapId, featureId };
        }, state.baseUrl);

        // ---- Attacker (user B) tries to edit A's feature attribute ----------
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        await pageB.goto('/');
        const attack = await pageB.evaluate(
            async ({ baseUrl, atlasId, mapId, featureId }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                const username = `intruder_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
                const password = 'Sup3r-Secret-Pw!';
                await api.register({ username, password, nome: 'Attr Intruder' });
                await api.login(username, password);

                let threw = false;
                let status = null;
                try {
                    await api.pushOperations(atlasId, [
                        createOperation('feature', 'update', featureId, mapId, {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                            properties: { id: featureId, source: 'point', nome: 'Owned', unidade: 'HACKED' },
                        }),
                    ]);
                } catch (err) {
                    threw = true;
                    status = err?.status ?? err?.statusCode ?? null;
                }
                return { threw, status };
            },
            { baseUrl: state.baseUrl, atlasId: owner.atlasId, mapId: owner.mapId, featureId: owner.featureId },
        );

        // The cross-atlas write must be rejected (gated, not silently accepted).
        expect(attack.threw).toBe(true);

        // ---- And the owner's attribute is UNCHANGED in the persisted snapshot ----
        const ownerValue = await pageA.evaluate(
            async ({ atlasId, mapId, featureId }) => {
                // Reuse the owner's live, authenticated ApiClient stashed on this window.
                const api = window.__attrOwnerApi;
                const pulled = await api.pullSync(atlasId, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const f = (map?.features?.points || []).find((p) => p.properties.id === featureId);
                return f?.properties?.unidade ?? null;
            },
            { atlasId: owner.atlasId, mapId: owner.mapId, featureId: owner.featureId },
        );
        expect(ownerValue).toBe('orig');

        await ctxA.close();
        await ctxB.close();
    });
});
