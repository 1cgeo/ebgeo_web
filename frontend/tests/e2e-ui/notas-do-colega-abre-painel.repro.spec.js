// Path: e2e-ui/notas-do-colega-abre-painel.repro.spec.js

/**
 * @fileoverview AS NOTAS QUE O COLEGA SALVA: o que chega ao par e o que o par consegue fazer depois.
 *
 * DOIS DEFEITOS, os dois em `applyRemoteMapSettingOp` (`store/sync/remote-operation-handler.js`),
 * ramo `MAP_NOTES`:
 *
 * (1) A NOTA DO COLEGA ERA RECUSADA COMO CONFLITO NA PRIMEIRA EDICAO SEGUINTE. A op de notas do par
 *     move a revisao do MAPA no servidor, mas o registro do mapa no par continua com a revisao
 *     confirmada de antes. A proxima edicao de notas do par declara essa base velha, e o servidor,
 *     que viu a unidade "notas" mudar depois dela, recusa: "Os mesmos campos foram alterados no
 *     servidor." O par tinha visto a mudanca; ele perde uma corrida contra ninguem. A op de MAPA
 *     vinda do par ja' limpa a base por essa razao (`mergeRemoteMapUpdate`); os cinco ajustes de
 *     mapa (notas, grade, posicao, mapa base, temporal) nao.
 *
 * (2) A NOTA DO COLEGA ABRIA O PAINEL DE NOTAS NA TELA DE TODO MUNDO. O ramo emitia
 *     `MAP_NOTES_REQUESTED`, que e' o PEDIDO de abrir o painel (o botao de notas da aba Mapas): quem
 *     estava fazendo qualquer outra coisa via a barra lateral recolher e o painel de notas tomar o
 *     lugar do que estava aberto, com botao de Editar inclusive para quem so' le.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test notas-do-colega-abre-painel --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const notasNoServidor = (db, mapId) =>
    db.raw.oneOrNone('SELECT notes_title, notes_description FROM maps WHERE id = $1', [mapId]);

const notasNoDisco = (page, mapa) => page.evaluate(async (m) => {
    const store = await import('/src/js/store/index.js');
    return (await store.getMapNotes(m)) ?? null;
}, mapa);

async function abrirNotasUI(page) {
    if (!(await page.locator('.maps-tab #current-map-notes-btn').isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await expect(page.locator('.maps-tab #current-map-name-input')).not.toHaveValue('', { timeout: 15000 });
    await page.locator('.maps-tab #current-map-notes-btn').click();
    await expect(page.locator('.map-notes-sidebar-edit-btn')).toBeVisible({ timeout: 10000 });
}

async function editarNotasUI(page, { titulo, texto }) {
    await page.locator('.map-notes-sidebar-edit-btn').click();
    const campo = page.locator('.map-notes-sidebar-title-input');
    await expect(campo).toBeVisible({ timeout: 5000 });
    if (titulo !== undefined) await campo.fill(titulo);
    if (texto !== undefined) {
        await page.locator('.map-notes-quill-editor .ql-editor').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(texto);
    }
    await page.locator('.map-notes-sidebar-save-btn').click();
    await expect(page.locator('.map-notes-sidebar-edit-btn')).toBeVisible({ timeout: 10000 });
}

/** B escreve notas, e elas chegam ao servidor e ao disco de A. */
async function bEscreveNotas(collab, B, A) {
    await abrirNotasUI(B);
    await editarNotasUI(B, { titulo: 'Notas do B', texto: 'Descricao escrita pelo B' });
    await expect.poll(async () => (await notasNoServidor(collab.db, collab.mapId))?.notes_description ?? '',
        { timeout: 20000, message: 'as notas de B nunca chegaram ao servidor' }).toContain('Descricao escrita pelo B');
    await expect.poll(async () => (await notasNoDisco(A, collab.mapName))?.description ?? '',
        { timeout: 20000, message: 'as notas de B nunca chegaram ao disco de A' }).toContain('Descricao escrita pelo B');
}

collabTest.describe('Notas salvas pelo colega', () => {
    collabTest('(2) as notas do colega NAO abrem o painel de notas na tela de A', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        // A esta na aba de camadas, sem painel de notas.
        await A.locator('.sidebar-nav-btn[data-tab="camadas"], .sidebar-nav-btn[data-tab="layers"]').first().click().catch(() => {});
        await expect(A.locator('.map-notes-sidebar-content')).toHaveCount(0);

        await bEscreveNotas(collab, B, A);
        // O evento que abriria o painel e' sincrono com a gravacao do disco; uma folga curta basta
        // para ele desenhar, se fosse desenhar.
        await A.waitForTimeout(1500);
        await expect(A.locator('.map-notes-sidebar-content'), 'o painel de notas nao abriu sozinho na tela de A')
            .toHaveCount(0);
    });
});
