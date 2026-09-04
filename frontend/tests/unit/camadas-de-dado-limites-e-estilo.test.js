// Path: tests/unit/camadas-de-dado-limites-e-estilo.test.js

/**
 * @fileoverview A CAIXA E O ESTILO DAS CAMADAS DE DADO (`terrain/data-layers.manager.js`), que sao
 * as duas metades do arquivo que ninguem ainda mediu: `aviso-de-camada-que-nao-carrega.test.js`
 * prende o painel de falha, a agregacao e a fiacao dos registradores, e nada mais.
 *
 * O QUE ESTA SUITE PRENDE:
 *
 *  1. `_calculateBounds` (alcancada por `zoomToLayer`): a recursao de profundidade arbitraria, o
 *     sentinel `Infinity` que significa "nenhum ponto" e vira `null`, o ponto unico que produz
 *     caixa degenerada, e o que acontece com NaN dentro das coordenadas.
 *  2. A CASCATA de origens: feicoes desenhadas da borda, depois da area, e so entao a consulta a
 *     FONTE. Cada degrau e medido isolado, senao um `if` invertido passaria verde.
 *  3. O descritor de estilo vetorial, onde `border.width || 1` e `border.opacity || 1` ENGOLEM o
 *     zero enquanto `fill.opacity ?? 1` o preserva. Os dois estao no mesmo objeto, a tres linhas
 *     de distancia, e as duas metades sao medidas juntas.
 *  4. `maxzoom: 0` virando 22 na camada realmente adicionada ao mapa (`|| 22`), enquanto
 *     `minzoom: 0` sobrevive por coincidencia aritmetica (`0 || 0`).
 *  5. O roteamento de `applyStyleOverrides` entre paint e layout (`LAYOUT_PROPS`), e o descarte de
 *     `undefined`/`null`.
 *  6. OBSERVADO: o simbolo de marcador RECUSADO pelo registrador ainda e referenciado como
 *     `icon-image` pela sub-camada de rotulo, deixando a camada apontando para uma imagem que
 *     nunca foi registrada.
 *
 * O QUE ELA NAO ALCANCA:
 *
 *  - O painel de falha, a agregacao por camada, a retirada da acusacao e `_layerIdFromSourceId`,
 *    ja presos por `aviso-de-camada-que-nao-carrega.test.js`. Aqui o painel so recebe um mapa
 *    inerte.
 *  - `generatePointImage` de verdade: ele precisa de um canvas 2D, e o duplo usado aqui devolve
 *    pixels vazios. O que se afirma e QUEM chama e com quais argumentos, nunca a imagem.
 *  - Se o MapLibre desenha o que essas definicoes descrevem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/js/store/settings.operations.js', () => ({
    getMapAnalysisLayersStates: async () => ({}),
}));

const { default: config } = await import('../../src/js/config.js');
const { default: DataLayersManager } = await import('../../src/js/terrain/data-layers.manager.js');
const { LAYOUT_PROPS } = await import('../../src/js/layers/layer-style/layer-style.schema.js');

/** Map double: records everything the manager writes, decides nothing on its own. */
function mapaDuplo({ rendered = [], sourceFeatures = [] } = {}) {
    return {
        layers: new Set(), sources: new Set(), images: new Set(),
        added: [], paint: {}, layout: {}, imageOpts: null, fit: null,
        renderedQueries: [], sourceQueries: [], fontesAdicionadas: [],
        on() {}, off() {},
        getLayer(id) { return this.layers.has(id) ? { id } : undefined; },
        getSource(id) { return this.sources.has(id) ? { id } : undefined; },
        // A CONFIG da fonte fica guardada, e nao so o id: o que a fonte recebe decide de
        // que area o MapLibre pede tile, e sem isso a caixa da camada nao tem como ser
        // medida do lado de dentro.
        addSource(id, cfg) { this.sources.add(id); this.fontesAdicionadas.push({ id, cfg }); },
        removeSource(id) { this.sources.delete(id); },
        addLayer(l) { this.layers.add(l.id); this.added.push(l); },
        removeLayer(id) { this.layers.delete(id); },
        hasImage(id) { return this.images.has(id); },
        addImage(id, data, opts) { this.images.add(id); this.imageOpts = opts; },
        removeImage(id) { this.images.delete(id); },
        setPaintProperty(id, p, v) { (this.paint[id] ||= {})[p] = v; },
        setLayoutProperty(id, p, v) { (this.layout[id] ||= {})[p] = v; },
        getLayoutProperty(id, p) { return this.layout[id]?.[p]; },
        queryRenderedFeatures(opts) {
            this.renderedQueries.push(opts.layers[0]);
            return typeof rendered === 'function' ? rendered(opts.layers[0]) : rendered;
        },
        querySourceFeatures(id, opts) { this.sourceQueries.push([id, opts]); return sourceFeatures; },
        fitBounds(b, o) { this.fit = [b, o]; },
        getStyle: () => ({ sources: {} }),
    };
}

let original;
beforeEach(() => { original = config.dataLayers; });
afterEach(() => { config.dataLayers = original; });

/** Installs one layer config and returns [manager, map]. */
function comCamada(layerConfig, mapOpts) {
    config.dataLayers = { enabled: true, layers: [layerConfig] };
    const map = mapaDuplo(mapOpts);
    return [new DataLayersManager(map), map];
}

const geo = (coordinates) => ({ geometry: { coordinates } });

describe('1. a caixa envolvente, e o sentinel que significa "nenhum ponto"', () => {
    /** Runs zoomToLayer against `features` rendered on the border sub-layer. */
    function caixa(features) {
        const [m, map] = comCamada({ id: 'a', source: {} }, { rendered: features });
        map.layers.add('data-a-border');
        m.zoomToLayer('a');
        return map.fit?.[0] ?? null;
    }

    it('um par de pontos vira [[oeste,sul],[leste,norte]]', () => {
        expect(caixa([geo([[[0, 0], [10, 5]]])])).toEqual([[0, 0], [10, 5]]);
    });

    it('a recursao desce por profundidade arbitraria (MultiPolygon aninhado)', () => {
        expect(caixa([geo([[[[[[-3, -4]]]]], [[[[[7, 8]]]]]])])).toEqual([[-3, -4], [7, 8]]);
    });

    it('MultiPolygon e LineString com os MESMOS pontos dao a MESMA caixa', () => {
        const mesmaCaixa = [[-3, -4], [7, 8]];
        expect(caixa([geo([[-3, -4], [7, 8]])])).toEqual(mesmaCaixa);
        expect(caixa([geo([[[[-3, -4], [7, 8]]]])])).toEqual(mesmaCaixa);
    });

    it('BORDA: ponto UNICO produz caixa degenerada, nao null', () => {
        expect(caixa([geo([5, 6])])).toEqual([[5, 6], [5, 6]]);
    });

    it('BORDA: lista vazia, geometria ausente e coordinates vazio devolvem null (nada de Infinity)', () => {
        expect(caixa([])).toBeNull();
        expect(caixa([{ properties: {} }])).toBeNull();
        expect(caixa([{ geometry: { coordinates: [] } }])).toBeNull();
        expect(caixa([{ geometry: null }])).toBeNull();
    });

    it('BORDA: todas as coordenadas NaN devolvem null, e nao os sentinels Infinity', () => {
        // Nenhuma comparacao com NaN e verdadeira, entao os quatro sentinels ficam intactos e a
        // guarda `minLng === Infinity` devolve null. A caixa NAO vaza Infinity para o fitBounds.
        const b = caixa([geo([[NaN, NaN], [NaN, NaN]])]);
        expect(b).toBeNull();
    });

    it('CONSERTADO: NaN MISTURADO e descartado por PAR, e nao encolhe a caixa pela metade', () => {
        // O ponto [NaN,0] nao entrava em nenhuma das quatro comparacoes, entao a caixa ficava sendo
        // a do unico ponto valido, com a LATITUDE 0 do ponto ruim sobrevivendo. Agora o par inteiro
        // sai, e a caixa e exatamente a do ponto que restou.
        expect(caixa([geo([[NaN, 0], [10, 5]])])).toEqual([[10, 5], [10, 5]]);
        expect(caixa([geo([[10, NaN], [10, 5]])])).toEqual([[10, 5], [10, 5]]);
        expect(caixa([geo([[Infinity, 0], [10, 5]])])).toEqual([[10, 5], [10, 5]]);
        // CONTROLE: os dois pontos validos produzem a caixa larga, provando que a asserção acima
        // mede o descarte do NaN e nao um bug do duplo.
        expect(caixa([geo([[2, 0], [10, 5]])])).toEqual([[2, 0], [10, 5]]);
    });

    it('CONSERTADO: um poligono cruzando o antimeridiano e desenrolado, nao invertido', () => {
        // [-179, 179] passava sem desenrolar: fitBounds recebia um retangulo que atravessava
        // Greenwich em vez do Pacifico, e o mapa se afastava ate caber o planeta. O vao vazio de
        // 358 graus e o descartado, e o leste sai alem de 180 para manter oeste < leste.
        expect(caixa([geo([[179, 0], [-179, 1]])])).toEqual([[179, 0], [181, 1]]);
    });

    it('CONTROLE: uma caixa que NAO cruza a linha continua sendo a de min/max', () => {
        // Sem estes tres o desenrolar poderia estar aplicado a tudo, e a asserção acima passaria
        // com o codigo errado. O de 160 graus e o mais exigente: ele e largo e mesmo assim o vao
        // vazio que sobra (200 graus, pelo Pacifico) continua sendo o maior.
        expect(caixa([geo([[-10, 0], [10, 1]])])).toEqual([[-10, 0], [10, 1]]);
        expect(caixa([geo([[-80, 0], [80, 1]])])).toEqual([[-80, 0], [80, 1]]);
        expect(caixa([geo([[-74, -33], [-34, 5]])])).toEqual([[-74, -33], [-34, 5]]);
    });

    it('OBSERVADO: com so DOIS pontos a 178 graus de distancia, o arco mais justo e o do Pacifico', () => {
        // [-179, 179] e ambiguo por construcao: as duas leituras contem os dois pontos, uma com
        // 2 graus de largura e a outra com 358. A heuristica escolhe a justa, e isso e a decisao,
        // nao um efeito colateral.
        expect(caixa([geo([[-179, 0], [179, 1]])])).toEqual([[179, 0], [181, 1]]);
    });

    it('CONTROLE: o desenrolar escolhe o MAIOR vao, com tres pontos em volta da linha', () => {
        expect(caixa([geo([[178, 0], [-178, 0], [-179, 1]])])).toEqual([[178, 0], [182, 1]]);
    });

    it('BORDA: -0 nao quebra a comparacao de minimo', () => {
        expect(caixa([geo([[-0, -0], [1, 1]])])).toEqual([[-0, -0], [1, 1]]);
    });
});

describe('2. a cascata de origens: borda, area e so entao a fonte', () => {
    it('a borda e consultada PRIMEIRO, e a area nem chega a ser perguntada', () => {
        const [m, map] = comCamada({ id: 'a', source: {} }, { rendered: [geo([1, 2])] });
        map.layers.add('data-a-border');
        map.layers.add('data-a-fill');
        m.zoomToLayer('a');
        expect(map.renderedQueries).toHaveLength(1);
        expect(map.renderedQueries).toEqual(['data-a-border']);
    });

    it('borda vazia cai para a area', () => {
        const rendered = (layerId) => (layerId === 'data-a-fill' ? [geo([3, 4])] : []);
        const [m, map] = comCamada({ id: 'a', source: {} }, { rendered });
        map.layers.add('data-a-border');
        map.layers.add('data-a-fill');
        m.zoomToLayer('a');
        expect(map.renderedQueries).toEqual(['data-a-border', 'data-a-fill']);
        expect(map.fit[0]).toEqual([[3, 4], [3, 4]]);
    });

    it('nada desenhado cai para a FONTE, com o sourceLayer da config', () => {
        const [m, map] = comCamada(
            { id: 'a', source: {}, sourceLayer: 'molduras' },
            { rendered: [], sourceFeatures: [geo([[8, 9], [10, 11]])] }
        );
        map.layers.add('data-a-border');
        map.sources.add('data-a');
        m.zoomToLayer('a');
        expect(map.sourceQueries).toHaveLength(1);
        expect(map.sourceQueries[0]).toEqual(['data-a', { sourceLayer: 'molduras' }]);
        expect(map.fit[0]).toEqual([[8, 9], [10, 11]]);
    });

    it('sem fonte no mapa, nao ha zoom nenhum e nada lanca', () => {
        const [m, map] = comCamada({ id: 'a', source: {} }, { rendered: [] });
        expect(() => m.zoomToLayer('a')).not.toThrow();
        expect(map.fit).toBeNull();
        expect(map.sourceQueries).toHaveLength(0);
    });

    it('camada sem config nenhuma nao consulta nem enquadra', () => {
        const [m, map] = comCamada({ id: 'a', source: {} });
        m.zoomToLayer('inexistente');
        expect(map.fit).toBeNull();
        expect(map.renderedQueries).toHaveLength(0);
    });

    it('o enquadramento leva as opcoes fixas (padding, duracao, essential)', () => {
        const [m, map] = comCamada({ id: 'a', source: {} }, { rendered: [geo([1, 2])] });
        map.layers.add('data-a-border');
        m.zoomToLayer('a');
        expect(map.fit[1]).toEqual({ padding: 20, duration: 1000, essential: true });
    });
});

describe('3. o descritor vetorial: onde o zero sobrevive e onde ele e engolido', () => {
    it('OBSERVADO: largura e opacidade de BORDA zero viram 1; opacidade de AREA zero sobrevive', () => {
        const [m] = comCamada({
            id: 'a', source: {},
            style: { fill: { opacity: 0 }, border: { width: 0, opacity: 0 } },
        });
        const v = m.getStyleDescriptor('a').sublayers;
        // `fill.opacity ?? 1` sempre preservou o zero...
        expect(v.fill.values['fill-opacity']).toBe(0);
        // ...e `border.width || 1` / `border.opacity || 1`, tres linhas abaixo, nao preservavam:
        // uma borda declarada como invisivel desenhava cheia. Agora as duas metades concordam.
        expect(v.border.values['line-width']).toBe(0);
        expect(v.border.values['line-opacity']).toBe(0);
    });

    it('CONTROLE: borda AUSENTE continua caindo em 1, e NaN tambem', () => {
        const [m] = comCamada({ id: 'a', source: {}, style: { border: { color: '#abc' } } });
        const b = m.getStyleDescriptor('a').sublayers.border.values;
        expect(b['line-width']).toBe(1);
        expect(b['line-opacity']).toBe(1);
        const [n] = comCamada({ id: 'b', source: {}, style: { border: { width: NaN, opacity: NaN } } });
        const nb = n.getStyleDescriptor('b').sublayers.border.values;
        expect(nb['line-width']).toBe(1);
        expect(nb['line-opacity']).toBe(1);
    });

    it('CONTROLE: valores truthy de borda passam intactos, provando que o caso acima mede o zero', () => {
        const [m] = comCamada({ id: 'a', source: {}, style: { border: { width: 3, opacity: 0.2 } } });
        const b = m.getStyleDescriptor('a').sublayers.border.values;
        expect(b['line-width']).toBe(3);
        expect(b['line-opacity']).toBe(0.2);
    });

    it('a camada ADICIONADA carrega os mesmos valores que o descritor promete', () => {
        // O descritor so vale se espelhar o `_addBorderLayer`, e o zero e onde isso se mede: as
        // duas metades erram JUNTAS, o que confirma que a borda de fato desenha com espessura 1.
        const [m, map] = comCamada({ id: 'a', source: {}, style: { border: { width: 0, opacity: 0 } } });
        m.addDataLayer('a');
        const borda = map.added.find(l => l.id === 'data-a-border');
        expect(borda.paint['line-width']).toBe(0);
        expect(borda.paint['line-opacity']).toBe(0);
        expect(borda.paint['line-width'])
            .toBe(m.getStyleDescriptor('a').sublayers.border.values['line-width']);
    });

    it('cor vazia cai no padrao, e cor declarada sobrevive', () => {
        const [m] = comCamada({ id: 'a', source: {}, style: { fill: { color: '' }, border: { color: '#abc' } } });
        const v = m.getStyleDescriptor('a').sublayers;
        expect(v.fill.values['fill-color']).toBe('rgba(0,0,0,0.1)');
        expect(v.border.values['line-color']).toBe('#abc');
    });

    it('`present` reflete a existencia da sub-config, nao a da camada no mapa', () => {
        const [m] = comCamada({ id: 'a', source: {}, style: { fill: {} } });
        const s = m.getStyleDescriptor('a').sublayers;
        expect(s.fill.present).toBe(true);
        expect(s.border.present).toBe(false);
        expect(s.label.present).toBe(false);
    });

    it('camada inexistente devolve descritor completo com padroes e tudo ausente', () => {
        const [m] = comCamada({ id: 'a', source: {} });
        const d = m.getStyleDescriptor('fantasma');
        expect(d.kind).toBe('vector');
        expect(Object.keys(d.sublayers)).toHaveLength(3);
        for (const sub of Object.values(d.sublayers)) expect(sub.present).toBe(false);
        expect(d.sublayers.fill.values['fill-opacity']).toBe(1);
    });

    it('o rotulo usa `??`, entao halo e tamanho ZERO sobrevivem', () => {
        const [m] = comCamada({
            id: 'a', source: {},
            style: { label: { paint: { 'text-halo-width': 0 }, layout: { 'text-size': 0 } } },
        });
        const v = m.getStyleDescriptor('a').sublayers.label.values;
        expect(v['text-halo-width']).toBe(0);
        expect(v['text-size']).toBe(0);
    });
});

describe('4. minzoom e maxzoom: o zero que sobrevive por acidente e o que nao', () => {
    it('CONSERTADO: `maxzoom: 0` fica em 0, e `minzoom: 0` continua em 0', () => {
        const [m, map] = comCamada({
            id: 'a', source: {}, minzoom: 0, maxzoom: 0,
            style: { fill: {}, border: {} },
        });
        m.addDataLayer('a');
        const fill = map.added.find(l => l.id === 'data-a-fill');
        // `minzoom || 0` engole o zero e devolve zero: o mesmo defeito, invisivel por acidente.
        expect(fill.minzoom).toBe(0);
        // `maxzoom || 22` engolia o zero e devolvia o teto: a camada configurada para nunca
        // aparecer aparecia em todos os zooms.
        expect(fill.maxzoom).toBe(0);
    });

    it('CONTROLE: maxzoom AUSENTE continua caindo em 22, nas tres sub-camadas', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: {}, border: {}, label: {} } });
        m.addDataLayer('a');
        for (const sufixo of ['fill', 'border', 'label']) {
            expect(map.added.find(l => l.id === `data-a-${sufixo}`).maxzoom, sufixo).toBe(22);
        }
    });

    it('CONTROLE: maxzoom truthy passa intacto', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, maxzoom: 12, style: { fill: {} } });
        m.addDataLayer('a');
        expect(map.added.find(l => l.id === 'data-a-fill').maxzoom).toBe(12);
    });

    it('labelMinzoom tem precedencia sobre minzoom, e o ZERO dele tambem e engolido', () => {
        const [m, map] = comCamada({
            id: 'a', source: {}, minzoom: 7, labelMinzoom: 0,
            style: { label: { textField: ['get', 'nome'] } },
        });
        m.addDataLayer('a');
        const label = map.added.find(l => l.id === 'data-a-label');
        expect(label.minzoom).toBe(7);
    });

    it('a sub-camada de rotulo nasce escondida e com o textField da config', () => {
        const [m, map] = comCamada({
            id: 'a', source: {},
            style: { label: { textField: ['get', 'nome'], layout: { 'text-anchor': 'top' } } },
        });
        m.addDataLayer('a');
        const label = map.added.find(l => l.id === 'data-a-label');
        expect(label.layout['text-field']).toEqual(['get', 'nome']);
        expect(label.layout['text-anchor']).toBe('top');
        expect(label.layout.visibility).toBe('none');
    });

    it('sem estilo de area nem de borda, essas sub-camadas nao sao criadas', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { label: {} } });
        m.addDataLayer('a');
        expect(map.added.map(l => l.id)).toEqual(['data-a-label']);
    });

    it('a segunda fonte (labelSource) recebe id proprio e alimenta so o rotulo', () => {
        const [m, map] = comCamada({
            id: 'a', source: {}, labelSource: { type: 'geojson' },
            style: { fill: {}, label: {} },
        });
        m.addDataLayer('a');
        expect([...map.sources].sort()).toEqual(['data-a', 'data-a-label-source']);
        expect(map.added.find(l => l.id === 'data-a-label').source).toBe('data-a-label-source');
        expect(map.added.find(l => l.id === 'data-a-fill').source).toBe('data-a');
    });

    it('camada sem config devolve false e nao toca no mapa', () => {
        const [m, map] = comCamada({ id: 'a', source: {} });
        expect(m.addDataLayer('fantasma')).toBe(false);
        expect(map.added).toHaveLength(0);
    });

    it('a segunda adicao da mesma camada nao duplica fonte nem sub-camada', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: {}, border: {} } });
        expect(m.addDataLayer('a')).toBe(true);
        expect(m.addDataLayer('a')).toBe(true);
        expect(map.added).toHaveLength(2);
    });
});

describe('5. applyStyleOverrides roteia entre paint e layout', () => {
    it('so `text-size` vai para layout; o resto vai para paint', () => {
        const [m, map] = comCamada({
            id: 'a', source: {},
            style: { fill: {}, label: { layout: { 'text-size': 12 } } },
        });
        map.layers.add('data-a-fill');
        map.layers.add('data-a-label');
        m.applyStyleOverrides('a', { label: { 'text-size': 30, 'text-color': '#fff' } });
        expect(LAYOUT_PROPS.has('text-size')).toBe(true);
        expect(map.layout['data-a-label']).toEqual({ 'text-size': 30 });
        expect(map.paint['data-a-label']['text-color']).toBe('#fff');
        expect(map.paint['data-a-label']['text-size']).toBeUndefined();
    });

    it('sub-camada ausente do mapa e pulada inteira', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: {}, border: {} } });
        map.layers.add('data-a-fill');
        m.applyStyleOverrides('a', {});
        expect(Object.keys(map.paint)).toEqual(['data-a-fill']);
    });

    it('sub-camada nao declarada na config e pulada mesmo existindo no mapa', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: {} } });
        map.layers.add('data-a-fill');
        map.layers.add('data-a-border');
        m.applyStyleOverrides('a', { border: { 'line-width': 9 } });
        expect(map.paint['data-a-border']).toBeUndefined();
    });

    it('OBSERVADO: override `undefined` APAGA a escrita do padrao, em vez de cair nele', () => {
        // `_setPaint` sai cedo em undefined/null, e o merge ja substituiu o padrao pelo undefined:
        // o resultado e que a propriedade nao e escrita de jeito nenhum, e a camada fica com o que
        // o MapLibre tinha antes.
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: { opacity: 0.3 } } });
        map.layers.add('data-a-fill');
        m.applyStyleOverrides('a', { fill: { 'fill-opacity': undefined } });
        expect(map.paint['data-a-fill']['fill-opacity']).toBeUndefined();
        expect(map.paint['data-a-fill']['fill-color']).toBe('rgba(0,0,0,0.1)');
        // CONTROLE: sem o override, o padrao 0.3 e escrito.
        m.applyStyleOverrides('a', {});
        expect(map.paint['data-a-fill']['fill-opacity']).toBe(0.3);
    });

    it('expressao dirigida por dado passa por referencia, sem ser interpretada', () => {
        const expr = ['case', ['==', ['get', 'tipo'], 'x'], '#f00', '#00f'];
        const [m, map] = comCamada({ id: 'a', source: {}, style: { fill: {} } });
        map.layers.add('data-a-fill');
        m.applyStyleOverrides('a', { fill: { 'fill-color': expr } });
        expect(map.paint['data-a-fill']['fill-color']).toBe(expr);
    });
});

describe('6. o marcador recusado que continua sendo referenciado', () => {
    it('CONSERTADO: simbolo "circle" e RECUSADO pelo registrador, e o rotulo NAO aponta para ele', () => {
        // `_registerMarkerImage` sai cedo em 'circle' (`needsPerFeatureImage` o exclui), sem
        // registrar imagem nenhuma; `_addLabelLayer` punha `icon-image` sempre que houvesse
        // `marker`, e a sub-camada nascia apontando para uma imagem que o mapa nao tem.
        const [m, map] = comCamada({
            id: 'a', source: {}, style: { label: {}, marker: { symbol: 'circle' } },
        });
        m.addDataLayer('a');
        expect([...map.images]).toHaveLength(0);
        const label = map.added.find(l => l.id === 'data-a-label');
        expect(label.layout['icon-image']).toBeUndefined();
        expect(map.hasImage('data-a-marker')).toBe(false);
    });

    it('CONSERTADO: simbolo inexistente tem o mesmo desfecho', () => {
        const [m, map] = comCamada({
            id: 'a', source: {}, style: { label: {}, marker: { symbol: 'nao-existe' } },
        });
        m.addDataLayer('a');
        expect([...map.images]).toHaveLength(0);
        expect(map.added.find(l => l.id === 'data-a-label').layout['icon-image']).toBeUndefined();
    });

    it('CONTROLE: a sub-camada de rotulo ainda NASCE, o marcador e que sai', () => {
        // Sem isto o conserto poderia ter deixado de criar a camada inteira, e a asserção acima
        // passaria por ausencia em vez de por correcao.
        const [m, map] = comCamada({
            id: 'a', source: {}, style: { label: { textField: ['get', 'nome'] }, marker: { symbol: 'circle' } },
        });
        m.addDataLayer('a');
        const label = map.added.find(l => l.id === 'data-a-label');
        expect(label).toBeDefined();
        expect(label.layout['text-field']).toEqual(['get', 'nome']);
    });

    it('CONTROLE: com a imagem JA registrada, a referencia resolve, e a asserção acima discrimina', () => {
        const [m, map] = comCamada({
            id: 'a', source: {}, style: { label: {}, marker: { symbol: 'circle' } },
        });
        map.images.add('data-a-marker');
        m.addDataLayer('a');
        expect(map.hasImage('data-a-marker')).toBe(true);
        expect(map.added.find(l => l.id === 'data-a-label').layout['icon-image']).toBe('data-a-marker');
    });

    it('o autor pode declarar o proprio icon-image, e ele NAO e sobrescrito', () => {
        const [m, map] = comCamada({
            id: 'a', source: {},
            style: { label: { layout: { 'icon-image': 'meu-icone' } }, marker: { symbol: 'circle' } },
        });
        m.addDataLayer('a');
        expect(map.added.find(l => l.id === 'data-a-label').layout['icon-image']).toBe('meu-icone');
    });

    it('sem marcador nenhum, nao ha icon-image na sub-camada de rotulo', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { label: {} } });
        m.addDataLayer('a');
        expect(map.added.find(l => l.id === 'data-a-label').layout['icon-image']).toBeUndefined();
    });

    it('marcador SEM rotulo ainda cria a sub-camada simbolo, com textField vazio', () => {
        const [m, map] = comCamada({ id: 'a', source: {}, style: { marker: { symbol: 'circle' } } });
        m.addDataLayer('a');
        const label = map.added.find(l => l.id === 'data-a-label');
        expect(label).toBeDefined();
        expect(label.layout['text-field']).toBe('');
    });

    it('um simbolo SUPORTADO chega a chamar o gerador, com borderWidth ZERO preservado', () => {
        // O gerador precisa de canvas; o duplo o fornece so para que os ARGUMENTOS possam ser
        // observados. A imagem em si nao e afirmada.
        const chamadas = [];
        const ctx = new Proxy({}, {
            get: (alvo, prop) => {
                if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
                if (prop in alvo) return alvo[prop];
                return () => {};
            },
            set: (alvo, prop, valor) => { alvo[prop] = valor; chamadas.push([prop, valor]); return true; },
        });
        globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
        try {
            const [m, map] = comCamada({
                id: 'a', source: {},
                style: { label: {}, marker: { symbol: 'square', color: '#123456', borderWidth: 0 } },
            });
            m.addDataLayer('a');
            expect([...map.images]).toEqual(['data-a-marker']);
            expect(map.imageOpts).toEqual({ pixelRatio: 2 });
            // borderWidth 0 significa "sem borda": o gerador nao chega a definir lineWidth.
            expect(chamadas.map(([p]) => p)).not.toContain('lineWidth');
            expect(chamadas).toContainEqual(['fillStyle', '#123456']);
        } finally {
            delete globalThis.document;
        }
    });
});

describe('7. a caixa da camada chega a FONTE, e nao so ao fitBounds', () => {
    /**
     * Adds one data layer through the manager and returns what each source received.
     * @param {Object} camada - a linha de `config.dataLayers.layers`
     * @returns {Array<{id: string, cfg: Object}>} fontes na ordem em que entraram
     */
    function fontesDe(camada) {
        const [m, map] = comCamada(camada);
        m.addDataLayer(camada.id);
        return map.fontesAdicionadas;
    }

    it('a caixa da camada entra na fonte quando a fonte nao declara a dela', () => {
        // Uma fonte vetorial sem `bounds` e pedida em toda posicao da tela, cobertura ou
        // nao, e cada furo custa uma requisicao mais um evento de erro. A caixa vinha do
        // catalogo (`catalog_layers.config.bounds`) e parava no `fitBounds`.
        const [fonte] = fontesDe({
            id: 'a', bounds: [-45, -23, -44, -22],
            source: { type: 'vector', url: 'x' },
        });
        expect(fonte.cfg.bounds).toEqual([-45, -23, -44, -22]);
        expect(fonte.cfg.type).toBe('vector');
    });

    it('a fonte de ROTULO, quando existe, recebe a mesma caixa', () => {
        const fontes = fontesDe({
            id: 'a', bounds: [-45, -23, -44, -22],
            source: { type: 'vector', url: 'x' },
            labelSource: { type: 'vector', url: 'y' },
        });
        expect(fontes).toHaveLength(2);
        expect(fontes[1].cfg.bounds).toEqual([-45, -23, -44, -22]);
        expect(fontes[1].cfg.url).toBe('y');
    });

    it('a caixa da PROPRIA fonte vence a da camada', () => {
        const [fonte] = fontesDe({
            id: 'a', bounds: [-45, -23, -44, -22],
            source: { type: 'vector', url: 'x', bounds: [-50, -30, -40, -20] },
        });
        expect(fonte.cfg.bounds).toEqual([-50, -30, -40, -20]);
    });

    it('caixa mal formada e IGNORADA: tres numeros nao sao uma caixa', () => {
        // O gerente de dados nao tem a validacao que o de analise tem, e uma caixa curta
        // entregue ao MapLibre lanca no `addSource`, derrubando a camada inteira.
        for (const ruim of [[1, 2, 3], [1, 2, 3, 4, 5], 'a,b,c,d', null, undefined]) {
            const [fonte] = fontesDe({ id: 'a', bounds: ruim, source: { type: 'vector', url: 'x' } });
            expect(fonte.cfg.bounds).toBeUndefined();
        }
    });

    it('o objeto de config do usuario NAO e mutado: a fonte recebe uma copia', () => {
        const camada = { id: 'a', bounds: [-45, -23, -44, -22], source: { type: 'vector', url: 'x' } };
        const [fonte] = fontesDe(camada);
        expect(camada.source.bounds).toBeUndefined();
        expect(fonte.cfg).not.toBe(camada.source);
    });

    it('sem caixa nenhuma a fonte passa INTOCADA, e pelo mesmo objeto', () => {
        const camada = { id: 'a', source: { type: 'vector', url: 'x' } };
        const [fonte] = fontesDe(camada);
        expect(fonte.cfg).toBe(camada.source);
    });
});
