// Path: tests/unit/caixa-de-selecao-ferramenta-tardia.repro.test.js

/**
 * @fileoverview A caixa de seleção de uma feição cuja ferramenta TARDIA ainda não subiu.
 *
 * Relato do dono, 2026-09-24: "Tool sector does not implement selection box interface" (e o
 * mesmo para elipse e retângulo), às vezes, ao clicar numa feição. As três implementam. A causa
 * é ordem: `selectFeature` publica a seleção no StateManager, cujo assinante é o passe de
 * destaque, síncrono, e só DEPOIS chama `ensureControlFor`. No primeiro clique da sessão numa
 * feição de ferramenta tardia o passe encontra `controls` sem o tipo, não desenha a caixa e
 * acusa a ferramenta. "Às vezes" é "a primeira vez de cada tipo por sessão".
 *
 * O conserto mora no passe (`_carregarControleTardio`), que é o funil dos três caminhos que
 * publicam antes de carregar (`selectFeature`, `selectGroup` e o `move_handler`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const estadoDoStore = vi.hoisted(() => ({ selecionadas: [] }));

vi.mock('@store', () => ({
    getStateManager: () => ({
        getUnsafe: (chave) => {
            if (chave === 'selection.features') return estadoDoStore.selecionadas;
            return undefined;
        },
    }),
}));

vi.mock('@utils/turf-loader.js', () => ({
    ensureTurf: () => Promise.resolve({}),
    resetTurfLoader: () => {},
}));

const { SelectionHighlightManager } = await import('@tools/managers/selection-highlight.manager.js');

function montarMapa() {
    const escritas = [];
    return {
        escritas,
        on() {},
        off() {},
        getZoom: () => 10,
        getBearing: () => 0,
        getPitch: () => 0,
        getCenter: () => ({ lng: 0, lat: 0 }),
        getSource: (id) => (id === 'selection-boxes' ? { setData: (d) => escritas.push(d) } : null),
        project: ([lng, lat]) => ({ x: lng * 1000, y: lat * 1000 }),
        unproject: ([x, y]) => ({ lng: x / 1000, lat: y / 1000 }),
    };
}

const controleDoSetor = {
    getSelectionBoxStrategy: () => 'bbox',
    createSelectionBox: () => ({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    }),
};

/**
 * O SelectionManager no instante do defeito: o tipo tem DESCRITOR (ferramenta tardia
 * registrada no boot) e nenhum controle. A carga resolve quando o teste mandar.
 */
function montarSelecao() {
    const carga = {};
    const selecao = {
        controls: new Map(),
        controlFactories: new Map([['sector', { ensure: () => null }]]),
        pedidos: 0,
        ensureControlFor(type) {
            selecao.pedidos += 1;
            return new Promise((resolve) => {
                carga.resolver = (controle) => {
                    if (controle) {
                        selecao.controls.set(type, controle);
                        selecao.controlFactories.delete(type);
                    }
                    resolve(controle);
                };
            });
        },
    };
    return { selecao, carga };
}

const setor = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: { id: 's1', source: 'sector' },
};

let aviso;

beforeEach(() => {
    globalThis.turf = {};
    estadoDoStore.selecionadas = [{ type: 'sector', feature: setor }];
    aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    aviso.mockRestore();
    delete globalThis.turf;
});

describe('caixa de seleção de ferramenta tardia ainda não carregada', () => {
    it('REPRO: o passe pede a ferramenta UMA vez, não acusa, e desenha quando ela chega', async () => {
        const mapa = montarMapa();
        const { selecao, carga } = montarSelecao();
        const gerente = new SelectionHighlightManager(mapa, selecao);

        // Vários passes antes da carga (a publicação, e quadros de zoom no meio).
        for (let i = 0; i < 5; i++) gerente.updateSelectionHighlight();
        expect(selecao.pedidos).toBe(1);
        expect(aviso).not.toHaveBeenCalled();

        carga.resolver(controleDoSetor);
        await Promise.resolve();
        await Promise.resolve();

        expect(mapa.escritas.at(-1).features).toHaveLength(1);
        expect(aviso).not.toHaveBeenCalled();
        gerente.destroy();
    });

    it('carga que falha não vira laço: nenhum pedido novo a cada passe', async () => {
        const mapa = montarMapa();
        const { selecao, carga } = montarSelecao();
        const gerente = new SelectionHighlightManager(mapa, selecao);

        gerente.updateSelectionHighlight();
        carga.resolver(null);
        await Promise.resolve();
        await Promise.resolve();
        for (let i = 0; i < 5; i++) gerente.updateSelectionHighlight();

        expect(selecao.pedidos).toBe(1);
        gerente.destroy();
    });

    it('tipo SEM controle e SEM descritor continua acusado: esse é defeito de verdade', () => {
        const mapa = montarMapa();
        const { selecao } = montarSelecao();
        selecao.controlFactories.clear();
        const gerente = new SelectionHighlightManager(mapa, selecao);

        gerente.updateSelectionHighlight();

        expect(selecao.pedidos).toBe(0);
        expect(aviso).toHaveBeenCalledWith('Tool sector does not implement selection box interface');
        gerente.destroy();
    });
});
