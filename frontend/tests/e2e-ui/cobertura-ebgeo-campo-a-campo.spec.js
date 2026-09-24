// Path: e2e-ui/cobertura-ebgeo-campo-a-campo.spec.js

/**
 * COVERAGE: the `.ebgeo` round trip compared FIELD BY FIELD, for every feature of a real archive.
 * Part of the 2026-09-24 coverage campaign (import/export).
 *
 * `ebgeo-round-trip-arquivo.spec.js` already drives the whole cycle through the disk and compares
 * COUNTS (maps, features per map, layers, groups, briefings, slides, icons, images). A count is
 * blind to a field lost on the way: a symbol that comes back without its SIDC, a circle without
 * its radius, a text without its font size are all still one feature of the right type. Here the
 * unit is the FIELD:
 *
 *   ANTES   every feature of every map, read from the repository after the archive entered;
 *   ARQUIVO the `data.json` of the file "Exportar" produced from that state;
 *   DEPOIS  every feature of every map after that file entered as a NEW local atlas.
 *
 * ARQUIVO is compared with ANTES (the exporter alone) and DEPOIS with ANTES (the pair). ANTES is
 * the state after the archive's own import, not the fixture, so the schema migration the fixture
 * goes through on the way in (2.4 to the current version) is not counted as a loss.
 *
 * The archive is `03-completo-2.4.ebgeo`, produced by the other product line: 14 maps, 805
 * features of 19 types. The three product types it does not carry (`engineering_symbol`, and
 * `processed_los` / `processed_visibility`, which are derived output and never
 * stored as input) are named in the matrix of the campaign, not hidden here.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import JSZip from 'jszip';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const FIXTURE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/03-completo-2.4.ebgeo', import.meta.url));
const MAPAS = 14;

let dirTemporario = null;

async function decodificarEbgeo(caminho) {
    const raw = new Uint8Array(await readFile(caminho));
    expect(new TextDecoder().decode(raw.slice(0, 6))).toBe('EBGXOR');
    const zip = await JSZip.loadAsync(Uint8Array.from(raw.slice(6), (b) => b ^ 0xAA));
    const data = JSON.parse(await zip.file('data.json').async('string'));
    const imagens = new Set(zip.file(/^images\/.+/).map((e) => e.name.replace(/^images\//, '').replace(/\.[^.]+$/, '')));
    return { data, imagens };
}

async function importarPelaTela(page, arquivo) {
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await expect(page.locator('.toast', { hasText: `${MAPAS} mapas carregados.` })).toBeVisible({ timeout: 120000 });
}

/** Every feature of every map, from the REPOSITORY (not the memory of the open map). */
function lerFeicoes(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const out = {};
        for (const nome of await store.getAllMapNamesStore()) {
            const doc = await store.getMapData(nome);
            for (const [balde, lista] of Object.entries(doc?.features ?? {})) {
                if (!Array.isArray(lista)) continue;
                for (const f of lista) {
                    out[f.properties.id] = { mapa: nome, balde, properties: f.properties, geometry: f.geometry };
                }
            }
        }
        return out;
    });
}

function feicoesDoArquivo(data) {
    const out = {};
    for (const [nome, m] of Object.entries(data.maps ?? {})) {
        for (const [balde, lista] of Object.entries(m.features ?? {})) {
            if (!Array.isArray(lista)) continue;
            for (const f of lista) out[f.properties.id] = { mapa: nome, balde, properties: f.properties, geometry: f.geometry };
        }
    }
    return out;
}

/**
 * The differences between two readings, grouped by (type, field): how many features and one
 * example. Grouped because 805 features that lose the same field are one finding, not 805.
 */
function diferencas(antes, depois) {
    const grupos = {};
    const anota = (tipo, campo, id, a, b) => {
        const k = `${tipo} :: ${campo}`;
        grupos[k] ??= { quantas: 0, exemplo: { id, antes: a, depois: b } };
        grupos[k].quantas += 1;
    };
    for (const [id, a] of Object.entries(antes)) {
        const tipo = a.properties.source ?? a.balde;
        const b = depois[id];
        if (!b) { anota(tipo, '(feição ausente)', id, a.mapa, null); continue; }
        if (b.mapa !== a.mapa) anota(tipo, '(mapa)', id, a.mapa, b.mapa);
        if (!isDeepStrictEqual(a.geometry, b.geometry)) anota(tipo, '(geometria)', id, a.geometry?.type, b.geometry?.type);
        const campos = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
        for (const c of campos) {
            if (!isDeepStrictEqual(a.properties[c], b.properties[c])) {
                anota(tipo, c, id, JSON.stringify(a.properties[c])?.slice(0, 80), JSON.stringify(b.properties[c])?.slice(0, 80));
            }
        }
    }
    for (const id of Object.keys(depois)) if (!antes[id]) anota(depois[id].properties.source ?? depois[id].balde, '(feição a mais)', id, null, depois[id].mapa);
    return grupos;
}

describeOrSkip('Cobertura: .ebgeo campo a campo', () => {
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => {
        if (dirTemporario) await rm(dirTemporario, { recursive: true, force: true });
        dirTemporario = null;
    });

    test('exportar e reimportar devolve toda feição com todos os campos', async ({ page }) => {
        test.setTimeout(600000);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        await importarPelaTela(page, FIXTURE);
        const antes = await lerFeicoes(page);
        const porTipo = {};
        for (const f of Object.values(antes)) porTipo[f.properties.source ?? f.balde] = (porTipo[f.properties.source ?? f.balde] ?? 0) + 1;
        console.log('[antes]', Object.keys(antes).length, JSON.stringify(porTipo));
        // ABSOLUTE, so two empty readings cannot agree: the archive declares 805 features.
        expect(Object.keys(antes).length).toBe(805);

        // Export through the button. The dialogs in between (catalog prune, missing picture) are
        // part of the product and answered with "confirm" as the person would.
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first()).toBeVisible({ timeout: 15000 });
        await page.locator('#maps-action-save').click();
        const modal = page.locator('.export-modal-container');
        await expect(modal).toBeVisible({ timeout: 20000 });
        await expect(modal.locator('.export-map-item')).toHaveCount(MAPAS);
        let download = null;
        page.once('download', (d) => { download = d; });
        await modal.locator('.export-modal-btn-confirm').click();
        const avisos = [];
        await expect.poll(async () => {
            if (download) return true;
            const aviso = page.locator('.confirm-modal-container');
            if (await aviso.isVisible().catch(() => false)) {
                avisos.push(await aviso.locator('.confirm-modal-title').innerText().catch(() => '?'));
                await aviso.locator('.confirm-modal-btn-confirm').click().catch(() => {});
            }
            return false;
        }, { timeout: 180000, intervals: [500] }).toBe(true);
        console.log('[avisos]', JSON.stringify(avisos));
        dirTemporario = await mkdtemp(join(tmpdir(), 'ebgeo-campo-'));
        const destino = join(dirTemporario, download.suggestedFilename());
        await download.saveAs(destino);

        const { data, imagens } = await decodificarEbgeo(destino);
        const arquivo = feicoesDoArquivo(data);
        const noArquivo = diferencas(antes, arquivo);
        console.log('[antes x arquivo]', JSON.stringify(noArquivo, null, 1));

        // Every image feature that had a blob before has its bytes in the file.
        const semBytes = await page.evaluate(async (ids) => {
            const store = await import('/src/js/store/index.js');
            const faltam = [];
            for (const id of ids) if (await store.getImage?.(id)) faltam.push(id);
            return faltam;
        }, Object.values(antes).filter((f) => f.balde === 'images').map((f) => f.properties.id).filter((id) => !imagens.has(id)));
        console.log('[imagem com blob e sem bytes no arquivo]', JSON.stringify(semBytes));

        await importarPelaTela(page, destino);
        const depois = await lerFeicoes(page);
        const naVolta = diferencas(antes, depois);
        console.log('[antes x depois]', JSON.stringify(naVolta, null, 1));

        expect(noArquivo, 'o arquivo carrega toda feição com todos os campos').toEqual({});
        expect(semBytes, 'toda figura que tinha bytes sai com eles').toEqual([]);
        expect(naVolta, 'a reimportação devolve toda feição com todos os campos').toEqual({});
    });
});
