import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { loginUI } from './helpers/collab-helpers.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
test.skip(state.skip, 'Requires the real backend');
test.describe.configure({ retries: 0 });

test('file import warns about omitted comments before publishing and cancellation writes nothing', async ({ page }, info) => {
    test.setTimeout(90000);
    const user = await createVerifiedUser({ prefix: 'comment_file', nome: 'Comment import' });
    const db = createDb(state.dbName);
    const document = { version: '3.0', maps: { Principal: { features: {} } }, comments: { Principal: {
        root: { id: 'root', text: 'Conversa original', surface: '2d' },
        reply: { id: 'reply', parentId: 'root', text: 'Resposta original' },
    } } };
    const zip = new JSZip();
    zip.file('data.json', JSON.stringify(document));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    try {
        await page.goto('/');
        await loginUI(page, user.username, user.password);
        const before = await db.raw.one('SELECT count(*)::int AS n FROM atlas WHERE owner_id=$1', [user.id]);
        const select = () => page.getByTestId('project-picker-import-input').setInputFiles({
            name: 'discussao.ebgeo', mimeType: 'application/octet-stream', buffer,
        });
        await select();
        const warning = page.locator('.confirm-modal-container');
        await expect(warning).toContainText('2 comentários');
        await expect(warning).toContainText('arquivo .ebgeo original');
        expect(await db.raw.one('SELECT count(*)::int AS n FROM atlas WHERE owner_id=$1', [user.id])).toEqual(before);
        await page.screenshot({ path: info.outputPath('comments-omission-consent.png'), animations: 'disabled' });
        await warning.locator('.confirm-modal-btn-cancel').click();
        await expect(warning).not.toBeVisible();
        expect(await db.raw.one('SELECT count(*)::int AS n FROM atlas WHERE owner_id=$1', [user.id])).toEqual(before);
        await expect(page.getByTestId('project-picker-import')).toBeEnabled();
        await select();
        await expect(warning).toContainText('2 comentários');
        await warning.locator('.confirm-modal-btn-confirm').click();
        await page.waitForURL(/[?&]atlas=/);
        const published = await db.raw.one('SELECT count(*)::int AS n FROM atlas WHERE owner_id=$1', [user.id]);
        expect(published.n).toBe(before.n + 1);
        const original = JSON.parse(await (await JSZip.loadAsync(buffer)).file('data.json').async('string'));
        expect(original).toEqual(document);
    } finally {
        await closeDb();
    }
});
