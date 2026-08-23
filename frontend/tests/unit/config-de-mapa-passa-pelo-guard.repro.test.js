// Path: tests/unit/config-de-mapa-passa-pelo-guard.repro.test.js
//
// REPRO da causa raiz: TRES operacoes de configuracao de mapa enfileiravam op de sync sem
// nunca consultar o guard de permissao.
//
//   temporal.operations.js  setMapTemporalConfig -> logMapTemporalOperation
//   settings.operations.js  setMapNotes          -> logMapNotesOperation
//   settings.operations.js  setGridStyle         -> logGridStyleOperation
//
// Do outro lado, `assertOperationAllowed` (backend/src/modules/sync/sync.service.js) LANCA
// ForbiddenError quando a permissao no atlas e 'read'. O 403 e classificado pelo flush e
// vira aviso ao usuario, mas a fila de saida PARA, e a mensagem culpa o acesso da pessoa
// por um botao que a propria tela ofereceu. O gate certo e o do cliente: a tela nao oferece
// o que o servidor recusaria.
//
// O que este arquivo prende, e por que cada caso existe:
//
//   1. o controle POSITIVO do mecanismo: com atlas remoto e papel de leitura, o guard
//      realmente NEGA. Sem ele, um fixture que nunca chega ao gate faria os casos negativos
//      passarem verde sem verificar nada;
//   2. com permissao de escrita, as tres escrevem localmente E enfileiram (o gate nao pode
//      ter virado um "nao faz nada");
//   3. com permissao de leitura, as tres NAO escrevem, NAO enfileiram e emitem
//      STORE_OPERATION_BLOCKED;
//   4. o gate e permissivo fora do atlas remoto, nos DOIS caminhos que significam "trabalho
//      local": sessao offline (visitante anonimo) e store LOCAL com sessao viva. Este e o
//      caso que a correcao nao pode quebrar: linha do tempo, notas e grade continuam
//      inteiras para quem trabalha sozinho, e e tambem o que mantem o import de `.ebgeo`
//      funcionando, ja que um import de projeto e uma restauracao local;
//   5. `toggleMapTemporal` sobrevive a recusa: ela devolve o estado INALTERADO em vez de
//      estourar TypeError ao ler `.ativo` de null.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Sessao + origem do store: os dois eixos que o guard REAL consulta.
// O guard nao e mockado de proposito — o defeito era a AUSENCIA da consulta, entao mockar
// o guard testaria a cópia dele, e nao a fiacao.
// ============================================================================

const sessao = vi.hoisted(() => ({
    offline: true,
    remoto: false,
    podeEditar: true
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    PermissionAction: Object.freeze({
        EDIT: 'canEdit',
        DELETE: 'canDelete',
        DELETE_MAP: 'canDeleteMap',
        COMMENT: 'canComment',
        MANAGE_USERS: 'canManageUsers',
        LOCK_MAPS: 'canLockMaps'
    }),
    sessionContext: {
        get role() { return sessao.podeEditar ? 'editor' : 'viewer'; },
        isOffline: () => sessao.offline,
        canPerformAction: (name) => (name === 'canEdit' ? sessao.podeEditar : false)
    }
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    isRemoteStoreSync: () => sessao.remoto
}));

// ============================================================================
// Persistencia: um mapa em memoria por superficie, para separar "escreveu" de "recusou".
// ============================================================================

const disco = vi.hoisted(() => ({
    settings: new Map(),
    notes: new Map(),
    grid: new Map()
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: vi.fn(async (key) => disco.settings.get(key) ?? null),
    setSettingCompat: vi.fn(async (key, value) => { disco.settings.set(key, value); }),
    getMapNotesCompat: vi.fn(async (map) => disco.notes.get(map) ?? null),
    setMapNotesCompat: vi.fn(async (map, notes) => { disco.notes.set(map, notes); }),
    getGridStyleCompat: vi.fn(async (map) => disco.grid.get(map) ?? null),
    setGridStyleCompat: vi.fn(async (map, style) => { disco.grid.set(map, style); }),
    getImageCompat: vi.fn(),
    saveImageCompat: vi.fn(),
    deleteImageCompat: vi.fn(),
    hasImageCompat: vi.fn(),
    getMapDataCompat: vi.fn(),
    updateMapDataCompat: vi.fn(),
    getRepository: vi.fn()
}));

// ============================================================================
// Enfileiramento: um espiao por op, que e o sinal que o servidor recusaria.
// ============================================================================

const fila = vi.hoisted(() => ({
    temporal: vi.fn(async () => {}),
    notes: vi.fn(),
    grid: vi.fn()
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    logMapTemporalOperation: (...args) => fila.temporal(...args),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logMapNotesOperation: (...args) => fila.notes(...args),
    logGridStyleOperation: (...args) => fila.grid(...args),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' }
}));

// ============================================================================
// Resto do grafo de import das duas operacoes, reduzido ao minimo que carrega em node.
// ============================================================================

const MAPA = 'Mapa Tatico';

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: {
        getCurrentMapName: () => MAPA,
        getMapId: (m) => m
    }
}));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: { temporalConfigs: new Map() }
}));

let barramento;
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => barramento
}));

vi.mock('../../src/js/store/document-lock.js', () => ({
    withSideDocument: (_kind, _key, _label, fn) => fn()
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        MAP_TEMPORAL_CHANGED: 'map:temporalChanged',
        TEMPORAL_CONFIG_CHANGED: 'temporal:configChanged'
    }
}));

vi.mock('../../src/js/catalog/catalog.constants.js', () => ({ CATALOG_ITEM_TYPES: {} }));
vi.mock('../../src/js/catalog/catalog-layer.ref.js', () => ({ catalogLayerReferenceId: () => null }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({ getCatalogLayers: vi.fn(async () => []) }));
vi.mock('../../src/js/store/map.operations.js', () => ({ isCurrentMapLockedSync: () => false }));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: (x) => x }
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({ fetchImageBlob: vi.fn() }));

// ============================================================================
// Imports reais (store-errors inclusive: o evento e observado por um barramento de verdade,
// nao por um espiao no lugar do emissor).
// ============================================================================

import { setMapTemporalConfig, toggleMapTemporal } from '../../src/js/store/temporal.operations.js';
import { setMapNotes, setGridStyle } from '../../src/js/store/settings.operations.js';
import { checkPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { StoreErrorEvents, setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const NOTAS = { title: 'Ordem', description: 'texto' };
const GRADE = { format: 'utm', visible: true };
const PATCH = { ativo: true, unidade: 'horas' };

/** Eventos capturados do barramento, em ordem. */
let eventos;

/** Coloca a sessao num dos quatro regimes que interessam ao guard. */
function regime({ offline, remoto, podeEditar }) {
    sessao.offline = offline;
    sessao.remoto = remoto;
    sessao.podeEditar = podeEditar;
}

/** Roda as tres operacoes gateadas. */
async function rodarAsTres() {
    await setMapTemporalConfig(MAPA, PATCH);
    await setMapNotes(MAPA, NOTAS);
    await setGridStyle(MAPA, GRADE);
}

/** Quantas das tres escreveram no disco. */
function escritasNoDisco() {
    return [
        disco.settings.has(`temporal_${MAPA}`),
        disco.notes.has(MAPA),
        disco.grid.has(MAPA)
    ].filter(Boolean).length;
}

/** Quantas das tres enfileiraram op. */
function opsEnfileiradas() {
    return fila.temporal.mock.calls.length
        + fila.notes.mock.calls.length
        + fila.grid.mock.calls.length;
}

/** Recusas emitidas, por nome de operacao. */
function recusas() {
    return eventos
        .filter((e) => e.type === StoreErrorEvents.STORE_OPERATION_BLOCKED)
        .map((e) => e.payload.operation);
}

beforeEach(() => {
    disco.settings.clear();
    disco.notes.clear();
    disco.grid.clear();
    fila.temporal.mockClear();
    fila.notes.mockClear();
    fila.grid.mockClear();
    eventos = [];
    barramento = { emit: (type, payload) => { eventos.push({ type, payload }); } };
    setStoreErrorEventBus(barramento);
    regime({ offline: true, remoto: false, podeEditar: true });
});

// ============================================================================
// 1. Controle positivo do mecanismo
// ============================================================================

describe('o fixture chega mesmo ao gate', () => {
    it('atlas remoto + papel de leitura NEGA UPDATE_MAP, e as outras combinacoes permitem', () => {
        regime({ offline: false, remoto: true, podeEditar: false });
        expect(checkPermission(GuardAction.UPDATE_MAP).allowed).toBe(false);

        regime({ offline: false, remoto: true, podeEditar: true });
        expect(checkPermission(GuardAction.UPDATE_MAP).allowed).toBe(true);

        // Fora do atlas remoto o papel nem e consultado: e o early-return do guard.
        regime({ offline: false, remoto: false, podeEditar: false });
        expect(checkPermission(GuardAction.UPDATE_MAP).allowed).toBe(true);

        regime({ offline: true, remoto: true, podeEditar: false });
        expect(checkPermission(GuardAction.UPDATE_MAP).allowed).toBe(true);
    });
});

// ============================================================================
// 2. Permitido: escreve E enfileira
// ============================================================================

describe('atlas remoto com permissao de escrita', () => {
    beforeEach(() => regime({ offline: false, remoto: true, podeEditar: true }));

    it('as tres persistem localmente e enfileiram a op de sync', async () => {
        await rodarAsTres();

        expect(escritasNoDisco()).toBe(3);
        expect(disco.settings.get(`temporal_${MAPA}`)).toMatchObject(PATCH);
        expect(disco.notes.get(MAPA)).toEqual(NOTAS);
        expect(disco.grid.get(MAPA)).toEqual(GRADE);

        expect(fila.temporal).toHaveBeenCalledTimes(1);
        expect(fila.notes).toHaveBeenCalledTimes(1);
        expect(fila.grid).toHaveBeenCalledTimes(1);
        expect(recusas()).toEqual([]);
    });
});

// ============================================================================
// 3. Negado: nao escreve, nao enfileira, avisa
// ============================================================================

describe('atlas remoto com permissao de leitura (o defeito)', () => {
    beforeEach(() => regime({ offline: false, remoto: true, podeEditar: false }));

    it('nenhuma das tres enfileira op — era isto que o servidor recusava com 403', async () => {
        await rodarAsTres();
        expect(opsEnfileiradas()).toBe(0);
    });

    it('nenhuma das tres escreve no disco', async () => {
        await rodarAsTres();
        expect(escritasNoDisco()).toBe(0);
    });

    it('as tres emitem STORE_OPERATION_BLOCKED, nomeando a operacao recusada', async () => {
        await rodarAsTres();

        expect(recusas()).toEqual(['setMapTemporalConfig', 'setMapNotes', 'setGridStyle']);
        for (const evento of eventos) {
            expect(evento.payload.reason).toContain('canEdit');
        }
    });

    it('a recusa nao estoura: setMapTemporalConfig devolve null e as outras undefined', async () => {
        await expect(setMapTemporalConfig(MAPA, PATCH)).resolves.toBeNull();
        await expect(setMapNotes(MAPA, NOTAS)).resolves.toBeUndefined();
        await expect(setGridStyle(MAPA, GRADE)).resolves.toBeUndefined();
    });

    it('toggleMapTemporal devolve o estado INALTERADO em vez de ler .ativo de null', async () => {
        // Estado de partida: desligado (nada no disco). A recusa nao pode inventar um "ligado".
        await expect(toggleMapTemporal(MAPA)).resolves.toBe(false);
        expect(opsEnfileiradas()).toBe(0);

        // E com a config ja ligada no disco, a recusa devolve `true`, que continua sendo o
        // estado real: o que a funcao NAO pode fazer e relatar uma troca que nao houve.
        disco.settings.set(`temporal_${MAPA}`, { ativo: true });
        await expect(toggleMapTemporal(MAPA)).resolves.toBe(true);
        expect(opsEnfileiradas()).toBe(0);
    });
});

// ============================================================================
// 4. O que a correcao NAO pode quebrar
// ============================================================================

describe('fora do atlas remoto o gate e permissivo', () => {
    it('sessao offline (visitante anonimo): as tres funcionam mesmo com store remoto', async () => {
        regime({ offline: true, remoto: true, podeEditar: false });

        await rodarAsTres();

        expect(escritasNoDisco()).toBe(3);
        expect(recusas()).toEqual([]);
    });

    it('store LOCAL com sessao viva e papel de leitura: as tres funcionam', async () => {
        // Este e o caminho do trabalho local de quem esta logado, e o do import de `.ebgeo`
        // (restauracao local). Permissao de atlas remoto nao pode alcancar nenhum dos dois.
        regime({ offline: false, remoto: false, podeEditar: false });

        await rodarAsTres();

        expect(escritasNoDisco()).toBe(3);
        expect(opsEnfileiradas()).toBe(3);
        expect(recusas()).toEqual([]);
    });

    it('store local: toggleMapTemporal continua alternando de verdade', async () => {
        regime({ offline: false, remoto: false, podeEditar: false });

        await expect(toggleMapTemporal(MAPA)).resolves.toBe(true);
        await expect(toggleMapTemporal(MAPA)).resolves.toBe(false);
    });
});
