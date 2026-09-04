// Path: tests/unit/style-transform.test.js

/**
 * @fileoverview O que `setStyle` pode destruir na troca de mapa base, e o que
 * decide se a troca acontece.
 *
 * As duas funcoes vivem no mesmo modulo porque as duas respondem ao MAPA e nao
 * ao que o controle acredita: `mergeApplicationStyle` le o estilo serializado
 * que esta la, e `baseStyleAlreadyOnMap` julga pela camada presente.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { baseStyleAlreadyOnMap, collectStyleIds, mergeApplicationStyle } from '../../src/js/baselayers/style-transform.js';
import cartaTopografica from '../../src/js/baselayers/carta_topografica.js';
import osmLayer from '../../src/js/baselayers/osm_layer.js';
import imagensLayer from '../../src/js/baselayers/imagens_layer.js';
import bdgexLayer from '../../src/js/baselayers/bdgex_layer.js';

const baseA = {
    version: 8,
    glyphs: 'g',
    sources: { osm: { type: 'raster', tiles: ['a'] } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
const baseB = {
    version: 8,
    glyphs: 'g',
    sources: { orto: { type: 'raster', tiles: ['b'] } },
    layers: [{ id: 'orto', type: 'raster', source: 'orto' }],
};

// The style as MapLibre serializes it after the app built on top of baseA.
function appOn(base, extra = {}) {
    const points = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    const terrainSource = { type: 'raster-dem', tiles: ['t'] };
    return {
        ...base,
        sources: { ...base.sources, points, terrainSource, 'data-moldura': { type: 'vector', url: 'u' } },
        layers: [
            ...base.layers,
            { id: 'analysis-separator', type: 'background', layout: { visibility: 'none' } },
            { id: 'hillshade', type: 'hillshade', source: 'terrainSource' },
            { id: 'point-layer', type: 'circle', source: 'points' },
        ],
        ...extra,
    };
}

describe('collectStyleIds', () => {
    it('lists the ids a style declares, and tolerates an empty style', () => {
        const ids = collectStyleIds(baseA);
        expect([...ids.sources]).toEqual(['osm']);
        expect([...ids.layers]).toEqual(['osm']);
        expect(collectStyleIds(null).sources.size).toBe(0);
        expect(collectStyleIds({}).layers.size).toBe(0);
    });

    it('tolerates a URL style, which is what `carta-ortoimagem` is in this tree', () => {
        expect(collectStyleIds('https://exemplo.test/estilo.json').sources.size).toBe(0);
        expect(collectStyleIds('https://exemplo.test/estilo.json').layers.size).toBe(0);
    });
});

describe('mergeApplicationStyle', () => {
    it('keeps every application source and layer BY REFERENCE and drops the previous base', () => {
        const previous = appOn(baseA);
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));

        expect(Object.keys(merged.sources).sort()).toEqual(['data-moldura', 'orto', 'points', 'terrainSource']);
        expect(merged.sources.points).toBe(previous.sources.points);
        expect(merged.sources.terrainSource).toBe(previous.sources.terrainSource);
        expect(merged.sources.osm).toBeUndefined();

        expect(merged.layers.map((l) => l.id)).toEqual(['orto', 'analysis-separator', 'hillshade', 'point-layer']);
        expect(merged.layers[3]).toBe(previous.layers[3]);
    });

    it('puts the new base layers first, so the application draws on top', () => {
        const merged = mergeApplicationStyle(appOn(baseA), baseB, collectStyleIds(baseA));
        expect(merged.layers[0].id).toBe('orto');
    });

    it('drops a layer of the previous base even when its id was not recorded', () => {
        const previous = appOn(baseA);
        previous.layers.splice(1, 0, { id: 'osm-labels', type: 'symbol', source: 'osm' });
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.layers.map((l) => l.id)).not.toContain('osm-labels');
    });

    it('lets the new base win an id collision', () => {
        const previous = appOn(baseA);
        previous.sources.orto = { type: 'raster', tiles: ['stale'] };
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.sources.orto).toBe(baseB.sources.orto);
    });

    it('carries terrain and projection over when the new base does not declare them', () => {
        const previous = appOn(baseA, { terrain: { source: 'terrainSource', exaggeration: 1.5 }, projection: { type: 'globe' } });
        const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(baseA));
        expect(merged.terrain).toEqual({ source: 'terrainSource', exaggeration: 1.5 });
        expect(merged.projection).toEqual({ type: 'globe' });
        expect(baseB.terrain).toBeUndefined();
    });

    it('returns the new style untouched on the first application (no previous style)', () => {
        expect(mergeApplicationStyle(null, baseB, collectStyleIds(baseA))).toBe(baseB);
        expect(mergeApplicationStyle(undefined, baseB, collectStyleIds(baseA))).toBe(baseB);
    });

    it('is a no-op for the base when the previous style has no application content', () => {
        const merged = mergeApplicationStyle(baseA, baseB, collectStyleIds(baseA));
        expect(merged.sources).toEqual(baseB.sources);
        expect(merged.layers).toEqual(baseB.layers);
    });

    it('never loses an application source or layer, whatever the base ids are (worst case: 85 sources, 128 layers)', () => {
        const appSourceIds = Array.from({ length: 85 }, (_, i) => 'app-src-' + i);
        const appLayerIds = Array.from({ length: 128 }, (_, i) => 'app-layer-' + i);
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 5 }),
            fc.integer({ min: 1, max: 5 }),
            (nBaseSources, nBaseLayers) => {
                const base = { sources: {}, layers: [] };
                for (let i = 0; i < nBaseSources; i++) base.sources['base-' + i] = { type: 'raster', tiles: ['x'] };
                for (let i = 0; i < nBaseLayers; i++) base.layers.push({ id: 'base-l-' + i, type: 'raster', source: 'base-0' });
                const previous = { ...base, sources: { ...base.sources }, layers: [...base.layers] };
                for (const id of appSourceIds) previous.sources[id] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
                for (const [i, id] of appLayerIds.entries()) previous.layers.push({ id, type: 'circle', source: appSourceIds[i % appSourceIds.length] });

                const merged = mergeApplicationStyle(previous, baseB, collectStyleIds(base));
                const sourceIds = new Set(Object.keys(merged.sources));
                const layerIds = merged.layers.map((l) => l.id);
                return appSourceIds.every((id) => sourceIds.has(id))
                    && appLayerIds.every((id) => layerIds.includes(id))
                    && !Object.keys(base.sources).some((id) => sourceIds.has(id))
                    && !base.layers.some((l) => layerIds.includes(l.id))
                    && layerIds[0] === 'orto';
            },
        ));
    });

    it('as CINCO bases desta arvore atravessam o merge sem perder o desenho do app', () => {
        // Nao e o mesmo teste da propriedade acima: aqui os estilos sao os REAIS,
        // com os ids que o deploy usa, e `carta-ortoimagem` e uma URL que so vira
        // objeto depois do fetch (por isso ela entra como o estilo ja resolvido).
        const bases = [cartaTopografica, osmLayer, imagensLayer, bdgexLayer];
        for (const de of bases) {
            for (const para of bases) {
                if (de === para) continue;
                const previous = appOn(de);
                const merged = mergeApplicationStyle(previous, para, collectStyleIds(de));
                const sourceIds = new Set(Object.keys(merged.sources));
                const layerIds = merged.layers.map((l) => l.id);
                expect(sourceIds.has('points')).toBe(true);
                expect(layerIds).toContain('point-layer');
                expect(layerIds).toContain('hillshade');
                // A base nova entra por baixo, e a anterior sai inteira.
                expect(layerIds.slice(0, para.layers.length)).toEqual(para.layers.map((l) => l.id));
                for (const id of Object.keys(de.sources)) {
                    if (!Object.prototype.hasOwnProperty.call(para.sources, id)) {
                        expect(sourceIds.has(id)).toBe(false);
                    }
                }
            }
        }
    });
});

// The switch decides by the MAP, not by the control's belief. Worst cases
// first: each one is a state that the belief would have got wrong.
describe('baseStyleAlreadyOnMap', () => {
    const overture = { version: 8, name: 'osm_overture_v1.3', sources: { base: { type: 'vector', url: 'o' } }, layers: [{ id: 'base_land', type: 'fill', source: 'base' }, { id: 'base_water', type: 'fill', source: 'base' }] };
    const carta = { version: 8, name: 'topo_vector_tile_v1.0', sources: { asc: { type: 'vector', url: 'c' } }, layers: [{ id: 'asc_via', type: 'line', source: 'asc' }] };
    const hasLayerOf = (style) => (id) => style.layers.some((l) => l.id === id);

    it('2026-09-04: map born with the Topografica while the state says DSG, asked DSG: not applied', () => {
        expect(baseStyleAlreadyOnMap(appOn(overture), carta, hasLayerOf(appOn(overture)))).toBe(false);
    });

    it('the base on the map, asked again: already applied (no setStyle, no styledata wait)', () => {
        expect(baseStyleAlreadyOnMap(appOn(overture), overture, hasLayerOf(appOn(overture)))).toBe(true);
    });

    it('same name but a base layer missing from the map: not applied', () => {
        const semAgua = { ...appOn(overture), layers: appOn(overture).layers.filter((l) => l.id !== 'base_water') };
        expect(baseStyleAlreadyOnMap(semAgua, overture, hasLayerOf(semAgua))).toBe(false);
    });

    it('a URL style, a missing map style or an empty base are never "already applied"', () => {
        expect(baseStyleAlreadyOnMap(appOn(overture), 'https://example.test/style.json', hasLayerOf(appOn(overture)))).toBe(false);
        expect(baseStyleAlreadyOnMap(null, overture, () => true)).toBe(false);
        expect(baseStyleAlreadyOnMap({ name: 'x', layers: [] }, { name: 'x', layers: [] }, () => true)).toBe(false);
    });

    it('O PIOR CASO DESTE RAMO: o MESMO id, com o estilo publicado trocado sob ele', () => {
        // `config.basemapStyles` e mutavel em tempo de execucao: o payload aditivo de
        // concessao grava e apaga entradas (`store/sync/atlas-settings.service.js`).
        // Entao uma camada base concedida pode resolver para OUTRO estilo entre duas
        // trocas, com o id intacto. Uma comparacao de id nao ve isso; a do mapa ve.
        const antes = { version: 8, name: 'acervo_v1', sources: { p: { type: 'raster', tiles: ['a'] } }, layers: [{ id: 'acervo_raster', type: 'raster', source: 'p' }] };
        const depois = { version: 8, name: 'acervo_v2', sources: { p: { type: 'raster', tiles: ['b'] } }, layers: [{ id: 'acervo_raster_v2', type: 'raster', source: 'p' }] };
        const noMapa = appOn(antes);
        expect(baseStyleAlreadyOnMap(noMapa, antes, hasLayerOf(noMapa))).toBe(true);
        expect(baseStyleAlreadyOnMap(noMapa, depois, hasLayerOf(noMapa))).toBe(false);
    });

    it('as CINCO bases embutidas nao declaram `name`, entao a decisao e so das camadas', () => {
        // Medido em 2026-09-04. Nao e um descuido a consertar aqui: acrescentar
        // `name` a um dos cinco mudaria o estilo que o deploy serve. O que a regua
        // cobra e que a decisao continue CORRETA sem ele.
        for (const estilo of [cartaTopografica, osmLayer, imagensLayer, bdgexLayer]) {
            expect(estilo.name).toBeUndefined();
        }
        const mapaComTopografica = appOn(cartaTopografica);
        const has = hasLayerOf(mapaComTopografica);
        // `carta_topografica` e `osm_layer` sao o MESMO estilo (ver
        // baselayer-style-uniqueness.repro.test.js): pedir um com o outro no mapa e
        // "ja aplicado", que e a resposta honesta e a que evita o diff vazio.
        expect(baseStyleAlreadyOnMap(mapaComTopografica, cartaTopografica, has)).toBe(true);
        expect(baseStyleAlreadyOnMap(mapaComTopografica, osmLayer, has)).toBe(true);
        // As que desenham outra coisa continuam distinguiveis pelas camadas.
        expect(baseStyleAlreadyOnMap(mapaComTopografica, imagensLayer, has)).toBe(false);
        expect(baseStyleAlreadyOnMap(mapaComTopografica, bdgexLayer, has)).toBe(false);
    });
});
