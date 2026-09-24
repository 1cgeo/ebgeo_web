// Path: tests/store/viewshed-parametros.test.js
//
// `updateViewshed` tem de GRAVAR os parâmetros da análise, e não só as propriedades e a
// altura do observador.
//
// O DEFEITO QUE ESTA RÉGUA PRENDE, medido nas duas linhas do produto em 2026-09-16: o painel
// manda `{ parameters: { horizontalAngle, distance } }`, o atualizador só conhecia
// `updates.properties` e `updates.observerHeight`, e o campo caía EM SILÊNCIO. O retorno vinha
// com o valor velho, o cone era recriado igual, e a altura do observador (que o atualizador
// conhecia) funcionava: por isso os outros dois pareciam defeito do desenho 3D, e não do store.
// É a família do "atualizador com lista branca de campos": quem não é citado é descartado sem
// um erro, e o sintoma é UM parâmetro da tela funcionar e os vizinhos não.
//
// Portado de `tests/store/viewshed-parametros.test.js` da `main` (commit 6e15b592), com o
// arranjo de dublês do DESTINO, que tem sync por operação: os mocks são os de
// `tests/store/cesium3d-operations.test.js`, inclusive o espelho do despachante write-ahead,
// porque a escrita aqui declara a intenção antes de gravar o documento.
//
// DOIS DOS SEIS CASOS SÃO CONTROLE (a altura do observador e as propriedades): eles passavam
// antes e depois do conserto, e existem para que uma régua vermelha não seja lida como "o
// atualizador inteiro quebrou".

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => ({
    store: new Map(),
    mapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn((name) => (name === 'TestMap' ? 'map-uuid-123' : name))
    },
    memory: { cesium3d: null }
}));

// ============================================================================
// Mock dependencies
// ============================================================================

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getCesium3dCompat: vi.fn(async (mapName) => {
        const existing = h.store.get(mapName);
        // Cópia fresca a cada leitura, como o repositório real (que desserializa do
        // IndexedDB): sem isso o teste compartilharia a referência com o que está gravado e
        // um atualizador que só mexesse no objeto em memória passaria sem persistir nada.
        return existing
            ? structuredClone(existing)
            : { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] };
    }),
    setCesium3dCompat: vi.fn(async (mapName, data) => {
        h.store.set(mapName, structuredClone(data));
    })
}));

// A FOTO É BLOB COM REFERÊNCIA desde a fase 2b (`store/photo-attach.js`, 2026-09-24): o item que a
// entidade guarda não tem `data`. O preparo é dublado aqui porque ele grava no armazém de imagens e
// registra a subida, que esta suíte não monta; ele tem suíte própria. A miniatura vem do
// `processImageFile` dublado acima, para que as asserções de miniatura sigam valendo.
vi.mock('../../src/js/store/photo-attach.js', async () => {
    const { generateUUID } = await import('../../src/js/utilities/uuid.js');
    const { processImageFile } = await import('../../src/js/utilities/image_utils.js');
    return {
        prepararFotoAnexa: vi.fn(async (file) => {
            const { thumbnail } = (await processImageFile(file)) ?? {};
            return {
                item: { id: generateUUID(), name: file.name, type: file.type, size: file.size, thumbnail, addedAt: Date.now() },
                bytes: file.size,
                gravar: vi.fn(async () => {}),
                confirmar: vi.fn(),
                descartar: vi.fn(async () => {}),
            };
        }),
        // The safety net of phase 2c converts nothing here: these suites run with no server atlas.
        converterFotosDasOperacoes: vi.fn(async () => null),
        comConversao: async (_conversao, escrita) => escrita,
    };
});

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: h.mapManager
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        get cesium3d() { return h.memory.cesium3d; },
        set cesium3d(v) { h.memory.cesium3d = v; }
    }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_MARKER_3D: 'CREATE_MARKER_3D',
        DELETE_MARKER_3D: 'DELETE_MARKER_3D'
    }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMarker3dOperation: vi.fn().mockResolvedValue(undefined),
    logMeasurement3dOperation: vi.fn().mockResolvedValue(undefined),
    logViewshed3dOperation: vi.fn().mockResolvedValue(undefined),
    logCameraPosition3dOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

// O espelho do despachante write-ahead, igual ao de cesium3d-operations.test.js: a escrita
// declara a intenção por `persistOperationIntents` dentro da transação, e sem este dublê a
// chamada explodiria antes de o documento ser gravado.
vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (descriptions) => {
        const sync = await import('../../src/js/store/sync/index.js');
        const porAlvo = {
            marker3d: sync.logMarker3dOperation,
            measurement3d: sync.logMeasurement3dOperation,
            viewshed3d: sync.logViewshed3dOperation,
            cameraPosition3d: sync.logCameraPosition3dOperation
        };
        for (const op of descriptions) {
            const log = porAlvo[op.entityType];
            if (!log) throw new Error(`Alvo de op 3D nao classificado: ${op.entityType}`);
            const args = [op.operationType, op.entityId, op.mapId, op.data];
            if (op.previousData != null) args.push(op.previousData);
            log(...args);
        }
        return async () => {};
    })
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    addViewshed,
    updateViewshed,
    getViewshedById
} from '../../src/js/store/cesium3d.operations.js';

// ============================================================================
// Helpers
// ============================================================================

const TILESET_ID = 'tileset-1';
const BASE_PARAMS = { horizontalAngle: 120, verticalAngle: 120, distance: 500 };

async function criarViewshed() {
    return addViewshed(TILESET_ID, {
        position: { longitude: -43.2, latitude: -22.9, height: 30 },
        targetPosition: { longitude: -43.19, latitude: -22.9, height: 30 },
        terrainBaseHeight: 30,
        direction: { heading: 90, pitch: 0 },
        parameters: { ...BASE_PARAMS },
        observerHeight: 1.5
    });
}

/** Lê o registro do que foi PERSISTIDO, nunca do retorno da escrita, que é eco dela mesma. */
function lerDoDisco(id) {
    return (h.store.get('TestMap')?.viewsheds || []).find(v => v.id === id) || null;
}

beforeEach(() => {
    h.store.clear();
    h.memory.cesium3d = null;
});

// ============================================================================
// Tests
// ============================================================================

describe('updateViewshed: parâmetros da análise de visibilidade', () => {
    it('grava a distância nova e preserva os demais parâmetros', async () => {
        const viewshed = await criarViewshed();

        const retorno = await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, distance: 2000 }
        });

        expect(retorno.parameters.distance).toBe(2000);
        expect(lerDoDisco(viewshed.id).parameters.distance).toBe(2000);
        expect(lerDoDisco(viewshed.id).parameters.horizontalAngle).toBe(120);
        expect(lerDoDisco(viewshed.id).parameters.verticalAngle).toBe(120);
    });

    it('grava o campo horizontal novo e preserva os demais parâmetros', async () => {
        const viewshed = await criarViewshed();

        const retorno = await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, horizontalAngle: 300 }
        });

        expect(retorno.parameters.horizontalAngle).toBe(300);
        expect(lerDoDisco(viewshed.id).parameters.horizontalAngle).toBe(300);
        expect(lerDoDisco(viewshed.id).parameters.distance).toBe(500);
    });

    it('sobrevive à releitura pelo getViewshedById, que é o que o painel recarrega', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, {
            parameters: { ...BASE_PARAMS, horizontalAngle: 45, distance: 1200 }
        });

        const relido = await getViewshedById(viewshed.id);
        expect(relido.parameters.horizontalAngle).toBe(45);
        expect(relido.parameters.distance).toBe(1200);
    });

    it('funde parâmetro parcial em vez de apagar o que não veio', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { parameters: { distance: 750 } });

        const gravado = lerDoDisco(viewshed.id);
        expect(gravado.parameters.distance).toBe(750);
        expect(gravado.parameters.horizontalAngle).toBe(120);
        expect(gravado.parameters.verticalAngle).toBe(120);
    });

    it('a operação de sync leva os parâmetros novos, e não os velhos', async () => {
        const sync = await import('../../src/js/store/sync/index.js');
        const viewshed = await criarViewshed();
        sync.logViewshed3dOperation.mockClear();

        await updateViewshed(viewshed.id, { parameters: { ...BASE_PARAMS, distance: 4000 } });

        // O destino sincroniza por operação: um parâmetro que só chegasse ao documento local
        // e não ao envelope voltaria ao valor velho no primeiro empurrão do servidor.
        expect(sync.logViewshed3dOperation).toHaveBeenCalledTimes(1);
        const [tipo, id, , dados] = sync.logViewshed3dOperation.mock.calls[0];
        expect(tipo).toBe('update');
        expect(id).toBe(viewshed.id);
        expect(dados.parameters.distance).toBe(4000);
    });

    it('a altura do observador continua gravando (controle que já passava antes)', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { observerHeight: 12 });

        expect(lerDoDisco(viewshed.id).observerHeight).toBe(12);
    });

    it('não mexe nos parâmetros quando a atualização não os cita (controle)', async () => {
        const viewshed = await criarViewshed();

        await updateViewshed(viewshed.id, { properties: { nome: 'Cota 300' } });

        const gravado = lerDoDisco(viewshed.id);
        expect(gravado.properties.nome).toBe('Cota 300');
        expect(gravado.parameters).toEqual(BASE_PARAMS);
    });
});
