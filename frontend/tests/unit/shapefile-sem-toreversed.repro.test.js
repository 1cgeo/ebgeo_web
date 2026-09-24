// Path: tests/unit/shapefile-sem-toreversed.repro.test.js

/**
 * @fileoverview IMPORTAR SHAPEFILE MORRIA NO CHROME E NO EDGE 105 A 109, e o 109 é o último do
 * Windows 7 e 8.1.
 *
 * O DEFEITO. `shpjs` 6.2.0 chama `Array.prototype.toReversed` (ES2023: Chrome e Edge 110, Firefox
 * 115) na segunda passada de `handleRings` (`shpjs/lib/parseShp.js`), a que roda quando um
 * polígono com furo vem na orientação não-ESRI. O `@vitejs/plugin-legacy` (`vite.config.js`) serve
 * o pacote MODERNO, sem polyfill nenhum (`modernPolyfills: false`), a todo navegador com
 * `import.meta.resolve`, e o Chrome 105 a 109 entra nessa faixa sem ter o método. A importação
 * terminava no aviso "Não foi possível importar o arquivo: Erro ao processar Shapefile:
 * o.ring.toReversed is not a function", com zero feição. Medido no pacote de produção com a
 * superfície JS do Chrome 109 simulada; Chromium e Firefox atuais importam.
 *
 * O CONSERTO mora no ponto único do pacote, `frontend/src/js/vendor/shpjs.js`, que define o método
 * só quando ele falta e reexporta a biblioteca.
 *
 * O PRIMEIRO CASO É O CONTROLE DO INSTRUMENTO: a fixture tem de reprovar no `shpjs` cru sem o
 * método, senão ela não passa pela linha do defeito e o verde do segundo não prova nada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHoleShapefileZip, FEATURE_NAME, HOLE_RING } from '../helpers/shapefile-fixture.js';

const native = Object.getOwnPropertyDescriptor(Array.prototype, 'toReversed');

beforeEach(() => {
    vi.resetModules();
    delete Array.prototype.toReversed;
});

afterEach(() => {
    delete Array.prototype.toReversed;
    // eslint-disable-next-line no-extend-native -- puts back the native descriptor this file removed
    if (native) Object.defineProperty(Array.prototype, 'toReversed', native);
});

describe('shapefile com furo na orientação não-ESRI, num navegador sem toReversed', () => {
    it('CONTROLE: o shpjs cru reprova, então a fixture passa pela linha do defeito', async () => {
        const { default: shp } = await import('shpjs');
        const zip = await buildHoleShapefileZip();
        await expect(shp(zip)).rejects.toThrow(/toReversed/);
    });

    it('pelo ponto único, o polígono chega inteiro, com o furo e o atributo', async () => {
        const { default: shp } = await import('@js/vendor/shpjs.js');
        const zip = await buildHoleShapefileZip();
        const result = await shp(zip);
        const feature = (Array.isArray(result) ? result[0] : result).features[0];
        expect(feature.geometry.type).toBe('Polygon');
        expect(feature.geometry.coordinates).toHaveLength(2);
        // O furo, com os mesmos vértices da fixture em qualquer sentido de giro.
        const hole = feature.geometry.coordinates[1].map(([x, y]) => `${x},${y}`).sort();
        expect(hole).toEqual(HOLE_RING.map(([x, y]) => `${x},${y}`).sort());
        expect(feature.properties.NOME).toBe(FEATURE_NAME);
    });

    it('o método definido tem a forma do nativo: não enumerável, cópia invertida, original intacto', async () => {
        await import('@js/vendor/shpjs.js');
        const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toReversed');
        expect(descriptor.enumerable).toBe(false);
        expect(descriptor.writable).toBe(true);
        expect(descriptor.configurable).toBe(true);
        const original = [1, 2, 3];
        expect(original.toReversed()).toEqual([3, 2, 1]);
        expect(original).toEqual([1, 2, 3]);
        expect([].toReversed()).toEqual([]);
        // Buraco vira undefined, como no nativo (a leitura é por Get, e o resultado é denso).
        // eslint-disable-next-line no-sparse-arrays
        const sparse = [1, , 3].toReversed();
        expect(sparse).toHaveLength(3);
        expect(1 in sparse).toBe(true);
        expect(sparse[1]).toBeUndefined();
        // Semelhante a array também serve, como no nativo.
        expect(Array.prototype.toReversed.call({ length: 2, 0: 'a', 1: 'b' })).toEqual(['b', 'a']);
    });

    it('onde o método já existe, o ponto único não o troca', async () => {
        const proprio = function toReversed() { return 'nativo'; };
        // eslint-disable-next-line no-extend-native -- stands in for a browser that ships the method
        Object.defineProperty(Array.prototype, 'toReversed', { value: proprio, writable: true, configurable: true });
        await import('@js/vendor/shpjs.js');
        expect(Array.prototype.toReversed).toBe(proprio);
    });
});
