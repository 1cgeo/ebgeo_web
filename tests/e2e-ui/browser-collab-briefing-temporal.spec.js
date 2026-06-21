// Path: e2e-ui/browser-collab-briefing-temporal.spec.js

/**
 * BRIEFING + TEMPORAL collaboration — TWO real browsers + real backend. Two common
 * user modules the collab suite never exercised end-to-end, both driven through the real
 * store ops and asserted natively on the peer:
 *
 *   Briefing:  A creates / updates / deletes a briefing → B reflects each.
 *   Temporal:  A sets a map's temporal config            → B reflects it.
 *
 * Run headed:  npx playwright test browser-collab-briefing-temporal --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const readBriefing = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(bid);
    return b ? { id: b.id, name: b.name, description: b.description } : null;
}, id);

const readTemporal = (page, mapName) => page.evaluate(async (mn) => {
    const store = await import('/src/js/store/index.js');
    return await store.getMapTemporalConfig(mn);
}, mapName);

describeOrSkip('Briefing + temporal collaboration cross-client', () => {
    test('briefing create → update → delete all reflect on the peer', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // CREATE
            const created = await applyStoreOp(A, 'createBriefing', [{ name: 'Plano Alfa', description: 'rascunho' }]);
            expect(created?.id, 'createBriefing returned a briefing with id').toBeTruthy();
            const id = created.id;
            await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 20000 }).toBe('Plano Alfa');

            // UPDATE
            await applyStoreOp(A, 'updateBriefing', [id, { name: 'Plano Bravo', description: 'revisado' }]);
            await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 20000 }).toBe('Plano Bravo');

            // DELETE
            await applyStoreOp(A, 'deleteBriefing', [id]);
            await expect.poll(async () => await readBriefing(B, id), { timeout: 20000 }).toBeNull();
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('slide add / update / remove inside a briefing reflect on the peer', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const created = await applyStoreOp(A, 'createBriefing', [{ name: 'Com Slides' }]);
            const bid = created.id;
            await expect.poll(async () => (await readBriefing(B, bid))?.name, { timeout: 20000 }).toBe('Com Slides');

            const readSlides = (page) => page.evaluate(async (id) => {
                const store = await import('/src/js/store/index.js');
                const b = await store.getBriefingById(id);
                return (b?.slides || []).map((s) => ({ id: s.id, titulo: s.titulo ?? s.title ?? s.nome }));
            }, bid);

            // ADD a slide → B sees it (via the briefing-update op the slide op piggybacks on).
            const slide = await applyStoreOp(A, 'addSlide', [bid, { title: 'Intro' }]);
            const sid = slide.id;
            await expect.poll(async () => (await readSlides(B)).some((s) => s.id === sid), { timeout: 20000 }).toBe(true);

            // UPDATE the slide → B sees the change.
            await applyStoreOp(A, 'updateSlide', [bid, sid, { title: 'Introdução' }]);
            await expect
                .poll(async () => (await readSlides(B)).find((s) => s.id === sid)?.titulo, { timeout: 20000 })
                .toBe('Introdução');

            // REMOVE the slide → B no longer has it.
            await applyStoreOp(A, 'removeSlide', [bid, sid]);
            await expect.poll(async () => (await readSlides(B)).some((s) => s.id === sid), { timeout: 20000 }).toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('temporal config set by A is reflected on B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: 'Mapa Tático' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            const patch = { ativo: true, unidade: 'horas', inicio: 1700000000000, fim: 1700003600000 };
            await applyStoreOp(A, 'setMapTemporalConfig', ['Mapa Tático', patch]);

            await expect
                .poll(async () => {
                    const cfg = await readTemporal(B, 'Mapa Tático');
                    return cfg && cfg.ativo === true && cfg.unidade === 'horas' ? cfg.inicio : null;
                }, { timeout: 20000 })
                .toBe(1700000000000);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
