// Path: e2e-ui/matriz-de-papeis-aba-mapas.spec.js

/**
 * THE MAPS TAB OF A SERVER ATLAS, PER ROLE, in real Chromium against the real backend: what a Leitor
 * and a Comentarista are OFFERED, measured by what is VISIBLE on the screen, not by the flag a
 * component set.
 *
 * WHAT THIS FILE CAUGHT (2026-09-24, role-matrix hunt): the "Novo mapa" button stayed on the screen
 * for a Leitor and a Comentarista. `_updateActionsVisibility` (`sidebar/tabs/maps.tab.js`) sets
 * `hidden` on it when `checkPermission('CREATE_MAP')` refuses, and its comment says why ("this
 * button used to offer it to a Leitor, who was asked for a name and only then refused by the
 * store"); but `.sidebar-section-header-btn` sets `display: flex` in `sidebar.css`, which beats
 * the `hidden` attribute, so the fix never reached the screen. The rule of the house is broken
 * exactly where it was declared kept: a command the RANK forbids is drawn. A spec that asserted
 * the attribute would have passed; this one asserts visibility.
 *
 * The owner in the same atlas is the POSITIVE CONTROL: the button is visible for them, so a wrong
 * selector cannot pass the Leitor's absence.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('[data-testid="maps-new-map"]')).toBeAttached({ timeout: 10000 });
}

for (const permission of ['read', 'comment']) {
    collabTest.describe(`Aba Mapas: o posto some (${permission})`, () => {
        collabTest.use({ collabOptions: { peers: 1, permission, mapName: 'Mapa Tático' } });

        collabTest(`"Novo mapa" não aparece para quem não cria mapa (${permission})`, async ({ collab }) => {
            const A = collab.author;
            const B = collab.peers[0];

            await abrirAbaMapas(A);
            await expect(A.locator('[data-testid="maps-new-map"]'), 'controle: o dono vê o botão').toBeVisible();

            await abrirAbaMapas(B);
            await expect(B.locator('[data-testid="maps-new-map"]')).toBeHidden();
        });
    });
}
