// Path: e2e-ui/comentario-edicao-depois-do-par.repro.spec.js

/**
 * @fileoverview COMENTARIO ESPACIAL: A EDICAO DE UM, DEPOIS DE RECEBER A DO OUTRO.
 *
 * A HIPOTESE. O par grava o comentario que chega com o payload INTEIRO do autor
 * (`applyRemoteCommentOp`, `store/sync/remote-operation-handler.js`), e esse payload carrega a
 * revisao confirmada que o AUTOR tinha antes da edicao. O servidor ja' passou dela. A proxima edicao
 * de quem recebeu declara essa base velha e o servidor, que viu a unidade mudar depois dela, recusa:
 * "Os mesmos campos foram alterados no servidor." Quem recebeu tinha visto a mudanca; perde uma
 * corrida contra ninguem. E' a mesma classe corrigida nos ajustes de mapa (7b520625).
 *
 * O GESTO, todo pela tela: o comentario nasce por Shift+C e clique no mapa; o texto e a resolucao
 * sao pelos controles reais do cartao. O veredito e' o Postgres e a fila de quem recebeu.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test comentario-edicao-depois-do-par --retries=0 --workers=1
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const focar = (page, id) => page.evaluate(async (rootId) => {
    const { getControl } = await import('/src/js/store/control.registry.js');
    await getControl('commentOverlay').focusComment(rootId);
}, id);

const comentarioNoDisco = (page, id) => page.evaluate(async (rootId) => {
    const store = await import('/src/js/store/index.js');
    const c = (await store.getComments(await store.getCurrentMapName()))[rootId];
    return c ? { texto: c.text, status: c.status } : null;
}, id);

const problemas = (page) => page.evaluate(async () => {
    const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
    return ((await operationQueue.getIssues?.()) ?? []).map((i) => ({
        tipo: i.operation?.entityType, razao: i.result?.reason ?? null,
    }));
});

const noServidor = (db, id) => db.raw.oneOrNone('SELECT status, data->>\'text\' AS texto FROM comments WHERE id = $1', [id]);

/** Cria um comentario pela tela: Shift+C, clique no mapa, texto, Enviar. Devolve o id. */
async function criarComentarioUI(page, texto) {
    const antes = await page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return Object.keys(await store.getComments(await store.getCurrentMapName()));
    });
    await page.keyboard.press('Shift+C');
    const caixa = await page.locator('#map-sig canvas').boundingBox();
    await page.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.getByTestId('comment-compose-input').fill(texto);
    await page.getByTestId('comment-compose-submit').click();
    let id = null;
    await expect.poll(async () => {
        id = await page.evaluate(async (vistos) => {
            const store = await import('/src/js/store/index.js');
            return Object.keys(await store.getComments(await store.getCurrentMapName())).find((k) => !vistos.includes(k)) ?? null;
        }, antes);
        return id;
    }, { timeout: 10000, message: 'o comentario nao nasceu' }).toBeTruthy();
    await page.keyboard.press('Escape');
    return id;
}

async function editarTextoUI(page, id, texto) {
    await focar(page, id);
    const minha = page.locator('.comment-entry').first();
    await minha.locator('[data-testid="comment-edit-open"]').click();
    await page.locator('.comment-entry textarea').fill(texto);
    await page.locator('.comment-entry .comment-composer__btn--primary').click();
}

async function resolverUI(page, id) {
    await focar(page, id);
    await page.getByTestId('comment-resolve').click();
}

collabTest.describe('Comentario editado depois de receber a edicao do colega', () => {
    collabTest('A edita o texto; B, que ja recebeu, resolve: o servidor aceita e todos convergem', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await criarComentarioUI(A, 'Texto original');
        await expect.poll(async () => (await noServidor(collab.db, id))?.texto, { timeout: 20000 }).toBe('Texto original');
        await expect.poll(async () => (await comentarioNoDisco(B, id))?.texto, { timeout: 20000 }).toBe('Texto original');

        await editarTextoUI(A, id, 'Texto corrigido pelo A');
        await expect.poll(async () => (await noServidor(collab.db, id))?.texto, { timeout: 20000 }).toBe('Texto corrigido pelo A');
        await expect.poll(async () => (await comentarioNoDisco(B, id))?.texto, { timeout: 20000 }).toBe('Texto corrigido pelo A');

        await resolverUI(B, id);
        await expect.poll(async () => (await problemas(B)).length > 0 || (await noServidor(collab.db, id))?.status === 'resolved',
            { timeout: 20000 }).toBe(true);
        const retrato = { servidor: await noServidor(collab.db, id), problemasB: await problemas(B), A: await comentarioNoDisco(A, id), B: await comentarioNoDisco(B, id) };
        console.log(`\n===== RETRATO (texto, depois resolver) =====\n${JSON.stringify(retrato, null, 2)}\n`);
        expect.soft(retrato.problemasB, 'nenhuma recusa em B').toEqual([]);
        expect.soft(retrato.servidor, 'o servidor tem o texto de A e a resolucao de B').toEqual({ status: 'resolved', texto: 'Texto corrigido pelo A' });
        await expect.poll(async () => comentarioNoDisco(A, id), { timeout: 15000 }).toEqual({ texto: 'Texto corrigido pelo A', status: 'resolved' });
    });

    collabTest('B resolve; A, que ja recebeu, reabre e edita o texto: o servidor aceita', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await criarComentarioUI(A, 'Texto original');
        await expect.poll(async () => (await comentarioNoDisco(B, id))?.texto, { timeout: 20000 }).toBe('Texto original');

        await resolverUI(B, id);
        await expect.poll(async () => (await noServidor(collab.db, id))?.status, { timeout: 20000 }).toBe('resolved');
        await expect.poll(async () => (await comentarioNoDisco(A, id))?.status, { timeout: 20000 }).toBe('resolved');

        // A reabre pelo cartao (o mesmo botao alterna) e corrige o texto.
        await resolverUI(A, id);
        await expect.poll(async () => (await problemas(A)).length > 0 || (await noServidor(collab.db, id))?.status === 'open',
            { timeout: 20000 }).toBe(true);
        const depoisDeReabrir = { servidor: await noServidor(collab.db, id), problemasA: await problemas(A) };
        console.log(`\n===== RETRATO (resolvido pelo B, reaberto pelo A) =====\n${JSON.stringify(depoisDeReabrir, null, 2)}\n`);
        expect.soft(depoisDeReabrir.problemasA, 'nenhuma recusa em A ao reabrir').toEqual([]);
        expect.soft(depoisDeReabrir.servidor?.status, 'o servidor reabriu').toBe('open');
    });
    collabTest('AO MESMO TEMPO: A edita o texto enquanto B resolve; servidor e clientes ficam iguais', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await criarComentarioUI(A, 'Texto original');
        await expect.poll(async () => (await comentarioNoDisco(B, id))?.texto, { timeout: 20000 }).toBe('Texto original');

        // O envio de A fica RETIDO: A edita o texto, B resolve e o servidor confirma a resolucao.
        let soltar;
        const portao = new Promise((resolve) => { soltar = resolve; });
        let retidos = 0;
        await A.route('**/atlas/*/sync', async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            retidos += 1;
            await portao;
            return route.continue();
        });
        await editarTextoUI(A, id, 'Texto corrigido pelo A');
        await expect.poll(() => retidos, { timeout: 15000 }).toBeGreaterThan(0);
        await resolverUI(B, id);
        await expect.poll(async () => (await noServidor(collab.db, id))?.status, { timeout: 20000 }).toBe('resolved');
        soltar();
        await expect.poll(async () => (await noServidor(collab.db, id))?.texto, { timeout: 20000 }).toBe('Texto corrigido pelo A');
        await A.waitForTimeout(3000);

        const retrato = { servidor: await noServidor(collab.db, id), A: await comentarioNoDisco(A, id), B: await comentarioNoDisco(B, id),
            problemasA: await problemas(A), problemasB: await problemas(B) };
        console.log(`
===== RETRATO (concorrente) =====
${JSON.stringify(retrato, null, 2)}
`);
        expect.soft(retrato.servidor, 'o servidor guarda o texto de A E a resolucao de B').toEqual({ status: 'resolved', texto: 'Texto corrigido pelo A' });
        expect.soft(retrato.A, 'A igual ao servidor').toEqual({ status: retrato.servidor.status, texto: retrato.servidor.texto });
        expect.soft(retrato.B, 'B igual ao servidor').toEqual({ status: retrato.servidor.status, texto: retrato.servidor.texto });
    });
    collabTest('AO MESMO TEMPO, ao contrario: B resolve com a copia velha do texto; o texto de A fica em todos', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await criarComentarioUI(A, 'Texto original');
        await expect.poll(async () => (await comentarioNoDisco(B, id))?.texto, { timeout: 20000 }).toBe('Texto original');

        // O envio de B fica RETIDO: B resolve com a copia que tem; A corrige o texto e o servidor confirma.
        let soltar;
        const portao = new Promise((resolve) => { soltar = resolve; });
        let retidos = 0;
        await B.route('**/atlas/*/sync', async (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            retidos += 1;
            await portao;
            return route.continue();
        });
        await resolverUI(B, id);
        await expect.poll(() => retidos, { timeout: 15000 }).toBeGreaterThan(0);
        await editarTextoUI(A, id, 'Texto corrigido pelo A');
        await expect.poll(async () => (await noServidor(collab.db, id))?.texto, { timeout: 20000 }).toBe('Texto corrigido pelo A');
        soltar();
        await expect.poll(async () => (await noServidor(collab.db, id))?.status, { timeout: 20000 }).toBe('resolved');
        await expect.poll(async () => (await comentarioNoDisco(A, id))?.status, { timeout: 20000 }).toBe('resolved');

        const retrato = { servidor: await noServidor(collab.db, id), A: await comentarioNoDisco(A, id), B: await comentarioNoDisco(B, id) };
        console.log(`
===== RETRATO (concorrente, ao contrario) =====
${JSON.stringify(retrato, null, 2)}
`);
        expect.soft(retrato.servidor, 'o servidor guarda o texto de A e a resolucao de B').toEqual({ status: 'resolved', texto: 'Texto corrigido pelo A' });
        expect.soft(retrato.A, 'A continua com o proprio texto').toEqual({ status: 'resolved', texto: 'Texto corrigido pelo A' });
        await expect.poll(async () => comentarioNoDisco(B, id), { timeout: 15000 }).toEqual({ status: 'resolved', texto: 'Texto corrigido pelo A' });
    });
});
