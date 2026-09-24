// Path: e2e-ui/importar-em-atlas-remoto-par-recebe.spec.js

/**
 * A FILE IMPORTED INTO A SERVER ATLAS REACHES THE COLLEAGUE FIELD BY FIELD, in two real Chromium
 * browsers against the real backend, through the real door (the file dropped on the author's map).
 *
 * WHY: the other import specs run on a LOCAL atlas, and `browser-import-batch.spec.js` pushes the
 * ops by hand, below the importer. Nothing measured that what the importer PRODUCES (the file's
 * name, the kept reserved columns, the decoded accents, the description, a layer per shapefile)
 * survives the sync and arrives the same at the peer. The file carries everything the fixes of
 * 2026-09-23 touched: an ISO-8859-1 KML with a name, a CDATA description, an `ID` column and a
 * style; and a ZIP with two shapefiles (two layers).
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readState } from './state.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';
import { shpDePontos, dbfDeTexto } from '../helpers/shapefile-sintetico.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
const ALVO = [-53.4, -30.0];

async function soltaArmada(page) {
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

function pontos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const camadas = new Set((await store.getLayers()).map((l) => l.id));
        return (f.points || []).map((p) => ({
            id: p.properties?.id,
            nome: p.properties?.nome,
            descricao: p.properties?.descricao ?? '',
            attributes: p.properties?.attributes ?? {},
            layerId: p.properties?.layerId,
            camadaExiste: camadas.has(p.properties?.layerId),
        }));
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

describeOrSkip('Importar num atlas de servidor: o colega recebe igual', () => {
    test.describe.configure({ retries: 0 });

    test('KML ISO-8859-1 e ZIP com dois shapefiles chegam ao par campo a campo', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const autor = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA, { expectMapName: seed.mapName });
        const par = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB, { expectMapName: seed.mapName });
        await soltaArmada(autor);
        await soltaArmada(par);

        const kml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n'
            + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            + '<Style id="s"><IconStyle><scale>1.1</scale></IconStyle></Style><Placemark>'
            + '<name>Posto São José</name><description><![CDATA[Área de reunião]]></description>'
            + '<styleUrl>#s</styleUrl><ExtendedData><Data name="ID"><value>41</value></Data>'
            + '<Data name="município"><value>Florianópolis</value></Data></ExtendedData>'
            + '<Point><coordinates>-48.5482,-27.5954</coordinates></Point></Placemark></Document></kml>';
        await soltarNoMapa(autor, 'posto.kml', B.from(kml, 'latin1'));

        const campos = [{ nome: 'SIGLA', tamanho: 20 }];
        const zip = new JSZip();
        zip.file('cidades.shp', shpDePontos([[-47.88, -15.79]]));
        zip.file('cidades.dbf', dbfDeTexto(campos, [{ SIGLA: 'Brasília' }], { codificacao: 'latin1' }));
        zip.file('quarteis.shp', shpDePontos([[-43.2, -22.9]]));
        zip.file('quarteis.dbf', dbfDeTexto(campos, [{ SIGLA: 'Vila Militar' }]));
        await soltarNoMapa(autor, 'temas.zip', await zip.generateAsync({ type: 'nodebuffer' }));

        await expect.poll(async () => (await pontos(autor)).length, { timeout: 20000 }).toBe(3);
        const doAutor = await pontos(autor);
        const posto = doAutor.find((p) => p.nome === 'Posto São José');
        expect(posto, JSON.stringify(doAutor)).toBeTruthy();
        expect(posto.descricao).toContain('Área de reunião');
        expect(posto.attributes).toEqual({ ID_importado: '41', 'município': 'Florianópolis' });
        expect(new Set(doAutor.map((p) => p.layerId)).size).toBe(3);

        // The PEER: the same three points, the same fields, each in a layer the peer knows.
        await expect.poll(async () => (await pontos(par)).length, { timeout: 30000 }).toBe(3);
        const doPar = await pontos(par);
        console.log('[par]', JSON.stringify(doPar));
        for (const antes of doAutor) {
            const depois = doPar.find((p) => p.id === antes.id);
            expect(depois, `o par não recebeu ${antes.nome}`).toBeTruthy();
            expect(depois.nome).toBe(antes.nome);
            expect(depois.descricao).toBe(antes.descricao);
            expect(depois.attributes).toEqual(antes.attributes);
            expect(depois.layerId).toBe(antes.layerId);
            expect(depois.camadaExiste, `${antes.nome}: camada ausente no par`).toBe(true);
        }

        await autor.context().close();
        await par.context().close();
    });
});
