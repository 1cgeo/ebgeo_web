// Path: e2e-ui/visibilidade-nas-saidas.repro.spec.js

/**
 * REPRO: two exits of the map ignored what the map hides.
 *
 * Hiding is a FILTER (`layers/visibility-filter.js`): the MapLibre sources keep every feature. Two
 * surfaces read the data without going through the filter and disagreed with the sheet:
 *   - the PDF legend (`_collectFeatureStats`, `import_export/pdf-export.tab.js`) counted from the
 *     sources with the temporal window only, so a hidden feature, a feature of a hidden layer and
 *     a member of a hidden group all entered the legend of a sheet that did not draw them;
 *   - the KMZ carried the feature's own `visivel` and the layer's `visible`, and drew the members
 *     of a hidden group as visible, the one shared visibility state it did not read.
 *
 * THE INSTRUMENT. The legend count is the tab's own method, run against the live map (its only
 * `this` needs are the map and the bounds test, given a sheet with no bounds); the KMZ is the
 * export service, whose download is caught and unzipped here. Both are the product's code; what
 * the cases skip is the export panel's clicks, which decide nothing about visibility.
 */

import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { collabTest, expect, drawPointUI, openLayersTab } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });

async function expandir(page) {
    await openLayersTab(page);
    for (const icon of await page.locator('.layer-expand-icon.collapsed, .group-expand-icon.collapsed').all()) {
        await icon.click().catch(() => {});
    }
}

async function renomear(page, id, nome) {
    await page.evaluate(async ([fid, n]) => {
        const store = await import('/src/js/store/index.js');
        await store.updateFeatureProperty('points', fid, 'nome', n);
    }, [id, nome]);
}

/** One visible point, and one hidden by each of the three shared states. */
async function montarOcultas(collab) {
    const A = collab.author;
    const visivel = await drawPointUI(A, [-43.2, -22.9]);
    const propria = await drawPointUI(A, [-43.21, -22.91]);
    const m1 = await drawPointUI(A, [-43.22, -22.92]);
    const m2 = await drawPointUI(A, [-43.23, -22.93]);
    for (const [id, nome] of [[visivel, 'VISIVEL'], [propria, 'OCULTA-PROPRIA'], [m1, 'MEMBRO-1'], [m2, 'MEMBRO-2']]) {
        await renomear(A, id, nome);
    }

    // A propria feicao oculta, pelo olho da arvore.
    await expandir(A);
    await A.locator(`.feature-item[data-feature-id="${propria}"] .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryFeatureRow(propria))?.properties?.visivel, { timeout: 20000 }).toBe(false);

    // O grupo oculto, pelo olho do grupo.
    const gid = await A.evaluate(async (ids) => {
        const { getGroupManager } = await import('/src/js/store/services.js');
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (await getGroupManager().createGroup(f.points.filter((p) => ids.includes(p.properties.id)))).id;
    }, [m1, m2]);
    await expect.poll(async () => Boolean(await collab.db.queryEntityRow('groups', gid)), { timeout: 20000 }).toBe(true);
    await expandir(A);
    await A.locator(`.group-container[data-group-id="${gid}"] .group-header .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('groups', gid))?.visible, { timeout: 20000 }).toBe(false);

    // A camada oculta, com um ponto dentro.
    const oculta = await A.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const l = await store.createLayer('Oculta');
        await store.setActiveLayer(l.id);
        return l.id;
    });
    const naCamada = await drawPointUI(A, [-43.24, -22.94]);
    await renomear(A, naCamada, 'NA-CAMADA-OCULTA');
    await expandir(A);
    await A.locator(`.layer-container[data-layer-id="${oculta}"] .layer-header .visibility-toggle`).first().evaluate((el) => el.click());
    await expect.poll(async () => (await collab.db.queryEntityRow('layers', oculta))?.visible, { timeout: 20000 }).toBe(false);

    await A.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-43.22, -22.92], zoom: 12 }));
    // Controle do mapa: so o ponto visivel e desenhado.
    await expect.poll(() => A.evaluate((ids) => globalThis.__ebgeoMap.queryRenderedFeatures()
        .map((f) => f.properties?.id).filter((i) => ids.includes(i)), [visivel, propria, m1, m2, naCamada]), { timeout: 15000 })
        .toEqual([visivel]);
    return { A, visivel };
}

collabTest('a legenda do PDF conta so o que a folha desenha', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const { A } = await montarOcultas(collab);
    const stats = await A.evaluate(async () => {
        const { default: PDFExportTab } = await import('/src/js/import_export/pdf-export.tab.js');
        const falso = { map: globalThis.__ebgeoMap, _featureIntersectsBounds: () => true };
        return PDFExportTab.prototype._collectFeatureStats.call(falso, null);
    });
    console.log(`LEGENDA ${JSON.stringify(stats)}`);
    expect(stats.point?.count, 'um ponto desenhado, um ponto na legenda').toBe(1);
});

collabTest('o KMZ leva o membro de grupo oculto como oculto, como a feicao e a camada ocultas', async ({ collab }) => {
    collabTest.setTimeout(240000);
    const { A } = await montarOcultas(collab);
    const mapName = await A.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());
    const [download] = await Promise.all([
        A.waitForEvent('download', { timeout: 60000 }),
        A.evaluate(async (m) => {
            const { exportMapAsKmz } = await import('/src/js/import_export/kmz/kmz-export.service.js');
            return exportMapAsKmz({ mapName: m, options: { includePhotos: false } });
        }, mapName),
    ]);
    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const kml = await zip.file('doc.kml').async('string');
    const placemark = (nome) => {
        const i = kml.indexOf(`<name>${nome}</name>`);
        const inicio = kml.lastIndexOf('<Placemark>', i);
        return kml.slice(inicio, kml.indexOf('</Placemark>', i));
    };
    const oculto = (nome) => placemark(nome).includes('<visibility>0</visibility>');
    console.log(`KMZ ${JSON.stringify({ VISIVEL: oculto('VISIVEL'), PROPRIA: oculto('OCULTA-PROPRIA'), M1: oculto('MEMBRO-1'), M2: oculto('MEMBRO-2') })}`);
    expect(oculto('VISIVEL'), 'controle: o ponto visivel sai visivel').toBe(false);
    expect(oculto('OCULTA-PROPRIA'), 'a feicao oculta sai oculta (ja era assim)').toBe(true);
    expect(oculto('MEMBRO-1'), 'o membro de grupo oculto sai oculto').toBe(true);
    expect(oculto('MEMBRO-2')).toBe(true);
    // A camada oculta ja saia como pasta com visibility 0.
    const pasta = kml.slice(kml.lastIndexOf('<Folder>', kml.indexOf('<name>NA-CAMADA-OCULTA</name>')));
    expect(pasta.slice(0, 200)).toContain('<visibility>0</visibility>');
});
