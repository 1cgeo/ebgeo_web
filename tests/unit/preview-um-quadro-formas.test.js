// Path: tests/unit/preview-um-quadro-formas.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * As FORMAS (circulo, elipse, retangulo, setor), DIRIGIDAS.
 *
 * As nove ferramentas de linha ja passam o preview pelo `createPreviewScheduler`
 * (`tests/unit/preview-frame-gate-driven.test.js` prova isso nelas). As quatro
 * formas ainda resolviam o snap no `mousemove` bruto e entregavam a geometria
 * por `setTimeout(..., 8)`. Este arquivo mede as duas coisas de uma vez, e por
 * ferramenta:
 *
 * 1. UM `snapping.resolve` por quadro, com a ULTIMA posicao da rajada. Cinco
 *    `mousemove` dentro de um quadro sao cinco consultas de feicao renderizada
 *    no estado antigo, e o usuario so ve a ultima.
 * 2. UMA escrita na fonte de feedback, DENTRO do quadro. Com os timers falsos e
 *    nenhum avanco de relogio, um `setTimeout(..., 8)` no caminho deixaria a
 *    escrita em zero e um timer pendente: os dois eixos ficam visiveis.
 *
 * A lista `FORMAS` comeca com o circulo (lote F1); os lotes seguintes juntam a
 * sua entrada e herdam os cinco casos sem escrever nenhum.
 *
 * Os controles importam limpo no `node` (nada na cadeia toca `document` no
 * escopo do modulo), entao rodam contra um mapa falso e um
 * `requestAnimationFrame` dirigido a mao. A geometria e trocada por um gravador:
 * o que esta sob teste e QUANTAS vezes e COM O QUE o preview e refeito, e nao a
 * matematica do turf, que tem os testes dela.
 */

const snapping = vi.hoisted(() => ({
    resolveCalls: [],
    indicatorCalls: [],
    hideCalls: 0,
    reset() {
        this.resolveCalls.length = 0;
        this.indicatorCalls.length = 0;
        this.hideCalls = 0;
    },
}));

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat, excludeFeatureId = null) => {
            snapping.resolveCalls.push({ point, lngLat, excludeFeatureId });
            return { lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null };
        },
        showIndicator: (map, snap, type) => snapping.indicatorCalls.push({ snap, type }),
        hideIndicator: () => { snapping.hideCalls += 1; },
    }),
    SnappingService: class {},
}));

/** Um rAF dirigido a mao: nada roda ate `frame()` ser chamado. */
const clock = {
    scheduled: new Map(),
    nextId: 0,
    install() {
        this.scheduled = new Map();
        this.nextId = 0;
        globalThis.requestAnimationFrame = (callback) => {
            const id = ++this.nextId;
            this.scheduled.set(id, callback);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => { this.scheduled.delete(id); };
    },
    frame() {
        const due = [...this.scheduled.values()];
        this.scheduled.clear();
        for (const callback of due) callback();
        return due.length;
    },
};

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
    snapping.reset();
    clock.install();
    // Timers falsos e NUNCA avancados: um `setTimeout` no caminho do preview
    // aparece como escrita que nao aconteceu mais um timer pendente.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

/**
 * Um controle ligado a um mapa falso, com a geometria trocada pelo gravador.
 *
 * @param {Function} Control - A classe do controle
 * @param {Object} geometry - O gravador a instalar
 * @returns {Object} O controle, o mapa e as escritas gravadas
 */
function buildControl(Control, geometry) {
    const written = [];
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    const control = new Control({
        selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
    });
    control.geometry = geometry;

    const map = {
        getZoom: () => 10,
        getSource: (name) => ({ setData: (data) => written.push({ name, data }) }),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => [],
        dragPan: { enable() {}, disable() {} },
        on: () => {},
        off: () => {},
    };
    control.onAdd(map);
    return { control, map, written };
}

/** `n` mousemove dentro de um quadro, terminando em `[n, n]`. */
function burst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ point: { x: i, y: i }, lngLat: { lng: i, lat: i } });
    }
}

/** A mesma rajada como eventos de ponteiro, para o arrasto de alca. */
function pointerBurst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ isPrimary: true, clientX: i, clientY: i, pointerId: 1 });
    }
}

/**
 * O gravador de geometria de uma forma de centro e raio.
 *
 * @param {Array} lista - Onde as chamadas de `generate` sao anotadas
 * @returns {Object} O gravador
 */
function geometriaDeCentroERaio(lista) {
    return {
        calculateDistance: () => 1000,
        calculateBearing: () => 45,
        normalizeCenter: (center) => center,
        generate: (...args) => {
            lista.push(args);
            return { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] };
        },
        calculatePreview: (center, position) => ({
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            handlePosition: position,
        }),
        createHandles: () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }),
    };
}

/**
 * As formas sob a regua. Cada lote acrescenta a sua, e nada mais.
 *
 * `preparar` recebe o controle e o poe no estado do caso; `feedback` e
 * `alcas` sao as fontes que a forma escreve.
 */
const FORMAS = [
    {
        nome: 'circulo',
        importar: () => import('../../src/js/draw_tools/circle_tool/add_circle_control.js'),
        feedback: 'circle-feedback',
        alcas: 'circle-edit-handles',
        geometria: geometriaDeCentroERaio,
        idDaFeicao: 'circle-1',
        // O centro ja clicado, que e o estado em que o preview do raio vive.
        prepararDesenho: (control) => { control.drawPoints = [[0, 0]]; },
        // O que o arrasto de alca precisa: uma feicao selecionada com centro.
        feicao: () => ({
            type: 'Feature',
            properties: { id: 'circle-1', source: 'circle', center: [0, 0], radius: 500 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        }),
        moverDesenho: (control) => control.handlePreviewMouseMove,
        moverPreClique: (control) => control._onPreClickMouseMove,
        moverAlca: (control) => control._onEditPointerMove.bind(control),
    },
];

describe.each(FORMAS)('$nome: um quadro, um resolve, uma escrita', (forma) => {
    async function setup() {
        const modulo = await forma.importar();
        const Control = modulo.default;
        const gerados = [];
        const built = buildControl(Control, forma.geometria(gerados));
        return { ...built, gerados };
    }

    it('resolve o snap UMA vez por quadro, com a ultima posicao da rajada', async () => {
        const { control, written, gerados } = await setup();
        forma.prepararDesenho(control);

        burst(forma.moverDesenho(control), 5);

        // Nada aconteceu no evento bruto: e disso que se trata.
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(written).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.resolveCalls[0].point).toEqual({ x: 5, y: 5 });
        expect(gerados).toHaveLength(1);
        // A geometria saiu do centro clicado, e nao de uma posicao intermediaria.
        expect(gerados[0][0]).toEqual([0, 0]);
    });

    it('escreve o feedback DENTRO do quadro, sem timer nenhum no caminho', async () => {
        const { control, written } = await setup();
        forma.prepararDesenho(control);

        burst(forma.moverDesenho(control), 5);
        clock.frame();

        // Com os timers falsos e o relogio parado, uma escrita adiada por
        // `setTimeout(..., 8)` sairia como zero escritas e um timer pendente.
        const noFeedback = written.filter((w) => w.name === forma.feedback);
        expect(noFeedback).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
        // E o quadro seguinte nao redesenha nada por conta propria.
        expect(clock.frame()).toBe(0);
    });

    it('o indicador antes do primeiro clique tambem coalesce', async () => {
        const { control, written } = await setup();

        burst(forma.moverPreClique(control), 5);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        // Nao ha o que desenhar antes do primeiro clique.
        expect(written).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('o arrasto de alca anda pelo mesmo quadro e exclui a propria feicao', async () => {
        const { control, written } = await setup();
        const feature = forma.feicao();
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        control.isDraggingHandle = true;

        pointerBurst(forma.moverAlca(control), 5);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe(forma.idDaFeicao);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(written.filter((w) => w.name === forma.feedback)).toHaveLength(1);
        expect(written.filter((w) => w.name === forma.alcas)).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancelPendingUpdates derruba o quadro, e nada e desenhado depois', async () => {
        const { control, written, gerados } = await setup();
        forma.prepararDesenho(control);

        burst(forma.moverDesenho(control), 3);
        control.cancelPendingUpdates();

        expect(clock.frame()).toBe(0);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(gerados).toHaveLength(0);
        expect(written).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('um movimento depois do quadro compra um quadro novo', async () => {
        const { control } = await setup();
        forma.prepararDesenho(control);

        burst(forma.moverDesenho(control), 2);
        clock.frame();
        burst(forma.moverDesenho(control), 4);
        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(2);
        expect(snapping.resolveCalls.map((c) => c.lngLat.lng)).toEqual([2, 4]);
    });
});

describe('a regua cobre as formas que diz cobrir', () => {
    it('a lista comeca no circulo e cresce com os lotes seguintes', () => {
        expect(FORMAS.map((f) => f.nome)).toContain('circulo');
        // Um `describe.each` de lista vazia nao roda caso nenhum e passa calado.
        expect(FORMAS.length).toBeGreaterThanOrEqual(1);
    });

    it('cada forma declara os tres caminhos de preview que a regua dirige', () => {
        for (const forma of FORMAS) {
            expect(typeof forma.prepararDesenho, forma.nome).toBe('function');
            expect(typeof forma.moverDesenho, forma.nome).toBe('function');
            expect(typeof forma.moverPreClique, forma.nome).toBe('function');
            expect(typeof forma.moverAlca, forma.nome).toBe('function');
            expect(forma.feedback, forma.nome).toMatch(/-feedback$/);
            expect(forma.alcas, forma.nome).toMatch(/-edit-handles$/);
        }
    });

    it('o rAF dirigido nao roda sozinho, senao a rajada nunca ficaria num quadro', () => {
        clock.install();
        let correu = false;
        globalThis.requestAnimationFrame(() => { correu = true; });
        expect(correu).toBe(false);
        expect(clock.frame()).toBe(1);
        expect(correu).toBe(true);
    });
});
