// Path: e2e-ui/tabela-de-atributos-somente-leitura.repro.spec.js

/**
 * @fileoverview QUEM NÃO PODE EDITAR TAMBÉM LÊ A TABELA DE ATRIBUTOS (decisão do coordenador da caça,
 * 2026-09-24, sobre o achado da campanha de cobertura).
 *
 * O DEFEITO, medido em 2026-09-24. O botão da tabela mora na linha da camada, e a regra de CSS que
 * esconde os comandos de edição da aba de camadas no mapa travado (`.map-locked`) o levava junto. A
 * classe é posta por `semEdicaoSync()`, que responde pelos DOIS eixos, então o Leitor, o
 * Comentarista e quem abria um mapa travado não tinham tabela nenhuma: ver os atributos de 300
 * feições exigia abrir o painel de uma por uma. E a tabela JÁ tinha um modo de leitura (a célula não
 * abre edição), que ninguém sem edição alcançava. Com a tabela aberta, a trava que chegava deixava
 * três coisas vivas: a célula em edição continuava aberta e, confirmada, mostrava um valor que nada
 * gravou; "Adicionar atributo" continuava desenhado e o clique não fazia nada; e o menu "Remover
 * atributo" abria, pedia confirmação e não removia nada, tudo em silêncio.
 *
 * O QUE PASSA A VALER. Ver a tabela não é comando de escrita, então o botão fica para todos. Os
 * comandos de ESCRITA dentro dela somem pelo posto e pelo estado (a mesma decisão da aba de camadas,
 * 2026-09-16): sem "Adicionar atributo", sem o menu de "Remover atributo" e sem edição de célula. O
 * CSV fica, porque exportar não escreve no atlas. A trava que chega com a tabela aberta fecha a
 * célula em edição sem gravar e DIZ isso, e a que sai devolve os comandos.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

/** Cria um atributo pela aba da feição. */
async function criarAtributo(page, id, chave, valor) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    const aba = painel.locator('.feature-tab-content[data-tab-id="atributos"]');
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0, { timeout: 10000 });
    await page.keyboard.press('Escape');
}

/** Os atributos da feição na store da página. */
function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? null;
    }, id);
}

/** Abre a tabela da primeira camada pela aba de camadas. */
async function abrirTabela(page) {
    const botao = page.locator('.table-toggle').first();
    // O botão da aba ALTERNA a barra lateral: clicá-lo com a aba já aberta a fecha (e a asserção
    // de visível passava durante a animação de fechar, deixando o clique esperando para sempre).
    if (!(await botao.isVisible())) await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    await expect(botao, 'o botão da tabela de atributos sumiu').toBeVisible({ timeout: 15000 });
    await botao.click();
    const painel = page.locator('.attribute-table-panel');
    await expect(painel.locator('tr.attribute-table-row')).toHaveCount(1, { timeout: 15000 });
    return painel;
}

/** A tabela está só de leitura: sem os comandos de escrita, com o CSV. */
async function esperarSomenteLeitura(page, painel) {
    await expect(painel.locator('.attribute-table-add-column-btn'), '"Adicionar atributo" desenhado sem edição')
        .toBeHidden();
    await expect(painel.locator('.attribute-table-csv-export-btn'), 'o CSV sumiu junto').toBeVisible();

    const celula = painel.locator('td[data-attr-key="cota"]');
    await celula.dblclick();
    await expect(painel.locator('.attribute-table-cell-input'), 'a célula abriu edição sem edição').toHaveCount(0);

    await painel.locator('th[data-column-key="cota"]').click({ button: 'right' });
    await expect(page.locator('.attribute-table-column-menu'), 'o menu "Remover atributo" abriu sem edição')
        .toHaveCount(0);

    const download = page.waitForEvent('download', { timeout: 15000 });
    await painel.locator('.attribute-table-csv-export-btn').click();
    const csv = (await import('node:fs')).readFileSync(await (await download).path(), 'utf8');
    expect(csv, 'o CSV não trouxe o atributo').toContain('cota');
}

for (const [permission, papel] of [['read', 'Leitor'], ['comment', 'Comentarista']]) {
    collabTest.describe(`o ${papel}`, () => {
        collabTest.use({ collabOptions: { peers: 1, permission, mapName: 'Mapa Tático' } });

        collabTest(`abre a tabela de atributos só de leitura, com o CSV (${papel})`, async ({ collab }) => {
            collabTest.setTimeout(180000);
            const A = collab.author;
            const B = collab.peers[0];

            const id = await drawPointUI(A, [-43.2, -22.9]);
            await A.keyboard.press('Escape');
            await criarAtributo(A, id, 'cota', '10');
            await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });

            const painel = await abrirTabela(B);
            await expect(painel.locator('td[data-attr-key="cota"]')).toContainText('10');
            await esperarSomenteLeitura(B, painel);
        });
    });
}

collabTest('a trava que chega com a tabela aberta fecha a célula sem gravar, avisa, e a que sai devolve a edição', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.21, -22.91]);
    await A.keyboard.press('Escape');
    await criarAtributo(A, id, 'cota', '10');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });

    // B, Editor, abre a tabela e começa a editar uma célula.
    const painel = await abrirTabela(B);
    await expect(painel.locator('.attribute-table-add-column-btn')).toBeVisible();
    await painel.locator('td[data-attr-key="cota"]').dblclick();
    const campo = painel.locator('.attribute-table-cell-input');
    await expect(campo).toBeVisible();
    await campo.fill('99');

    // O dono trava o mapa pelo controlador, como o cadeado faz.
    await A.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        await mapLockController.toggleMapLock();
    });
    await expect.poll(() => B.evaluate(async () => (await import('/src/js/store/index.js')).isCurrentMapLockedSync()),
        { timeout: 30000, message: 'a trava não chegou ao Editor' }).toBe(true);

    // A célula fecha sem gravar, e o motivo é dito.
    await expect(campo, 'a célula continuou aberta com o mapa travado').toHaveCount(0, { timeout: 10000 });
    await expect(painel.locator('td[data-attr-key="cota"]')).toContainText('10');
    await expect(B.locator('.toast', { hasText: 'Mapa bloqueado' }), 'a célula descartada não foi avisada')
        .toBeVisible({ timeout: 10000 });
    await esperarSomenteLeitura(B, painel);
    expect(await atributosNaStore(B, id), 'o valor da célula fechada foi gravado').toEqual({ cota: '10' });
    expect((await collab.db.queryFeatureRow(id))?.properties?.attributes).toEqual({ cota: '10' });

    // A tabela continua alcançável no mapa travado: fechar e reabrir.
    await painel.locator('.attribute-table-close-btn').click();
    await expect(painel).toHaveCount(0);
    const reaberta = await abrirTabela(B);

    // Destravar devolve a edição.
    await A.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        await mapLockController.toggleMapLock();
    });
    await expect.poll(() => B.evaluate(async () => (await import('/src/js/store/index.js')).isCurrentMapLockedSync()),
        { timeout: 30000 }).toBe(false);
    await expect(reaberta.locator('.attribute-table-add-column-btn'), 'destravar não devolveu "Adicionar atributo"')
        .toBeVisible({ timeout: 10000 });
    await reaberta.locator('td[data-attr-key="cota"]').dblclick();
    await expect(reaberta.locator('.attribute-table-cell-input')).toBeVisible();
    await reaberta.locator('.attribute-table-cell-input').fill('11');
    await reaberta.locator('.attribute-table-cell-input').press('Enter');
    await expect.poll(() => collab.db.queryFeatureRow(id).then((r) => r?.properties?.attributes), { timeout: 30000 })
        .toEqual({ cota: '11' });
});
