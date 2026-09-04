/**
 * @fileoverview Trocar a projeção com o hillshade visível PRENDE os tiles do
 * `raster-dem` no MapLibre 5.18, e a saída custa dois quadros.
 *
 * O MECANISMO, lido do bundle vendorizado: a troca de projeção marca toda fonte
 * não-raster para recarga, e o `loadTile` do `raster-dem` só finaliza tile que
 * ainda não tem actor ou que está `expired`. Um tile CARREGADO que entra em
 * `reloading` fica nesse estado para sempre, `map.loaded()` fica falso e o `idle`
 * nunca mais dispara. Quem espera o `idle` é a captura de tela.
 *
 * O PIOR CASO QUE ESTA RÉGUA EXISTE PARA PEGAR é esconder e reexibir no MESMO
 * quadro, que foi a primeira tentativa e não funciona: a marca de recarga é
 * processada antes de os tiles serem soltos. Por isso o caso 2 afirma o que
 * aconteceu SINCRONAMENTE depois da chamada, e não só a ordem final.
 */

import { describe, it, expect, vi } from 'vitest';

// O helper é folha de `terrain.control.js`, que arrasta a store; os imports do lado
// da store são dublados para o módulo carregar no ambiente `node`.
vi.mock('../../src/js/store', () => ({ getEventBus: () => ({ on: () => () => {} }) }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({
    getCatalogLayers: async () => [],
    toggleCatalogLayerVisibility: async () => {},
}));
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({ DEFAULT_TERRAIN_EXAGGERATION: 1.5 }));
vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({ currentGlobeProjection: () => true }));

const { setProjectionKeepingHillshade } = await import('../../src/js/terrain/terrain.control.js');

/**
 * Mapa falso cujo evento `render` dispara na macrotarefa seguinte ao
 * `triggerRepaint`, como o MapLibre agenda um quadro.
 * @param {Object} [spec] - `{ hasHillshade, visibility }`
 * @returns {Object} Mapa falso com o log `calls`
 */
function makeMap({ hasHillshade = true, visibility = 'visible' } = {}) {
    const calls = [];
    const listeners = [];
    return {
        calls,
        getLayer: (id) => (hasHillshade && id === 'hillshade' ? { id } : undefined),
        getLayoutProperty: (id, prop) => (prop === 'visibility' ? visibility : undefined),
        setLayoutProperty: (id, prop, value) => { calls.push(`layout:${id}:${prop}=${value}`); visibility = value; },
        setProjection: (p) => { calls.push(`projection:${p.type}`); },
        once: (ev, fn) => { if (ev === 'render') listeners.push(fn); },
        triggerRepaint: () => {
            calls.push('repaint');
            setTimeout(() => { listeners.splice(0).forEach((f) => f()); }, 0);
        },
    };
}

describe('setProjectionKeepingHillshade', () => {
    it('esconde o hillshade, espera um quadro, troca, espera outro, e reexibe', async () => {
        const map = makeMap();
        await setProjectionKeepingHillshade(map, { type: 'mercator' });
        expect(map.calls).toEqual([
            'layout:hillshade:visibility=none',
            'repaint',
            'projection:mercator',
            'repaint',
            'layout:hillshade:visibility=visible',
        ]);
    });

    it('NUNCA troca a projeção no mesmo quadro em que escondeu', async () => {
        const map = makeMap();
        const pending = setProjectionKeepingHillshade(map, { type: 'globe' });
        // Síncrono, logo depois da chamada: só o esconder e o pedido de quadro.
        expect(map.calls).toEqual(['layout:hillshade:visibility=none', 'repaint']);
        await pending;
        expect(map.calls).toContain('projection:globe');
    });

    it('hillshade já escondido fica escondido, e a troca é imediata', async () => {
        const map = makeMap({ visibility: 'none' });
        await setProjectionKeepingHillshade(map, { type: 'globe' });
        expect(map.calls).toEqual(['projection:globe']);
    });

    it('sem camada de hillshade nenhuma, só troca', async () => {
        const map = makeMap({ hasHillshade: false });
        await setProjectionKeepingHillshade(map, { type: 'globe' });
        expect(map.calls).toEqual(['projection:globe']);
    });

    it('camada que some entre os dois quadros não é reexibida, e não lança', async () => {
        const map = makeMap();
        let existe = true;
        map.getLayer = (id) => (existe && id === 'hillshade' ? { id } : undefined);
        const pending = setProjectionKeepingHillshade(map, { type: 'mercator' });
        existe = false;
        await expect(pending).resolves.toBeUndefined();
        expect(map.calls).toEqual([
            'layout:hillshade:visibility=none',
            'repaint',
            'projection:mercator',
            'repaint',
        ]);
    });
});
