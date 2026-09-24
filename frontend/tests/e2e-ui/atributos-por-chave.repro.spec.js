// Path: e2e-ui/atributos-por-chave.repro.spec.js

/**
 * @fileoverview DOIS USUÁRIOS MEXENDO EM ATRIBUTOS DIFERENTES DA MESMA FEIÇÃO: AS DUAS MUDANÇAS
 * FICAM (decisão do dono em 2026-09-24).
 *
 * O DEFEITO. O objeto `properties.attributes` era UMA unidade de disputa, no patch do cliente e na
 * fronteira do servidor. B, sem rede, muda o atributo "y"; A exclui "x" da mesma feição e envia; B
 * volta, e a edição dele parte da revisão anterior à de A. O servidor a recusava ("Os mesmos campos
 * foram alterados no servidor."), ela virava um problema na fila de B, e a tela de B voltava a
 * mostrar o valor velho de "y". A mudança de B não chegava a ninguém.
 *
 * A INTERLEAVING PERDEDORA É DETERMINÍSTICA: B fica sem rede (o socket e o POST de sync recusados)
 * ANTES de editar, então a edição dele nunca vê a de A, e só volta depois de a de A estar no
 * servidor. Os gestos são os da aba Atributos do painel de feição.
 *
 * O QUE SE CONFERE, e por caminhos independentes: a linha no PostgreSQL, o store dos dois
 * clientes, a fila de B sem problema guardado, e o store de B depois de um F5.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function atributosNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.attributes ?? null;
}

function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? null;
    }, id);
}

function problemasNaFila(page) {
    return page.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.getIssues()).length;
    });
}

async function abrirAbaAtributos(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

async function criarAtributo(aba, chave, valor) {
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
}

async function mudarValor(page, aba, chave, valor) {
    await aba.locator('.feature-attribute-row', { hasText: chave }).locator('.feature-attribute-value').click();
    const campo = page.locator('.feature-attribute-value-input');
    await campo.fill(valor);
    await campo.press('Enter');
}

/**
 * Tira B da rede: todo socket novo de colaboração é fechado, o atual é derrubado, e o POST de sync
 * é recusado. Devolve a função que devolve a rede.
 */
async function semRede(page) {
    let fora = true;
    await page.context().routeWebSocket(/\/collab/, (ws) => {
        if (fora) ws.close();
        else ws.connectToServer();
    });
    await page.context().route('**/api/v1/atlas/*/sync', (route) => (fora ? route.abort() : route.continue()));
    await page.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close();
    });
    await expect(page.locator('[data-testid="sync-status-badge"]')).not.toHaveAttribute('data-state', 'online', { timeout: 30000 });
    return () => { fora = false; };
}

/** Um ponto de A com os atributos x e y, visto por B. */
async function pontoComDoisAtributos(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const aba = await abrirAbaAtributos(A, id);
    await criarAtributo(aba, 'x', 'um');
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ x: 'um' });
    await criarAtributo(aba, 'y', 'um');
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ x: 'um', y: 'um' });
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ x: 'um', y: 'um' });
    return { id, abaA: aba };
}

/** O fim comum aos dois casos: servidor, os dois clientes, a fila de B e o F5 de B. */
async function convergiu(collab, id, esperado) {
    const A = collab.author;
    const B = collab.peers[0];
    await expect.poll(() => atributosNoServidor(collab, id), {
        timeout: 60000, message: 'o servidor não guardou as duas mudanças',
    }).toEqual(esperado);
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000, message: 'B não convergiu' }).toEqual(esperado);
    await expect.poll(() => atributosNaStore(A, id), { timeout: 30000, message: 'A não convergiu' }).toEqual(esperado);
    expect(await problemasNaFila(B), 'a edição de B virou problema na fila').toBe(0);
    await B.reload();
    await expect(B.locator('#initial-loader')).toHaveCount(0, { timeout: 60000 });
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000, message: 'o F5 de B perdeu a fusão' }).toEqual(esperado);
}

collabTest('A exclui "x" enquanto B, sem rede, muda "y": as duas mudanças ficam', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const { id, abaA } = await pontoComDoisAtributos(collab);

    const devolverRede = await semRede(B);
    const abaB = await abrirAbaAtributos(B, id);
    await mudarValor(B, abaB, 'y', 'dois');
    await expect.poll(() => atributosNaStore(B, id)).toEqual({ x: 'um', y: 'dois' });

    await abaA.locator('.feature-attribute-row', { hasText: 'x' }).locator('.feature-attribute-delete').click();
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ y: 'um' });
    await A.keyboard.press('Escape');

    devolverRede();
    await convergiu(collab, id, { y: 'dois' });
});

collabTest('A muda "x" enquanto B, sem rede, muda "y": as duas mudanças ficam', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const { id, abaA } = await pontoComDoisAtributos(collab);

    const devolverRede = await semRede(B);
    const abaB = await abrirAbaAtributos(B, id);
    await mudarValor(B, abaB, 'y', 'B');
    await expect.poll(() => atributosNaStore(B, id)).toEqual({ x: 'um', y: 'B' });

    await mudarValor(A, abaA, 'x', 'A');
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ x: 'A', y: 'um' });
    await A.keyboard.press('Escape');

    devolverRede();
    await convergiu(collab, id, { x: 'A', y: 'B' });
});

/** Abre a tabela de atributos da primeira camada pela aba Camadas. */
async function abrirTabela(page) {
    // O painel de feição e a barra lateral não ficam abertos juntos: fecha a seleção primeiro, e só
    // clica na aba Camadas se ela não estiver à vista (o clique na aba aberta a FECHA).
    await page.keyboard.press('Escape');
    const botao = page.locator('.table-toggle').first();
    if (!(await botao.isVisible())) await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await expect(botao).toBeVisible({ timeout: 10000 });
    await botao.click();
    await expect(page.locator('.attribute-table-panel')).toBeVisible({ timeout: 20000 });
}

collabTest('pela TABELA: A remove a coluna "x" enquanto B, sem rede, edita a célula "y"', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const { id } = await pontoComDoisAtributos(collab);
    await A.keyboard.press('Escape');

    const devolverRede = await semRede(B);
    await abrirTabela(B);
    const celulaY = B.locator('.attribute-table-panel tr.attribute-table-row td[data-attr-key="y"]').first();
    await celulaY.dblclick();
    await B.locator('.attribute-table-cell-input').fill('pela tabela');
    await B.locator('.attribute-table-cell-input').press('Enter');
    await expect.poll(() => atributosNaStore(B, id)).toEqual({ x: 'um', y: 'pela tabela' });

    await abrirTabela(A);
    await A.locator('.attribute-table-panel th[data-column-key="x"]').click({ button: 'right' });
    await A.locator('.attribute-table-column-menu-item.danger').click();
    await A.locator('.confirm-modal-btn-confirm').click();
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ y: 'um' });

    devolverRede();
    await convergiu(collab, id, { y: 'pela tabela' });
});
