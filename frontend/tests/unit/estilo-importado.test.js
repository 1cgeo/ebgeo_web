// Path: tests/unit/estilo-importado.test.js

/**
 * The style half of the KMZ round trip (`src/js/import_export/estilo-importado.js`): what the
 * export writes, what the import restores, and what it throws away from a foreign KML. The browser
 * proof is `tests/e2e-ui/kmz-ida-e-volta-campo-a-campo.spec.js`.
 */

import { describe, it, expect } from 'vitest';
import {
    CHAVE_DO_ESTILO,
    CHAVES_DE_ESTILO_DO_KML,
    estiloParaExportar,
    separarEstiloImportado,
    aplicarEstiloImportado,
    limparEstiloDoKml,
} from '../../src/js/import_export/estilo-importado.js';

const PADROES_DO_PONTO = {
    fillColor: '#3f4fb5', size: 10, opacity: 1, showLabel: false, labelText: '', visivel: true,
    source: 'point', nome: '', sizeCreatedAtZoom: 0, calculatedSize: 10, selectionBox: null,
};

describe('estiloParaExportar', () => {
    it('writes the style, never identity, content, geometry or zoom bookkeeping', () => {
        const json = estiloParaExportar({
            id: 'x', nome: 'PC', descricao: 'd', layerId: 'l', attributes: { a: 1 }, images: [],
            baseCoordinates: [[0, 0]], calculatedSize: 30, sizeCreatedAtZoom: 12,
            fillColor: '#ff0000', size: 18, showLabel: true, labelText: 'R',
        });
        expect(JSON.parse(json)).toEqual({ fillColor: '#ff0000', size: 18, showLabel: true, labelText: 'R' });
    });

    it('skips non-primitive and non-finite values, and answers "" when nothing is left', () => {
        expect(estiloParaExportar({ observations: [1], opacity: NaN, x: Infinity })).toBe('');
        expect(estiloParaExportar({})).toBe('');
        expect(estiloParaExportar(null)).toBe('');
    });
});

describe('separarEstiloImportado', () => {
    it('takes the style out, with the redundant extras and a name that is only the label', () => {
        const props = {
            name: 'Rótulo', nome: 'PC Alfa', OBS: 'sede',
            [CHAVE_DO_ESTILO]: JSON.stringify({ labelText: 'Rótulo', size: 18 }),
            lineStyle: 'dashed', hatchEnabled: 'true', hatchType: 'diagonal',
        };
        const { propriedades, estilo } = separarEstiloImportado(props);
        expect(estilo).toEqual({ labelText: 'Rótulo', size: 18 });
        expect(propriedades).toEqual({ nome: 'PC Alfa', OBS: 'sede' });
        expect(props[CHAVE_DO_ESTILO]).toBeDefined();
    });

    it('CONTROL: with no style entry nothing is consumed, not even a key named like an extra', () => {
        const props = { lineStyle: 'x', name: 'n' };
        expect(separarEstiloImportado(props)).toEqual({ propriedades: props, estilo: null });
    });

    it('a style entry that does not parse consumes nothing', () => {
        for (const ruim of ['{', '[1]', 'null', '42']) {
            const props = { [CHAVE_DO_ESTILO]: ruim, lineStyle: 'x' };
            expect(separarEstiloImportado(props).estilo, ruim).toBeNull();
            expect(separarEstiloImportado(props).propriedades).toBe(props);
        }
    });
});

describe('aplicarEstiloImportado', () => {
    it('restores only keys the tool declares, of the same kind, and never a non-style key', () => {
        const base = { ...PADROES_DO_PONTO };
        aplicarEstiloImportado(base, {
            fillColor: '#ff0000', size: 18, showLabel: true, labelText: 'R', visivel: false,
            lineColor: '#000', size_errado: 1, opacity: 'meio', nome: 'invasor', source: 'polygon',
            calculatedSize: 999, selectionBox: 'x',
        }, PADROES_DO_PONTO);
        expect(base).toEqual({ ...PADROES_DO_PONTO, fillColor: '#ff0000', size: 18, showLabel: true,
            labelText: 'R', visivel: false });
    });

    it('a null style or a non-finite number changes nothing', () => {
        const base = { ...PADROES_DO_PONTO };
        aplicarEstiloImportado(base, null, PADROES_DO_PONTO);
        aplicarEstiloImportado(base, { size: Infinity }, PADROES_DO_PONTO);
        expect(base).toEqual(PADROES_DO_PONTO);
    });

    it('ROUND TRIP: export, separate and apply give back the same style', () => {
        const origem = { ...PADROES_DO_PONTO, fillColor: '#123456', size: 7, visivel: false };
        const { estilo } = separarEstiloImportado({ [CHAVE_DO_ESTILO]: estiloParaExportar(origem), nome: 'x' });
        const volta = aplicarEstiloImportado({ ...PADROES_DO_PONTO }, estilo, PADROES_DO_PONTO);
        for (const chave of ['fillColor', 'size', 'visivel', 'opacity', 'showLabel']) {
            expect(volta[chave], chave).toBe(origem[chave]);
        }
    });
});

describe('limparEstiloDoKml', () => {
    const comEstilo = () => ({
        type: 'FeatureCollection',
        features: [
            { properties: { name: 'A', styleUrl: '#s', icon: 'x.png', 'icon-scale': 1, setor: 'L' } },
            { properties: { name: 'B', stroke: '#f00', icon: 'do usuario' } },
        ],
    });

    it('drops the converter style keys and keeps the data', () => {
        const geo = limparEstiloDoKml(comEstilo(), [new Set(['setor']), new Set()], new Set(['setor']));
        expect(geo.features[0].properties).toEqual({ name: 'A', setor: 'L' });
        expect(geo.features[1].properties).toEqual({ name: 'B' });
    });

    it('a key the placemark declared in its ExtendedData is kept, even named like a style key', () => {
        const geo = limparEstiloDoKml(comEstilo(), [new Set(), new Set(['icon'])], new Set(['icon']));
        expect(geo.features[0].properties).toEqual({ name: 'A', setor: 'L' });
        expect(geo.features[1].properties).toEqual({ name: 'B', icon: 'do usuario' });
    });

    it('when the counts do not match, the document-wide declarations are used for every feature', () => {
        const geo = limparEstiloDoKml(comEstilo(), [new Set()], new Set(['icon']));
        expect(geo.features[0].properties.icon).toBe('x.png');
        expect(geo.features[1].properties.icon).toBe('do usuario');
        expect(geo.features[0].properties.styleUrl).toBeUndefined();
    });

    it('the closed list names the converter keys it exists for', () => {
        for (const chave of ['styleUrl', 'icon-scale', 'label-scale', 'stroke', 'fill-opacity']) {
            expect(CHAVES_DE_ESTILO_DO_KML).toContain(chave);
        }
    });

    it('tolerates what is not a collection', () => {
        expect(limparEstiloDoKml(null)).toBeNull();
        expect(limparEstiloDoKml({ features: [null, { properties: null }] })).toEqual({ features: [null, { properties: null }] });
    });
});
