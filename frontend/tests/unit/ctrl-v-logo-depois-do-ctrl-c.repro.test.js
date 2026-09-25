// Path: tests/unit/ctrl-v-logo-depois-do-ctrl-c.repro.test.js
// REPRO: Ctrl+C e logo em seguida Ctrl+V não colam nada, e não dizem nada.
//
// ================= A CADEIA, MEDIDA ==========================================
//
// O `Ctrl+V` de `keyboard-shortcuts.js` decide se sequestra a tecla perguntando só
// `hasClipboardData()`, que é falso enquanto a cópia ainda não chegou ao clipboard. Um `Ctrl+V`
// dentro dessa janela caía na colagem nativa do navegador: nenhuma feição, nenhum aviso.
// `paste()` já esperava a cópia em voo (`_copyInFlight`), mas o atalho nem chegava a chamá-lo.
//
// A janela existia só enquanto a ferramenta preguiçosa carregava. Desde 2026-09-25 (`b82a0a22`)
// `copy()` relê cada feição da STORE (`getFeatureById`), que lê o documento do mapa no
// IndexedDB: uma volta de tarefa em TODA cópia, e maior quanto maior o mapa.
//
// Medido no Chromium 1194 pelo helper `copiarEColar` dos specs de cobertura de desenho (Ctrl+C e
// Ctrl+V seguidos, como a pessoa faz com o Ctrl seguro): "Ctrl+V nao criou a copia" em 4 de 10
// execuções de `cobertura-desenho-local.spec.js` (elipse 1 de 5, texto 3 de 5).
//
// ================= O QUE ESTE ARQUIVO PRENDE =================================
//
// A INTERLEAVING PERDEDORA, DETERMINÍSTICA: a leitura da store fica presa numa promessa que o
// teste solta à mão, o `Ctrl+V` chega com a cópia em voo, e só então a leitura termina. Os dois
// módulos são os de verdade (`KeyboardShortcuts` e `ClipboardManager`); a store, o toast e a
// ferramenta são dublês.
//
// Os CONTROLES: (1) a mesma sequência com a cópia já terminada cola, antes e depois do conserto,
// então o harness cola de fato e o verde do caso principal tem conteúdo; (2) Ctrl+V sem cópia
// nenhuma continua indo para o navegador, então o conserto não passou a sequestrar toda colagem.
//
// O que ele NÃO alcança: o `preventDefault` depois de um `await` (o atalho inteiro roda depois do
// `await` de `handleSystemShortcuts`, e isso é anterior e alheio a este defeito), e a tela.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// OS DUBLÊS
// ---------------------------------------------------------------------------

const addFeatures = vi.fn(async () => true);
let clipboard = { features: [], copiedAt: null, sourceMapName: null };

/** A leitura da store presa: `getFeatureById` só responde quando o teste solta. */
let leituras = [];
let leituraPresa = false;

vi.mock('@store', () => ({
    addFeatures: (...a) => addFeatures(...a),
    getFeatureById: (_storage, id) => {
        const feicao = { type: 'Feature', id, geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { id, source: 'point', nome: `Ponto ${id}`, layerId: 'default' } };
        if (!leituraPresa) return Promise.resolve(feicao);
        return new Promise((soltar) => leituras.push(() => soltar(feicao)));
    },
    getImage: vi.fn(async () => null),
    getCurrentMapNameSync: () => 'Principal',
    getStorageTypeFromSource: (source) => `${source}s`,
    getSourceTypeFromStorage: (storage) => storage.replace(/s$/, ''),
    isUncopyableFeatureType: () => false,
    hasImageResource: () => false,
    getStateManager: () => ({
        getClipboard: () => clipboard,
        hasClipboardData: () => clipboard.features.length > 0,
        setClipboard: (features, sourceMapName) => {
            clipboard = { features, copiedAt: Date.now(), sourceMapName };
        },
        clearClipboard: () => { clipboard = { features: [], copiedAt: null, sourceMapName: null }; },
    }),
    isCurrentMapLockedSync: () => false,
    buildLayerMappingForMove: vi.fn(async () => new Map()),
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operation-blocked' },
}));

vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: true }),
    GuardAction: { CREATE_FEATURE: 'CREATE_FEATURE' },
}));

vi.mock('@store/denial-phrases.js', () => ({ denialNotice: (c) => `RECUSA(${c})` }));

vi.mock('@store/edicao-indisponivel.js', () => ({ semEdicaoSync: () => false }));

const toasts = { success: [], warning: [] };
let proximoId = 0;
vi.mock('@utils', () => ({
    IDUtils: {
        generateUniqueId: () => `id-${++proximoId}`,
        generateGeoJSONId: () => ++proximoId,
        generateFeatureName: async () => 'Feição',
        duplicateImageResource: vi.fn(async () => {}),
    },
    ToastService: {
        showSuccess: (m) => toasts.success.push(m),
        showWarning: (m) => toasts.warning.push(m),
        showError: vi.fn(),
    },
}));

vi.mock('@utils/toast_service.js', () => ({ showWarning: (m) => toasts.warning.push(m) }));
vi.mock('@modals/index.js', () => ({ showConfirm: vi.fn(async () => false) }));
vi.mock('@js/map/undo-redo.runner.js', () => ({ runUndoRedo: vi.fn(async () => true) }));
vi.mock('@ui/view-mode.controller.js', () => ({ getViewModeController: () => ({ toggleManualView: vi.fn() }) }));
vi.mock('@tools/tool-registry.js', () => ({ ensureControl: vi.fn(async () => null) }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: () => ({ add: vi.fn() }) }));
vi.mock('@js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: () => ({}),
    needsPerFeatureImage: () => false,
}));
vi.mock('@js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: vi.fn(async () => {}),
}));

const ClipboardManager = (await import('../../src/js/tool_manager/clipboard_manager.js')).default;
const KeyboardShortcuts = (await import('../../src/js/keyboard/keyboard-shortcuts.js')).default;

// ---------------------------------------------------------------------------
// O SUJEITO
// ---------------------------------------------------------------------------

/** A control that copies and pastes a point, which is what every real one does. */
const controlePonto = {
    canCopy: () => true,
    prepareForCopy: (f) => JSON.parse(JSON.stringify(f)),
    prepareForPaste: (f, offset) => ({
        ...f,
        geometry: { ...f.geometry, coordinates: [f.geometry.coordinates[0] + offset.dx, f.geometry.coordinates[1] + offset.dy] },
    }),
};

/** The real keyboard handler wired to the real clipboard manager, with one point selected. */
function montar() {
    const selecionada = { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id: 'a', source: 'point', nome: 'Ponto a', layerId: 'default' } };
    const selectionManager = {
        controls: new Map([['point', controlePonto]]),
        ensureControlFor: vi.fn(async (type) => selectionManager.controls.get(type) ?? null),
        getAllSelectedFeatures: () => [selecionada],
        deselectAllFeatures: vi.fn(),
        toggleFeatureSelection: vi.fn(async () => {}),
        updateUI: vi.fn(),
    };
    const map = {
        getZoom: () => 12,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getSource: () => null,
        hasImage: () => true,
        addImage: vi.fn(),
        removeImage: vi.fn(),
    };
    const clipboardManager = new ClipboardManager(selectionManager, map);
    const teclado = new KeyboardShortcuts({
        map, selectionManager, clipboardManager,
        toolManager: { deactivateCurrentTool: vi.fn(), setActiveTool: vi.fn() },
        addStreetViewControl: { isOpen: false },
        controls: {},
    });
    return teclado;
}

/** A Ctrl+<letra> keydown on the map canvas, the way the browser hands it to the handler. */
function ctrl(letra) {
    return {
        key: letra, code: `Key${letra.toUpperCase()}`, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
        target: { tagName: 'CANVAS', isContentEditable: false, closest: () => null },
        preventDefault: vi.fn(),
    };
}

/** Lets every pending task and microtask run. */
const voltaDeTarefa = () => new Promise((ok) => setTimeout(ok, 0));

beforeEach(() => {
    addFeatures.mockClear();
    clipboard = { features: [], copiedAt: null, sourceMapName: null };
    leituras = [];
    leituraPresa = false;
    toasts.success.length = 0;
    toasts.warning.length = 0;
    proximoId = 0;
    globalThis.window = { getSelection: () => null };
});

describe('Ctrl+V que chega com o Ctrl+C ainda lendo a store', () => {
    it('cola a feição copiada, e não entrega a tecla ao navegador', async () => {
        const teclado = montar();
        leituraPresa = true;

        const c = teclado.handleKeyDown(ctrl('c'));
        await voltaDeTarefa();
        expect(leituras, 'a cópia deveria estar presa na leitura da store').toHaveLength(1);

        const eventoV = ctrl('v');
        const v = teclado.handleKeyDown(eventoV);
        await voltaDeTarefa();
        leituras.forEach((soltar) => soltar());
        await Promise.all([c, v]);

        expect(eventoV.preventDefault, 'o atalho largou a tecla para a colagem nativa').toHaveBeenCalled();
        expect(addFeatures, 'nada foi colado').toHaveBeenCalledTimes(1);
        expect(toasts.success).toEqual(['1 feição(ões) colada(s) com sucesso']);
        expect(toasts.warning).toEqual([]);
    });
});

describe('CONTROLES', () => {
    it('com a cópia já terminada, o mesmo Ctrl+V cola (o harness cola de fato)', async () => {
        const teclado = montar();

        await teclado.handleKeyDown(ctrl('c'));
        await teclado.handleKeyDown(ctrl('v'));

        expect(addFeatures).toHaveBeenCalledTimes(1);
        expect(toasts.success).toEqual(['1 feição(ões) colada(s) com sucesso']);
    });

    it('sem cópia nenhuma, o Ctrl+V continua sendo do navegador', async () => {
        const teclado = montar();
        const eventoV = ctrl('v');

        await teclado.handleKeyDown(eventoV);

        expect(eventoV.preventDefault).not.toHaveBeenCalled();
        expect(addFeatures).not.toHaveBeenCalled();
        expect(toasts.warning).toEqual([]);
    });
});
