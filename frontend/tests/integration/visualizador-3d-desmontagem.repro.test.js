// Path: tests/integration/visualizador-3d-desmontagem.repro.test.js
//
// A DESMONTAGEM DO VISUALIZADOR 3D LANÇAVA DE DENTRO DO PRÓPRIO CESIUM (tabela de defeitos, release
// 1.0.0+e91fb15a de 2026-09-21, origem `rejeicao`, página `mapa`): "DeveloperError: This object was
// destroyed, i.e., destroy() was called.", com a pilha `throwOnDestroyed` <- `_onDataSourceRemoved`
// <- `DataSourceDisplay.destroy` <- `CesiumWidget.destroy` <- `Viewer.destroy` <- o invólucro
// assíncrono de `cleanup3DFeatures`, chamado no `beforeunload`.
//
// A CAUSA RAIZ. `cleanup3DFeatures` esvaziava `scene.primitives` e `scene.groundPrimitives` com
// `removeAll()` logo antes de `viewer.destroy()`. Dentro daquelas coleções moram as coleções do
// `DataSourceDisplay` do viewer (uma por fonte, a fonte padrão inclusive), e `removeAll()` DESTRÓI
// cada membro: o display perdia as dele por fora, e o `destroy` do viewer chamava `remove` numa
// coleção que o `destroyObject` já tinha trocado por um lançador. O display entra na cena na primeira
// fonte ou entidade, e a `CesiumMeasure` põe uma fonte no construtor, então toda sessão que abria o 3D
// pagava isso ao fechar a página. Até 2026-09-14 o mesmo código era mudo: o vendor era o bundle de
// release, onde o corpo de `throwOnDestroyed` sai pelo pragma `debug`; o pacote do npm é importado de
// `Source/`, onde o pragma fica.
//
// O CONSERTO É A REGRA DE UM DONO POR OBJETO (`services/viewer-teardown.js`): cada ferramenta solta o
// que pôs enquanto o viewer vive, e o viewer solta o resto no próprio `destroy`. E o trabalho
// assíncrono das ferramentas (o debounce do sync ao vivo, a leitura do store em voo, a pintura da
// abertura, a gravação do gesto) confere, na volta, se o viewer ainda é o dela.
//
// O DUBLÊ LANÇA COMO O CESIUM. `destroyObject` troca todo método por um lançador de
// `DeveloperError`, e os acessores do `Viewer` leem um widget que o `destroy` zerou, então qualquer
// toque num viewer destruído lança aqui como lançaria no navegador. `_onDataSourceRemoved`,
// `DataSourceDisplay.destroy` e `CesiumWidget.destroy` estão transcritos na ordem do 1.145.0, e o
// primeiro caso mostra o dublê reproduzindo a pilha do relatório com a sequência antiga: é o controle
// do instrumento, sem o qual um verde aqui não provaria nada.
//
// CONTROLES NEGATIVOS: devolver os `removeAll()` a `cleanup3DFeatures` reprova o censo do fim do
// arquivo; tirar a guarda pós-leitura de `render*ForTileset` reprova "a pintura de ABERTURA em voo";
// tirar a de `syncMarkersFromStore` reprova "a reconciliação de marcadores que começou no viewer
// antigo"; e voltar `handleViewshedComplete` a zerar `pendingViewshed` sem conferir de quem ele é
// reprova "o gesto de visibilidade que termina depois da desmontagem".
//
// O motor da visibilidade (`services/viewshed-3d.js`) é dublado como na suíte irmã
// (`visibilidade-3d-cena-ao-vivo.repro.test.js`), mas aqui com o CICLO DE VIDA do real: o setor entra
// em `scene.primitives` com o contorno, e o gesto pendente segura um handler no canvas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ===== Dublê do Cesium, com a semântica de destruição do original =====

const MENSAGEM_DESTRUIDO = 'This object was destroyed, i.e., destroy() was called.';

class DeveloperError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DeveloperError';
    }
}

/**
 * O `destroyObject` do Cesium: todo método vira um lançador e `isDestroyed` passa a responder true.
 * O original varre com `for...in`, que alcança os métodos de protótipo porque o Cesium os define por
 * atribuição; numa classe ES eles não são enumeráveis, daí a caminhada explícita. Acessores ficam de
 * fora, como lá.
 * @param {object} objeto
 */
function destroyObject(objeto) {
    function throwOnDestroyed() {
        throw new DeveloperError(MENSAGEM_DESTRUIDO);
    }
    for (let proto = objeto; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
        for (const chave of Object.getOwnPropertyNames(proto)) {
            if (chave === 'constructor') continue;
            const descritor = Object.getOwnPropertyDescriptor(proto, chave);
            if (typeof descritor?.value === 'function') objeto[chave] = throwOnDestroyed;
        }
    }
    objeto.isDestroyed = () => true;
}

/** Todo ScreenSpaceEventHandler ainda não destruído: o que sobrar aqui é handler órfão. */
const handlersVivos = new Set();

class ScreenSpaceEventHandler {
    constructor(canvas) {
        this.canvas = canvas;
        this.acoes = new Map();
        handlersVivos.add(this);
    }
    setInputAction(fn, tipo) { this.acoes.set(tipo, fn); }
    removeInputAction(tipo) { this.acoes.delete(tipo); }
    isDestroyed() { return false; }
    destroy() {
        handlersVivos.delete(this);
        destroyObject(this);
    }
}

class PrimitiveCollection {
    constructor(opcoes = {}) {
        this._primitives = [];
        this.destroyPrimitives = opcoes.destroyPrimitives ?? true;
        this.show = true;
    }
    get length() { return this._primitives.length; }
    add(primitiva) {
        primitiva._composites ??= new Set();
        primitiva._composites.add(this);
        this._primitives.push(primitiva);
        return primitiva;
    }
    contains(primitiva) {
        return !!primitiva?._composites?.has(this);
    }
    remove(primitiva) {
        if (!this.contains(primitiva)) return false;
        this._primitives.splice(this._primitives.indexOf(primitiva), 1);
        primitiva._composites.delete(this);
        if (this.destroyPrimitives) primitiva.destroy();
        return true;
    }
    // Como o original: DESTRÓI cada membro, e é esse o ponto do defeito.
    removeAll() {
        const primitivas = this._primitives;
        const total = primitivas.length;
        for (let i = 0; i < total; ++i) {
            const primitiva = primitivas[i];
            primitiva._composites.delete(this);
            if (this.destroyPrimitives) primitiva.destroy();
        }
        this._primitives = [];
    }
    isDestroyed() { return false; }
    destroy() {
        this.removeAll();
        destroyObject(this);
    }
}

class EntityCluster {
    isDestroyed() { return false; }
    destroy() { destroyObject(this); }
}

class Visualizer {
    isDestroyed() { return false; }
    destroy() { destroyObject(this); }
}

class Entity {
    constructor(opcoes) {
        Object.assign(this, opcoes);
    }
}

class EntityCollection {
    constructor() {
        this._porId = new Map();
        this._ouvintes = new Set();
    }
    get values() { return [...this._porId.values()]; }
    onChange(fn) {
        this._ouvintes.add(fn);
        return () => this._ouvintes.delete(fn);
    }
    _avisar() {
        for (const fn of [...this._ouvintes]) fn();
    }
    add(opcoes) {
        const id = opcoes.id ?? `entidade-${this._porId.size + 1}`;
        // Como o Cesium: id repetido é erro, não substituição.
        if (this._porId.has(id)) throw new Error(`An entity with id ${id} already exists in this collection.`);
        const entidade = new Entity({ ...opcoes, id });
        this._porId.set(id, entidade);
        this._avisar();
        return entidade;
    }
    contains(entidade) { return this._porId.get(entidade?.id) === entidade; }
    getById(id) { return this._porId.get(id); }
    remove(entidade) {
        if (!this.contains(entidade)) return false;
        this._porId.delete(entidade.id);
        this._avisar();
        return true;
    }
    removeAll() {
        this._porId.clear();
        this._avisar();
    }
}

/** Sem `destroy`, como a `CustomDataSource` do Cesium. */
class CustomDataSource {
    constructor(nome) {
        this.name = nome;
        this.entities = new EntityCollection();
        this.clustering = new EntityCluster();
    }
}

class DataSourceCollection {
    constructor() {
        this._fontes = [];
        this._aoAdicionar = new Set();
        this._aoRemover = new Set();
    }
    get length() { return this._fontes.length; }
    get(i) { return this._fontes[i]; }
    onAdded(fn) {
        this._aoAdicionar.add(fn);
        return () => this._aoAdicionar.delete(fn);
    }
    onRemoved(fn) {
        this._aoRemover.add(fn);
        return () => this._aoRemover.delete(fn);
    }
    add(fonte) {
        this._fontes.push(fonte);
        for (const fn of [...this._aoAdicionar]) fn(fonte);
        return Promise.resolve(fonte);
    }
    contains(fonte) { return this._fontes.includes(fonte); }
    remove(fonte, destruir = false) {
        const i = this._fontes.indexOf(fonte);
        if (i === -1) return false;
        this._fontes.splice(i, 1);
        for (const fn of [...this._aoRemover]) fn(fonte);
        if (destruir && typeof fonte.destroy === 'function') fonte.destroy();
        return true;
    }
    removeAll(destruir = false) {
        for (const fonte of this._fontes) {
            for (const fn of [...this._aoRemover]) fn(fonte);
            if (destruir && typeof fonte.destroy === 'function') fonte.destroy();
        }
        this._fontes = [];
    }
    isDestroyed() { return false; }
    destroy() {
        this.removeAll(true);
        destroyObject(this);
    }
}

/** `DataSourceDisplay` do Cesium 1.145.0, nos três métodos que a pilha do relatório atravessa. */
class DataSourceDisplay {
    constructor(cena, fontes) {
        this._scene = cena;
        this._dataSourceCollection = fontes;
        this._primitives = new PrimitiveCollection();
        this._groundPrimitives = new PrimitiveCollection();

        const padrao = new CustomDataSource();
        this._onDataSourceAdded(padrao);
        this._defaultDataSource = padrao;

        this._soltar = [
            fontes.onAdded((fonte) => this._onDataSourceAdded(fonte)),
            fontes.onRemoved((fonte) => this._onDataSourceRemoved(fonte)),
        ];

        // As coleções do display entram na cena só na primeira fonte ou na primeira entidade da fonte
        // padrão, como no original. Sem conteúdo, o `removeAll` antigo não as alcançava.
        this._naCena = false;
        const saidas = [];
        const entrar = () => {
            if (this._naCena) return;
            this._naCena = true;
            cena.primitives.add(this._primitives);
            cena.groundPrimitives.add(this._groundPrimitives);
            saidas.forEach((soltar) => soltar());
        };
        saidas.push(padrao.entities.onChange(entrar), fontes.onAdded(entrar));
        this._soltarEntrada = () => saidas.forEach((soltar) => soltar());
    }

    get defaultDataSource() { return this._defaultDataSource; }

    _onDataSourceAdded(fonte) {
        fonte._primitives = this._primitives.add(new PrimitiveCollection());
        fonte._groundPrimitives = this._groundPrimitives.add(new PrimitiveCollection());
        fonte._primitives.add(fonte.clustering);
        fonte._visualizers = [new Visualizer()];
    }

    _onDataSourceRemoved(fonte) {
        const displayPrimitives = this._primitives;
        const displayGroundPrimitives = this._groundPrimitives;
        const primitives = fonte._primitives;
        const groundPrimitives = fonte._groundPrimitives;

        primitives.remove(fonte.clustering);
        for (const visualizador of fonte._visualizers) visualizador.destroy();
        displayPrimitives.remove(primitives);
        displayGroundPrimitives.remove(groundPrimitives);
        fonte._visualizers = undefined;
    }

    isDestroyed() { return false; }

    destroy() {
        this._soltar.forEach((soltar) => soltar());
        const fontes = this._dataSourceCollection;
        for (let i = 0; i < fontes.length; ++i) this._onDataSourceRemoved(fontes.get(i));
        this._onDataSourceRemoved(this._defaultDataSource);
        if (!this._naCena) {
            this._soltarEntrada();
        } else {
            this._scene.primitives.remove(this._primitives);
            this._scene.groundPrimitives.remove(this._groundPrimitives);
        }
        destroyObject(this);
    }
}

class CanvasFalso {
    constructor() { this.style = {}; }
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() { return { left: 0, top: 0 }; }
}

class Scene {
    constructor(canvas) {
        this.canvas = canvas;
        this.primitives = new PrimitiveCollection();
        this.groundPrimitives = new PrimitiveCollection();
        /** O que `pickPosition` devolve: o ponto do modelo sob o ponteiro. */
        this.pontoSobOPonteiro = null;
    }
    pick() { return undefined; }
    pickPosition() { return this.pontoSobOPonteiro ?? undefined; }
    requestRender() {}
    isDestroyed() { return false; }
    destroy() {
        this.primitives = this.primitives.destroy();
        this.groundPrimitives = this.groundPrimitives.destroy();
        destroyObject(this);
    }
}

class CesiumWidget {
    constructor() {
        this.canvas = new CanvasFalso();
        this.scene = new Scene(this.canvas);
        this.dataSources = new DataSourceCollection();
        this.dataSourceDisplay = new DataSourceDisplay(this.scene, this.dataSources);
        this.entities = this.dataSourceDisplay.defaultDataSource.entities;
        this.camera = { setView() {}, flyTo() {}, flyToBoundingSphere() {} };
    }
    // `destroy` devolve undefined, e é isso que zera os campos: como no original.
    destroy() {
        this.dataSourceDisplay = this.dataSourceDisplay.destroy();
        this.scene = this.scene.destroy();
        this.dataSources = this.dataSources.destroy();
        destroyObject(this);
    }
}

/**
 * Os acessores leem o widget, como no Cesium: depois do `destroy` ele é `undefined`, e toda leitura
 * de `canvas`, `scene`, `entities`, `dataSources` ou `camera` lança um TypeError.
 */
class Viewer {
    constructor() {
        this._cesiumWidget = new CesiumWidget();
        this.selectedEntity = undefined;
    }
    get canvas() { return this._cesiumWidget.canvas; }
    get scene() { return this._cesiumWidget.scene; }
    get entities() { return this._cesiumWidget.entities; }
    get dataSources() { return this._cesiumWidget.dataSources; }
    get camera() { return this._cesiumWidget.camera; }
    isDestroyed() { return false; }
    destroy() {
        this._cesiumWidget = this._cesiumWidget.destroy();
        destroyObject(this);
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
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
}

function instalarCesium() {
    class Color {
        constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); }
        withAlpha(a) { return new Color(this.r, this.g, this.b, a); }
    }
    Color.WHITE = new Color(1, 1, 1, 1);
    Color.BLACK = new Color(0, 0, 0, 1);
    Color.TRANSPARENT = new Color(0, 0, 0, 0);
    Color.ORANGE = new Color(1, 0.6, 0, 1);
    Color.CYAN = new Color(0, 1, 1, 1);
    Color.YELLOW = new Color(1, 1, 0, 1);

    // Os módulos leem `window.Cesium` num ponto e o global `Cesium` noutro; este arquivo roda em
    // ambiente node, sem window.
    if (!globalThis.window) globalThis.window = globalThis;
    globalThis.Cesium = {
        Viewer,
        CustomDataSource,
        PrimitiveCollection,
        ScreenSpaceEventHandler,
        Entity,
        Color,
        Cartesian2: class { constructor(x, y) { Object.assign(this, { x, y }); } },
        Cartesian3,
        Cartographic: { fromCartesian: (c) => ({ longitude: c.x, latitude: c.y, height: c.z }) },
        Math: { toDegrees: (v) => v, toRadians: (v) => v },
        ConstantProperty: class { constructor(value) { this.value = value; } },
        PolygonHierarchy: class { constructor(posicoes) { this.positions = posicoes; } },
        BoundingSphere: { fromPoints: (pontos) => ({ center: pontos[0], radius: 1 }) },
        VerticalOrigin: { BOTTOM: 'bottom', CENTER: 'center' },
        HorizontalOrigin: { CENTER: 'center', LEFT: 'left' },
        LabelStyle: { FILL_AND_OUTLINE: 'fill_and_outline' },
        HeightReference: { NONE: 'none' },
        ScreenSpaceEventType: {
            LEFT_CLICK: 'left_click',
            RIGHT_CLICK: 'right_click',
            LEFT_DOUBLE_CLICK: 'left_double_click',
            MOUSE_MOVE: 'mouse_move',
        },
        defined: (v) => v !== undefined && v !== null,
    };
    globalThis.window.Cesium = globalThis.Cesium;
}

// ===== Dublês de módulo =====
const { storeMock, busMock, motor } = vi.hoisted(() => ({
    storeMock: {
        getMarkers: vi.fn(async () => []),
        getMeasurements: vi.fn(async () => []),
        getViewsheds: vi.fn(async () => []),
        addViewshed: vi.fn(async () => null),
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
    // Cada instância do motor de visibilidade, na ordem: setores e gestos.
    motor: { instancias: [] },
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
    addMeasurement: vi.fn(),
    getMeasurements: (...args) => storeMock.getMeasurements(...args),
    updateMeasurement: vi.fn(),
    removeMeasurement: vi.fn(),
    DEFAULT_MEASUREMENT_STYLE: {
        lineColor: '#FFFF00', lineWidth: 3, lineOpacity: 1,
        fillColor: '#FFFF00', fillOpacity: 0.2,
        labelColor: '#ffffff', labelSize: 14,
        labelOutlineColor: '#000000', labelOutlineWidth: 2,
        labelBackgroundColor: '#FFFF00', labelBackgroundOpacity: 0.8,
    },
    addViewshed: (...args) => storeMock.addViewshed(...args),
    getViewsheds: (...args) => storeMock.getViewsheds(...args),
    updateViewshed: vi.fn(),
    removeViewshed: vi.fn(),
    getViewshedById: vi.fn(async () => null),
}));

vi.mock('@store/services.js', () => ({ getEventBus: () => busMock }));

vi.mock('@js/presence/presence-store.js', () => ({
    presenceStore: { getSelections: () => [], getCursors: () => [] },
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: { clientId: 'self', userId: 'u-self' },
}));

// O botão de finalizar mora em `document.body`; nada dele é o assunto aqui.
vi.mock('@js/draw_tools/drawing-touch-helpers.js', () => ({
    DrawingFinishButton: class {
        show() {}
        hide() {}
        updateState() {}
        setEnabled() {}
    },
}));

vi.mock('../../src/js/3d_models_viewer_tool/map_3d.js', () => ({ deactivateActiveTool3D: vi.fn() }));

vi.mock('../../src/js/3d_models_viewer_tool/services/viewshed-3d.js', () => ({
    Viewshed3D: class {
        constructor(viewer, options = {}) {
            this.viewer = viewer;
            this.options = options;
            this.cameraPosition = options.cameraPosition ?? null;
            this.viewPosition = options.viewPosition ?? null;
            this._destroyed = false;
            this._outline = null;
            this._handler = null;
            if (this.cameraPosition && this.viewPosition) {
                // `_addToScene` do motor real: o contorno e o setor, os dois em `scene.primitives`.
                const primitivas = viewer.scene.primitives;
                this._outline = primitivas.add(new globalThis.Cesium.PrimitiveCollection());
                primitivas.add(this);
            } else {
                // O gesto de dois cliques: um handler no canvas da cena.
                this._handler = new globalThis.Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
            }
            motor.instancias.push(this);
        }
        isDestroyed() { return this._destroyed; }
        // O `destroy` do motor real, no que toca a propriedade: idempotente, e só mexe na cena com o
        // viewer vivo.
        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;
            this._handler?.destroy();
            this._handler = null;
            const viewer = this.viewer;
            if (viewer && !viewer.isDestroyed()) {
                if (this._outline) viewer.scene.primitives.remove(this._outline);
                viewer.scene.primitives.remove(this);
            }
            this.viewer = null;
        }
    },
}));

const { EventTypes } = await import('@events/event_types.js');
const { CesiumMeasure } = await import('../../src/js/3d_models_viewer_tool/services/cesium-measure.js');
const { teardownCesiumViewer, throwIfTeardownFailed } = await import(
    '../../src/js/3d_models_viewer_tool/services/viewer-teardown.js'
);
const marcadores = await import('../../src/js/3d_models_viewer_tool/tools/marker_tool_3d.js');
const medicoes = await import('../../src/js/3d_models_viewer_tool/tools/measurement_tool_3d.js');
const visibilidades = await import('../../src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');

// ===== Dados e ajudantes =====

function marcador(id) {
    return {
        id,
        tilesetId: 'modelo-1',
        position: { longitude: -43.2, latitude: -22.9, height: 10 },
        properties: { nome: id },
        style: {},
    };
}

function medicao(id) {
    return {
        id,
        tilesetId: 'modelo-1',
        type: 'distance',
        positions: [
            { longitude: -43.2, latitude: -22.9, height: 10 },
            { longitude: -43.21, latitude: -22.91, height: 12 },
        ],
        result: { value: 12.5, formatted: '' },
        properties: { nome: id, descricao: '' },
        style: {},
        images: [],
        sync: { deleted: false },
    };
}

function visibilidade(id) {
    return {
        id,
        tilesetId: 'modelo-1',
        position: { longitude: -43.2, latitude: -22.9, height: 10 },
        targetPosition: { longitude: -43.19, latitude: -22.9, height: 10 },
        terrainBaseHeight: 10,
        direction: { heading: 90, pitch: 0 },
        parameters: { horizontalAngle: 120, verticalAngle: 90, distance: 300 },
        observerHeight: 1.5,
        properties: { nome: id, descricao: '' },
        images: [],
        sync: { deleted: false },
    };
}

/** Uma promessa que o teste resolve na hora que quiser: a leitura ou a gravação em voo. */
function adiado() {
    let resolver;
    const promessa = new Promise((resolve) => { resolver = resolve; });
    return { promessa, resolver };
}

/** Deixa rodar o que estava pendurado em microtarefas (continuações de `await`). */
const drenar = () => new Promise((resolve) => setTimeout(resolve, 0));

/** O handler vivo que registrou uma ação de um tipo (o de desenho da medição é o único com clique direito). */
const handlerCom = (tipo) => [...handlersVivos].find((h) => h.acoes.has(tipo));

const marcadoresNaCena = (viewer) => viewer.entities.values
    .map((e) => e.id)
    .filter((id) => id.startsWith('marker-3d-'))
    .sort();

/**
 * Um visualizador com o que a sessão real põe nele: a medida efêmera (e com ela a fonte de dados que
 * leva o display para a cena) e as três ferramentas pintadas.
 * @param {string} [tilesetId]
 */
async function abrirSessao(tilesetId = 'modelo-1') {
    const viewer = new Viewer();
    const medida = new CesiumMeasure(viewer);
    await marcadores.renderMarkersForTileset(viewer, tilesetId);
    await medicoes.renderMeasurementsForTileset(viewer, tilesetId);
    await visibilidades.renderViewshedsForTileset(viewer, tilesetId);
    return { viewer, medida };
}

/** As etapas que `cleanup3DFeatures` passa à folha, para as ferramentas desta suíte e na mesma ordem. */
function etapasDaSessao(medida) {
    return [
        { name: 'markers', run: () => marcadores.cleanupMarkerTool() },
        { name: 'measurements', run: () => medicoes.cleanupMeasurementTool() },
        { name: 'viewsheds', run: () => visibilidades.cleanupViewshedTool() },
        { name: 'ephemeral measure', run: () => medida.destroy() },
    ];
}

/**
 * Uma etapa final que fotografa o que ainda é NOSSO no viewer, logo antes de ele cair. Vazio é a
 * prova de que cada dono soltou o seu, e que o `destroy` do viewer não destrói nada por nós.
 */
function sondaDoDono(viewer, retrato) {
    return {
        name: 'sonda',
        run: () => {
            retrato.entidades = viewer.entities.values.map((e) => e.id);
            retrato.fontes = viewer.dataSources.length;
            retrato.setores = viewer.scene.primitives._primitives
                .filter((p) => motor.instancias.includes(p)).length;
            retrato.handlers = handlersVivos.size;
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    busMock._registry.clear();
    handlersVivos.clear();
    motor.instancias.length = 0;
    instalarCesium();

    storeMock.getMarkers.mockReset();
    storeMock.getMarkers.mockResolvedValue([marcador('p1')]);
    storeMock.getMeasurements.mockReset();
    storeMock.getMeasurements.mockResolvedValue([medicao('m1')]);
    storeMock.getViewsheds.mockReset();
    storeMock.getViewsheds.mockResolvedValue([visibilidade('v1')]);
    storeMock.addViewshed.mockReset();
    storeMock.addViewshed.mockResolvedValue(null);

    marcadores.cleanupMarkerTool();
    medicoes.cleanupMeasurementTool();
    visibilidades.cleanupViewshedTool();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('o dublê reproduz o defeito do relatório (controle do instrumento)', () => {
    it('esvaziar a cena e só depois destruir o viewer lança o DeveloperError, de dentro de _onDataSourceRemoved', () => {
        const viewer = new Viewer();
        new CesiumMeasure(viewer);
        viewer.entities.add({ id: 'qualquer' });

        // A sequência que `cleanup3DFeatures` fazia até 2026-09-22.
        viewer.entities.removeAll();
        viewer.dataSources.removeAll();
        viewer.scene.primitives.removeAll();
        viewer.scene.groundPrimitives.removeAll();

        let erro = null;
        try {
            viewer.destroy();
        } catch (e) {
            erro = e;
        }
        expect(erro?.name).toBe('DeveloperError');
        expect(erro.message).toBe(MENSAGEM_DESTRUIDO);
        expect(erro.stack).toContain('_onDataSourceRemoved');
    });

    it('com um dono por objeto a MESMA cena desmonta sem erro, e a fonte sai antes do viewer', () => {
        const viewer = new Viewer();
        const medida = new CesiumMeasure(viewer);
        viewer.entities.add({ id: 'qualquer' });
        let fontesAntesDoViewer = null;

        const falhas = teardownCesiumViewer(viewer, [
            { name: 'ephemeral measure', run: () => medida.destroy() },
            { name: 'sonda', run: () => { fontesAntesDoViewer = viewer.dataSources.length; } },
        ]);

        expect(falhas).toEqual([]);
        expect(viewer.isDestroyed()).toBe(true);
        expect(fontesAntesDoViewer).toBe(0);
        // Idempotente: o segundo `destroy` da medida não toca o viewer morto.
        expect(() => medida.destroy()).not.toThrow();
    });
});

describe('fechar com ferramenta ativa', () => {
    it('medição no meio do gesto: a desmontagem solta o handler, a entidade temporária e o viewer', async () => {
        const { viewer, medida } = await abrirSessao();
        medicoes.activateMeasurementTool(viewer, 'modelo-1', 'distance');
        viewer.scene.pontoSobOPonteiro = new Cartesian3(-43.2, -22.9, 10);
        await handlerCom('right_click').acoes.get('left_click')({ position: { x: 5, y: 5 } });
        // Não é vácuo: o gesto está de fato em andamento.
        expect(viewer.entities.getById('temp-measurement-point-0')).toBeTruthy();

        const retrato = {};
        const falhas = teardownCesiumViewer(viewer, [...etapasDaSessao(medida), sondaDoDono(viewer, retrato)]);

        expect(falhas).toEqual([]);
        expect(retrato).toEqual({ entidades: [], fontes: 0, setores: 0, handlers: 0 });
        expect(viewer.isDestroyed()).toBe(true);
    });

    it('gesto de visibilidade pendente: o motor do gesto cai com o viewer ainda vivo', async () => {
        const { viewer, medida } = await abrirSessao();
        visibilidades.activateViewshedTool(viewer, 'modelo-1');
        const gesto = motor.instancias.find((i) => i.options.calback);
        expect(gesto.isDestroyed()).toBe(false);

        const retrato = {};
        let gestoVivoAntesDoViewer = null;
        const falhas = teardownCesiumViewer(viewer, [
            ...etapasDaSessao(medida),
            { name: 'gesto', run: () => { gestoVivoAntesDoViewer = !gesto.isDestroyed(); } },
            sondaDoDono(viewer, retrato),
        ]);

        expect(falhas).toEqual([]);
        expect(gestoVivoAntesDoViewer).toBe(false);
        expect(retrato).toEqual({ entidades: [], fontes: 0, setores: 0, handlers: 0 });
        expect(motor.instancias.every((i) => i.isDestroyed())).toBe(true);
    });
});

describe('fechar durante o sync ao vivo', () => {
    it('o debounce pendente das três ferramentas morre com a desmontagem, e nenhuma leitura sai depois', async () => {
        const { viewer, medida } = await abrirSessao();
        vi.useFakeTimers();
        marcadores.initMarkerToolListeners();
        medicoes.initMeasurementToolListeners();
        visibilidades.initViewshedToolListeners();
        const eventos = [
            EventTypes.MARKERS_3D_CHANGED,
            EventTypes.MEASUREMENTS_3D_CHANGED,
            EventTypes.VIEWSHEDS_3D_CHANGED,
        ];

        // Não é vácuo: com o viewer vivo, o evento vira uma leitura depois da janela (a da abertura
        // é a primeira de cada contagem).
        for (const evento of eventos) busMock.emit(evento, { mapName: 'M' });
        await vi.advanceTimersByTimeAsync(200);
        await vi.waitFor(() => {
            expect(storeMock.getMarkers).toHaveBeenCalledTimes(2);
            expect(storeMock.getMeasurements).toHaveBeenCalledTimes(2);
            expect(storeMock.getViewsheds).toHaveBeenCalledTimes(2);
        });

        for (const evento of eventos) busMock.emit(evento, { mapName: 'M' });
        storeMock.getMarkers.mockClear();
        storeMock.getMeasurements.mockClear();
        storeMock.getViewsheds.mockClear();

        expect(teardownCesiumViewer(viewer, etapasDaSessao(medida))).toEqual([]);
        await vi.advanceTimersByTimeAsync(200);

        expect(storeMock.getMarkers).not.toHaveBeenCalled();
        expect(storeMock.getMeasurements).not.toHaveBeenCalled();
        expect(storeMock.getViewsheds).not.toHaveBeenCalled();
        for (const evento of eventos) expect(busMock.ouvintes(evento)).toBe(0);
    });

    it('a reconciliação com a leitura em voo quando o viewer cai volta sem tocar no viewer destruído', async () => {
        const { viewer, medida } = await abrirSessao();
        const leituras = [adiado(), adiado(), adiado()];
        storeMock.getMarkers.mockImplementationOnce(() => leituras[0].promessa);
        storeMock.getMeasurements.mockImplementationOnce(() => leituras[1].promessa);
        storeMock.getViewsheds.mockImplementationOnce(() => leituras[2].promessa);
        const emVoo = [
            marcadores.syncMarkersFromStore(),
            medicoes.syncMeasurementsFromStore(),
            visibilidades.syncViewshedsFromStore(),
        ];

        expect(teardownCesiumViewer(viewer, etapasDaSessao(medida))).toEqual([]);
        const instanciasNaQueda = motor.instancias.length;

        // Voltam com conteúdo NOVO, que obrigaria a desenhar se ninguém conferisse o viewer.
        leituras[0].resolver([marcador('p1'), marcador('p2')]);
        leituras[1].resolver([medicao('m1'), medicao('m2')]);
        leituras[2].resolver([visibilidade('v1'), visibilidade('v2')]);
        const resultados = await Promise.allSettled(emVoo);

        expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(motor.instancias).toHaveLength(instanciasNaQueda);
        expect(handlersVivos.size).toBe(0);
    });

    it('a pintura de ABERTURA em voo quando o viewer cai não faz nascer handler num viewer morto', async () => {
        const viewer = new Viewer();
        const medida = new CesiumMeasure(viewer);
        const leituras = [adiado(), adiado(), adiado()];
        storeMock.getMarkers.mockImplementationOnce(() => leituras[0].promessa);
        storeMock.getMeasurements.mockImplementationOnce(() => leituras[1].promessa);
        storeMock.getViewsheds.mockImplementationOnce(() => leituras[2].promessa);
        const emVoo = [
            marcadores.renderMarkersForTileset(viewer, 'modelo-1'),
            medicoes.renderMeasurementsForTileset(viewer, 'modelo-1'),
            visibilidades.renderViewshedsForTileset(viewer, 'modelo-1'),
        ];

        expect(teardownCesiumViewer(viewer, etapasDaSessao(medida))).toEqual([]);
        leituras[0].resolver([marcador('p1')]);
        leituras[1].resolver([medicao('m1')]);
        leituras[2].resolver([visibilidade('v1')]);
        const resultados = await Promise.allSettled(emVoo);

        // Sem a guarda pós-leitura, as três rejeitam com o TypeError de `viewer.canvas`.
        expect(resultados.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        expect(handlersVivos.size).toBe(0);
        expect(motor.instancias).toHaveLength(0);
    });
});

describe('fechar e reabrir', () => {
    it('desmonta, abre um viewer novo, trabalha nele e desmonta de novo, sem erro', async () => {
        const a = await abrirSessao();
        expect(teardownCesiumViewer(a.viewer, etapasDaSessao(a.medida))).toEqual([]);

        const b = await abrirSessao();
        // Não é vácuo: as três ferramentas pintaram no viewer NOVO.
        expect(b.viewer.entities.getById('marker-3d-p1')).toBeTruthy();
        expect(b.viewer.entities.getById('measurement-3d-line-m1')).toBeTruthy();
        expect(b.viewer.entities.getById('viewshed-3d-origin-v1')).toBeTruthy();
        medicoes.activateMeasurementTool(b.viewer, 'modelo-1', 'area');
        visibilidades.activateViewshedTool(b.viewer, 'modelo-1');

        const retrato = {};
        const falhas = teardownCesiumViewer(b.viewer, [...etapasDaSessao(b.medida), sondaDoDono(b.viewer, retrato)]);

        expect(falhas).toEqual([]);
        expect(retrato).toEqual({ entidades: [], fontes: 0, setores: 0, handlers: 0 });
        expect(a.viewer.isDestroyed()).toBe(true);
        expect(b.viewer.isDestroyed()).toBe(true);
        expect(motor.instancias.every((i) => i.isDestroyed())).toBe(true);
    });

    it('a reconciliação de marcadores que começou no viewer antigo não pinta no novo', async () => {
        const a = await abrirSessao('modelo-1');
        const leitura = adiado();
        storeMock.getMarkers.mockImplementationOnce(() => leitura.promessa);
        const emVoo = marcadores.syncMarkersFromStore();
        expect(teardownCesiumViewer(a.viewer, etapasDaSessao(a.medida))).toEqual([]);

        storeMock.getMarkers.mockResolvedValue([]);
        const b = await abrirSessao('modelo-2');
        leitura.resolver([marcador('p1'), marcador('p2')]);
        await emVoo;

        expect(marcadoresNaCena(b.viewer)).toEqual([]);
    });

    it('o gesto de visibilidade que termina depois da desmontagem não deixa órfão o gesto do viewer novo', async () => {
        const a = await abrirSessao();
        visibilidades.activateViewshedTool(a.viewer, 'modelo-1');
        const gestoA = motor.instancias.find((i) => i.options.calback);
        const gravacao = adiado();
        storeMock.addViewshed.mockImplementationOnce(() => gravacao.promessa);
        Object.assign(gestoA, {
            cameraPosition: new Cartesian3(-43.2, -22.9, 10),
            viewPosition: new Cartesian3(-43.19, -22.9, 10),
            horizontalAngle: 120, verticalAngle: 90, distance: 300,
        });
        // O segundo clique: a gravação começa e fica em voo.
        gestoA.options.calback();

        expect(teardownCesiumViewer(a.viewer, etapasDaSessao(a.medida))).toEqual([]);
        expect(gestoA.isDestroyed()).toBe(true);

        const b = await abrirSessao();
        visibilidades.activateViewshedTool(b.viewer, 'modelo-1');
        const gestoB = motor.instancias.find((i) => i.options.calback && i !== gestoA);
        const instanciasAntes = motor.instancias.length;

        gravacao.resolver(visibilidade('nova'));
        await drenar();

        // O gesto do viewer novo continua sendo DA ferramenta: desativá-la o destrói.
        expect(gestoB.isDestroyed()).toBe(false);
        visibilidades.deactivateViewshedTool();
        expect(gestoB.isDestroyed()).toBe(true);
        // E nada foi desenhado no viewer novo por um gesto do antigo.
        expect(motor.instancias).toHaveLength(instanciasAntes);
    });
});

describe('uma etapa que falha', () => {
    it('não impede as seguintes nem o destroy do viewer, e volta intacta com o nome da etapa', () => {
        const viewer = new Viewer();
        const medida = new CesiumMeasure(viewer);
        const quebra = new Error('etapa quebrada');
        const depois = vi.fn();

        const falhas = teardownCesiumViewer(viewer, [
            { name: 'quebrada', run: () => { throw quebra; } },
            { name: 'ephemeral measure', run: () => medida.destroy() },
            { name: 'depois', run: depois },
        ]);

        expect(depois).toHaveBeenCalledTimes(1);
        expect(viewer.isDestroyed()).toBe(true);
        expect(falhas).toEqual([{ step: 'quebrada', error: quebra }]);

        let lancado = null;
        try {
            throwIfTeardownFailed(falhas);
        } catch (e) {
            lancado = e;
        }
        // O MESMO objeto, para a pilha que chega à tabela de defeitos ser a original.
        expect(lancado).toBe(quebra);
    });

    it('duas falhas saem juntas, nomeadas; nenhuma não lança', () => {
        const a = new Error('a');
        const b = new Error('b');
        let lancado = null;
        try {
            throwIfTeardownFailed([{ step: 'x', error: a }, { step: 'y', error: b }]);
        } catch (e) {
            lancado = e;
        }
        expect(lancado).toBeInstanceOf(AggregateError);
        expect(lancado.errors).toEqual([a, b]);
        expect(lancado.message).toContain('x, y');
        expect(() => throwIfTeardownFailed([])).not.toThrow();
    });

    it('um viewer que já caiu, ou que nunca existiu, não é destruído de novo', () => {
        const viewer = new Viewer();
        viewer.destroy();
        expect(teardownCesiumViewer(viewer, [])).toEqual([]);
        expect(teardownCesiumViewer(null, [])).toEqual([]);
    });
});

describe('censo: ninguém esvazia por fora as coleções que o viewer destrói', () => {
    const AQUI = path.dirname(fileURLToPath(import.meta.url));
    const PASTA = path.resolve(AQUI, '../../src/js/3d_models_viewer_tool');
    const PROIBIDO = /\b(?:primitives|groundPrimitives)\.removeAll\(|\bdataSources\.removeAll\(/;

    /** O fonte sem comentários: a prosa que CITA a forma proibida não é a forma proibida. */
    const semComentarios = (fonte) => fonte
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    const arquivos = fs.readdirSync(PASTA, { recursive: true })
        .map(String)
        .filter((rel) => rel.endsWith('.js'))
        .map((rel) => path.join(PASTA, rel));

    it('piso: a varredura achou o visualizador inteiro', () => {
        expect(arquivos.length).toBeGreaterThan(10);
        expect(arquivos.some((f) => f.endsWith('map_3d.js'))).toBe(true);
        expect(arquivos.some((f) => f.endsWith('viewshed_tool_3d.js'))).toBe(true);
    });

    it('controle: o padrão casa a forma antiga e deixa passar a coleção PRÓPRIA de uma ferramenta', () => {
        expect(PROIBIDO.test('        scene.primitives.removeAll();')).toBe(true);
        expect(PROIBIDO.test('        scene.groundPrimitives.removeAll();')).toBe(true);
        expect(PROIBIDO.test('        cesiumState.viewer.dataSources.removeAll();')).toBe(true);
        expect(PROIBIDO.test('            preview.lines.removeAll();')).toBe(false);
    });

    it('nenhum arquivo do visualizador 3D esvazia a cena ou as fontes do viewer', () => {
        const infratores = arquivos.filter((arquivo) =>
            PROIBIDO.test(semComentarios(fs.readFileSync(arquivo, 'utf8'))));
        expect(infratores.map((f) => path.relative(PASTA, f))).toEqual([]);
    });

    it('cleanup3DFeatures desmonta pela folha e não destrói o viewer por conta própria', () => {
        const fonte = semComentarios(fs.readFileSync(path.join(PASTA, 'map_3d.js'), 'utf8'));
        const inicio = fonte.indexOf('export function cleanup3DFeatures()');
        expect(inicio).toBeGreaterThan(-1);
        const resto = fonte.slice(inicio);
        const corpo = resto.slice(0, resto.search(/\r?\n\}\r?\n/));

        expect(corpo).toContain('teardownCesiumViewer(');
        expect(corpo).toContain('throwIfTeardownFailed(');
        expect(corpo).not.toMatch(/viewer\.destroy\(/);
        expect(corpo).not.toMatch(/removeAll\(/);
    });
});
