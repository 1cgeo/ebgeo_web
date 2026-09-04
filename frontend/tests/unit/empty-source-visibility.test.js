/**
 * @fileoverview A camada cuja fonte GeoJSON esta vazia tem de ficar
 * `visibility: none`, para o MapLibre parar de contar a fonte como usada.
 *
 * O QUE O BUNDLE 5.18 VENDORIZADO FAZ, e e o mecanismo inteiro da regra. O
 * `Style.update` marca a fonte por camada NAO escondida
 * (`!layer.isHidden(zoom) && layer.source && (tileManagers[layer.source].used = true)`),
 * e o `TileManager.update` so paga o `coveringTiles` COM ELEVACAO quando
 * `used || usedForTerrain`. Camada escondida nao marca, entao a fonte vazia sai do
 * laco por quadro e nao abre pilha de render-to-texture. Medido na `main` com 67
 * fontes vazias e 82 camadas: quadro parado de 26 ms para 5,7 ms e rotacao de 38 ms
 * para 7,7 ms.
 *
 * O PIOR CASO QUE ESTA REGUA EXISTE PARA PEGAR, um eixo por bloco:
 *
 * 1. esconder camada de MAIS uma fonte que a vazia (dano visivel);
 * 2. deixar escondida a camada de uma fonte que ganhou feicao (o desenho some);
 * 3. tratar um `Feature` solto como colecao vazia (o mesmo sumico, por uma forma
 *    de GeoJSON que a contagem ingenua nao ve);
 * 4. mexer em fonte que nao e GeoJSON, ou que carrega por URL (nao da para saber
 *    se esta vazia);
 * 5. reexibir camada que o PROPRIO app escondeu (o separador voltaria a desenhar, e
 *    o 360 desligado voltaria a aparecer);
 * 6. escrever `visibility` de novo com o valor que ja esta la, porque cada escrita
 *    faz o `Style._updateLayer` marcar `_updatedSources[source] = 'reload'`;
 * 7. E O EIXO QUE SO ESTE RAMO TEM: a fonte migrada para o despachante de diff
 *    (`layers/geojson-dispatcher.js`) escreve por `updateData`, e ali o `_data` do
 *    MapLibre vira um Map e o `serialize()` RECONSTROI a colecao. Uma contagem que
 *    so soubesse ler `_data.geojson` devolveria `null` nas dezesseis fontes
 *    principais do app e a regra seria um no-op silencioso justamente onde importa.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
    countSourceFeatures,
    syncSourceLayersVisibility,
    syncAllSourcesVisibility,
    installEmptySourceVisibility,
    layersHiddenByRule,
    UNMANAGED_SOURCE_IDS,
} from '../../src/js/layers/empty-source-visibility.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * Um ponto qualquer, para encher uma fonte.
 * @param {string} id - Id da feicao
 * @returns {Object} Feature GeoJSON
 */
function point(id) {
    return { type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [0, 0] } };
}

/**
 * Mapa falso no contrato que o modulo usa do MapLibre 5.18.
 *
 * Reproduz os tres detalhes de que a regra depende, cada um lido do bundle:
 *
 * - `getLayoutProperty` devolve `undefined` na camada que nunca declarou
 *   `layout.visibility` (o MapLibre nao tem default de classe);
 * - `setData` E `updateData` passam os dois pelo `_updateWorkerData` e disparam
 *   `sourcedata` com `sourceDataType: 'metadata'` e depois `'content'`, sem
 *   consultar se a fonte esta em uso (`_dispatchWorkerUpdate`);
 * - depois do primeiro `updateData` o `_data` da fonte vira `{updateable: Map}` e o
 *   `serialize()` devolve `{type:'FeatureCollection', features: Array.from(map.values())}`,
 *   isto e, uma colecao NOVA a cada chamada.
 *
 * @param {Object} spec - `{ sources: {id: {type, data}}, layers: [{id, source, visibility}] }`
 * @returns {Object} Mapa falso com o log `layoutWrites`
 */
function makeFakeMap(spec) {
    const listeners = { sourcedata: [] };
    const layers = spec.layers.map((l) => ({ ...l }));
    const sources = {};

    const map = {
        layoutWrites: [],

        getLayersOrder() {
            return layers.map((l) => l.id);
        },
        getLayer(id) {
            return layers.find((l) => l.id === id) || undefined;
        },
        getSource(id) {
            return sources[id];
        },
        getLayoutProperty(id, prop) {
            const layer = layers.find((l) => l.id === id);
            if (!layer) throw new Error(`Cannot get style of non-existing layer "${id}".`);
            // Como o MapLibre: undefined quando nunca foi declarada.
            return prop === 'visibility' ? layer.visibility : undefined;
        },
        setLayoutProperty(id, prop, value) {
            const layer = layers.find((l) => l.id === id);
            layer[prop] = value;
            map.layoutWrites.push({ id, prop, value });
        },
        on(name, fn) {
            (listeners[name] = listeners[name] || []).push(fn);
        },
        off(name, fn) {
            listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
        },
        emit(name, event) {
            for (const fn of listeners[name] || []) fn(event);
        },
        listenerCount(name) {
            return (listeners[name] || []).length;
        },
    };

    for (const [id, def] of Object.entries(spec.sources)) {
        sources[id] = {
            id,
            type: def.type,
            serializeCalls: 0,
            // `_data` no formato do bundle: `{geojson}`, `{url}` ou `{updateable: Map}`.
            _data: typeof def.data === 'string' ? { url: def.data } : { geojson: def.data },
            serialize() {
                this.serializeCalls++;
                if (this.type !== 'geojson') return { type: this.type };
                return {
                    type: 'geojson',
                    data: this._data.updateable
                        ? { type: 'FeatureCollection', features: Array.from(this._data.updateable.values()) }
                        : this._data.url || this._data.geojson,
                };
            },
            setData(data) {
                this._data = typeof data === 'string' ? { url: data } : { geojson: data };
                map.emit('sourcedata', { sourceId: id, dataType: 'source', sourceDataType: 'metadata' });
                map.emit('sourcedata', { sourceId: id, dataType: 'source', sourceDataType: 'content' });
            },
            /**
             * O caminho das dezesseis fontes migradas: diff em vez de colecao inteira.
             * @param {{add?: Array, remove?: Array, removeAll?: boolean}} diff - Diff do MapLibre
             */
            updateData(diff) {
                if (!this._data.updateable) {
                    const seed = new Map();
                    for (const f of this._data.geojson?.features || []) seed.set(f.properties.id, f);
                    this._data = { updateable: seed };
                }
                const held = this._data.updateable;
                if (diff.removeAll) held.clear();
                for (const key of diff.remove || []) held.delete(key);
                for (const f of diff.add || []) held.set(f.properties.id, f);
                map.emit('sourcedata', { sourceId: id, dataType: 'source', sourceDataType: 'metadata' });
                map.emit('sourcedata', { sourceId: id, dataType: 'source', sourceDataType: 'content' });
            },
        };
    }

    return map;
}

/**
 * O estilo de uma sessao tipica, em miniatura: uma fonte com feicao, tres vazias,
 * um separador que ja nasce escondido, uma fonte raster e uma GeoJSON por URL.
 * @returns {Object} Mapa falso
 */
function makeTypicalMap() {
    return makeFakeMap({
        sources: {
            points: { type: 'geojson', data: { type: 'FeatureCollection', features: [point('p1')] } },
            polygons: { type: 'geojson', data: EMPTY },
            'polygon-labels': { type: 'geojson', data: EMPTY },
            texts: { type: 'geojson', data: EMPTY },
            'features-separator-source': { type: 'geojson', data: EMPTY },
            hillshadeSource: { type: 'raster-dem' },
            'streetview-lines': { type: 'geojson', data: 'https://exemplo/tracks' },
        },
        layers: [
            { id: 'point-layer', source: 'points', type: 'circle' },
            { id: 'point-label-layer', source: 'points', type: 'symbol' },
            { id: 'polygon-fill-layer', source: 'polygons', type: 'fill' },
            { id: 'polygon-layer', source: 'polygons', type: 'line' },
            { id: 'polygon-label-layer', source: 'polygon-labels', type: 'symbol' },
            { id: 'text-layer', source: 'texts', type: 'symbol' },
            { id: 'features-separator', source: 'features-separator-source', type: 'circle', visibility: 'none' },
            { id: 'hillshade', source: 'hillshadeSource', type: 'hillshade' },
            { id: 'streetview-lines-layer', source: 'streetview-lines', type: 'line' },
        ],
    });
}

describe('countSourceFeatures: o vazio se prova, nunca se presume', () => {
    let map;
    beforeEach(() => { map = makeTypicalMap(); });

    it('conta a FeatureCollection embutida', () => {
        expect(countSourceFeatures(map, 'points')).toBe(1);
        expect(countSourceFeatures(map, 'polygons')).toBe(0);
    });

    it('um Feature solto (nao FeatureCollection) conta como UMA feicao', () => {
        map.getSource('polygons').setData(point('solto'));
        expect(countSourceFeatures(map, 'polygons')).toBe(1);
    });

    it('devolve null (indeterminado) para fonte que nao e GeoJSON, por URL, ou inexistente', () => {
        expect(countSourceFeatures(map, 'hillshadeSource')).toBeNull();
        expect(countSourceFeatures(map, 'streetview-lines')).toBeNull();
        expect(countSourceFeatures(map, 'fonte-que-nao-existe')).toBeNull();
    });

    it('conta certo na fonte MIGRADA, cujo serialize reconstroi a colecao', () => {
        const fonte = map.getSource('polygons');
        fonte.updateData({ add: [point('a'), point('b')] });
        expect(fonte._data.updateable).toBeInstanceOf(Map);
        expect(countSourceFeatures(map, 'polygons')).toBe(2);

        fonte.updateData({ remove: ['a', 'b'] });
        expect(countSourceFeatures(map, 'polygons')).toBe(0);
    });
});

describe('syncSourceLayersVisibility: esconde a fonte vazia, e SO ela', () => {
    let map;
    beforeEach(() => { map = makeTypicalMap(); });

    it('esconde as duas camadas da fonte vazia', () => {
        const writes = syncSourceLayersVisibility(map, 'polygons');

        expect(writes).toBe(2);
        expect(map.getLayoutProperty('polygon-fill-layer', 'visibility')).toBe('none');
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');
    });

    it('nao encosta na camada de outra fonte', () => {
        syncSourceLayersVisibility(map, 'polygons');

        const tocadas = new Set(map.layoutWrites.map((w) => w.id));
        expect([...tocadas]).toEqual(['polygon-fill-layer', 'polygon-layer']);
        expect(map.getLayoutProperty('point-layer', 'visibility')).toBeUndefined();
        expect(map.getLayoutProperty('text-layer', 'visibility')).toBeUndefined();
    });

    it('deixa visivel a camada da fonte que tem UMA feicao', () => {
        expect(syncSourceLayersVisibility(map, 'points')).toBe(0);
        expect(map.layoutWrites).toHaveLength(0);
        expect(map.getLayoutProperty('point-layer', 'visibility')).toBeUndefined();
    });

    it('mostra de volta quando a fonte vazia ganha uma feicao', () => {
        syncSourceLayersVisibility(map, 'polygons');
        map.layoutWrites = [];

        map.getSource('polygons')._data = { geojson: { type: 'FeatureCollection', features: [point('a')] } };
        const writes = syncSourceLayersVisibility(map, 'polygons');

        expect(writes).toBe(2);
        expect(map.getLayoutProperty('polygon-fill-layer', 'visibility')).toBe('visible');
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('visible');
        expect(layersHiddenByRule(map)).not.toContain('polygon-fill-layer');
    });

    it('esconde de novo quando a ultima feicao e apagada', () => {
        map.getSource('polygons')._data = { geojson: { type: 'FeatureCollection', features: [point('a')] } };
        syncSourceLayersVisibility(map, 'polygons');
        map.getSource('polygons')._data = { geojson: EMPTY };

        expect(syncSourceLayersVisibility(map, 'polygons')).toBe(2);
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');
    });

    it('nao mexe em fonte que nao e GeoJSON nem em GeoJSON por URL', () => {
        expect(syncSourceLayersVisibility(map, 'hillshadeSource')).toBe(0);
        expect(syncSourceLayersVisibility(map, 'streetview-lines')).toBe(0);
        expect(map.layoutWrites).toHaveLength(0);
    });

    it('nao mexe nas fontes que o proprio dono liga e desliga por visibility', () => {
        const dono = makeFakeMap({
            sources: { 'streetview-markers-source': { type: 'geojson', data: EMPTY } },
            layers: [{ id: 'streetview-clusters', source: 'streetview-markers-source', type: 'circle' }],
        });

        expect(UNMANAGED_SOURCE_IDS.has('streetview-markers-source')).toBe(true);
        expect(syncSourceLayersVisibility(dono, 'streetview-markers-source')).toBe(0);
        expect(dono.layoutWrites).toHaveLength(0);
    });

    it('as tres fontes governadas por visibility neste ramo estao TODAS na lista', () => {
        // Medido por varredura de `setLayoutProperty(..., 'visibility', ...)` em
        // `frontend/src/js/`: os demais donos ou nao sao GeoJSON (grade vetorial,
        // hillshade raster-dem, camadas de analise e de dados) ou nao vivem no mapa
        // principal (a planta baixa do 360, que e do mini-mapa).
        expect([...UNMANAGED_SOURCE_IDS].sort()).toEqual([
            '3d-models-source',
            'saved-photos-markers-source',
            'streetview-markers-source',
        ]);
    });
});

describe('a regra compoe: camada que o app quer escondida nunca e reexibida', () => {
    let map;
    beforeEach(() => { map = makeTypicalMap(); });

    it('nao reescreve o separador, que ja nasce none como ancora de beforeId', () => {
        syncAllSourcesVisibility(map);

        expect(map.layoutWrites.some((w) => w.id === 'features-separator')).toBe(false);
        expect(map.getLayoutProperty('features-separator', 'visibility')).toBe('none');
        expect(layersHiddenByRule(map)).not.toContain('features-separator');
    });

    it('o separador continua none mesmo se a fonte dele ganhar feicao', () => {
        syncAllSourcesVisibility(map);
        map.getSource('features-separator-source')._data = { geojson: { type: 'FeatureCollection', features: [point('x')] } };

        syncSourceLayersVisibility(map, 'features-separator-source');

        expect(map.getLayoutProperty('features-separator', 'visibility')).toBe('none');
    });

    it('camada escondida pelo app DEPOIS da regra sai do registro e nao volta', () => {
        const app = makeFakeMap({
            sources: { fotos: { type: 'geojson', data: EMPTY } },
            layers: [{ id: 'fotos-layer', source: 'fotos', type: 'circle' }],
        });

        syncSourceLayersVisibility(app, 'fotos');
        expect(layersHiddenByRule(app)).toEqual(['fotos-layer']);

        // O app reexibe por conta propria, e so depois chega o dado.
        app.setLayoutProperty('fotos-layer', 'visibility', 'visible');
        app.layoutWrites = [];
        app.getSource('fotos')._data = { geojson: { type: 'FeatureCollection', features: [point('a')] } };

        expect(syncSourceLayersVisibility(app, 'fotos')).toBe(0);
        expect(layersHiddenByRule(app)).toEqual([]);
    });
});

describe('idempotencia: chamar duas vezes nao escreve duas vezes', () => {
    let map;
    beforeEach(() => { map = makeTypicalMap(); });

    it('a segunda passada com a fonte vazia nao escreve nada', () => {
        expect(syncSourceLayersVisibility(map, 'polygons')).toBe(2);
        map.layoutWrites = [];

        expect(syncSourceLayersVisibility(map, 'polygons')).toBe(0);
        expect(map.layoutWrites).toHaveLength(0);
    });

    it('a segunda passada com a fonte cheia nao escreve nada', () => {
        map.getSource('polygons')._data = { geojson: { type: 'FeatureCollection', features: [point('a')] } };

        syncSourceLayersVisibility(map, 'polygons');
        syncSourceLayersVisibility(map, 'polygons');
        map.layoutWrites = [];

        expect(syncSourceLayersVisibility(map, 'polygons')).toBe(0);
        expect(map.layoutWrites).toHaveLength(0);
    });

    it('dez varreduras completas gastam as escritas da PRIMEIRA e mais nenhuma', () => {
        const primeira = syncAllSourcesVisibility(map);
        expect(primeira).toBe(4); // polygon-fill, polygon-layer, polygon-label, text-layer

        map.layoutWrites = [];
        for (let i = 0; i < 10; i++) syncAllSourcesVisibility(map);

        expect(map.layoutWrites).toHaveLength(0);
    });

    it('nunca escreve visible numa camada visivel cuja visibility nunca foi declarada', () => {
        // A armadilha do MapLibre: getLayoutProperty devolve undefined ali, e o
        // deep-equal contra 'visible' da falso, entao a escrita passaria e
        // marcaria a fonte para reload.
        syncAllSourcesVisibility(map);
        expect(map.layoutWrites.some((w) => w.id === 'point-layer')).toBe(false);
        expect(map.layoutWrites.every((w) => w.value === 'none')).toBe(true);
    });

    it('a varredura completa le CADA fonte uma vez, nao uma vez por camada dela', () => {
        syncAllSourcesVisibility(map);
        expect(map.getSource('polygons').serializeCalls).toBe(1);
        expect(map.getSource('points').serializeCalls).toBe(1);
    });
});

describe('installEmptySourceVisibility: um ouvinte cobre todo call site de escrita', () => {
    let map;
    beforeEach(() => { map = makeTypicalMap(); });

    it('sincroniza na instalacao e acompanha o setData seguinte', () => {
        installEmptySourceVisibility(map);
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');

        map.getSource('polygons').setData({ type: 'FeatureCollection', features: [point('a')] });
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('visible');

        map.getSource('polygons').setData(EMPTY);
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');
    });

    it('acompanha o updateData tambem, que e como as dezesseis fontes migradas escrevem', () => {
        installEmptySourceVisibility(map);
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');

        map.getSource('polygons').updateData({ add: [point('a')] });
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('visible');
        expect(map.getLayoutProperty('polygon-fill-layer', 'visibility')).toBe('visible');

        map.getSource('polygons').updateData({ remove: ['a'] });
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');
    });

    it('ignora o sourcedata por tile, que nao muda a contagem', () => {
        installEmptySourceVisibility(map);
        map.getSource('polygons')._data = { geojson: { type: 'FeatureCollection', features: [point('a')] } };
        map.layoutWrites = [];

        map.emit('sourcedata', { sourceId: 'polygons', dataType: 'source', sourceDataType: 'metadata' });
        map.emit('sourcedata', { sourceId: 'polygons', dataType: 'source' });

        expect(map.layoutWrites).toHaveLength(0);
    });

    it('reinstalar (troca de mapa base) nao empilha ouvinte', () => {
        installEmptySourceVisibility(map);
        installEmptySourceVisibility(map);
        installEmptySourceVisibility(map);

        expect(map.listenerCount('sourcedata')).toBe(1);
    });

    it('a funcao devolvida solta o ouvinte', () => {
        const uninstall = installEmptySourceVisibility(map);
        uninstall();

        expect(map.listenerCount('sourcedata')).toBe(0);

        map.getSource('polygons').setData({ type: 'FeatureCollection', features: [point('a')] });
        expect(map.getLayoutProperty('polygon-layer', 'visibility')).toBe('none');
    });
});
