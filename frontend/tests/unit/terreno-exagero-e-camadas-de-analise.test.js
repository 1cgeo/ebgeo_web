// Path: tests/unit/terreno-exagero-e-camadas-de-analise.test.js

/**
 * @fileoverview O EXAGERO DE TERRENO E O QUE ELE DIVIDE (`terrain/terrain.control.js`), mais a
 * validacao e o descritor de estilo das camadas de analise
 * (`terrain/analysis-layers.manager.js`).
 *
 * O QUE ESTA SUITE PRENDE:
 *
 *  1. `getTerrainElevation`, reescrita em 2026-09-04 e hoje morando em
 *     `terrain/terrain-elevation.js` (o controle a REEXPORTA, e e por esse caminho historico que
 *     esta suite a alcanca): o terreno ausente devolve 0 sem consultar nada, a consulta e UMA por
 *     amostra, e o resultado e dividido pelo exagero para desfazer o esticamento visual.
 *
 *     O QUE MUDOU E POR QUE. Ate aqui a funcao consultava DUAS vezes, a amostra e um ponto fixo em
 *     [0, 0], e subtraia a segunda da primeira. Lido no bundle vendorizado, o valor que o MapLibre
 *     5.18 devolve e `getDEMElevation(...) * exaggeration`, sem termo de camera: nao ha
 *     deslocamento a cancelar, entao a subtracao so tirava a altitude do ponto de referencia da
 *     altitude pedida. Onde o DEM cobre [0, 0] (oceano, altitude 0) a conta acertava por acidente;
 *     onde nao cobre, `queryTerrainElevation` devolve 0 e o acidente vira acerto de novo. O preco
 *     era o dobro das consultas em toda leitura de terreno do aplicativo, cada uma com uma
 *     travessia inteira de `coveringTiles`. O argumento `options` some junto, e por motivo
 *     independente: `Map.queryTerrainElevation(e)` do bundle repassa so a coordenada, entao o
 *     `{ exaggerated: false }` que este arquivo mandava nunca teve leitor.
 *  2. O EXAGERO ZERO e o exagero AUSENTE, medidos nas duas pontas: o controle ACEITA e propaga
 *     `exaggeration: 0` (`initExaggeration`/`setExaggeration` nao clampam), e a leitura responde 0
 *     para a cena achatada em vez de dividir por um padrao. O divisor do exagero ausente e 1, e
 *     nao o `DEFAULT_TERRAIN_EXAGGERATION` de 1.5 da aplicacao, porque quem divide tem de espelhar
 *     o que o MAPA aplicou, e o construtor de `Terrain` do bundle escreve
 *     `this.exaggeration = typeof options.exaggeration === 'number' ? options.exaggeration : 1`.
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
        queryTerrainElevation: (coord, options) => {
            queried.push([coord, options]);
            return elevationAt(coord);
        },
    };
}

/**
 * Elevation function: `alto` everywhere except at [0, 0].
 *
 * O ponto fixo deixou de ser consultado, e este duplo continua distinguindo os dois valores
 * DE PROPOSITO: e ele que reprova um retorno do ponto de referencia, porque uma leitura que
 * voltasse a subtrair [0, 0] devolveria a diferenca em vez de `alhures`.
 */
const referencia = (noZero, alhures) => (coord) => {
    const [lng, lat] = Array.isArray(coord) ? coord : [coord.lng, coord.lat];
    return lng === 0 && lat === 0 ? noZero : alhures;
};

describe('1. getTerrainElevation: UMA consulta por amostra, sem ponto fixo', () => {
    it('sem terreno ligado devolve 0 e NAO consulta elevacao nenhuma', () => {
        const m = terrainMap(null, () => 500);
        expect(getTerrainElevation(m, [10, 10])).toBe(0);
        expect(m.queried).toHaveLength(0);
    });

    it('a elevacao lida e dividida pelo exagero, sem descontar ponto nenhum', () => {
        // 100 / 2 = 50. Com a subtracao do ponto fixo dava (100 - 20) / 2 = 40, e os 20 m do
        // outro lado do planeta nao tinham por que entrar nesta conta.
        expect(getTerrainElevation(terrainMap(2, referencia(20, 100)), [10, 10])).toBe(50);
    });

    it('a consulta e UMA so, e e a da coordenada pedida', () => {
        const m = terrainMap(1, referencia(0, 30));
        getTerrainElevation(m, [10, 10]);
        expect(m.queried).toHaveLength(1);
        expect(m.queried[0][0]).toEqual([10, 10]);
    });

    it('a consulta viaja SEM opcoes: o segundo argumento do MapLibre nao existe', () => {
        // `Map.queryTerrainElevation(e)` do bundle repassa so a coordenada. Mandar um objeto
        // de opcoes era escrita para ninguem ler, e o `{ exaggerated: false }` que morava aqui
        // sugeria um controle que nunca houve.
        const m = terrainMap(1, referencia(0, 10));
        getTerrainElevation(m, [1, 1]);
        expect(m.queried[0][1]).toBeUndefined();
    });

    it('elevacao NEGATIVA e devolvida como negativa (o sinal e preservado)', () => {
        expect(getTerrainElevation(terrainMap(1, referencia(100, -50)), [1, 1])).toBe(-50);
    });

    it('BORDA: consulta que devolve null/undefined/NaN vira 0, e nao NaN propagado', () => {
        for (const vazio of [null, undefined, NaN]) {
            const r = getTerrainElevation(terrainMap(1, () => vazio), [1, 1]);
            expect(r).toBe(0);
            expect(Number.isNaN(r)).toBe(false);
        }
    });

    it('BORDA: exagero ausente divide por 1, que e o que o MAPA aplicou, e nao por 1.5', () => {
        // O padrao do MapLibre e 1 (`typeof options.exaggeration === 'number' ? ... : 1`); o
        // 1.5 e o padrao com que a APLICACAO liga o terreno, e dividir por ele um valor que o
        // mapa nunca esticou inventava uma altitude 33% menor.
        expect(getTerrainElevation(terrainMap(undefined, referencia(0, 30)), [1, 1])).toBe(30);
        // CONTROLE: o padrao da aplicacao continua sendo 1.5, e continua sendo o que o controle
        // manda para o mapa. As duas coisas convivem, e a divisao segue a do mapa.
        expect(DEFAULT_TERRAIN_EXAGGERATION).toBe(1.5);
        expect(getTerrainElevation(terrainMap(1.5, referencia(0, 30)), [1, 1])).toBe(20);
    });

    it('BORDA: coordenada em objeto {lng,lat} tambem e aceita', () => {
        expect(getTerrainElevation(terrainMap(1, referencia(0, 42)), { lng: 5, lat: 5 })).toBe(42);
    });

    it('a assinatura segue AGUARDAVEL, porque uma duzia de chamadores a trata como promessa', async () => {
        expect(await getTerrainElevation(terrainMap(2, referencia(20, 100)), [10, 10])).toBe(50);
    });
});

/**
 * Map double that OBEYS the physics the bundle implements: what the terrain returns is
 * `DEM * exaggeration` (`getElevation(...) { return this.getDEMElevation(...) * this.exaggeration }`).
 *
 * O `terrainMap` acima e o duplo de LEITURA: ele devolve o que se manda, e por isso mede o que a
 * funcao faz com um numero. Este mede a VOLTA INTEIRA, e e o unico que pode dizer se a divisao
 * devolve o relevo de verdade. Foi ele quem pegou o unico caso em que os dois discordam: com
 * exagero 0 o duplo de leitura pode devolver 100, e o mapa de verdade NAO pode.
 * @param {number|undefined} exaggeration - exagero declarado no terreno
 * @param {(coord: *) => number} demAt - o DEM cru, em metros
 * @returns {Object} duplo de mapa
 */
function mapaFisico(exaggeration, demAt) {
    const aplicado = typeof exaggeration === 'number' ? exaggeration : 1;
    return {
        getTerrain: () => ({ exaggeration }),
        queryTerrainElevation: (coord) => demAt(coord) * aplicado,
    };
}

describe('2. o exagero ZERO e o exagero ausente', () => {
    it('CONSERTADO: `exaggeration: 0` nao e mais lido como 1.5, e nao vira Infinity', () => {
        // Uma altitude real de 100 m saia como 66.67, que nao era nem a altitude verdadeira nem um
        // erro: era a leitura dividida pelo exagero PADRAO, silenciosamente, porque 0 e falsy.
        // Com a cena achatada a leitura ja e 0, e nao ha o que desexagerar.
        const r = getTerrainElevation(mapaFisico(0, () => 100), [1, 1]);
        expect(r).toBe(0);
        expect(Number.isFinite(r)).toBe(true);
        // CONTROLE: com exagero finito e positivo a volta inteira devolve o DEM de verdade, o que
        // prova que a asserção acima mede o achatamento e nao um clamp geral.
        expect(getTerrainElevation(mapaFisico(4, () => 100), [1, 1])).toBe(100);
        expect(getTerrainElevation(mapaFisico(0.5, () => 100), [1, 1])).toBe(100);
        expect(getTerrainElevation(mapaFisico(1.5, () => 100), [1, 1])).toBe(100);
    });

    it('o divisor e o do MAPA: exagero ausente ja chega sem esticar, e sai inteiro', () => {
        // O `?? 1.5` da versao antiga dividia por 1.5 um valor que o mapa nunca multiplicou, e
        // devolvia 66.67 m para um morro de 100 m.
        expect(getTerrainElevation(mapaFisico(undefined, () => 100), [1, 1])).toBe(100);
    });

    it('BORDA: o duplo de leitura sozinho NAO reprovaria o exagero zero, e por isso ha dois', () => {
        // Registro do porque o `mapaFisico` existe: aqui o mapa afirma exagero 0 e devolve 100,
        // o que nenhum mapa faz. A funcao entao passa o valor adiante (divisor 1), e uma suite
        // que so tivesse este duplo aprovaria qualquer divisor para o zero.
        expect(getTerrainElevation(terrainMap(0, () => 100), [1, 1])).toBe(100);
    });

    it('CONSERTADO: exagero NaN divide por 1, que `?? 1` nao teria garantido', () => {
        expect(getTerrainElevation(terrainMap(NaN, referencia(0, 30)), [1, 1])).toBe(30);
    });

    it('BORDA: exagero NEGATIVO tambem cai em 1, e nao inverte o sinal da altitude', () => {
        // Nada impede o controle de aceitar -3 (o caso logo abaixo mede isso), e uma altitude de
        // 30 m que voltasse como -10 seria pior que um erro.
        expect(getTerrainElevation(terrainMap(-3, referencia(0, 30)), [1, 1])).toBe(30);
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

describe('6. os bounds validados chegam a FONTE, e nao so ao fitBounds', () => {
    let original;
    beforeEach(() => { original = config.analysisLayers; });
    afterEach(() => { config.analysisLayers = original; });

    /**
     * Adds one layer through the manager and returns the config its source received.
     * @param {Object} camada - a linha de `config.analysisLayers.layers`
     * @returns {Object} a config entregue a `map.addSource`
     */
    function fonteDe(camada) {
        const map = mapaInerte();
        config.analysisLayers = { enabled: true, layers: [camada] };
        const gerente = new AnalysisLayersManager(map);
        gerente._addAnalysisLayer(config.analysisLayers.layers[0]);
        expect(map.fontesAdicionadas).toHaveLength(1);
        return map.fontesAdicionadas[0].cfg;
    }

    it('a caixa da camada entra na fonte quando a fonte nao declara a dela', () => {
        // Sem bounds, o MapLibre pede um tile para cada posicao da tela, tenha cobertura ou
        // nao, e cada erro volta como requisicao mais evento de erro. A caixa ja era validada
        // (secao 4) e usada no `fitBounds`, e parava ali.
        const cfg = fonteDe({ id: 'a', bounds: [-45, -23, -44, -22], source: { type: 'raster-dem', url: 'x' } });
        expect(cfg.bounds).toEqual([-45, -23, -44, -22]);
        expect(cfg.type).toBe('raster-dem');
        expect(cfg.url).toBe('x');
    });

    it('a caixa da PROPRIA fonte vence a da camada, e nao e sobrescrita', () => {
        // Uma fonte servida por TileJSON traz os bounds do servidor, que sao os verdadeiros.
        const cfg = fonteDe({
            id: 'a', bounds: [-45, -23, -44, -22],
            source: { type: 'raster-dem', url: 'x', bounds: [-50, -30, -40, -20] },
        });
        expect(cfg.bounds).toEqual([-50, -30, -40, -20]);
    });

    it('o objeto de config do usuario NAO e mutado: a fonte recebe uma copia', () => {
        const camada = { id: 'a', bounds: [-45, -23, -44, -22], source: { type: 'raster-dem', url: 'x' } };
        const cfg = fonteDe(camada);
        expect(camada.source.bounds).toBeUndefined();
        expect(cfg).not.toBe(camada.source);
    });

    it('BORDA: camada sem caixa passa a fonte INTOCADA, e pelo mesmo objeto', () => {
        // A validacao da secao 4 poda a camada sem bounds antes de chegar aqui, mas o
        // `_addAnalysisLayer` tambem e chamado direto (retentativa, troca de base).
        const map = mapaInerte();
        config.analysisLayers = { enabled: true, layers: [] };
        const gerente = new AnalysisLayersManager(map);
        const fonte = { type: 'raster-dem', url: 'x' };
        gerente._addAnalysisLayer({ id: 'a', source: fonte });
        expect(map.fontesAdicionadas[0].cfg).toBe(fonte);
    });
});

/** Map double that satisfies the failure-notice registration without doing anything. */
function mapaInerte() {
    return {
        layers: new Set(), sources: new Set(), added: [], paint: {}, layout: {},
        fontesAdicionadas: [],
        failPaint: null,
        on() {}, off() {},
        getLayer(id) { return this.layers.has(id) ? { id } : undefined; },
        getSource(id) { return this.sources.has(id) ? { id } : undefined; },
        // A CONFIG da fonte fica guardada, e nao so o id: o que a fonte recebe decide de que
        // area o MapLibre pede tile.
        addSource(id, cfg) { this.sources.add(id); this.fontesAdicionadas.push({ id, cfg }); },
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
