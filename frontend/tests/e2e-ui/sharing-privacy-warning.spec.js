import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Sharing privacy when the loan list is unavailable', () => {
    test('a failed request never looks like a confirmed empty private-resource list', async ({ page }, testInfo) => {
        const creds = await createVerifiedUser({ prefix: 'privacy', nome: 'Privacy Owner' });
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        let fail = true;
        await page.route('**/api/v1/atlas/*/resources', (route) => fail
            ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
            : route.continue());
        const unavailable = page.waitForResponse(response => response.url().endsWith('/resources') && response.status() === 503);
        const atlasId = await page.evaluate(async (credentials) => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            const { openSharingModal } = await import('/src/js/modals/sharing.modal.core.js');
            await apiClient.login(credentials.username, credentials.password);
            const atlas = await apiClient.createAtlas({ name: 'Privacy warning' });
            window.privacyModal = openSharingModal(atlas.id);
            return atlas.id;
        }, creds);
        await unavailable;
        await expect(page.getByTestId('sharing-exposicao')).toContainText('não confirmada');
        await expect(page.getByTestId('sharing-exposicao')).toContainText('sem exigir login');
        await page.screenshot({ path: testInfo.outputPath('sharing-privacy-warning.png') });
        // Reopening with a real, empty response clears the uncertainty notice.
        fail = false;
        await page.evaluate(async (id) => {
            window.privacyModal.hide();
            const { openSharingModal } = await import('/src/js/modals/sharing.modal.core.js');
            window.privacyModal = openSharingModal(id);
        }, atlasId);
        await expect(page.getByTestId('sharing-public-toggle')).toBeVisible();
        await expect(page.getByTestId('sharing-exposicao')).toHaveCount(0);
    });
});
