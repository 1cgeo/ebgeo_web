import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend');
test.describe.configure({ retries: 0 });

test('owner edits own text but cannot edit the peer reply', async ({ browser }, info) => {
    const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
    const db = createDb(state.dbName);
    const rootId = randomUUID();
    const replyId = randomUUID();
    const create = async (user, id, data) => {
        const api = new ApiClient({ baseUrl: `${state.baseUrl}/api/v1` });
        await api.login(user.username, user.password);
        const result = await api.pushOperations(seed.atlasId, [{ protocolVersion: 2,
            id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: id,
            mapId: seed.mapId, timestamp: Date.now(), clientId: 'author-edit-ui',
            data: { id, status: 'open', authorId: user.id, authorInitials: user === seed.userA ? 'AL' : 'BR', ...data },
        }]);
        expect(result.results[0].rejected).not.toBe(true);
    };
    await create(seed.userA, rootId, { lng: -43.2, lat: -22.9, text: 'Texto do autor' });
    await create(seed.userB, replyId, { parentId: rootId, text: 'Resposta do colega' });
    const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    try {
        await page.evaluate(async (id) => {
            const { getControl } = await import('/src/js/store/control.registry.js');
            await getControl('commentOverlay').focusComment(id);
        }, rootId);
        const entries = page.locator('.comment-entry');
        const mine = entries.filter({ hasText: 'Texto do autor' });
        await expect(mine.locator('[data-testid="comment-edit-open"]')).toBeVisible();
        await expect(entries.filter({ hasText: 'Resposta do colega' }).locator('[data-testid="comment-edit-open"]')).toHaveCount(0);
        await mine.locator('[data-testid="comment-edit-open"]').click();
        await page.locator('.comment-entry textarea').fill('Texto corrigido pelo autor');
        await page.locator('.comment-entry .comment-composer__btn--primary').click();
        await expect.poll(async () => (await db.raw.one('SELECT data FROM comments WHERE id = $1', [rootId])).data.text)
            .toBe('Texto corrigido pelo autor');
        expect((await db.raw.one('SELECT data FROM comments WHERE id = $1', [replyId])).data.text).toBe('Resposta do colega');
        await expect(entries.filter({ hasText: 'Resposta do colega' }).locator('[data-testid="comment-edit-open"]')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('author-only-edit.png') });
    } finally {
        await page.context().close();
        await closeDb();
    }
});
