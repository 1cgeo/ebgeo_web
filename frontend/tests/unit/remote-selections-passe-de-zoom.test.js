// Path: tests/unit/remote-selections-passe-de-zoom.test.js

/**
 * @fileoverview O passe de zoom das caixas de selecao REMOTAS, dirigido por quadros.
 *
 * Duas afirmacoes, e as duas nasceram de medida no Chromium sobre `npm run dev`, num
 * gesto de `easeTo` de 1,5 nivel em 1,5 s (92 quadros):
 *
 *   1. O passe TEM de rodar ao longo do gesto. Ate 2026-09-05 o `_scheduleRender`
 *      cancelava e reagendava o proprio quadro, e o cancelamento matava a callback
 *      antes de ela rodar: 92 eventos `zoom`, UM `_render`, esse depois do gesto. A
 *      caixa do colega ficava congelada. O relogio deste arquivo modela a ordem que
 *      produz a fome (o mapa pede o quadro seguinte ANTES de emitir o `zoom` daquele
 *      quadro), porque sem ela um teste de quadro nao ve o defeito.
 *   2. O quadro de zoom NAO pode voltar a fonte. `getCompleteFeatureFromSource`
 *      reconstroi a colecao inteira e varre o vetor, O(feicoes na fonte) por feicao
 *      selecionada; rodando por quadro sem cache o gesto fez 2.300 resolucoes com 50
 *      selecoes remotas num mapa de 350. O zoom nao muda QUEM esta selecionado nem a
 *      geometria da feicao, so a caixa.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { presenceStoreMock, sessionContextMock, eventBusMock, busRegistry } = vi.hoisted(() => {
    const registry = {};
    return {
        presenceStoreMock: { getSelections: vi.fn(() => []) },
        sessionContextMock: { clientId: 'eu', userId: null },
        eventBusMock: {
            on: vi.fn((evento, handler) => {
                (registry[evento] ||= new Set()).add(handler);
                return () => registry[evento].delete(handler);
            }),
            off: vi.fn(),
            emit: vi.fn(),
        },
        busRegistry: registry,
    };
});

vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: presenceStoreMock }));
vi.mock('@store/sync/session-context.js', () => ({ sessionContext: sessionContextMock }));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));
vi.mock('@store', () => ({ getCurrentMapNameSync: () => 'mapa-1' }));
vi.mock('@js/presence/presence-colors.js', () => ({ getPresenceColor: () => '#ff0000' }));

const { RemoteSelectionsLayer } = await import('@js/presence/remote-selections.layer.js');
const { EventTypes } = await import('@events/event_types.js');

// ---------------------------------------------------------------------------
// O relogio, com o algoritmo do navegador (ver o gemeo em
// `selection-highlight-passe-de-zoom.test.js`, que explica por que ele importa).
// ---------------------------------------------------------------------------
const relogio = {
    entradas: new Map(),
    proximoId: 0,
    instalar() {
        this.entradas = new Map();
        this.proximoId = 0;
        globalThis.requestAnimationFrame = (cb) => {
            const id = ++this.proximoId;
            this.entradas.set(id, cb);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => { this.entradas.delete(id); };
    },
    quadro() {
        const lote = [...this.entradas.keys()];
        let rodaram = 0;
        for (const id of lote) {
            if (!this.entradas.has(id)) continue;
            const cb = this.entradas.get(id);
            this.entradas.delete(id);
            rodaram += 1;
            cb(0);
        }
        return rodaram;
    },
};

const rafOriginal = globalThis.requestAnimationFrame;
const cancelOriginal = globalThis.cancelAnimationFrame;

function montarMapa() {
    const ouvintes = new Map();
    const escritas = [];
    const fonte = { setData: (dados) => escritas.push(dados) };
    return {
        zoom: 6,
        escritas,
        ouvintes,
        on(tipo, cb) { if (!ouvintes.has(tipo)) ouvintes.set(tipo, []); ouvintes.get(tipo).push(cb); },
        off(tipo, cb) {
            const lista = ouvintes.get(tipo) || [];
            const i = lista.indexOf(cb);
            if (i >= 0) lista.splice(i, 1);
        },
        emitir(tipo) { for (const cb of [...(ouvintes.get(tipo) || [])]) cb(); },
        getZoom() { return this.zoom; },
        getSource(id) { return id === 'remote-selection-boxes' ? fonte : null; },
    };
}

function ligarMotor(mapa, passo) {
    const volta = () => {
        mapa.__motor = requestAnimationFrame(volta);
        mapa.zoom += passo;
        mapa.emitir('zoom');
    };
    mapa.__motor = requestAnimationFrame(volta);
}

/**
 * Um SelectionManager de mentira que conta as idas a fonte, e um controle cuja caixa
 * DEPENDE do zoom (e o que o zoom existe para refazer).
 */
function montarSelectionManager(mapa, ids) {
    const contagem = { resolucoes: 0, caixas: 0 };
    const controle = {
        createSelectionBox(feature) {
            contagem.caixas += 1;
            const meio = 20 / (2 ** mapa.zoom);
            const [lng, lat] = feature.geometry.coordinates;
            return {
                type: 'Polygon',
                coordinates: [[
                    [lng - meio, lat - meio], [lng + meio, lat - meio],
                    [lng + meio, lat + meio], [lng - meio, lat + meio],
                    [lng - meio, lat - meio],
                ]],
            };
        },
    };
    const selectionManager = {
        controls: new Map([['point', controle]]),
        async getCompleteFeatureFromSource(tipo, id) {
            contagem.resolucoes += 1;
            if (!ids.includes(String(id))) return null;
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [10, 20] },
                properties: { id: String(id), source: 'points' },
            };
        },
    };
    return { selectionManager, contagem };
}

function selecaoDoColega(ids) {
    return [{
        clientId: 'colega', userId: 'colega', userName: 'Colega', surface: '2d',
        featureIds: ids, featureMeta: ids.map((id) => ({ id, type: 'point' })),
        mapId: 'mapa-1', tilesetId: null, photoName: null,
    }];
}

function emitir(evento) {
    for (const cb of busRegistry[evento] || []) cb({});
}

/** Espera as promessas pendentes do `_render` (que e assincrono por desenho). */
async function assentar() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
    relogio.instalar();
    for (const k of Object.keys(busRegistry)) delete busRegistry[k];
    presenceStoreMock.getSelections.mockReset();
    presenceStoreMock.getSelections.mockReturnValue([]);
    sessionContextMock.clientId = 'eu';
    sessionContextMock.userId = null;
});

afterEach(() => {
    globalThis.requestAnimationFrame = rafOriginal;
    globalThis.cancelAnimationFrame = cancelOriginal;
});

describe('RemoteSelectionsLayer: o passe de zoom por quadro', () => {
    it('o passe roda ao longo do gesto, e nao passa fome no proprio debounce', async () => {
        const mapa = montarMapa();
        const ids = ['a', 'b', 'c'];
        const { selectionManager, contagem } = montarSelectionManager(mapa, ids);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();
        const caixasNoInicio = contagem.caixas;

        ligarMotor(mapa, 0.05);
        const QUADROS = 30;
        for (let i = 0; i < QUADROS; i++) { relogio.quadro(); await assentar(); }

        // Uma passada a cada dois quadros (a callback pedida no quadro N roda no N+1,
        // e no N+1 o mapa emite antes dela). Zero era o estado anterior. Conta CAIXAS
        // REMONTADAS, nao escritas: a escrita tem guarda propria, no caso de baixo.
        const remontagens = (contagem.caixas - caixasNoInicio) / ids.length;
        expect(remontagens).toBeGreaterThanOrEqual(Math.floor(QUADROS / 2) - 1);
        camada.stop();
    });

    it('o quadro que remonta o MESMO desenho nao escreve a fonte', async () => {
        const mapa = montarMapa();
        const ids = ['a', 'b'];
        // Um controle cuja caixa NAO depende do zoom, que e o caso da feicao com
        // correcao de zoom ligada: o desenho e o mesmo em todo quadro do gesto.
        const { selectionManager, contagem } = montarSelectionManager(mapa, ids);
        const controle = selectionManager.controls.get('point');
        controle.createSelectionBox = (feature) => {
            contagem.caixas += 1;
            const [lng, lat] = feature.geometry.coordinates;
            return {
                type: 'Polygon',
                coordinates: [[[lng - 1, lat - 1], [lng + 1, lat - 1], [lng + 1, lat + 1], [lng - 1, lat + 1], [lng - 1, lat - 1]]],
            };
        };
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();
        const escritasNoInicio = mapa.escritas.length;
        const caixasNoInicio = contagem.caixas;

        for (let i = 0; i < 20; i++) {
            mapa.zoom += 0.05;
            mapa.emitir('zoom');
            relogio.quadro();
            await assentar();
        }

        // Remontou (o passe rodou), e nao escreveu nenhuma vez (o desenho e o mesmo).
        expect(contagem.caixas - caixasNoInicio).toBeGreaterThan(0);
        expect(mapa.escritas.length - escritasNoInicio).toBe(0);
        camada.stop();
    });

    it('o quadro de zoom NAO volta a fonte: zero resolucoes depois do primeiro render', async () => {
        const mapa = montarMapa();
        const ids = ['a', 'b', 'c'];
        const { selectionManager, contagem } = montarSelectionManager(mapa, ids);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();
        expect(contagem.resolucoes).toBe(ids.length);

        // Dirige o agendamento do ZOOM diretamente, um por quadro, para medir o custo
        // do quadro sem depender da ordem que produz a fome.
        const resolucoesAntes = contagem.resolucoes;
        const caixasAntes = contagem.caixas;
        for (let i = 0; i < 20; i++) {
            mapa.zoom += 0.05;
            mapa.emitir('zoom');
            relogio.quadro();
            await assentar();
        }

        expect(contagem.resolucoes - resolucoesAntes).toBe(0);
        // E a caixa foi mesmo REMONTADA: o zoom muda a geometria dela.
        expect(contagem.caixas - caixasAntes).toBeGreaterThan(0);
        camada.stop();
    });

    it('LAYERS_CHANGED invalida a lista resolvida, entao a geometria arrastada volta a ser lida', async () => {
        const mapa = montarMapa();
        const ids = ['a', 'b'];
        const { selectionManager, contagem } = montarSelectionManager(mapa, ids);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();

        mapa.emitir('zoom');
        relogio.quadro();
        await assentar();
        const depoisDoZoom = contagem.resolucoes;

        emitir(EventTypes.LAYERS_CHANGED);
        relogio.quadro();
        await assentar();

        expect(contagem.resolucoes - depoisDoZoom).toBe(ids.length);
        camada.stop();
    });

    it('a caixa remota ACOMPANHA o zoom: a geometria escrita muda com o nivel', async () => {
        const mapa = montarMapa();
        const ids = ['a'];
        const { selectionManager } = montarSelectionManager(mapa, ids);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();
        const primeira = JSON.stringify(mapa.escritas.at(-1).features[0].geometry);

        mapa.zoom += 1.5;
        mapa.emitir('zoom');
        relogio.quadro();
        await assentar();

        const ultima = JSON.stringify(mapa.escritas.at(-1).features[0].geometry);
        expect(ultima).not.toBe(primeira);
        camada.stop();
    });

    it('assina zoom, rotate e pitch, e larga os tres no stop', () => {
        // A caixa de um par em volta de feicao com icone e o retangulo RENDERIZADO,
        // alinhado a TELA: girar ou inclinar a move contra o terreno. Espelha o
        // `SelectionHighlightManager`, cuja chave de cache carrega mira e inclinacao.
        const mapa = montarMapa();
        const { selectionManager } = montarSelectionManager(mapa, []);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega([]));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();

        for (const tipo of ['zoom', 'rotate', 'pitch']) {
            expect(mapa.ouvintes.get(tipo)).toEqual([camada._onZoom]);
        }

        camada.stop();

        for (const tipo of ['zoom', 'rotate', 'pitch']) {
            expect(mapa.ouvintes.get(tipo)).toEqual([]);
        }
    });

    it('stop larga o quadro pendente, limpa a fonte e esquece a lista resolvida', async () => {
        const mapa = montarMapa();
        const ids = ['a'];
        const { selectionManager, contagem } = montarSelectionManager(mapa, ids);
        presenceStoreMock.getSelections.mockReturnValue(selecaoDoColega(ids));

        const camada = new RemoteSelectionsLayer(mapa, selectionManager);
        camada.start();
        await assentar();

        mapa.emitir('zoom');
        camada.stop();
        const escritasNoStop = mapa.escritas.length;
        const caixasNoStop = contagem.caixas;
        relogio.quadro();
        await assentar();

        expect(mapa.escritas.length).toBe(escritasNoStop);
        expect(contagem.caixas).toBe(caixasNoStop);
        // O `stop` limpa a fonte: a ultima escrita e a colecao vazia.
        expect(mapa.escritas.at(-1).features).toEqual([]);
    });
});
