// Path: e2e-ui/browser-briefing-advanced.spec.js

/**
 * Browser-level briefing EDITOR ADVANCED test (§22.8-10). Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * inside real Chromium, against the REAL backend sync pipeline (`POST /atlas/:id/sync`).
 *
 * Briefings and their slides are collaborative entities, so EVERY mutation here travels
 * as a CRDT sync operation (never a REST write); the slide carries its rich `content`
 * (TEXT) and `orientation` (JSONB) columns, both updated through `slide` `update` ops
 * whose payload the factory places in `data` (the backend falls back `changes <- data`).
 * All assertions are grounded in the `pullSync` snapshot, which surfaces each briefing's
 * `slides[]` with the raw columns plus a positional `order` (index in `slide_order`).
 *
 * Coverage (per §22 row, all 🟡 last-write-wins-per-slide):
 *   - §22.8 Import map notes into a slide: read the source map's notes (the rich Quill
 *     content), then push a `slide` `update` writing that text into `slide.content`;
 *     assert the snapshot slide now carries the imported rich content (LWW: a 2nd import
 *     of edited notes overwrites it).
 *   - §22.9 Use a saved 360 orientation on a slide: create a saved `orientation360`
 *     entity (flat, `photoName`-keyed), read it back, then push a `slide` `update` that
 *     applies its {bearing,pitch,heading} into `slide.orientation` + switches the slide
 *     to `mode:'360'` with the matching `photo_id`; assert the snapshot reflects it.
 *   - §22.10 Import slides from another briefing: clone the source briefing's slides into
 *     a destination briefing with FRESH UUIDs appended at the end, then rewrite the
 *     destination `slide_order`; assert the clones carry new ids, copied content, and the
 *     expected appended order — while the SOURCE briefing is left untouched.
 *
 * Negatives/edges (one per action where the action implies it):
 *   - §22.8: a `slide` `update` aimed at a slide of a FOREIGN atlas (pushed against an
 *     unrelated decoy atlas owned by the same user) must NOT mutate our slide's content
 *     (cross-atlas scoping through the parent briefing).
 *   - §22.9: applying an orientation under a slide id that does not exist is a no-op —
 *     no phantom slide ever materializes in the snapshot.
 *   - §22.10: a cloned slide whose `briefing_id` points at a non-existent briefing is
 *     rejected at write (guarded INSERT inserts zero rows) — it never appears anywhere.
 *
 * Each test self-provisions its OWN user + atlas + map + briefing for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Briefing editor advanced §22.8-10 (real Chromium + real backend sync)', () => {
    test('§22.8 import map notes into a slide (rich content update, LWW) + cross-atlas negative', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `brfadv8_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Briefing Notes' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Notes Atlas' });

            // A map carrying rich Quill notes — the SOURCE of the import. mapNotes is a
            // sub-typed map op: mapId is BOTH entityId and the 4th arg; the notes title +
            // description carry the rich text the editor imports into a slide.
            const mapId = crypto.randomUUID();
            const richNotes = '<p>Phase line <strong>BRAVO</strong> at H+2</p>';
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, {
                    name: 'M1',
                    notes_title: 'OPORD Notes',
                    notes_description: richNotes,
                }),
            ]);

            // A briefing + one slide to import the notes into.
            const briefingId = crypto.randomUUID();
            const slideId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'create', briefingId, null, {
                    name: 'Notes Briefing',
                    slide_order: [slideId],
                }),
                createOperation('slide', 'create', slideId, mapId, {
                    briefing_id: briefingId,
                    title: 'Slide A',
                    content: '',
                    mode: '2d',
                    map_id: mapId,
                }),
            ]);

            const findSlide = (pull, bid, sid) =>
                (pull.snapshot?.briefings || [])
                    .find((b) => b.id === bid)
                    ?.slides?.find((s) => s.id === sid) || null;

            // Read the source map's notes back from the snapshot (the editor reads the
            // selected map's notes_description and pushes it into the slide content).
            const beforePull = await api.pullSync(atlas.id, 0);
            const sourceMap = beforePull.snapshot?.maps?.find((m) => m.id === mapId);
            const importedNotes = sourceMap?.notes_description ?? null;

            // §22.8: import the map notes into the slide (slide update → content).
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'update', slideId, mapId, {
                    content: importedNotes,
                }),
            ]);

            const afterImport = findSlide(await api.pullSync(atlas.id, 0), briefingId, slideId);

            // LWW: edit the notes and re-import — the slide content must reflect the LAST
            // import, not the first (last-write-wins per slide).
            const editedNotes = '<p>Phase line <strong>CHARLIE</strong> at H+4</p>';
            await api.pushOperations(atlas.id, [
                createOperation('mapNotes', 'update', mapId, mapId, {
                    notes_title: 'OPORD Notes',
                    notes_description: editedNotes,
                }),
            ]);
            const reReadMap = (await api.pullSync(atlas.id, 0)).snapshot?.maps?.find(
                (m) => m.id === mapId,
            );
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'update', slideId, mapId, {
                    content: reReadMap?.notes_description ?? null,
                }),
            ]);
            const afterReimport = findSlide(await api.pullSync(atlas.id, 0), briefingId, slideId);

            // --- Negative: a foreign-atlas slide update must NOT touch our slide ---
            // Provision a decoy atlas owned by the same user and push a slide update for
            // OUR slide id against it. The slide belongs to our atlas's briefing, so the
            // atlas-scoped UPDATE matches zero rows there: our content is unchanged.
            const decoy = await api.createAtlas({ name: 'Decoy Atlas' });
            await api.pushOperations(decoy.id, [
                createOperation('slide', 'update', slideId, mapId, {
                    content: '<p>HIJACKED</p>',
                }),
            ]);
            const afterForeign = findSlide(await api.pullSync(atlas.id, 0), briefingId, slideId);

            return {
                isSnapshot: beforePull.isSnapshot,
                importedNotes,
                afterImportContent: afterImport?.content ?? null,
                afterReimportContent: afterReimport?.content ?? null,
                afterForeignContent: afterForeign?.content ?? null,
                expectedFirst: richNotes,
                expectedSecond: editedNotes,
            };
        }, state.baseUrl);

        expect(result.isSnapshot).toBe(true);
        // The source map's rich notes round-tripped through the snapshot.
        expect(result.importedNotes).toBe(result.expectedFirst);
        // §22.8: the imported notes landed in the slide content.
        expect(result.afterImportContent).toBe(result.expectedFirst);
        // LWW: re-importing edited notes overwrote the slide content.
        expect(result.afterReimportContent).toBe(result.expectedSecond);
        // Negative: the foreign-atlas update did not hijack our slide content.
        expect(result.afterForeignContent).toBe(result.expectedSecond);
        expect(result.afterForeignContent).not.toBe('<p>HIJACKED</p>');
    });

    test('§22.9 apply a saved 360 orientation to a slide (orientation/mode update) + unknown-slide no-op', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `brfadv9_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Briefing Orient' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Orient Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // A SAVED 360 orientation (flat orientation360 entity, keyed by photoName in
            // the snapshot under map.streetview360.orientations). The editor's dropdown
            // lists these; selecting one applies its angles to the slide.
            const photoName = `pano-${crypto.randomUUID().slice(0, 8)}`;
            const orientId = crypto.randomUUID();
            const savedAngles = { bearing: 137, pitch: -12, heading: 137 };
            await api.pushOperations(atlas.id, [
                createOperation('orientation360', 'create', orientId, mapId, {
                    id: orientId,
                    photoName,
                    ...savedAngles,
                }),
            ]);

            // Briefing + a 2d slide we will convert to a 360 slide using the saved angles.
            const briefingId = crypto.randomUUID();
            const slideId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'create', briefingId, null, {
                    name: 'Orient Briefing',
                    slide_order: [slideId],
                }),
                createOperation('slide', 'create', slideId, mapId, {
                    briefing_id: briefingId,
                    title: 'Slide 360',
                    mode: '2d',
                    map_id: mapId,
                }),
            ]);

            // Read the saved orientation back from the snapshot (orientations keyed by
            // photoName) — exactly what the editor dropdown surfaces.
            const pull = await api.pullSync(atlas.id, 0);
            const map = pull.snapshot?.maps?.find((m) => m.id === mapId);
            const savedFromSnapshot = map?.streetview360?.orientations?.[photoName] ?? null;

            // §22.9: apply the saved orientation to the slide — switch to 360 mode, set
            // the photo_id, and copy the saved {bearing,pitch,heading} into orientation.
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'update', slideId, mapId, {
                    mode: '360',
                    photo_id: photoName,
                    orientation: {
                        bearing: savedFromSnapshot.bearing,
                        pitch: savedFromSnapshot.pitch,
                        heading: savedFromSnapshot.heading,
                    },
                }),
            ]);

            const findSlide = (p, bid, sid) =>
                (p.snapshot?.briefings || [])
                    .find((b) => b.id === bid)
                    ?.slides?.find((s) => s.id === sid) || null;
            const afterApply = findSlide(await api.pullSync(atlas.id, 0), briefingId, slideId);

            // --- Negative: applying an orientation to an UNKNOWN slide id is a no-op ---
            // (no phantom slide may materialize; the guarded UPDATE matches zero rows).
            const ghostSlideId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'update', ghostSlideId, mapId, {
                    mode: '360',
                    photo_id: photoName,
                    orientation: savedAngles,
                }),
            ]);
            const afterGhost = await api.pullSync(atlas.id, 0);
            const ghostPresent = (afterGhost.snapshot?.briefings || [])
                .flatMap((b) => b.slides || [])
                .some((s) => s.id === ghostSlideId);

            return {
                isSnapshot: pull.isSnapshot,
                savedBearing: savedFromSnapshot?.bearing ?? null,
                slideMode: afterApply?.mode ?? null,
                slidePhotoId: afterApply?.photo_id ?? null,
                slideOrientation: afterApply?.orientation ?? null,
                expectedAngles: savedAngles,
                expectedPhoto: photoName,
                ghostPresent,
            };
        }, state.baseUrl);

        expect(result.isSnapshot).toBe(true);
        // The saved orientation round-tripped (dropdown source).
        expect(result.savedBearing).toBe(137);
        // §22.9: the slide now points at the 360 photo with the saved angles applied.
        expect(result.slideMode).toBe('360');
        expect(result.slidePhotoId).toBe(result.expectedPhoto);
        expect(result.slideOrientation).toEqual(result.expectedAngles);
        // Negative: no phantom slide was created by an update to an unknown id.
        expect(result.ghostPresent).toBe(false);
    });

    test('§22.10 import slides from another briefing (clone with fresh UUIDs appended) + orphan-clone rejected', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `brfadv10_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Briefing Import' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Import Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const findBriefing = (pull, bid) =>
                (pull.snapshot?.briefings || []).find((b) => b.id === bid) || null;
            const orderedSlides = (briefing) =>
                (briefing?.slides || [])
                    .slice()
                    .sort((a, b) => a.order - b.order);

            // --- SOURCE briefing with two slides (the donor) ---
            const srcBriefingId = crypto.randomUUID();
            const srcS1 = crypto.randomUUID();
            const srcS2 = crypto.randomUUID();
            const srcSlide = (id, title, content) => ({
                briefing_id: srcBriefingId,
                title,
                content,
                mode: '2d',
                map_id: mapId,
            });
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'create', srcBriefingId, null, {
                    name: 'Source Briefing',
                    slide_order: [srcS1, srcS2],
                }),
                createOperation('slide', 'create', srcS1, mapId, srcSlide(srcS1, 'Src 1', '<p>one</p>')),
                createOperation('slide', 'create', srcS2, mapId, srcSlide(srcS2, 'Src 2', '<p>two</p>')),
            ]);

            // --- DESTINATION briefing with one existing slide ---
            const dstBriefingId = crypto.randomUUID();
            const dstExisting = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'create', dstBriefingId, null, {
                    name: 'Dest Briefing',
                    slide_order: [dstExisting],
                }),
                createOperation('slide', 'create', dstExisting, mapId, {
                    briefing_id: dstBriefingId,
                    title: 'Dest Existing',
                    content: '<p>kept</p>',
                    mode: '2d',
                    map_id: mapId,
                }),
            ]);

            // Read the source slides from the snapshot (the modal copies these), in order.
            const srcBriefing = findBriefing(await api.pullSync(atlas.id, 0), srcBriefingId);
            const sourceOrdered = orderedSlides(srcBriefing);

            // §22.10: clone each source slide with a FRESH UUID into the destination, then
            // APPEND the new ids to the destination's slide_order (clones go at the end).
            const cloneId1 = crypto.randomUUID();
            const cloneId2 = crypto.randomUUID();
            const cloneIds = [cloneId1, cloneId2];
            const cloneOps = sourceOrdered.map((s, i) =>
                createOperation('slide', 'create', cloneIds[i], mapId, {
                    briefing_id: dstBriefingId,
                    title: s.title,
                    content: s.content,
                    mode: s.mode,
                    map_id: mapId,
                }),
            );
            await api.pushOperations(atlas.id, cloneOps);
            await api.pushOperations(atlas.id, [
                createOperation('briefing', 'update', dstBriefingId, null, {
                    slide_order: [dstExisting, cloneId1, cloneId2],
                }),
            ]);

            const afterImport = await api.pullSync(atlas.id, 0);
            const dstBriefing = findBriefing(afterImport, dstBriefingId);
            const dstOrdered = orderedSlides(dstBriefing).map((s) => ({
                id: s.id,
                title: s.title,
                content: s.content,
                order: s.order,
            }));
            // The SOURCE briefing must be untouched (clone, not move).
            const srcAfter = findBriefing(afterImport, srcBriefingId);
            const srcStillIntact = orderedSlides(srcAfter).map((s) => s.id);

            // --- Negative: a clone whose briefing_id is a non-existent briefing is
            // rejected at write (guarded INSERT inserts zero rows) — never appears. ---
            const orphanCloneId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('slide', 'create', orphanCloneId, mapId, {
                    briefing_id: crypto.randomUUID(),
                    title: 'Orphan Clone',
                    content: '<p>nowhere</p>',
                    mode: '2d',
                    map_id: mapId,
                }),
            ]);
            const afterOrphan = await api.pullSync(atlas.id, 0);
            const orphanPresent = (afterOrphan.snapshot?.briefings || [])
                .flatMap((b) => b.slides || [])
                .some((s) => s.id === orphanCloneId);

            return {
                isSnapshot: afterImport.isSnapshot,
                dstOrdered,
                srcStillIntact,
                cloneIds,
                srcIds: [srcS1, srcS2],
                dstExisting,
                orphanPresent,
            };
        }, state.baseUrl);

        expect(result.isSnapshot).toBe(true);

        // Destination now has the existing slide + the two clones, in that order.
        expect(result.dstOrdered.map((s) => s.id)).toEqual([
            result.dstExisting,
            result.cloneIds[0],
            result.cloneIds[1],
        ]);
        expect(result.dstOrdered.map((s) => s.order)).toEqual([0, 1, 2]);

        // Clones carry FRESH ids (distinct from the source slide ids).
        expect(result.cloneIds[0]).not.toBe(result.srcIds[0]);
        expect(result.cloneIds[1]).not.toBe(result.srcIds[1]);
        expect(result.dstOrdered.map((s) => s.id)).not.toContain(result.srcIds[0]);
        expect(result.dstOrdered.map((s) => s.id)).not.toContain(result.srcIds[1]);

        // Clones copied the source content (titles + rich content), in source order.
        expect(result.dstOrdered[1].title).toBe('Src 1');
        expect(result.dstOrdered[1].content).toBe('<p>one</p>');
        expect(result.dstOrdered[2].title).toBe('Src 2');
        expect(result.dstOrdered[2].content).toBe('<p>two</p>');

        // The SOURCE briefing is untouched — import is a clone, not a move.
        expect(result.srcStillIntact).toEqual(result.srcIds);

        // Negative: the orphan clone (foreign briefing_id) never materialized.
        expect(result.orphanPresent).toBe(false);
    });
});
