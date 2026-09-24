// Path: e2e-ui/cobertura-atributos-colaboracao.spec.js

/**
 * @fileoverview COBERTURA DOS ATRIBUTOS CUSTOMIZADOS ENTRE DOIS USUÁRIOS, num atlas de servidor.
 *
 * O que já existia (`browser-collab-renomear-atributo.repro`, `browser-collab-atributo-recusado.repro`)
 * mede criar, editar e renomear UMA chave. Este arquivo cobre:
 *
 *   1. OS TIPOS DE VALOR que a aba aceita (todo valor é texto, `setAttribute` faz `String(value)`):
 *      texto com espaço, número, vazio, acentos, texto longo e valor que PARECE número ("007" não
 *      pode virar 7). Cada um é conferido no Postgres, na store do colega, na aba do colega e depois
 *      de um F5 do colega.
 *   2. EXCLUIR um atributo pela lixeira chega ao servidor e ao colega.
 *   3. EDIÇÕES CRUZADAS na mesma feição: A exclui uma chave enquanto B, com o envio represado, muda
 *      o valor de OUTRA chave. As duas intenções têm de sobreviver (a disputa é por chave desde
 *      2026-09-24); e a MESMA chave pelos dois lados continua disputa guardada para revisão.
 *
 * A LEITURA É DO SERVIDOR E DA STORE; a aba do colega entra só onde ela é o sujeito (ela redesenha
 * a partir da store ao abrir).
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

/** Os atributos da feição no Postgres. */
async function atributosNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.attributes ?? null;
}

/** Os atributos da feição na store de uma página. */
function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? null;
    }, id);
}

/** Seleciona a feição e abre a aba Atributos. */
async function abrirAbaAtributos(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

/** Cria um atributo pelo formulário da aba. */
async function criarAtributo(aba, chave, valor) {
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0, { timeout: 10000 });
}

const LONGO = `Observação longa: ${'relevo acidentado, curso d\'água e mata ciliar; '.repeat(40)}fim.`;
const TIPOS = Object.freeze({
    texto: 'Posto de observação avançado',
    numero: '42',
    vazio: '',
    acento: 'Ação, coração, Ñandú, çãõ',
    longo: LONGO,
    parece_numero: '007',
    decimal: '1,5',
});

collabTest('os tipos de valor chegam ao servidor e ao colega como texto exato, e sobrevivem ao F5 do colega', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAbaAtributos(A, id);
    for (const [chave, valor] of Object.entries(TIPOS)) await criarAtributo(abaA, chave, valor);

    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual(TIPOS);
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual(TIPOS);

    // A aba do colega mostra cada valor; o vazio aparece como "—".
    const abaB = await abrirAbaAtributos(B, id);
    for (const [chave, valor] of Object.entries(TIPOS)) {
        const linha = abaB.locator('.feature-attribute-row').filter({
            has: B.locator('.feature-attribute-key', { hasText: new RegExp(`^${chave}$`) }),
        });
        await expect(linha.locator('.feature-attribute-value')).toHaveText(valor === '' ? '—' : valor);
    }

    await B.reload();
    await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual(TIPOS);
});

collabTest('excluir pela lixeira chega ao servidor e ao colega', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.21, -22.91]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAbaAtributos(A, id);
    await criarAtributo(abaA, 'cota', '10');
    await criarAtributo(abaA, 'setor', '1');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10', setor: '1' });

    await abaA.locator('.feature-attribute-row', { hasText: 'setor' }).locator('.feature-attribute-delete').click();
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ cota: '10' });
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });
});

// OS ATRIBUTOS SÃO DISPUTADOS POR CHAVE (decisão do dono em 2026-09-24). Este caso afirmava o
// contrário até aquela data: `attributes` era UM campo da fronteira de disputa (`validPatchEntry`,
// `backend/src/modules/sync/feature-conflicts.js`, caminho de profundidade 2), e a edição de B, que
// chegava depois da exclusão de A, virava disputa guardada para revisão. Hoje a unidade é a chave:
// a exclusão de A e a edição de B são duas chaves diferentes, as duas valem no servidor e nos dois
// clientes, e a fila de B termina sem problema. A disputa continua existindo, só para a MESMA chave,
// e é o caso seguinte que a afirma.
collabTest('A exclui uma chave enquanto B, com o envio represado, muda OUTRA: as duas valem', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.22, -22.92]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAbaAtributos(A, id);
    await criarAtributo(abaA, 'cota', '10');
    await criarAtributo(abaA, 'setor', '1');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10', setor: '1' });

    // B edita "cota" com o envio represado: a op fica na fila dele.
    await B.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
        ? route.abort('connectionfailed') : route.continue()));
    const abaB = await abrirAbaAtributos(B, id);
    await abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value').click();
    const campo = abaB.locator('.feature-attribute-value-input');
    await campo.fill('20');
    await campo.press('Enter');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 10000 }).toEqual({ cota: '20', setor: '1' });

    // A exclui "setor", e isso chega ao servidor antes da edição de B.
    await abaA.locator('.feature-attribute-row', { hasText: 'setor' }).locator('.feature-attribute-delete').click();
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ cota: '10' });

    // B volta a enviar: a edição dele é de outra chave, e as duas mudanças se fundem.
    await B.unroute('**/atlas/*/sync');
    await expect.poll(() => atributosNoServidor(collab, id), {
        timeout: 40000, message: 'o servidor não guardou as duas mudanças',
    }).toEqual({ cota: '20' });
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '20' });
    await expect.poll(() => atributosNaStore(A, id), { timeout: 30000 }).toEqual({ cota: '20' });
    expect(await B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).problemas;
    }), 'a edição de B virou problema na fila').toBe(0);
});

// A MESMA chave pelos dois lados continua DISPUTA, como qualquer outra propriedade de feição: a
// edição que chega depois é guardada para revisão, não some e não apaga a que chegou antes.
collabTest('A e B mudam a MESMA chave: a de A vale e a de B fica para revisão', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, [-43.225, -22.925]);
    await A.keyboard.press('Escape');
    const abaA = await abrirAbaAtributos(A, id);
    await criarAtributo(abaA, 'cota', '10');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });

    await B.route('**/atlas/*/sync', (route) => (route.request().method() === 'POST'
        ? route.abort('connectionfailed') : route.continue()));
    const abaB = await abrirAbaAtributos(B, id);
    await abaB.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value').click();
    const campoB = abaB.locator('.feature-attribute-value-input');
    await campoB.fill('20');
    await campoB.press('Enter');
    await expect.poll(() => atributosNaStore(B, id), { timeout: 10000 }).toEqual({ cota: '20' });

    await abaA.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value').click();
    const campoA = abaA.locator('.feature-attribute-value-input');
    await campoA.fill('30');
    await campoA.press('Enter');
    await expect.poll(() => atributosNoServidor(collab, id), { timeout: 30000 }).toEqual({ cota: '30' });

    await B.unroute('**/atlas/*/sync');
    await expect.poll(() => B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return (await operationQueue.countByState()).problemas;
    }), { timeout: 40000, message: 'a edição de B sumiu em vez de ficar para revisão' }).toBeGreaterThan(0);
    await expect.poll(() => B.locator('[data-testid="sync-status-badge"]').getAttribute('data-work'), { timeout: 20000 })
        .toMatch(/^(recusa|conflito)$/);
    expect(await atributosNoServidor(collab, id), 'a edição de A foi desfeita').toEqual({ cota: '30' });
    await expect.poll(() => atributosNaStore(A, id), { timeout: 30000 }).toEqual({ cota: '30' });
});

collabTest.describe('o Leitor', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

    collabTest('vê os atributos do dono só para leitura, sem comando de criar, editar ou excluir', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];

        const id = await drawPointUI(A, [-43.23, -22.93]);
        await A.keyboard.press('Escape');
        const abaA = await abrirAbaAtributos(A, id);
        await criarAtributo(abaA, 'cota', '10');
        await expect.poll(() => atributosNaStore(B, id), { timeout: 30000 }).toEqual({ cota: '10' });

        await selectFeatureUI(B, id);
        const painel = B.locator('.feature-panel[data-expanded="true"]');
        await expect(painel).toContainText('cota');
        await expect(painel).toContainText('10');
        await expect(painel.locator('.feature-attributes-add-btn'), 'o Leitor recebe "Adicionar Atributo"').toHaveCount(0);
        await expect(painel.locator('.feature-attribute-delete'), 'o Leitor recebe a lixeira do atributo').toHaveCount(0);
        await expect(painel.locator('.feature-attribute-value-input')).toHaveCount(0);
        // O clique no valor não abre edição.
        const valor = painel.locator('.feature-attribute-value');
        if (await valor.count()) await valor.first().click();
        await expect(painel.locator('.feature-attribute-value-input')).toHaveCount(0);
    });
});
