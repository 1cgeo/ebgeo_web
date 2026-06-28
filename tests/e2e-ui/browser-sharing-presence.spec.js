// Path: e2e-ui/browser-sharing-presence.spec.js

/**
 * Frente 8 / D3 — "Vendo agora" in the sharing dialog. When the owner opens the share modal while a
 * peer is connected to the same atlas, the peer shows up under "Vendo agora" (presenceStore → an
 * online avatar). The list is live (re-renders on PRESENCE_CHANGED).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Sharing — "Vendo agora" (online presence)', () => {
    test('the sharing modal lists a connected peer under "Vendo agora"', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const owner = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const peer = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Owner opens the account menu → Compartilhar.
            await owner.locator('[data-testid="account-control"] .account-control__identity').click();
            const shareBtn = owner.locator('[data-testid="account-share-btn"]');
            await expect(shareBtn).toBeVisible({ timeout: 10000 });
            await shareBtn.click();

            // The sharing modal opens; "Vendo agora" lists the online peer (at least one online avatar).
            await expect(owner.locator('[data-testid="sharing-modal"]')).toBeVisible();
            const presence = owner.locator('[data-testid="sharing-presence"]');
            await expect(presence).toBeVisible({ timeout: 10000 });
            await expect(presence.locator('.sharing-avatar--online')).not.toHaveCount(0);
        } finally {
            await owner.context().close();
            await peer.context().close();
        }
    });
});
