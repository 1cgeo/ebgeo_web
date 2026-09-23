// Path: tests/unit/sombreamento-abaixo-do-separador.test.js

/**
 * @fileoverview O sombreamento entra ABAIXO do `analysis-separator` mesmo quando liga antes de os
 * separadores existirem.
 *
 * `switchMap` pinta a base (`switchLayer`, cujo último passo liga o sombreamento) ANTES de
 * `setupMapFeatures` criar os separadores. No primeiro paint depois do boot, com o sombreamento
 * ligado pelo administrador, a referência faltava: a camada ia para o topo da pilha e o console
 * dizia "Separator analysis-separator not found, adding hillshade without reference". O conserto
 * cria os separadores ali mesmo, e isso só é seguro porque `setupLayerSeparators` é idempotente,
 * que é a segunda metade deste arquivo.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/js/store', () => ({ getEventBus: () => null, getControl: () => null }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({
    getCatalogLayers: async () => [],
    toggleCatalogLayerVisibility: async () => {},
}));
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({ DEFAULT_TERRAIN_EXAGGERATION: 1.5 }));
vi.mock('../../src/js/store/atlas-appearance.service.js', () => ({ currentGlobeProjection: () => false }));

const TerrainControl = (await import('../../src/js/terrain/terrain.control.js')).default;
const { setupLayerSeparators } = await import('../../src/js/layers/styles/auxiliary.layers.js');

/** Mapa falso com a PILHA de camadas em ordem, que é o que a régua mede. */
function criarMapa(camadasDaBase) {
    const pilha = [...camadasDaBase];
    const fontes = new Set();
    return {
        pilha,
        getLayer: (id) => (pilha.includes(id) ? { id } : undefined),
        addLayer(def, beforeId) {
            if (pilha.includes(def.id)) throw new Error(`camada repetida: ${def.id}`);
            const i = beforeId ? pilha.indexOf(beforeId) : -1;
            if (beforeId && i < 0) throw new Error(`beforeId inexistente: ${beforeId}`);
            if (i < 0) pilha.push(def.id);
            else pilha.splice(i, 0, def.id);
        },
        getSource: (id) => (fontes.has(id) ? { id } : undefined),
        addSource(id) {
            if (fontes.has(id)) throw new Error(`fonte repetida: ${id}`);
            fontes.add(id);
        },
        setLayoutProperty: () => {},
    };
}

function criarControle(mapa) {
    const controle = new TerrainControl({
        hillshade: { enabled: true, layer: { id: 'hillshade', type: 'hillshade', source: 'hillshadeSource' } },
        hillshadeSource: { type: 'raster-dem', tiles: ['http://x/{z}/{x}/{y}.png'] },
        terrainSource: { type: 'raster-dem', tiles: ['http://x/{z}/{x}/{y}.png'] },
    });
    controle._map = mapa;
    return controle;
}

afterEach(() => vi.restoreAllMocks());

describe('sombreamento ligado antes dos separadores (primeiro paint do switchMap)', () => {
    it('entra abaixo do analysis-separator, sem aviso no console', () => {
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mapa = criarMapa(['fundo', 'estradas']);

        criarControle(mapa).setHillshadeVisibility(true);

        expect(mapa.pilha).toEqual(['fundo', 'estradas', 'hillshade', 'analysis-separator', 'features-separator']);
        expect(aviso).not.toHaveBeenCalled();
    });

    it('o setupMapFeatures que vem depois não duplica nem reordena', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mapa = criarMapa(['fundo']);
        criarControle(mapa).setHillshadeVisibility(true);

        setupLayerSeparators(mapa);
        mapa.addLayer({ id: 'analise' }, 'features-separator');
        mapa.addLayer({ id: 'feicoes' });

        expect(mapa.pilha).toEqual(['fundo', 'hillshade', 'analysis-separator', 'analise', 'features-separator', 'feicoes']);
    });
});

describe('sombreamento ligado com os separadores já no mapa (trocas seguintes)', () => {
    it('continua entrando logo abaixo do analysis-separator', () => {
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mapa = criarMapa(['fundo']);
        setupLayerSeparators(mapa);
        mapa.addLayer({ id: 'analise' }, 'features-separator');

        criarControle(mapa).setHillshadeVisibility(true);

        expect(mapa.pilha).toEqual(['fundo', 'hillshade', 'analysis-separator', 'analise', 'features-separator']);
        expect(aviso).not.toHaveBeenCalled();
    });
});
