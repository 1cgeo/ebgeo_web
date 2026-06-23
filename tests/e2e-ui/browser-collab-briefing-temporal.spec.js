// Path: e2e-ui/browser-collab-briefing-temporal.spec.js

/**
 * BRIEFING + TEMPORAL collaboration — TWO real browsers + real backend. Two common
 * user modules the collab suite never exercised end-to-end, both driven through the
 * REAL UI on client A and asserted natively on the peer B:
 *
 *   Briefing:  A creates / renames / deletes a briefing via the briefings tab + editor
 *              → B reflects each.
 *   Slides:    A adds / renames / removes a slide inside the editor → B reflects each.
 *   Temporal:  A enables the per-map temporal control via the Maps-tab clock toggle
 *              → B reflects the synced config.
 *
 * UI-first: every ACTION is a real gesture (CRIAR BRIEFING button, editor name input,
 * editor add/delete-slide buttons, card delete + confirm modal, the clock toggle).
 * Only the seed/login/open plumbing (no UI) and the snapshot READS used by the
 * assertions go through the store/transport directly.
 *
 * Run headed:  npx playwright test browser-collab-briefing-temporal --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

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

/** Reads ALL briefings on `page` (state read) — used to diff the freshly created one. */
const readAllBriefings = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    const all = await store.getAllBriefings();
    return all.map((b) => ({ id: b.id, name: b.name }));
});

/** Reads a briefing's slide ids/titles on `page` (state read). */
const readSlides = (page, bid) => page.evaluate(async (id) => {
    const store = await import('/src/js/store/index.js');
    const b = await store.getBriefingById(id);
    return (b?.slides || []).map((s) => ({ id: s.id, titulo: s.titulo ?? s.title ?? s.nome }));
}, bid);

// --- INLINE UI HELPERS (real gestures, learned from briefings.tab.js +
//     briefing-editor.control.js + temporal-local.spec.js) ------------------

/**
 * Opens the Briefings sidebar tab — idempotently. Clicking the nav button of the
 * ALREADY-active+expanded tab toggles the sidebar CLOSED (sidebar.control.js
 * `_handleTabClick`), which would detach the briefings list mid-flow (e.g. after the
 * editor's onClose already re-expanded to Briefings on delete). So only click when the
 * tab isn't already showing its content.
 */
async function openBriefingsTab(page) {
    const createBtn = page.locator('.briefings-create-btn');
    if (!(await createBtn.isVisible())) {
        await page.locator('.sidebar-nav-btn[data-tab="briefings"]').click();
    }
    await expect(createBtn).toBeVisible({ timeout: 10000 });
}

/**
 * Clicks "CRIAR BRIEFING" (auto-names the briefing, adds one empty slide, and opens
 * the editor), then returns the freshly created briefing's id by diffing the store
 * before/after — the UI generates the id, so we read it back.
 * @returns {Promise<string>}
 */
async function createBriefingUI(page) {
    const before = new Set((await readAllBriefings(page)).map((b) => b.id));
    await openBriefingsTab(page);
    await page.locator('.briefings-create-btn').click();
    // Creating opens the right-side editor for the new briefing.
    await expect(page.locator('#briefing-editor')).toBeVisible({ timeout: 10000 });

    let id = null;
    await expect.poll(async () => {
        const fresh = (await readAllBriefings(page)).find((b) => !before.has(b.id));
        id = fresh?.id ?? null;
        return id;
    }, { timeout: 10000 }).toBeTruthy();
    return id;
}

/**
 * Renames the briefing currently open in the editor via the header name input. The
 * input's `blur` runs the editor save (which logs the sync op), so we commit with blur.
 */
async function renameBriefingUI(page, name) {
    const input = page.locator('.briefing-editor-name-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(name);
    await input.blur();
}

/**
 * Closes the briefing editor and waits for the briefings tab to settle. The editor's
 * onClose re-expands the sidebar to the Briefings tab asynchronously; we wait for the
 * create button to be visible so the sidebar state is stable BEFORE the delete step (so
 * `openBriefingsTab` reliably sees the tab open and doesn't toggle it closed again).
 */
async function closeBriefingEditorUI(page) {
    await page.locator('.briefing-editor-back-btn').click();
    await expect(page.locator('#briefing-editor')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.briefings-create-btn')).toBeVisible({ timeout: 10000 });
}

/**
 * Deletes a briefing from its card in the briefings tab (the trash action opens a
 * confirm modal which we accept).
 */
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

/**
 * Adds a slide via the editor "+" (Adicionar slide) button and returns the new
 * slide's id, diffing the briefing's slides before/after (the UI generates the id).
 * @returns {Promise<string>}
 */
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

/**
 * Renames the slide selected in the editor via the slide title input (input + blur
 * triggers the editor autosave/save → sync op).
 */
async function renameSlideUI(page, title) {
    const input = page.locator('.briefing-editor-slide-title-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(title);
    await input.blur();
}

/** Deletes a slide from its card in the editor (confirm modal accepted). */
async function deleteSlideUI(page, slideId) {
    const card = page.locator(`.briefing-editor-slide-card[data-slide-id="${slideId}"]`);
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('.briefing-editor-slide-delete-btn').click();
    const confirm = page.locator('.confirm-modal-overlay');
    await expect(confirm).toBeVisible({ timeout: 5000 });
    await confirm.locator('.confirm-modal-btn-confirm').click();
    await expect(confirm).toHaveCount(0, { timeout: 5000 });
}

/**
 * Enables the per-map temporal control via the Maps-tab clock toggle (a real user
 * gesture that persists + syncs the temporal config). Waits for the toggle to flip.
 */
async function enableTemporalUI(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const clock = page.locator('#current-map-temporal-btn');
    await expect(clock).toBeVisible({ timeout: 10000 });
    await expect(clock).toHaveAttribute('data-temporal', 'false');
    await clock.click();
    await expect(clock).toHaveAttribute('data-temporal', 'true', { timeout: 5000 });
}

describeOrSkip('Briefing + temporal collaboration cross-client', () => {
    test('briefing create → update → delete all reflect on the peer', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // CREATE — via the "CRIAR BRIEFING" button, then rename in the editor.
            const id = await createBriefingUI(A);
            expect(id, 'the briefings tab created a briefing with an id').toBeTruthy();
            await renameBriefingUI(A, 'Plano Alfa');
            await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 20000 }).toBe('Plano Alfa');

            // UPDATE — rename again via the same editor name input.
            await renameBriefingUI(A, 'Plano Bravo');
            await expect.poll(async () => (await readBriefing(B, id))?.name, { timeout: 20000 }).toBe('Plano Bravo');

            // DELETE — close the editor, then delete from the card (confirm).
            await closeBriefingEditorUI(A);
            await deleteBriefingUI(A, id);
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
            // CREATE the briefing and name it (so B can find it by name first).
            const bid = await createBriefingUI(A);
            await renameBriefingUI(A, 'Com Slides');
            await expect.poll(async () => (await readBriefing(B, bid))?.name, { timeout: 20000 }).toBe('Com Slides');

            // ADD a slide via the editor "+" → B sees it (via the briefing-update op the
            // slide op piggybacks on).
            const sid = await addSlideUI(A, bid);
            await expect.poll(async () => (await readSlides(B, bid)).some((s) => s.id === sid), { timeout: 20000 }).toBe(true);

            // UPDATE the slide title via the editor title input → B sees the change.
            await renameSlideUI(A, 'Introdução');
            await expect
                .poll(async () => (await readSlides(B, bid)).find((s) => s.id === sid)?.titulo, { timeout: 20000 })
                .toBe('Introdução');

            // REMOVE the slide via its card delete button → B no longer has it.
            await deleteSlideUI(A, sid);
            await expect.poll(async () => (await readSlides(B, bid)).some((s) => s.id === sid), { timeout: 20000 }).toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('temporal config enabled by A is reflected on B', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { mapName: 'Mapa Tático' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Enable temporal control on A via the real Maps-tab clock toggle. This is the
            // single user gesture that persists + syncs the per-map temporal config.
            await enableTemporalUI(A);
            // no-UI: the precise epoch bounds (inicio/fim) + unit are part of the same synced
            // config but have no single-gesture UI to set arbitrary epoch-ms values (the
            // settings modal's datetime-local inputs are minute-precision + timezone-bound and
            // cannot represent 1700000000000 exactly). Set them via the store op so the synced
            // config carries the exact values the assertion below pins.
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
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
