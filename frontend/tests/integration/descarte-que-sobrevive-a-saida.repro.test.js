// Path: tests/integration/descarte-que-sobrevive-a-saida.repro.test.js

/**
 * @fileoverview A MARCA DE DESCARTE QUE SOBREVIVIA A SAIDA DA CONTA, e a abertura seguinte que ela
 * matava (2026-09-23; e a causa da falha da matriz de transicoes de 2026-09-22).
 *
 * A CADEIA, medida no navegador por `tests/e2e-ui/abertura-remota-que-falha.repro.spec.js` (caso 4):
 *
 *   1. A saida pelas paginas sem mapa (`endSession` de `atlas.html`, `admin.html`, `calibracao.html`)
 *      destroi os namespaces remotos e navega logo em seguida. `dropAtlasDatabases` apagava a copia
 *      de `localStorage` do descarte na hora, mas a remocao do ESPELHO (`write_epoch:<sufixo>`, em
 *      `ebgeo_global`) entrava numa cadeia que ninguem aguardava; o documento morria antes, e
 *      `{ discarded: true }` ficava no disco.
 *   2. Na proxima abertura do mesmo atlas, `registerRemoteAtlas` perguntava ao fence so pelo
 *      `localStorage` (limpo), deixava o atlas passar, e o `connect` restaurava o descarte pelo
 *      espelho (`reconcileDurablePointers`, dentro de `_durablePullCursor`). O fence da sessao
 *      lancava `AbortError` e a abertura falhava sem nada de errado no servidor.
 *
 * DOIS CONSERTOS, e este arquivo prende os dois: (A) `dropAtlasDatabases` aguarda a cadeia do
 * espelho; (C) `registerRemoteAtlas` reconcilia os ponteiros duraveis ANTES de perguntar ao fence,
 * de modo que um descarte restaurado passe pelo reparo que ja existia (esvaziar e reabrir). O (C)
 * cobre tambem o caso em que o `localStorage` e que se perdeu, com o espelho integro.
 *
 * CONTROLE NEGATIVO, feito ao escrever (2026-09-23): sem o `await durableMirrorSettled()` os DOIS
 * casos (A) ficam vermelhos (a leitura simples devolve `{ epoch: 1, discarded: true }`); sem a
 * reconciliacao no registro, o primeiro caso (C) fica vermelho com o `AbortError` de "As pendencias
 * desta sessao foram descartadas", e o controle dele continua verde.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================ doubles

const h = vi.hoisted(() => ({
    apiClientMock: {
        getSyncProtocol: null,
        lookupOperationReceipts: null,
        pullSync: null,
        getAtlasSettings: null,
    },
    wsClientMock: null,
    sessionContextMock: null,
    eventBusMock: { emit: () => {}, on: () => {}, off: () => {} },
}));

vi.mock('@store/sync/api-client.js', () => {
    h.apiClientMock.getSyncProtocol = vi.fn(async () => ({ writeVersions: [2], receiptLookup: true }));
    h.apiClientMock.lookupOperationReceipts = vi.fn(async () => ({ receipts: [] }));
    h.apiClientMock.pullSync = vi.fn(async () => ({ currentVersion: 0, isSnapshot: false, operations: [] }));
    h.apiClientMock.getAtlasSettings = vi.fn(async () => ({}));
    return { apiClient: h.apiClientMock, configureApiClient: vi.fn() };
});
vi.mock('@store/sync/ws-client.js', () => {
    h.wsClientMock = {
        on: vi.fn(function on() { return this; }),
        connect: vi.fn(async () => ({ sessionId: 's1', userId: 'u1', role: 'editor' })),
        disconnect: vi.fn(),
        setLastVersion: vi.fn(),
        setHaveSnapshot: vi.fn(),
        isConnected: vi.fn(() => false),
    };
    return { wsClient: h.wsClientMock };
});
vi.mock('@store/sync/session-context.js', async (importOriginal) => {
    const real = await importOriginal();
    h.sessionContextMock = {
        userId: 'u1', username: 'u1',
        setSession: vi.fn(), clearSession: vi.fn(), updateRole: vi.fn(), forgetAtlasRole: vi.fn(),
        isAuthenticated: vi.fn(() => true), isAdmin: vi.fn(() => false),
    };
    return { ...real, sessionContext: h.sessionContextMock };
});
vi.mock('@store/sync/resource-access.service.js', () => ({
    refreshVisibleResources: vi.fn(async () => true),
    clearVisibleResources: vi.fn(),
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => h.eventBusMock }));
vi.mock('@store/sync/image-sync.js', () => ({ setImageSyncAtlas: vi.fn() }));
vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

// ============================================================================ SUT

import {
    clearActiveScope, dropAtlasDatabases, durableMirrorSettled, getGlobalStore,
    remoteAtlasRegistryKey, remoteScope, writeEpochMirrorKey,
} from '../../src/js/store/atlas-namespace.js';
import { discardRemoteWrites, remoteWritesDiscarded } from '../../src/js/store/remote-write-fence.js';
import { activateRemoteAtlas } from '../../src/js/store/remote-atlas.api.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';

const storage = new Map();
const ATLAS_A = '61000000-0000-4000-8000-00000000000a';
const ATLAS_C = '61000000-0000-4000-8000-00000000000c';
const EPOCH_LOCAL = (scope) => `ebgeo_remote_write_epoch:${scope.dbSuffix}`;

beforeEach(async () => {
    vi.clearAllMocks();
    storage.clear();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key),
    });
    syncEngine._session?.close();
    syncEngine._session = null;
    syncEngine._atlasId = null;
    syncEngine._lastVersion = 0;
    for (const id of [ATLAS_A, ATLAS_C]) {
        await getGlobalStore().removeItem(writeEpochMirrorKey(remoteScope(id).dbSuffix));
        await getGlobalStore().removeItem(remoteAtlasRegistryKey(id));
    }
});

afterEach(() => {
    syncEngine._session?.close();
    clearActiveScope();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ============================================================================ (A)

describe('(A) a destruicao do namespace so volta depois de o espelho do descarte sair do disco', () => {
    it('logo depois de `await dropAtlasDatabases`, a chave `write_epoch:<sufixo>` ja nao existe', async () => {
        const scope = remoteScope(ATLAS_A);
        discardRemoteWrites(scope);
        await durableMirrorSettled();
        // Controle: o espelho foi mesmo escrito, senao o caso mediria a ausencia do que nunca houve.
        expect(await getGlobalStore().getItem(writeEpochMirrorKey(scope.dbSuffix)))
            .toEqual({ epoch: 1, discarded: true });

        await dropAtlasDatabases(scope);

        expect(storage.has(EPOCH_LOCAL(scope))).toBe(false);
        expect(await getGlobalStore().getItem(writeEpochMirrorKey(scope.dbSuffix)),
            'o espelho do descarte sobreviveu a destruicao do namespace').toBeNull();
    });

    it('com a remocao do espelho LENTA, o drop espera por ela (a janela que a navegacao fechava)', async () => {
        // A leitura simples acima depende da ordem das transacoes do IndexedDB; esta nao depende de
        // nada: a remocao demora de proposito, como demora quando o disco esta ocupado, e o drop
        // so pode voltar depois dela.
        const scope = remoteScope(ATLAS_A);
        discardRemoteWrites(scope);
        await durableMirrorSettled();
        const global = getGlobalStore();
        const original = global.removeItem.bind(global);
        let removida = false;
        global.removeItem = async (chave, ...resto) => {
            if (!String(chave).startsWith('write_epoch:')) return original(chave, ...resto);
            await new Promise((resolve) => setTimeout(resolve, 40));
            const valor = await original(chave, ...resto);
            removida = true;
            return valor;
        };
        try {
            await dropAtlasDatabases(scope);
            expect(removida, 'o drop voltou antes de o espelho do descarte ser removido').toBe(true);
        } finally {
            global.removeItem = original;
        }
    });
});

// ============================================================================ (C)

describe('(C) o registro reconcilia o espelho antes de perguntar ao fence, e a abertura chega ao socket', () => {
    /**
     * O estado que a saida interrompida deixa: o espelho diz `discarded: true`, o `localStorage` nao
     * diz nada (a copia autoritativa foi apagada com o namespace, ou o navegador a limpou).
     */
    async function espelhoDeDescarteSemCopiaLocal(scope) {
        await getGlobalStore().setItem(writeEpochMirrorKey(scope.dbSuffix), { epoch: 1, discarded: true });
        storage.delete(EPOCH_LOCAL(scope));
        expect(remoteWritesDiscarded(scope), 'controle: o fence de localStorage esta aberto').toBe(false);
    }

    it('um descarte que so existe no espelho nao derruba o `connect` seguinte', async () => {
        const scope = remoteScope(ATLAS_C);
        await espelhoDeDescarteSemCopiaLocal(scope);

        await activateRemoteAtlas(ATLAS_C);
        const erro = await syncEngine.connect(ATLAS_C).then(() => null, (e) => e);

        expect(erro, `a abertura falhou: ${erro?.name}: ${erro?.message}`).toBeNull();
        expect(h.wsClientMock.connect).toHaveBeenCalledTimes(1);
        expect(remoteWritesDiscarded(scope)).toBe(false);
        // O reparo que ja existia correu: a epoca subiu e os dois lados concordam.
        await durableMirrorSettled();
        const local = JSON.parse(storage.get(EPOCH_LOCAL(scope)));
        expect(local).toEqual({ epoch: 2, discarded: false });
        expect(await getGlobalStore().getItem(writeEpochMirrorKey(scope.dbSuffix))).toEqual(local);
    });

    it('CONTROLE: sem descarte em lugar nenhum, o mesmo caminho abre igual', async () => {
        await activateRemoteAtlas(ATLAS_C);
        const erro = await syncEngine.connect(ATLAS_C).then(() => null, (e) => e);
        expect(erro).toBeNull();
        expect(h.wsClientMock.connect).toHaveBeenCalledTimes(1);
    });
});
