// Path: tests/unit/carimbo-de-bitmap-na-fonte.test.js

/**
 * @fileoverview O QUE É DESENHADO E O QUE É GUARDADO TÊM DE DESCREVER O MESMO BITMAP.
 *
 * `stampRegeneratedBitmap` (`military_tools/bitmap-stamp.js`) é o que os dois controles de
 * símbolo chamam depois de reassar o PNG. Ele escreve em três lugares, e os três precisam
 * dizer a mesma coisa: a feição em mãos (`applyGeneratedBitmap`), a fonte viva do MapLibre
 * (`generatedBitmapPatch`, pelo despachante de diff) e o documento guardado
 * (`stampGeneratedBitmap`, sem op de saída).
 *
 * DUAS PROPRIEDADES SÃO O ARQUIVO INTEIRO:
 *
 *   1. A escrita na fonte é PELO DESPACHANTE. Um `setData` cru emitido com um diff na fila
 *      substitui o slot de atualização pendente do MapLibre e o diff some sem erro nenhum.
 *      O despachante aqui é o de VERDADE, sobre uma fonte falsa que registra o diff recebido,
 *      então o teste vê a forma que chega ao MapLibre, não a intenção de quem a montou.
 *   2. O deslocamento AUSENTE viaja como `removeProperties`, não como `[0, 0]`. É o mesmo
 *      contrato de `applyGeneratedBitmap`, e é o que faz a op de um par v1 (que não traz
 *      `iconOffset`) desenhar exato em vez de herdar o deslocamento de outra feição.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { carimbosNoStore } = vi.hoisted(() => ({ carimbosNoStore: [] }));

vi.mock('../../src/js/store', () => ({
    stampGeneratedBitmap: async (feature, result) => {
        carimbosNoStore.push({ id: feature.properties.id, result });
        return true;
    },
}));

import { stampRegeneratedBitmap } from '../../src/js/military_tools/bitmap-stamp.js';
import { getGeoJsonDispatcher, destroyGeoJsonDispatchers } from '../../src/js/layers/geojson-dispatcher.js';
import { SYMBOL_BITMAP_VERSION } from '../../src/js/layers/bitmap-version.js';

/** Mapa falso: guarda o diff que cada `updateData` recebeu, sem aplicá-lo. */
function mapaFalso({ comFonte = true } = {}) {
    const sources = new Map();
    const ouvintes = new Map();
    const map = {
        diffs: [],
        colecoesInteiras: 0,
        getSource: (id) => sources.get(id) || null,
        removeSource: (id) => sources.delete(id),
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        sinalizar(id) {
            queueMicrotask(() => {
                for (const fn of ouvintes.get('sourcedata') || []) fn({ sourceId: id, isSourceLoaded: true, dataType: 'source' });
                for (const fn of ouvintes.get('idle') || []) fn({});
            });
        },
    };
    if (comFonte) {
        sources.set('military_symbols', {
            _dados: { type: 'FeatureCollection', features: [] },
            setData(fc) { this._dados = fc; map.colecoesInteiras += 1; map.sinalizar('military_symbols'); },
            updateData(diff) { map.diffs.push(diff); map.sinalizar('military_symbols'); },
        });
    }
    return map;
}

const feicao = () => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-47, -15] },
    properties: { id: 'sim-1', source: 'military_symbol', width: 100, height: 100 },
});

/** O despachante da fonte de símbolos, como os controles o pegam: por id literal. */
const despachanteDe = (map) => getGeoJsonDispatcher(map, 'military_symbols');

/** O único patch do único diff emitido. */
const patchUnico = (map) => {
    expect(map.diffs).toHaveLength(1);
    expect(map.diffs[0].update).toHaveLength(1);
    return map.diffs[0].update[0];
};

/** As propriedades postas, como objeto. */
const postas = (patch) => Object.fromEntries(patch.addOrUpdateProperties.map((p) => [p.key, p.value]));

beforeEach(() => {
    carimbosNoStore.length = 0;
});

describe('stampRegeneratedBitmap', () => {
    it('a fonte recebe `setProps` e `unsetProps` de `generatedBitmapPatch`, por updateData', async () => {
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);
        const f = feicao();

        await stampRegeneratedBitmap(despachanteDe(map), f, {
            blob: {}, width: 42, height: 30, pixelRatio: 2, anchor: 'bottom', iconOffset: [0, -12],
        });

        const patch = patchUnico(map);
        expect(patch.id).toBe('sim-1');
        expect(postas(patch)).toEqual({
            width: 42,
            height: 30,
            pixelRatio: 2,
            anchor: 'bottom',
            iconOffset: [0, -12],
            bitmapVersion: SYMBOL_BITMAP_VERSION,
        });
        expect(patch.removeProperties).toBeUndefined();
        // Nunca a coleção inteira: é o `setData` cru que perde o lote pendente.
        expect(map.colecoesInteiras).toBe(0);
    });

    it('sem deslocamento, `iconOffset` viaja como REMOÇÃO e não como [0, 0]', async () => {
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);

        await stampRegeneratedBitmap(despachanteDe(map), feicao(), { blob: {}, width: 42, height: 30 });

        const patch = patchUnico(map);
        expect(patch.removeProperties).toEqual(['iconOffset']);
        expect(postas(patch)).not.toHaveProperty('iconOffset');
    });

    it('deslocamento [0, 0] é o mesmo caso: remoção, nunca chave zerada', async () => {
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);

        await stampRegeneratedBitmap(despachanteDe(map), feicao(), {
            blob: {}, width: 42, height: 30, iconOffset: [0, 0],
        });

        expect(patchUnico(map).removeProperties).toEqual(['iconOffset']);
    });

    it('a feição EM MÃOS é carimbada, que é o que a montagem de camadas do boot escreve', async () => {
        // No boot `setImages` roda ANTES de a fonte existir, e a coleção que
        // `setupMilitarySymbolsLayers` escreve logo depois é esta mesma. Sem a mutação aqui,
        // o desenho do boot sairia com os números do bitmap velho.
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);
        const f = feicao();

        await stampRegeneratedBitmap(despachanteDe(map), f, {
            blob: {}, width: 42, height: 30, iconOffset: [0, -12],
        });

        expect(f.properties).toMatchObject({
            width: 42, height: 30, iconOffset: [0, -12], bitmapVersion: SYMBOL_BITMAP_VERSION,
        });
    });

    it('o documento guardado é carimbado pelo caminho silencioso do store', async () => {
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);

        await stampRegeneratedBitmap(despachanteDe(map), feicao(), { blob: {}, width: 42, height: 30 });

        expect(carimbosNoStore).toHaveLength(1);
        expect(carimbosNoStore[0].id).toBe('sim-1');
        expect(carimbosNoStore[0].result).toMatchObject({ width: 42, height: 30 });
    });

    it('fonte ainda inexistente (a carga do boot) não perde o carimbo: a feição e o store ficam certos', async () => {
        const map = mapaFalso({ comFonte: false });
        destroyGeoJsonDispatchers(map);
        const f = feicao();

        await stampRegeneratedBitmap(despachanteDe(map), f, { blob: {}, width: 42, height: 30 });

        expect(map.diffs).toEqual([]);
        expect(f.properties.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);
        expect(carimbosNoStore).toHaveLength(1);
    });

    it('sem despachante, sem id ou sem resultado não escreve em lugar nenhum', async () => {
        const map = mapaFalso();
        destroyGeoJsonDispatchers(map);

        await stampRegeneratedBitmap(null, feicao(), { width: 1, height: 1 });
        await stampRegeneratedBitmap(despachanteDe(map), { properties: {} }, { width: 1, height: 1 });
        await stampRegeneratedBitmap(despachanteDe(map), feicao(), null);

        expect(map.diffs).toEqual([]);
        expect(carimbosNoStore).toEqual([]);
    });
});
