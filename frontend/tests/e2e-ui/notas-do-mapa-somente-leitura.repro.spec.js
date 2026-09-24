// Path: e2e-ui/notas-do-mapa-somente-leitura.repro.spec.js

/**
 * @fileoverview AS NOTAS DO MAPA SÓ OFERECEM "EDITAR" A QUEM PODE EDITAR.
 *
 * O painel de notas decidia o "Editar" só pela trava do mapa (`isMapLocked`, em
 * `_handleShowCurrentMapNotes`): o Leitor e o Comentarista recebiam o botão, abriam o editor,
 * escreviam, e o "Salvar" era recusado pela store (`setMapNotes` pergunta `UPDATE_MAP`). E a trava
 * que chegava com o painel aberto deixava o botão lá. A regra é a das outras superfícies de edição
 * (decisão do dono de 2026-09-16): sem edição, pelo posto ou pela trava, o comando some; ler e
 * baixar as notas continuam.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

/** Abre as notas do mapa corrente pela aba Mapas. */
async function abrirNotas(page) {
    const botao = page.locator('#current-map-notes-btn');
    if (!(await botao.isVisible())) await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await botao.click();
    const painel = page.locator('.map-notes-sidebar-content');
    await expect(painel).toBeVisible({ timeout: 10000 });
    return painel;
}

for (const [permission, papel] of [['read', 'Leitor'], ['comment', 'Comentarista']]) {
    collabTest.describe(`o ${papel}`, () => {
        collabTest.use({ collabOptions: { peers: 1, permission, mapName: 'Mapa Tático' } });

        collabTest(`lê e baixa as notas, sem "Editar" (${papel})`, async ({ collab }) => {
            collabTest.setTimeout(120000);
            const B = collab.peers[0];
            const painel = await abrirNotas(B);
            await expect(painel.locator('.map-notes-sidebar-download-btn')).toBeVisible();
            await expect(painel.locator('.map-notes-sidebar-edit-btn'), `"Editar" desenhado para o ${papel}`)
                .toHaveCount(0);
        });
    });
}

collabTest('a trava que chega com as notas abertas tira o "Editar", e a que sai o devolve', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];

    const painel = await abrirNotas(B);
    await expect(painel.locator('.map-notes-sidebar-edit-btn')).toBeVisible();

    const alternarTrava = () => A.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        await mapLockController.toggleMapLock();
    });
    const travadoEmB = () => B.evaluate(async () => (await import('/src/js/store/index.js')).isCurrentMapLockedSync());

    await alternarTrava();
    await expect.poll(travadoEmB, { timeout: 30000 }).toBe(true);
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-edit-btn'),
        'a trava chegou e o "Editar" continuou').toHaveCount(0, { timeout: 10000 });
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-download-btn')).toBeVisible();

    await alternarTrava();
    await expect.poll(travadoEmB, { timeout: 30000 }).toBe(false);
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-edit-btn'),
        'destravar não devolveu o "Editar"').toBeVisible({ timeout: 10000 });
});
