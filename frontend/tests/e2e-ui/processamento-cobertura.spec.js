// Path: e2e-ui/processamento-cobertura.spec.js

/**
 * @fileoverview COBERTURA DOS PROCESSAMENTOS, EXECUTADOS DE VERDADE e com o RESULTADO conferido.
 *
 * `processing-tab-local.spec.js` so' abre os paineis e `browser-collab-processing.spec.js` so'
 * roda a envoltoria sobre pontos. Aqui os tres algoritmos registrados (`processing/algorithms/index.js`:
 * buffer, envoltoria convexa, Voronoi) rodam pela aba Processamento, sobre feicoes desenhadas com as
 * ferramentas reais, e cada caso confere:
 *  - a geometria de saida (o raio do buffer em metros, a envoltoria contendo todos os vertices, uma
 *    zona de Voronoi por ponto e recortada pelo retangulo desenhado);
 *  - a contagem e a camada de saida (criada com o nome pedido no painel);
 *  - o colega recebendo, o Postgres guardando e o F5;
 *  - o Ctrl+Z (botao Desfazer da barra, a mesma porta).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test processamento-cobertura --retries=0 --workers=1
 */

import { collabTest, expect, drawPointUI, drawLineUI, drawPolygonUI, selectFeatureUI } from './helpers/collab.fixtures.js';
import { clicarNoMapaUI } from './helpers/collab-helpers.js';

// --- LEITURAS -----------------------------------------------------------------

/** As camadas do mapa corrente ({id, name}). */
const camadas = (page) => page.evaluate(async () => {
    const store = await import('/src/js/store/index.js');
    return (store.getLayers() ?? []).map((l) => ({ id: l.id, name: l.name }));
});

/** As feicoes do mapa corrente numa camada, com geometria. */
const feicoesDaCamada = (page, layerId) => page.evaluate(async (lid) => {
    const store = await import('/src/js/store/index.js');
    const todas = await store.getCurrentMapFeatures();
    return Object.values(todas).flat().filter((f) => f?.properties?.layerId === lid)
        .map((f) => ({ id: f.properties.id, source: f.properties.source, geometry: f.geometry }));
}, layerId);

const feicoesNoServidor = (db, layerId) =>
    db.raw.any('SELECT id FROM features WHERE layer_id = $1 AND deleted_at IS NULL', [layerId]);

/** Distancia em metros (haversine), sem depender do Turf da pagina. */
function metros([lng1, lat1], [lng2, lat2]) {
    const R = 6371008.8;
    const rad = (g) => (g * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/** Ponto dentro do anel (ray casting), suficiente para anel simples. */
function dentro([x, y], anel) {
    let d = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const [xi, yi] = anel[i];
        const [xj, yj] = anel[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
    }
    return d;
}

// --- GESTOS -------------------------------------------------------------------

async function abrirAlgoritmoUI(page, id) {
    const aba = page.locator('.processing-algorithm-list');
    if (!(await aba.isVisible().catch(() => false))) await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();
    await expect(aba).toBeVisible({ timeout: 10000 });
    await page.locator(`.processing-card[data-algorithm-id="${id}"]`).evaluate((el) => el.click());
    const painel = page.locator(`.processing-panel[data-testid="processing-panel"][data-algorithm-id="${id}"]`);
    await expect(painel).toBeVisible({ timeout: 8000 });
    return painel;
}

/**
 * Roda o algoritmo com os parametros do painel e devolve a camada de saida (a camada NOVA).
 * @returns {Promise<{id: string, name: string}>}
 */
async function executarUI(page, painel, { camadaOrigem, nome, distancia } = {}) {
    const antes = new Set((await camadas(page)).map((l) => l.id));
    if (camadaOrigem) await painel.locator('.attr-modern-select-input').first().selectOption(camadaOrigem);
    if (distancia !== undefined) {
        const campo = painel.locator('.attr-modern-numeric-input input, input.attr-modern-numeric-input').first();
        await campo.fill(String(distancia));
        await campo.press('Tab');
    }
    if (nome) await painel.locator('.processing-panel__output-name').fill(nome);
    await expect(painel.locator('.processing-panel__execute-btn')).toBeEnabled({ timeout: 5000 });
    await painel.locator('.processing-panel__execute-btn').click();
    await expect(painel.locator('.processing-panel__result--success')).toBeVisible({ timeout: 20000 });
    let nova = null;
    await expect.poll(async () => {
        nova = (await camadas(page)).find((l) => !antes.has(l.id)) ?? null;
        return nova;
    }, { timeout: 10000, message: 'a camada de saida nao nasceu' }).toBeTruthy();
    return nova;
}

async function camadaAtiva(page) {
    return page.evaluate(async () => (await import('/src/js/store/index.js')).getActiveLayerIdSync());
}

async function desfazerUI(page) {
    await page.locator('.toolbar-standalone-btn[data-tool-id="undo"]').click();
}

async function recarregar(page) {
    await page.reload();
    await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
}

// --- CASOS --------------------------------------------------------------------

const P = [-43.20, -22.90];
const LINHA = [[-43.25, -22.95], [-43.22, -22.93], [-43.19, -22.94]];
const POLIGONO = [[-43.15, -22.95], [-43.12, -22.95], [-43.12, -22.92], [-43.15, -22.92]];

collabTest.describe('Processamentos executados de ponta a ponta', () => {
    collabTest('Buffer: ponto, linha e poligono, distancia e nome da camada; colega, Postgres e F5', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const origem = await camadaAtiva(A);
        const idPonto = await drawPointUI(A, P);
        const idLinha = await drawLineUI(A, LINHA);
        const idPoligono = await drawPolygonUI(A, POLIGONO);
        expect([idPonto, idLinha, idPoligono].every(Boolean)).toBe(true);
        await A.keyboard.press('Escape');

        const painel = await abrirAlgoritmoUI(A, 'buffer');
        const saida = await executarUI(A, painel, { camadaOrigem: origem, nome: 'Zona teste 750', distancia: 750 });
        expect(saida.name, 'a camada de saida tem o nome pedido').toBe('Zona teste 750');

        const resultado = await feicoesDaCamada(A, saida.id);
        expect(resultado.length, 'um poligono por feicao de entrada').toBe(3);
        expect(resultado.every((f) => f.source === 'polygon' && f.geometry?.type === 'Polygon')).toBe(true);

        // O buffer do ponto e' um circulo de raio 750 m ao redor dele.
        const doPonto = resultado.find((f) => dentro(P, f.geometry.coordinates[0]));
        expect(doPonto, 'um dos poligonos contem o ponto').toBeTruthy();
        const raios = doPonto.geometry.coordinates[0].map((v) => metros(P, v));
        console.log(`RAIO min ${Math.min(...raios).toFixed(1)} max ${Math.max(...raios).toFixed(1)}`);
        expect(Math.min(...raios)).toBeGreaterThan(740);
        expect(Math.max(...raios)).toBeLessThan(760);
        // O da linha contem todos os vertices dela; o do poligono contem todos os do poligono.
        expect(resultado.some((f) => LINHA.every((v) => dentro(v, f.geometry.coordinates[0])))).toBe(true);
        expect(resultado.some((f) => POLIGONO.every((v) => dentro(v, f.geometry.coordinates[0])))).toBe(true);

        // Colega, Postgres.
        await expect.poll(async () => (await feicoesDaCamada(B, saida.id)).length, { timeout: 30000 }).toBe(3);
        await expect.poll(async () => (await feicoesNoServidor(collab.db, saida.id)).length, { timeout: 30000 }).toBe(3);
        const linhaCamada = await collab.db.raw.oneOrNone('SELECT name FROM layers WHERE id = $1 AND deleted_at IS NULL', [saida.id]);
        expect(linhaCamada?.name, 'a camada de saida existe no servidor com o nome').toBe('Zona teste 750');

        // F5 no autor.
        await recarregar(A);
        expect((await feicoesDaCamada(A, saida.id)).length, 'o resultado sobrevive ao F5').toBe(3);
        expect((await camadas(A)).find((l) => l.id === saida.id)?.name).toBe('Zona teste 750');
    });

    collabTest('Buffer: desfazer tira o resultado do autor, do colega e do servidor', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const origem = await camadaAtiva(A);
        await drawPointUI(A, P);
        await drawPointUI(A, [-43.18, -22.88]);
        await A.keyboard.press('Escape');
        const painel = await abrirAlgoritmoUI(A, 'buffer');
        const saida = await executarUI(A, painel, { camadaOrigem: origem, distancia: 300 });
        await expect.poll(async () => (await feicoesNoServidor(collab.db, saida.id)).length, { timeout: 30000 }).toBe(2);
        await expect.poll(async () => (await feicoesDaCamada(B, saida.id)).length, { timeout: 30000 }).toBe(2);

        await A.keyboard.press('Escape');
        await desfazerUI(A);
        await expect.poll(async () => (await feicoesDaCamada(A, saida.id)).length, { timeout: 15000 }).toBe(0);
        await expect.poll(async () => (await feicoesNoServidor(collab.db, saida.id)).length, { timeout: 30000 }).toBe(0);
        await expect.poll(async () => (await feicoesDaCamada(B, saida.id)).length, { timeout: 30000 }).toBe(0);
        const camadaDepois = (await camadas(A)).find((l) => l.id === saida.id);
        console.log(`CAMADA DE SAIDA DEPOIS DO DESFAZER: ${JSON.stringify(camadaDepois ?? null)}`);
    });

    collabTest('Buffer: "Apenas feicoes selecionadas" processa so a selecionada', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const origem = await camadaAtiva(A);
        const escolhida = await drawPointUI(A, P);
        await drawPointUI(A, [-43.16, -22.86]);
        await drawPointUI(A, [-43.24, -22.86]);
        await A.keyboard.press('Escape');
        await selectFeatureUI(A, escolhida);
        const painel = await abrirAlgoritmoUI(A, 'buffer');
        await expect(painel.locator('.processing-panel__hint')).toContainText('1 feição selecionada', { timeout: 5000 });
        await painel.locator('.processing-panel__toggle-section .attr-modern-toggle-switch').first().click();
        const saida = await executarUI(A, painel, { camadaOrigem: origem, distancia: 200 });
        const resultado = await feicoesDaCamada(A, saida.id);
        expect(resultado.length, 'so a feicao selecionada foi processada').toBe(1);
        expect(dentro(P, resultado[0].geometry.coordinates[0])).toBe(true);
    });

    collabTest('Envoltoria: linha e poligono juntos dao UM poligono que contem todos os vertices; colega e F5', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const origem = await camadaAtiva(A);
        await drawLineUI(A, LINHA);
        await drawPolygonUI(A, POLIGONO);
        await A.keyboard.press('Escape');
        const painel = await abrirAlgoritmoUI(A, 'convex-hull');
        const saida = await executarUI(A, painel, { camadaOrigem: origem, nome: 'Contorno teste' });
        const resultado = await feicoesDaCamada(A, saida.id);
        expect(resultado.length).toBe(1);
        const anel = resultado[0].geometry.coordinates[0];
        // Todo vertice de entrada esta dentro ou na borda: a checagem tolera a borda pelo centroide.
        const todos = [...LINHA, ...POLIGONO];
        const cx = todos.reduce((s, v) => s + v[0], 0) / todos.length;
        const cy = todos.reduce((s, v) => s + v[1], 0) / todos.length;
        const encolhido = (v) => [cx + (v[0] - cx) * 0.999, cy + (v[1] - cy) * 0.999];
        expect(todos.every((v) => dentro(encolhido(v), anel)), 'a envoltoria contem todos os vertices').toBe(true);
        await expect.poll(async () => (await feicoesDaCamada(B, saida.id)).length, { timeout: 30000 }).toBe(1);
        await recarregar(B);
        expect((await feicoesDaCamada(B, saida.id)).length, 'o colega mantem o resultado depois do F5').toBe(1);
    });

    collabTest('Voronoi: tres pontos e retangulo desenhado dao tres zonas recortadas, uma por ponto', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const origem = await camadaAtiva(A);
        const pontos = [[-43.22, -22.92], [-43.18, -22.92], [-43.20, -22.88]];
        for (const p of pontos) await drawPointUI(A, p);
        await drawLineUI(A, LINHA);
        await A.keyboard.press('Escape');
        const painel = await abrirAlgoritmoUI(A, 'voronoi');
        // "Apenas pontos": a linha na camada fica de fora.
        await painel.locator('.processing-panel__toggle-section .attr-modern-toggle-switch').last().click();
        // A camera enquadra a area (gesto de camera, o mesmo que `drawPointUI` faz).
        await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.2, -22.9], zoom: 11 }));
        await painel.locator('.processing-panel__draw-btn').click();
        const canto1 = [-43.26, -22.96];
        const canto2 = [-43.14, -22.84];
        expect((await clicarNoMapaUI(A, canto1)).coberto, 'o primeiro canto cai no mapa').toBe(false);
        expect((await clicarNoMapaUI(A, canto2)).coberto, 'o segundo canto cai no mapa').toBe(false);
        await expect(painel.locator('.processing-panel__bbox-display')).not.toHaveText('Área não definida', { timeout: 5000 });
        const saida = await executarUI(A, painel, { camadaOrigem: origem, nome: 'Proximidade teste' });
        const zonas = await feicoesDaCamada(A, saida.id);
        console.log(`ZONAS ${zonas.length}`);
        expect(zonas.length, 'uma zona por ponto (a linha fica de fora com "Apenas pontos")').toBe(3);
        for (const p of pontos) {
            expect(zonas.filter((z) => dentro(p, z.geometry.coordinates[0])).length, `o ponto ${p} esta em exatamente uma zona`).toBe(1);
        }
        const [minX, minY, maxX, maxY] = [Math.min(canto1[0], canto2[0]), Math.min(canto1[1], canto2[1]), Math.max(canto1[0], canto2[0]), Math.max(canto1[1], canto2[1])];
        const folga = 0.002;
        expect(zonas.every((z) => z.geometry.coordinates[0].every(([x, y]) => x >= minX - folga && x <= maxX + folga && y >= minY - folga && y <= maxY + folga)),
            'as zonas ficam dentro do retangulo desenhado').toBe(true);
        await expect.poll(async () => (await feicoesDaCamada(B, saida.id)).length, { timeout: 30000 }).toBe(3);
        await expect.poll(async () => (await feicoesNoServidor(collab.db, saida.id)).length, { timeout: 30000 }).toBe(3);
    });
    collabTest('Os tres algoritmos aceitam cada um dos 16 tipos de geometria declarados', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        // EXCECAO DECLARADA AO "TUDO PELA TELA": as feicoes de entrada nascem pela store. O sujeito
        // deste caso e' o despacho do algoritmo por TIPO (`supportedGeometryTypes`, um filtro por
        // `properties.source`), e desenhar dezesseis ferramentas diferentes aqui mediria as
        // ferramentas, que tem specs proprios. A execucao continua pela aba, pelo botao real.
        const origem = await camadaAtiva(A);
        const tipos = await A.evaluate(async (layerId) => {
            const store = await import('/src/js/store/index.js');
            const { SUPPORTED_GEOMETRY_TYPES } = await import('/src/js/processing/processing.constants.js');
            const pontos = ['text', 'image', 'military_symbol', 'engineering_symbol', 'coordination_measure'];
            const linhas = ['line', 'brush', 'arrow', 'boundary', 'occupied_front', 'coordination_line'];
            const mapa = {};
            SUPPORTED_GEOMETRY_TYPES.forEach((source, i) => {
                const x = -43.30 + (i % 4) * 0.03;
                const y = -22.95 + Math.floor(i / 4) * 0.03;
                let geometry;
                if (source === 'point' || pontos.includes(source)) geometry = { type: 'Point', coordinates: [x, y] };
                else if (linhas.includes(source)) geometry = { type: 'LineString', coordinates: [[x, y], [x + 0.01, y + 0.005]] };
                else geometry = { type: 'Polygon', coordinates: [[[x, y], [x + 0.01, y], [x + 0.01, y + 0.01], [x, y + 0.01], [x, y]]] };
                const feature = { type: 'Feature', id: Date.now() + i, geometry,
                    properties: { id: crypto.randomUUID(), source, layerId, nome: `Entrada ${source}` } };
                const storage = store.getStorageTypeFromSource(source);
                (mapa[storage] ??= []).push(feature);
            });
            await store.addFeatures(mapa);
            return SUPPORTED_GEOMETRY_TYPES.length;
        }, origem);
        expect(tipos).toBe(16);

        let painel = await abrirAlgoritmoUI(A, 'buffer');
        let saida = await executarUI(A, painel, { camadaOrigem: origem, distancia: 100 });
        expect((await feicoesDaCamada(A, saida.id)).length, 'buffer: um poligono por feicao, dos 16 tipos').toBe(16);

        painel = await abrirAlgoritmoUI(A, 'convex-hull');
        saida = await executarUI(A, painel, { camadaOrigem: origem });
        expect((await feicoesDaCamada(A, saida.id)).length, 'envoltoria: um poligono para os 16 tipos').toBe(1);

        // Voronoi POR ULTIMO, de proposito: foi nesta ordem que um canto do retangulo caiu sobre uma
        // feicao e o painel de processamento sumiu (`voronoi-retangulo-sobre-feicao.repro.spec.js`).
        painel = await abrirAlgoritmoUI(A, 'voronoi');
        // O retangulo cabe na parte do mapa que o painel de processamento nao cobre.
        await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.22, -22.90], zoom: 9 }));
        await painel.locator('.processing-panel__draw-btn').click();
        expect((await clicarNoMapaUI(A, [-43.40, -23.05])).coberto, 'o primeiro canto cai no mapa').toBe(false);
        expect((await clicarNoMapaUI(A, [-43.12, -22.75])).coberto, 'o segundo canto cai no mapa').toBe(false);
        await expect(painel.locator('.processing-panel__bbox-display')).not.toHaveText('Área não definida', { timeout: 5000 });
        saida = await executarUI(A, painel, { camadaOrigem: origem });
        expect((await feicoesDaCamada(A, saida.id)).length, 'voronoi sem "Apenas pontos": uma zona por feicao (centroide)').toBe(16);

    });
});
