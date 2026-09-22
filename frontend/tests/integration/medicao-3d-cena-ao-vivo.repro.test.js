// Path: tests/integration/medicao-3d-cena-ao-vivo.repro.test.js
//
// A MEDIÇÃO 3D DO COLEGA NA CENA, AO VIVO (2026-09-22). Relato do dono no mesmo dia: "não tá
// propagando no 3D as feições, ao adicionar não aparece para outro usuário".
//
// A CAUSA RAIZ, ELO POR ELO. A op `measurement3d` do autor chega ao par (o transporte está preso do
// servidor ao IndexedDB do par por `backend/tests/ws/collab-3d-360-broadcast.test.js` e por
// `e2e-ui/browser-collab-3d-360.spec.js`), o tratador remoto grava o documento lateral, derruba o
// espelho em memória e emite `MEASUREMENTS_3D_CHANGED`. O elo que faltava é o ÚLTIMO: dentro do
// visualizador 3D, `measurement_tool_3d.js` só escutava `LAYERS_CHANGED`, e ninguém repintava a cena
// a partir do store quando o conjunto de medições mudava. A distância ou a área do colega só
// aparecia depois de FECHAR E REABRIR o 3D, e a que o colega apagou continuava na tela. O marcador
// tinha o mesmo defeito e o perdeu em 2026-09-16 (`marcador-3d-cena-ao-vivo.test.js`); a medição
// ficou para trás.
//
// CONTROLE NEGATIVO: sem a inscrição em `initMeasurementToolListeners`, o primeiro caso deste
// arquivo fica vermelho (o evento sai e a cena continua com uma medição só).
//
// O Cesium é dublado no mínimo necessário para a cena. O dublê de `entities.add` RECUSA id repetido,
// como o Cesium real faz, porque desenhar duas vezes a mesma medição é o defeito que uma
// reconciliação descuidada introduz, e um dublê permissivo o esconderia.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ===== Dublê do Cesium =====
/** O último ScreenSpaceEventHandler criado, por onde o teste dispara o clique de seleção. */
let ultimoHandler = null;

class FakeEntity {
    constructor(options) {
        Object.assign(this, options);
    }
}

function instalarCesium() {
    class Color {
        constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
        withAlpha(a) { return new Color(this.r, this.g, this.b, a); }
    }
    Color.WHITE = new Color(1, 1, 1, 1);
    Color.ORANGE = new Color(1, 0.6, 0, 1);
    Color.CYAN = new Color(0, 1, 1, 1);
    Color.YELLOW = new Color(1, 1, 0, 1);

    // O módulo checa `window.Cesium` em um ponto e usa o global `Cesium` em outro; o dublê
    // precisa existir nos dois, e este arquivo roda em ambiente node (sem window por padrão).
    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.Cesium = {
        Color,
        Cartesian2: class { constructor(x, y) { Object.assign(this, { x, y }); } },
        Cartesian3: { fromDegrees: (lon, lat, height) => ({ lon, lat, height }) },
        PolygonHierarchy: class { constructor(positions) { this.positions = positions; } },
        BoundingSphere: { fromPoints: (points) => ({ center: points[0], radius: 1 }) },
        VerticalOrigin: { BOTTOM: 'bottom', CENTER: 'center' },
        HorizontalOrigin: { CENTER: 'center' },
        LabelStyle: { FILL_AND_OUTLINE: 'fill_and_outline' },
        HeightReference: { NONE: 'none' },
        ScreenSpaceEventType: { LEFT_CLICK: 'left_click' },
        defined: (v) => v !== undefined && v !== null,
        // O handler guarda a ação registrada para que o teste clique pelo caminho REAL de seleção,
        // em vez de mexer num estado interno que o módulo não expõe.
        ScreenSpaceEventHandler: class {
            constructor() { this.acoes = new Map(); ultimoHandler = this; }
            setInputAction(fn, tipo) { this.acoes.set(tipo, fn); }
            removeInputAction(tipo) { this.acoes.delete(tipo); }
            destroy() {}
            isDestroyed() { return false; }
        },
    };
    globalThis.window.Cesium = globalThis.Cesium;
}

function criarViewer() {
    const porId = new Map();
    return {
        _entidades: porId,
        isDestroyed: () => false,
        selectedEntity: undefined,
        canvas: { style: {}, addEventListener() {}, removeEventListener() {} },
        scene: { pick: () => undefined },
        entities: {
            add(options) {
                // Como o Cesium: um segundo `add` com o mesmo id é erro, não substituição.
                if (porId.has(options.id)) throw new Error(`An entity with id ${options.id} already exists`);
                const entity = new FakeEntity(options);
                porId.set(options.id, entity);
                return entity;
            },
            remove(entity) { return porId.delete(entity?.id); },
            contains(entity) { return porId.get(entity?.id) === entity; },
            getById(id) { return porId.get(id); },
            removeAll() { porId.clear(); },
        },
    };
}

/** Ids de medição com linha viva na cena (toda medição desenhada tem uma). */
function medicoesNaCena(viewer) {
    return [...viewer._entidades.keys()]
        .filter((id) => id.startsWith('measurement-3d-line-'))
        .map((id) => id.replace('measurement-3d-line-', ''))
        .sort();
}

// ===== Dublês de módulo =====
const { storeMock, busMock } = vi.hoisted(() => ({
    storeMock: { getMeasurements: vi.fn(async () => []), removeMeasurement: vi.fn(async () => true) },
    busMock: (() => {
        const registry = new Map();
        return {
            on: vi.fn((evt, handler) => {
                if (!registry.has(evt)) registry.set(evt, new Set());
                registry.get(evt).add(handler);
                return () => registry.get(evt)?.delete(handler);
            }),
            off: vi.fn(),
            emit: vi.fn((evt, payload) => {
                for (const handler of [...(registry.get(evt) ?? [])]) handler(payload);
            }),
            ouvintes: (evt) => registry.get(evt)?.size ?? 0,
            _registry: registry,
        };
    })(),
}));

vi.mock('@store/index.js', () => ({
    addMeasurement: vi.fn(),
    getMeasurements: (...args) => storeMock.getMeasurements(...args),
    updateMeasurement: vi.fn(),
    removeMeasurement: (...args) => storeMock.removeMeasurement(...args),
    DEFAULT_MEASUREMENT_STYLE: {
        lineColor: '#FFFF00', lineWidth: 3, lineOpacity: 1,
        fillColor: '#FFFF00', fillOpacity: 0.2,
        labelColor: '#ffffff', labelSize: 14,
        labelOutlineColor: '#000000', labelOutlineWidth: 2,
        labelBackgroundColor: '#FFFF00', labelBackgroundOpacity: 0.8,
    },
}));

vi.mock('@store/services.js', () => ({ getEventBus: () => busMock }));

// O botão de finalizar mora em `document.body`; nada dele é o assunto aqui.
vi.mock('@js/draw_tools/drawing-touch-helpers.js', () => ({
    DrawingFinishButton: class {
        show() {}
        hide() {}
        setEnabled() {}
    },
}));

const { EventTypes } = await import('@events/event_types.js');
const {
    initMeasurementToolListeners,
    renderMeasurementsForTileset,
    syncMeasurementsFromStore,
    getSelectedMeasurementId,
    cleanupMeasurementTool,
    deleteMeasurement,
} = await import('../../src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js');

/** Seleciona uma medição pelo caminho real: o clique que o handler passivo do módulo registrou. */
function clicarNaMedicao(viewer, measurementId) {
    const entity = viewer.entities.getById(`measurement-3d-line-${measurementId}`);
    viewer.scene.pick = () => ({ id: entity });
    ultimoHandler.acoes.get('left_click')({ position: { x: 1, y: 1 } });
}

function medicao(id, { nome = id, valor = 12.5 } = {}) {
    return {
        id,
        tilesetId: 'modelo-1',
        type: 'distance',
        positions: [
            { longitude: -43.2, latitude: -22.9, height: 10 },
            { longitude: -43.21, latitude: -22.91, height: 12 },
        ],
        result: { value: valor, formatted: '' },
        properties: { nome, descricao: '' },
        style: {},
        images: [],
        sync: { deleted: false },
    };
}

/** O texto do rótulo da medição, que é o que a pessoa lê na cena. */
function rotuloDe(viewer, id) {
    return viewer.entities.getById(`measurement-3d-label-${id}`)?.label?.text;
}

let viewer;

beforeEach(() => {
    vi.clearAllMocks();
    busMock._registry.clear();
    instalarCesium();
    viewer = criarViewer();
    cleanupMeasurementTool();
});

describe('cena 3D — medição que chega do colega', () => {
    it('o evento MEASUREMENTS_3D_CHANGED pinta a medição criada pelo par SEM fechar e reabrir o 3D', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
            await renderMeasurementsForTileset(viewer, 'modelo-1');
            initMeasurementToolListeners();
            expect(medicoesNaCena(viewer)).toEqual(['d1']);

            // A op do colega já foi gravada no store pelo tratador remoto; o que chega aqui é o aviso.
            storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2')]);
            busMock.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: 'uuid-do-mapa' });

            await vi.advanceTimersByTimeAsync(80);
            await vi.waitFor(() => expect(medicoesNaCena(viewer)).toEqual(['d1', 'd2']));
            // A leitura é do tileset ABERTO, e nenhum outro.
            expect(storeMock.getMeasurements).toHaveBeenLastCalledWith('modelo-1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('tira da cena a medição que o par apagou', async () => {
        storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');

        storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
        await syncMeasurementsFromStore();

        expect(medicoesNaCena(viewer)).toEqual(['d1']);
        // Nenhum pedaço dela sobra: nem vértice, nem rótulo.
        expect([...viewer._entidades.keys()].some((id) => id.includes('-d2'))).toBe(false);
    });

    it('PRESERVA a seleção local quando o par mexe em outra medição', async () => {
        // A regressão que este caso impede: reusar `refreshMeasurementsForCurrentTileset` aqui
        // limparia a cena inteira e desselecionaria, fechando o painel do usuário no meio da edição
        // dele por causa de uma medição do outro lado do modelo.
        storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');
        clicarNaMedicao(viewer, 'd1');
        expect(getSelectedMeasurementId()).toBe('d1');
        busMock.emit.mockClear();

        storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2'), medicao('d3')]);
        await syncMeasurementsFromStore();

        expect(getSelectedMeasurementId()).toBe('d1');
        expect(medicoesNaCena(viewer)).toEqual(['d1', 'd2', 'd3']);
        expect(busMock.emit).not.toHaveBeenCalledWith(EventTypes.MEASUREMENT_3D_DESELECTED, expect.anything());
    });

    it('desseleciona quando foi a medição SELECIONADA que o par apagou', async () => {
        storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');
        clicarNaMedicao(viewer, 'd2');

        storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
        await syncMeasurementsFromStore();

        expect(getSelectedMeasurementId()).toBeNull();
        expect(busMock.emit).toHaveBeenCalledWith(EventTypes.MEASUREMENT_3D_DESELECTED, { tilesetId: 'modelo-1' });
    });

    it('refaz a medição quando o par a EDITA, e não refaz a que ficou igual', async () => {
        storeMock.getMeasurements.mockResolvedValue([medicao('d1', { valor: 10 }), medicao('d2')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');
        const linhaIntacta = viewer.entities.getById('measurement-3d-line-d2');
        const rotuloAntes = rotuloDe(viewer, 'd1');

        storeMock.getMeasurements.mockResolvedValue([medicao('d1', { valor: 2500 }), medicao('d2')]);
        await syncMeasurementsFromStore();

        expect(rotuloDe(viewer, 'd1')).not.toBe(rotuloAntes);
        // A que não mudou continua sendo a MESMA entidade: refazer tudo a cada op faria a cena piscar.
        expect(viewer.entities.getById('measurement-3d-line-d2')).toBe(linhaIntacta);
    });

    it('uma rajada de eventos custa UMA leitura do store', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
            await renderMeasurementsForTileset(viewer, 'modelo-1');
            initMeasurementToolListeners();

            storeMock.getMeasurements.mockClear();
            storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2'), medicao('d3')]);

            // Três ops do mesmo lote de sync.
            busMock.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: 'M' });
            busMock.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: 'M' });
            busMock.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: 'M' });
            expect(storeMock.getMeasurements).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(80);
            await vi.waitFor(() => expect(medicoesNaCena(viewer)).toEqual(['d1', 'd2', 'd3']));
            expect(storeMock.getMeasurements).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a leitura que volta DEPOIS de uma troca de modelo não pinta o modelo antigo por cima do novo', async () => {
        storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');

        let liberar;
        storeMock.getMeasurements.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve; }));
        const emVoo = syncMeasurementsFromStore();

        // Enquanto a leitura do modelo-1 não volta, a pessoa abre o modelo-2, que não tem medição.
        storeMock.getMeasurements.mockResolvedValue([]);
        await renderMeasurementsForTileset(viewer, 'modelo-2');
        liberar([medicao('d1'), medicao('velha')]);
        await emVoo;

        expect(medicoesNaCena(viewer)).toEqual([]);
    });

    it('uma leitura que começou ANTES de uma escrita local é refeita, e não desfaz a escrita', async () => {
        // A pessoa apaga uma medição enquanto a reconciliação disparada por um colega ainda lê o
        // store. A leitura velha ainda traz a medição apagada; aplicada, ela a devolveria à cena.
        storeMock.getMeasurements.mockResolvedValue([medicao('d1'), medicao('d2')]);
        await renderMeasurementsForTileset(viewer, 'modelo-1');

        let liberar;
        storeMock.getMeasurements.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve; }));
        const emVoo = syncMeasurementsFromStore();

        expect(await deleteMeasurement('d2')).toBe(true);
        storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
        liberar([medicao('d1'), medicao('d2')]);
        await emVoo;

        expect(medicoesNaCena(viewer)).toEqual(['d1']);
    });

    it('o destroy do visualizador solta o ouvinte e o temporizador pendente', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getMeasurements.mockResolvedValue([medicao('d1')]);
            await renderMeasurementsForTileset(viewer, 'modelo-1');
            initMeasurementToolListeners();
            expect(busMock.ouvintes(EventTypes.MEASUREMENTS_3D_CHANGED)).toBe(1);

            // Um aviso chega e o visualizador é destruído antes de a janela de coalescência fechar.
            busMock.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: 'M' });
            storeMock.getMeasurements.mockClear();
            cleanupMeasurementTool();

            await vi.advanceTimersByTimeAsync(200);
            expect(storeMock.getMeasurements).not.toHaveBeenCalled();
            expect(busMock.ouvintes(EventTypes.MEASUREMENTS_3D_CHANGED)).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
