// Path: e2e-ui/cobertura-copia-parcial-ebgeo.spec.js

/**
 * COVERAGE: the CONTENT of the partial `.ebgeo` copy, the file "Exportar" offers when part of the atlas
 * cannot be read. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * `exportar-leitura-falha.spec.js` fails the GROUP reads and checks the warning, the cancel and that
 * the file has the map and no groups. What it does not check is the point of the partial copy: that
 * EVERYTHING ELSE is in it. Here the atlas has two maps with features and notes, and:
 *
 * 1. the group reads fail: the partial copy carries every feature of both maps field by field (as
 *    the repository holds them, under the exporter's declared 6-decimal rounding), the notes, and
 *    no groups; and it opens as a new local atlas with those features;
 * 2. ONE map's document read fails: the warning names that map ("mapa e feições", a label the
 *    exporter declares) and the partial copy carries the OTHER map whole.
 */

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import JSZip from 'jszip';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const MAPA_B = 'Mapa Bravo';

async function preparar(page) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    // The injection: reads of the GROUPS database, or of ONE key of the MAPS database, throw while
    // a flag is up. Installed before boot; armed only after the export modal is open.
    await page.addInitScript(() => {
        for (const metodo of ['get', 'getAll', 'openCursor']) {
            const original = IDBObjectStore.prototype[metodo];
            IDBObjectStore.prototype[metodo] = function (...args) {
                const banco = this.transaction.db.name;
                if (window.__falharGrupos && banco.startsWith('ebgeo_groups')) {
                    throw new DOMException('Injected unavailable group database', 'InvalidStateError');
                }
                if (window.__falharChaveDeMapa && banco.startsWith('ebgeo_maps') && args[0] === window.__falharChaveDeMapa) {
                    throw new DOMException('Injected unreadable map document', 'InvalidStateError');
                }
                return original.apply(this, args);
            };
        }
    });
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect(page.locator('.loading-background')).toHaveCount(0, { timeout: 30000 });

    return page.evaluate(async (mapaB) => {
        const store = await import('/src/js/store/index.js');
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const principal = await store.getCurrentMapName();
        const ponto = (nome, c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c },
            properties: { id: crypto.randomUUID(), source: 'point', nome, descricao: `Descrição de ${nome}`, layerId: 'default', visivel: true, bloqueado: false, attributes: { 'Situação': 'ativa' } } });
        const linha = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-53.4, -30.0], [-53.3, -30.1]] },
            properties: { id: crypto.randomUUID(), source: 'line', nome: 'Eixo Ação', layerId: 'default', visivel: true, bloqueado: false } };
        await store.addFeature('point', ponto('Posto São João', [-53.45, -30.05]));
        await store.addFeature('point', ponto('Base Três', [-53.35, -30.15]));
        await store.addFeature('line', linha);
        await store.setMapNotes(principal, { title: 'Notas do Principal', description: '<p>Ordem de <strong>operações</strong></p>' });
        const idGrupo = crypto.randomUUID();
        await getRepository().saveGroups(principal, { [idGrupo]: { id: idGrupo, name: 'Grupo Alfa', features: [] } });

        await store.addMap(mapaB);
        await store.addFeature('point', ponto('Ponto do Bravo', [-52.9, -29.9]), mapaB);

        // The raw key of each map document in the ACTIVE atlas's maps database (resolved by the
        // namespace factory, never by a guessed database name), for the per-key failure.
        const { getStore, StoreName } = await import('/src/js/store/atlas-namespace.js');
        const mapas = getStore(StoreName.MAPS);
        const chaves = [];
        for (const chave of await mapas.keys()) {
            chaves.push({ chave, nome: (await mapas.getItem(chave))?.name ?? null });
        }
        return { principal, chaves };
    }, MAPA_B);
}

/** Every feature of the named maps, from the repository. */
function feicoes(page, mapas) {
    return page.evaluate(async (nomes) => {
        const store = await import('/src/js/store/index.js');
        const out = {};
        for (const nome of nomes) {
            const doc = await store.getMapData(nome);
            for (const [balde, lista] of Object.entries(doc?.features ?? {})) {
                if (Array.isArray(lista)) for (const f of lista) out[f.properties.id] = { mapa: nome, balde, properties: f.properties, geometry: f.geometry };
            }
        }
        return out;
    }, mapas);
}

const arredondar = (g) => {
    const r = (c) => (Array.isArray(c) ? c.map(r) : (Number.isFinite(c) ? Math.round(c * 1e6) / 1e6 : c));
    return g ? { ...g, coordinates: r(g.coordinates) } : g;
};

function diferencas(antes, depois) {
    const out = [];
    for (const [id, a] of Object.entries(antes)) {
        const b = depois[id];
        if (!b) { out.push(`${a.properties.nome}: ausente`); continue; }
        if (b.mapa !== a.mapa) out.push(`${a.properties.nome}: mapa ${b.mapa}`);
        if (!isDeepStrictEqual(arredondar(a.geometry), arredondar(b.geometry))) out.push(`${a.properties.nome}: geometria`);
        for (const c of new Set([...Object.keys(a.properties), ...Object.keys(b.properties)])) {
            if (!isDeepStrictEqual(a.properties[c], b.properties[c])) out.push(`${a.properties.nome}: ${c}`);
        }
    }
    return out;
}

async function lerArquivo(caminho) {
    const bytes = await readFile(caminho);
    const zip = await JSZip.loadAsync(bytes.subarray(6).map((b) => b ^ 0xAA));
    const data = JSON.parse(await zip.file('data.json').async('string'));
    const out = {};
    for (const [nome, m] of Object.entries(data.maps)) {
        for (const [balde, lista] of Object.entries(m.features ?? {})) {
            if (Array.isArray(lista)) for (const f of lista) out[f.properties.id] = { mapa: nome, balde, properties: f.properties, geometry: f.geometry };
        }
    }
    return { data, feicoes: out };
}

/** Opens the export modal, arms the failure, confirms, and returns the warning dialog. */
async function exportarComFalha(page, armar, argumento = null) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await page.locator('#maps-action-save').click();
    await expect(page.locator('.export-modal-container')).toBeVisible({ timeout: 15000 });
    await page.evaluate(armar, argumento);
    await page.locator('.export-modal-btn-confirm').click();
    const aviso = page.locator('.confirm-modal-container');
    await expect(aviso.locator('.confirm-modal-title')).toHaveText('Não foi possível ler parte do atlas', { timeout: 15000 });
    return aviso;
}

describeOrSkip('Cobertura: o conteúdo da cópia parcial do .ebgeo', () => {
    test.describe.configure({ retries: 0 });

    test('grupos ilegíveis: a cópia leva todas as feições dos dois mapas e as notas, e abre', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const { principal } = await preparar(page);
        const antes = await feicoes(page, [principal, MAPA_B]);
        expect(Object.keys(antes)).toHaveLength(4);

        const aviso = await exportarComFalha(page, () => { window.__falharGrupos = true; });
        await expect(aviso).toContainText(`grupos no mapa "${principal}"`);
        const baixando = page.waitForEvent('download', { timeout: 30000 });
        await aviso.locator('.confirm-modal-btn-confirm').click();
        const destino = testInfo.outputPath('copia-parcial-grupos.ebgeo');
        await (await baixando).saveAs(destino);
        await expect(page.locator('.toast', { hasText: 'Cópia parcial exportada.' })).toBeVisible({ timeout: 15000 });
        await page.evaluate(() => { window.__falharGrupos = false; });

        const { data, feicoes: noArquivo } = await lerArquivo(destino);
        expect(diferencas(antes, noArquivo), 'toda feição, todo campo').toEqual([]);
        expect(Object.keys(data.maps).sort()).toEqual([MAPA_B, principal].sort());
        expect(data.mapNotes?.[principal]?.title).toBe('Notas do Principal');
        expect(Object.keys(data.groups)).toEqual([]);

        // The partial file is a real file: it opens as a new local atlas with the same features.
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(destino);
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await expect(page.locator('.toast', { hasText: '2 mapas carregados.' })).toBeVisible({ timeout: 60000 });
        const reaberto = await feicoes(page, [principal, MAPA_B]);
        expect(diferencas(antes, reaberto), 'reaberto: toda feição, todo campo').toEqual([]);
    });

    test('um mapa ilegível: o aviso o nomeia e a cópia leva o OUTRO mapa inteiro', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        const { principal, chaves } = await preparar(page);
        const chaveB = chaves.find((c) => c.nome === MAPA_B)?.chave;
        expect(chaveB, 'a chave do documento do segundo mapa').toBeTruthy();
        const antes = await feicoes(page, [principal]);
        expect(Object.keys(antes)).toHaveLength(3);

        const erros = [];
        page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 160)); });
        let aviso;
        try {
            aviso = await exportarComFalha(page, (k) => { window.__falharChaveDeMapa = k; }, chaveB);
        } catch (e) {
            console.log('[sem aviso]', JSON.stringify(erros.slice(-3)));
            throw e;
        }
        await expect(aviso).toContainText(`mapa e feições no mapa "${MAPA_B}"`);
        const baixando = page.waitForEvent('download', { timeout: 30000 });
        await aviso.locator('.confirm-modal-btn-confirm').click();
        const destino = testInfo.outputPath('copia-parcial-mapa.ebgeo');
        await (await baixando).saveAs(destino);
        await page.evaluate(() => { window.__falharChaveDeMapa = null; });

        const { data, feicoes: noArquivo } = await lerArquivo(destino);
        expect(Object.keys(data.maps)).toEqual([principal]);
        expect(diferencas(antes, noArquivo), 'o mapa legível sai inteiro').toEqual([]);
        // The file does not point at the map it does not carry.
        expect(data.mapOrder ?? []).not.toContain(MAPA_B);
        expect(data.currentMap).toBe(principal);
    });
});
