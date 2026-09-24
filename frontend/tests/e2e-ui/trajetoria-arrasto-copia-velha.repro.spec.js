// Path: e2e-ui/trajetoria-arrasto-copia-velha.repro.spec.js

/**
 * @fileoverview ARRASTAR uma feição selecionada desde ANTES da edição do colega não devolve o que o
 * colega mudou. Achado da campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * O arrasto grava a feição INTEIRA, e grava a partir da cópia que a seleção tirou ao selecionar,
 * que a op do par não alcança. Dois caminhos, a mesma causa:
 *  - arrastar o SÍMBOLO (`tool_manager/move_handler.js` → `updateFeatureForMove` →
 *    `reanchorOnMove`, que traduz a rota DA CÓPIA): o ponto-chave que o colega removeu voltava,
 *    e o nome que ele trocou também;
 *  - arrastar a ALÇA DA ÂNCORA da rota (o ramo de âncora de `_persist`,
 *    `temporal/trajectory-tool/trajectory-edit-control.js`, que gravava pelo controle dono o objeto
 *    do editor inteiro): o ponto-chave removido voltava.
 * A op saía com a base já atualizada, então o servidor aceitava e o colega recebia a volta. É a
 * mesma classe de 9ada8c04 e efe9da35 (o editor e o painel da rota), nos dois caminhos que tinham
 * ficado de fora.
 *
 * SEMEADURA sem interface: a rota de três pontos é gravada pela store no autor, e a troca de nome
 * do colega também (o sujeito é o arrasto de A). A remoção do ponto-chave pelo colega é pela
 * interface real, e os dois arrastos também.
 */

import { collabTest, expect, drawMilitarySymbolUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const DESVIOS_FORA_DA_ALCA = [[-14, 14], [-18, 18], [-22, 12], [-12, 22], [-24, 20], [-20, 26]];

const doStore = (page, id) => page.evaluate(async (fid) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid);
    return f ? JSON.parse(JSON.stringify({ geometry: f.geometry, nome: f.properties.nome, trajetoria: f.properties.trajetoria ?? null })) : null;
}, id);
const doServidor = async (collab, id) => {
    const row = await collab.db.queryFeatureRow(id);
    return row ? { nome: row.properties?.nome, trajetoria: row.properties?.trajetoria ?? null } : null;
};

async function criarSimbolo(collab) {
    const A = collab.author;
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    const casa = (await doStore(A, id)).geometry.coordinates;
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.deleted_at === null, { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await doStore(collab.peers[0], id)) !== null, { timeout: 30000 }).toBe(true);
    await A.evaluate((c) => globalThis.__ebgeoMap.jumpTo({ center: c, zoom: 13 }), casa);
    return { id, casa };
}

/** Três pontos-chave, A seleciona, e SÓ ENTÃO o colega remove o terceiro pelo painel dele. */
async function rotaComRemocaoDoColega(collab) {
    const A = collab.author;
    const B = collab.peers[0];
    const { id, casa } = await criarSimbolo(collab);
    const t0 = Date.UTC(2026, 0, 1, 12);
    const rota = [
        { t: t0, lng: casa[0], lat: casa[1] },
        { t: t0 + 3600000, lng: casa[0] + 0.02, lat: casa[1] + 0.02 },
        { t: t0 + 7200000, lng: casa[0] + 0.04, lat: casa[1] + 0.01 },
    ];
    await A.evaluate(async ({ fid, t }) => {
        const s = await import('/src/js/store/index.js');
        await s.updateFeatureProperty('military_symbols', fid, 'trajetoria', t);
    }, { fid: id, t: rota });
    await expect.poll(async () => (await doServidor(collab, id))?.trajetoria?.length ?? 0, { timeout: 30000 }).toBe(3);
    await expect.poll(async () => (await doStore(B, id))?.trajetoria?.length ?? 0, { timeout: 30000 }).toBe(3);

    await selectFeatureUI(A, id);
    await expect(A.locator('.feature-panel[data-expanded="true"] .temporal-trajectory-row')).toHaveCount(3, { timeout: 10000 });

    await selectFeatureUI(B, id);
    const linhas = B.locator('.feature-panel[data-expanded="true"] .temporal-trajectory-row');
    await expect(linhas.nth(2)).toBeVisible({ timeout: 10000 });
    await linhas.nth(2).locator('.temporal-trajectory-row__delete').click();
    await expect.poll(async () => (await doServidor(collab, id))?.trajetoria?.length ?? 0, { timeout: 30000 }).toBe(2);
    await expect.poll(async () => (await doStore(A, id))?.trajetoria?.length ?? 0, {
        timeout: 30000, message: 'a remocao de B nao chegou ao store de A',
    }).toBe(2);
    return { id, casa, rota };
}

/** O primeiro ponto da lista que cai sobre o símbolo e fora de toda alça da rota. */
const pontoDeDescida = (page, casa, desvios) => page.evaluate(([c, ds]) => {
    const map = globalThis.__ebgeoMap;
    const r = map.getCanvas().getBoundingClientRect();
    const p = map.project(c);
    const conta = (a, ids) => map.queryRenderedFeatures(
        [[a.x - 6, a.y - 6], [a.x + 6, a.y + 6]], { layers: ids.filter((l) => map.getLayer(l)) }).length;
    let achado = null;
    for (const [dx, dy] of ds) {
        const a = { x: p.x + dx, y: p.y + dy };
        achado = {
            x: Math.round(r.left + a.x), y: Math.round(r.top + a.y),
            simbolo: conta(a, ['military-symbols-layer']),
            alcas: conta(a, ['trajectory-edit-vertex-layer', 'trajectory-edit-vertex-label-layer', 'trajectory-edit-midpoint-layer']),
        };
        if (ds.length === 1 || (achado.simbolo > 0 && achado.alcas === 0)) break;
    }
    return achado;
}, [casa, desvios]);

async function arrastar(page, de) {
    await page.mouse.move(de.x, de.y);
    await page.mouse.down();
    await page.mouse.move(de.x - 30, de.y + 30, { steps: 6 });
    await page.mouse.move(de.x - 60, de.y + 60, { steps: 6 });
    await page.mouse.up();
}

/** O autor, o servidor e o colega convergem para o MESMO valor, e ele é o do autor. */
async function convergem(collab, id) {
    const A = collab.author;
    const B = collab.peers[0];
    const autor = await doStore(A, id);
    await expect.poll(() => doServidor(collab, id), { timeout: 30000 }).toEqual({ nome: autor.nome, trajetoria: autor.trajetoria });
    await expect.poll(async () => {
        const b = await doStore(B, id);
        return b ? { nome: b.nome, trajetoria: b.trajetoria } : null;
    }, { timeout: 30000 }).toEqual({ nome: autor.nome, trajetoria: autor.trajetoria });
    return autor;
}

collabTest('arrastar o SÍMBOLO depois de o colega remover um ponto-chave leva a rota dele, sem o ponto', async ({ collab }) => {
    collabTest.setTimeout(400000);
    const A = collab.author;
    const { id, casa, rota } = await rotaComRemocaoDoColega(collab);
    const de = await pontoDeDescida(A, casa, DESVIOS_FORA_DA_ALCA);
    expect(de.simbolo, 'a descida nao esta sobre o simbolo').toBeGreaterThan(0);
    expect(de.alcas, 'a descida caiu numa alca da rota').toBe(0);
    await arrastar(A, de);
    await expect.poll(async () => (await doStore(A, id))?.trajetoria?.[0]?.lng, { timeout: 15000, message: 'o arrasto nao moveu' }).not.toBe(casa[0]);

    const depois = await convergem(collab, id);
    expect(depois.trajetoria.map((k) => k.t), 'o arrasto devolveu o ponto que o colega removeu').toEqual([rota[0].t, rota[1].t]);
    // A rota que ficou andou INTEIRA o mesmo deslocamento, e a âncora é a casa nova.
    const dLng = depois.trajetoria[0].lng - rota[0].lng;
    const dLat = depois.trajetoria[0].lat - rota[0].lat;
    expect(depois.trajetoria[1].lng - rota[1].lng).toBeCloseTo(dLng, 9);
    expect(depois.trajetoria[1].lat - rota[1].lat).toBeCloseTo(dLat, 9);
    expect(depois.geometry.coordinates).toEqual([depois.trajetoria[0].lng, depois.trajetoria[0].lat]);
});

collabTest('arrastar a ALÇA DA ÂNCORA depois de o colega remover um ponto-chave move só a partida, sem o ponto', async ({ collab }) => {
    collabTest.setTimeout(400000);
    const A = collab.author;
    const { id, casa, rota } = await rotaComRemocaoDoColega(collab);
    const de = await pontoDeDescida(A, casa, [[0, 0]]);
    expect(de.alcas, 'o centro do simbolo deveria ser a alca da ancora').toBeGreaterThan(0);
    await arrastar(A, de);
    await expect.poll(async () => (await doStore(A, id))?.trajetoria?.[0]?.lng, { timeout: 15000, message: 'o arrasto nao moveu' }).not.toBe(casa[0]);

    const depois = await convergem(collab, id);
    expect(depois.trajetoria.map((k) => k.t), 'o arrasto da ancora devolveu o ponto que o colega removeu').toEqual([rota[0].t, rota[1].t]);
    // Só a partida andou: o segundo ponto-chave ficou onde estava, e a feição acompanha a âncora.
    expect(depois.trajetoria[1]).toEqual(rota[1]);
    expect(depois.geometry.coordinates).toEqual([depois.trajetoria[0].lng, depois.trajetoria[0].lat]);
});

collabTest('arrastar depois de o colega renomear não devolve o nome antigo', async ({ collab }) => {
    collabTest.setTimeout(400000);
    const A = collab.author;
    const B = collab.peers[0];
    const { id, casa } = await criarSimbolo(collab);
    await selectFeatureUI(A, id);
    await B.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        await s.updateFeatureProperty('military_symbols', fid, 'nome', 'Nome do colega');
    }, id);
    await expect.poll(async () => (await doServidor(collab, id))?.nome, { timeout: 30000 }).toBe('Nome do colega');
    await expect.poll(async () => (await doStore(A, id))?.nome, { timeout: 30000, message: 'o nome de B nao chegou ao store de A' }).toBe('Nome do colega');

    const de = await pontoDeDescida(A, casa, [[0, 0]]);
    expect(de.simbolo, 'a descida nao esta sobre o simbolo').toBeGreaterThan(0);
    await arrastar(A, de);
    await expect.poll(async () => (await doStore(A, id))?.geometry?.coordinates?.[0], { timeout: 15000, message: 'o arrasto nao moveu' }).not.toBe(casa[0]);

    const depois = await convergem(collab, id);
    expect(depois.nome, 'o arrasto devolveu o nome antigo').toBe('Nome do colega');
});
