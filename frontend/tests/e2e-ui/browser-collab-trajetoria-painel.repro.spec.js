// Path: e2e-ui/browser-collab-trajetoria-painel.repro.spec.js

/**
 * @fileoverview REMOVER UM PONTO DA TRAJETÓRIA pelo painel não desfaz o ponto que o colega removeu
 * enquanto o painel estava aberto.
 *
 * A HIPÓTESE (2026-09-24). A seção de trajetória do painel (`createTrajectorySection`,
 * `temporal/temporal-attributes-section.js`) edita EM LUGAR o array `trajetoria` da feição que o
 * painel recebeu ao abrir, e grava o array inteiro (`persist` -> `updateFeatureProperty`). O painel
 * não é redesenhado por uma op remota, então o array é o de antes da edição do colega: remover um
 * ponto aqui devolve o ponto que o colega tinha removido, com a base já atualizada, e o servidor
 * aceita.
 *
 * SEMEADURA sem interface: a trajetória inicial de três pontos é gravada pela store no autor, porque
 * criá-la pelo editor do mapa é outro gesto (arrastar pontos médios) e não é o sujeito aqui. Os dois
 * gestos medidos (as duas remoções) são pela interface real.
 */

import { collabTest, expect, drawPointUI, selectFeatureUI } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

const P = [-43.2, -22.9];

async function trajetoriaNoStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.trajetoria ?? null;
    }, id);
}

async function trajetoriaNoServidor(collab, id) {
    return (await collab.db.queryFeatureRow(id))?.properties?.trajetoria ?? null;
}

async function removerPonto(page, indice) {
    const linhas = page.locator('.feature-panel[data-expanded="true"] .temporal-trajectory-row');
    await expect(linhas.nth(indice)).toBeVisible({ timeout: 10000 });
    await linhas.nth(indice).locator('.temporal-trajectory-row__delete').click();
}

collabTest('remover um ponto da trajetoria com o painel aberto nao devolve o ponto que o colega removeu', async ({ collab }) => {
    collabTest.setTimeout(150000);
    const A = collab.author;
    const B = collab.peers[0];

    const id = await drawPointUI(A, P);
    await A.keyboard.press('Escape');

    // Semeadura: três pontos-chave, o primeiro na posição da feição (a âncora).
    const t0 = Date.UTC(2026, 0, 1, 12);
    const trajetoria = [
        { t: t0, lng: P[0], lat: P[1] },
        { t: t0 + 3600000, lng: -43.18, lat: -22.88 },
        { t: t0 + 7200000, lng: -43.16, lat: -22.86 },
    ];
    await A.evaluate(async ({ fid, traj }) => {
        const s = await import('/src/js/store/index.js');
        await s.updateFeatureProperty('points', fid, 'trajetoria', traj);
    }, { fid: id, traj: trajetoria });
    await expect.poll(async () => (await trajetoriaNoServidor(collab, id))?.length ?? 0, { timeout: 30000 }).toBe(3);
    await expect.poll(async () => (await trajetoriaNoStore(B, id))?.length ?? 0, { timeout: 30000 }).toBe(3);

    // A abre o painel: a seção de trajetória desenha os três pontos.
    await selectFeatureUI(A, id);
    await expect(A.locator('.feature-panel[data-expanded="true"] .temporal-trajectory-row')).toHaveCount(3, { timeout: 10000 });

    // B remove o TERCEIRO ponto pelo painel dele.
    await selectFeatureUI(B, id);
    await removerPonto(B, 2);
    await expect.poll(async () => (await trajetoriaNoServidor(collab, id))?.length ?? 0, { timeout: 30000 }).toBe(2);
    await expect.poll(async () => (await trajetoriaNoStore(A, id))?.length ?? 0, {
        timeout: 30000, message: 'a remocao de B nao chegou ao store de A',
    }).toBe(2);

    // A, com o painel aberto desde antes, remove o SEGUNDO ponto.
    await removerPonto(A, 1);

    await expect.poll(async () => (await trajetoriaNoServidor(collab, id))?.map((k) => k.t) ?? null, {
        timeout: 30000, message: 'o servidor nao ficou so com a ancora',
    }).toEqual([t0]);
    await expect.poll(async () => (await trajetoriaNoStore(B, id))?.length ?? 0, { timeout: 15000 }).toBe(1);
});
