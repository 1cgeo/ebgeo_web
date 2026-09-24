// Path: e2e-ui/cobertura-atributos-travessia.spec.js

/**
 * @fileoverview OS ATRIBUTOS ATRAVESSAM OS GESTOS QUE COPIAM OU LEVAM UMA FEIÇÃO, num atlas LOCAL.
 *
 * A feição de origem vem de um arquivo e carrega os valores que dão trabalho: texto com espaço,
 * número, VAZIO, acentos, texto longo, valor que parece número ("007"), decimal com vírgula, chave com
 * espaço e a chave reservada `id`, que chega como `id_importado`. Cada gesto é conferido campo a campo
 * pela store, e de novo depois de um F5:
 *
 *   - copiar e colar pelo teclado (Ctrl+C, Ctrl+V), e a CÓPIA é independente: mudar um atributo dela
 *     não muda o da origem;
 *   - "Duplicar Seleção" pelo menu de contexto;
 *   - transferir a camada para outro mapa, copiando e depois movendo;
 *   - exportar `.ebgeo` pelo botão da aba Mapas e abri-lo pela tela de atlas;
 *   - exportar KMZ pela aba Exportar e soltá-lo de volta no mapa.
 *
 * O KMZ de ida e volta já tem spec (`kmz-ida-e-volta-campo-a-campo.spec.js`), com valores simples;
 * aqui entram os valores difíceis.
 */

import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';
import { selectFeatureUI, clicarNoMapaUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

const ORIGEM = [-43.2, -22.9];
const LONGO = `Observação longa: ${'relevo acidentado, curso d\'água e mata ciliar; '.repeat(30)}fim.`;

/** O que o arquivo traz em `properties`, além do nome. */
const PROPRIEDADES = Object.freeze({
    texto: 'Posto de observação avançado',
    numero: '42',
    vazio: '',
    acento: 'Ação, coração, Ñandú, çãõ',
    longo: LONGO,
    parece_numero: '007',
    decimal: '1,5',
    'altura total': '3',
    id: 'ext-1',
});

/** O que a feição tem de ter em `attributes` depois de importada. */
const ESPERADO = Object.freeze({
    texto: PROPRIEDADES.texto,
    numero: '42',
    vazio: '',
    acento: PROPRIEDADES.acento,
    longo: LONGO,
    parece_numero: '007',
    decimal: '1,5',
    'altura total': '3',
    id_importado: 'ext-1',
});

async function abrirMapa(page) {
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
}

/** Solta um arquivo no mapa, no ponto `lngLat`. */
async function soltarNoMapa(page, nome, buffer, lngLat = ORIGEM) {
    const r = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getContainer().getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0))], e.nome,
            { type: 'application/octet-stream' }));
        const evento = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true,
            clientX: Math.round(rect.left + pt.x), clientY: Math.round(rect.top + pt.y) });
        map.getContainer().dispatchEvent(evento);
        return evento.dataTransfer?.files?.length ?? 0;
    }, { nome, base64: buffer.toString('base64'), lngLat });
    expect(r, 'o arrasto não levou arquivo').toBe(1);
}

/** Os pontos do mapa corrente, com id, nome, camada e atributos. */
function pontos(page) {
    return page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).map((p) => ({
            id: p.properties.id, nome: p.properties.nome, layerId: p.properties.layerId,
            attributes: p.properties.attributes ?? {},
        }));
    });
}

/** Os pontos de um mapa NOMEADO, lidos do repositório. */
function pontosDoMapa(page, mapa) {
    return page.evaluate(async (m) => {
        const s = await import('/src/js/store/index.js');
        const data = await s.getMapDataStore(m);
        return (data?.features?.points ?? []).map((p) => ({
            id: p.properties.id, nome: p.properties.nome, attributes: p.properties.attributes ?? {},
        }));
    }, mapa);
}

/** Abre o mapa local e importa a feição de origem; devolve o id dela. */
async function origemImportada(page) {
    await page.goto('/');
    await abrirMapa(page);
    const arquivo = { type: 'FeatureCollection', features: [{
        type: 'Feature', geometry: { type: 'Point', coordinates: ORIGEM },
        properties: { nome: 'Origem', ...PROPRIEDADES },
    }] };
    await soltarNoMapa(page, 'origem.geojson', Buffer.from(JSON.stringify(arquivo), 'utf8'));
    await expect.poll(async () => (await pontos(page)).length, { timeout: 30000 }).toBe(1);
    const [origem] = await pontos(page);
    expect(origem.attributes, 'o arquivo não chegou campo a campo').toEqual(ESPERADO);
    return origem.id;
}

async function recarregar(page) {
    await page.reload();
    await abrirMapa(page);
}

test('copiar e colar e "Duplicar Seleção" levam os atributos; a cópia é independente; F5', async ({ page }) => {
    test.setTimeout(180000);
    const origemId = await origemImportada(page);

    // Ctrl+C, Ctrl+V.
    await selectFeatureUI(page, origemId);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await pontos(page)).length, { timeout: 15000 }).toBe(2);
    const colada = (await pontos(page)).find((p) => p.id !== origemId);
    expect(colada.attributes, 'a colagem perdeu atributos').toEqual(ESPERADO);

    // "Duplicar Seleção" pelo menu de contexto, com a origem selecionada.
    await page.keyboard.press('Escape');
    await selectFeatureUI(page, origemId);
    const menu = page.locator('.context-menu');
    await expect(async () => {
        await clicarNoMapaUI(page, ORIGEM, { button: 'right' });
        await expect(menu).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20000 });
    await menu.locator('.context-menu-item', { hasText: /^Duplicar Seleção$/ }).click();
    await expect.poll(async () => (await pontos(page)).length, { timeout: 15000 }).toBe(3);
    const duplicada = (await pontos(page)).find((p) => p.id !== origemId && p.id !== colada.id);
    expect(duplicada.attributes, 'a duplicação perdeu atributos').toEqual(ESPERADO);

    // A cópia é independente: mudar um atributo da colada não muda a origem nem a duplicada.
    await page.evaluate(async (id) => {
        const { default: udm } = await import('/src/js/user_data/user_data_manager.js');
        await udm.setAttribute(id, 'point', 'texto', 'só na colada');
    }, colada.id);
    await expect.poll(async () => (await pontos(page)).find((p) => p.id === colada.id)?.attributes?.texto,
        { timeout: 10000 }).toBe('só na colada');
    expect((await pontos(page)).find((p) => p.id === origemId).attributes, 'mudar a cópia mudou a origem')
        .toEqual(ESPERADO);

    await recarregar(page);
    const depois = await pontos(page);
    expect(depois.find((p) => p.id === origemId)?.attributes).toEqual(ESPERADO);
    expect(depois.find((p) => p.id === duplicada.id)?.attributes).toEqual(ESPERADO);
    expect(depois.find((p) => p.id === colada.id)?.attributes).toEqual({ ...ESPERADO, texto: 'só na colada' });
});

test('transferir a camada para outro mapa, copiando e movendo, leva os atributos; F5', async ({ page }) => {
    test.setTimeout(180000);
    const origemId = await origemImportada(page);
    const [{ layerId }] = await pontos(page);

    const r = await page.evaluate(async (camada) => {
        const s = await import('/src/js/store/index.js');
        await s.addMap('Destino dos atributos');
        const copia = await s.transferLayerToMap(camada, 'Destino dos atributos', { mode: 'copy' });
        return { copia: copia?.success === true };
    }, layerId);
    expect(r.copia, 'copiar a camada falhou').toBe(true);
    await expect.poll(async () => (await pontosDoMapa(page, 'Destino dos atributos')).length, { timeout: 15000 }).toBe(1);
    const copiada = (await pontosDoMapa(page, 'Destino dos atributos'))[0];
    expect(copiada.id).not.toBe(origemId);
    expect(copiada.attributes, 'copiar a camada perdeu atributos').toEqual(ESPERADO);

    const movida = await page.evaluate(async (camada) => {
        const s = await import('/src/js/store/index.js');
        return (await s.transferLayerToMap(camada, 'Destino dos atributos', { mode: 'move' }))?.success === true;
    }, layerId);
    expect(movida, 'mover a camada falhou').toBe(true);
    await expect.poll(async () => (await pontosDoMapa(page, 'Destino dos atributos')).length, { timeout: 15000 }).toBe(2);
    expect((await pontosDoMapa(page, 'Destino dos atributos')).find((p) => p.id === origemId)?.attributes,
        'mover a camada perdeu atributos').toEqual(ESPERADO);

    await recarregar(page);
    const noDestino = await pontosDoMapa(page, 'Destino dos atributos');
    expect(noDestino).toHaveLength(2);
    for (const p of noDestino) expect(p.attributes, `${p.id} depois do F5`).toEqual(ESPERADO);
});

test('exportar .ebgeo pela aba Mapas e abri-lo pela tela de atlas leva os atributos; F5', async ({ page }) => {
    test.setTimeout(240000);
    const origemId = await origemImportada(page);

    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await page.locator('#maps-action-save').click();
    const modal = page.locator('.export-modal-container');
    await expect(modal).toBeVisible({ timeout: 20000 });
    const baixado = page.waitForEvent('download', { timeout: 60000 });
    await modal.locator('.export-modal-btn-confirm').click();
    const caminho = await (await baixado).path();

    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles({
        name: 'atributos.ebgeo', mimeType: 'application/octet-stream', buffer: readFileSync(caminho),
    });
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await abrirMapa(page);
    await expect.poll(async () => (await pontos(page)).length, { timeout: 30000 }).toBe(1);
    const aberta = (await pontos(page))[0];
    process.stdout.write(`[travessia] .ebgeo: id ${aberta.id === origemId ? 'mantido' : 'novo'}\n`);
    expect(aberta.attributes, 'o .ebgeo perdeu atributos').toEqual(ESPERADO);

    await recarregar(page);
    expect((await pontos(page))[0]?.attributes).toEqual(ESPERADO);
});

test('exportar KMZ e soltá-lo de volta leva os atributos difíceis', async ({ page }) => {
    test.setTimeout(180000);
    const origemId = await origemImportada(page);

    await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
    await page.locator('.export-option-btn', { hasText: 'Exportar KMZ' }).click();
    const baixando = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.kmz-export-btn').click();
    const bytes = readFileSync(await (await baixando).path());

    await soltarNoMapa(page, 'volta.kmz', bytes);
    await expect.poll(async () => (await pontos(page)).length, { timeout: 15000 }).toBe(2);
    const voltou = (await pontos(page)).find((p) => p.id !== origemId);
    process.stdout.write(`[travessia] KMZ voltou: ${JSON.stringify(Object.keys(voltou.attributes))}\n`);
    expect(voltou.attributes, 'o KMZ perdeu ou mudou atributos').toEqual(ESPERADO);

    await recarregar(page);
    expect((await pontos(page)).find((p) => p.id === voltou.id)?.attributes).toEqual(ESPERADO);
});
