// Path: e2e-ui/notas-do-mapa-somente-leitura.repro.spec.js

/**
 * @fileoverview AS NOTAS DO MAPA SÓ OFERECEM "EDITAR" A QUEM PODE EDITAR.
 *
 * DOIS DEFEITOS, medidos em 2026-09-24 (3 de 3 vermelhos, Chromium) e de novo em 2026-09-25 (3 de 3):
 *
 * (1) O POSTO NÃO ENTRAVA NA CONTA. Quem pedia o painel (`_handleShowCurrentMapNotes`, na aba Mapas)
 *     mandava só a trava do mapa, então o Leitor e o Comentarista recebiam "Editar", abriam o editor,
 *     escreviam, e o "Salvar" era recusado pela store (`setMapNotes` pergunta `UPDATE_MAP`).
 * (2) A TRAVA QUE CHEGAVA COM O PAINEL ABERTO deixava o "Editar" lá, porque o painel só decidia ao
 *     nascer e nada o avisava depois.
 *
 * O conserto: quem decide é o painel (`notasSomenteLeitura`, `sidebar/panels/notes-panel.js`),
 * perguntando o que a store pergunta antes de gravar, e a barra lateral assina tudo o que muda a
 * resposta (`assinarEdicaoIndisponivel`) e atualiza o painel no lugar.
 *
 * NOS DOIS EIXOS O COMANDO SOME, e a trava não "desenha e recusa". O painel de notas é da mesma
 * família do painel de feição e da tabela de atributos, onde a trava esconde a edição (decisão do
 * dono de 2026-09-16, `semEdicaoSync`); o que desenha e recusa na aba Mapas é o menu POR MAPA, onde
 * o cadeado está ao lado. E o painel já escondia o "Editar" no mapa travado antes deste defeito: o
 * que faltava era o posto e a trava que chega. Ler e baixar as notas continuam, e a dica da
 * descrição vazia deixa de mandar clicar num botão que não está lá.
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const DICA_DE_QUEM_EDITA = 'Clique em editar para adicionar uma descrição...';
const DICA_DE_QUEM_LE = 'Sem descrição.';

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
            // O mapa semeado não tem notas: a dica vazia é a de quem só lê.
            await expect(painel.locator('.map-notes-sidebar-desc-display')).toHaveText(DICA_DE_QUEM_LE);
        });
    });
}

collabTest('a trava que chega com as notas abertas tira o "Editar", e a que sai o devolve', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];

    const painel = await abrirNotas(B);
    await expect(painel.locator('.map-notes-sidebar-edit-btn')).toBeVisible();
    await expect(painel.locator('.map-notes-sidebar-desc-display')).toHaveText(DICA_DE_QUEM_EDITA);

    // O dono trava o mapa pelo controlador, como o cadeado faz (o mesmo molde de
    // `tabela-de-atributos-somente-leitura.repro.spec.js`).
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
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-desc-display')).toHaveText(DICA_DE_QUEM_LE);

    await alternarTrava();
    await expect.poll(travadoEmB, { timeout: 30000 }).toBe(false);
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-edit-btn'),
        'destravar não devolveu o "Editar"').toBeVisible({ timeout: 10000 });
    await expect(B.locator('.map-notes-sidebar-content .map-notes-sidebar-desc-display')).toHaveText(DICA_DE_QUEM_EDITA);
});
