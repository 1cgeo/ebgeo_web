// Path: tests/integration/marcador-3d-cena-ao-vivo.test.js
//
// A CENA 3D CONTRA O STORE, AO VIVO (2026-09-16).
//
// O DEFEITO QUE ESTE ARQUIVO EXISTE PARA PRENDER: o marcador que um colega criava era gravado no
// side-store, `MARKERS_3D_CHANGED` era emitido, e ninguem dentro do visualizador 3D escutava. O
// marcador so aparecia depois de FECHAR E REABRIR o 3D, que era a unica repintura a partir do
// store; o apagado pelo colega continuava na tela pelo mesmo motivo. O irmao 2D deste caso e
// `tests/unit/remote-feature-render.test.js`, e o defeito la ja tinha sido fechado.
//
// POR QUE ELE E NOVO E NAO UM CASO A MAIS NUM ARQUIVO EXISTENTE: ate hoje NENHUM teste importava
// `marker_tool_3d.js` (grep em tests/). A cena 3D nao tinha cobertura nenhuma, e o teste de
// colaboracao que existe (`e2e-ui/browser-collab-3d-360.spec.js`) le o IndexedDB do par, nunca a
// cena: um marcador que chega ao disco e nao aparece na tela PASSA naquele teste.
//
// O Cesium e dublado no minimo necessario para a cena: o que se afere aqui e quais entidades
// existem depois de cada evento, nao como elas sao desenhadas.

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
    Color.TRANSPARENT = new Color(0, 0, 0, 0);

    // O módulo checa `window.Cesium` em um ponto e usa o global `Cesium` em outro; o dublê
    // precisa existir nos dois, e este arquivo roda em ambiente node (sem window por padrão).
    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.Cesium = {
        Color,
        Cartesian2: class { constructor(x, y) { Object.assign(this, { x, y }); } },
        Cartesian3: { fromDegrees: (lon, lat, height) => ({ lon, lat, height }) },
        ConstantProperty: class { constructor(value) { this.value = value; } },
        VerticalOrigin: { BOTTOM: 'bottom' },
        HorizontalOrigin: { CENTER: 'center', LEFT: 'left' },
        LabelStyle: { FILL_AND_OUTLINE: 'fill_and_outline' },
        HeightReference: { NONE: 'none' },
        ScreenSpaceEventType: { LEFT_CLICK: 'left_click' },
        defined: (v) => v !== undefined && v !== null,
        // O handler guarda a acao registrada para que o teste clique pelo caminho REAL de selecao,
        // em vez de mexer num estado interno que o modulo nao expoe.
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
        scene: {
            canvas: { addEventListener() {}, removeEventListener() {} },
            pick: () => undefined,
        },
        entities: {
            add(options) {
                const entity = new FakeEntity(options);
                porId.set(options.id, entity);
                return entity;
            },
            remove(entity) { porId.delete(entity?.id); return true; },
            getById(id) { return porId.get(id); },
            removeAll() { porId.clear(); },
        },
    };
}

/** Ids de marcador com entidade viva na cena. */
function marcadoresNaCena(viewer) {
    return [...viewer._entidades.keys()]
        .filter((id) => id.startsWith('marker-3d-'))
        .map((id) => id.replace('marker-3d-', ''))
        .sort();
}

// ===== Dublês de módulo =====
const { storeMock, busMock } = vi.hoisted(() => ({
    storeMock: { getMarkers: vi.fn(async () => []) },
    busMock: (() => {
        const registry = new Map();
        return {
            on: vi.fn((evt, handler) => {
                if (!registry.has(evt)) registry.set(evt, new Set());
                registry.get(evt).add(handler);
                return () => registry.get(evt).delete(handler);
            }),
            off: vi.fn(),
            emit: vi.fn((evt, payload) => {
                for (const handler of registry.get(evt) ?? []) handler(payload);
            }),
            _registry: registry,
        };
    })(),
}));

vi.mock('@store/index.js', () => ({
    addMarker: vi.fn(),
    getMarkers: (...args) => storeMock.getMarkers(...args),
    updateMarker: vi.fn(),
    removeMarker: vi.fn(),
    DEFAULT_MARKER_STYLE: {
        showMarker: true, markerColor: '#3f4fb5', markerSize: 32, markerOpacity: 1,
        showLabel: false, labelText: '', labelSize: 14, labelColor: '#ffffff',
        labelOutlineColor: '#000000', labelOutlineWidth: 2,
        labelBackgroundColor: '#000000', labelBackgroundOpacity: 0.6,
    },
    isMapTemporalEnabledSync: () => false,
    getControl: () => null,
}));

vi.mock('@store/services.js', () => ({ getEventBus: () => busMock }));

vi.mock('@js/presence/presence-store.js', () => ({
    presenceStore: { getSelections: () => [], getCursors: () => [] },
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: { clientId: 'self', userId: 'u-self' },
}));

const { EventTypes } = await import('@events/event_types.js');
const {
    initMarkerToolListeners,
    renderMarkersForTileset,
    syncMarkersFromStore,
    getSelectedMarkerId,
    cleanupMarkerTool,
} = await import('../../src/js/3d_models_viewer_tool/tools/marker_tool_3d.js');

/** Seleciona um marcador pelo caminho real: o clique que o handler passivo do módulo registrou. */
function clicarNoMarcador(viewer, markerId) {
    const entity = viewer.entities.getById(`marker-3d-${markerId}`);
    viewer.scene.pick = () => ({ id: entity });
    ultimoHandler.acoes.get('left_click')({ position: { x: 1, y: 1 } });
}

function marcador(id, nome = id) {
    return {
        id,
        tilesetId: 'modelo-1',
        position: { longitude: -43.2, latitude: -22.9, height: 10 },
        properties: { nome },
        style: {},
    };
}

let viewer;

beforeEach(() => {
    vi.clearAllMocks();
    busMock._registry.clear();
    instalarCesium();
    viewer = criarViewer();
    cleanupMarkerTool();
});

describe('cena 3D — marcador que chega do colega', () => {
    it('pinta o marcador criado pelo par SEM fechar e reabrir o visualizador', async () => {
        storeMock.getMarkers.mockResolvedValue([marcador('m1')]);
        await renderMarkersForTileset(viewer, 'modelo-1');
        expect(marcadoresNaCena(viewer)).toEqual(['m1']);

        // A op do colega ja foi gravada no store pelo handler remoto; o que chega aqui e o aviso.
        storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2')]);
        await syncMarkersFromStore();

        expect(marcadoresNaCena(viewer)).toEqual(['m1', 'm2']);
    });

    it('tira da cena o marcador que o par apagou', async () => {
        storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2')]);
        await renderMarkersForTileset(viewer, 'modelo-1');

        storeMock.getMarkers.mockResolvedValue([marcador('m1')]);
        await syncMarkersFromStore();

        expect(marcadoresNaCena(viewer)).toEqual(['m1']);
    });

    it('PRESERVA a selecao local quando o par mexe em outro marcador', async () => {
        // A regressao que este caso existe para impedir: reusar `refreshMarkersForCurrentTileset`
        // aqui limparia a cena inteira e desselecionaria, tirando o painel do usuario da frente
        // dele por causa de um marcador do outro lado da cena.
        storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2')]);
        await renderMarkersForTileset(viewer, 'modelo-1');
        clicarNoMarcador(viewer, 'm1');
        expect(getSelectedMarkerId()).toBe('m1');

        storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2'), marcador('m3')]);
        await syncMarkersFromStore();

        expect(getSelectedMarkerId()).toBe('m1');
        expect(marcadoresNaCena(viewer)).toEqual(['m1', 'm2', 'm3']);
    });

    it('desseleciona quando foi o marcador SELECIONADO que o par apagou', async () => {
        storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2')]);
        await renderMarkersForTileset(viewer, 'modelo-1');
        clicarNoMarcador(viewer, 'm2');

        storeMock.getMarkers.mockResolvedValue([marcador('m1')]);
        await syncMarkersFromStore();

        expect(getSelectedMarkerId()).toBeNull();
        expect(busMock.emit).toHaveBeenCalledWith(EventTypes.MARKER_3D_DESELECTED, { tilesetId: 'modelo-1' });
    });

    it('refaz a entidade quando o par EDITA o marcador (rotulo novo na tela)', async () => {
        storeMock.getMarkers.mockResolvedValue([marcador('m1', 'Antigo')]);
        await renderMarkersForTileset(viewer, 'modelo-1');
        const antes = viewer.entities.getById('marker-3d-m1');

        const editado = marcador('m1', 'Novo');
        editado.style = { showLabel: true, labelText: 'Novo' };
        storeMock.getMarkers.mockResolvedValue([editado]);
        await syncMarkersFromStore();

        const depois = viewer.entities.getById('marker-3d-m1');
        expect(depois).not.toBe(antes);
        expect(depois.label?.text).toBe('Novo');
    });

    it('o evento MARKERS_3D_CHANGED e que dispara a repintura, e uma rajada custa UMA leitura', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getMarkers.mockResolvedValue([marcador('m1')]);
            await renderMarkersForTileset(viewer, 'modelo-1');
            initMarkerToolListeners();

            storeMock.getMarkers.mockClear();
            storeMock.getMarkers.mockResolvedValue([marcador('m1'), marcador('m2'), marcador('m3')]);

            // Tres ops do mesmo lote de sync.
            busMock.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: 'Mapa' });
            busMock.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: 'Mapa' });
            busMock.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: 'Mapa' });
            expect(storeMock.getMarkers).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(80);
            await vi.waitFor(() => expect(marcadoresNaCena(viewer)).toEqual(['m1', 'm2', 'm3']));
            expect(storeMock.getMarkers).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
