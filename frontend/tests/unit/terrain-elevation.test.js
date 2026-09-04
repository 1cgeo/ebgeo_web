/**
 * @fileoverview Uma consulta de elevacao por amostra, e um amostrador que resolve o
 * zoom UMA vez para toda a conta.
 *
 * O QUE O BUNDLE 5.18 VENDORIZADO FAZ, e e daqui que sai cada numero abaixo:
 *
 *   getElevationForLngLat(e, t) {
 *       const i = Ie(t, {maxzoom: this.tileManager.maxzoom, minzoom: ..., tileSize: 512, terrain: this});
 *       let a = 0;
 *       for (const e of i) e.canonical.z > a && (a = Math.min(e.canonical.z, this.tileManager.maxzoom));
 *       return this.getElevationForLngLatZoom(e, a)
 *   }
 *   getElevation(e, i, a, r) { return this.getDEMElevation(e, i, a, r) * this.exaggeration }
 *
 * Ou seja: `Ie` (coveringTiles, com frustum, plano de corte e sete copias do mundo)
 * roda INTEIRA so para descobrir o zoom do tile mais proximo, e o valor devolvido e
 * `DEM * exagero`, SEM termo de camera. O ponto fixo `[0, 0]` que este ramo subtraia
 * cancelava um deslocamento que nao existe nesta versao, e cobrava a travessia duas
 * vezes por amostra.
 *
 * OS EIXOS DE PIOR CASO que cada bloco exercita:
 *
 * 1. uma consulta por amostra, com UM argumento (o `options` e ignorado pelo 5.18);
 * 2. o amostrador le pelo zoom resolvido e NUNCA pela API publica, senao o ganho
 *    inteiro se perde sem nenhum teste ficar vermelho;
 * 3. o amostrador e `getTerrainElevation` devolvem o MESMO valor, senao trocar um
 *    pelo outro move a cota do usuario;
 * 4. o argumento tem de trazer `wrap()`, porque `getElevationForLngLatZoom` o chama
 *    na primeira linha (`if (!cE(i, e.wrap())) return 0`): um array cru devolveria
 *    zero em toda amostra, calado;
 * 5. sem terreno nada e consultado, e leitura nao finita vale 0.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import {
    getTerrainElevation,
    createTerrainSampler,
    resolveTerrainLookupZoom,
} from '../../src/js/terrain/terrain-elevation.js';

/**
 * Mapa falso com os DOIS caminhos de leitura que o 5.18 expoe: a API publica
 * `queryTerrainElevation` (uma travessia de coveringTiles por chamada) e o
 * `Terrain.getElevationForLngLatZoom` num zoom ja resolvido. Os dois contam chamadas,
 * e o segundo EXIGE `wrap()` como o bundle exige.
 *
 * @param {Object} [spec] - Configuracao do duplo
 * @returns {Object} Mapa falso
 */
function makeMap({
    terrain = { source: 'terrainSource', exaggeration: 1.5 },
    zoom = 12.7,
    maxzoom = 11,
    minzoom = 0,
    dem = () => 100,
    withEngine = true,
} = {}) {
    const map = {
        getTerrain: () => terrain,
        getZoom: () => zoom,
        queryTerrainElevation: vi.fn((c) => (terrain ? dem(c) * (terrain.exaggeration ?? 1) : null)),
    };
    if (withEngine) {
        map.terrain = {
            tileManager: { maxzoom, minzoom },
            getElevationForLngLatZoom: vi.fn((lngLat, z) => {
                if (typeof lngLat?.wrap !== 'function') {
                    throw new TypeError('lngLat.wrap is not a function');
                }
                return dem([lngLat.lng, lngLat.lat], z) * (terrain.exaggeration ?? 1);
            }),
        };
    }
    return map;
}

describe('getTerrainElevation', () => {
    it('consulta o terreno UMA vez, com um argumento so, e tira o exagero', () => {
        const map = makeMap({ dem: () => 200 });
        expect(getTerrainElevation(map, [-53.5, -29.7])).toBe(200);
        expect(map.queryTerrainElevation).toHaveBeenCalledTimes(1);
        expect(map.queryTerrainElevation.mock.calls[0]).toEqual([[-53.5, -29.7]]);
    });

    it('devolve 0 sem terreno, e nao encosta na consulta', () => {
        const map = makeMap({ terrain: null });
        expect(getTerrainElevation(map, [0, 0])).toBe(0);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
    });

    it('trata leitura nao finita como 0', () => {
        const nan = makeMap({ dem: () => NaN });
        expect(getTerrainElevation(nan, [1, 1])).toBe(0);
    });

    it('exagero ausente divide por 1, que e o default do proprio MapLibre', () => {
        // `this.exaggeration = typeof i.exaggeration === "number" ? i.exaggeration : 1`
        // no construtor do Terrain (bundle vendorizado). Dividir por 1.5 ali, como este
        // ramo fazia, devolveria dois tercos da cota verdadeira.
        const raw = makeMap({ terrain: { source: 'terrainSource' }, dem: () => 42 });
        expect(getTerrainElevation(raw, [1, 1])).toBe(42);
    });

    it('exagero zero achata a cena, e a resposta honesta e 0, nunca NaN', () => {
        const flat = makeMap({ terrain: { source: 'terrainSource', exaggeration: 0 }, dem: () => 80 });
        expect(getTerrainElevation(flat, [1, 1])).toBe(0);
    });

    it('e sincrona: o valor e um numero, nao uma promessa', () => {
        const map = makeMap({ dem: () => 300 });
        expect(typeof getTerrainElevation(map, [1, 1])).toBe('number');
    });

    it('aceita a forma {lng, lat} tambem', () => {
        const map = makeMap({ dem: () => 55 });
        expect(getTerrainElevation(map, { lng: 5, lat: 5 })).toBe(55);
    });
});

describe('resolveTerrainLookupZoom', () => {
    it('trunca o zoom da camera e o limita ao maxzoom do DEM', () => {
        expect(resolveTerrainLookupZoom(12.7, 11)).toBe(11);
        expect(resolveTerrainLookupZoom(9.99, 11)).toBe(9);
        expect(resolveTerrainLookupZoom(3, 11, 5)).toBe(5);
    });

    it('cai no minzoom para um zoom de camera nao finito', () => {
        expect(resolveTerrainLookupZoom(NaN, 11)).toBe(0);
        expect(resolveTerrainLookupZoom(Infinity, 11, 2)).toBe(2);
        expect(resolveTerrainLookupZoom(undefined, 11, 2)).toBe(2);
    });

    it('sempre devolve inteiro dentro de [minzoom, maxzoom]', () => {
        fc.assert(fc.property(
            fc.double({ min: -5, max: 30, noNaN: true }),
            fc.integer({ min: 0, max: 24 }),
            fc.integer({ min: 0, max: 24 }),
            (zoom, a, b) => {
                const lo = Math.min(a, b);
                const hi = Math.max(a, b);
                const z = resolveTerrainLookupZoom(zoom, hi, lo);
                return Number.isInteger(z) && z >= lo && z <= hi;
            },
        ));
    });
});

describe('createTerrainSampler', () => {
    it('resolve o zoom uma vez e le cada amostra por ele, nunca pela API publica', () => {
        const map = makeMap({ zoom: 12.7, maxzoom: 11, dem: (c) => c[0] * 10 });
        const sampler = createTerrainSampler(map);
        expect(sampler.fast).toBe(true);
        expect(sampler.zoom).toBe(11);

        const values = [[1, 0], [2, 0], [3, 0]].map((c) => sampler.elevation(c));
        expect(values).toEqual([10, 20, 30]);
        expect(map.terrain.getElevationForLngLatZoom).toHaveBeenCalledTimes(3);
        expect(map.terrain.getElevationForLngLatZoom.mock.calls.every((call) => call[1] === 11)).toBe(true);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
    });

    it('entrega um LngLat com wrap(), que e o que a primeira linha do metodo chama', () => {
        const map = makeMap({ dem: () => 70 });
        // O duplo lanca sem `wrap`; um array cru chegaria ali e o bundle devolveria 0.
        expect(() => createTerrainSampler(map).elevation([10, 20])).not.toThrow();
        const [lngLat] = map.terrain.getElevationForLngLatZoom.mock.calls[0];
        expect(typeof lngLat.wrap).toBe('function');
        expect(lngLat.wrap()).toBe(lngLat);
        expect([lngLat.lng, lngLat.lat]).toEqual([10, 20]);
    });

    it('bate com getTerrainElevation valor a valor, para trocar um pelo outro sem mover a cota', () => {
        const map = makeMap({ dem: (c) => 50 + c[1] });
        const sampler = createTerrainSampler(map);
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            (lng, lat) => sampler.elevation([lng, lat]) === getTerrainElevation(map, [lng, lat]),
        ));
    });

    it('cai na consulta publica quando os internos do terreno nao estao la', () => {
        const map = makeMap({ withEngine: false, dem: () => 80 });
        const sampler = createTerrainSampler(map);
        expect(sampler.fast).toBe(false);
        expect(sampler.zoom).toBeNull();
        expect(sampler.elevation([1, 1])).toBe(80);
        expect(map.queryTerrainElevation).toHaveBeenCalledTimes(1);
    });

    it('e inerte sem terreno: 0 para toda coordenada e nenhuma leitura', () => {
        const map = makeMap({ terrain: null });
        const sampler = createTerrainSampler(map);
        expect(sampler.elevation([1, 1])).toBe(0);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
        expect(map.terrain.getElevationForLngLatZoom).not.toHaveBeenCalled();
    });

    it('le 0 onde o tile do DEM nao carregou (o MapLibre devolve 0 ali)', () => {
        const map = makeMap({ dem: () => 0 });
        expect(createTerrainSampler(map).elevation([1, 1])).toBe(0);
    });

    it('mil amostras custam UMA resolucao de zoom e mil leituras, nunca mil travessias', () => {
        const map = makeMap({ zoom: 14.2, maxzoom: 13, dem: () => 100 });
        const sampler = createTerrainSampler(map);
        for (let i = 0; i < 1000; i++) sampler.elevation([i / 1000, 0]);
        expect(map.terrain.getElevationForLngLatZoom).toHaveBeenCalledTimes(1000);
        expect(map.queryTerrainElevation).toHaveBeenCalledTimes(0);
    });
});
