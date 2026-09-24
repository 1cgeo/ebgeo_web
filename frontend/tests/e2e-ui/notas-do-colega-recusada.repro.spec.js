// Path: e2e-ui/notas-do-colega-recusada.repro.spec.js

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
 *   cd frontend && npx playwright test notas-do-colega-recusada --retries=0 --workers=1
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
    collabTest('(1) depois de receber as notas do colega, A consegue editar as notas', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        await bEscreveNotas(collab, B, A);

        // A abre as notas (ja' com as de B) e corrige so o titulo.
        if (!(await A.locator('.map-notes-sidebar-edit-btn').isVisible().catch(() => false))) await abrirNotasUI(A);
        await editarNotasUI(A, { titulo: 'Notas (titulo corrigido pelo A)' });

        // O servidor aceita (recusada, a op deixa o titulo de B no servidor e o poll estoura).
        await expect.poll(async () => (await notasNoServidor(collab.db, collab.mapId))?.notes_title,
            { timeout: 20000, message: 'o servidor nao aceitou o titulo de A' }).toBe('Notas (titulo corrigido pelo A)');
        const problemas = await A.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            return ((await operationQueue.getIssues?.()) ?? []).map((i) => i.result?.reason ?? null);
        });
        expect(problemas, 'nenhuma pendencia de conflito em A').toEqual([]);
        expect((await notasNoServidor(collab.db, collab.mapId))?.notes_description ?? '').toContain('Descricao escrita pelo B');
        await expect.poll(async () => (await notasNoDisco(B, collab.mapName))?.title, { timeout: 20000 })
            .toBe('Notas (titulo corrigido pelo A)');
    });
});
