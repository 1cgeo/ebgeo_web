// Path: e2e-ui/browser-delete-atlas.spec.js

/**
 * @fileoverview Browser E2E for "Excluir projeto" (§1.4 / item-1.4) — deleting a server atlas.
 *
 * Two real Chromium clients on one shared atlas. The OWNER deletes the project via the account menu
 * (double confirmation). The server soft-deletes the atlas and broadcasts `atlas_deleted`; BOTH the
 * owner and the connected peer must tear down their remote store and land back on the project picker,
 * and the atlas must be gone from the server's list.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Delete server atlas (owner) → all clients redirected', () => {
    test('owner deletes the atlas; the connected peer is torn down and sent to the picker', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA); // owner
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB); // writer (peer)
        try {
            // The owner-only "Excluir projeto" item is visible to A.
            await A.locator('[data-testid="account-control"] .account-control__identity').click();
            const delBtn = A.locator('[data-testid="account-delete-atlas-btn"]');
            await expect(delBtn).toBeVisible();
            await delBtn.click();

            // Double confirmation.
            await A.locator('.confirm-modal-btn-confirm').click();
            await A.locator('.confirm-modal-btn-confirm', { hasText: 'definitivamente' }).click();

            // The PEER (B) is redirected to the project picker by the `atlas_deleted` broadcast.
            await expect(B.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 20000 });
            // The owner (A) is redirected too.
            await expect(A.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 20000 });

            // And the atlas no longer exists on the server.
            const gone = await B.evaluate(async ({ base, c, atlasId }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const list = await api.listAtlas();
                return !list.some((p) => p.id === atlasId);
            }, { base: state.baseUrl, c: seed.userB, atlasId: seed.atlasId });
            expect(gone).toBe(true);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
