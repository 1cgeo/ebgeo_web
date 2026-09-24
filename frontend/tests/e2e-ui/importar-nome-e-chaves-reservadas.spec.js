// Path: e2e-ui/importar-nome-e-chaves-reservadas.spec.js

/**
 * THE FILE'S NAME AND ITS RESERVED COLUMNS SURVIVE THE IMPORT, and the KMZ round trip, in real
 * Chromium, through the real doors (a file dropped on the map; the KMZ option of the Exportar tab),
 * read back from the store.
 *
 * WHAT WAS LOST until 2026-09-23 (owner's decision of that night, relayed by the coordinator):
 * `extractAttributesFromImport` skipped every reserved property name, case-insensitively, so the
 * `<name>` of a KML placemark and the `NOME`, `ID` and `TYPE` columns of a DBF vanished without a
 * trace, and every feature was born "Ponto #N". The contract now: the first non-empty name
 * (`nome`/`name`, any casing) is the feature's name, "Ponto #N" only as a fallback; a reserved key
 * no reader consumes is kept as `<key>_importado`.
 *
 * THE ROUND TRIP is the half that a unit test cannot show: the KMZ export writes `<name>`, an
 * ExtendedData `nome` and the attributes; re-importing it must give the same name once (not a
 * `nome_importado` duplicate) and the same attribute keys (no `ID_importado_importado`).
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readState } from './state.js';
import { shpDePontos, dbfDeTexto } from '../helpers/shapefile-sintetico.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const ALVO = [-53.4, -30.0];

async function esperarMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

/** The points of the current map. */
function pontosDoMapa(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f.points || []).map((p) => ({
            nome: p.properties?.nome,
            descricao: p.properties?.descricao ?? '',
            attributes: p.properties?.attributes ?? {},
            layerId: p.properties?.layerId,
        }));
    });
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

/** A shapefile ZIP whose DBF has the three columns every Brazilian source has. */
async function zipComColunasReservadas() {
    const campos = [
        { nome: 'NOME', tamanho: 30 },
        { nome: 'ID', tamanho: 6 },
        { nome: 'TYPE', tamanho: 12 },
        { nome: 'OBS', tamanho: 20 },
    ];
    const zip = new JSZip();
    zip.file('quarteis.shp', shpDePontos([[-43.2, -22.9], [-51.2, -30.0]]));
    zip.file('quarteis.dbf', dbfDeTexto(campos, [
        { NOME: 'Vila Militar', ID: '17', TYPE: 'quartel', OBS: 'sede' },
        { NOME: 'Base Sul', ID: '18', TYPE: 'deposito', OBS: 'apoio' },
    ]));
    return zip.generateAsync({ type: 'nodebuffer' });
}

describeOrSkip('Importar: o nome e as colunas reservadas do arquivo', () => {
    test.describe.configure({ retries: 0 });

    test('KML: o <name> é o nome da feição, a descrição vai para a descrição, ID e TYPE ficam', async ({ page }) => {
        await esperarMapa(page);
        const kml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>'
            + '<name>Base Alfa</name><description>Posto avançado</description>'
            + '<ExtendedData><Data name="ID"><value>17</value></Data>'
            + '<Data name="TYPE"><value>quartel</value></Data></ExtendedData>'
            + '<Point><coordinates>-48.5482,-27.5954</coordinates></Point>'
            + '</Placemark></Document></kml>';
        await soltarNoMapa(page, 'base.kml', B.from(kml, 'utf8'));

        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(1);
        const [p] = await pontosDoMapa(page);
        console.log('[kml]', JSON.stringify(p));
        expect(p.nome).toBe('Base Alfa');
        expect(p.descricao).toContain('Posto avançado');
        expect(p.attributes).toEqual({ ID_importado: '17', TYPE_importado: 'quartel' });
    });

    test('SHP: a coluna NOME é o nome, ID e TYPE ficam com sufixo, OBS fica como está', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'quarteis.zip', await zipComColunasReservadas());

        await expect.poll(async () => (await pontosDoMapa(page)).length, { timeout: 15000 }).toBe(2);
        const pontos = (await pontosDoMapa(page)).sort((a, b) => a.nome.localeCompare(b.nome));
        console.log('[shp]', JSON.stringify(pontos));
        expect(pontos.map((p) => p.nome)).toEqual(['Base Sul', 'Vila Militar']);
        expect(pontos[1].attributes).toEqual({ ID_importado: '17', TYPE_importado: 'quartel', OBS: 'sede' });
    });
});
