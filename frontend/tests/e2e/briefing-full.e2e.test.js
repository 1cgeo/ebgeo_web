// Path: tests/e2e/briefing-full.e2e.test.js

/**
 * @fileoverview Real-backend E2E for §22 briefing lifecycle driven entirely through
 * the CRDT sync transport (briefings have no REST write route). Exercises: create a
 * briefing, add three slides (each carrying `data.briefing_id` + a `temporal_cursor`),
 * reorder via a briefing update that rewrites `slide_order`, then delete one slide.
 * Every assertion reads observable backend state back via `api.pullSync` snapshots.
 *
 * Isolation: a fresh user / atlas / map are provisioned in `beforeAll`, so the test
 * never collides with other E2E specs sharing the single spawned backend.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a full snapshot and returns the briefing matching `briefingId`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} briefingId
 * @returns {Promise<Object|undefined>} The briefing entry from the snapshot, if present.
 */
async function pullBriefing(api, atlasId, briefingId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    return res.snapshot.briefings.find((b) => b.id === briefingId);
}

describe.skipIf(E2E_SKIP)('§22 briefing full lifecycle (real backend, sync transport)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;
    let briefingId;
    /** @type {string[]} Slide ids in creation order. */
    let slideIds;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Briefing E2E' });
        const atlas = await createAtlas(api, { name: 'Briefing E2E Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Briefing Map' });
    });

    it('creates a briefing visible in the snapshot', async () => {
        briefingId = generateUUID();
        const op = createOperation('briefing', 'create', briefingId, null, {
            name: 'Operation Order',
            description: 'phase lines',
        });
        await api.pushOperations(atlasId, [op]);

        const briefing = await pullBriefing(api, atlasId, briefingId);
        expect(briefing).toBeDefined();
        expect(briefing.name).toBe('Operation Order');
        expect(Array.isArray(briefing.slides)).toBe(true);
        expect(briefing.slides).toHaveLength(0);
    });

    it('adds three slides, each carrying briefing_id and a temporal_cursor', async () => {
        slideIds = [generateUUID(), generateUUID(), generateUUID()];
        const ops = slideIds.map((id, i) =>
            createOperation('slide', 'create', id, null, {
                briefing_id: briefingId,
                title: `Slide ${i + 1}`,
                mode: '2d',
                map_id: mapId,
                temporal_cursor: { t: 100 + i, label: `T+${i}` },
            }),
        );
        await api.pushOperations(atlasId, ops);

        const briefing = await pullBriefing(api, atlasId, briefingId);
        expect(briefing.slides).toHaveLength(3);

        const byId = new Map(briefing.slides.map((s) => [s.id, s]));
        for (const [i, id] of slideIds.entries()) {
            const slide = byId.get(id);
            expect(slide, `slide ${id} present`).toBeDefined();
            expect(slide.title).toBe(`Slide ${i + 1}`);
            // Camel-cased temporal cursor surfaced for the frontend contract.
            expect(slide.temporalCursor).toEqual({ t: 100 + i, label: `T+${i}` });
        }
    });

    it('reorders slides via a briefing update rewriting slide_order', async () => {
        // Reverse the creation order: [c, b, a].
        const reordered = [slideIds[2], slideIds[1], slideIds[0]];
        const op = createOperation('briefing', 'update', briefingId, null, {
            slide_order: reordered,
        });
        await api.pushOperations(atlasId, [op]);

        const briefing = await pullBriefing(api, atlasId, briefingId);
        expect(briefing.slides).toHaveLength(3);

        // `order` is the index of each slide within slide_order; assert the new ranking.
        const orderById = new Map(briefing.slides.map((s) => [s.id, s.order]));
        expect(orderById.get(slideIds[2])).toBe(0);
        expect(orderById.get(slideIds[1])).toBe(1);
        expect(orderById.get(slideIds[0])).toBe(2);

        // Every slide must be ranked (no -1 "not found in slide_order").
        for (const slide of briefing.slides) {
            expect(slide.order).toBeGreaterThanOrEqual(0);
        }
    });

    it('deletes one slide, leaving two', async () => {
        const victim = slideIds[1];
        const op = createOperation('slide', 'delete', victim, null, null);
        await api.pushOperations(atlasId, [op]);

        const briefing = await pullBriefing(api, atlasId, briefingId);
        expect(briefing.slides).toHaveLength(2);
        const remainingIds = briefing.slides.map((s) => s.id);
        expect(remainingIds).not.toContain(victim);
        expect(remainingIds).toContain(slideIds[0]);
        expect(remainingIds).toContain(slideIds[2]);
    });

    it('ignores a slide delete targeting a foreign atlas id (negative)', async () => {
        // Slide deletes are atlas-scoped through the parent briefing: a delete pushed
        // against an UNRELATED atlas must not remove our slide. Provision a 2nd atlas
        // owned by the same user and push the delete there; our slide must survive.
        const otherAtlas = await createAtlas(api, { name: 'Decoy Atlas' });
        const op = createOperation('slide', 'delete', slideIds[0], null, null);
        await api.pushOperations(otherAtlas.id, [op]);

        const briefing = await pullBriefing(api, atlasId, briefingId);
        expect(briefing.slides).toHaveLength(2);
        expect(briefing.slides.map((s) => s.id)).toContain(slideIds[0]);
    });
});
