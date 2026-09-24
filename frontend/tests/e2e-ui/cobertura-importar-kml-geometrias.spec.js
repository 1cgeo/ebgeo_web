// Path: e2e-ui/cobertura-importar-kml-geometrias.spec.js

/**
 * COVERAGE: every KML geometry reaches the store, from a .kml and from a .kmz dropped on the map, in a
 * local atlas and in a server atlas (the colleague receives it). Part of the 2026-09-24 coverage
 * campaign (import/export). The GeoJSON and GPX twin is `cobertura-importar-geometrias.spec.js`.
 *
 * Covered here, in one document: a Point with altitude, a LineString, a Polygon with an
 * `innerBoundaryIs` (the hole), a MultiGeometry of two polygons, a MultiGeometry mixing a point and
 * a line, and a `gx:Track` with times; every Placemark carries an accented `ExtendedData` value that
 * must arrive as the attribute, on every part of a multi-geometry. The KMZ carries the same
 * document plus a point icon under `files/`, which is what a KMZ from Google Earth looks like.
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
const ALVO = [-53.4, -30.0];

async function esperarMapa(page, { navegar = true } = {}) {
    if (navegar) await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

function feicoes(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const um = (x) => ({
            id: x.properties?.id, nome: x.properties?.nome, attributes: x.properties?.attributes ?? {},
            tipo: x.geometry?.type, coords: x.geometry?.coordinates,
            trajetoria: x.properties?.trajetoria?.length ?? 0, temporalInicio: x.properties?.temporalInicio ?? null,
        });
        return { points: (f.points || []).map(um), lines: (f.lines || []).map(um), polygons: (f.polygons || []).map(um) };
    });
}

async function soltarNoMapa(page, nome, buffer) {
    await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        container.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + pt.x), clientY: Math.round(rect.top + pt.y), bubbles: true, cancelable: true,
        }));
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
}

const dado = (v) => `<ExtendedData><Data name="tipo"><value>${v}</value></Data></ExtendedData>`;
const anel = (pts) => `<LinearRing><coordinates>${pts.map((p) => p.join(',')).join(' ')}</coordinates></LinearRing>`;
const QUADRADO = [[-53.6, -30.2], [-53.2, -30.2], [-53.2, -29.8], [-53.6, -29.8], [-53.6, -30.2]];
const BURACO = [[-53.45, -30.05], [-53.35, -30.05], [-53.35, -29.95], [-53.45, -29.95], [-53.45, -30.05]];

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
<Style id="icone"><IconStyle><Icon><href>files/icone.png</href></Icon></IconStyle></Style>
<Placemark><name>Ponto 3D</name><styleUrl>#icone</styleUrl>${dado('ponto')}<Point><coordinates>-53.5,-30.1,812.5</coordinates></Point></Placemark>
<Placemark><name>Estrada</name>${dado('linha')}<LineString><coordinates>-53.6,-30.3 -53.3,-30.25 -53.1,-30.35</coordinates></LineString></Placemark>
<Placemark><name>Mata</name>${dado('polígono com buraco')}<Polygon><outerBoundaryIs>${anel(QUADRADO)}</outerBoundaryIs><innerBoundaryIs>${anel(BURACO)}</innerBoundaryIs></Polygon></Placemark>
<Placemark><name>Ilhas</name>${dado('multipolígono')}<MultiGeometry>
  <Polygon><outerBoundaryIs>${anel([[-54.0, -30.7], [-53.95, -30.7], [-53.95, -30.65], [-54.0, -30.7]])}</outerBoundaryIs></Polygon>
  <Polygon><outerBoundaryIs>${anel([[-53.9, -30.7], [-53.85, -30.7], [-53.85, -30.65], [-53.9, -30.7]])}</outerBoundaryIs></Polygon>
</MultiGeometry></Placemark>
<Placemark><name>Coleção</name>${dado('coleção')}<MultiGeometry><Point><coordinates>-54.1,-30.8</coordinates></Point><LineString><coordinates>-54.1,-30.85 -54.05,-30.9</coordinates></LineString></MultiGeometry></Placemark>
<Placemark><name>Viatura</name>${dado('trilha')}<gx:Track>
  <when>2026-09-24T10:00:00Z</when><when>2026-09-24T10:10:00Z</when><when>2026-09-24T10:20:00Z</when>
  <gx:coord>-53.0 -30.0 0</gx:coord><gx:coord>-52.95 -30.02 0</gx:coord><gx:coord>-52.9 -30.05 0</gx:coord>
</gx:Track></Placemark>
</Document></kml>`;

/** A 1x1 PNG, the icon a Google Earth KMZ carries under `files/`. */
const PNG_1X1 = B.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function kmz() {
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    zip.file('files/icone.png', PNG_1X1);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function conferir(f) {
    const porNome = (lista, nome) => lista.filter((x) => x.nome === nome);
    const [p3d] = porNome(f.points, 'Ponto 3D');
    expect(p3d?.coords, 'o ponto com altitude').toEqual([-53.5, -30.1, 812.5]);
    expect(p3d.attributes.tipo).toBe('ponto');
    expect(porNome(f.lines, 'Estrada')).toHaveLength(1);
    const [mata] = porNome(f.polygons, 'Mata');
    expect(mata?.coords, 'o buraco (innerBoundaryIs)').toHaveLength(2);
    expect(mata.attributes.tipo).toBe('polígono com buraco');
    const ilhas = porNome(f.polygons, 'Ilhas');
    expect(ilhas, 'MultiGeometry de dois polígonos vira dois').toHaveLength(2);
    expect(ilhas.map((x) => x.attributes.tipo)).toEqual(['multipolígono', 'multipolígono']);
    expect(porNome(f.points, 'Coleção'), 'o ponto da coleção').toHaveLength(1);
    expect(porNome(f.lines, 'Coleção'), 'a linha da coleção').toHaveLength(1);
    // The track: it must ARRIVE, as a moving point (trajectory) or at least as its line.
    const trilha = [...porNome(f.points, 'Viatura'), ...porNome(f.lines, 'Viatura')];
    expect(trilha.length, 'a gx:Track chega').toBeGreaterThan(0);
    // Measured: it arrives as ONE moving point, with the three timed keypoints and its start.
    expect(trilha.map((x) => [x.tipo, x.trajetoria, x.temporalInicio])).toEqual([['Point', 3, Date.UTC(2026, 8, 24, 10, 0, 0)]]);
    return trilha;
}

describeOrSkip('Cobertura: importar cada geometria de KML e KMZ', () => {
    test.describe.configure({ retries: 0 });

    for (const [nome, corpo] of [['geometrias.kml', async () => B.from(KML, 'utf8')], ['geometrias.kmz', kmz]]) {
        test(`${nome}: toda geometria chega à store, local`, async ({ page }) => {
            await esperarMapa(page);
            await soltarNoMapa(page, nome, await corpo());
            await expect.poll(async () => { const f = await feicoes(page); return f.points.length + f.lines.length + f.polygons.length; }, { timeout: 20000 })
                .toBeGreaterThanOrEqual(8);
            const f = await feicoes(page);
            console.log(`[${nome}]`, JSON.stringify({ pontos: f.points.map((x) => [x.nome, x.trajetoria]), linhas: f.lines.map((x) => x.nome), poligonos: f.polygons.map((x) => x.nome) }));
            const trilha = conferir(f);
            console.log(`[${nome} trilha]`, JSON.stringify(trilha.map((x) => ({ tipo: x.tipo, trajetoria: x.trajetoria, inicio: x.temporalInicio }))));
        });
    }

    test('KMZ num atlas de servidor: o colega recebe toda geometria igual', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const autor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        const par = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB, { expectMapName: seed.mapName });
        await esperarMapa(autor, { navegar: false });
        await esperarMapa(par, { navegar: false });
        await soltarNoMapa(autor, 'geometrias.kmz', await kmz());
        const total = async (p) => { const f = await feicoes(p); return f.points.length + f.lines.length + f.polygons.length; };
        await expect.poll(() => total(autor), { timeout: 20000 }).toBeGreaterThanOrEqual(8);
        const n = await total(autor);
        await expect.poll(() => total(par), { timeout: 30000 }).toBe(n);
        const doAutor = await feicoes(autor);
        const doPar = await feicoes(par);
        conferir(doPar);
        for (const tipo of ['points', 'lines', 'polygons']) {
            for (const x of doAutor[tipo]) {
                const y = doPar[tipo].find((z) => z.id === x.id);
                expect(y, `${tipo} ${x.nome} no par`).toBeTruthy();
                expect(y.coords, `${tipo} ${x.nome}: geometria`).toEqual(x.coords);
                expect(y.attributes, `${tipo} ${x.nome}: atributos`).toEqual(x.attributes);
                expect(y.trajetoria, `${tipo} ${x.nome}: trajetória`).toBe(x.trajetoria);
            }
        }
        await autor.context().close();
        await par.context().close();
    });
});
