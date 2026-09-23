import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend');
test.describe.configure({ retries: 0 });

test('a peer resolves and reopens a thread without erasing the reply being written', async ({ browser }, info) => {
    test.setTimeout(120000);
    const seed = await seedSharedAtlas(browser, state.baseUrl);
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
    const db = createDb(state.dbName);
    const focus = (page, id) => page.evaluate(async rootId => {
        const { getControl } = await import('/src/js/store/control.registry.js');
        await getControl('commentOverlay').focusComment(rootId);
    }, id);
    try {
        // The discussion is setup; the draft, resolution, reopening and submission use real controls.
        const id = await A.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const comment = await store.addComment({ lng: -43.2, lat: -22.9, text: 'Conversa colaborativa' });
            return comment.id;
        });
        await expect.poll(() => B.evaluate(async rootId => {
            const store = await import('/src/js/store/index.js');
            return Boolean((await store.getComments(await store.getCurrentMapName()))[rootId]);
        }, id)).toBe(true);
        await focus(A, id);
        await focus(B, id);
        const draft = B.getByTestId('comment-reply-input');
        await draft.fill('Minha resposta precisa continuar aqui');
        await A.getByTestId('comment-resolve').click();
        await expect.poll(() => B.evaluate(async rootId => {
            const store = await import('/src/js/store/index.js');
            return (await store.getComments(await store.getCurrentMapName()))[rootId]?.status;
        }, id)).toBe('resolved');
        await expect(draft).toHaveValue('Minha resposta precisa continuar aqui');
        await B.getByTestId('comment-reply-submit').click();
        await expect(draft).toHaveValue('Minha resposta precisa continuar aqui');
        expect(await db.raw.one('SELECT count(*)::int AS n FROM comments WHERE parent_id=$1', [id])).toEqual({ n: 0 });
        await B.screenshot({ path: info.outputPath('draft-preserved-after-peer-resolution.png') });
        await focus(A, id);
        await A.getByTestId('comment-resolve').click();
        await expect.poll(() => B.evaluate(async rootId => {
            const store = await import('/src/js/store/index.js');
            return (await store.getComments(await store.getCurrentMapName()))[rootId]?.status;
        }, id)).toBe('open');
        await expect(draft).toHaveValue('Minha resposta precisa continuar aqui');
        await B.getByTestId('comment-reply-submit').click();
        await expect(B.locator('.comment-entry__text').filter({ hasText: 'Minha resposta precisa continuar aqui' })).toBeVisible();
        await expect(B.getByTestId('comment-reply-input')).toHaveValue('');
        await expect.poll(async () => (await db.raw.one('SELECT count(*)::int AS n FROM comments WHERE parent_id=$1 AND author_id=$2',
            [id, seed.userB.id])).n).toBe(1);
    } finally {
        await Promise.all([A.context().close(), B.context().close()]);
        await closeDb();
    }
});
