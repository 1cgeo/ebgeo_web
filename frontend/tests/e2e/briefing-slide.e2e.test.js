// Path: tests/e2e/briefing-slide.e2e.test.js

/**
 * @fileoverview Real end-to-end test for the briefing/slide CRDT path against the
 * live backend. Drives the backend exclusively through the public ApiClient/WsClient
 * + createOperation (briefings/slides have GET-only REST; all writes travel as sync
 * operations). Asserts observable backend state via the pullSync snapshot and a WS
 * broadcast round-trip.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: briefing/slide sync', () => {
    let api;
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Briefing E2E' });
        const atlas = await createAtlas(api, { name: 'Briefing Atlas' });
        atlasId = atlas.id;
    });

    afterAll(async () => {
        try {
            await api.logout();
        } catch {
            // best-effort; backend is torn down by globalSetup teardown anyway.
        }
    });

    it('persists a briefing + slide (with temporalCursor and order) into the snapshot', async () => {
        const briefingId = generateUUID();
        const slideId = generateUUID();
        const temporalCursor = { time: '2026-06-20T12:00:00Z', multiplier: 4 };

        // briefing create: slide_order references the slide so `order` is a real index.
        const briefingOp = createOperation('briefing', 'create', briefingId, null, {
            name: 'Briefing One',
            description: 'E2E briefing',
            slide_order: [slideId],
        });
        // slide create: data.briefing_id ties it to the parent; temporal_cursor is jsonb.
        const slideOp = createOperation('slide', 'create', slideId, null, {
            briefing_id: briefingId,
            title: 'Slide One',
            content: 'Hello',
            mode: '2d',
            temporal_cursor: temporalCursor,
        });

        const push = await api.pushOperations(atlasId, [briefingOp, slideOp]);
        expect(push.serverVersion).toBeGreaterThan(0);

        const { snapshot } = await api.pullSync(atlasId, 0);
        expect(snapshot).toBeTruthy();

        const briefing = (snapshot.briefings || []).find((b) => b.id === briefingId);
        expect(briefing).toBeTruthy();
        expect(briefing.name).toBe('Briefing One');

        const slide = (briefing.slides || []).find((s) => s.id === slideId);
        expect(slide).toBeTruthy();
        expect(slide.title).toBe('Slide One');
        expect(slide.briefing_id).toBe(briefingId);
        // camelCase temporalCursor surfaced from temporal_cursor jsonb.
        expect(slide.temporalCursor).toEqual(temporalCursor);
        // order is the index within slide_order (0), not -1.
        expect(slide.order).toBe(0);
    });

    it('applies a slide update (data carried in op.data) to the snapshot', async () => {
        const briefingId = generateUUID();
        const slideId = generateUUID();

        await api.pushOperations(atlasId, [
            createOperation('briefing', 'create', briefingId, null, {
                name: 'Briefing Two',
                slide_order: [slideId],
            }),
            createOperation('slide', 'create', slideId, null, {
                briefing_id: briefingId,
                title: 'Before',
                mode: '2d',
                temporal_cursor: { time: 't0' },
            }),
        ]);

        const newCursor = { time: 't1', multiplier: 8 };
        await api.pushOperations(atlasId, [
            createOperation('slide', 'update', slideId, null, {
                title: 'After',
                temporal_cursor: newCursor,
            }),
        ]);

        const { snapshot } = await api.pullSync(atlasId, 0);
        const briefing = snapshot.briefings.find((b) => b.id === briefingId);
        const slide = briefing.slides.find((s) => s.id === slideId);
        expect(slide.title).toBe('After');
        expect(slide.temporalCursor).toEqual(newCursor);
    });

    it('rejects a slide whose briefing belongs to no atlas (no-op insert)', async () => {
        // briefing_id that exists nowhere: the guarded INSERT inserts zero rows.
        const orphanSlideId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('slide', 'create', orphanSlideId, null, {
                briefing_id: generateUUID(),
                title: 'Orphan',
                mode: '2d',
            }),
        ]);

        const { snapshot } = await api.pullSync(atlasId, 0);
        const allSlides = (snapshot.briefings || []).flatMap((b) => b.slides || []);
        expect(allSlides.some((s) => s.id === orphanSlideId)).toBe(false);
    });

    it('broadcasts a briefing create to a connected WS peer', async () => {
        const clientId = newClientId();
        const ws = makeWs(api, { clientId });
        const received = [];
        ws.on('operation', (op) => received.push(op));

        await ws.connect(atlasId, { lastVersion: 0 });
        try {
            const briefingId = generateUUID();
            // Push from a DIFFERENT client id so the WS peer does not self-filter it.
            const op = createOperation('briefing', 'create', briefingId, null, {
                name: 'Broadcast Briefing',
            });
            op.clientId = newClientId();

            await api.pushOperations(atlasId, [op]);

            await waitFor(
                () => received.some((o) => (o.entityId || o.targetId) === briefingId),
                { timeout: 4000 },
            );
            const got = received.find((o) => (o.entityId || o.targetId) === briefingId);
            expect(got).toBeTruthy();
        } finally {
            ws.disconnect();
        }
    });
});
