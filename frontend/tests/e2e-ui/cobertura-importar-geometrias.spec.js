// Path: e2e-ui/cobertura-importar-geometrias.spec.js

/**
 * COVERAGE: every geometry type of every GIS input format, through the real door (a file dropped
 * on the map), read back from the store, in a local atlas and in a server atlas (the colleague
 * receives the same). Part of the 2026-09-24 coverage campaign (import/export).
 *
 * The rule the importer promises (`decomposeMultiGeometry` and `getTargetType`,
 * `import_export/import.control.js`): every Multi* part becomes its own feature, a
 * GeometryCollection is unpacked recursively, a null geometry is skipped, and the properties of the
 * original go to every part. What a unit test cannot show is that all of it reaches the store (and
 * the colleague) with the geometry intact: the hole of a polygon, the altitude of a point.
 *
 * GPX has three shapes (waypoint, route, track), and a track WITH times becomes a moving point
 * (`_convertTimedTracksToMovingPoints`), so it is measured apart.
 */

import { test, expect } from '@playwright/test';
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

/** Every point, line and polygon of the current map. */
function feicoes(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const um = (x) => ({
            id: x.properties?.id,
            nome: x.properties?.nome,
            attributes: x.properties?.attributes ?? {},
            tipo: x.geometry?.type,
            coords: x.geometry?.coordinates,
            trajetoria: x.properties?.trajetoria?.length ?? 0,
            temporalInicio: x.properties?.temporalInicio ?? null,
        });
        return { points: (f.points || []).map(um), lines: (f.lines || []).map(um), polygons: (f.polygons || []).map(um) };
    });
}

async function soltarNoMapa(page, nome, buffer) {
    const n = await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        const evento = new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + pt.x), clientY: Math.round(rect.top + pt.y),
            bubbles: true, cancelable: true,
        });
        container.dispatchEvent(evento);
        return evento.dataTransfer?.files?.length ?? 0;
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
    expect(n, 'the drop carried no file').toBe(1);
}

const QUADRADO = [[-53.6, -30.2], [-53.2, -30.2], [-53.2, -29.8], [-53.6, -29.8], [-53.6, -30.2]];
const BURACO = [[-53.45, -30.05], [-53.35, -30.05], [-53.35, -29.95], [-53.45, -29.95], [-53.45, -30.05]];

/** One feature of each GeoJSON geometry type, each with a distinct accented attribute. */
const TODAS_AS_GEOMETRIAS = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', properties: { nome: 'Ponto 3D', tipo: 'ponto' },
            geometry: { type: 'Point', coordinates: [-53.5, -30.1, 812.5] } },
        { type: 'Feature', properties: { nome: 'Estrada', tipo: 'linha' },
            geometry: { type: 'LineString', coordinates: [[-53.6, -30.3], [-53.3, -30.25], [-53.1, -30.35]] } },
        { type: 'Feature', properties: { nome: 'Mata', tipo: 'polígono com buraco' },
            geometry: { type: 'Polygon', coordinates: [QUADRADO, BURACO] } },
        { type: 'Feature', properties: { nome: 'Postos', tipo: 'multiponto' },
            geometry: { type: 'MultiPoint', coordinates: [[-53.7, -30.4], [-53.65, -30.45]] } },
        { type: 'Feature', properties: { nome: 'Rios', tipo: 'multilinha' },
            geometry: { type: 'MultiLineString', coordinates: [[[-53.9, -30.5], [-53.8, -30.55]], [[-53.9, -30.6], [-53.8, -30.65]]] } },
        { type: 'Feature', properties: { nome: 'Ilhas', tipo: 'multipolígono' },
            geometry: { type: 'MultiPolygon', coordinates: [
                [[[-54.0, -30.7], [-53.95, -30.7], [-53.95, -30.65], [-54.0, -30.7]]],
                [[[-53.9, -30.7], [-53.85, -30.7], [-53.85, -30.65], [-53.9, -30.7]]],
            ] } },
        { type: 'Feature', properties: { nome: 'Coleção', tipo: 'coleção' },
            geometry: { type: 'GeometryCollection', geometries: [
                { type: 'Point', coordinates: [-54.1, -30.8] },
                { type: 'LineString', coordinates: [[-54.1, -30.85], [-54.05, -30.9]] },
            ] } },
        { type: 'Feature', properties: { nome: 'Sem geometria', tipo: 'nula' }, geometry: null },
    ],
};

/** The expected shape, per type: name and the attribute every part must carry. */
function conferirTodasAsGeometrias(f) {
    const porNome = (lista, nome) => lista.filter((x) => x.nome === nome);
    expect(f.points).toHaveLength(4);
    expect(f.lines).toHaveLength(4);
    expect(f.polygons).toHaveLength(3);

    const [p3d] = porNome(f.points, 'Ponto 3D');
    expect(p3d.coords, 'altitude do ponto').toEqual([-53.5, -30.1, 812.5]);
    expect(porNome(f.points, 'Postos').map((p) => p.attributes.tipo)).toEqual(['multiponto', 'multiponto']);
    expect(porNome(f.lines, 'Rios')).toHaveLength(2);
    const [mata] = porNome(f.polygons, 'Mata');
    expect(mata.coords, 'o buraco').toHaveLength(2);
    expect(mata.attributes.tipo).toBe('polígono com buraco');
    expect(porNome(f.polygons, 'Ilhas')).toHaveLength(2);
    expect(porNome(f.points, 'Coleção')).toHaveLength(1);
    expect(porNome(f.lines, 'Coleção')).toHaveLength(1);
    const nomes = [...f.points, ...f.lines, ...f.polygons].map((x) => x.nome);
    expect(nomes).not.toContain('Sem geometria');
}

describeOrSkip('Cobertura: importar cada tipo de geometria', () => {
    test.describe.configure({ retries: 0 });

    test('GeoJSON: todo tipo de geometria chega à store, local', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'todas.geojson', B.from(JSON.stringify(TODAS_AS_GEOMETRIAS), 'utf8'));
        await expect.poll(async () => {
            const f = await feicoes(page);
            return f.points.length + f.lines.length + f.polygons.length;
        }, { timeout: 15000 }).toBe(11);
        const f = await feicoes(page);
        console.log('[geojson]', JSON.stringify({ p: f.points.length, l: f.lines.length, pg: f.polygons.length }));
        conferirTodasAsGeometrias(f);
    });

    test('GPX: waypoint, rota, trilha sem tempo e trilha com tempo (ponto móvel)', async ({ page }) => {
        await esperarMapa(page);
        const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<gpx version="1.1" creator="teste" xmlns="http://www.topografix.com/GPX/1/1">'
            + '<wpt lat="-30.1" lon="-53.5"><ele>120</ele><name>Posto São João</name><desc>Água potável</desc></wpt>'
            + '<rte><name>Rota Norte</name><rtept lat="-30.2" lon="-53.6"/><rtept lat="-30.25" lon="-53.55"/></rte>'
            + '<trk><name>Trilha a pé</name><trkseg><trkpt lat="-30.3" lon="-53.6"/><trkpt lat="-30.32" lon="-53.58"/></trkseg></trk>'
            + '<trk><name>Viatura 1</name><trkseg>'
            + '<trkpt lat="-30.4" lon="-53.7"><time>2026-09-01T10:00:00Z</time></trkpt>'
            + '<trkpt lat="-30.41" lon="-53.69"><time>2026-09-01T10:05:00Z</time></trkpt>'
            + '<trkpt lat="-30.42" lon="-53.68"><time>2026-09-01T10:10:00Z</time></trkpt>'
            + '</trkseg></trk></gpx>';
        await soltarNoMapa(page, 'campo.gpx', B.from(gpx, 'utf8'));
        await expect.poll(async () => {
            const f = await feicoes(page);
            return f.points.length + f.lines.length;
        }, { timeout: 15000 }).toBe(4);
        const f = await feicoes(page);
        console.log('[gpx]', JSON.stringify(f));
        const wpt = f.points.find((p) => p.nome === 'Posto São João');
        expect(wpt, 'o waypoint com o nome do arquivo').toBeTruthy();
        expect(f.lines.map((l) => l.nome).sort()).toEqual(['Rota Norte', 'Trilha a pé']);
        const movel = f.points.find((p) => p.nome === 'Viatura 1');
        expect(movel, 'a trilha com tempo virou ponto móvel').toBeTruthy();
        expect(movel.trajetoria).toBeGreaterThanOrEqual(2);
        expect(movel.temporalInicio).toBe(Date.parse('2026-09-01T10:00:00Z'));
    });

    test('7z e RAR são recusados dizendo o que fazer, sem criar camada', async ({ page }) => {
        await esperarMapa(page);
        const camadasAntes = await page.evaluate(async () => (await (await import('/src/js/store/index.js')).getLayers()).length);
        for (const nome of ['dados.7z', 'dados.rar']) {
            await soltarNoMapa(page, nome, B.from('PK-não-é-zip', 'utf8'));
            await expect(page.locator('.toast', { hasText: 'Extraia os arquivos e recompacte como .zip' }).first())
                .toBeVisible({ timeout: 10000 });
        }
        const camadasDepois = await page.evaluate(async () => (await (await import('/src/js/store/index.js')).getLayers()).length);
        expect(camadasDepois).toBe(camadasAntes);
    });

    test('GeoJSON num atlas de servidor: o colega recebe todos os tipos iguais', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const autor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        const par = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB, { expectMapName: seed.mapName });
        await esperarMapa(autor, { navegar: false });
        await esperarMapa(par, { navegar: false });

        await soltarNoMapa(autor, 'todas.geojson', B.from(JSON.stringify(TODAS_AS_GEOMETRIAS), 'utf8'));
        const total = async (p) => { const f = await feicoes(p); return f.points.length + f.lines.length + f.polygons.length; };
        await expect.poll(() => total(autor), { timeout: 20000 }).toBe(11);
        await expect.poll(() => total(par), { timeout: 30000 }).toBe(11);
        const doAutor = await feicoes(autor);
        const doPar = await feicoes(par);
        conferirTodasAsGeometrias(doPar);
        for (const tipo of ['points', 'lines', 'polygons']) {
            for (const x of doAutor[tipo]) {
                const y = doPar[tipo].find((z) => z.id === x.id);
                expect(y, `${tipo} ${x.nome} no par`).toBeTruthy();
                expect(y.coords, `${tipo} ${x.nome}: geometria`).toEqual(x.coords);
                expect(y.attributes, `${tipo} ${x.nome}: atributos`).toEqual(x.attributes);
            }
        }
        await autor.context().close();
        await par.context().close();
    });
});
