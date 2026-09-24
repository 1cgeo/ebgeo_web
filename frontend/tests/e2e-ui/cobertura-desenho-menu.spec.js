// Path: e2e-ui/cobertura-desenho-menu.spec.js

/**
 * @fileoverview COBERTURA: copiar, "Colar Aqui" e "Duplicar Seleção" pelo MENU DE CONTEXTO, para cada
 * ferramenta de desenho, entre dois usuários num atlas de servidor, e depois do F5 nos dois (campanha
 * de 2026-09-24). O Ctrl+C / Ctrl+V do teclado está no spec de ciclo (`cobertura-desenho-ciclo.spec.js`).
 *
 * Para cada ferramenta, A desenha e, pelo botão direito:
 *
 *  1. sobre o corpo da feição, "Copiar Feição"; num ponto vazio do mapa, "Colar Aqui (1)": uma cópia
 *     nova, com outro id, perto do ponto clicado;
 *  2. com a original selecionada, sobre o corpo dela, "Duplicar Seleção": outra cópia nova.
 *
 * Depois de cada passo o servidor e o store de B têm a cópia igual à de A (propriedades e geometria),
 * e no F5 nos dois o balde inteiro de A, de B e do servidor é o mesmo (as três feições).
 */

import { collabTest, expect, selectFeatureUI } from './helpers/collab.fixtures.js';
import { FERRAMENTAS, desenhar, feicaoNoStore, idsDoBalde, semEscrituracao } from './helpers/cobertura-desenho.js';
import { pontoDePega, trazerParaAreaLivre } from './helpers/cobertura-desenho-ciclo.js';

collabTest.describe.configure({ retries: 0 });

async function linha(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row && !row.deleted_at ? { properties: semEscrituracao(row.properties), geometry: row.geometry } : null;
}

async function noCliente(page, balde, id) {
    const f = await feicaoNoStore(page, balde, id);
    return f ? { properties: semEscrituracao(f.properties), geometry: f.geometry } : null;
}

async function convergem(collab, A, B, balde, id, passo) {
    const esperado = await noCliente(A, balde, id);
    await expect.poll(() => linha(collab, id), { timeout: 30000, message: `${passo}: o servidor diverge de A` }).toEqual(esperado);
    await expect.poll(() => noCliente(B, balde, id), { timeout: 30000, message: `${passo}: B diverge de A` }).toEqual(esperado);
}

/** Botão direito num pixel de página e clique no item do menu de contexto que casa o texto. */
async function menuDeContexto(page, p, item) {
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    const alvo = menu.locator('.context-menu-item', { hasText: item });
    await expect(alvo, `o menu nao ofereceu ${item}`).toBeVisible({ timeout: 5000 });
    await alvo.click();
}

/** Espera uma feição nova no balde e devolve o id dela. */
async function novaNoBalde(page, balde, antes, passo) {
    let nova = null;
    await expect.poll(async () => {
        nova = (await idsDoBalde(page, balde)).find((x) => !antes.includes(x)) ?? null;
        return nova;
    }, { timeout: 15000, message: `${passo}: nenhuma feicao nova` }).toBeTruthy();
    return nova;
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`menu de ${ferramenta.id}: copiar, colar aqui e duplicar selecao chegam ao par e ao servidor, e sobrevivem ao F5`, async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const { balde } = ferramenta;
        const passo = (n) => `${ferramenta.id} / ${n}`;

        const id = await desenhar(A, ferramenta);
        await convergem(collab, A, B, balde, id, passo('desenhar'));

        // 1. Copiar Feição pelo corpo e Colar Aqui num ponto vazio.
        const corpo = await trazerParaAreaLivre(A, pontoDePega(await feicaoNoStore(A, balde, id)));
        await menuDeContexto(A, corpo, /^Copiar Feição$/);
        const vazio = { x: corpo.x + 180, y: corpo.y - 120 };
        const antesDeColar = await idsDoBalde(A, balde);
        await menuDeContexto(A, vazio, /^Colar Aqui \(1\)$/);
        const colada = await novaNoBalde(A, balde, antesDeColar, passo('colar aqui'));
        await convergem(collab, A, B, balde, colada, passo('colar aqui'));

        // 2. Duplicar Seleção com a original selecionada.
        await A.keyboard.press('Escape');
        await selectFeatureUI(A, id);
        const corpo2 = await trazerParaAreaLivre(A, pontoDePega(await feicaoNoStore(A, balde, id)));
        const antesDeDuplicar = await idsDoBalde(A, balde);
        await menuDeContexto(A, corpo2, /^Duplicar Seleção$/);
        const duplicada = await novaNoBalde(A, balde, antesDeDuplicar, passo('duplicar selecao'));
        await convergem(collab, A, B, balde, duplicada, passo('duplicar selecao'));

        // F5 nos dois: o balde inteiro igual ao do servidor.
        await A.reload();
        await B.reload();
        const ids = [id, colada, duplicada].sort();
        const servidor = Object.fromEntries(await Promise.all(ids.map(async (x) => [x, await linha(collab, x)])));
        for (const [quem, page] of [['A', A], ['B', B]]) {
            await expect.poll(async () => (await idsDoBalde(page, balde)).sort(), { timeout: 30000, message: passo(`F5: ${quem} nao tem as tres`) })
                .toEqual(ids);
            for (const x of ids) {
                expect(await noCliente(page, balde, x), passo(`F5: ${quem} diverge do servidor em ${x}`)).toEqual(servidor[x]);
            }
        }
    });
}
