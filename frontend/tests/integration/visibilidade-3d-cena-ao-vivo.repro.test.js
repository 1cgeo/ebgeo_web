// Path: tests/integration/visibilidade-3d-cena-ao-vivo.repro.test.js
//
// A ANÁLISE DE VISIBILIDADE 3D DO COLEGA NA CENA, AO VIVO (2026-09-22), a terceira família do item 6
// ("não tá propagando no 3D as feições"), irmã de `medicao-3d-cena-ao-vivo.repro.test.js`.
//
// A CAUSA RAIZ. A op `viewshed3d` chega ao par e o tratador remoto grava o documento lateral e emite
// `VIEWSHEDS_3D_CHANGED`, mas dentro do visualizador `viewshed_tool_3d.js` só escutava
// `LAYERS_CHANGED` e `VIEWER_3D_CLOSED`: a visibilidade do colega só aparecia depois de FECHAR E
// REABRIR o 3D, e a que ele apagou continuava desenhada.
//
// O QUE ESTA FAMÍLIA TEM A MAIS: o GESTO interativo de dois cliques, com prévia, que mora numa
// instância do motor (`pendingViewshed`) fora do conjunto persistido. A reconciliação não pode
// tocá-lo, e não pode aplicar uma leitura do store que começou antes de o gesto terminar, senão ela
// tira da cena (e desseleciona) a visibilidade que a pessoa acabou de pôr.
//
// CONTROLE NEGATIVO: sem a inscrição em `initViewshedToolListeners`, o primeiro caso fica vermelho;
// sem a guarda de época (`localSceneEpoch`), o caso do gesto que termina durante a leitura fica.
//
// O motor (`services/viewshed-3d.js`) é dublado: o que se afere é QUAIS instâncias existem e quais
// foram destruídas, não o desenho. O desenho final tem referência versionada própria em
// `e2e-ui/viewshed-3d-pixel.spec.js`, e este arquivo não passa perto dele.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ===== Dublê do Cesium =====
let ultimoHandler = null;

class FakeEntity {
    constructor(options) {
        Object.assign(this, options);
    }
}

class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static fromDegrees(lon, lat, h = 0) { return new Cartesian3(lon, lat, h); }
    static clone(a, out = new Cartesian3()) { return Object.assign(out, { x: a.x, y: a.y, z: a.z }); }
    static add(a, b, out = new Cartesian3()) { return Object.assign(out, { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }); }
    static subtract(a, b, out = new Cartesian3()) { return Object.assign(out, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); }
    static multiplyByScalar(a, s, out = new Cartesian3()) { return Object.assign(out, { x: a.x * s, y: a.y * s, z: a.z * s }); }
    static normalize(a, out = new Cartesian3()) {
        const m = Math.hypot(a.x, a.y, a.z) || 1;
        return Object.assign(out, { x: a.x / m, y: a.y / m, z: a.z / m });
    }
}

function instalarCesium() {
    class Color {
        constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
        withAlpha(a) { return new Color(this.r, this.g, this.b, a); }
    }
    Color.WHITE = new Color(1, 1, 1, 1);
    Color.ORANGE = new Color(1, 0.55, 0, 1);
    Color.CYAN = new Color(0, 1, 1, 1);

    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.Cesium = {
        Color,
        Cartesian3,
        Cartographic: { fromCartesian: (c) => ({ longitude: c.x, latitude: c.y, height: c.z }) },
        Math: { toDegrees: (v) => v, toRadians: (v) => v },
        ConstantProperty: class { constructor(value) { this.value = value; } },
        VerticalOrigin: { CENTER: 'center' },
        ScreenSpaceEventType: { LEFT_CLICK: 'left_click' },
        defined: (v) => v !== undefined && v !== null,
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

/** Ids de visibilidade com marcador de origem vivo na cena. */
function visibilidadesNaCena(viewer) {
    return [...viewer._entidades.keys()]
        .filter((id) => id.startsWith('viewshed-3d-origin-'))
        .map((id) => id.replace('viewshed-3d-origin-', ''))
        .sort();
}

// ===== Dublês de módulo =====
const { storeMock, busMock, motor } = vi.hoisted(() => ({
    storeMock: {
        getViewsheds: vi.fn(async () => []),
        addViewshed: vi.fn(async () => null),
        removeViewshed: vi.fn(async () => true),
        getViewshedById: vi.fn(async () => null),
    },
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
    // Cada instância do motor que a ferramenta criou, na ordem: as de análise e a do gesto.
    motor: { instancias: [] },
}));

vi.mock('@store/index.js', () => ({
    addViewshed: (...args) => storeMock.addViewshed(...args),
    getViewsheds: (...args) => storeMock.getViewsheds(...args),
    updateViewshed: vi.fn(),
    removeViewshed: (...args) => storeMock.removeViewshed(...args),
    getViewshedById: (...args) => storeMock.getViewshedById(...args),
}));

vi.mock('@store/services.js', () => ({ getEventBus: () => busMock }));

vi.mock('../../src/js/3d_models_viewer_tool/services/viewshed-3d.js', () => ({
    Viewshed3D: class {
        constructor(viewer, options) {
            this.options = options;
            this.destroyed = false;
            motor.instancias.push(this);
        }
        destroy() { this.destroyed = true; }
    },
}));

vi.mock('../../src/js/3d_models_viewer_tool/map_3d.js', () => ({ deactivateActiveTool3D: vi.fn() }));

const { EventTypes } = await import('@events/event_types.js');
const {
    activateViewshedTool,
    initViewshedToolListeners,
    renderViewshedsForTileset,
    syncViewshedsFromStore,
    getSelectedViewshedId,
    cleanupViewshedTool,
} = await import('../../src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');

/** Seleciona uma visibilidade pelo caminho real: o clique que o handler passivo registrou. */
function clicarNaVisibilidade(viewer, viewshedId) {
    const entity = viewer.entities.getById(`viewshed-3d-origin-${viewshedId}`);
    viewer.scene.pick = () => ({ id: entity });
    ultimoHandler.acoes.get('left_click')({ position: { x: 1, y: 1 } });
}

function visibilidade(id, { distancia = 300 } = {}) {
    return {
        id,
        tilesetId: 'modelo-1',
        position: { longitude: -43.2, latitude: -22.9, height: 10 },
        targetPosition: { longitude: -43.19, latitude: -22.9, height: 10 },
        terrainBaseHeight: 10,
        direction: { heading: 90, pitch: 0 },
        parameters: { horizontalAngle: 120, verticalAngle: 90, distance: distancia },
        observerHeight: 1.5,
        properties: { nome: id, descricao: '' },
        images: [],
        sync: { deleted: false },
    };
}

/** As instâncias de ANÁLISE vivas (a do gesto tem `calback`; as de análise, não). */
const conesVivos = () => motor.instancias.filter((i) => !i.destroyed && !i.options.calback);

let viewer;

beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` não desfaz implementação: o caso do gesto deixa estas duas apontando para a
    // visibilidade dele, e um clique num caso seguinte leria aquela em vez da própria.
    storeMock.addViewshed.mockResolvedValue(null);
    storeMock.getViewshedById.mockResolvedValue(null);
    busMock._registry.clear();
    instalarCesium();
    viewer = criarViewer();
    cleanupViewshedTool();
    motor.instancias.length = 0;
});

describe('cena 3D — análise de visibilidade que chega do colega', () => {
    it('o evento VIEWSHEDS_3D_CHANGED pinta a visibilidade criada pelo par SEM fechar e reabrir o 3D', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
            await renderViewshedsForTileset(viewer, 'modelo-1');
            initViewshedToolListeners();
            expect(visibilidadesNaCena(viewer)).toEqual(['v1']);

            storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
            busMock.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: 'uuid-do-mapa' });

            await vi.advanceTimersByTimeAsync(80);
            await vi.waitFor(() => expect(visibilidadesNaCena(viewer)).toEqual(['v1', 'v2']));
            expect(conesVivos()).toHaveLength(2);
            expect(storeMock.getViewsheds).toHaveBeenLastCalledWith('modelo-1');
        } finally {
            vi.useRealTimers();
        }
    });

    it('tira da cena, e DESTRÓI o cone, da visibilidade que o par apagou', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        const [, coneDoV2] = motor.instancias;

        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await syncViewshedsFromStore();

        expect(visibilidadesNaCena(viewer)).toEqual(['v1']);
        // Um cone que ninguém destrói continua pintando a tela até o F5.
        expect(coneDoV2.destroyed).toBe(true);
        expect(conesVivos()).toHaveLength(1);
    });

    it('refaz SÓ a visibilidade que o par editou: a outra mantém o cone e a origem', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        const [coneDoV1, coneDoV2] = motor.instancias;
        const origemDoV2 = viewer.entities.getById('viewshed-3d-origin-v2');

        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1', { distancia: 800 }), visibilidade('v2')]);
        await syncViewshedsFromStore();

        expect(coneDoV1.destroyed).toBe(true);
        expect(coneDoV2.destroyed).toBe(false);
        expect(viewer.entities.getById('viewshed-3d-origin-v2')).toBe(origemDoV2);
        // O refeito usa o dado NOVO, pelo mesmo caminho da primeira pintura.
        const refeito = conesVivos().find((c) => c !== coneDoV2);
        expect(refeito.options.distance).toBe(800);
    });

    it('PRESERVA a seleção local quando o par mexe em outra visibilidade', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        clicarNaVisibilidade(viewer, 'v1');
        expect(getSelectedViewshedId()).toBe('v1');
        busMock.emit.mockClear();

        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
        await syncViewshedsFromStore();

        expect(getSelectedViewshedId()).toBe('v1');
        expect(busMock.emit).not.toHaveBeenCalledWith(EventTypes.VIEWSHED_3D_DESELECTED, expect.anything());
    });

    it('desseleciona quando foi a visibilidade SELECIONADA que o par apagou', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        clicarNaVisibilidade(viewer, 'v2');

        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await syncViewshedsFromStore();

        expect(getSelectedViewshedId()).toBeNull();
        expect(busMock.emit).toHaveBeenCalledWith(EventTypes.VIEWSHED_3D_DESELECTED, { tilesetId: 'modelo-1' });
    });

    it('não toca no GESTO em andamento nem na prévia dele', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        activateViewshedTool(viewer, 'modelo-1');
        const gesto = motor.instancias.find((i) => i.options.calback);
        expect(gesto).toBeTruthy();

        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2')]);
        await syncViewshedsFromStore();

        expect(gesto.destroyed).toBe(false);
        expect(viewer.canvas.style.cursor).toBe('crosshair');
        expect(visibilidadesNaCena(viewer)).toEqual(['v1', 'v2']);
    });

    it('o gesto que TERMINA durante a leitura do store não é desfeito pela leitura velha', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');
        activateViewshedTool(viewer, 'modelo-1');
        const gesto = motor.instancias.find((i) => i.options.calback);

        // A reconciliação disparada por um colega começa a ler o store.
        let liberar;
        storeMock.getViewsheds.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve; }));
        const emVoo = syncViewshedsFromStore();

        // E a pessoa dá o segundo clique: o motor chama o `calback` com as duas posições.
        const novo = visibilidade('nova');
        storeMock.addViewshed.mockResolvedValue(novo);
        storeMock.getViewshedById.mockResolvedValue(novo);
        Object.assign(gesto, {
            cameraPosition: new Cartesian3(-43.2, -22.9, 10),
            viewPosition: new Cartesian3(-43.19, -22.9, 10),
            horizontalAngle: 120, verticalAngle: 90, distance: 300,
        });
        gesto.options.calback();
        await vi.waitFor(() => expect(visibilidadesNaCena(viewer)).toContain('nova'));
        expect(getSelectedViewshedId()).toBe('nova');
        busMock.emit.mockClear();

        // A leitura que começou ANTES do gesto volta sem a visibilidade nova.
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), novo]);
        liberar([visibilidade('v1')]);
        await emVoo;

        expect(visibilidadesNaCena(viewer)).toEqual(['nova', 'v1']);
        expect(getSelectedViewshedId()).toBe('nova');
        expect(busMock.emit).not.toHaveBeenCalledWith(EventTypes.VIEWSHED_3D_DESELECTED, expect.anything());
        expect(gesto.destroyed).toBe(true);
    });

    it('uma rajada de eventos custa UMA leitura do store', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
            await renderViewshedsForTileset(viewer, 'modelo-1');
            initViewshedToolListeners();

            storeMock.getViewsheds.mockClear();
            storeMock.getViewsheds.mockResolvedValue([visibilidade('v1'), visibilidade('v2'), visibilidade('v3')]);
            busMock.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: 'M' });
            busMock.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: 'M' });
            busMock.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: 'M' });
            expect(storeMock.getViewsheds).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(80);
            await vi.waitFor(() => expect(visibilidadesNaCena(viewer)).toEqual(['v1', 'v2', 'v3']));
            expect(storeMock.getViewsheds).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a leitura que volta DEPOIS de uma troca de modelo não pinta o modelo antigo por cima do novo', async () => {
        storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
        await renderViewshedsForTileset(viewer, 'modelo-1');

        let liberar;
        storeMock.getViewsheds.mockImplementationOnce(() => new Promise((resolve) => { liberar = resolve; }));
        const emVoo = syncViewshedsFromStore();

        storeMock.getViewsheds.mockResolvedValue([]);
        await renderViewshedsForTileset(viewer, 'modelo-2');
        liberar([visibilidade('v1'), visibilidade('velha')]);
        await emVoo;

        expect(visibilidadesNaCena(viewer)).toEqual([]);
        expect(conesVivos()).toHaveLength(0);
    });

    it('o destroy do visualizador solta o ouvinte e o temporizador pendente', async () => {
        vi.useFakeTimers();
        try {
            storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
            await renderViewshedsForTileset(viewer, 'modelo-1');
            initViewshedToolListeners();
            expect(busMock.ouvintes(EventTypes.VIEWSHEDS_3D_CHANGED)).toBe(1);

            busMock.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: 'M' });
            storeMock.getViewsheds.mockClear();
            cleanupViewshedTool();

            await vi.advanceTimersByTimeAsync(200);
            expect(storeMock.getViewsheds).not.toHaveBeenCalled();
            expect(busMock.ouvintes(EventTypes.VIEWSHEDS_3D_CHANGED)).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
