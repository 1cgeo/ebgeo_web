// Path: tests/unit/coordination-line-camadas.test.js

import { describe, it, expect, vi } from 'vitest';
import { evaluateExpression } from '../helpers/maplibre-expression.js';

/**
 * As camadas da Linha de Coordenacao nascem AINDA QUE o mapa nunca tenha tido uma.
 *
 * Os tres caminhos de leitura (importador de `.ebgeo`, snapshot do servidor e leitura do
 * IndexedDB) dao a todo mapa a chave `coordination_lines` por `ensureCoordinationLines`, mas
 * esta funcao tambem roda sobre dado que nunca passou por eles: um objeto de mapa recem
 * montado, um fixture de teste. Se o setup desistir quando o balde falta, a fonte e as
 * camadas nao sao criadas, e a ferramenta ativa, aceita clique e nao desenha nada: toda
 * escrita passa por `getSource(...)?.setData`, e o encadeamento opcional engole a ausencia
 * sem erro, sem log e sem nada na tela.
 *
 * SAO QUATRO CAMADAS desde o catalogo novo, e nao tres: a quarta e um `fill` sobre a MESMA
 * fonte `coordination_lines`, porque um simbolo que o catalogo marca `filled` (o fosso
 * anticarro) sai como MultiPolygon, e so uma camada de fill pinta poligono. A ordem e o
 * filtro dela sao o segundo bloco deste arquivo.
 *
 * O `mapInstance` aqui e um duble: o setup so precisa de getSource/addSource e
 * getLayer/addLayer, o que torna a funcao testavel em `node` sem MapLibre.
 */

vi.mock('../../src/js/store/index.js', () => ({ getControl: () => null }));
vi.mock('@store', () => ({ getControl: () => null }));

const { setupCoordinationLineLayers } = await import('../../src/js/layers/styles/tactical.layers.js');

/** Mapa de mentira que registra o que foi criado. */
function fakeMap() {
    const sources = new Map();
    const layers = new Map();
    return {
        sources,
        layers,
        getSource: (id) => sources.get(id),
        addSource: (id, def) => sources.set(id, { ...def, setData(d) { this.data = d; } }),
        getLayer: (id) => layers.get(id),
        addLayer: (def) => layers.set(def.id, def),
    };
}

const FONTES = ['coordination_lines', 'coordination-line-feedback', 'coordination-line-edit-handles'];
const CAMADAS = [
    'coordination-line-layer',
    'coordination-line-fill-layer',
    'coordination-line-feedback-layer',
    'coordination-line-edit-handles-layer',
];

describe('setupCoordinationLineLayers', () => {
    it('cria as tres fontes e as quatro camadas quando o balde existe', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        for (const f of FONTES) expect(map.getSource(f), f).toBeDefined();
        for (const c of CAMADAS) expect(map.getLayer(c), c).toBeDefined();
    });

    it('PIOR CASO: cria tudo IGUAL num mapa que nunca teve o balde', () => {
        // O caso real: dado que chega sem a chave, por nao ter passado por nenhum dos tres
        // caminhos de leitura que normalizam a forma.
        const map = fakeMap();
        setupCoordinationLineLayers({ points: [], lines: [] }, map);

        for (const f of FONTES) expect(map.getSource(f), f).toBeDefined();
        for (const c of CAMADAS) expect(map.getLayer(c), c).toBeDefined();
    });

    it('a fonte nasce com uma FeatureCollection valida, nunca com features indefinido', () => {
        // `setOrCreateSource` monta `{ type, features }` sem checar: passar o balde ausente
        // adiante gravaria `features: undefined`, que nao e GeoJSON valido.
        const map = fakeMap();
        setupCoordinationLineLayers({}, map);

        const dados = map.getSource('coordination_lines').data;
        expect(dados.type).toBe('FeatureCollection');
        expect(Array.isArray(dados.features)).toBe(true);
        expect(dados.features).toEqual([]);
    });

    it('sobrevive a um balde corrompido sem lancar', () => {
        for (const lixo of ['nao sou array', 42, null, {}]) {
            const map = fakeMap();
            expect(() => setupCoordinationLineLayers({ coordination_lines: lixo }, map),
                String(lixo)).not.toThrow();
            expect(Array.isArray(map.getSource('coordination_lines').data.features)).toBe(true);
        }
    });

    it('a fonte nasce difavel, com promoteId', () => {
        // Precondicao do despachante de diff, que o controle usa para TODA escrita em
        // `coordination_lines`. Sem `promoteId` o `updateData` lanca e a escrita cai no
        // caminho de coleção inteira.
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        expect(map.getSource('coordination_lines').promoteId).toBe('id');
    });

    it('nao recria fonte nem camada que ja existem', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const antes = [map.sources.size, map.layers.size];

        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        expect([map.sources.size, map.layers.size]).toEqual(antes);
    });
});

/**
 * A CAMADA DE PREENCHIMENTO, e o filtro que a impede de encher a tela.
 *
 * O simbolo que o catalogo marca `filled` sai como MultiPolygon, e a camada `line` nao
 * pinta poligono, so o contorno dele. Dai a quarta camada. O perigo mora no outro lado:
 * uma camada `fill` do MapLibre FECHA e pinta qualquer geometria que receba, entao um
 * fill SEM filtro sobre esta fonte pintaria o miolo do losango 290199, o de toda argola
 * de concertina e a area entre uma espinha dobrada e a sua corda (medido no navegador em
 * 2026-09-03). O filtro por tipo de geometria e o que separa os dois casos.
 *
 * `['geometry-type']` devolve 'Point', 'LineString' ou 'Polygon' e MAIS NADA: no bundle
 * (vendorizado 5.18 quando isto foi escrito, npm 6.7.0 desde 2026-09-04) o getter e
 * `geometryType(){...He[this.feature.type]...}` sobre `He=["Unknown","Point","LineString","Polygon"]`,
 * indexado pelo tipo NUMERICO do vector tile. Ou seja MultiPolygon responde 'Polygon' e
 * MultiLineString responde 'LineString', que e a premissa deste filtro.
 */
describe('coordination-line-fill-layer', () => {
    /**
     * @param {Object} map - Mapa falso ja montado
     * @returns {Object} A definicao da camada de preenchimento
     */
    const fill = (map) => map.getLayer('coordination-line-fill-layer');

    it('le a MESMA fonte da camada de linha, que e o que dispensa uma quarta fonte', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        expect(fill(map).type).toBe('fill');
        expect(fill(map).source).toBe('coordination_lines');
        expect(map.getLayer('coordination-line-layer').source).toBe('coordination_lines');
    });

    it('entra ANTES da camada de linha, senao o preenchimento cobre o proprio contorno', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        const ordem = [...map.layers.keys()];
        const daFaixa = ordem.indexOf('coordination-line-fill-layer');
        const daLinha = ordem.indexOf('coordination-line-layer');

        // As duas presencas ANTES da comparacao: `indexOf` devolve -1 para o que nao
        // existe, e -1 e menor que tudo, entao a camada AUSENTE passaria por "esta
        // antes". Foi o que o controle negativo pegou.
        expect(daFaixa).toBeGreaterThanOrEqual(0);
        expect(daLinha).toBeGreaterThanOrEqual(0);
        expect(daFaixa).toBeLessThan(daLinha);
    });

    it('tira a cor e a opacidade da propria feicao, como a camada de linha', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const props = { color: '#123456', opacity: 0.4 };

        expect(evaluateExpression(fill(map).paint['fill-color'], { properties: props })).toBe('#123456');
        expect(evaluateExpression(fill(map).paint['fill-opacity'], { properties: props })).toBe(0.4);
    });

    it('PIOR CASO: o filtro REPROVA o losango, que e o desenho que ele existe para nao pintar', () => {
        // O insumo degenerado e o simbolo comum, nao o raro: o 290199 e o padrao da
        // ferramenta, sai como MultiLineString, e e o miolo dele que apareceu pintado
        // no navegador quando o fill correu sem filtro.
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const filtro = fill(map).filter;
        const visivel = { visivel: true, symbol_code: '290199' };

        expect(evaluateExpression(filtro, { properties: visivel, geometryType: 'LineString' })).toBe(false);
        // E o fosso, que e MultiPolygon e portanto 'Polygon', passa.
        expect(evaluateExpression(filtro, {
            properties: { visivel: true, symbol_code: '290202' }, geometryType: 'Polygon',
        })).toBe(true);
    });

    it('PIOR CASO: sem a clausula de geometria o mesmo filtro APROVA o losango', () => {
        // A prova de que a clausula e quem reprova, e nao a visibilidade que ja estava
        // ali: retirado o `['geometry-type']`, o filtro deixa passar exatamente a
        // feicao que a asercao acima barra.
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);
        const semGeometria = fill(map).filter
            .filter(clausula => !(Array.isArray(clausula) && JSON.stringify(clausula).includes('geometry-type')));

        expect(evaluateExpression(semGeometria, {
            properties: { visivel: true, symbol_code: '290199' }, geometryType: 'LineString',
        })).toBe(true);
    });

    it('a feicao OCULTA nao e pintada, nem sendo poligono', () => {
        const map = fakeMap();
        setupCoordinationLineLayers({ coordination_lines: [] }, map);

        expect(evaluateExpression(fill(map).filter, {
            properties: { visivel: false, symbol_code: '290202' }, geometryType: 'Polygon',
        })).toBe(false);
    });
});
