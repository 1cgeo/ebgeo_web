// Path: e2e-ui/browser-briefing-slides.spec.js

/**
 * Browser-level briefing + slide lifecycle test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside real
 * Chromium, against the REAL backend sync pipeline (`POST /atlas/:id/sync`).
 *
 * Briefings and their slides are collaborative entities, so EVERY mutation here travels
 * as a CRDT sync operation (never a REST write). This proves, end to end in a browser:
 *   - `briefing` `create` persists a briefing addressable in the snapshot;
 *   - three `slide` `create` ops (each carrying `data.briefing_id` + a per-slide
 *     `temporal_cursor`) attach to that briefing, and the snapshot surfaces the
 *     camelCase `temporalCursor` plus a positional `order`;
 *   - a `briefing` `update` carrying `data.slide_order` reorders the slides (the
 *     snapshot `order` index follows the new array, NOT insertion order);
 *   - a `slide` `delete` soft-deletes one slide (it vanishes from the snapshot) while
 *     the survivors keep their order relative to the remaining `slide_order` entries.
 *
 * Each test seeds its OWN user + atlas + map + briefing for isolation. The single
 * client drives the whole flow over the browser's own fetch/CORS stack. A CONTA, porém,
 * não nasce aqui dentro: ela vem pronta de `helpers/accounts.js`, no lado Node, porque
 * confirmar o e-mail exige ler `email_verification_tokens` no Postgres, que o contexto do
 * browser não alcança. O `page.evaluate` faz só o `login()`.
 *
 * no-UI (UI-first exception): this spec is a BACKEND SYNC-CONTRACT test, not a user-flow
 * test. Every assertion reads the raw `pullSync` SNAPSHOT and pins transport/server
 * semantics that the UI neither drives nor exposes — the canonical `slide_order`,
 * the positional `order` index (NOT insertion order), the camelCase `temporalCursor`
 * surfaced per slide, and the SOFT-DELETE removal from the snapshot. The briefing editor
 * UI (briefing-editor.control.js) has no control that sets a per-slide temporal_cursor,
 * no way to push a bare `briefing` `slide_order` reorder op, and no view of the snapshot
 * `order` column, so these actions/reads have no faithful single-gesture UI. Driving it
 * through the editor would force deleting those snapshot assertions (forbidden), so the
 * flow stays at the api-client/operation-factory transport layer by design. The cross-
 * client BRIEFING + SLIDE flows ARE driven through the real editor UI in
 * browser-collab-briefing-temporal.spec.js.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Briefing + slides lifecycle (real Chromium + real backend sync)', () => {
    test('create briefing, add 3 slides, reorder via slide_order, then delete one slide', async ({
        page,
    }) => {
        const user = await createVerifiedUser({ prefix: 'brf', nome: 'Briefing User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Briefing Atlas' });

            // A map gives the slides a real `map_id` context (mode 2d slides reference it).
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // 1. Create the briefing (atlas-level entity → mapId null, empty slide_order).
            const briefingId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'create', briefingId, null, {
                    name: 'Operação Bravo',
                    description: 'Briefing E2E',
                    settings: {},
                    slide_order: [],
                }),
            ]);

            // 2. Create three slides, each with its own temporal_cursor. They are pushed
            //    in the order s1, s2, s3 but the canonical order lives in slide_order.
            const s1 = crypto.randomUUID();
            const s2 = crypto.randomUUID();
            const s3 = crypto.randomUUID();
            const slideData = (id, title, cursorIso) => ({
                briefing_id: briefingId,
                title,
                content: `content-${title}`,
                mode: '2d',
                map_id: mapId,
                temporal_cursor: { instante: cursorIso },
            });
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'create', s1, mapId, slideData(s1, 'S1', '2026-01-01T00:00:00Z')),
                createOperation('slide', 'create', s2, mapId, slideData(s2, 'S2', '2026-02-01T00:00:00Z')),
                createOperation('slide', 'create', s3, mapId, slideData(s3, 'S3', '2026-03-01T00:00:00Z')),
            ]);

            // Set the canonical insertion order so the FIRST snapshot has a known order.
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'update', briefingId, null, { slide_order: [s1, s2, s3] }),
            ]);

            const findBriefing = (pull) =>
                (pull.snapshot?.briefings || []).find((b) => b.id === briefingId) || null;

            // --- Assert state AFTER creation (order s1,s2,s3) ---
            const afterCreate = await api.pullSync(atlas.id, 0);
            const brfCreate = findBriefing(afterCreate);
            const slidesCreate = (brfCreate?.slides || [])
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => ({ id: s.id, title: s.title, order: s.order, temporalCursor: s.temporalCursor }));

            // 3. Reorder: new canonical order is s3, s1, s2 (a briefing update on slide_order).
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'update', briefingId, null, { slide_order: [s3, s1, s2] }),
            ]);

            const afterReorder = await api.pullSync(atlas.id, 0);
            const brfReorder = findBriefing(afterReorder);
            const orderedAfterReorder = (brfReorder?.slides || [])
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((s) => s.id);

            // 4. Delete the middle slide (s1) of the reordered list.
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'delete', s1, mapId, null),
            ]);

            const afterDelete = await api.pullSync(atlas.id, 0);
            const brfDelete = findBriefing(afterDelete);
            const slidesAfterDelete = (brfDelete?.slides || []).map((s) => s.id);
            const survivorsOrdered = (brfDelete?.slides || [])
                .slice()
                .filter((s) => s.order >= 0)
                .sort((a, b) => a.order - b.order)
                .map((s) => s.id);

            return {
                isSnapshot: afterCreate.isSnapshot,
                briefingName: brfCreate?.name ?? null,
                slidesCreate,
                createCount: slidesCreate.length,
                orderedAfterReorder,
                slidesAfterDelete,
                deleteCount: slidesAfterDelete.length,
                s1WasDeleted: !slidesAfterDelete.includes(s1),
                survivorsOrdered,
                ids: { s1, s2, s3 },
            };
        }, { baseUrl: state.baseUrl, u: user });

        // Snapshot envelope + briefing identity.
        expect(result.isSnapshot).toBe(true);
        expect(result.briefingName).toBe('Operação Bravo');

        // All three slides landed, ordered s1,s2,s3, each carrying its own temporalCursor.
        expect(result.createCount).toBe(3);
        expect(result.slidesCreate.map((s) => s.title)).toEqual(['S1', 'S2', 'S3']);
        expect(result.slidesCreate.map((s) => s.order)).toEqual([0, 1, 2]);
        expect(result.slidesCreate[0].temporalCursor).toEqual({ instante: '2026-01-01T00:00:00Z' });
        expect(result.slidesCreate[2].temporalCursor).toEqual({ instante: '2026-03-01T00:00:00Z' });

        // Reorder is reflected by the positional `order` index, not insertion order.
        expect(result.orderedAfterReorder).toEqual([result.ids.s3, result.ids.s1, result.ids.s2]);

        // Delete removed exactly s1; the survivors keep their relative reordered order
        // (s3 before s2) and s1 is gone entirely (soft-deleted, excluded from snapshot).
        expect(result.deleteCount).toBe(2);
        expect(result.s1WasDeleted).toBe(true);
        expect(result.slidesAfterDelete).not.toContain(result.ids.s1);
        expect(result.survivorsOrdered).toEqual([result.ids.s3, result.ids.s2]);
    });
});
