// Path: e2e-ui/kmz-ida-e-volta-campo-a-campo.spec.js

/**
 * OUR KMZ, EXPORTED AND IMPORTED BACK, RETURNS THE SAME FEATURES FIELD BY FIELD, in real Chromium,
 * through the real doors (the KMZ option of the Exportar tab, and the file dropped on the map).
 *
 * WHAT WAS WRONG, measured here on 2026-09-23 before the fix of the same commit:
 *   - every re-imported feature got the description "[object Object]": `@tmcw/togeojson` returns a
 *     CDATA description (our export always writes one) as an object, and the import did
 *     `String(value)`; the real `descricao`, in the ExtendedData, was then dropped;
 *   - every re-imported point got five junk attributes (`styleUrl`, `icon`, `icon-scale`,
 *     `icon-heading`, `label-scale`), the style keys the converter derives from `<Style>`;
 *   - the STYLE did not come back at all: colour, size, width, opacity, label, all reset to the
 *     tool's defaults, because KML cannot say an EBGeo point and the import read no style.
 *
 * The acceptance criterion (coordinator, 2026-09-23): same attributes (none new, none lost), same
 * name, same description, same style. The features are styled AWAY from the defaults first, or a
 * round trip that restores nothing would pass by coincidence.
 *
 * A SECOND CASE is the other half of the same criterion: a Google Earth KML with its own style
 * imports without style junk among the attributes, and its own ExtendedData keys survive, even one
 * named like a style key.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const ALVO = [-53.4, -30.0];

/** The style fields compared, per stored type. */
const CAMPOS_DE_ESTILO = {
    points: ['fillColor', 'lineColor', 'lineWidth', 'size', 'opacity', 'showLabel', 'labelText',
        'labelColor', 'labelSize', 'markerSymbol', 'visivel'],
    lines: ['lineColor', 'lineWidth', 'opacity', 'lineStyle', 'measure', 'visivel'],
    polygons: ['fillColor', 'lineColor', 'lineWidth', 'opacity', 'lineStyle', 'hatchEnabled',
        'hatchType', 'hatchColor', 'hatchSpacing', 'visivel'],
};

async function esperarMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/** Every point, line and polygon of the current map, with the fields compared. */
function feicoesDoMapa(page) {
    return page.evaluate(async (campos) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const out = [];
        for (const tipo of Object.keys(campos)) {
            for (const x of f[tipo] || []) {
                const p = x.properties || {};
                const estilo = Object.fromEntries(campos[tipo].map((c) => [c, p[c]]));
                out.push({ tipo, id: p.id, nome: p.nome, descricao: p.descricao ?? '',
                    attributes: p.attributes ?? {}, layerId: p.layerId, estilo });
            }
        }
        return out;
    }, CAMPOS_DE_ESTILO);
}

async function soltarNoMapa(page, nome, buffer) {
    const r = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        const evento = new DragEvent('drop', {
            dataTransfer: dt,
            clientX: Math.round(rect.left + pt.x),
            clientY: Math.round(rect.top + pt.y),
            bubbles: true,
            cancelable: true,
        });
        container.dispatchEvent(evento);
        return evento.dataTransfer?.files?.length ?? 0;
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
    expect(r, 'the drop carried no file').toBe(1);
}

/** Changes stored properties of the feature named `nome`, through the store (the panel's path). */
function restilizar(page, tipo, nome, mudancas) {
    return page.evaluate(async ({ tipo, nome, mudancas }) => {
        const store = await import('/src/js/store/index.js');
        const f = (await store.getCurrentMapFeatures())[tipo].find((x) => x.properties.nome === nome);
        f.properties = { ...f.properties, ...mudancas };
        await store.updateFeature(tipo, f);
    }, { tipo, nome, mudancas });
}

describeOrSkip('KMZ: ida e volta campo a campo', () => {
    test.describe.configure({ retries: 0 });

    test('exportar e reimportar devolve nome, descrição, atributos e estilo iguais', async ({ page }) => {
        await esperarMapa(page);
        const geo = {
            type: 'FeatureCollection',
            features: [
                { type: 'Feature', properties: { nome: 'PC Alfa', ID: '17', TYPE: 'posto', OBS: 'sede' },
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] } },
                { type: 'Feature', properties: { nome: 'Eixo Bravo', descricao: 'Rota principal\nsegunda linha', CLASSE: 'A' },
                    geometry: { type: 'LineString', coordinates: [[-43.3, -22.8], [-43.1, -22.95]] } },
                { type: 'Feature', properties: { nome: 'Área Charlie', ZONA: 'norte' },
                    geometry: { type: 'Polygon', coordinates: [[[-43.4, -22.7], [-43.3, -22.7], [-43.3, -22.6], [-43.4, -22.7]]] } },
            ],
        };
        await soltarNoMapa(page, 'origem.geojson', B.from(JSON.stringify(geo), 'utf8'));
        await expect.poll(async () => (await feicoesDoMapa(page)).length, { timeout: 15000 }).toBe(3);

        // AWAY from every default, so that restoring nothing cannot pass.
        await restilizar(page, 'points', 'PC Alfa', {
            fillColor: '#d81b60', lineColor: '#ffeb3b', lineWidth: 3, size: 18, opacity: 0.6,
            showLabel: true, labelText: 'Rótulo do PC', labelColor: '#00e5ff', labelSize: 20,
            markerSymbol: 'square', descricao: 'Ponto com descrição',
        });
        await restilizar(page, 'lines', 'Eixo Bravo', {
            lineColor: '#2e7d32', lineWidth: 9, opacity: 0.35, lineStyle: 'dashed', measure: true,
        });
        await restilizar(page, 'polygons', 'Área Charlie', {
            fillColor: '#6a1b9a', lineColor: '#ff6f00', lineWidth: 4, opacity: 0.8,
            hatchEnabled: true, hatchType: 'diagonal', hatchColor: '#123456', hatchSpacing: 12,
        });
        const originais = await feicoesDoMapa(page);
        expect(originais.find((f) => f.nome === 'PC Alfa').estilo.fillColor).toBe('#d81b60');

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('.export-option-btn', { hasText: 'Exportar KMZ' }).click();
        // "Simular linhas tracejadas" STAYS ON, and that is part of the subject since 2026-09-26: it
        // slices the dashed line into its dashes for Google Earth, and the sliced line used to come
        // back as dozens of segments (measured: 156 features for 3). The export now carries the
        // original geometry in the style and the import rebuilds the one feature
        // (`tests/unit/kmz-tracejado-volta-inteiro.repro.test.js`).
        await expect(page.locator('#kmz-simulate-dash')).toBeChecked();
        const baixando = page.waitForEvent('download', { timeout: 30000 });
        await page.locator('.kmz-export-btn').click();
        const bytes = readFileSync(await (await baixando).path());
        expect(bytes.length).toBeGreaterThan(0);

        await soltarNoMapa(page, 'ida-e-volta.kmz', bytes);
        await expect.poll(async () => (await feicoesDoMapa(page)).length, { timeout: 15000 }).toBe(6);
        const idsOriginais = new Set(originais.map((f) => f.id));
        const voltaram = (await feicoesDoMapa(page)).filter((f) => !idsOriginais.has(f.id));
        console.log('[ida e volta]', JSON.stringify(voltaram));
        expect(voltaram).toHaveLength(3);

        for (const antes of originais) {
            const depois = voltaram.find((f) => f.tipo === antes.tipo && f.nome === antes.nome);
            expect(depois, `${antes.tipo} "${antes.nome}" não voltou com o mesmo nome`).toBeTruthy();
            expect(depois.descricao, `${antes.nome}: descrição`).toBe(antes.descricao);
            expect(depois.attributes, `${antes.nome}: atributos`).toEqual(antes.attributes);
            expect(depois.estilo, `${antes.nome}: estilo`).toEqual(antes.estilo);
        }
    });

    test('KML do Google Earth com estilo importa sem lixo de estilo nos atributos', async ({ page }) => {
        await esperarMapa(page);
        const kml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            + '<Style id="s1"><IconStyle><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png</href></Icon></IconStyle>'
            + '<LabelStyle><scale>0.8</scale></LabelStyle><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>'
            + '<Placemark><name>Ponto GE</name><description><![CDATA[<b>Nota</b> do campo]]></description>'
            + '<styleUrl>#s1</styleUrl><ExtendedData><Data name="setor"><value>Leste</value></Data>'
            + '<Data name="icon"><value>valor do usuario</value></Data></ExtendedData>'
            + '<Point><coordinates>-48.5,-27.6</coordinates></Point></Placemark>'
            + '</Document></kml>';
        await soltarNoMapa(page, 'google-earth.kml', B.from(kml, 'utf8'));

        await expect.poll(async () => (await feicoesDoMapa(page)).length, { timeout: 15000 }).toBe(1);
        const [p] = await feicoesDoMapa(page);
        console.log('[google earth]', JSON.stringify(p));
        expect(p.nome).toBe('Ponto GE');
        expect(p.descricao).toContain('Nota');
        expect(p.descricao).not.toContain('[object Object]');
        // Only what the placemark declared as data: `setor`, and its own `icon`, kept.
        expect(p.attributes).toEqual({ setor: 'Leste', icon: 'valor do usuario' });
    });
});
