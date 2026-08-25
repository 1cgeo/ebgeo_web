// Path: tests/unit/fundo-de-texto-derivado.test.js

/**
 * @fileoverview O FUNDO DO TEXTO E DERIVADO, e a derivacao mora dentro de `setupTextLayers`
 * (`layers/styles/content.layers.js`). `toBackgroundFeatures` nao e exportada, entao esta suite a
 * alcanca pelo unico caminho publico: montar as camadas de texto contra um mapa duplo e ler o que
 * foi escrito na fonte `text-backgrounds`.
 *
 * O QUE ELA PRENDE:
 *
 *  1. O FILTRO DUPLO: entra so quem tem `showBackground` truthy E `selectionBox`. Falta qualquer
 *     um dos dois e a feicao nao gera fundo. Os dois casos negativos sao medidos separados, senao
 *     um `&&` virado em `||` passaria verde.
 *  2. A CHAVE DERIVADA `<id>_bg`, inclusive com id NUMERICO (o `+` concatena e o resultado e
 *     string), porque e ela que faz o `promoteId: 'id'` continuar resolvendo e o diff do MapLibre
 *     continuar possivel na fonte de fundo.
 *  3. A GEOMETRIA do fundo e a `selectionBox`, e as demais propriedades sao COPIADAS (spread), de
 *     modo que a cor e a opacidade do fundo viajam com ele. A copia e rasa: mutar a `selectionBox`
 *     do texto muda a do fundo, e isso fica fixado.
 *  4. `promoteId: 'id'` declarado nas fontes criadas AQUI (contrato com `setStyle`, que recria
 *     toda fonte custom), e a AUSENCIA dele nas fontes efemeras de alca.
 *  5. OBSERVADO: uma feicao de texto SEM `properties` derruba o `setupTextLayers` inteiro com
 *     TypeError, e junto com ele todas as camadas de texto do estilo.
 *
 * O QUE ELA NAO ALCANCA:
 *
 *  - O PATCH de espelhamento pendurado em `texts.setData`, que roda dentro de um `setTimeout(0)` e
 *     depende do `getData()` assincrono do MapLibre. So a marca `__ebgeoBgPatch` e observada.
 *  - `applyZoomCorrections`: o controle e dublado como ausente, entao o ramo de correcao de zoom
 *     nao e exercitado.
 *  - Se o MapLibre desenha o que essas definicoes de camada descrevem.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let controlDouble;
vi.mock('../../src/js/store/index.js', async (importOriginal) => {
    const real = await importOriginal();
    return { ...real, getControl: () => controlDouble };
});

const writes = [];
vi.mock('../../src/js/layers/geojson-dispatcher.js', () => ({
    writeWholeCollection: (map, name, data) => {
        writes.push([name, data]);
        map.getSource(name).data = data;
    },
}));

const { setupTextLayers, setupImageLayers, setupArrowLayers } =
    await import('../../src/js/layers/styles/content.layers.js');

/** Minimal map double: only what the style module touches. */
function styleMap() {
    return {
        sources: new Map(),
        layers: [],
        getSource(id) { return this.sources.get(id); },
        addSource(id, def) {
            this.sources.set(id, {
                ...def,
                setData(d) { this.data = d; },
                getData: async () => this.data,
            });
        },
        getLayer(id) { return this.layers.find(l => l.id === id); },
        addLayer(def) { this.layers.push(def); },
    };
}

/** A text feature with the given properties merged over a usable default. */
function texto(props) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { text: 'oi', ...props },
    };
}

const CAIXA = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

let map;
beforeEach(() => {
    controlDouble = undefined;
    writes.length = 0;
    map = styleMap();
});

/** Features written to the derived background source. */
function fundos() {
    return map.getSource('text-backgrounds').data.features;
}

describe('1. o filtro duplo: showBackground E selectionBox', () => {
    it('so o texto com os DOIS gera fundo', () => {
        setupTextLayers({
            texts: [
                texto({ id: 'com', showBackground: true, selectionBox: CAIXA }),
                texto({ id: 'sem-flag', showBackground: false, selectionBox: CAIXA }),
                texto({ id: 'sem-caixa', showBackground: true }),
                texto({ id: 'nenhum' }),
            ],
        }, map);
        const ids = fundos().map(f => f.properties.id);
        expect(ids).toHaveLength(1);
        expect(ids).toEqual(['com_bg']);
    });

    it('falta a caixa: nao gera fundo mesmo com a flag ligada (prova o E do filtro)', () => {
        setupTextLayers({ texts: [texto({ id: 'a', showBackground: true })] }, map);
        expect(fundos()).toHaveLength(0);
    });

    it('falta a flag: nao gera fundo mesmo com a caixa (a outra metade do E)', () => {
        setupTextLayers({ texts: [texto({ id: 'a', selectionBox: CAIXA })] }, map);
        expect(fundos()).toHaveLength(0);
    });

    it('BORDA: a flag e testada por truthiness, entao "false" (string) LIGA o fundo', () => {
        setupTextLayers({ texts: [texto({ id: 'a', showBackground: 'false', selectionBox: CAIXA })] }, map);
        expect(fundos()).toHaveLength(1);
    });

    it('BORDA: selectionBox falsy (null, 0, "") nao gera fundo', () => {
        for (const caixa of [null, 0, '', undefined]) {
            map = styleMap();
            setupTextLayers({ texts: [texto({ id: 'a', showBackground: true, selectionBox: caixa })] }, map);
            expect(fundos()).toHaveLength(0);
        }
    });

    it('BORDA: lista de textos vazia produz colecao vazia, nao ausencia de fonte', () => {
        setupTextLayers({ texts: [] }, map);
        expect(map.getSource('text-backgrounds').data).toEqual({ type: 'FeatureCollection', features: [] });
        expect(fundos()).toHaveLength(0);
    });
});

describe('2. a chave derivada <id>_bg', () => {
    it('id de texto vira id de fundo com o sufixo, mantendo o original nas props copiadas', () => {
        setupTextLayers({ texts: [texto({ id: 'u1', showBackground: true, selectionBox: CAIXA, color: '#f00' })] }, map);
        const fundo = fundos()[0];
        expect(fundo.properties.id).toBe('u1_bg');
        expect(fundo.properties.color).toBe('#f00');
    });

    it('BORDA: id NUMERICO vira string por concatenacao, e o promoteId continua resolvendo', () => {
        setupTextLayers({ texts: [texto({ id: 5, showBackground: true, selectionBox: CAIXA })] }, map);
        expect(fundos()[0].properties.id).toBe('5_bg');
        expect(typeof fundos()[0].properties.id).toBe('string');
    });

    it('BORDA: id ausente produz "undefined_bg", que COLIDE entre dois textos sem id', () => {
        // Comportamento OBSERVADO. Nao ha guarda; dois textos sem id derivam a mesma chave, e o
        // `promoteId: 'id'` da fonte de fundo passa a ter duplicata.
        setupTextLayers({
            texts: [
                texto({ showBackground: true, selectionBox: CAIXA }),
                texto({ showBackground: true, selectionBox: CAIXA }),
            ],
        }, map);
        const ids = fundos().map(f => f.properties.id);
        expect(ids).toHaveLength(2);
        expect(ids[0]).toBe('undefined_bg');
        expect(ids[1]).toBe(ids[0]);
    });
});

describe('3. a geometria vem da caixa, e a copia de propriedades e RASA', () => {
    it('a geometria do fundo E a selectionBox, nao a geometria do texto', () => {
        const t = texto({ id: 'a', showBackground: true, selectionBox: CAIXA });
        setupTextLayers({ texts: [t] }, map);
        expect(fundos()[0].geometry).toBe(t.properties.selectionBox);
        expect(fundos()[0].geometry).not.toBe(t.geometry);
        expect(fundos()[0].type).toBe('Feature');
    });

    it('OBSERVADO: a caixa NAO e clonada, entao mutar a do texto muda a do fundo ja escrito', () => {
        const t = texto({ id: 'a', showBackground: true, selectionBox: { ...CAIXA } });
        setupTextLayers({ texts: [t] }, map);
        t.properties.selectionBox.coordinates = [];
        expect(fundos()[0].geometry.coordinates).toEqual([]);
    });

    it('as propriedades de fundo viajam junto (cor, opacidade, largura de borda)', () => {
        setupTextLayers({
            texts: [texto({
                id: 'a', showBackground: true, selectionBox: CAIXA,
                backgroundFillColor: '#012', backgroundFillOpacity: 0,
                backgroundBorderColor: '#345', backgroundBorderWidth: 0,
            })],
        }, map);
        const p = fundos()[0].properties;
        // Opacidade e largura ZERO chegam intactas: o spread nao aplica padrao nenhum.
        expect(p.backgroundFillOpacity).toBe(0);
        expect(p.backgroundBorderWidth).toBe(0);
        expect(p.backgroundFillColor).toBe('#012');
        expect(p.backgroundBorderColor).toBe('#345');
    });
});

describe('4. promoteId: quem tem e quem NAO tem', () => {
    it('as fontes de conteudo nascem com promoteId "id"', () => {
        setupTextLayers({ texts: [] }, map);
        setupImageLayers({ images: [] }, map);
        setupArrowLayers({ arrows: [] }, map);
        for (const nome of ['texts', 'text-backgrounds', 'images', 'arrows']) {
            expect(map.getSource(nome).promoteId).toBe('id');
        }
    });

    it('as fontes efemeras de alca nascem SEM promoteId', () => {
        setupTextLayers({ texts: [] }, map);
        setupArrowLayers({ arrows: [] }, map);
        for (const nome of ['text-edit-handles', 'arrow-feedback', 'arrow-edit-handles']) {
            expect(map.getSource(nome).promoteId).toBeUndefined();
            expect(map.getSource(nome).data).toEqual({ type: 'FeatureCollection', features: [] });
        }
    });

    it('a segunda montagem ATUALIZA a fonte pelo despachante, em vez de recriar', () => {
        setupTextLayers({ texts: [texto({ id: 'a', showBackground: true, selectionBox: CAIXA })] }, map);
        expect(writes).toHaveLength(0); // primeira passada: addSource
        setupTextLayers({ texts: [texto({ id: 'b', showBackground: true, selectionBox: CAIXA })] }, map);
        const nomes = writes.map(([nome]) => nome);
        expect(nomes).toHaveLength(2);
        expect(nomes).toEqual(['texts', 'text-backgrounds']);
        expect(fundos().map(f => f.properties.id)).toEqual(['b_bg']);
    });

    it('as camadas de texto sao criadas UMA vez so, mesmo com duas montagens', () => {
        setupTextLayers({ texts: [] }, map);
        const depoisDaPrimeira = map.layers.length;
        setupTextLayers({ texts: [] }, map);
        expect(map.layers).toHaveLength(depoisDaPrimeira);
        expect(map.layers.map(l => l.id)).toEqual([
            'text-background-fill-layer',
            'text-background-border-layer',
            'text-layer',
            'text-edit-handles-layer',
        ]);
    });

    it('a marca do patch de espelhamento fica na FONTE, e a segunda passada nao a repoe', () => {
        setupTextLayers({ texts: [] }, map);
        const fonte = map.getSource('texts');
        expect(fonte.__ebgeoBgPatch).toBe(true);
        const patched = fonte.setData;
        setupTextLayers({ texts: [] }, map);
        expect(map.getSource('texts').setData).toBe(patched);
    });
});

describe('5. a feicao sem properties derruba a montagem inteira', () => {
    it('CONSERTADO: texto sem `properties` nao derruba mais a montagem, as quatro camadas nascem', () => {
        // `toBackgroundFeatures` lia `f.properties.showBackground` sem guarda. O custo nao era o
        // fundo perdido: o throw subia antes de `addLayerOnce`, entao NENHUMA camada de texto era
        // criada e o texto sumia do mapa inteiro.
        expect(() => setupTextLayers({ texts: [{ type: 'Feature', geometry: {} }] }, map))
            .not.toThrow();
        expect(map.layers).toHaveLength(4);
        expect(fundos()).toHaveLength(0);
    });

    it('CONSERTADO: a feicao malformada nao leva junto a BEM formada ao lado dela', () => {
        // Esta e a perda que o throw causava: o vizinho bem formado sumia tambem.
        const bom = {
            type: 'Feature', geometry: {},
            properties: { id: 't1', showBackground: true, selectionBox: { type: 'Polygon', coordinates: [] } },
        };
        setupTextLayers({ texts: [{ type: 'Feature', geometry: {} }, bom] }, map);
        expect(map.layers).toHaveLength(4);
        expect(fundos().map(f => f.properties.id)).toEqual(['t1_bg']);
    });

    it('CONTROLE: uma entrada nula na lista tem o mesmo desfecho', () => {
        expect(() => setupTextLayers({ texts: [null] }, map)).not.toThrow();
        expect(map.layers).toHaveLength(4);
    });

    it('CONTROLE: a mesma feicao COM properties vazia monta as quatro camadas sem lancar', () => {
        expect(() => setupTextLayers({ texts: [{ type: 'Feature', geometry: {}, properties: {} }] }, map))
            .not.toThrow();
        expect(map.layers).toHaveLength(4);
        expect(fundos()).toHaveLength(0);
    });

    it('OBSERVADO: `texts` ausente lanca ao iterar undefined', () => {
        expect(() => setupTextLayers({}, map)).toThrow(TypeError);
    });
});
