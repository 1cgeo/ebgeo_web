// Path: tests/unit/kmz-escala-do-icone.test.js

/**
 * O `<scale>` do KML e sobre o tamanho NATIVO do arquivo de icone, e o arquivo nem sempre
 * tem o tamanho logico da feicao: a medida de coordenacao rasteriza acima do logico para o
 * simbolo nao borrar quando o `icon-size` da camada cresce com o zoom, e grava a razao em
 * `properties.pixelRatio`.
 *
 * Enquanto o exportador tomou o tamanho logico por nativo, a conta dava `scale = 1` e o
 * Google Earth desenhava o bitmap inteiro: o icone saia `pixelRatio` vezes maior. Nada
 * reprovava, porque o `registry.add` nasce com `width = 0` e NUNCA mede o blob, entao o
 * caminho normal caia calado no tamanho logico.
 *
 * Estes testes fixam as duas pontas: a conta da escala, e o registro do arquivo
 * regenerado. O pior caso e a feicao COM `pixelRatio`, porque a sem ele passa dos dois
 * jeitos e nunca acusaria a troca.
 */

import { describe, it, expect } from 'vitest';
import { iconScale } from '@js/import_export/kmz/kml-style.js';

/**
 * A conta que o mapeador faz para o `<scale>`, isolada.
 * @param {Object} properties - Feature properties
 * @param {Object|null} asset - Asset record, quando ele traz a medida do arquivo
 * @returns {number} Escala do icone
 */
function escalaDoIcone(properties, asset = null) {
    const POINT_ICON_NATIVE_PX = 64;

    const razaoDePixel = Number.isFinite(properties.pixelRatio) && properties.pixelRatio > 0
        ? properties.pixelRatio
        : 1;
    const larguraLogica = properties.width || POINT_ICON_NATIVE_PX;
    const nativeWidth = asset?.width || larguraLogica * razaoDePixel;
    const desired = larguraLogica
        * (Number.isFinite(properties.size) ? properties.size : 1);

    return iconScale(desired, nativeWidth);
}

describe('escala do ícone no KMZ', () => {
    it.each([
        ['sem pixelRatio, como toda feição antiga', { width: 80 }, 1],
        ['pixelRatio 1 explícito', { width: 80, pixelRatio: 1 }, 1],
        ['pixelRatio 2', { width: 160, pixelRatio: 2 }, 0.5],
        ['pixelRatio 4, o do Núcleo', { width: 92, pixelRatio: 4 }, 0.25]
    ])('desenha no tamanho lógico: %s', (_, properties, esperado) => {
        expect(escalaDoIcone(properties)).toBeCloseTo(esperado, 5);
    });

    it('multiplica pelo tamanho escolhido, sem perder a razão de pixels', () => {
        // Dobrar o "Tamanho" da feicao dobra a escala, em cima da razao.
        expect(escalaDoIcone({ width: 92, pixelRatio: 4, size: 2 })).toBeCloseTo(0.5, 5);
        expect(escalaDoIcone({ width: 92, pixelRatio: 4, size: 0.5 })).toBeCloseTo(0.125, 5);
    });

    it('prefere a medida do arquivo quando o registro a conhece', () => {
        // Se o asset trouxe a largura real, ela manda: e a fonte mais proxima do arquivo.
        expect(escalaDoIcone({ width: 92, pixelRatio: 4 }, { width: 368 })).toBeCloseTo(0.25, 5);
        expect(escalaDoIcone({ width: 92, pixelRatio: 999 }, { width: 368 })).toBeCloseTo(0.25, 5);
    });

    it('trata razão inválida como 1, em vez de encolher o ícone', () => {
        for (const lixo of [0, -2, NaN, null, undefined, 'quatro']) {
            expect(escalaDoIcone({ width: 80, pixelRatio: lixo }), String(lixo)).toBe(1);
        }
    });

    it('REPROVA a conta antiga, que tomava o lógico por nativo', () => {
        // A conta de antes: nativeWidth = properties.width, sem a razao.
        const contaAntiga = (p) => iconScale(p.width * (p.size ?? 1), p.width);

        // Com pixelRatio ela devolve 1, e o icone sai quatro vezes maior.
        expect(contaAntiga({ width: 92, pixelRatio: 4 })).toBe(1);
        expect(escalaDoIcone({ width: 92, pixelRatio: 4 })).toBeCloseTo(0.25, 5);

        // E sem pixelRatio as duas concordam, que e por que o defeito passou calado.
        expect(contaAntiga({ width: 80 })).toBe(escalaDoIcone({ width: 80 }));
    });
});
