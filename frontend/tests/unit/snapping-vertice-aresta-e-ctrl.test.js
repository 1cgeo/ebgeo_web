// Path: tests/unit/snapping-vertice-aresta-e-ctrl.test.js

/**
 * @fileoverview O SNAPPING (`snapping/snapping.service.js`), pelo comportamento e nao pelos
 * ajudantes. `extractVertices`, `extractSegments`, `closestPointOnSegment` e `interpolateLngLat`
 * sao privados do modulo: esta suite os alcanca por `resolve()`, com um mapa duplo cujo `project`
 * e a identidade (1 grau = 1 pixel), que e o que torna a distancia em pixels legivel a olho nu.
 *
 * O QUE ELA PRENDE:
 *
 *  1. A TABELA-VERDADE do XOR: global x Ctrl, os quatro combos. Ctrl e o unico jeito de o usuario
 *     ligar o snap sem ligar o snap, e de desligar sem desligar.
 *  2. A TOLERANCIA e sua fronteira: 18 px INCLUSIVE entram, 19 nao.
 *  3. O BONUS DE VERTICE, que e o que decide vertice contra aresta quando as duas estao dentro da
 *     tolerancia. Ele e medido nos DOIS sentidos (o vertice mais longe ganha por 1 px de folga; e
 *     o vertice longe o bastante PERDE), senao um bonus zerado passaria verde.
 *  4. Os tipos de geometria: LineString, Polygon, MultiPolygon e Point, incluindo a contagem de
 *     vertices e o descarte da terceira coordenada (z).
 *  5. Os desfechos SEM snap, cada um com sua causa: sem candidato, todo candidato excluido pelo
 *     id em edicao, geometria nula, e `queryRenderedFeatures` que lanca (camada ainda nao existe
 *     no boot).
 *  6. O segmento DEGENERADO (a === b), que e onde `lenSq === 0` produziria NaN se nao houvesse a
 *     saida antecipada.
 *  7. OBSERVADO: a interpolacao de aresta e LINEAR em lng/lat, sem desenrolar o antimeridiano.
 *
 * O QUE ELA NAO ALCANCA:
 *
 *  - A PROJECAO REAL do MapLibre. O duplo usa identidade, entao nada aqui afirma como um grau vira
 *    pixel num zoom qualquer; o que se mede e a decisao dada a projecao.
 *  - `showIndicator`/`hideIndicator` alem da forma do dado escrito na fonte: o desenho e do estilo.
 *  - Os ouvintes de teclado de verdade: `document`/`window` sao duplos, e o estado de Ctrl e
 *    dirigido pelos proprios handlers (`_onKeyDown`/`_onKeyUp`/`_onWindowBlur`), nunca escrito a
 *    mao no campo privado.
 *  - A escolha de `SNAPPABLE_LAYER_IDS`: a suite afirma que so as camadas EXISTENTES no mapa sao
 *    consultadas, nao que a lista esteja certa.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

let listeners;
beforeEach(() => {
    listeners = { doc: [], win: [] };
    globalThis.document = {
        addEventListener: (t, h) => listeners.doc.push([t, h]),
        removeEventListener: (t, h) => {
            const i = listeners.doc.findIndex(([lt, lh]) => lt === t && lh === h);
            if (i >= 0) listeners.doc.splice(i, 1);
        },
    };
    globalThis.window = {
        addEventListener: (t, h) => listeners.win.push([t, h]),
        removeEventListener: (t, h) => {
            const i = listeners.win.findIndex(([lt, lh]) => lt === t && lh === h);
            if (i >= 0) listeners.win.splice(i, 1);
        },
    };
});

const { SnappingService, getSnappingService } =
    await import('../../src/js/snapping/snapping.service.js');
const { SNAP_TOLERANCE_PX, SNAP_VERTEX_BONUS_PX, SNAP_QUERY_PADDING_PX, SnapType } =
    await import('../../src/js/snapping/snapping.constants.js');

let service = null;

afterEach(() => {
    // The class is a singleton by construction (`if (_instance) return _instance`), so every test
    // must hand it back or the next `new` silently reuses this one's state manager.
    service?.destroy();
    service = null;
    delete globalThis.document;
    delete globalThis.window;
});

/** Builds the service with the global toggle in a known state. */
function servico(globalEnabled) {
    service = new SnappingService({ stateManager: { getUnsafe: () => globalEnabled } });
    return service;
}

/** Fires the real keyboard handlers instead of writing `_ctrlHeld` by hand. */
function pressionaCtrl(held) {
    const tipo = held ? 'keydown' : 'keyup';
    for (const [t, h] of listeners.doc) if (t === tipo) h({ key: 'Control' });
}
function perdeFoco() {
    for (const [t, h] of listeners.win) if (t === 'blur') h();
}

/** Map double: project is the identity, so 1 unit of lng/lat is 1 pixel. */
function mapa(features, { layers = ['line-layer'], query } = {}) {
    const calls = [];
    return {
        calls,
        project: ([lng, lat]) => ({ x: lng, y: lat }),
        getLayer: (id) => (layers.includes(id) ? { id } : undefined),
        queryRenderedFeatures: query || ((bbox, opts) => { calls.push([bbox, opts]); return features; }),
        getSource: () => undefined,
    };
}

const feicao = (geometry, id) => ({ geometry, properties: id === undefined ? {} : { id } });
const linha = (coords, id) => feicao({ type: 'LineString', coordinates: coords }, id);
const ponto = (coord, id) => feicao({ type: 'Point', coordinates: coord }, id);

describe('1. a tabela-verdade do XOR entre o interruptor global e o Ctrl', () => {
    const alvo = () => [linha([[0, 0], [100, 0]])];

    it('global LIGADO e Ctrl solto: gruda', () => {
        const s = servico(true);
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
    });

    it('global LIGADO e Ctrl segurado: pausa temporaria, nao gruda', () => {
        const s = servico(true);
        pressionaCtrl(true);
        const r = s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 });
        expect(r).toEqual({ lng: 3, lat: 0, snapped: false, snapType: null });
    });

    it('global DESLIGADO e Ctrl solto: nao gruda', () => {
        const s = servico(false);
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
    });

    it('global DESLIGADO e Ctrl segurado: snap temporario, gruda', () => {
        const s = servico(false);
        pressionaCtrl(true);
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
    });

    it('soltar o Ctrl volta ao estado global', () => {
        const s = servico(false);
        pressionaCtrl(true);
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
        pressionaCtrl(false);
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
    });

    it('perder o foco da janela solta o Ctrl (ele pode ter sido solto fora da pagina)', () => {
        const s = servico(false);
        pressionaCtrl(true);
        perdeFoco();
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
    });

    it('BORDA: outra tecla nao mexe no estado de Ctrl', () => {
        const s = servico(false);
        for (const [t, h] of listeners.doc) if (t === 'keydown') h({ key: 'Shift' });
        expect(s.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(false);
    });

    it('o interruptor global e lido do estado a CADA resolucao, nao guardado', () => {
        let ligado = false;
        service = new SnappingService({ stateManager: { getUnsafe: () => ligado } });
        expect(service.isEnabled()).toBe(false);
        ligado = true;
        expect(service.isEnabled()).toBe(true);
        expect(service.resolve(mapa(alvo()), { x: 3, y: 0 }, { lng: 3, lat: 0 }).snapped).toBe(true);
    });

    it('desligado, o mapa nem chega a ser consultado', () => {
        const s = servico(false);
        const m = mapa(alvo());
        s.resolve(m, { x: 3, y: 0 }, { lng: 3, lat: 0 });
        expect(m.calls).toHaveLength(0);
    });
});

describe('2. a tolerancia e sua fronteira', () => {
    it(`a ${SNAP_TOLERANCE_PX}a. px INCLUSIVE ainda gruda`, () => {
        const s = servico(true);
        const r = s.resolve(mapa([linha([[0, 0], [100, 0]])]), { x: 50, y: SNAP_TOLERANCE_PX }, { lng: 50, lat: SNAP_TOLERANCE_PX });
        expect(r.snapped).toBe(true);
        expect(r.snapType).toBe(SnapType.EDGE);
    });

    it('um pixel alem da tolerancia devolve o ponto original, intocado', () => {
        const s = servico(true);
        const fora = SNAP_TOLERANCE_PX + 1;
        expect(s.resolve(mapa([linha([[0, 0], [100, 0]])]), { x: 50, y: fora }, { lng: 50, lat: fora }))
            .toEqual({ lng: 50, lat: fora, snapped: false, snapType: null });
    });

    it('a caixa de consulta usa o padding declarado, centrada no cursor', () => {
        const s = servico(true);
        const m = mapa([]);
        s.resolve(m, { x: 100, y: 200 }, { lng: 0, lat: 0 });
        expect(m.calls).toHaveLength(1);
        const [bbox, opts] = m.calls[0];
        const p = SNAP_QUERY_PADDING_PX;
        expect(bbox).toEqual([[100 - p, 200 - p], [100 + p, 200 + p]]);
        expect(opts.layers).toEqual(['line-layer']);
    });

    it('so as camadas que EXISTEM no mapa entram na consulta', () => {
        const s = servico(true);
        const m = mapa([], { layers: ['point-layer', 'sectors-layer'] });
        s.resolve(m, { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(m.calls[0][1].layers).toHaveLength(2);
        expect(m.calls[0][1].layers).toEqual(['point-layer', 'sectors-layer']);
    });
});

describe('3. o bonus de vertice decide vertice contra aresta', () => {
    // The vertex sits at (D, 0); the edge is the horizontal line y = 9 through the cursor's x.
    const aresta = () => linha([[-100, 9], [100, 9]]);

    it(`vertice a 10 px vence aresta a 9 px, pelo bonus de ${SNAP_VERTEX_BONUS_PX} px`, () => {
        const s = servico(true);
        const r = s.resolve(mapa([ponto([10, 0]), aresta()]), { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(r.snapType).toBe(SnapType.VERTEX);
        expect(r).toMatchObject({ lng: 10, lat: 0, snapped: true });
    });

    it('vertice a 15 px PERDE para aresta a 9 px: o bonus e finito', () => {
        const s = servico(true);
        const r = s.resolve(mapa([ponto([15, 0]), aresta()]), { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(r.snapType).toBe(SnapType.EDGE);
        expect(r).toMatchObject({ lng: 0, lat: 9, snapped: true });
    });

    it('o bonus NAO alarga a tolerancia: vertice a 19 px continua fora', () => {
        const s = servico(true);
        const fora = SNAP_TOLERANCE_PX + 1;
        const r = s.resolve(mapa([ponto([fora, 0])]), { x: 0, y: 0 }, { lng: 7, lat: 8 });
        expect(r).toEqual({ lng: 7, lat: 8, snapped: false, snapType: null });
    });

    it('entre dois vertices dentro da tolerancia, o mais PROXIMO ganha', () => {
        const s = servico(true);
        const r = s.resolve(mapa([ponto([12, 0]), ponto([4, 0])]), { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(r.lng).toBe(4);
    });

    it('empate exato fica com o PRIMEIRO candidato (comparacao estrita por <)', () => {
        const s = servico(true);
        const r = s.resolve(mapa([ponto([5, 0], 'a'), ponto([-5, 0], 'b')]), { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(r.lng).toBe(5);
    });
});

describe('4. as geometrias, seus vertices e suas arestas', () => {
    it('LineString: gruda no vertice de ponta e na aresta do meio', () => {
        const s = servico(true);
        const l = [linha([[0, 0], [100, 0]])];
        expect(s.resolve(mapa(l), { x: 3, y: 0 }, { lng: 3, lat: 0 })).toMatchObject({ lng: 0, lat: 0, snapType: SnapType.VERTEX });
        expect(s.resolve(mapa(l), { x: 50, y: 5 }, { lng: 50, lat: 5 })).toMatchObject({ lng: 50, lat: 0, snapType: SnapType.EDGE });
    });

    it('Polygon: os vertices do anel sao alcancados', () => {
        const s = servico(true);
        const p = [feicao({ type: 'Polygon', coordinates: [[[0, 0], [20, 0], [20, 20], [0, 0]]] })];
        expect(s.resolve(mapa(p), { x: 20, y: 20 }, { lng: 0, lat: 0 })).toMatchObject({ lng: 20, lat: 20, snapType: SnapType.VERTEX });
    });

    it('MultiPolygon: o achatamento de profundidade 2 chega ao vertice', () => {
        const s = servico(true);
        const mp = [feicao({ type: 'MultiPolygon', coordinates: [[[[0, 0], [40, 0], [40, 40], [0, 0]]]] })];
        expect(s.resolve(mapa(mp), { x: 40, y: 40 }, { lng: 0, lat: 0 })).toMatchObject({ lng: 40, lat: 40, snapType: SnapType.VERTEX });
    });

    it('MultiPoint tem vertices e NAO tem arestas', () => {
        const s = servico(true);
        const mpt = [feicao({ type: 'MultiPoint', coordinates: [[0, 0], [100, 0]] })];
        // No cursor no meio (50,0), os dois vertices estao a 50 px: fora da tolerancia, e sem
        // aresta para pegar. Se MultiPoint gerasse aresta, este caso grudaria.
        expect(s.resolve(mapa(mpt), { x: 50, y: 0 }, { lng: 50, lat: 0 }).snapped).toBe(false);
        expect(s.resolve(mapa(mpt), { x: 2, y: 0 }, { lng: 2, lat: 0 })).toMatchObject({ lng: 0, snapType: SnapType.VERTEX });
    });

    it('a terceira coordenada (z) e descartada, e nao vaza para o resultado', () => {
        const s = servico(true);
        const r = s.resolve(mapa([ponto([1, 2, 999])]), { x: 1, y: 2 }, { lng: 0, lat: 0 });
        expect(r).toEqual({ lng: 1, lat: 2, snapped: true, snapType: SnapType.VERTEX });
    });

    it('tipo de geometria desconhecido nao produz vertice nem aresta', () => {
        const s = servico(true);
        const g = [feicao({ type: 'GeometryCollection', coordinates: [[0, 0]] })];
        expect(s.resolve(mapa(g), { x: 0, y: 0 }, { lng: 9, lat: 9 }).snapped).toBe(false);
    });

    it('BORDA: LineString de UM vertice tem vertice e nenhuma aresta', () => {
        const s = servico(true);
        const l = [linha([[0, 0]])];
        expect(s.resolve(mapa(l), { x: 2, y: 0 }, { lng: 2, lat: 0 })).toMatchObject({ lng: 0, snapType: SnapType.VERTEX });
    });

    it('BORDA: coordinates vazio nao lanca e nao gruda', () => {
        const s = servico(true);
        expect(s.resolve(mapa([linha([])]), { x: 0, y: 0 }, { lng: 4, lat: 4 }).snapped).toBe(false);
    });
});

describe('5. o segmento degenerado, onde lenSq = 0', () => {
    it('a === b nao produz NaN: devolve o proprio ponto', () => {
        const s = servico(true);
        const r = s.resolve(mapa([linha([[5, 5], [5, 5]])]), { x: 5, y: 10 }, { lng: 5, lat: 10 });
        expect(Number.isFinite(r.lng)).toBe(true);
        expect(Number.isFinite(r.lat)).toBe(true);
        expect(r).toMatchObject({ lng: 5, lat: 5, snapped: true });
    });

    it('o vertice coincidente ganha do proprio segmento degenerado (bonus)', () => {
        const s = servico(true);
        expect(s.resolve(mapa([linha([[5, 5], [5, 5]])]), { x: 5, y: 10 }, { lng: 0, lat: 0 }).snapType)
            .toBe(SnapType.VERTEX);
    });
});

describe('6. os desfechos SEM snap, cada um com sua causa', () => {
    const original = { lng: 12.5, lat: -3.25 };

    it('nenhum candidato devolvido', () => {
        const s = servico(true);
        expect(s.resolve(mapa([]), { x: 0, y: 0 }, original)).toEqual({ ...original, snapped: false, snapType: null });
    });

    it('candidato nulo/indefinido devolvido pela consulta', () => {
        const s = servico(true);
        expect(s.resolve(mapa(null), { x: 0, y: 0 }, original).snapped).toBe(false);
        expect(s.resolve(mapa(undefined), { x: 0, y: 0 }, original).snapped).toBe(false);
    });

    it('a feicao em edicao e excluida pelo id, e sobra nada', () => {
        const s = servico(true);
        const m = mapa([linha([[0, 0], [100, 0]], 'f1')]);
        expect(s.resolve(m, { x: 3, y: 0 }, original, 'f1')).toEqual({ ...original, snapped: false, snapType: null });
        // CONTROLE: sem o id de exclusao, a mesma feicao gruda.
        expect(s.resolve(m, { x: 3, y: 0 }, original).snapped).toBe(true);
    });

    it('a exclusao pega SO a feicao nomeada; a irma continua valendo', () => {
        const s = servico(true);
        const m = mapa([ponto([0, 0], 'f1'), ponto([2, 0], 'f2')]);
        expect(s.resolve(m, { x: 1, y: 0 }, original, 'f1')).toMatchObject({ lng: 2, snapped: true });
    });

    it('geometria nula e simplesmente pulada, sem lancar', () => {
        const s = servico(true);
        expect(s.resolve(mapa([feicao(null), ponto([0, 0])]), { x: 1, y: 0 }, original))
            .toMatchObject({ lng: 0, lat: 0, snapped: true });
        expect(s.resolve(mapa([feicao(null)]), { x: 1, y: 0 }, original).snapped).toBe(false);
    });

    it('queryRenderedFeatures que LANCA (camada ainda nao existe no boot) degrada em silencio', () => {
        const s = servico(true);
        const m = mapa([], { query: () => { throw new Error('layer does not exist'); } });
        expect(() => s.resolve(m, { x: 0, y: 0 }, original)).not.toThrow();
        expect(s.resolve(m, { x: 0, y: 0 }, original)).toEqual({ ...original, snapped: false, snapType: null });
    });
});

describe('7. a interpolacao da aresta e linear, sem desenrolar o antimeridiano', () => {
    it('OBSERVADO: o meio de [179,0]-[-179,0] cai em lng 0, do outro lado do mundo', () => {
        // `interpolateLngLat` soma a diferenca crua de longitudes. Para um segmento que cruza o
        // antimeridiano, o parametro t vem da geometria em PIXELS (onde o segmento e curto) e e
        // aplicado numa diferenca de 358 graus, entao o ponto grudado aterrissa no meridiano de
        // Greenwich.
        //
        // NAO CONSERTADO EM 2026-08-24, e o motivo esta medido: pegar o menor dos dois arcos
        // sempre que |delta| > 180 quebra o caso "vertice a 15 px PERDE para aresta a 9 px", cuja
        // aresta e [[-100,9],[100,9]] e passaria a grudar em -180. `queryRenderedFeatures`
        // devolve segmentos legitimamente mais largos que 180 graus em zoom baixo, e os dois casos
        // nao se distinguem so pelas longitudes: sao precisos os extremos PROJETADOS, que este
        // ajudante nao recebe. Fixado aqui para que o conserto, quando vier, seja deliberado.
        const s = servico(true);
        const anti = { type: 'LineString', coordinates: [[179, 0], [-179, 0]] };
        const m = {
            project: ([lng]) => ({ x: lng === 179 ? -10 : 10, y: 0 }),
            getLayer: () => ({ id: 'line-layer' }),
            queryRenderedFeatures: () => [feicao(anti)],
        };
        const r = s.resolve(m, { x: 0, y: 0 }, { lng: 0, lat: 0 });
        expect(r.snapType).toBe(SnapType.EDGE);
        expect(r.lng).toBe(0);
        // CONTROLE: o MESMO comprimento em pixels, longe do antimeridiano, interpola no lugar
        // certo. Com a projecao identidade o segmento [-10,0]-[10,0] tambem mede 20 px, e o meio
        // cai em lng 0, que ali E o meio geografico. A diferenca entre os dois casos e so o
        // desenrolar que falta.
        const perto = [feicao({ type: 'LineString', coordinates: [[-10, 0], [10, 0]] })];
        expect(s.resolve(mapa(perto), { x: 0, y: 0 }, { lng: 0, lat: 0 }))
            .toMatchObject({ lng: 0, lat: 0, snapType: SnapType.EDGE });
    });

    it('a interpolacao respeita t nas duas pontas e no meio', () => {
        const s = servico(true);
        const l = [linha([[0, 0], [100, 0]])];
        // Cursor a esquerda do inicio: t clampa em 0 e o vertice de inicio ganha.
        expect(s.resolve(mapa(l), { x: -5, y: 0 }, { lng: 0, lat: 0 })).toMatchObject({ lng: 0, snapType: SnapType.VERTEX });
        // Cursor no meio, 5 px acima: t = 0.5.
        expect(s.resolve(mapa(l), { x: 50, y: 5 }, { lng: 0, lat: 0 })).toMatchObject({ lng: 50, lat: 0 });
        // Cursor a direita do fim: vertice final.
        expect(s.resolve(mapa(l), { x: 105, y: 0 }, { lng: 0, lat: 0 })).toMatchObject({ lng: 100, snapType: SnapType.VERTEX });
    });

    it('latitude tambem interpola: aresta diagonal cai no ponto perpendicular', () => {
        const s = servico(true);
        const r = s.resolve(mapa([linha([[0, 0], [20, 20]])]), { x: 10, y: 12 }, { lng: 0, lat: 0 });
        expect(r.snapType).toBe(SnapType.EDGE);
        expect(r.lng).toBeCloseTo(11, 10);
        expect(r.lat).toBeCloseTo(11, 10);
    });
});

describe('8. o indicador e o ciclo de vida do singleton', () => {
    it('showIndicator escreve uma Feature de ponto com o estilo do tipo', () => {
        const s = servico(true);
        let escrito = null;
        const m = { getSource: () => ({ setData: (d) => { escrito = d; } }) };
        s.showIndicator(m, { lng: 1, lat: 2 }, 'vertex');
        expect(escrito.geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
        expect(escrito.properties.snapType).toBe('vertex');
        expect(escrito.properties.radius).toBe(6);
    });

    it('tipo desconhecido cai no estilo de vertice, em vez de escrever undefined', () => {
        const s = servico(true);
        let escrito = null;
        s.showIndicator({ getSource: () => ({ setData: (d) => { escrito = d; } }) }, { lng: 0, lat: 0 }, 'inventado');
        expect(escrito.properties.radius).toBe(6);
        expect(escrito.properties.color).toBe('#FF6600');
        // O snapType escrito e o PEDIDO, nao o do estilo que acabou sendo usado.
        expect(escrito.properties.snapType).toBe('inventado');
    });

    it('hideIndicator esvazia a colecao, e fonte ausente nao lanca em nenhum dos dois', () => {
        const s = servico(true);
        let escrito = null;
        s.hideIndicator({ getSource: () => ({ setData: (d) => { escrito = d; } }) });
        expect(escrito).toEqual({ type: 'FeatureCollection', features: [] });
        const semFonte = { getSource: () => undefined };
        expect(() => s.hideIndicator(semFonte)).not.toThrow();
        expect(() => s.showIndicator(semFonte, { lng: 0, lat: 0 }, 'edge')).not.toThrow();
    });

    it('o construtor devolve o singleton vivo, e destroy o libera', () => {
        const primeiro = servico(true);
        expect(getSnappingService()).toBe(primeiro);
        const segundo = new SnappingService({ stateManager: { getUnsafe: () => false } });
        expect(segundo).toBe(primeiro);
        // O segundo stateManager foi DESCARTADO: o servico continua com o do primeiro.
        expect(segundo.isEnabled()).toBe(true);
        primeiro.destroy();
        expect(getSnappingService()).toBeNull();
        service = null;
    });

    it('destroy solta os tres ouvintes que o construtor instalou', () => {
        const s = servico(true);
        expect(listeners.doc).toHaveLength(2);
        expect(listeners.win).toHaveLength(1);
        s.destroy();
        expect(listeners.doc).toHaveLength(0);
        expect(listeners.win).toHaveLength(0);
        service = null;
    });
});
