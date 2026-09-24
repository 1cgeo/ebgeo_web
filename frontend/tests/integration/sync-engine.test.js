// O ARMAZENAMENTO REAL ENTRA SÓ POR CAUSA DO CURSOR DURÁVEL: o `connect` decide entre cauda e
// retrato completo perguntando se a geração ativa AINDA GUARDA aquele atlas, e essa pergunta é
// uma leitura de IndexedDB. Dublar a leitura mediria o dublê.
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * Sync Engine Tests (hermetic unit).
 *
 * The orchestrator wires together HTTP (apiClient), WebSocket (wsClient), the
 * operation queue, the remote handler, and the session context. Every one of
 * those subsystems is mocked here so we exercise ONLY the routing/orchestration
 * logic: login mirrors identity, connect pulls + wires handlers + opens the WS,
 * flush drains the queue, disconnect closes the WS, and logout tears down.
 */

// ============================================================================
// Mocks (declared before the SUT import; vi.mock is hoisted)
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Shared mock state/handles. Created via vi.hoisted so they exist before the
// hoisted vi.mock factories run.
const h = vi.hoisted(() => {
    const queueState = { ops: [], dequeued: [], issues: [] };
    return {
        queueState,
        apiClientMock: {
            getSyncProtocol: vi.fn(async () => ({ writeVersions: [2], receiptLookup: true })),
            // O registro AINDA CARREGA `org_role` de propósito: o backend legado (e um
            // token legado) continua mandando o campo, e o contrato de hoje é que ele seja
            // IGNORADO. Um dublê que já viesse sem o campo mediria a ausência dele, não a
            // indiferença a ele, e passaria verde com a contaminação de volta.
            login: vi.fn(async () => ({ id: 'user-1', org_role: 'editor' })),
            // The real endpoint answers `{ success: true }` and nothing else, whether it
            // created the account or found the username/e-mail taken (anti-enumeration).
            // A mock echoing back a user would let a caller depend on data that never
            // arrives in production.
            register: vi.fn(async () => ({ success: true })),
            logout: vi.fn(async () => {}),
            pullSync: vi.fn(async () => ({ currentVersion: 0, isSnapshot: false })),
            pushOperations: vi.fn(async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 })),
            createAtlas: vi.fn(async (p) => ({ id: 'atlas-1', ...p })),
            getAtlas: vi.fn(async (id) => ({ id })),
            setTokens: vi.fn(),
            wsUrl: vi.fn(() => 'ws://test/collab'),
        },
        configureApiClientMock: vi.fn(),
        showWarningMock: vi.fn(),
        wsClientMock: {
            _handlers: {},
            on: vi.fn(function (event, handler) { this._handlers[event] = handler; return this; }),
            connect: vi.fn(async () => ({ sessionId: 's1', userId: 'user-1', permission: 'editor', role: 'editor' })),
            disconnect: vi.fn(),
            setLastVersion: vi.fn(),
            setHaveSnapshot: vi.fn(),
            isConnected: vi.fn(() => false),
        },
        operationQueueMock: {
            getIssues: vi.fn(async () => queueState.issues.slice()),
            peek: vi.fn(async (count) => queueState.ops.slice(0, count)),
            recordIssue: vi.fn(async (operation, result) => {
                queueState.issues.push({ operation, result });
                queueState.ops = queueState.ops.filter(op => op.id !== operation.id);
            }),
            dequeue: vi.fn(async (ids) => {
                queueState.dequeued.push(...ids);
                queueState.ops = queueState.ops.filter(op => !ids.includes(op.id));
                return ids.length;
            }),
            // Required by the post-flush step `_reconcileConvergenceGuard`, which reads the
            // WHOLE remaining queue. This mock lacked it until 2026-08-13, so every flush
            // test threw `operationQueue.getAll is not a function` inside that step — and the
            // SUT swallows it in a `catch`. The suite stayed green over a branch that never
            // executed. It returns a COPY: the SUT must not be able to mutate the fixture.
            getAll: vi.fn(async () => queueState.ops.slice()),
            // A fila é POR ATLAS: `SyncSession` pede o recorte do escopo assim que existe um
            // escopo montado. Sem isto o construtor da sessão morre num TypeError, e só nos casos
            // que montam um escopo remoto de verdade (os do cursor durável abaixo).
            forScope: vi.fn(),
        },
        enableOperationLogging: vi.fn(),
        disableOperationLogging: vi.fn(),
        // `isAuthenticated` entrou junto com a soma dos recursos concedidos: o
        // `disconnect` a consulta para decidir se re-soma a concessão PESSOAL (que
        // não depende de atlas nenhum). Um mock sem ela derruba o disconnect inteiro
        // num TypeError, que é o modo de falha que um mock parcial sempre teve.
        // `updateRole` entrou com o handler de troca de dono: ele re-resolve o papel
        // LOCALMENTE a partir do frame. Sem ele no dublê, o handler morre num TypeError
        // antes de chegar à re-soma, e o caso mediria o TypeError, não a re-soma.
        sessionContextMock: {
            setSession: vi.fn(), clearSession: vi.fn(), updateRole: vi.fn(),
            isAuthenticated: vi.fn(() => false),
            // O PAPEL E DO ATLAS E SAI COM ELE: `disconnect` o esquece, para que o `owner`
            // do atlas A nao valha na janela de conexao do atlas B (2026-08-25).
            forgetAtlasRole: vi.fn(),
            // `isAdmin` e o EIXO GLOBAL, e o handler de `sharing_updated` depende dele.
            // Sem ele no duble aquele handler morre num TypeError, que e exatamente por
            // que ele passou tanto tempo sem caso nenhum.
            isAdmin: vi.fn(() => false),
        },
        applyRemoteOperation: vi.fn(async () => {}),
        applyRemoteSnapshot: vi.fn(async () => {}),
        setRemoteHandlerEventBus: vi.fn(),
        // The other half of the convergence guard the engine drives: it seeds the author's
        // own applied serverVersion from the push ack, and self-heals the pending-edit map
        // after each flush. Both were MISSING from the mock, so `recordPushAcks` and
        // `_reconcileConvergenceGuard` blew up on `undefined`.
        recordLocalAppliedVersion: vi.fn(),
        confirmEntityVersion: vi.fn(async () => true),
        applyMapCreationAck: vi.fn(async () => {}),
        reconcilePendingLocalEdits: vi.fn(async () => {}),
        syncGatewayMock: {
            setRemoteOperationHandler: vi.fn(),
            applyRemoteOperation: vi.fn(async () => {}),
        },
        eventBusMock: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        // syncResponse only arrives while connected; the engine now gates its apply on this.
        connectionStateMock: { isOnline: vi.fn(() => true) },
        // A SOMA DOS RECURSOS PRIVADOS PRECISA DE DUBLÊ, e não é conveniência.
        // Sem ele o módulo real roda contra o `apiClient` dublado (que não tem
        // `getVisibleResources`), o TypeError cai no `catch` de best-effort do próprio
        // serviço e a chamada fica INVISÍVEL: um caso que afirmasse "não chamou" passaria
        // verde com e sem a mudança, que é a cobertura vazia nomeada na constituição.
        refreshVisibleResourcesMock: vi.fn(async () => true),
        clearVisibleResourcesMock: vi.fn(),
        setImageSyncAtlasMock: vi.fn(),
    };
});

const {
    queueState,
    apiClientMock,
    configureApiClientMock,
    wsClientMock,
    operationQueueMock,
    enableOperationLogging,
    disableOperationLogging,
    sessionContextMock,
    applyRemoteOperation,
    applyRemoteSnapshot,
    setRemoteHandlerEventBus,
    recordLocalAppliedVersion,
    reconcilePendingLocalEdits,
    syncGatewayMock,
    eventBusMock,
    setImageSyncAtlasMock,
} = h;

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: h.apiClientMock,
    configureApiClient: h.configureApiClientMock,
}));

vi.mock('../../src/js/store/sync/ws-client.js', () => ({
    wsClient: h.wsClientMock,
}));

vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: h.operationQueueMock,
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    enableOperationLogging: h.enableOperationLogging,
    disableOperationLogging: h.disableOperationLogging,
}));

// Só o SINGLETON é dublê. `sessionUserInfoFromMe` vem do módulo REAL de propósito: ele é a
// forma do payload de hidratação (papel por atlas, papel global e escopo de produção), e uma
// cópia escrita aqui deixaria de acompanhar a de produção sem ficar vermelha.
vi.mock('../../src/js/store/sync/session-context.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sessionContext: h.sessionContextMock,
    };
});

// The engine imports SIX names from this module. Stubbing only three left the other three
// `undefined`, and the two code paths that use them (the push-ack version seeding and the
// post-flush reconciliation) died on a TypeError the SUT catches — silently.
// CONVERGENCE_GUARDED comes from the REAL module on purpose: it is the single source for both
// halves of the guard (here and in operation-dispatcher.js), so a hand-copied Set here would
// drift from production the next time an entity type joins it, and the drift would show up as a
// test that keeps passing.
vi.mock('../../src/js/store/sync/remote-operation-handler.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        applyRemoteOperation: h.applyRemoteOperation,
        // The frame path with the single-op contract, over the mocked single op.
        applyRemoteOperations: vi.fn(async (ops, options) => {
            for (const op of ops) {
                if (await h.applyRemoteOperation(op, options) === false) return false;
            }
            return true;
        }),
        applyRemoteSnapshot: h.applyRemoteSnapshot,
        setRemoteHandlerEventBus: h.setRemoteHandlerEventBus,
        recordLocalAppliedVersion: h.recordLocalAppliedVersion,
        // The engine resolves a push's acks together; the mock keeps the per-op record the cases read.
        resolveLocalEdits: async (entries) => {
            for (const e of entries) await h.recordLocalAppliedVersion(e.entityId, e.serverVersion, e.localOp);
        },
        confirmEntityVersion: h.confirmEntityVersion,
        applyMapCreationAck: h.applyMapCreationAck,
        reconcilePendingLocalEdits: h.reconcilePendingLocalEdits,
        CONVERGENCE_GUARDED: actual.CONVERGENCE_GUARDED,
    };
});

vi.mock('../../src/js/store/sync/sync-gateway.js', () => ({
    syncGateway: h.syncGatewayMock,
}));

vi.mock('../../src/js/store/sync/connection-state.js', () => ({
    connectionState: h.connectionStateMock,
}));

vi.mock('../../src/js/store/sync/resource-access.service.js', () => ({
    refreshVisibleResources: h.refreshVisibleResourcesMock,
    clearVisibleResources: h.clearVisibleResourcesMock,
}));

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: vi.fn(() => h.eventBusMock),
}));

// O DESTINO DAS IMAGENS é a terceira coisa que guarda "em que atlas eu estou" (as outras duas
// são `_atlasId` e `_lastVersion`), e `disconnect({ forgetAtlas: true })` tem de zerá-lo junto.
// Ele entra como dublê só para ser OBSERVÁVEL: o módulo real escreve num ponteiro de módulo que
// nenhuma asserção alcança de fora.
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    setImageSyncAtlas: h.setImageSyncAtlasMock,
}));

// The engine warns the user when the server refuses an operation per-op.
vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showWarning: h.showWarningMock,
    showToast: vi.fn(),
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInChannel: vi.fn(),
}));

// ============================================================================
// Imports (SUT after the mocks)
// ============================================================================

import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { applyRemoteOperations } from '../../src/js/store/sync/remote-operation-handler.js';
import { setTracing, clearTrace, getTrace } from '../../src/js/store/sync/diag/trace-core.js';
import { IssueClass, classifyIssue } from '../../src/js/store/sync/issue-classes.js';
// O namespace e o ponteiro de geração vêm dos módulos REAIS: o que se mede é a decisão do
// `connect` a partir do que existe em disco, e um dublê de ponteiro mediria o dublê.
import {
    activateScope, ATLAS_RECORD_KEY, clearActiveScope, durableMirrorSettled, generationMirrorKey,
    getGlobalStore, getStoreFor, remoteScope, StoreName,
} from '../../src/js/store/atlas-namespace.js';
import { writeGeneration } from '../../src/js/store/namespace-generation.js';
import { assertSnapshotCurrent } from '../../src/js/store/sync/snapshot-frontier.js';
// O barramento é dublê, mas os NOMES dos eventos vêm do módulo real: uma cópia literal
// aqui deixaria de acompanhar a de produção sem ficar vermelha.
import { EventTypes } from '../../src/js/events/event_types.js';

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    queueState.ops = [];
    queueState.dequeued = [];
    queueState.issues = [];
    syncEngine._session?.close();
    syncEngine._session = null;
    wsClientMock._handlers = {};
    // Reset orchestrator internal state between tests.
    syncEngine._atlasId = null;
    syncEngine._lastVersion = 0;
    syncEngine._handlersWired = false;
    apiClientMock.pullSync.mockReset().mockResolvedValue({ currentVersion: 0, isSnapshot: false });
    // `vi.clearAllMocks()` clears CALLS, not implementations, so a `mockRejectedValue` /
    // `mockImplementation` set by one test survives into every test that follows it. The
    // poisoned-batch describe leaves a 400-rejecting push behind, and a later test that never
    // touches `pushOperations` then silently runs the isolation path instead of a clean flush
    // — passing, but proving something else. Restore the default explicitly.
    // (`mockResolvedValueOnce` in individual tests still takes precedence over this.)
    apiClientMock.pushOperations.mockImplementation(
        async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 })
    );
    operationQueueMock.forScope.mockImplementation(() => operationQueueMock);
});

/**
 * Every inbound WS event the engine wires, ONCE per engine lifetime (`_wireWsHandlers`).
 * Compared as the list of `on` calls, not as a count: a count lets one handler wired twice
 * cancel another that went missing, and a second wiring on reconnect doubles every name.
 * 'atlasResources' entrou com o empréstimo por atlas (o frame só avisa que mudou, e o receptor
 * re-pede o próprio payload aditivo); 'credentialExpired' entrou com a reconexão que renova a
 * credencial (`decidirReconexao`, `ws-client.js`), emitido quando o token do link público venceu
 * e nada o renova. 'operationBatch' entrou com a aplicação do quadro inteiro de uma vez
 * (`applyRemoteOperations`), que escreve as criações consecutivas de um mapa numa ida só ao
 * documento.
 */
const HANDLERS_FIADOS = Object.freeze([
    'operation', 'syncResponse', 'atlasDeleted', 'atlasOwnerChanged', 'sharingUpdated',
    'atlasSettings', 'atlasResources', 'serverResync', 'credentialExpired', 'operationBatch',
    // 2026-09-24: the server closed the socket with 4003 "access revoked" (see the case below).
    'accessRevoked',
]);

/** @returns {string[]} the event names passed to `wsClient.on`, sorted, duplicates kept. */
const eventosFiados = () => wsClientMock.on.mock.calls.map(([evento]) => evento).sort();

describe('respostas de configuração atrasadas após sair do atlas', () => {
    it('não conclui connect depois de disconnect enquanto os recursos carregam', async () => {
        let entered;
        let release;
        const waiting = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        h.refreshVisibleResourcesMock.mockImplementationOnce(async () => { entered(); await gate; return true; });
        const connecting = syncEngine.connect('old-atlas').then(() => null, error => error);
        await waiting;
        syncEngine.disconnect({ forgetAtlas: true });
        release();
        expect((await connecting)?.name).toBe('AbortError');
        expect(syncEngine.atlasId).toBeNull();
    });

    it('não aplica configurações recebidas após disconnect', async () => {
        let entered;
        let release;
        const waiting = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        apiClientMock.getAtlasSettings = vi.fn(async () => { entered(); await gate; return { staleAtlas: true }; });
        try {
            const connecting = syncEngine.connect('old-atlas').then(() => null, error => error);
            await waiting;
            syncEngine.disconnect({ forgetAtlas: true });
            eventBusMock.emit.mockClear();
            release();
            expect((await connecting)?.name).toBe('AbortError');
            expect(eventBusMock.emit).not.toHaveBeenCalledWith(EventTypes.ATLAS_SETTINGS_CHANGED, { settings: { staleAtlas: true } });
        } finally { delete apiClientMock.getAtlasSettings; }
    });
});

// ============================================================================
// Tests
// ============================================================================

describe('configure', () => {
    it('forwards options to configureApiClient', () => {
        syncEngine.configure({ baseUrl: 'http://h/api/v1', fetch: globalThis.fetch });
        expect(configureApiClientMock).toHaveBeenCalledWith({
            baseUrl: 'http://h/api/v1',
            fetch: globalThis.fetch,
        });
    });
});

describe('remote protocol before direct flush', () => {
    const session = () => ({
        atlasId: '11111111-1111-4111-8111-111111111111', scope: { kind: 'remote' },
        queue: operationQueueMock, legacyReviewed: true, assertActive: vi.fn(), close: vi.fn(),
    });

    it.each([
        { writeVersions: [1], receiptLookup: true },
        { writeVersions: [2], receiptLookup: false },
        { writeVersions: '2', receiptLookup: true },
    ])('cannot send or remove work when negotiation is incompatible: %j', async protocol => {
        syncEngine._session = session();
        queueState.ops = [{ id: 'pending', protocolVersion: 2, entityType: 'map', operationType: 'create', entityId: 'map-1' }];
        apiClientMock.getSyncProtocol.mockResolvedValueOnce(protocol);
        await expect(syncEngine.flush()).rejects.toMatchObject({ status: 426, code: 'SYNC_PROTOCOL_INCOMPATIBLE' });
        expect(apiClientMock.pushOperations).not.toHaveBeenCalled();
        expect(operationQueueMock.peek).not.toHaveBeenCalled();
        expect(queueState.ops.map(op => op.id)).toEqual(['pending']);
        expect(queueState.dequeued).toEqual([]);
    });

    it('negotiates once per accepted session even when flush precedes connect', async () => {
        syncEngine._session = session();
        await syncEngine.flush();
        await syncEngine.flush();
        expect(apiClientMock.getSyncProtocol).toHaveBeenCalledOnce();
        expect(operationQueueMock.peek).toHaveBeenCalled();
    });
});

describe('login', () => {
    it('logs in and mirrors identity into the session context, com o papel de atlas em LEITOR', async () => {
        const user = await syncEngine.login({ username: 'alice', password: 'pw' });

        expect(apiClientMock.login).toHaveBeenCalledWith('alice', 'pw');
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-1',
            // O dublê responde com `org_role: 'editor'` (ver a nota no mock). Até
            // 2026-08-20 este valor virava o papel POR ATLAS aqui; hoje o login não
            // decide esse eixo e ele começa fechado. Quem o resolve é o servidor, no
            // payload de `connect` — dois casos abaixo, em `connect`, medem isso.
            role: 'viewer',
            // A SEMENTE SE DECLARA SEMENTE (2026-08-25): o VIEWER acima e o piso fechado de D7,
            // e este campo e o que permite ao cliente saber que ele ainda NAO e a resposta do
            // servidor. Sem ele, "e leitor" e "ainda nao sei" eram o mesmo valor, e a tela
            // acusava nivel insuficiente a um dono no meio do boot.
            atlasRoleResolved: false,
            globalRole: 'user',
            producerOrgId: null,
            // OS DOIS CAMPOS NOVOS (2026-08-24) vêm de `FIND_USER_BY_ID`, que passou a juntar a
            // OM PRODUTORA e não só a de lotação. Sem a vivacidade, o cliente desenhava um painel
            // inteiro que o servidor recusava com 404; sem o nome, a tela caía no UUID cru quando a
            // OM saía da lista de ativas. Ausente vale FALSO, que é a queda conservadora.
            producerOrgName: null,
            producerOrgActive: false,
            username: 'alice',
            // O registro destes casos não traz `nome` nem `nome_guerra`, então não há forma
            // militar a desenhar: nulo, e a tela cai no login. A chave viaja SEMPRE.
            displayName: null,
        });
        expect(user).toEqual({ id: 'user-1', org_role: 'editor' });
    });

    it('hidrata em viewer também quando o registro não traz campo nenhum', async () => {
        apiClientMock.login.mockResolvedValueOnce({ id: 'user-9' });
        await syncEngine.login({ username: 'bob', password: 'pw' });
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-9',
            role: 'viewer',
            // A SEMENTE SE DECLARA SEMENTE (2026-08-25): o VIEWER acima e o piso fechado de D7,
            // e este campo e o que permite ao cliente saber que ele ainda NAO e a resposta do
            // servidor. Sem ele, "e leitor" e "ainda nao sei" eram o mesmo valor, e a tela
            // acusava nivel insuficiente a um dono no meio do boot.
            atlasRoleResolved: false,
            globalRole: 'user',
            producerOrgId: null,
            // OS DOIS CAMPOS NOVOS (2026-08-24) vêm de `FIND_USER_BY_ID`, que passou a juntar a
            // OM PRODUTORA e não só a de lotação. Sem a vivacidade, o cliente desenhava um painel
            // inteiro que o servidor recusava com 404; sem o nome, a tela caía no UUID cru quando a
            // OM saía da lista de ativas. Ausente vale FALSO, que é a queda conservadora.
            producerOrgName: null,
            producerOrgActive: false,
            username: 'bob',
            // O registro destes casos não traz `nome` nem `nome_guerra`, então não há forma
            // militar a desenhar: nulo, e a tela cai no login. A chave viaja SEMPRE.
            displayName: null,
        });
    });

    // DISCRIMINAÇÃO do caso acima: o eixo GLOBAL continua chegando pelo login e não foi
    // rebaixado junto. Sem este caso, a suíte passaria verde com a hidratação inteira
    // zerada, que é o defeito oposto e igualmente ruim.
    it('forwards the global role (admin) from the login response, sem tocar no eixo por atlas', async () => {
        apiClientMock.login.mockResolvedValueOnce({ id: 'user-7', org_role: 'editor', role: 'admin' });
        await syncEngine.login({ username: 'root', password: 'pw' });
        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'user-7',
            role: 'viewer',
            // A SEMENTE SE DECLARA SEMENTE (2026-08-25): o VIEWER acima e o piso fechado de D7,
            // e este campo e o que permite ao cliente saber que ele ainda NAO e a resposta do
            // servidor. Sem ele, "e leitor" e "ainda nao sei" eram o mesmo valor, e a tela
            // acusava nivel insuficiente a um dono no meio do boot.
            atlasRoleResolved: false,
            globalRole: 'admin',
            producerOrgId: null,
            // OS DOIS CAMPOS NOVOS (2026-08-24) vêm de `FIND_USER_BY_ID`, que passou a juntar a
            // OM PRODUTORA e não só a de lotação. Sem a vivacidade, o cliente desenhava um painel
            // inteiro que o servidor recusava com 404; sem o nome, a tela caía no UUID cru quando a
            // OM saía da lista de ativas. Ausente vale FALSO, que é a queda conservadora.
            producerOrgName: null,
            producerOrgActive: false,
            username: 'root',
            // O registro destes casos não traz `nome` nem `nome_guerra`, então não há forma
            // militar a desenhar: nulo, e a tela cai no login. A chave viaja SEMPRE.
            displayName: null,
        });
    });
});

describe('register', () => {
    it('delegates to apiClient.register', async () => {
        const out = await syncEngine.register({ username: 'u', password: 'p', nome: 'N' });
        expect(apiClientMock.register).toHaveBeenCalledWith({
            username: 'u', password: 'p', nome: 'N',
        });
        expect(out).toEqual({ success: true });
    });
});

describe('connect', () => {
    it('does an initial pull, wires handlers, and opens the WS', async () => {
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { maps: {} },
            currentVersion: 7,
            isSnapshot: true,
        });

        const payload = await syncEngine.connect('atlas-1');

        // Initial pull from version 0 + snapshot applied.
        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 0, { signal: expect.any(AbortSignal) });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: {} }, syncEngine._session);
        expect(syncEngine.lastVersion).toBe(7);

        // Handler wiring (idempotent).
        expect(setRemoteHandlerEventBus).toHaveBeenCalledWith(eventBusMock);
        const inbound = syncGatewayMock.setRemoteOperationHandler.mock.calls[0][0];
        const op = { id: 'captured-session' };
        await inbound(op);
        expect(applyRemoteOperation).toHaveBeenCalledWith(op, {
            scope: syncEngine._session.scope, signal: syncEngine._session.signal, waitForDeferred: true,
        });
        expect(enableOperationLogging).toHaveBeenCalledTimes(1);
        expect(wsClientMock.on).toHaveBeenCalledWith('operation', expect.any(Function));
        expect(wsClientMock.on).toHaveBeenCalledWith('syncResponse', expect.any(Function));

        // WS opened with the pulled version, and DECLARING that the disk is complete at it: the
        // snapshot just landed, so the handshake may ask for a tail instead of another snapshot.
        expect(wsClientMock.connect).toHaveBeenCalledWith('atlas-1', { lastVersion: 7, haveSnapshot: true });
        expect(syncEngine.atlasId).toBe('atlas-1');
        expect(payload).toMatchObject({ sessionId: 's1' });
    });

    it('skips the initial pull when initialPull is false', async () => {
        await syncEngine.connect('atlas-2', { initialPull: false });
        expect(apiClientMock.pullSync).not.toHaveBeenCalled();
        // SEM PULL NÃO HÁ PROVA, e sem prova o handshake não afirma completude: o servidor tem
        // de continuar lendo o zero como "manda tudo". É o controle do caso acima.
        expect(wsClientMock.connect).toHaveBeenCalledWith('atlas-2', { lastVersion: 0, haveSnapshot: false });
    });

    it('uma cauda pedida DO ZERO não afirma completude', async () => {
        // O outro lado da mesma regra: sem cursor durável, o pedido parte de zero, e uma resposta
        // de cauda deixa no disco só o que as ops trouxeram. Afirmar completude aqui faria o
        // próximo handshake pedir cauda sobre um acervo que nunca chegou.
        apiClientMock.pullSync.mockResolvedValueOnce({ operations: [], currentVersion: 0, isSnapshot: false });

        await syncEngine.connect('atlas-3');

        expect(wsClientMock.connect).toHaveBeenCalledWith('atlas-3', { lastVersion: 0, haveSnapshot: false });
    });

    // Regression — bug C: the connect payload carries the PER-ATLAS role
    // (owner/editor/viewer, mapped by the backend from the atlas permission). The
    // engine must mirror it into the session, else a self-registered owner or a
    // write-shared collaborator stays gated as 'viewer' (where hydration starts) and
    // cannot edit the atlas. Since D7 (2026-08-20) this is the ONLY path that opens the
    // axis for a non-owner: login no longer decides it.
    it('reflects the per-atlas role from the connect payload into the session', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-7', permission: 'write', role: 'editor' });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({ userId: 'user-7', role: 'editor' });
    });

    it('promotes the atlas OWNER to the owner role on connect (não por papel nenhum do login)', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'owner-1', permission: 'owner', role: 'owner' });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({ userId: 'owner-1', role: 'owner' });
    });

    // Regression — the atlas OWNER is promoted the INSTANT the snapshot lands (its atlas.sync
    // carries ownerId), BEFORE the WS handshake. This is what makes the owner's account config
    // buttons appear immediately on an F5 reconnect instead of waiting on — or being lost to —
    // the socket handshake (which used to be the only thing that applied the role).
    it('promotes the OWNER from the snapshot (before the WS handshake) when the user owns the atlas', async () => {
        sessionContextMock.userId = 'owner-9';
        sessionContextMock.username = 'Dona';
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { atlas: { sync: { ownerId: 'owner-9' } }, maps: {} },
            currentVersion: 3,
            isSnapshot: true,
        });

        await syncEngine.connect('atlas-1');

        expect(sessionContextMock.setSession).toHaveBeenCalledWith({
            userId: 'owner-9', role: 'owner', username: 'Dona',
        });
    });

    it('does NOT promote from the snapshot when the user is not the atlas owner', async () => {
        sessionContextMock.userId = 'user-2';
        sessionContextMock.username = 'Colab';
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { atlas: { sync: { ownerId: 'someone-else' } }, maps: {} },
            currentVersion: 3,
            isSnapshot: true,
        });
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-2', permission: 'write', role: 'editor' });

        await syncEngine.connect('atlas-1');

        expect(sessionContextMock.setSession).not.toHaveBeenCalledWith(
            expect.objectContaining({ role: 'owner' })
        );
    });

    it('leaves the session untouched on connect when the payload carries no role', async () => {
        wsClientMock.connect.mockResolvedValueOnce({ sessionId: 's1', userId: 'user-1', permission: null });

        await syncEngine.connect('atlas-1', { initialPull: false });

        expect(sessionContextMock.setSession).not.toHaveBeenCalled();
    });

    it('wires WS handlers only once across reconnects', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        await syncEngine.connect('atlas-1', { initialPull: false });
        // Nine events wired exactly once in total across the two connects: a second wiring
        // would put every name in the list twice (18 calls), which is the listener leak this
        // case exists to catch.
        expect(eventosFiados()).toEqual([...HANDLERS_FIADOS].sort());
        expect(wsClientMock.on).toHaveBeenCalledTimes(HANDLERS_FIADOS.length);
        // Operation logging is now enabled per authenticated connect (not in wire-once), so two
        // connects enable it twice.
        expect(enableOperationLogging).toHaveBeenCalledTimes(2);
    });

    it('"credentialExpired" (the ninth handler) tells the person, once, without a reload', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        h.showWarningMock.mockClear();
        wsClientMock._handlers.credentialExpired({});
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
        const [frase, opcoes] = h.showWarningMock.mock.calls[0];
        // O aviso diz o que FAZER, e fica até a pessoa fechar: um toast que some sozinho some
        // enquanto ela ainda está lendo o mapa congelado.
        expect(frase).toMatch(/Recarregue a página/);
        expect(opcoes).toMatchObject({ duration: 0, closable: true });
    });

    it('on "atlas_deleted" the engine disconnects (stops chasing the dead room)', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        wsClientMock.disconnect.mockClear();
        await wsClientMock._handlers.atlasDeleted({ atlasId: 'atlas-1' });
        // disconnect() closes the socket + stops the auto-reconnect backoff.
        expect(wsClientMock.disconnect).toHaveBeenCalled();
    });

    // THE ACCESS OF THIS PERSON ENDED with the atlas open (2026-09-24). Until then the 4003 close
    // was a network drop to the client, which reconnected forever over edits that would never be
    // sent. The engine asks the server once before acting, and acts only on a 403/404.
    it('on "accessRevoked" confirmed by the server, the engine disconnects and says why', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        wsClientMock.disconnect.mockClear();
        h.eventBusMock.emit.mockClear?.();
        h.apiClientMock.getAtlas.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
        wsClientMock._handlers.accessRevoked({ code: 4003, reason: 'access revoked' });
        await vi.waitFor(() => expect(wsClientMock.disconnect).toHaveBeenCalled());
        expect(h.eventBusMock.emit).toHaveBeenCalledWith(EventTypes.ATLAS_DELETED_REMOTE,
            { atlasId: 'atlas-1', motivo: 'sem-acesso' });
    });

    it('on "accessRevoked" that the server does NOT confirm, the reconnect loop is left alone', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        wsClientMock.disconnect.mockClear();
        h.apiClientMock.getAtlas.mockResolvedValueOnce({ id: 'atlas-1' });
        wsClientMock._handlers.accessRevoked({ code: 4003, reason: 'access revoked' });
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        expect(wsClientMock.disconnect).not.toHaveBeenCalled();
    });

    it('routes inbound "operation" frames through the sync gateway', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const op = { entityType: 'feature', operationType: 'create', entityId: 'f1' };
        await wsClientMock._handlers.operation(op);
        expect(syncGatewayMock.applyRemoteOperation).toHaveBeenCalledWith(op);
    });

    it('applies a snapshot syncResponse and advances lastVersion', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        await wsClientMock._handlers.syncResponse({
            isSnapshot: true,
            snapshot: { maps: { a: 1 } },
            currentVersion: 12,
        });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: { a: 1 } }, syncEngine._session);
        expect(syncEngine.lastVersion).toBe(12);
        expect(wsClientMock.setLastVersion).toHaveBeenCalledWith(12);
    });

    it('applies ops from a non-snapshot syncResponse', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [{ entityId: 'a' }, { entityId: 'b' }];
        await wsClientMock._handlers.syncResponse({ isSnapshot: false, ops, currentVersion: 3 });
        expect(applyRemoteOperation).toHaveBeenCalledTimes(2);
        expect(syncEngine.lastVersion).toBe(3);
    });

    // A CAUDA DA RECONEXAO VAI PELO CAMINHO DO QUADRO: a importacao do colega que chega a quem
    // voltou de offline custava uma leitura e uma escrita do documento do mapa POR op.
    it('a cauda do syncResponse vai inteira por applyRemoteOperations', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        applyRemoteOperations.mockClear();
        const ops = [{ entityId: 'a' }, { entityId: 'b' }, { entityId: 'c' }];
        await wsClientMock._handlers.syncResponse({ isSnapshot: false, ops, currentVersion: 4 });
        expect(applyRemoteOperations).toHaveBeenCalledTimes(1);
        expect(applyRemoteOperations).toHaveBeenCalledWith(ops, expect.objectContaining({ waitForDeferred: true }));
        expect(syncEngine.lastVersion).toBe(4);
    });

    // F13, A METADE DO CURSOR, e a decisão está aqui de propósito, porque ela é uma EXCEÇÃO à
    // regra do arquivo. A regra é que o limite de replay só anda quando o `sync_response` foi
    // aplicado INTEIRO, para que uma escrita que falhou continue elegível a replay. Essa regra
    // pressupõe que o replay possa dar certo. Para um `entityType` que este BUILD não conhece
    // não pode: replay nenhum ensina o tipo ao cliente. Segurar o cursor congelaria a cauda
    // para sempre e custaria toda op POSTERIOR de todo tipo CONHECIDO, o que é estritamente
    // pior que perder a única op que este cliente não sabe representar (e o servidor continua
    // sendo a cópia durável: o próximo snapshot re-deriva o que aquele tipo carrega). O
    // `applyRemoteOperationInner` devolve, portanto, um valor distinto de `false`, e a cadeia
    // aqui segue e avança.
    it('uma op de tipo desconhecido na cauda NÃO segura o cursor', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        applyRemoteOperation.mockClear();
        // O que o handler real faz hoje com `map_meta`: ignora e devolve algo que não é `false`.
        // `Once`, nunca a implementação persistente: ela sobrevive ao `clearAllMocks` do
        // `beforeEach` (que limpa chamadas, não implementação) e contamina os casos seguintes.
        applyRemoteOperation.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [{ entityType: 'map_meta', entityId: 'm' }, { entityType: 'feature', entityId: 'a' }],
            currentVersion: 11,
        });

        expect(applyRemoteOperation).toHaveBeenCalledTimes(2); // a seguinte também roda
        expect(syncEngine.lastVersion).toBe(11);
    });

    // E O CONTRASTE, que é o que impede o caso acima de virar "o cursor sempre anda": uma
    // falha DE VERDADE (`false`) continua segurando o limite, porque ali o replay é a correção.
    it('mas um `false` de verdade continua segurando o cursor', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        applyRemoteOperation.mockClear();
        applyRemoteOperation.mockResolvedValueOnce(false);

        const versaoAntes = syncEngine.lastVersion;
        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [{ entityType: 'feature', entityId: 'a' }, { entityType: 'feature', entityId: 'b' }],
            currentVersion: 12,
        });

        expect(applyRemoteOperation).toHaveBeenCalledTimes(1); // para na primeira
        expect(syncEngine.lastVersion).toBe(versaoAntes);
    });

    // ========================================================================
    // Structural marker ops (backend maps.service.js MAP_MERGE_ENTITY_TYPE)
    // ========================================================================
    // A map merge moves rows in bulk over REST, so no per-entity op describes it.
    // Live peers learn of it from the `maps_merged` broadcast; a peer that was
    // OFFLINE during the merge only sees the marker op in its reconnect replay, and
    // must answer it with a snapshot. Applying the tail would leave it stale — which
    // is what happened before the marker existed, except the replay was then empty
    // and the peer believed it was up to date.

    it('a map_merge marker in the replay triggers a resync instead of a per-op apply', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pullSync.mockClear();
        applyRemoteOperation.mockClear();

        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { maps: { merged: true } },
            currentVersion: 42,
        });

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [
                { entityType: 'feature', entityId: 'f1' },
                { entityType: 'map_merge', entityId: 'dest-1', data: { destMapId: 'dest-1' } },
            ],
            currentVersion: 9,
        });

        // Snapshot from version 0 — the marker cannot be applied entity by entity.
        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 0, { signal: expect.any(AbortSignal) });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ maps: { merged: true } }, syncEngine._session);
        expect(applyRemoteOperation).not.toHaveBeenCalled();
        // The version comes from the snapshot, not from the superseded tail.
        expect(syncEngine.lastVersion).toBe(42);
    });

    it('an ordinary replay is unaffected by the marker check', async () => {
        // Guards the blast radius: the resync must fire only on the marker, not on
        // every batch, or each reconnect would drag a full snapshot.
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pullSync.mockClear();
        applyRemoteOperation.mockClear();

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [{ entityType: 'feature', entityId: 'f1' }, { entityType: 'layer', entityId: 'l1' }],
            currentVersion: 7,
        });

        expect(apiClientMock.pullSync).not.toHaveBeenCalled();
        expect(applyRemoteOperation).toHaveBeenCalledTimes(2);
        expect(syncEngine.lastVersion).toBe(7);
    });
});

// ============================================================================
// O CURSOR DURÁVEL NO BOOT (F11)
// ============================================================================
// Toda conexão pedia `pullSync(atlasId, 0)`, o servidor respondia RETRATO COMPLETO e a
// aplicação dele cunhava uma geração nova de nove bancos. O cursor que a recuperação grava era
// escrito por todo mundo e lido por quase ninguém. Aqui o escopo remoto é REAL (o ponteiro e o
// namespace vêm dos módulos de produção), porque o que se mede é a decisão tomada a partir do
// que está em disco.
describe('connect: o cursor durável decide entre cauda e retrato', () => {
    const cursorAtlas = 'cursor-atlas';
    const generation = 'g-um';
    let scope;

    const generationKey = () => `ebgeo_atlas_generation:${scope.dbSuffix}`;
    const atlasStore = () => getStoreFor(StoreName.ATLAS, { ...scope, dataGeneration: generation });

    beforeEach(async () => {
        scope = remoteScope(cursorAtlas);
        activateScope(scope);
        // Uma geração COMPLETA em disco: o ponteiro com cursor, e o acervo daquele atlas dentro
        // dela. As duas metades são necessárias, e é justamente essa a armadilha que o código
        // fecha: ponteiro sem dado é o namespace que um logout esvaziou.
        writeGeneration(scope, { active: generation, known: [generation], cursor: 12 });
        await atlasStore().setItem(ATLAS_RECORD_KEY, { id: cursorAtlas, name: 'Remoto' });
    });

    afterEach(() => {
        globalThis.localStorage.removeItem(generationKey());
        clearActiveScope();
    });

    it('a segunda conexão pede a partir do cursor e não recria a geração', async () => {
        apiClientMock.pullSync.mockResolvedValueOnce({
            operations: [{ entityType: 'feature', entityId: 'f1' }], currentVersion: 15, isSnapshot: false,
        });

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenCalledWith(cursorAtlas, 12, { signal: expect.any(AbortSignal) });
        expect(applyRemoteSnapshot).not.toHaveBeenCalled();
        expect(applyRemoteOperation).toHaveBeenCalledWith(
            { entityType: 'feature', entityId: 'f1' },
            { scope: syncEngine._session.scope, signal: syncEngine._session.signal, waitForDeferred: true },
        );
        expect(syncEngine.lastVersion).toBe(15);
        // A cauda caiu sobre uma geração COMPLETA (o cursor 12 é a prova), então o handshake pode
        // afirmar completude e pedir cauda de novo.
        expect(wsClientMock.connect).toHaveBeenCalledWith(cursorAtlas, { lastVersion: 15, haveSnapshot: true });
        // O ponteiro continua o mesmo: nenhuma geração nova nasceu deste boot.
        expect(JSON.parse(globalThis.localStorage.getItem(generationKey())).active).toBe(generation);
    });

    it('o retrato completo só quando o SERVIDOR responde com um', async () => {
        apiClientMock.pullSync.mockResolvedValueOnce({
            snapshot: { atlas: { id: cursorAtlas } }, currentVersion: 30, isSnapshot: true,
        });

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenCalledWith(cursorAtlas, 12, { signal: expect.any(AbortSignal) });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ atlas: { id: cursorAtlas } }, syncEngine._session);
        expect(syncEngine.lastVersion).toBe(30);
    });

    it('um marcador estrutural na cauda troca o pedido por um retrato do zero', async () => {
        apiClientMock.pullSync
            .mockResolvedValueOnce({ operations: [{ entityType: 'map_merge' }], currentVersion: 16, isSnapshot: false })
            .mockResolvedValueOnce({ snapshot: { atlas: { id: cursorAtlas } }, currentVersion: 17, isSnapshot: true });

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenNthCalledWith(1, cursorAtlas, 12, { signal: expect.any(AbortSignal) });
        expect(apiClientMock.pullSync).toHaveBeenNthCalledWith(2, cursorAtlas, 0, { signal: expect.any(AbortSignal) });
        expect(applyRemoteSnapshot).toHaveBeenCalledWith({ atlas: { id: cursorAtlas } }, syncEngine._session);
        // O marcador NÃO é aplicado como op: o retrato o supera.
        expect(applyRemoteOperation).not.toHaveBeenCalled();
        expect(syncEngine.lastVersion).toBe(17);
    });

    it('cursor corrompido, e sem espelho para reconstruí-lo, pede tudo', async () => {
        globalThis.localStorage.setItem(generationKey(), '{"active":"g-um","known":[],"cursor":"doze"}');
        await durableMirrorSettled();
        await getGlobalStore().removeItem(generationMirrorKey(scope.dbSuffix));

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenCalledWith(cursorAtlas, 0, { signal: expect.any(AbortSignal) });
    });

    it('ponteiro perdido com o espelho íntegro é reconstruído, e a cauda continua valendo', async () => {
        // A perda do `localStorage` com o IndexedDB de pé: sem o espelho este boot pediria tudo e
        // cunharia uma geração nova sobre nove bancos que já estavam completos.
        await durableMirrorSettled();
        globalThis.localStorage.removeItem(generationKey());

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenCalledWith(cursorAtlas, 12, { signal: expect.any(AbortSignal) });
        // O NÍVEL que o socket anunciou carimba a geração (2026-09-23): o recorte é por nível.
        expect(JSON.parse(globalThis.localStorage.getItem(generationKey()))).toEqual({
            active: generation, known: [generation], cursor: 12, nivel: 'editor',
        });
    });

    it('geração ativa SEM o acervo daquele atlas pede tudo', async () => {
        // O namespace que um logout esvaziou: o ponteiro sobrevive em localStorage e os bancos
        // não têm mais nada. Pedir cauda aqui produziria um atlas sem tudo o que veio antes do
        // cursor, sem um erro em lugar nenhum.
        await atlasStore().clear();

        await syncEngine.connect(cursorAtlas);

        expect(apiClientMock.pullSync).toHaveBeenCalledWith(cursorAtlas, 0, { signal: expect.any(AbortSignal) });
    });
});


// ============================================================================
// atlas_owner_changed: o papel E a soma dos recursos privados
// ============================================================================
// O braço D4 do empréstimo (`fn_granted_resource_ids`, no backend) pergunta pelo DONO
// do atlas: trocado o dono, o recurso que o atlas emprestava pode deixar de valer para
// TODA a sala. Antes disto ninguém re-pedia o payload aditivo, e o membro ficava com a
// camada QUEBRADA (o config ainda a lista, o servidor já recusa os bytes) até um F5.

/** Deixa o `.then` do handler (que não é aguardado por ninguém) aterrissar. */
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('atlas_owner_changed re-soma o payload aditivo', () => {
    it('re-soma pelo atlas CONECTADO e avisa a UI, sem trocar o bloco de papel', async () => {
        sessionContextMock.userId = 'user-1';
        await syncEngine.connect('atlas-1', { initialPull: false });
        // PISO: a soma do próprio connect (`_applyAtlasSettingsOverlay`) já aconteceu e
        // não pode ser confundida com a do frame. Zerado aqui, o contador volta a ser
        // uma medida do handler, e só dele.
        h.refreshVisibleResourcesMock.mockClear();
        eventBusMock.emit.mockClear();
        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledTimes(0);

        // `atlasId` do frame DIFERENTE do conectado de propósito: a re-soma é do escopo
        // em foco, e somar pelo id que veio no frame seria pedir o payload de outro atlas.
        await wsClientMock._handlers.atlasOwnerChanged({ atlasId: 'atlas-outro', newOwnerId: 'user-1' });
        await flushMicrotasks();

        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledTimes(1);
        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledWith('atlas-1');
        expect(eventBusMock.emit).toHaveBeenCalledWith(
            EventTypes.ATLAS_SETTINGS_CHANGED, { reason: 'atlas_owner' }
        );
        // DISCRIMINAÇÃO (b): somamos comportamento, não trocamos um pelo outro. O bloco
        // de papel do mesmo handler continua rodando e o evento antigo continua saindo.
        expect(sessionContextMock.updateRole).toHaveBeenCalledWith('owner');
        expect(eventBusMock.emit).toHaveBeenCalledWith(
            EventTypes.ATLAS_OWNER_CHANGED, { atlasId: 'atlas-outro', newOwnerId: 'user-1' }
        );
    });

    it('DISCRIMINAÇÃO: o frame de settings continua sem re-somar nada', async () => {
        sessionContextMock.userId = 'user-1';
        await syncEngine.connect('atlas-1', { initialPull: false });
        h.refreshVisibleResourcesMock.mockClear();

        // O vizinho mais próximo: mesmo método de fiação, mesmo guard de `isOnline`, e
        // ele NÃO deve re-somar. Sem esta metade, "a re-soma acontece" seria satisfeito
        // por uma re-soma pendurada em todo frame que passa.
        await wsClientMock._handlers.atlasSettings({ settings: {} });
        await flushMicrotasks();

        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledTimes(0);
    });

    it('DISCRIMINAÇÃO: nenhum handler novo foi fiado para a re-soma (a lista é a mesma)', async () => {
        // A re-soma mora DENTRO do handler de 'atlasOwnerChanged', que continua sendo um só: a
        // lista fiada é exatamente a da fiação geral, sem evento a mais para recursos.
        await syncEngine.connect('atlas-1', { initialPull: false });
        expect(eventosFiados()).toEqual([...HANDLERS_FIADOS].sort());
        expect(eventosFiados().filter((evento) => evento === 'atlasOwnerChanged')).toHaveLength(1);
    });
});

// ============================================================================
// `sharing_updated`: as DUAS guardas que so existem deste lado
// ============================================================================
//
// A ponte entre os dois eixos e `toFrontendRole` (`backend/src/utils/roles.js`), e ela
// dobra o `admin` GLOBAL para o topo da escada por atlas SO quando recebe o segundo
// argumento. `sharing.controller.js` a chama com UM argumento nos dois emissores de frame
// por pessoa, entao a frame descreve o degrau do SHARE e nada mais. O comentario de la diz
// que "a global admin keeps full access and ignores this on the client", isto e, delega a
// correcao inteira para ca.
//
// Sao DUAS guardas, e nenhuma tinha caso ate esta revisao. Sem a de identidade, a frame que
// nomeia OUTRA pessoa re-gateia a minha tela; sem a de papel global, um administrador do
// sistema que tambem tenha share explicito de `read` se auto-rebaixa a Visualizador no
// proprio atlas que ele administra, e so um F5 desfaz, porque o handshake resolve `admin`
// de novo. O caminho realista nao e nem o share nominal: e o administrador participar de um
// grupo de acesso cujo vinculo com o atlas muda, porque ali o servidor recalcula e emite uma
// frame por membro CONECTADO (`broadcastEffectiveForMembers`).
describe('sharing_updated: o cliente e o unico que sabe do papel global', () => {
    it('aplica o papel da frame quando ela e minha e eu nao sou administrador', async () => {
        sessionContextMock.userId = 'user-1';
        sessionContextMock.isAdmin.mockReturnValue(false);
        await syncEngine.connect('atlas-1', { initialPull: false });
        sessionContextMock.updateRole.mockClear();

        await wsClientMock._handlers.sharingUpdated({
            action: 'user_updated', userId: 'user-1', permission: 'read', role: 'viewer',
        });

        expect(sessionContextMock.updateRole).toHaveBeenCalledWith('viewer');
    });

    it('IGNORA a frame que nomeia outra pessoa', async () => {
        sessionContextMock.userId = 'user-1';
        sessionContextMock.isAdmin.mockReturnValue(false);
        await syncEngine.connect('atlas-1', { initialPull: false });
        sessionContextMock.updateRole.mockClear();

        await wsClientMock._handlers.sharingUpdated({
            action: 'user_updated', userId: 'user-2', permission: 'read', role: 'viewer',
        });

        expect(sessionContextMock.updateRole).not.toHaveBeenCalled();
    });

    it('IGNORA a propria frame quando o papel GLOBAL e administrador', async () => {
        // O caso que o servidor nao consegue evitar: `toFrontendRole(permission)` sem o
        // papel global rotula o administrador pelo degrau do share dele.
        sessionContextMock.userId = 'user-1';
        sessionContextMock.isAdmin.mockReturnValue(true);
        await syncEngine.connect('atlas-1', { initialPull: false });
        sessionContextMock.updateRole.mockClear();

        await wsClientMock._handlers.sharingUpdated({
            action: 'user_updated', userId: 'user-1', permission: 'read', role: 'viewer',
        });

        expect(sessionContextMock.updateRole).not.toHaveBeenCalled();
    });

    it('a REMOCAO nao re-gateia por papel: `user_removed` nao carrega `role`', async () => {
        // A frame de remocao nao tem campo `role`, e aplicar `undefined` apagaria o papel
        // em vez de rebaixa-lo. Quem derruba a sessao de fato e o sweep de
        // `reconcileAuthorization` no servidor, com close 4003.
        sessionContextMock.userId = 'user-1';
        sessionContextMock.isAdmin.mockReturnValue(false);
        await syncEngine.connect('atlas-1', { initialPull: false });
        sessionContextMock.updateRole.mockClear();

        await wsClientMock._handlers.sharingUpdated({ action: 'user_removed', userId: 'user-1' });

        expect(sessionContextMock.updateRole).not.toHaveBeenCalled();
    });

    it('frame que chega DEPOIS do disconnect não re-soma, e o par sim/não é o que prova o guard', async () => {
        sessionContextMock.userId = 'user-1';
        await syncEngine.connect('atlas-1', { initialPull: false });
        h.refreshVisibleResourcesMock.mockClear();

        // Metade OFFLINE: a janela disconnect -> revert, onde re-somar mexeria num
        // baseline que já foi restaurado.
        h.connectionStateMock.isOnline.mockReturnValue(false);
        await wsClientMock._handlers.atlasOwnerChanged({ atlasId: 'atlas-1', newOwnerId: 'user-9' });
        await flushMicrotasks();
        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledTimes(0);

        // Metade ONLINE, no MESMO caso: sem ela, um handler que nunca chamasse nada
        // passaria verde na metade de cima.
        h.connectionStateMock.isOnline.mockReturnValue(true);
        await wsClientMock._handlers.atlasOwnerChanged({ atlasId: 'atlas-1', newOwnerId: 'user-9' });
        await flushMicrotasks();
        expect(h.refreshVisibleResourcesMock).toHaveBeenCalledTimes(1);
    });
});

// ============================================================================
// Per-operation policy denials (backend sync.service.js operationDenialReason)
// ============================================================================
// The server acks a refused operation with 200 + `rejected` + `reason` so ONE denial
// no longer rolls back its siblings and no longer freezes the outbound queue forever.
// Dequeuing it is correct — retrying a policy denial can never succeed — but doing so
// SILENTLY is its own defect: the entity is already gone from the local store, the
// server kept it, and the next snapshot brings it back with no explanation. The user
// watches their action undo itself minutes later. The server sends `reason` precisely
// so the client can say why.

describe('rejected operations are surfaced to the user', () => {
    it('warns with the server reason when an op is refused', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        // No entityType/entityId on purpose: the convergence-guard bookkeeping is
        // exercised in its own describe below. This test is about whether the refusal
        // reaches the user.
        queueState.ops = [{ id: 'op-1' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [{
                operationId: 'op-1',
                success: false,
                rejected: true,
                reason: 'Apenas o dono ou um co-Gestor do atlas pode excluir um mapa',
            }],
            serverVersion: 5,
        });

        await syncEngine.flush();

        expect(h.showWarningMock).toHaveBeenCalledWith(
            'Apenas o dono ou um co-Gestor do atlas pode excluir um mapa'
        );
        // Still dequeued: a policy denial must not be retried forever.
        expect(queueState.issues.map(issue => issue.operation.id)).toContain('op-1');
        expect(queueState.dequeued).not.toContain('op-1');
    });

    // O CONFLITO CHEGA PELO MESMO CANAL DA RECUSA, e é por isso que ele precisa de classe. Até o
    // servidor ganhar a revisão por entidade (2026-09-13) só a feição podia produzir um; agora
    // qualquer entidade pode, e um problema que diz apenas "recusado" manda a pessoa procurar uma
    // permissão que ela tem, em vez de mostrar que o dado mudou embaixo dela.
    it('um conflito de QUALQUER entidade vira problema durável com classe própria', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-conflito', entityType: 'layer', entityId: 'l1', mapId: 'm1' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [{
                operationId: 'op-conflito',
                success: false,
                rejected: true,
                status: 'conflict',
                reason: 'Os mesmos campos foram alterados no servidor.',
                conflict: {
                    reason: 'Os mesmos campos foram alterados no servidor.',
                    fields: ['nome'], entityVersion: 8, deleted: false, serverData: null,
                },
            }],
            serverVersion: 9,
        });

        await syncEngine.flush();

        const [problema] = queueState.issues;
        expect(problema.operation.id).toBe('op-conflito');
        expect(classifyIssue(problema.result)).toBe(IssueClass.CONFLITO);
        // Os campos em disputa e a revisão do servidor sobrevivem ao F5 junto com o envelope: são
        // o que uma reaplicação deliberada precisa para nascer com base nova.
        expect(problema.result.conflict.fields).toEqual(['nome']);
        expect(problema.result.conflict.entityVersion).toBe(8);
        // E ela NÃO sai da fila: o trabalho continua guardado até alguém decidir.
        expect(queueState.dequeued).not.toContain('op-conflito');
    });

    it('DISCRIMINAÇÃO: a recusa de política continua sendo `recusa`, não conflito', () => {
        // Sem este par, "classifica como conflito" passaria verde com uma função que devolve
        // `conflito` para tudo.
        expect(classifyIssue({ rejected: true, reason: 'Apenas o dono pode excluir um mapa' }))
            .toBe(IssueClass.RECUSA);
        expect(classifyIssue({ rejected: true, status: 'review', code: 'SYNC_PROTOCOL_REVIEW' }))
            .toBe(IssueClass.REVISAO);
        // Recibo de um servidor anterior ao campo `status`: o objeto `conflict` ainda decide.
        expect(classifyIssue({ rejected: true, conflict: { fields: ['*'] } })).toBe(IssueClass.CONFLITO);
    });

    it('does not warn when everything was accepted', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: true },
                { operationId: 'op-2', success: true },
            ],
            serverVersion: 6,
        });

        await syncEngine.flush();
        expect(h.showWarningMock).not.toHaveBeenCalled();
    });

    it('collapses repeated reasons into a single warning', async () => {
        // A batch can carry several denials with the same cause; N identical toasts
        // is noise, not information.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: false, rejected: true, reason: 'mesma razão' },
                { operationId: 'op-2', success: false, rejected: true, reason: 'mesma razão' },
                { operationId: 'op-3', success: true },
            ],
            serverVersion: 7,
        });

        await syncEngine.flush();
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    });
});

describe('flush', () => {
    it('an accepted receipt fences older snapshots even after its queue entry is removed', async () => {
        const scope = remoteScope('receipt-frontier');
        activateScope(scope);
        try {
            await syncEngine.connect(scope.atlasId, { initialPull: false });
            queueState.ops = [{ id: 'committed-map', entityType: 'map', entityId: 'm1' }];
            apiClientMock.pushOperations.mockResolvedValueOnce({ results: [{
                operationId: 'committed-map', success: true, serverVersion: 77,
            }] });
            await syncEngine.flush();
            expect(queueState.ops).toEqual([]);
            expect(() => assertSnapshotCurrent(76, scope)).toThrow();
            expect(() => assertSnapshotCurrent(77, scope)).not.toThrow();
            expect(() => assertSnapshotCurrent(0, remoteScope('other-mount'))).not.toThrow();
        } finally {
            syncEngine.disconnect();
            clearActiveScope();
        }
    });

    it('stops an ACK loop when the atlas changes during revision confirmation', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [1, 2].map(n => ({ id: `late-${n}`, entityType: 'feature', entityId: `f${n}` }));
        queueState.ops = ops.slice();
        apiClientMock.pushOperations.mockResolvedValueOnce({ results: ops.map(op => ({
            operationId: op.id, success: true, entityVersion: 7, currentVersion: 7,
        })) });
        h.confirmEntityVersion.mockImplementationOnce(async () => {
            syncEngine.disconnect();
            await syncEngine.connect('atlas-2', { initialPull: false });
        });
        await expect(syncEngine.flush()).rejects.toMatchObject({ name: 'AbortError' });
        expect(h.confirmEntityVersion).toHaveBeenCalledTimes(1);
        expect(recordLocalAppliedVersion).not.toHaveBeenCalled();
        expect(queueState.dequeued).toEqual([]);
    });

    it('drains the queue in batches and dequeues accepted ops', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' },
        ];

        const result = await syncEngine.flush();

        expect(apiClientMock.pushOperations).toHaveBeenCalledWith(
            'atlas-1',
            [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }],
            { signal: expect.any(AbortSignal) },
        );
        expect(operationQueueMock.dequeue).toHaveBeenCalledWith(['op-1', 'op-2', 'op-3']);
        expect(queueState.ops).toHaveLength(0);
        expect(result).toEqual({ pushed: 3 });
    });

    it('returns pushed:0 and pushes nothing when the queue is empty', async () => {
        const result = await syncEngine.flush();
        expect(apiClientMock.pushOperations).not.toHaveBeenCalled();
        expect(result).toEqual({ pushed: 0 });
    });

    // O dequeue era do LOTE: bastava o push resolver para as três saírem da fila, tendo o
    // servidor falado sobre as três ou sobre uma. Uma op que ele não menciona não foi
    // aplicada e não tem versão; tirá-la da fila é como uma feição some de uma máquina e
    // não aparece em nenhuma outra.
    it('desenfileira SÓ as ops que o servidor confirmou, e mantém as demais', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];

        apiClientMock.pushOperations
            // O servidor fala sobre op-1 e op-3; op-2 ele ignorou.
            .mockResolvedValueOnce({
                results: [
                    { operationId: 'op-1', success: true, currentVersion: 9 },
                    { operationId: 'op-3', success: true, currentVersion: 9 },
                ],
                serverVersion: 9,
            })
            // A op não confirmada é RETENTADA no mesmo laço; aqui a rede cai, e é isso que
            // deixa o estado final observável.
            .mockRejectedValueOnce(httpError(503));

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(queueState.dequeued).toEqual(['op-1', 'op-3']);
        expect(queueState.ops.map((o) => o.id)).toEqual(['op-2']);
    });

    /**
     * RESPOSTA PERDIDA NÃO É ROLLBACK REMOTO (item 5 do bloco B7).
     *
     * Prazo estourado e requisição abortada dizem a MESMA coisa: não se sabe o que o servidor fez.
     * O envelope tem de continuar na fila, com o MESMO `op.id`, porque é esse id que torna o
     * reenvio idempotente do outro lado; tratá-lo como recusa inventaria um rollback que ninguém
     * prometeu, e cunhar um id novo seria pedir ao servidor para aplicar duas vezes.
     */
    it.each([
        ['prazo estourado', Object.assign(new Error('Tempo de espera esgotado.'), { code: 'REQUEST_TIMEOUT' })],
        ['requisição abortada', Object.assign(new Error('Request cancelled'), { name: 'AbortError' })],
    ])('%s deixa a op na fila, e o reenvio usa o MESMO envelope', async (_rotulo, erro) => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const envelope = { id: 'op-1', entityId: 'feicao-1', lamportTimestamp: 7 };
        queueState.ops = [envelope];
        apiClientMock.pushOperations.mockRejectedValueOnce(erro);

        await expect(syncEngine.flush()).rejects.toBe(erro);

        // NADA saiu da fila, e nenhum problema foi registrado: não houve recusa, houve silêncio.
        expect(queueState.dequeued).toEqual([]);
        expect(queueState.issues).toEqual([]);
        expect(queueState.ops).toEqual([envelope]);

        // O REENVIO É O MESMO ENVELOPE, id inclusive (o dublê volta ao ack padrão na segunda vez).
        await syncEngine.flush();
        expect(apiClientMock.pushOperations.mock.calls[1][1]).toEqual([envelope]);
        expect(apiClientMock.pushOperations.mock.calls[1][1][0].id).toBe('op-1');
        expect(queueState.dequeued).toEqual(['op-1']);
    });

    it('falha ALTO quando o servidor não confirma nenhuma op (em vez de girar em vazio)', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
        apiClientMock.pushOperations.mockResolvedValue({
            results: [{ operationId: 'de-outro-cliente', success: true }],
            serverVersion: 9,
        });

        await expect(syncEngine.flush()).rejects.toThrow(/não confirmou nenhuma/);
        // Nada perdido: o trabalho continua na fila, e o `sync-flush` conta a falha e avisa.
        expect(queueState.dequeued).toEqual([]);
        expect(queueState.ops).toHaveLength(2);
    });
});

// ============================================================================
// Rede de segurança contra lote envenenado
// ============================================================================
// O servidor recusa violação de integridade POR OPERAÇÃO (200 + `rejected`), então
// este caminho só existe para a recusa permanente que a classificação de lá não cobre.
// Sem ele, o lote volta idêntico para a fila e é reenviado a cada 1,5 s para sempre: o
// sync do usuário para, em silêncio, e nada aparece na UI.
//
// A op ofensora é achada POR CONSTRUÇÃO — o lote encolhe para UMA op —, nunca por um id
// que o servidor mande. É isso que garante que nenhuma op boa seja descartada por
// engano: irmã só sai da fila quando o servidor a aceita.

/** Erro de push com status HTTP, como o ApiError real. */
function httpError(status) {
    const err = new Error(`HTTP ${status}`);
    err.status = status;
    return err;
}

describe('lote envenenado: isolamento e descarte da op ofensora', () => {
    beforeEach(() => {
        // Sem `results`, `recordPushAcks` cai no fallback por índice e nada é recusado.
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true })), serverVersion: 1 }));
    });

    it('encolhe o lote, descarta SÓ a op recusada com 400 e drena o resto', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-boa-1' }, { id: 'op-ruim' }, { id: 'op-boa-2' }];

        // O 400 acompanha a op ofensora, esteja ela em lote grande ou sozinha.
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some((o) => o.id === 'op-ruim')) throw httpError(400);
            return { results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 };
        });

        const result = await syncEngine.flush();

        // As duas boas foram ACEITAS pelo servidor antes de sair da fila; a ruim saiu
        // por ter sido recusada sozinha.
        expect(queueState.dequeued).toEqual(['op-boa-1', 'op-boa-2']);
        expect(queueState.issues.map(issue => issue.operation.id)).toEqual(['op-ruim']);
        expect(queueState.ops).toHaveLength(0);
        expect(result).toEqual({ pushed: 2 });

        // Enquanto isola, o lote é de 1 — reverter para 100 a cada sucesso custaria um
        // round-trip perdido por op boa que precede a ofensora.
        const tamanhos = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length);
        expect(tamanhos).toEqual([3, 1, 1, 1]);

        // Descarte silencioso é o outro defeito: o usuário precisa saber.
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    });

    it.each([401, 403, 409, 429, 500, 503])(
        'NÃO descarta nada quando o servidor responde %i (pode dar certo depois)',
        async (status) => {
            await syncEngine.connect('atlas-1', { initialPull: false });
            queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }];
            apiClientMock.pushOperations.mockRejectedValue(httpError(status));

            await expect(syncEngine.flush()).rejects.toThrow();
            expect(queueState.dequeued).toEqual([]);
            expect(queueState.ops).toHaveLength(2);
            expect(h.showWarningMock).not.toHaveBeenCalled();
        }
    );

    // 404/410 é classe TERMINAL e DISTINTA: o atlas sumiu do servidor. Isolar op a op
    // contra um endereço que não existe é um round-trip por op, para sempre; e descartar
    // seria jogar fora o trabalho que o resgate ainda pode salvar. Então: nada sai da fila,
    // o lote NÃO encolhe, e o erro sobe para o `sync-flush` classificar e avisar.
    it.each([404, 410])('atlas ausente (%i): não isola, não descarta, e diz o que houve', async (status) => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];
        apiClientMock.pushOperations.mockRejectedValue(httpError(status));

        setTracing(true);
        clearTrace();
        try {
            await expect(syncEngine.flush()).rejects.toThrow();
        } finally {
            setTracing(false);
        }

        expect(queueState.dequeued).toEqual([]);
        expect(queueState.ops).toHaveLength(3);
        // UMA tentativa, com o lote inteiro: se o modo de isolamento tivesse engatado,
        // haveria uma segunda chamada com lote de tamanho 1.
        const tamanhos = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length);
        expect(tamanhos).toEqual([3]);
        expect(h.showWarningMock).not.toHaveBeenCalled();

        // A classe é NOMEADA no ledger. Sem isto, "o atlas sumiu" e "a rede caiu" são o
        // mesmo vermelho, que é a leitura errada que travava a fila em silêncio.
        const motivos = getTrace((s) => s.stage === 'flush.push').map((s) => s.reason);
        expect(motivos).toContain('atlas_gone');
    });

    // 413 É FUNÇÃO DO TAMANHO DOS BYTES, e o limite do corpo do `/sync` é fixo (10 MB no
    // `express.json` do backend, mais o `client_max_body_size` de cada proxy do caminho). Fora
    // da lista de recusas permanentes ele caía no ramo transitório: o MESMO lote era reenviado
    // para sempre (com recuo até 60 s), a fila inteira da pessoa parava atrás dele, e o aviso
    // dizia que era a conexão. Um lote grande (importar um arquivo vetorial detalhado) é o
    // caminho comum até ele.
    it('413 pelo TAMANHO DO LOTE: encolhe e drena tudo, sem descartar nada', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }];
        // Cada op cabe sozinha; só a soma passa do limite.
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.length > 1) throw httpError(413);
            return { results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 };
        });

        const result = await syncEngine.flush();

        expect(queueState.dequeued).toEqual(['op-1', 'op-2', 'op-3']);
        expect(queueState.issues).toEqual([]);
        expect(result).toEqual({ pushed: 3 });
    });

    // O 413 PELA SOMA NÃO PODE ISOLAR, e isolar era o que o primeiro conserto fazia: o recorte
    // virava 1 até o fim da descarga, 25 pushes onde cabiam 4. O recorte cai pela METADE até
    // caber, e fica ali.
    it('413 pela SOMA: o recorte cai à metade até caber, e não isola op a op', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = Array.from({ length: 25 }, (_, i) => ({ id: `op-${i}` }));
        // Cabem até 6 ops por corpo.
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.length > 6) throw httpError(413);
            return { results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 };
        });

        const result = await syncEngine.flush();

        const tamanhos = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length);
        expect(tamanhos).toEqual([25, 12, 6, 6, 6, 6, 1]);
        expect(queueState.issues).toEqual([]);
        expect(result).toEqual({ pushed: 25 });
        expect(h.showWarningMock).not.toHaveBeenCalled();
    });

    it('413 de UMA op sozinha: ela vai para as pendências e as irmãs seguem', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-boa-1' }, { id: 'op-enorme' }, { id: 'op-boa-2' }];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some((o) => o.id === 'op-enorme')) throw httpError(413);
            return { results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 };
        });

        const result = await syncEngine.flush();

        expect(queueState.dequeued).toEqual(['op-boa-1', 'op-boa-2']);
        expect(queueState.issues.map(issue => issue.operation.id)).toEqual(['op-enorme']);
        expect(queueState.issues[0].result.status).toBe(413);
        expect(result).toEqual({ pushed: 2 });
        // O MOTIVO GUARDADO É A FRASE DA CASA, e não o `error.message` cru: o painel de
        // pendências o mostra como está, e o cru é "request entity too large" (Express) ou
        // "HTTP 413" (proxy com corpo HTML). A frase diz o que resolve, porque reenviar os
        // mesmos bytes recebe o mesmo 413.
        const motivo = queueState.issues[0].result.reason;
        expect(motivo).toMatch(/grande demais/);
        expect(motivo).toMatch(/partes menores/);
        expect(motivo).not.toMatch(/HTTP|entity|413/);
        expect(h.showWarningMock).toHaveBeenCalledTimes(1);
        expect(h.showWarningMock.mock.calls[0][0]).toBe(motivo);
    });

    it('não gira em vazio quando a fila não avança (dequeue removeu 0)', async () => {
        // Se o descarte não remover nada, repetir o mesmo peek é laço infinito. O erro
        // sobe — fila parada, que é recuperável, nunca um giro sem fim.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-unica' }];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true })), serverVersion: 1 }));
        operationQueueMock.dequeue.mockResolvedValueOnce(0);

        await expect(syncEngine.flush()).rejects.toThrow();
        expect(queueState.ops).toHaveLength(1);
    });
});

// ============================================================================
// Convergence guard: the two halves the engine drives
// ============================================================================
// The author filters its OWN WebSocket echo, so the push ack is the only place it can
// learn the server arrival order of its own op — and a local edit stays "pending" (which
// DEFERS every inbound op for that entity) until something resolves it. The engine owns
// both halves: `recordPushAcks` seeds the version per acked op, and `_reconcileConvergenceGuard`
// clears whatever leaked, comparing the pending set against what is STILL queued.
//
// Neither half ran under test until 2026-08-13: the queue mock had no `getAll` and the
// handler mock had neither function, so `_reconcileConvergenceGuard` threw a TypeError that
// the SUT's own `catch` swallowed. Thirty-five tests were green over a step that never
// executed. These tests exist so that stays visible: if the reconciliation is dropped, or is
// fed the wrong set, they go red instead of quietly printing to a console nobody reads.

describe('post-flush convergence-guard reconciliation', () => {
    it('does not reconcile a new mount against the previous mount queue', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        operationQueueMock.getAll.mockImplementationOnce(async () => {
            syncEngine.disconnect();
            await syncEngine.connect('atlas-2', { initialPull: false });
            return [];
        });
        await syncEngine.reconcileConvergenceGuard();
        expect(reconcilePendingLocalEdits).not.toHaveBeenCalled();
    });

    it('reconciles with an EMPTY set after the queue drains completely', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'feature', entityId: 'f2' },
        ];
        queueState.ops = [...ops];

        const result = await syncEngine.flush();

        // Pinned so this case cannot silently degrade into the ISOLATION path (batch of 1,
        // op discarded) and still assert an empty set for the wrong reason: mock
        // implementations leak between tests here, and the poisoned-batch describe above
        // leaves a rejecting `pushOperations` behind.
        expect(result).toEqual({ pushed: 2 });
        expect(apiClientMock.pushOperations).toHaveBeenCalledTimes(1);

        // Everything was acked and dequeued, so NO local edit is still pending: both
        // entities must be released. Passing the ids that were just pushed (instead of the
        // ids that remain) would leave f1/f2 deferred forever — inbound ops for them would
        // pile up unapplied and the peers would silently diverge.
        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        const [remaining] = reconcilePendingLocalEdits.mock.calls[0];
        expect(remaining).toBeInstanceOf(Set);
        expect([...remaining]).toEqual([]);
    });

    it('reconciles with the ids STILL queued when the push fails transiently', async () => {
        // A 503 dequeues nothing, so both edits are legitimately still un-acked and must
        // STAY pending. Reconciling with an empty set here would release a pending edit
        // whose op never reached the server — exactly the window the guard exists to cover.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'layer', entityId: 'l1' },
        ];
        apiClientMock.pushOperations.mockRejectedValue(httpError(503));

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        const [remaining] = reconcilePendingLocalEdits.mock.calls[0];
        expect([...remaining].sort()).toEqual(['f1', 'l1']);
    });

    it('reconciles once even when the flush isolates and discards a poisoned op', async () => {
        // The isolation loop re-peeks several times; the reconciliation is a POST-drain step
        // and must not fire per batch (each call replays deferred ops, so N calls would be N
        // replays of the same backlog).
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [
            { id: 'op-boa', entityType: 'feature', entityId: 'f1' },
            { id: 'op-ruim', entityType: 'feature', entityId: 'f2' },
        ];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some((o) => o.id === 'op-ruim')) throw httpError(400);
            return { results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 1 })), serverVersion: 1 };
        });

        await syncEngine.flush();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        expect([...reconcilePendingLocalEdits.mock.calls[0][0]]).toEqual([]);
    });

    it('reconciles BEFORE re-throwing when the queue refuses to advance', async () => {
        // The stalled-queue escape hatch (dequeue removed 0) throws to avoid an infinite
        // loop. Throwing without reconciling would strand the pending edits of every op it
        // did manage to push earlier in the same flush.
        await syncEngine.connect('atlas-1', { initialPull: false });
        queueState.ops = [{ id: 'op-unica', entityType: 'feature', entityId: 'f9' }];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => ({ results: ops.map(op => ({ operationId: op.id, success: true })), serverVersion: 1 }));
        operationQueueMock.dequeue.mockResolvedValueOnce(0);

        await expect(syncEngine.flush()).rejects.toThrow();

        expect(reconcilePendingLocalEdits).toHaveBeenCalledTimes(1);
        expect([...reconcilePendingLocalEdits.mock.calls[0][0]]).toEqual(['f9']);
    });

    it('seeds the applied serverVersion ONLY for convergence-guarded entity types', async () => {
        // The seed is what lets a later concurrent op from a peer lose to the author's newer
        // value (LWW by server arrival). Seeding an UNGUARDED type would be worse than
        // useless: nothing reads it, and the map grows per op forever.
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'map', entityId: 'm1' },        // not guarded
            { id: 'op-3', entityType: 'briefing', entityId: 'b1' },   // guarded since 2026-07-25
            { id: 'op-4', entityType: 'feature' },                    // no entityId → nothing to key on
        ];
        queueState.ops = [...ops];
        apiClientMock.pushOperations.mockResolvedValueOnce({ results: ops.map(op => ({ operationId: op.id, success: true, currentVersion: 11 })), serverVersion: 11 });

        await syncEngine.flush();

        // A OP VAI JUNTO, e nao e detalhe: o ack e o unico instante em que o autor descobre que
        // VENCEU, e sem o payload ele nao consegue desfazer a escrita que a op mais velha de um
        // par ja fez sobre o valor dele (`resolveLocalEdit`, remote-operation-handler.js).
        expect(recordLocalAppliedVersion.mock.calls).toEqual([
            ['f1', 11, ops[0]],
            ['b1', 11, ops[2]],
        ]);
    });

    it('prefers the per-op version from the ack over the batch serverVersion', async () => {
        // Two ops in one batch land at DIFFERENT server versions; collapsing both onto the
        // batch-level number would record an arrival order the server never assigned.
        await syncEngine.connect('atlas-1', { initialPull: false });
        const ops = [
            { id: 'op-1', entityType: 'feature', entityId: 'f1' },
            { id: 'op-2', entityType: 'feature', entityId: 'f2' },
        ];
        queueState.ops = [...ops];
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'op-1', success: true, currentVersion: 20 },
                { operationId: 'op-2', success: true, currentVersion: 21 },
            ],
            serverVersion: 21,
        });

        await syncEngine.flush();

        expect(recordLocalAppliedVersion.mock.calls).toEqual([['f1', 20, ops[0]], ['f2', 21, ops[1]]]);
    });
});

describe('pull', () => {
    it('applies missed operations and advances lastVersion', async () => {
        syncEngine._atlasId = 'atlas-1';
        syncEngine._lastVersion = 5;
        apiClientMock.pullSync.mockResolvedValueOnce({
            operations: [{ entityId: 'x' }],
            currentVersion: 9,
            isSnapshot: false,
        });

        await syncEngine.pull();

        expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 5, { signal: syncEngine._session.signal });
        expect(applyRemoteOperation).toHaveBeenCalledWith({ entityId: 'x' }, syncEngine._session);
        expect(syncEngine.lastVersion).toBe(9);
    });
});

// ============================================================================
// Lote lógico: o envio leva o gesto inteiro, e a recusa alcança todos os membros
// ============================================================================
// O contrato do servidor (bloco B6a, `docs/wiki/lote-logico-de-gesto.md`): as
// operações que compartilham um `batchId` e chegam no MESMO push são aplicadas ou recusadas
// inteiras, num savepoint só, e todas voltam com o mesmo `status`, o mesmo `batchId` e o
// `batchFailedOperationId` da culpada. Acima de `LOTE_MAX_OPS` (200) o lote é recusado inteiro.
//
// O EMPACOTAMENTO EM SI é da fila e está preso, contra a implementação REAL, em
// `tests/integration/fila-recorte-por-lote.test.js`. Aqui a fila é dublê, então o dublê passa a
// empacotar como ela: o que estes casos medem é o que o MOTOR faz com um lote.

/**
 * O recorte por lote, resumido: lotes inteiros até o orçamento, e o primeiro inteiro sempre.
 * Espelha `OperationQueue.peek`, cujo comportamento real é asserido no arquivo citado acima.
 * @param {Object[]} ops - A fila, em ordem.
 * @param {number} count - O orçamento.
 * @returns {Object[]} Lotes inteiros.
 */
function recortePorLote(ops, count) {
    const saida = [];
    let i = 0;
    while (i < ops.length) {
        const batch = ops[i].batchId ?? null;
        let fim = i + 1;
        if (batch !== null) {
            while (fim < ops.length && ops[fim].batchId === batch) fim++;
        }
        const corrida = ops.slice(i, fim);
        if (saida.length > 0 && saida.length + corrida.length > count) break;
        saida.push(...corrida);
        i = fim;
        if (saida.length >= count) break;
    }
    return saida;
}

/**
 * N membros de um lote lógico.
 * @param {string} batchId - Identidade do gesto.
 * @param {number} total - Quantos membros.
 * @returns {Object[]} Os envelopes.
 */
function loteDe(batchId, total) {
    return Array.from({ length: total }, (_, index) => ({
        id: `${batchId}-${index}`, entityId: `e-${batchId}-${index}`,
        entityType: 'feature', operationType: 'create', batchId, batchIndex: index,
    }));
}

describe('lote lógico no envio', () => {
    beforeEach(async () => {
        operationQueueMock.peek.mockImplementation(async (count) => recortePorLote(queueState.ops, count));
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pushOperations.mockClear();
    });

    // `vi.clearAllMocks()` limpa CHAMADAS, não implementações: sem esta linha o recorte por
    // lote vazaria para todo caso posterior do arquivo, e seria um dublê medindo outro dublê.
    afterEach(() => {
        operationQueueMock.peek.mockImplementation(async (count) => queueState.ops.slice(0, count));
    });

    it('um gesto de 30 viaja num push só, e dois gestos de 20 viajam em dois', async () => {
        queueState.ops = loteDe('gesto-a', 30);
        await syncEngine.flush();
        expect(apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length)).toEqual([30]);

        // CONTROLE NEGATIVO: com o recorte cego (a fatia por contagem que o dublê fazia até
        // aqui), o mesmo gesto sai em 25 + 5, e cada metade é um lote lógico próprio para o
        // servidor, aplicável sem a outra.
        apiClientMock.pushOperations.mockClear();
        operationQueueMock.peek.mockImplementation(async (count) => queueState.ops.slice(0, count));
        queueState.ops = loteDe('gesto-b', 30);
        await syncEngine.flush();
        expect(apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length)).toEqual([25, 5]);

        // E de volta ao recorte por lote: dois gestos de 20 não se misturam num push de 25.
        apiClientMock.pushOperations.mockClear();
        operationQueueMock.peek.mockImplementation(async (count) => recortePorLote(queueState.ops, count));
        queueState.ops = [...loteDe('gesto-c', 20), ...loteDe('gesto-d', 20)];
        await syncEngine.flush();
        const enviados = apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.map(o => o.batchId));
        expect(enviados).toEqual([
            Array(20).fill('gesto-c'),
            Array(20).fill('gesto-d'),
        ]);
    });

    it('acima do teto do servidor a recusa é LOCAL: nenhuma viagem, e problema em todas', async () => {
        queueState.ops = loteDe('gesto-grande', 201);

        const result = await syncEngine.flush();

        expect(apiClientMock.pushOperations).not.toHaveBeenCalled();
        expect(result).toEqual({ pushed: 0 });
        expect(queueState.issues).toHaveLength(201);
        expect(queueState.issues.every(i => i.result.reason.includes('mais de 200 alterações'))).toBe(true);
        expect(queueState.issues.every(i => i.result.batchId === 'gesto-grande')).toBe(true);

        // CONTROLE POSITIVO no mesmo caso: 200 é aceito, então o teto é o teto e não um
        // "lote grande demais" que reprovaria qualquer gesto composto.
        queueState.ops = loteDe('gesto-no-teto', 200);
        await syncEngine.flush();
        expect(apiClientMock.pushOperations.mock.calls.map(([, ops]) => ops.length)).toEqual([200]);
    });

    it('lote recusado vira problema durável nas N ops, com a culpada nomeada', async () => {
        queueState.ops = loteDe('gesto-a', 3);
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: loteDe('gesto-a', 3).map(op => ({
                operationId: op.id, rejected: true, status: 'conflict',
                reason: 'A camada de destino foi excluída.',
                batchId: 'gesto-a', batchFailedOperationId: 'gesto-a-1',
                ...(op.id === 'gesto-a-1' ? { conflict: { fields: ['layerId'] } } : {}),
            })),
            serverVersion: 9,
        });

        await syncEngine.flush();

        expect(queueState.issues.map(i => i.operation.id))
            .toEqual(['gesto-a-0', 'gesto-a-1', 'gesto-a-2']);
        expect(queueState.issues.every(i => i.result.batchId === 'gesto-a')).toBe(true);
        expect(queueState.issues.every(i => i.result.batchFailedOperationId === 'gesto-a-1')).toBe(true);
        // A CLASSE é a mesma para os três: a disputa é do gesto, não de um membro.
        expect(queueState.issues.map(i => classifyIssue(i.result)))
            .toEqual([IssueClass.CONFLITO, IssueClass.CONFLITO, IssueClass.CONFLITO]);
        // NADA saiu da fila: o servidor rolou o gesto inteiro para trás.
        expect(queueState.dequeued).toEqual([]);
    });

    it('membro recusado NÃO leva a irmã acked embora, mesmo que o servidor se contradiga', async () => {
        queueState.ops = loteDe('gesto-a', 3);
        // Um servidor fora do contrato: recusa a do meio e diz que as outras duas passaram. O
        // savepoint do servidor real torna isso impossível; se acontecer, o desfecho seguro é
        // guardar o gesto inteiro, nunca deixá-lo meio confirmado na fila.
        apiClientMock.pushOperations.mockResolvedValueOnce({
            results: [
                { operationId: 'gesto-a-0', success: true, currentVersion: 9 },
                { operationId: 'gesto-a-1', rejected: true, reason: 'Mapa bloqueado.', batchId: 'gesto-a' },
                { operationId: 'gesto-a-2', success: true, currentVersion: 9 },
            ],
            serverVersion: 9,
        });

        await syncEngine.flush();

        expect(queueState.dequeued).toEqual([]);
        // A REDE DE SEGURANÇA: as duas irmãs ganham o problema do lote, com o motivo da culpada.
        expect(queueState.issues.map(i => i.operation.id).sort())
            .toEqual(['gesto-a-0', 'gesto-a-1', 'gesto-a-2']);
        expect(queueState.issues.every(i => i.result.reason === 'Mapa bloqueado.')).toBe(true);
        expect(queueState.issues.filter(i => i.operation.id !== 'gesto-a-1')
            .every(i => i.result.batchFailedOperationId === 'gesto-a-1')).toBe(true);
    });

    it('o reenvio do lote reusa os MESMOS envelopes, ids inclusive', async () => {
        const envelopes = loteDe('gesto-a', 3);
        queueState.ops = envelopes.map(op => ({ ...op }));
        apiClientMock.pushOperations.mockRejectedValueOnce(httpError(503));

        await expect(syncEngine.flush()).rejects.toThrow();
        expect(queueState.issues).toEqual([]);
        expect(queueState.ops).toEqual(envelopes);

        await syncEngine.flush();
        // Um push só, o gesto inteiro, e byte a byte o que estava na fila: é o `op.id` que
        // torna o reenvio idempotente do outro lado, e cunhar id novo pediria dupla aplicação.
        expect(apiClientMock.pushOperations.mock.calls).toHaveLength(2);
        expect(apiClientMock.pushOperations.mock.calls[1][1]).toEqual(envelopes);
        expect(queueState.dequeued).toEqual(['gesto-a-0', 'gesto-a-1', 'gesto-a-2']);
    });

    it('o modo de isolamento TERMINA quando o pedaço indivisível é um lote', async () => {
        queueState.ops = [...loteDe('gesto-ruim', 3), { id: 'solta', entityId: 'solta' }];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some(o => o.batchId === 'gesto-ruim')) throw httpError(400);
            return { results: ops.map(op => ({ operationId: op.id, success: true })), serverVersion: 1 };
        });

        // CONTROLE NEGATIVO: sem a guarda `!isolating`, `peek(1)` devolve o lote de 3 outra vez,
        // `ops.length > 1` continua verdadeiro e o laço nunca sai daqui.
        const result = await syncEngine.flush();

        expect(result).toEqual({ pushed: 1 });
        expect(queueState.issues.map(i => i.operation.id))
            .toEqual(['gesto-ruim-0', 'gesto-ruim-1', 'gesto-ruim-2']);
        expect(queueState.issues.every(i => i.result.batchFailedOperationId === 'gesto-ruim-0')).toBe(true);
        expect(queueState.dequeued).toEqual(['solta']);
    });

    it('413 de um gesto que não se divide: o gesto inteiro vai para as pendências, a solta segue', async () => {
        queueState.ops = [...loteDe('gesto-grande', 3), { id: 'solta', entityId: 'solta' }];
        apiClientMock.pushOperations.mockImplementation(async (_atlasId, ops) => {
            if (ops.some(o => o.batchId === 'gesto-grande')) throw httpError(413);
            return { results: ops.map(op => ({ operationId: op.id, success: true })), serverVersion: 1 };
        });

        // CONTROLE DO LAÇO: a metade de um pedaço indivisível devolve o MESMO pedaço, e sem a
        // comparação de tamanho a divisão giraria para sempre sobre ele.
        const result = await syncEngine.flush();

        expect(result).toEqual({ pushed: 1 });
        expect(queueState.issues.map(i => i.operation.id))
            .toEqual(['gesto-grande-0', 'gesto-grande-1', 'gesto-grande-2']);
        expect(queueState.issues.every(i => /partes menores/.test(i.result.reason))).toBe(true);
        expect(queueState.dequeued).toEqual(['solta']);
    });
});

describe('marcadores estruturais das quatro exceções REST', () => {
    it('retries a stale HTTP snapshot without advertising its cursor', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        applyRemoteSnapshot.mockRejectedValueOnce(Object.assign(new Error('old snapshot'), { code: 'STALE_SYNC_SNAPSHOT' }));
        apiClientMock.pullSync.mockResolvedValueOnce({ snapshot: { maps: [] }, currentVersion: 11 });
        apiClientMock.pullSync.mockResolvedValueOnce({ snapshot: { maps: ['latest'] }, currentVersion: 12 });
        wsClientMock.setLastVersion.mockClear();
        await syncEngine.resync();
        expect(syncEngine.lastVersion).toBe(12);
        expect(wsClientMock.setLastVersion.mock.calls).toEqual([[12]]);
    });

    it('bounds retries and preserves the cursor when snapshots stay stale', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        const error = Object.assign(new Error('old snapshot'), { code: 'STALE_SYNC_SNAPSHOT' });
        applyRemoteSnapshot.mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockRejectedValueOnce(error);
        apiClientMock.pullSync.mockResolvedValue({ snapshot: { maps: [] }, currentVersion: 11 });
        await expect(syncEngine.resync()).rejects.toBe(error);
        expect(syncEngine.lastVersion).toBe(0);
        expect(syncEngine._session.resyncPromise).toBeNull();
    });

    it('fetches again when a structural change arrives during an older snapshot request', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        let finishFirst;
        apiClientMock.pullSync.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
        apiClientMock.pullSync.mockResolvedValueOnce({ snapshot: { maps: ['second-change'] }, currentVersion: 12 });
        const first = syncEngine.resync();
        const second = wsClientMock._handlers.serverResync({ type: 'maps_merged' });
        finishFirst({ snapshot: { maps: ['first-change'] }, currentVersion: 11 });
        await Promise.all([first, second]);
        expect(applyRemoteSnapshot).toHaveBeenLastCalledWith({ maps: ['second-change'] }, expect.anything());
        expect(syncEngine.lastVersion).toBe(12);
    });

    it.each(['map_merge', 'map_duplicate', 'atlas_clone', 'atlas_import'])(
        'o marcador %s no replay dispara resync, não aplicação op a op', async (entityType) => {
            await syncEngine.connect('atlas-1', { initialPull: false });
            apiClientMock.pullSync.mockClear();
            applyRemoteOperation.mockClear();
            apiClientMock.pullSync.mockResolvedValueOnce({
                snapshot: { maps: {} }, currentVersion: 42,
            });

            await wsClientMock._handlers.syncResponse({
                isSnapshot: false,
                ops: [{ entityType: 'feature', entityId: 'f1' }, { entityType, entityId: 'x' }],
                currentVersion: 9,
            });

            expect(apiClientMock.pullSync).toHaveBeenCalledWith('atlas-1', 0, { signal: expect.any(AbortSignal) });
            expect(applyRemoteOperation).not.toHaveBeenCalled();
            expect(syncEngine.lastVersion).toBe(42);
        });

    // CONTROLE NEGATIVO: um tipo que NÃO é marcador continua sendo aplicado op a op. Sem esta
    // metade, um conjunto que casasse com tudo passaria verde nos quatro casos acima.
    it('um tipo qualquer não dispara resync', async () => {
        await syncEngine.connect('atlas-1', { initialPull: false });
        apiClientMock.pullSync.mockClear();
        applyRemoteOperation.mockClear();

        await wsClientMock._handlers.syncResponse({
            isSnapshot: false,
            ops: [{ entityType: 'map_rename', entityId: 'x' }],
            currentVersion: 9,
        });

        expect(apiClientMock.pullSync).not.toHaveBeenCalled();
        expect(applyRemoteOperation).toHaveBeenCalledTimes(1);
    });
});

describe('disconnect', () => {
    it('closes the WebSocket', () => {
        syncEngine.disconnect();
        expect(wsClientMock.disconnect).toHaveBeenCalledTimes(1);
    });

    // O DEFEITO, medido em 2026-08-25 e fechado no mesmo dia. `disconnect()` limpava papel,
    // recursos, marcas de edicao e a sobreposicao de configuracao, e NAO zerava `_atlasId`; so
    // `logoutAndDisconnect` zerava. Quem le esse campo primeiro e `currentAtlasLockKey`
    // (`account/open-atlas.service.js`), entao uma aba que saisse de um atlas de servidor para
    // um atlas LOCAL sem recarregar a pagina continuava anunciando a chave `remote:<id>` do
    // atlas que acabara de deixar: bloqueava outra aba por um atlas que ninguem tinha aberto, e
    // deixava de defender o slot local que de fato montou. Nao produzia erro nenhum.
    it('PADRAO: uma desconexao comum LEMBRA o atlas, porque ela tambem serve para PAUSAR', () => {
        syncEngine._atlasId = 'atlas-1';
        syncEngine._lastVersion = 7;

        syncEngine.disconnect();

        // O freio do tab-lock (`store/sync/tab-lock-sync-brake.js`) chama assim para PARAR a
        // aba, e a retomada reconecta o MESMO atlas. Esquecer aqui apagaria o que ela le.
        expect(syncEngine.atlasId).toBe('atlas-1');
        expect(syncEngine.lastVersion).toBe(7);
        expect(setImageSyncAtlasMock).not.toHaveBeenCalled();
    });

    it('`forgetAtlas: true` esquece o atlas, a versao aplicada e o destino das imagens', () => {
        syncEngine._atlasId = 'atlas-1';
        syncEngine._lastVersion = 7;

        syncEngine.disconnect({ forgetAtlas: true });

        expect(syncEngine.atlasId).toBeNull();
        // A versao vai junto: um `_lastVersion` de outro atlas valeria no proximo `connect`
        // sem pull inicial, e o motor pediria a partir de uma versao que nao e dele.
        expect(syncEngine.lastVersion).toBe(0);
        expect(setImageSyncAtlasMock).toHaveBeenCalledWith(null);
        // E o socket fecha do mesmo jeito: a bandeira nao troca o que `disconnect` ja fazia.
        expect(wsClientMock.disconnect).toHaveBeenCalledTimes(1);
    });

    // F7. Ate 2026-09-13 so o `logoutAndDisconnect` desligava o registro de operacoes, entao a
    // janela entre montar o namespace remoto e terminar a negociacao (`activateRemoteAtlas` ->
    // `markStoreRemote` -> `connect`) herdava o estado da conexao anterior. Com o registro
    // desligado aqui, essa janela e' DETERMINISTICA e toda edicao remota nela e' recusada por
    // `persistOperationIntents` em vez de gravar a entidade sem intencao nenhuma.
    // CONTROLE NEGATIVO: removendo a chamada de `disconnect`, este caso cai.
    it('desliga o registro de operacoes, como o logout ja fazia', () => {
        syncEngine.disconnect();
        expect(disableOperationLogging).toHaveBeenCalledTimes(1);
    });

    it('e o `connect` seguinte RELIGA, depois da negociacao e do snapshot', async () => {
        syncEngine.disconnect();
        expect(disableOperationLogging).toHaveBeenCalledTimes(1);
        expect(enableOperationLogging).not.toHaveBeenCalled();

        await syncEngine.connect('atlas-1', { initialPull: true });

        expect(enableOperationLogging).toHaveBeenCalledTimes(1);
        // A ORDEM E' O CONTRATO: o religamento vem DEPOIS do pull inicial, nao antes. Enquanto o
        // snapshot esta a caminho a janela continua fechada.
        expect(apiClientMock.pullSync.mock.invocationCallOrder[0])
            .toBeLessThan(enableOperationLogging.mock.invocationCallOrder[0]);
    });
});

describe('logoutAndDisconnect', () => {
    it('disconnects, logs out, clears the session, and stops logging', async () => {
        await syncEngine.logoutAndDisconnect();
        expect(wsClientMock.disconnect).toHaveBeenCalledTimes(1);
        expect(apiClientMock.logout).toHaveBeenCalledTimes(1);
        expect(sessionContextMock.clearSession).toHaveBeenCalledTimes(1);
        // DUAS chamadas, um estado: o `disconnect` que o logout faz primeiro ja desliga, e o
        // logout repete de proposito (a chamada e' idempotente e o logout nao pode depender de
        // ninguem manter aquela linha no `disconnect`).
        expect(disableOperationLogging).toHaveBeenCalledTimes(2);
    });
});
