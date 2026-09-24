// Path: e2e-ui/cobertura-desenho-ciclo.spec.js

/**
 * @fileoverview COBERTURA: o ciclo de vida de cada ferramenta de desenho entre dois usuários num
 * atlas de servidor (campanha de 2026-09-24).
 *
 * Para cada ferramenta de `FERRAMENTAS` (`helpers/cobertura-desenho.js`), A faz pela interface real,
 * e depois de CADA passo o Postgres e o store de B têm de concordar com o store de A:
 *
 *   1. desenhar (a ferramenta real);
 *   2. nome (campo do cabeçalho, Enter) e descrição (seção do painel, "Salvar");
 *   3. atributo customizado (aba Atributos, "+");
 *   4. mover (arrastar a feição selecionada pelo corpo);
 *   5. copiar e colar (Ctrl+C, Ctrl+V): uma cópia nova;
 *   6. excluir a cópia (Delete e confirmação);
 *   7. desfazer (a cópia volta) e refazer (a cópia sai de novo), pelos botões da barra;
 *   8. F5 nos dois: A, B e o servidor iguais, campo a campo e na geometria, em todo o balde.
 *
 * O mesmo ciclo num atlas LOCAL está em `cobertura-desenho-local.spec.js`.
 */

import { collabTest, expect, selectFeatureUI, deleteFeatureUI } from './helpers/collab.fixtures.js';
import { FERRAMENTAS, desenhar, feicaoNoStore, idsDoBalde, semEscrituracao } from './helpers/cobertura-desenho.js';
import {
    nomear, descrever, atribuir, moverPeloCorpo, copiarEColar, desfazer, refazer,
} from './helpers/cobertura-desenho-ciclo.js';

collabTest.describe.configure({ retries: 0 });

async function linha(collab, id) {
    const row = await collab.db.queryFeatureRow(id);
    return row && !row.deleted_at ? { properties: row.properties, geometry: row.geometry } : null;
}

async function baldeNoServidor(collab, tipo) {
    const rows = await collab.db.raw.any(
        'SELECT id, properties, geometry FROM features WHERE map_id = $1 AND deleted_at IS NULL AND feature_type = $2',
        [collab.mapId, tipo],
    );
    return Object.fromEntries(rows.map((r) => [r.id, { properties: semEscrituracao(r.properties), geometry: r.geometry }]));
}

async function baldeNoCliente(page, balde) {
    const lista = await page.evaluate(async (b) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return JSON.parse(JSON.stringify((f[b] ?? []).map((x) => ({ id: x.properties.id, properties: x.properties, geometry: x.geometry }))));
    }, balde);
    return Object.fromEntries(lista.map((x) => [x.id, { properties: semEscrituracao(x.properties), geometry: x.geometry }]));
}

/** O servidor e B concordam com A sobre uma feição, no recorte de chaves dado (ou em tudo). */
async function convergem(collab, A, B, balde, id, passo, chaves = null) {
    const recorte = (f) => {
        if (!f) return null;
        const props = semEscrituracao(f.properties);
        return chaves ? Object.fromEntries(chaves.map((k) => [k, props[k] ?? null])) : { properties: props, geometry: f.geometry };
    };
    const esperado = recorte(await feicaoNoStore(A, balde, id));
    await expect.poll(async () => recorte(await linha(collab, id)), { timeout: 30000, message: `${passo}: o servidor diverge de A` })
        .toEqual(esperado);
    await expect.poll(async () => recorte(await feicaoNoStore(B, balde, id)), { timeout: 30000, message: `${passo}: B diverge de A` })
        .toEqual(esperado);
}

/** A feição sumiu do servidor e de B. */
async function sumiu(collab, B, balde, id, passo) {
    await expect.poll(async () => await linha(collab, id), { timeout: 30000, message: `${passo}: o servidor ainda tem ${id}` }).toBeNull();
    await expect.poll(async () => (await idsDoBalde(B, balde)).includes(id), { timeout: 30000, message: `${passo}: B ainda tem ${id}` }).toBe(false);
}

for (const ferramenta of FERRAMENTAS) {
    collabTest(`ciclo de ${ferramenta.id}: nome, descricao, atributo, mover, colar, excluir, desfazer, refazer e F5 com o par`, async ({ collab }) => {
        collabTest.setTimeout(420000);
        const A = collab.author;
        const B = collab.peers[0];
        const { balde } = ferramenta;
        const passo = (n) => `${ferramenta.id} / ${n}`;

        const id = await desenhar(A, ferramenta);
        await convergem(collab, A, B, balde, id, passo('desenhar'));

        await selectFeatureUI(A, id);
        await nomear(A, balde, id, `Nome ${ferramenta.id}`);
        await descrever(A, balde, id, `Descricao de ${ferramenta.id}`);
        await convergem(collab, A, B, balde, id, passo('nome e descricao'), ['nome', 'descricao']);

        await atribuir(A, balde, id, 'cota', '42');
        await convergem(collab, A, B, balde, id, passo('atributo'), ['attributes']);

        await A.keyboard.press('Escape');
        await selectFeatureUI(A, id);
        await moverPeloCorpo(A, balde, id);
        await convergem(collab, A, B, balde, id, passo('mover'));

        await selectFeatureUI(A, id);
        const copia = await copiarEColar(A, balde, id);
        await convergem(collab, A, B, balde, copia, passo('colar'));

        // Colar SELECIONA a cópia e abre o painel dela, que esconde a árvore de camadas por onde
        // `deleteFeatureUI` seleciona: o Escape fecha o painel e devolve a árvore.
        await A.keyboard.press('Escape');
        await deleteFeatureUI(A, copia);
        await expect.poll(async () => (await idsDoBalde(A, balde)).includes(copia), { timeout: 15000 }).toBe(false);
        await sumiu(collab, B, balde, copia, passo('excluir'));

        await A.keyboard.press('Escape');
        await desfazer(A);
        await expect.poll(async () => (await idsDoBalde(A, balde)).includes(copia), { timeout: 15000, message: `${passo('desfazer')}: a copia nao voltou em A` }).toBe(true);
        await convergem(collab, A, B, balde, copia, passo('desfazer'));
        await refazer(A);
        await expect.poll(async () => (await idsDoBalde(A, balde)).includes(copia), { timeout: 15000, message: `${passo('refazer')}: a copia nao saiu de novo em A` }).toBe(false);
        await sumiu(collab, B, balde, copia, passo('refazer'));

        await A.reload();
        await B.reload();
        const servidor = await baldeNoServidor(collab, ferramenta.tipo);
        expect(Object.keys(servidor), `${passo('F5')}: o servidor tem so a feicao original`).toEqual([id]);
        for (const [quem, page] of [['A', A], ['B', B]]) {
            await expect.poll(() => baldeNoCliente(page, balde), { timeout: 30000, message: `${passo('F5')}: ${quem} diverge do servidor` })
                .toEqual(servidor);
        }
    });
}
