/**
 * @fileoverview F-store-eventos-6, opcao (a).
 *
 * Dragging the layer opacity slider called setLayerOpacity once per animation
 * frame. Each call emitted LAYERS_CHANGED (waking 9 listeners, one of which
 * reads a whole map document per map of the atlas) and wrote one operation to
 * the IndexedDB sync queue. The live feedback now goes straight to the map paint
 * properties and the store is written once, at the end of the gesture.
 *
 * Worst case the ruler must reject: 120 frames of drag (2 seconds at 60 fps).
 * The store must see zero writes during the drag, and the commit that follows
 * must not repaint what the preview already painted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { layersState } = vi.hoisted(() => ({ layersState: { value: [] } }));

vi.mock('../../src/js/store/index.js', () => ({
    getLayers: () => layersState.value
}));

vi.mock('../../src/js/layers/layer.constants.js', () => ({
    FEATURE_LAYER_IDS: ['point-layer', 'line-layer', 'polygon-fill-layer']
}));

const { applyLayerOpacities, previewLayerOpacity, invalidateOpacityCache } =
    await import('../../src/js/layers/layer-opacity-applier.js');

/**
 * Fake MapLibre map that records every paint write.
 * @returns {Object} Fake map with a `paintCalls` log
 */
function makeFakeMap() {
    const types = {
        'point-layer': 'circle',
        'line-layer': 'line',
        'polygon-fill-layer': 'fill'
    };
    return {
        paintCalls: [],
        getLayer(id) {
            return types[id] ? { id, type: types[id] } : null;
        },
        getPaintProperty(id, prop) {
            if (prop.endsWith('-opacity')) return ['get', 'opacity'];
            return undefined;
        },
        setPaintProperty(id, prop, value) {
            this.paintCalls.push({ id, prop, value });
        }
    };
}

describe('previewLayerOpacity: feedback por quadro sem passar pelo store', () => {
    let map;

    beforeEach(() => {
        invalidateOpacityCache();
        layersState.value = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 1 }
        ];
        map = makeFakeMap();
        applyLayerOpacities(map);
        map.paintCalls = [];
    });

    it('aplica a opacidade nova no mapa sem tocar na lista de camadas do store', () => {
        const aplicou = previewLayerOpacity('camada-2', 0.4);

        expect(aplicou).toBe(true);
        expect(map.paintCalls.length).toBeGreaterThan(0);
        // The store list is untouched: the preview only rebuilt the expression
        expect(layersState.value.find(l => l.id === 'camada-2').opacity).toBe(1);

        const match = map.paintCalls[0].value[2];
        expect(match[match.indexOf('camada-2') + 1]).toBe(0.4);
    });

    it('120 quadros de arrasto nao escrevem nada na lista de camadas', () => {
        for (let frame = 0; frame < 120; frame++) {
            previewLayerOpacity('camada-2', 1 - frame / 200);
        }

        expect(layersState.value.find(l => l.id === 'camada-2').opacity).toBe(1);
        expect(map.paintCalls.length).toBeGreaterThan(0);
    });

    it('a gravacao unica no fim do gesto nao repinta o que o preview ja pintou', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.paintCalls.length;

        // End of gesture: the store finally receives the value and emits
        // LAYERS_CHANGED, which calls applyLayerOpacities
        layersState.value = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 0.4 }
        ];
        applyLayerOpacities(map);

        expect(map.paintCalls.length).toBe(pintadasNoPreview);
    });

    it('um valor diferente do preview repinta, para o preview nunca ficar preso', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.paintCalls.length;

        // The gesture never committed: the next real layer change wins
        layersState.value = [
            { id: 'default', opacity: 1 },
            { id: 'camada-2', opacity: 1 }
        ];
        applyLayerOpacities(map);

        expect(map.paintCalls.length).toBeGreaterThan(pintadasNoPreview);
    });

    it('quadro repetido com o mesmo valor nao repinta', () => {
        previewLayerOpacity('camada-2', 0.4);
        const pintadasNoPreview = map.paintCalls.length;

        previewLayerOpacity('camada-2', 0.4);

        expect(map.paintCalls.length).toBe(pintadasNoPreview);
    });

    it('sem mapa conhecido devolve false, para o chamador cair no store', async () => {
        vi.resetModules();
        const modulo = await import('../../src/js/layers/layer-opacity-applier.js');

        expect(modulo.previewLayerOpacity('camada-2', 0.4)).toBe(false);
    });
});
