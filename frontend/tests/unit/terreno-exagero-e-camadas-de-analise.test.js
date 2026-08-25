// Path: tests/unit/terreno-exagero-e-camadas-de-analise.test.js

/**
 * @fileoverview O EXAGERO DE TERRENO E O QUE ELE DIVIDE (`terrain/terrain.control.js`), mais a
 * validacao e o descritor de estilo das camadas de analise
 * (`terrain/analysis-layers.manager.js`).
 *
 * O QUE ESTA SUITE PRENDE:
 *
 *  1. `getTerrainElevation`, que e a unica aritmetica do arquivo: o terreno ausente devolve 0 sem
 *     consultar nada, a altitude e medida CONTRA um ponto fixo em [0,0] (e nao contra o zero
 *     absoluto), e o resultado e dividido pelo exagero para desfazer o esticamento visual.
 *  2. O DESACORDO INTERNO DO ARQUIVO sobre o exagero ZERO, medido nas duas pontas: o controle
 *     ACEITA e propaga `exaggeration: 0` (`initExaggeration`/`setExaggeration` nao clampam), e
 *     `getTerrainElevation` o LE COMO 1.5, por `terrain.exaggeration || 1.5`. As duas metades
 *     estao no mesmo arquivo e discordam.
 *  3. `setExaggeration` contra `initExaggeration`: so a primeira toca o mapa, e so quando ja ha
 *     terreno ligado. E o que faz o valor restaurado no boot nao acender o terreno sozinho.
 *  4. `_validateLayersConfig`, que PODA a config compartilhada em vez de abortar o boot: bounds
 *     ausente, de tamanho errado, degenerado e cruzando o antimeridiano, todos caem.
 *  5. O descritor de estilo da analise, onde `opacity || 1` engole o ZERO: uma camada configurada
 *     como totalmente transparente e descrita (e desenhada) como opaca.
 *
 * O QUE ELA NAO ALCANCA:
 *
 *  - O `TerrainControl` como IControl: `onAdd`/`onRemove` tocam `document` e o barramento, e
 *    `_toggleTerrain`/`setHillshadeVisibility` sao orquestracao de MapLibre.
 *  - O painel de falha de camada e a agregacao por substantivo, ja presos por
 *    `aviso-de-camada-que-nao-carrega.test.js`. Aqui o painel so e alimentado com um `map.on`
 *    inerte.
 *  - Se `queryTerrainElevation` do MapLibre de fato devolve o que este duplo devolve.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `settings.operations.js` arrasta a store inteira e nada dela participa destes casos: o unico
// uso e `restoreLayersState`, que nenhum bloco chama.
vi.mock('../../src/js/store/settings.operations.js', () => ({
    getMapAnalysisLayersStates: async () => ({}),
}));

const { getTerrainElevation, default: TerrainControl } =
    await import('../../src/js/terrain/terrain.control.js');
const { DEFAULT_TERRAIN_EXAGGERATION } = await import('../../src/js/store/atlas/atlas.entity.js');
const { default: config } = await import('../../src/js/config.js');
const { default: AnalysisLayersManager } = await import('../../src/js/terrain/analysis-layers.manager.js');

/**
 * Map double for getTerrainElevation.
 * @param {number|undefined|null} exaggeration - what `getTerrain()` reports, or null for "off".
 * @param {(coord: *) => number|null} elevationAt - the queried elevation per coordinate.
 */
function terrainMap(exaggeration, elevationAt) {
    const queried = [];
    return {
        queried,
        getTerrain: () => (exaggeration === null ? null : { exaggeration }),
        queryTerrainElevation: async (coord, options) => {
            queried.push([coord, options]);
            return elevationAt(coord);
        },
    };
}

/** Elevation function: `alto` everywhere except the [0,0] reference point. */
const referencia = (noZero, alhures) => (coord) => {
    const [lng, lat] = Array.isArray(coord) ? coord : [coord.lng, coord.lat];
    return lng === 0 && lat === 0 ? noZero : alhures;
};

describe('1. getTerrainElevation: a altitude e relativa ao ponto fixo [0,0]', () => {
    it('sem terreno ligado devolve 0 e NAO consulta elevacao nenhuma', async () => {
        const m = terrainMap(null, () => 500);
        expect(await getTerrainElevation(m, [10, 10])).toBe(0);
        expect(m.queried).toHaveLength(0);
    });

    it('a diferenca contra [0,0] e dividida pelo exagero', async () => {
        // (100 - 20) / 2 = 40
        expect(await getTerrainElevation(terrainMap(2, referencia(20, 100)), [10, 10])).toBe(40);
    });

    it('o ponto de referencia consultado e literalmente [0, 0], e a consulta e feita DUAS vezes', async () => {
        const m = terrainMap(1, referencia(0, 30));
        await getTerrainElevation(m, [10, 10]);
        expect(m.queried).toHaveLength(2);
        expect(m.queried[0][0]).toEqual([0, 0]);
        expect(m.queried[1][0]).toEqual([10, 10]);
    });

    it('as opcoes recebidas viajam para as DUAS consultas, e o padrao e exagerado:false', async () => {
        const m = terrainMap(1, referencia(0, 10));
        await getTerrainElevation(m, [1, 1], { exaggerated: true });
        expect(m.queried.map(([, o]) => o)).toEqual([{ exaggerated: true }, { exaggerated: true }]);
        const m2 = terrainMap(1, referencia(0, 10));
        await getTerrainElevation(m2, [1, 1]);
        expect(m2.queried[0][1]).toEqual({ exaggerated: false });
    });

    it('elevacao ABAIXO da referencia devolve altitude negativa (o sinal e preservado)', async () => {
        expect(await getTerrainElevation(terrainMap(1, referencia(100, -50)), [1, 1])).toBe(-150);
    });

    it('BORDA: consulta que devolve null/undefined/NaN vira 0, e nao NaN propagado', async () => {
        for (const vazio of [null, undefined, NaN]) {
            const r = await getTerrainElevation(terrainMap(1, () => vazio), [1, 1]);
            expect(r).toBe(0);
            expect(Number.isNaN(r)).toBe(false);
        }
    });

    it('BORDA: exagero ausente cai no padrao 1.5 do proprio operador `||`', async () => {
        // 30 / 1.5 = 20
        expect(await getTerrainElevation(terrainMap(undefined, referencia(0, 30)), [1, 1])).toBe(20);
        expect(DEFAULT_TERRAIN_EXAGGERATION).toBe(1.5);
    });

    it('BORDA: coordenada em objeto {lng,lat} tambem e aceita', async () => {
        expect(await getTerrainElevation(terrainMap(1, referencia(0, 42)), { lng: 5, lat: 5 })).toBe(42);
    });
});

describe('2. o desacordo do arquivo consigo mesmo sobre o exagero ZERO', () => {
    it('CONSERTADO: `exaggeration: 0` nao e mais lido como 1.5, e nao vira Infinity', async () => {
        // Uma diferenca real de 80 m saia como 53.33, que nao era nem a altitude verdadeira nem um
        // erro: era a altitude dividida pelo exagero PADRAO, silenciosamente, porque 0 e falsy.
        // Com a cena achatada nao ha o que desexagerar, entao a resposta honesta e 0.
        const r = await getTerrainElevation(terrainMap(0, referencia(20, 100)), [1, 1]);
        expect(r).toBe(0);
        expect(Number.isFinite(r)).toBe(true);
        // CONTROLE: qualquer exagero finito e respeitado, o que prova que a asserção acima mede o
        // zero e nao um clamp geral.
        expect(await getTerrainElevation(terrainMap(4, referencia(20, 100)), [1, 1])).toBe(20);
        expect(await getTerrainElevation(terrainMap(0.5, referencia(20, 100)), [1, 1])).toBe(160);
    });

    it('CONSERTADO: exagero NaN cai no padrao, que `?? 1.5` nao teria garantido', async () => {
        expect(await getTerrainElevation(terrainMap(NaN, referencia(0, 30)), [1, 1])).toBe(20);
    });

    it('OBSERVADO: o controle continua ACEITANDO o zero e propagando para o mapa', () => {
        // O lado do ESCRITOR nao foi validado nesta passada: quem lia o valor e que discordava.
        const tc = new TerrainControl({ terrainSource: { type: 'raster-dem' } });
        expect(tc.terrainConfig).toEqual({ source: 'terrainSource', exaggeration: DEFAULT_TERRAIN_EXAGGERATION });
        tc.initExaggeration(0);
        expect(tc.terrainConfig.exaggeration).toBe(0);
    });

    it('BORDA: valores nao numericos tambem passam sem validacao', () => {
        const tc = new TerrainControl({ terrainSource: {} });
        tc.initExaggeration(NaN);
        expect(Number.isNaN(tc.terrainConfig.exaggeration)).toBe(true);
        tc.initExaggeration(-3);
        expect(tc.terrainConfig.exaggeration).toBe(-3);
    });
});

describe('3. setExaggeration toca o mapa, initExaggeration nao', () => {
    it('initExaggeration nunca chama setTerrain, mesmo com terreno ligado', () => {
        const chamadas = [];
        const tc = new TerrainControl({ terrainSource: {} });
        tc._map = { getTerrain: () => ({}), setTerrain: (c) => chamadas.push(c) };
        tc.initExaggeration(2.5);
        expect(chamadas).toHaveLength(0);
        expect(tc.terrainConfig.exaggeration).toBe(2.5);
    });

    it('setExaggeration aplica no mapa quando o terreno JA esta ligado', () => {
        const chamadas = [];
        const tc = new TerrainControl({ terrainSource: {} });
        tc._map = { getTerrain: () => ({}), setTerrain: (c) => chamadas.push(c) };
        tc.setExaggeration(2.5);
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0]).toEqual({ source: 'terrainSource', exaggeration: 2.5 });
    });

    it('setExaggeration com o terreno DESLIGADO guarda o valor e nao acende nada', () => {
        const chamadas = [];
        const tc = new TerrainControl({ terrainSource: {} });
        tc._map = { getTerrain: () => null, setTerrain: (c) => chamadas.push(c) };
        tc.setExaggeration(3);
        expect(chamadas).toHaveLength(0);
        expect(tc.terrainConfig.exaggeration).toBe(3);
    });

    it('setExaggeration SEM mapa nenhum nao lanca (o optional chaining e o guarda)', () => {
        const tc = new TerrainControl({ terrainSource: {} });
        expect(() => tc.setExaggeration(2)).not.toThrow();
        expect(tc.terrainConfig.exaggeration).toBe(2);
    });

    it('terrainConfig devolve um objeto NOVO a cada leitura, com a fonte fixa', () => {
        const tc = new TerrainControl({ terrainSource: {} });
        expect(tc.terrainConfig).not.toBe(tc.terrainConfig);
        expect(tc.terrainConfig.source).toBe('terrainSource');
    });
});

describe('4. _validateLayersConfig poda a config em vez de abortar o boot', () => {
    let original;
    beforeEach(() => { original = config.analysisLayers; });
    afterEach(() => { config.analysisLayers = original; });

    /** Runs the constructor (which validates) and returns the surviving ids. */
    function sobreviventes(layers, enabled = true) {
        config.analysisLayers = { enabled, layers };
        const gerente = new AnalysisLayersManager(mapaInerte());
        expect(gerente).toBeDefined();
        return (config.analysisLayers.layers || []).map(l => l.id);
    }

    it('a camada boa sobrevive e todas as quatro formas ruins caem', () => {
        const ids = sobreviventes([
            { id: 'boa', bounds: [-10, -10, 10, 10] },
            { id: 'sem-bounds' },
            { id: 'bounds-curto', bounds: [1, 2, 3] },
            { id: 'bounds-longo', bounds: [1, 2, 3, 4, 5] },
            { id: 'nao-array', bounds: 'oeste,sul,leste,norte' },
        ]);
        expect(ids).toHaveLength(1);
        expect(ids).toEqual(['boa']);
    });

    it('bounds degenerado (west === east ou south === north) e recusado', () => {
        expect(sobreviventes([
            { id: 'lng-igual', bounds: [10, -10, 10, 10] },
            { id: 'lat-igual', bounds: [-10, 5, 10, 5] },
            { id: 'invertido', bounds: [10, 10, -10, -10] },
        ])).toHaveLength(0);
    });

    it('OBSERVADO: bounds que cruza o antimeridiano (west > east) e recusado como invalido', () => {
        // Nao ha desenrolar: uma camada legitima sobre a linha de data e podada em silencio, com
        // aviso so no console. E o comportamento declarado no proprio `fileoverview` do metodo,
        // fixado aqui para que a mudanca seja deliberada.
        expect(sobreviventes([{ id: 'anti', bounds: [170, -10, -170, 10] }])).toHaveLength(0);
        // CONTROLE: o mesmo par de larguras sem cruzar a linha sobrevive.
        expect(sobreviventes([{ id: 'nao-anti', bounds: [-170, -10, 170, 10] }])).toEqual(['nao-anti']);
    });

    it('BORDA: bounds de largura minima positiva sobrevive (a comparacao e >=, nao >)', () => {
        expect(sobreviventes([{ id: 'fino', bounds: [0, 0, Number.MIN_VALUE, Number.MIN_VALUE] }]))
            .toEqual(['fino']);
    });

    it('com o sistema DESLIGADO a validacao nao roda e nada e podado', () => {
        expect(sobreviventes([{ id: 'sem-bounds' }], false)).toEqual(['sem-bounds']);
    });

    it('BORDA: `layers` que nao e array e deixado intacto, sem lancar', () => {
        config.analysisLayers = { enabled: true, layers: null };
        expect(() => new AnalysisLayersManager(mapaInerte())).not.toThrow();
        expect(config.analysisLayers.layers).toBeNull();
    });

    it('isEnabled exige `enabled === true` E pelo menos uma camada', () => {
        config.analysisLayers = { enabled: true, layers: [{ id: 'a', bounds: [-1, -1, 1, 1] }] };
        expect(new AnalysisLayersManager(mapaInerte()).isEnabled()).toBe(true);
        config.analysisLayers = { enabled: true, layers: [] };
        expect(new AnalysisLayersManager(mapaInerte()).isEnabled()).toBe(false);
        config.analysisLayers = { enabled: 'sim', layers: [{ id: 'a', bounds: [-1, -1, 1, 1] }] };
        expect(new AnalysisLayersManager(mapaInerte()).isEnabled()).toBe(false);
    });
});

describe('5. o descritor de estilo da analise, e o zero que ele engole', () => {
    let original;
    beforeEach(() => { original = config.analysisLayers; });
    afterEach(() => { config.analysisLayers = original; });

    function gerente(layers) {
        config.analysisLayers = { enabled: true, layers };
        return new AnalysisLayersManager(mapaInerte());
    }

    it('CONSERTADO: `opacity: 0` e descrito (e desenhado) como 0, o `|| 1` engolia o zero', () => {
        const m = gerente([{ id: 'transparente', bounds: [-1, -1, 1, 1], opacity: 0 }]);
        expect(m.getStyleDescriptor('transparente').sublayers.raster.values['raster-opacity']).toBe(0);
        // CONTROLE: a opacidade AUSENTE continua caindo em 1, e uma fracao continua respeitada,
        // o que prova que a asserção acima mede o zero e nao a remocao do padrao.
        const m2 = gerente([{ id: 'meia', bounds: [-1, -1, 1, 1], opacity: 0.5 }]);
        expect(m2.getStyleDescriptor('meia').sublayers.raster.values['raster-opacity']).toBe(0.5);
        const m3 = gerente([{ id: 'sem', bounds: [-1, -1, 1, 1] }]);
        expect(m3.getStyleDescriptor('sem').sublayers.raster.values['raster-opacity']).toBe(1);
    });

    it('CONSERTADO: opacidade NaN cai em 1, porque `??` sozinho a deixaria passar', () => {
        const m = gerente([{ id: 'nan', bounds: [-1, -1, 1, 1], opacity: NaN }]);
        expect(m.getStyleDescriptor('nan').sublayers.raster.values['raster-opacity']).toBe(1);
    });

    it('a camada ADICIONADA ao mapa carrega a mesma opacidade que o descritor promete', () => {
        // O descritor so vale se espelhar o `_addAnalysisLayer`, e o zero e onde isso se mede.
        const map = mapaInerte();
        config.analysisLayers = { enabled: true, layers: [{ id: 'transparente', bounds: [-1, -1, 1, 1], opacity: 0, source: {} }] };
        const m = new AnalysisLayersManager(map);
        m._addAnalysisLayer(config.analysisLayers.layers[0]);
        const adicionada = map.added.find(l => l.id === 'analysis-transparente-layer');
        expect(adicionada.paint['raster-opacity']).toBe(0);
        expect(adicionada.paint['raster-opacity'])
            .toBe(m.getStyleDescriptor('transparente').sublayers.raster.values['raster-opacity']);
    });

    it('as demais propriedades usam `??`, entao o ZERO delas sobrevive', () => {
        const m = gerente([{
            id: 'a', bounds: [-1, -1, 1, 1],
            paint: { 'raster-brightness-max': 0, 'raster-contrast': 0, 'raster-saturation': -1 },
        }]);
        const v = m.getStyleDescriptor('a').sublayers.raster.values;
        expect(v['raster-brightness-max']).toBe(0);
        expect(v['raster-contrast']).toBe(0);
        expect(v['raster-saturation']).toBe(-1);
        expect(v['raster-hue-rotate']).toBe(0);
    });

    it('camada inexistente devolve descritor completo com os padroes, sem lancar', () => {
        const m = gerente([{ id: 'a', bounds: [-1, -1, 1, 1] }]);
        const d = m.getStyleDescriptor('fantasma');
        expect(d.kind).toBe('raster');
        expect(d.sublayers.raster.present).toBe(true);
        expect(d.sublayers.raster.values['raster-opacity']).toBe(1);
    });

    it('applyStyleOverrides escreve o merge no mapa, e nao escreve nada se a camada nao existe', () => {
        const map = mapaInerte();
        config.analysisLayers = { enabled: true, layers: [{ id: 'a', bounds: [-1, -1, 1, 1], opacity: 0.4 }] };
        const m = new AnalysisLayersManager(map);
        m.applyStyleOverrides('a', { raster: { 'raster-contrast': 0.7 } });
        expect(Object.keys(map.paint)).toHaveLength(0);
        map.layers.add('analysis-a-layer');
        m.applyStyleOverrides('a', { raster: { 'raster-contrast': 0.7 } });
        const escrito = map.paint['analysis-a-layer'];
        expect(Object.keys(escrito)).toHaveLength(6);
        expect(escrito['raster-contrast']).toBe(0.7);
        expect(escrito['raster-opacity']).toBe(0.4);
    });

    it('overrides ausente/nulo escreve so os padroes, sem lancar', () => {
        const map = mapaInerte();
        config.analysisLayers = { enabled: true, layers: [{ id: 'a', bounds: [-1, -1, 1, 1] }] };
        const m = new AnalysisLayersManager(map);
        map.layers.add('analysis-a-layer');
        expect(() => m.applyStyleOverrides('a', null)).not.toThrow();
        expect(map.paint['analysis-a-layer']['raster-opacity']).toBe(1);
    });

    it('setPaintProperty que lanca numa propriedade nao derruba as demais', () => {
        const map = mapaInerte();
        map.failPaint = 'raster-contrast';
        config.analysisLayers = { enabled: true, layers: [{ id: 'a', bounds: [-1, -1, 1, 1] }] };
        const m = new AnalysisLayersManager(map);
        map.layers.add('analysis-a-layer');
        expect(() => m.applyStyleOverrides('a', {})).not.toThrow();
        expect(Object.keys(map.paint['analysis-a-layer'])).toHaveLength(5);
    });
});

/** Map double that satisfies the failure-notice registration without doing anything. */
function mapaInerte() {
    return {
        layers: new Set(), sources: new Set(), added: [], paint: {}, layout: {},
        failPaint: null,
        on() {}, off() {},
        getLayer(id) { return this.layers.has(id) ? { id } : undefined; },
        getSource(id) { return this.sources.has(id) ? { id } : undefined; },
        addSource(id) { this.sources.add(id); },
        removeSource(id) { this.sources.delete(id); },
        addLayer(l) { this.layers.add(l.id); this.added.push(l); },
        removeLayer(id) { this.layers.delete(id); },
        setPaintProperty(id, prop, value) {
            if (prop === this.failPaint) throw new Error('paint refused');
            (this.paint[id] ||= {})[prop] = value;
        },
        setLayoutProperty(id, prop, value) { (this.layout[id] ||= {})[prop] = value; },
        getLayoutProperty(id, prop) { return this.layout[id]?.[prop]; },
        getStyle: () => ({ sources: {} }),
        fitBounds() {},
    };
}
