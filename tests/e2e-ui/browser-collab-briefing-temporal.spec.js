// Path: e2e-ui/browser-collab-briefing-temporal.spec.js

/**
 * BRIEFING + TEMPORAL collaboration — TWO real browsers + real backend, on the full-chain
 * harness. Briefings are an atlas-level entity, so each create/update/delete is verified
 * through the WHOLE chain to B via expectFullSync (entityType 'briefing'); slide edits ride
 * the briefing-update op. Temporal config is a per-map SETTING keyed by mapId (no entity
 * row / id-keyed IDB record), so it is verified by the synced-value convergence on B.
 *
 * UI-first: every ACTION is a real gesture (CRIAR BRIEFING, editor name input, add/delete
 * slide, card delete + confirm, the clock toggle).
 *
 * Run headed:  npx playwright test browser-collab-briefing-temporal --headed
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

// --- ASSERTION READS (state reads, no UI) -----------------------------------

const readBriefing = (page, id) => page.evaluate(async (bid) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(bid);
    return b ? { id: b.id, name: b.name, description: b.description } : null;
}, id);

const readTemporal = (page, mapName) => page.evaluate(async (mn) => {
    const store = await import('/src/js/store/index.js');
    return await store.getMapTemporalConfig(mn);
}, mapName);

const readAllBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    const all = await store.getAllBriefings();
    return all.map((b) => ({ id: b.id, name: b.name }));
});

const readSlides = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(id);
    return (b?.slides || []).map((s) => ({ id: s.id, titulo: s.titulo ?? s.title ?? s.nome }));
}, bid);

// --- INLINE UI HELPERS (real gestures) --------------------------------------

async function openBriefingsTab(page) {
    const createBtn = page.locator('.briefings-create-btn');
    if (!(await createBtn.isVisible())) {
        await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    }
    await expect(createBtn).toBeVisible({ timeout: 10000 });
}

async function createBriefingUI(page) {
    const before = new Set((await readAllBriefings(page)).map((b) => b.id));
    await openBriefingsTab(page);
    await page.locator('.briefings-create-btn').click();
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readAllBriefings(page)).find((b) => !before.has(b.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

async function renameBriefingUI(page, name) {
    const input = page.locator('.briefing-editor-name-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await input.blur();
}

async function closeBriefingEditorUI(page) {
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.briefings-create-btn')).toBeVisible({ timeout: 10000 });
}

async function deleteBriefingUI(page, briefingId) {
    await openBriefingsTab(page);
    const card = page.locator(`.briefing-card[data-briefing-id="${briefingId}"]`);
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.locator('.delete-btn').click();
    const confirm = page.locator('.confirm-modal-overlay');
    await expect(confirm).toBeVisible({ timeout: 5000 });
    await confirm.locator('.confirm-modal-btn-confirm').click();
    await expect(confirm).toHaveCount(0, { timeout: 5000 });
}

async function addSlideUI(page, bid) {
    const before = new Set((await readSlides(page, bid)).map((s) => s.id));
    await page.locator('.briefing-editor-add-slide-btn[title="Adicionar slide"]').click();
    let id = null;
    await expect.poll(async () => {
        const fresh = (await readSlides(page, bid)).find((s) => !before.has(s.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

async function renameSlideUI(page, title) {
    const input = page.locator('.briefing-editor-slide-title-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(title);
    await input.blur();
}

async function deleteSlideUI(page, slideId) {
    const card = page.locator(`.briefing-editor-slide-card[data-slide-id="${slideId}"]`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('.briefing-editor-slide-delete-btn').click();
    const confirm = page.locator('.confirm-modal-overlay');
    await expect(confirm).toBeVisible({ timeout: 5000 });
    await confirm.locator('.confirm-modal-btn-confirm').click();
    await expect(confirm).toHaveCount(0, { timeout: 5000 });
}

async function enableTemporalUI(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const clock = page.locator('#current-map-temporal-btn');
    await expect(clock).toBeVisible({ timeout: 10000 });
    await expect(clock).toHaveAttribute('data-temporal', 'false');
    await clock.click();
    await expect(clock).toHaveAttribute('data-temporal', 'true', { timeout: 5000 });
}

collabTest.describe('Briefing + temporal collaboration cross-client (full chain)', () => {
    collabTest('briefing create → update → delete each traverse the chain to the peer', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // CREATE — the briefing create op traverses the whole chain to B.
        const id = await createBriefingUI(A);
        expect(id, 'the briefings tab created a briefing with an id').toBeTruthy();
        await collab.expectFullSync({ entityId: id, entityType: 'briefing', operationType: 'create' });

        // UPDATE (rename) — full chain + value on B.
        await collab.clearTraces();
        await renameBriefingUI(A, 'Plano Alfa');
        await collab.expectFullSync({ entityId: id, entityType: 'briefing', operationType: 'update' });
        await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 15000 }).toBe('Plano Alfa');

        // UPDATE again.
        await collab.clearTraces();
        await renameBriefingUI(A, 'Plano Bravo');
        await collab.expectFullSync({ entityId: id, entityType: 'briefing', operationType: 'update' });
        await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 15000 }).toBe('Plano Bravo');

        // DELETE — full delete chain (briefing gone from B's IDB).
        await collab.clearTraces();
        await closeBriefingEditorUI(A);
        await deleteBriefingUI(A, id);
        await collab.expectFullSyncDelete({ entityId: id, entityType: 'briefing', operationType: 'delete' });
    });

    collabTest('slide add / update / remove ride the briefing-update op to the peer', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        const bid = await createBriefingUI(A);
        await collab.expectFullSync({ entityId: bid, entityType: 'briefing', operationType: 'create' });
        await collab.clearTraces();
        await renameBriefingUI(A, 'Com Slides');
        await collab.expectFullSync({ entityId: bid, entityType: 'briefing', operationType: 'update' });

        // ADD a slide → a briefing UPDATE op; B sees the slide.
        await collab.clearTraces();
        const sid = await addSlideUI(A, bid);
        await collab.expectFullSync({ entityId: bid, entityType: 'briefing', operationType: 'update' });
        await expect.poll(async () => (await readSlides(B, bid)).some((s) => s.id === sid), { timeout: 15000 }).toBe(true);

        // UPDATE the slide title → B sees the change.
        await collab.clearTraces();
        await renameSlideUI(A, 'Introdução');
        await collab.expectFullSync({ entityId: bid, entityType: 'briefing', operationType: 'update' });
        await expect
            .poll(async () => (await readSlides(B, bid)).find((s) => s.id === sid)?.titulo, { timeout: 15000 })
            .toBe('Introdução');

        // REMOVE the slide → B no longer has it.
        await collab.clearTraces();
        await deleteSlideUI(A, sid);
        await collab.expectFullSync({ entityId: bid, entityType: 'briefing', operationType: 'update' });
        await expect.poll(async () => (await readSlides(B, bid)).some((s) => s.id === sid), { timeout: 15000 }).toBe(false);
    });

    collabTest('temporal config enabled by A is reflected on B (synced setting value)', async ({ collab }) => {
        const A = collab.author;
        const B = collab.peers[0];

        // Enable temporal control on A via the real Maps-tab clock toggle (persists + syncs).
        await enableTemporalUI(A);
        // no-UI: exact epoch bounds + unit have no single-gesture UI; set via the store op so the
        // synced config carries the exact values the assertion pins. Temporal config is a per-map
        // setting (not an id-keyed entity row), so it is verified by the synced value on B.
        await A.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.setMapTemporalConfig('Mapa Tático', {
                ativo: true, unidade: 'horas', inicio: 1700000000000, fim: 1700003600000,
            });
        });

        await expect
            .poll(async () => {
                const cfg = await readTemporal(B, 'Mapa Tático');
                return cfg && cfg.ativo === true && cfg.unidade === 'horas' ? cfg.inicio : null;
            }, { timeout: 20000 })
            .toBe(1700000000000);
    });
});
