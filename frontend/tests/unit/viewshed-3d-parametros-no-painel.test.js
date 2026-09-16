// Path: tests/unit/viewshed-3d-parametros-no-painel.test.js
//
// CAMPO HORIZONTAL E DISTANCIA DA ANALISE DE VISIBILIDADE 3D, do clique ate a copia que o
// painel reabre.
//
// O painel e reconstruido a partir da COPIA que a entidade de origem carrega em
// `properties.viewshedData`, capturada na criacao. Quem trocava a distancia ou o campo
// horizontal recriava o cone e gravava no store, e deixava essa copia velha: clicar fora e
// voltar no marcador trazia o valor antigo de volta, e a tela se contradizia com o disco sem
// um erro em lugar nenhum. E a familia da "copia congelada na view que diverge do store".
//
// PORTADO da `main` (commit 6e15b592) com o contrato do DESTINO, e a diferenca nao e so de
// caminho: aqui o viewshed e CODIGO DA CASA (`services/viewshed-3d.js`, decisao D15), e nao o
// `Cesium.ViewShed3D` do vendor ofuscado, entao o duble e do modulo, nao do global. O eixo do
// setor repartido tambem nao se porta: o destino ja o resolveu por
// `services/viewshed-geometry.js`, com `SEAM_NARROWING_DEGREES` em zero desde 2026-09-16, e
// `tests/unit/viewshed-3d-geometria.test.js` o prende.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== Store dublado =====
// O store real le de um `deepClone` do cache em memoria, entao cada leitura devolve um objeto
// NOVO. O duble faz o mesmo: sem isso a entidade de origem ficaria apontando para o proprio
// registro do store, a copia se atualizaria sozinha por referencia, e o teste nunca veria a
// copia velha que o painel reabre. Dubl6e mais gentil que o real aprova o codigo defeituoso.
const { store } = vi.hoisted(() => ({ store: { viewsheds: new Map() } }));

vi.mock('@store/index.js', () => ({
    addViewshed: vi.fn(),
    getViewsheds: vi.fn(async (tilesetId) =>
        [...store.viewsheds.values()]
            .filter(v => v.tilesetId === tilesetId)
            .map(v => JSON.parse(JSON.stringify(v)))),
    updateViewshed: vi.fn(async (id, updates) => {
        const v = store.viewsheds.get(id);
        if (!v) return null;
        if (updates.parameters) v.parameters = { ...(v.parameters || {}), ...updates.parameters };
        if (updates.observerHeight !== undefined) v.observerHeight = updates.observerHeight;
        if (updates.properties) v.properties = { ...v.properties, ...updates.properties };
        return JSON.parse(JSON.stringify(v));
    }),
    removeViewshed: vi.fn(),
    getViewshedById: vi.fn(async (id) => {
        const v = store.viewsheds.get(id);
        return v ? JSON.parse(JSON.stringify(v)) : null;
    })
}));

vi.mock('@store/services.js', () => ({ getEventBus: () => null }));

// ===== O viewshed da casa, dublado =====
// Ele guarda o que recebeu e registra a instancia, que e tudo o que este arquivo precisa: o
// que esta sob teste e o ENCANAMENTO do dado, e a geometria tem regua propria.
const { criados } = vi.hoisted(() => ({ criados: { lista: [] } }));

vi.mock('@js/3d_models_viewer_tool/services/viewshed-3d.js', () => ({
    Viewshed3D: class {
        constructor(viewer, options = {}) {
            Object.assign(this, options);
            this.destroyed = false;
            criados.lista.push(this);
        }
        destroy() { this.destroyed = true; }
    }
}));

// ===== Cesium dublado =====
// A aritmetica e crua de proposito: o ENU vira identidade, entao a rotacao dos sub-viewsheds
// roda sem quebrar.

class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
}

function v3(x = 0, y = 0, z = 0) { return new Cartesian3(x, y, z); }

const IDENTITY = { identity: true };

const CesiumStub = {
    Cartesian3: Object.assign(Cartesian3, {
        fromDegrees: (lon, lat, h = 0) => v3(lon, lat, h),
        clone: (c) => v3(c.x, c.y, c.z),
        subtract: (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z),
        add: (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z),
        normalize: (c, out) => {
            const m = Math.hypot(c.x, c.y, c.z) || 1;
            const r = v3(c.x / m, c.y / m, c.z / m);
            if (out) Object.assign(out, r);
            return r;
        },
        multiplyByScalar: (c, s) => v3(c.x * s, c.y * s, c.z * s)
    }),
    Transforms: { eastNorthUpToFixedFrame: () => IDENTITY },
    Matrix4: Object.assign(class Matrix4 {}, {
        inverse: () => IDENTITY,
        getMatrix3: () => IDENTITY,
        multiplyByPointAsVector: (_m, c) => v3(c.x, c.y, c.z)
    }),
    Matrix3: Object.assign(class Matrix3 {}, {
        multiplyByVector: (_m, c) => v3(c.x, c.y, c.z)
    }),
    Math: { toRadians: (d) => (d * Math.PI) / 180 },
    Color: {
        CYAN: { withAlpha: () => ({}) },
        ORANGE: { withAlpha: () => ({}) }
    },
    ConstantProperty: class { constructor(value) { this.value = value; } },
    VerticalOrigin: { CENTER: 'center' },
    HorizontalOrigin: { CENTER: 'center' },
    HeightReference: { NONE: 'none' },
    LabelStyle: { FILL_AND_OUTLINE: 'fillAndOutline' },
    ScreenSpaceEventHandler: class {
        setInputAction() {}
        removeInputAction() {}
        destroy() {}
    },
    ScreenSpaceEventType: { LEFT_CLICK: 'leftClick', MOUSE_MOVE: 'mouseMove' },
    BoundingSphere: class {},
    HeadingPitchRange: class {},
    Cartographic: { fromCartesian: (c) => ({ longitude: c.x, latitude: c.y, height: c.z }) },
    defined: (x) => x !== undefined && x !== null
};

/** Viewer minimo: so a colecao de entidades e o canvas. */
function makeViewer() {
    const byId = new Map();
    return {
        canvas: { style: {} },
        scene: { pick: () => undefined, requestRender: () => {} },
        camera: { flyToBoundingSphere: () => {} },
        entities: {
            getById: (id) => byId.get(id),
            add: (def) => { byId.set(def.id, def); return def; },
            remove: (e) => byId.delete(e.id),
            removeById: (id) => byId.delete(id)
        }
    };
}

const TILESET_ID = 'tileset-1';
const VIEWSHED_ID = 'vs-1';

function semearViewshed(parameters) {
    store.viewsheds.clear();
    store.viewsheds.set(VIEWSHED_ID, {
        id: VIEWSHED_ID,
        tilesetId: TILESET_ID,
        position: { longitude: -43.2, latitude: -22.9, height: 30 },
        targetPosition: { longitude: -43.19, latitude: -22.9, height: 30 },
        terrainBaseHeight: 30,
        direction: { heading: 90, pitch: 0 },
        parameters: { ...parameters },
        observerHeight: 1.5,
        properties: { nome: 'Cota 300', descricao: '' }
    });
}

/** A copia que o painel le quando o marcador e clicado de novo. */
function copiaDoPainel(viewer) {
    const entidade = viewer.entities.getById(`viewshed-3d-origin-${VIEWSHED_ID}`);
    const bruto = entidade?.properties?.viewshedData;
    return bruto && typeof bruto.getValue === 'function' ? bruto.getValue() : bruto;
}

let tool;

beforeEach(async () => {
    globalThis.Cesium = CesiumStub;
    globalThis.window = globalThis.window || {};
    globalThis.window.Cesium = CesiumStub;
    criados.lista = [];
    vi.resetModules();
    tool = await import('@js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
});

describe('distancia e campo horizontal da visibilidade 3D', () => {
    it('a distancia nova chega ao cone recriado e a copia que o painel reabre', async () => {
        semearViewshed({ horizontalAngle: 120, verticalAngle: 120, distance: 500 });
        const viewer = makeViewer();
        await tool.renderViewshedsForTileset(viewer, TILESET_ID);

        criados.lista = [];
        await tool.updateViewshedDistance(VIEWSHED_ID, 2000);

        expect(criados.lista.map(v => v.distance)).toEqual([2000]);
        expect(copiaDoPainel(viewer).parameters.distance).toBe(2000);
    });

    it('o campo horizontal novo chega ao cone recriado e a copia que o painel reabre', async () => {
        semearViewshed({ horizontalAngle: 120, verticalAngle: 120, distance: 500 });
        const viewer = makeViewer();
        await tool.renderViewshedsForTileset(viewer, TILESET_ID);

        criados.lista = [];
        await tool.updateViewshedHorizontalAngle(VIEWSHED_ID, 60);

        expect(criados.lista.map(v => v.horizontalAngle)).toEqual([60]);
        expect(copiaDoPainel(viewer).parameters.horizontalAngle).toBe(60);
    });

    it('acima de 150 graus o setor e repartido, e a copia do painel guarda o TOTAL pedido', async () => {
        semearViewshed({ horizontalAngle: 120, verticalAngle: 120, distance: 500 });
        const viewer = makeViewer();
        await tool.renderViewshedsForTileset(viewer, TILESET_ID);

        criados.lista = [];
        await tool.updateViewshedHorizontalAngle(VIEWSHED_ID, 300);

        // Dois pedacos na cena, e o painel guardando 300: o que o usuario pediu, nunca o
        // angulo de cada pedaco.
        expect(criados.lista).toHaveLength(2);
        expect(copiaDoPainel(viewer).parameters.horizontalAngle).toBe(300);
    });

    it('trocar a distancia nao derruba o observador para o solo', async () => {
        semearViewshed({ horizontalAngle: 120, verticalAngle: 120, distance: 500 });
        const viewer = makeViewer();
        await tool.renderViewshedsForTileset(viewer, TILESET_ID);

        criados.lista = [];
        await tool.updateViewshedDistance(VIEWSHED_ID, 2000);

        // terrainBaseHeight (30) + observerHeight (1,5)
        expect(criados.lista[0].cameraPosition.z).toBeCloseTo(31.5, 6);
    });

    it('a altura do observador tambem atualiza a copia que o painel reabre', async () => {
        semearViewshed({ horizontalAngle: 120, verticalAngle: 120, distance: 500 });
        const viewer = makeViewer();
        await tool.renderViewshedsForTileset(viewer, TILESET_ID);

        await tool.updateViewshedObserverHeight(VIEWSHED_ID, 12);

        expect(copiaDoPainel(viewer).observerHeight).toBe(12);
    });
});
