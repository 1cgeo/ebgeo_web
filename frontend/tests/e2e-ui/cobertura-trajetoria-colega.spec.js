// Path: e2e-ui/cobertura-trajetoria-colega.spec.js

/**
 * @fileoverview COBERTURA da trajetória criada pelo EDITOR de verdade num atlas de servidor, com o
 * colega e com F5 nos dois. Campanha de cobertura de 2026-09-24 (`relatorios/cobertura-taticas.md`).
 *
 * Antes dela a trajetória só nascia pela interface num atlas local (`browser-temporal-advanced`
 * §29.15), as provas com colega partiam de trajetória semeada por `page.evaluate`, e nenhum spec
 * temporal recarregava a página. Aqui a trajetória de um símbolo militar nasce pelo "Adicionar no
 * mapa" (dois cliques e Concluir), chega igual ao Postgres e ao colega, e sobrevive ao F5 nos dois.
 */

import { collabTest, expect, selectFeatureUI, drawMilitarySymbolUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });

const trajetoria = (page, id) => page.evaluate(async (fid) => {
    const s = await import('/src/js/store/index.js');
    const f = ((await s.getCurrentMapFeatures()).military_symbols ?? []).find((x) => x.properties?.id === fid);
    return f?.properties?.trajetoria ? JSON.parse(JSON.stringify(f.properties.trajetoria)) : null;
}, id);

collabTest('trajetória pelo editor: chega ao colega e sobrevive ao F5 nos dois', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    expect(await trajetoria(A, id)).toBeNull();

    await selectFeatureUI(A, id);
    const painel = A.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.temporal-attr-btn--primary', { hasText: 'Adicionar no mapa' }).click();
    const barra = A.locator('.trajectory-edit-toolbar');
    await expect(barra).toBeVisible({ timeout: 10000 });
    const alvos = await A.evaluate(() => [[700, 260], [820, 380]].map(([x, y]) => {
        const p = globalThis.__ebgeoMap.unproject([x, y]);
        return [p.lng, p.lat];
    }));
    for (const alvo of alvos) {
        const clique = await clicarNoMapaUI(A, alvo);
        expect(clique.coberto, `o clique caiu sob ${clique.porQuem}`).toBe(false);
    }
    await barra.locator('.trajectory-edit-toolbar__done').click();
    await expect(barra).toHaveCount(0, { timeout: 10000 });

    await expect.poll(async () => (await trajetoria(A, id))?.length ?? 0, { timeout: 15000 }).toBe(3);
    const esperada = await trajetoria(A, id);
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.trajetoria ?? null, { timeout: 30000 }).toEqual(esperada);
    await expect.poll(() => trajetoria(B, id), { timeout: 30000 }).toEqual(esperada);

    for (const page of [A, B]) {
        await page.reload();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.getZoom, null, { timeout: 30000 });
        await expect.poll(() => trajetoria(page, id), { timeout: 30000, message: 'a trajetoria nao voltou do disco' }).toEqual(esperada);
    }
});

collabTest('arrastar o símbolo leva a rota inteira, e o colega recebe a rota deslocada', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const A = collab.author;
    const B = collab.peers[0];
    const id = await drawMilitarySymbolUI(A, [-43.2, -22.9]);
    await A.keyboard.press('Escape');
    await selectFeatureUI(A, id);
    await A.locator('.feature-panel[data-expanded="true"] .temporal-attr-btn--primary', { hasText: 'Adicionar no mapa' }).click();
    const barra = A.locator('.trajectory-edit-toolbar');
    await expect(barra).toBeVisible({ timeout: 10000 });
    const alvos = await A.evaluate(() => [[700, 260], [820, 380]].map(([x, y]) => {
        const p = globalThis.__ebgeoMap.unproject([x, y]);
        return [p.lng, p.lat];
    }));
    for (const alvo of alvos) await clicarNoMapaUI(A, alvo);
    await barra.locator('.trajectory-edit-toolbar__done').click();
    // O modo de acréscimo precisa ter SAÍDO: dentro dele a descida no mapa acrescenta ponto-chave.
    await expect(barra).toHaveCount(0, { timeout: 10000 });
    await expect.poll(async () => (await trajetoria(A, id))?.length ?? 0, { timeout: 15000 }).toBe(3);
    const antes = await trajetoria(A, id);

    // Arrasta o SÍMBOLO, e não a alça da âncora. Com a feição selecionada o editor desenha a rota e
    // uma alça por ponto-chave, e a alça 0 fica exatamente no centro do símbolo: descer ali é o
    // OUTRO gesto (mover só a partida, `trajectory-edit-control.js`). O ponto de descida sai do
    // centro, fica dentro do ícone e longe da rota, e o controle do instrumento abaixo confere que
    // ali há símbolo e não há alça.
    const de = await A.evaluate(([lng, lat]) => {
        const map = globalThis.__ebgeoMap;
        const r = map.getCanvas().getBoundingClientRect();
        const p = map.project([lng, lat]);
        const camadas = (ids) => ids.filter((l) => map.getLayer(l));
        const conta = (alvo, ids) => map.queryRenderedFeatures(
            [[alvo.x - 6, alvo.y - 6], [alvo.x + 6, alvo.y + 6]], { layers: camadas(ids) }).length;
        // Para baixo e para a esquerda, que é o lado oposto ao da rota desenhada acima.
        const candidatos = [[-14, 14], [-18, 18], [-22, 12], [-12, 22], [-24, 20], [-20, 26], [-28, 14], [-16, 30]];
        let achado = null;
        for (const [dx, dy] of candidatos) {
            const alvo = { x: p.x + dx, y: p.y + dy };
            const simbolo = conta(alvo, ['military-symbols-layer']);
            const alcas = conta(alvo, ['trajectory-edit-vertex-layer', 'trajectory-edit-vertex-label-layer', 'trajectory-edit-midpoint-layer']);
            achado = { x: Math.round(r.left + alvo.x), y: Math.round(r.top + alvo.y), simbolo, alcas, dx, dy };
            if (simbolo > 0 && alcas === 0) break;
        }
        return { ...achado, alcasDesenhadas: camadas(['trajectory-edit-vertex-layer']).length };
    }, [antes[0].lng, antes[0].lat]);
    expect(de.alcasDesenhadas, 'o editor nao desenhou as alcas: o controle abaixo nao mediria nada').toBe(1);
    expect(de.simbolo, 'o ponto de descida nao esta sobre o simbolo').toBeGreaterThan(0);
    expect(de.alcas, `o ponto de descida (${de.dx},${de.dy}) caiu numa alca da rota`).toBe(0);
    await A.mouse.move(de.x, de.y);
    await A.mouse.down();
    await A.mouse.move(de.x - 30, de.y + 30, { steps: 6 });
    await A.mouse.move(de.x - 60, de.y + 60, { steps: 6 });
    await A.mouse.up();
    await expect.poll(async () => (await trajetoria(A, id))?.[0]?.lng, { timeout: 15000, message: 'o arrasto nao moveu a ancora' }).not.toBe(antes[0].lng);
    const depois = await trajetoria(A, id);

    // A rota INTEIRA andou o mesmo deslocamento (a forma se preserva), e os tempos ficam.
    const dLng = depois[0].lng - antes[0].lng;
    const dLat = depois[0].lat - antes[0].lat;
    for (let i = 0; i < antes.length; i++) {
        expect(depois[i].t).toBe(antes[i].t);
        expect(depois[i].lng - antes[i].lng).toBeCloseTo(dLng, 6);
        expect(depois[i].lat - antes[i].lat).toBeCloseTo(dLat, 6);
    }
    await expect.poll(async () => (await collab.db.queryFeatureRow(id))?.properties?.trajetoria ?? null, { timeout: 30000 }).toEqual(depois);
    await expect.poll(() => trajetoria(B, id), { timeout: 30000 }).toEqual(depois);
});
