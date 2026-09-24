// Path: tests/unit/kmz-viewshed-com-preenchimento.repro.test.js

/**
 * REPRO: the KMZ export drew a viewshed as an unfilled outline, which Google Earth paints WHITE.
 *
 * THE CAUSE. The analysis OUTPUT types (`processed_visibility`, `processed_los`) were in none of the
 * sets of `import_export/kmz/kmz-feature-types.js`, so `classifyFeatureType` sent them down its
 * fallback, plain linework: the Placemark of each visible/obstructed MultiPolygon got a `<Style>`
 * with a `<LineStyle>` and no `<PolyStyle>`. A KML polygon without PolyStyle takes the default one
 * (`ffffffff`, fill 1), so in Google Earth the whole fan came out opaque white, and the green and red
 * that ARE the analysis survived only as two-pixel outlines. Measured on 2026-09-24 in real Chromium,
 * exporting map "07 Táticas" of `03-completo-2.4.ebgeo`
 * (`tests/e2e-ui/cobertura-exportar-kmz-tipos.spec.js`).
 *
 * WHY NOTHING SAW IT. The census of the registry (`registro-tipos-cobertura.test.js`) declares this
 * file COMPLETE and its motive said "the processing outputs are explicitly skipped upstream", which
 * was never true: the service skips the two analysis INPUTS (`los`, `visibility`) and exports the
 * outputs. And the guard "classifies every type the store knows about" only asked for SOME valid
 * category, which the fallback always answers. The last block here asks the stronger question.
 *
 * THE COLOUR. The map fills the viewshed from `color` and `opacity`
 * (`layers/styles/tactical.layers.js`, `visibility-visible-layer`), not from `fillColor`, which is
 * what `resolveFill` reads for a drawn polygon: classified as an area but read as a polygon, the fan
 * would come out black (`FALLBACK_COLOR`).
 *
 * THE SAME HOLE, ONE TYPE OVER. Once every polygon Placemark of that export was checked for a
 * PolyStyle, one more came out without it: "Fosso anticarro", a `coordination_line` (MD33 290202)
 * whose geometry is a MultiPolygon of teeth, filled on the map from `color`
 * (`coordination-line-fill-layer`). It is linework by category and keeps that category; what it gains
 * is a PolyStyle whenever its geometry carries a polygon.
 */

import { describe, it, expect } from 'vitest';
import { FEATURE_TYPE_MAPPINGS } from '@js/store/store.constants.js';
import {
    classifyFeatureType,
    FeatureCategory,
    AREA_TYPES,
    LINE_TYPES,
    SYMBOL_TYPES,
    SKIPPED_TYPES,
} from '@js/import_export/kmz/kmz-feature-types.js';
import { StyleRegistry } from '@js/import_export/kmz/kml-document.js';
import { mapFeatureToKml } from '@js/import_export/kmz/kmz-feature-mapper.js';

const assetsStub = { has: () => false, get: () => null, add: () => null };

function leque(sufixo, cor) {
    return {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[[[-54.72, -20.26], [-54.70, -20.26], [-54.70, -20.24], [-54.72, -20.26]]]] },
        properties: {
            id: `2ab39904-e772-4ba8-aa02-5408c68a900e-${sufixo}`, source: 'visibility', nome: 'Leque do PO Bravo',
            color: cor, opacity: 0.5, visivel: true, bloqueado: false, layerId: 'default',
        },
    };
}

async function estiloDe(feature, featureType) {
    const styles = new StyleRegistry();
    const xml = await mapFeatureToKml({ feature, featureType, styles, assets: assetsStub, options: {} });
    const id = /<styleUrl>#([^<]+)</.exec(xml)[1];
    const doc = styles.toXml();
    return { xml, id, doc };
}

describe('KMZ: the viewshed keeps its fill', () => {
    it('the analysis outputs are classified explicitly, the fan as an area', () => {
        expect(classifyFeatureType('processed_visibility')).toBe(FeatureCategory.AREA);
        expect(classifyFeatureType('processed_los')).toBe(FeatureCategory.LINE);
    });

    it('the visible and the obstructed fans carry a PolyStyle in their own colour, half transparent', async () => {
        for (const [sufixo, cor, kml] of [['visible', '#00FF00', '00ff00'], ['obstructed', '#FF0000', '0000ff']]) {
            const { id, doc } = await estiloDe(leque(sufixo, cor), 'processed_visibility');
            const estilo = new RegExp(`<Style id="${id}">([\\s\\S]*?)</Style>`).exec(doc)?.[1] ?? '';
            expect(estilo, `${sufixo}: estilo registrado`).not.toBe('');
            const poly = /<PolyStyle><color>([0-9a-f]{8})<\/color><fill>1<\/fill>/.exec(estilo);
            expect(poly, `${sufixo}: PolyStyle com preenchimento`).not.toBeNull();
            // KML colour is aabbggrr: the channel order is the point, and 0.5 opacity is 7f or 80.
            expect(poly[1].slice(2), `${sufixo}: a cor do mapa`).toBe(kml);
            expect(['7f', '80']).toContain(poly[1].slice(0, 2));
        }
    });

    it('no type the store knows reaches the fallback: each is named in exactly one place', () => {
        const nomeados = new Set(['point', 'text', 'image']);
        for (const s of [AREA_TYPES, LINE_TYPES, SYMBOL_TYPES, SKIPPED_TYPES]) for (const t of s) nomeados.add(t);
        const noFallback = Object.keys(FEATURE_TYPE_MAPPINGS).filter((t) => !nomeados.has(t));
        expect(noFallback).toEqual([]);
    });
});

describe('KMZ: the teeth of a linear coordination symbol keep their fill', () => {
    function linha(geometry) {
        return {
            type: 'Feature', geometry,
            properties: { id: 'd49ef3cc-5d26-4239-900d-e7d442f5c8f1', source: 'coordination_line', nome: 'Fosso anticarro', color: '#5D4037', lineWidth: 4, opacity: 1 },
        };
    }
    const dentes = { type: 'MultiPolygon', coordinates: [[[[-54.55, -20.38], [-54.54, -20.38], [-54.545, -20.37], [-54.55, -20.38]]]] };
    const tracado = { type: 'LineString', coordinates: [[-54.55, -20.38], [-54.49, -20.375]] };

    it('a coordination line with polygons gets a PolyStyle in its colour; one without keeps linework only', async () => {
        const styles = new StyleRegistry();
        const comDentes = await mapFeatureToKml({ feature: linha(dentes), featureType: 'coordination_line', styles, assets: assetsStub, options: { simulateDash: false } });
        const semDentes = await mapFeatureToKml({ feature: linha(tracado), featureType: 'coordination_line', styles, assets: assetsStub, options: { simulateDash: false } });
        const doc = styles.toXml();
        const corpo = (xml) => new RegExp(`<Style id="${/<styleUrl>#([^<]+)</.exec(xml)[1]}">([\\s\\S]*?)</Style>`).exec(doc)?.[1] ?? '';
        const poly =/<PolyStyle><color>([0-9a-f]{8})<\/color><fill>1<\/fill>/.exec(corpo(comDentes));
        expect(poly, 'os dentes têm preenchimento').not.toBeNull();
        // #5D4037 at opacity 1, as aabbggrr.
        expect(poly[1]).toBe('ff37405d');
        expect(corpo(semDentes)).not.toContain('<PolyStyle>');
        expect(classifyFeatureType('coordination_line')).toBe(FeatureCategory.LINE);
    });
});
