// Path: tests/unit/kmz-viewshed-preenchido.repro.test.js
//
// A ANÁLISE DE VISIBILIDADE SAI NO KMZ COM AS CORES DA TELA (2026-09-24, frente cobertura-taticas).
//
// No mapa, a saída de um viewshed são duas multipolígonas preenchidas, verde (visível) e vermelha
// (obstruída), com a opacidade que a pessoa escolheu no painel (`fill-color: ['get', 'color']`,
// `fill-opacity: ['get', 'opacity']`, `layers/styles/tactical.layers.js`). O exportador de KMZ
// classificava o balde `processed_visibility` como LINHA (nenhuma das listas de
// `kmz-feature-types.js` o nomeava, e o padrão é LINHA), então o Placemark saía só com
// `<LineStyle>`, e um Polygon sem `<PolyStyle>` no KML é preenchido com o PADRÃO da especificação:
// branco opaco. No Google Earth a área analisada virava uma mancha branca que escondia o terreno.
// E mesmo como ÁREA a cor não viria: `resolveFill` lê `fillColor`, e a metade carrega `color`.
//
// Ambiente node puro: o mapeador carrega aqui (ver `kmz-exporta-janela-temporal.repro.test.js`) e a
// saída é derivada pela MESMA função que o app usa (`deriveAnalysisOutput`).

import { describe, it, expect } from 'vitest';
import { StyleRegistry } from '@js/import_export/kmz/kml-document.js';
import { mapFeatureToKml } from '@js/import_export/kmz/kmz-feature-mapper.js';
import { deriveAnalysisOutput, ANALYSIS_OUTPUT_COLORS } from '@js/store/analysis-output.js';
import { toKmlColor } from '@js/import_export/kmz/kml-style.js';

const assetsStub = { has: () => true, get: () => ({ href: 'files/x.png', width: 64, height: 64 }), add: () => null };

/** Um quadrado de 0,01° em torno de (lng, lat). */
function celula(lng, lat) {
    const d = 0.005;
    return [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]];
}

/** Um viewshed de quatro células, duas visíveis e duas obstruídas, com opacidade 0,5. */
function viewshed() {
    return {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [celula(-43.2, -22.9), celula(-43.19, -22.9), celula(-43.2, -22.91), celula(-43.19, -22.91)] },
        properties: {
            id: 'vs-1', source: 'visibility', nome: 'Visibilidade 1', opacity: 0.5,
            cellData: [{ isVisible: true }, { isVisible: true }, { isVisible: false }, { isVisible: false }],
        },
    };
}

/** Maps every derived half, and returns each Placemark's XML with the style body it points at. */
async function exportarMetades() {
    const styles = new StyleRegistry();
    const metades = deriveAnalysisOutput('visibility', viewshed());
    expect(metades).toHaveLength(2); // controle: a derivação produziu as duas metades
    const saidas = [];
    for (const metade of metades) {
        const xml = await mapFeatureToKml({ feature: metade, featureType: 'processed_visibility', styles, assets: assetsStub });
        saidas.push({ metade, xml });
    }
    return { saidas, estilos: styles.toXml() };
}

describe('KMZ: a saída do viewshed mantém o preenchimento verde e vermelho', () => {
    it('cada metade sai como polígono com <PolyStyle> da cor e da opacidade dela', async () => {
        const { saidas, estilos } = await exportarMetades();
        for (const { metade, xml } of saidas) {
            expect(xml).toContain('<Polygon>');
            const esperado = toKmlColor(metade.properties.color, 0.5);
            expect(estilos, `PolyStyle ${metade.properties.color}`)
                .toContain(`<PolyStyle><color>${esperado}</color><fill>1</fill>`);
        }
        // As duas cores do app, e não o fallback.
        expect(saidas.map(({ metade }) => metade.properties.color).sort())
            .toEqual([ANALYSIS_OUTPUT_COLORS.visible, ANALYSIS_OUTPUT_COLORS.obstructed].sort());
    });

    it('a linha de visada continua linha, com a cor da metade', async () => {
        const styles = new StyleRegistry();
        const los = {
            type: 'Feature',
            geometry: { type: 'MultiLineString', coordinates: [[[-43.26, -22.9], [-43.2, -22.9]], [[-43.2, -22.9], [-43.14, -22.9]]] },
            properties: { id: 'los-1', source: 'los', nome: 'Visada 1' },
        };
        for (const metade of deriveAnalysisOutput('los', los)) {
            const xml = await mapFeatureToKml({ feature: metade, featureType: 'processed_los', styles, assets: assetsStub });
            expect(xml).toContain('<LineString>');
        }
        const xml = styles.toXml();
        expect(xml).toContain(toKmlColor(ANALYSIS_OUTPUT_COLORS.visible, 1));
        expect(xml).toContain(toKmlColor(ANALYSIS_OUTPUT_COLORS.obstructed, 1));
        expect(xml).not.toContain('<PolyStyle>');
    });
});
