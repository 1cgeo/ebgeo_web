// Path: tests/integration/cauda-longa-vira-retrato.repro.test.js
//
// O SERVIDOR PASSOU A RESPONDER RETRATO NO LUGAR DE UMA CAUDA LONGA OU PESADA (`PULL_TAIL_MAX_OPS`
// e `PULL_TAIL_MAX_STORED_BYTES`, em `backend/src/modules/sync/sync.service.js`). Antes disso
// um par que voltava depois de um dia fora recebia a cauda inteira (300 edições de um polígono
// eram 7,5 MB contra 14 KB de retrato) e a aplicava uma op por vez.
//
// Este arquivo é a metade do CLIENTE: prova que receber o retrato onde ele esperava cauda é
// seguro nos DOIS caminhos em que o servidor pode responder assim, com uma edição local ainda na
// fila, porque é essa edição que um retrato poderia apagar:
//
//   - o pull REST do `connect`, que pede a partir do cursor durável (`_pullInitialState`);
//   - o `sync_request` do socket NO MEIO da sessão (o reconectar), tratado por `syncResponse`.
//
// Em cada um: a edição continua na fila e sobe no flush, a projeção local dela sobrevive ao
// retrato (a reprojeção de `applyRemoteSnapshot`), a geração do retrato é criada e a anterior
// podada pela regra de sempre, e o cursor durável vai à versão do retrato.
//
// O transporte é o de produção (`WsClient` com socket dublê), o disco é IndexedDB de verdade
// (fake-indexeddb), e o servidor é um ESPELHO da decisão de `pullOperations`, com o teto.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    /**
     * ESPELHO de `pullOperations`, com o TETO da cauda: retrato quando o pedido é zero sem
     * afirmação de retrato, quando está abaixo de `min_version`, ou quando a cauda desde o pedido
     * passa de `PULL_TAIL_MAX_OPS` (500). PELO SOCKET a cauda acima do teto NÃO vira retrato: vira o
     * quadro `atlas_updated` (o aviso de re-puxar pelo HTTP), como em `handleSyncRequest`. O teto
     * de bytes não é modelado: o cliente não distingue por que o servidor respondeu retrato, e o do
     * backend é cobrado lá (`backend/tests/integration/cauda-longa-vira-retrato.test.js`).
     */
    const TETO_DA_CAUDA = 500;
    const servidor = {
        versao: 0,
        versaoMinima: 0,
        retratosServidos: 0,
        caudasServidas: 0,
        avisosDeRePuxar: 0,
        /** @type {Object[]} O log, cada op com `serverVersion`. */
        cauda: [],
        montarRetrato: () => ({}),
        responder(desde, temRetrato = false, canal = 'http') {
            const pendentes = this.cauda.filter(op => op.serverVersion > desde);
            if (canal === 'ws' && pendentes.length > TETO_DA_CAUDA && !(desde === 0 && temRetrato !== true)) {
                this.avisosDeRePuxar += 1;
                return { resync: true };
            }
            if ((desde === 0 && temRetrato !== true) || desde < this.versaoMinima
                || pendentes.length > TETO_DA_CAUDA) {
                this.retratosServidos += 1;
                return { isSnapshot: true, snapshot: this.montarRetrato(), currentVersion: this.versao };
            }
            this.caudasServidas += 1;
            return { isSnapshot: false, operations: pendentes, currentVersion: this.versao };
        },
    };

    const pedidosHttp = [];
    const pedidosWs = [];
    const empurradas = [];

    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 1;
            this.sent = [];
            queueMicrotask(() => this.entregar({
                type: 'connected', sessionId: 's1', userId: 'user-1', permission: 'owner', role: 'owner',
            }));
        }

        send(texto) {
            const msg = JSON.parse(texto);
            this.sent.push(msg);
            if (msg.type !== 'sync_request') return;
            pedidosWs.push({ desde: msg.lastVersion, temRetrato: msg.haveSnapshot ?? null });
            const resposta = servidor.responder(msg.lastVersion, msg.haveSnapshot, 'ws');
            if (resposta.resync) {
                queueMicrotask(() => this.entregar({ type: 'atlas_updated', resync: 'cauda-longa' }));
                return;
            }
            queueMicrotask(() => this.entregar({
                type: 'sync_response',
                isSnapshot: resposta.isSnapshot,
                snapshot: resposta.snapshot,
                ops: resposta.operations,
                currentVersion: resposta.currentVersion,
            }));
        }

        close(code, reason) {
            this.readyState = 3;
            this.onclose?.({ code, reason });
        }

        entregar(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    }

    const apiFake = {
        getSyncProtocol: vi.fn(async () => ({ writeVersions: [2], receiptLookup: true })),
        lookupOperationReceipts: vi.fn(async () => ({ results: [] })),
        pullSync: vi.fn(async (_atlasId, desde) => {
            pedidosHttp.push(desde);
            const resposta = servidor.responder(desde);
            return resposta.isSnapshot
                ? { snapshot: resposta.snapshot, currentVersion: resposta.currentVersion, isSnapshot: true }
                : { operations: resposta.operations, currentVersion: resposta.currentVersion, isSnapshot: false };
        }),
        pushOperations: vi.fn(async (_atlasId, ops) => {
            empurradas.push(...ops.map(op => op.id));
            servidor.versao += 1;
            return {
                results: ops.map(op => ({
                    operationId: op.id, success: true, status: 'applied', currentVersion: servidor.versao,
                })),
                serverVersion: servidor.versao,
            };
        }),
        getAtlasSettings: vi.fn(async () => ({})),
        wsUrl: vi.fn(() => 'ws://teste/collab'),
        setTokens: vi.fn(),
    };

    return { servidor, pedidosHttp, pedidosWs, empurradas, FakeSocket, apiFake, ws: null };
});

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: h.apiFake,
    configureApiClient: vi.fn(),
    ApiClient: class ApiClient {},
}));

vi.mock('../../src/js/store/sync/ws-client.js', async (importOriginal) => {
    const actual = await importOriginal();
    const ws = new actual.WsClient({
        apiClient: h.apiFake,
        socketFactory: (url) => new h.FakeSocket(url),
        clientId: 'cliente-de-teste',
        heartbeatMs: 10_000_000,
        reconnectBaseMs: 10_000_000,
    });
    h.ws = ws;
    return { ...actual, wsClient: ws };
});

vi.mock('../../src/js/store/sync/resource-access.service.js', () => ({
    refreshVisibleResources: vi.fn(async () => true),
    clearVisibleResources: vi.fn(),
}));

vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showWarning: vi.fn(), showToast: vi.fn(), showError: vi.fn(),
    showSuccess: vi.fn(), showInChannel: vi.fn(),
}));

import {
    activateScope, clearActiveScope, clearAtlasDatabases, remoteScope,
} from '../../src/js/store/atlas-namespace.js';
import { getEmptyMapData, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { readGeneration } from '../../src/js/store/namespace-generation.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { operationQueue, OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { sessionContext } from '../../src/js/store/sync/session-context.js';

const MAPA = '52000000-0000-4000-8000-000000000009';
let atlasId;
let escopo;

const assentar = async () => {
    for (let volta = 0; volta < 5; volta += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
        await h.ws._applyChain;
    }
};

const ponto = (id, x) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [x, x] }, properties: { id, source: 'point' },
});

/** A geração ativa, lida pelo registro durável. */
const repoAtivo = () => localRepository.forScope({ ...escopo, dataGeneration: readGeneration(escopo).active });

/** Os ids de ponto do mapa na geração ativa. */
const pontosNoDisco = async () => ((await repoAtivo().getMap(MAPA))?.features?.points ?? [])
    .map(f => f.properties.id);

/**
 * UMA EDIÇÃO LOCAL AINDA NÃO ENVIADA, na forma que o write-ahead deixa: a intenção no diário da
 * fila e a projeção dela no documento do mapa da geração ativa.
 */
const editarLocalmente = async (featureId) => {
    const repo = repoAtivo();
    const mapa = await repo.getMap(MAPA);
    mapa.features.points = [...(mapa.features.points ?? []), ponto(featureId, 5)];
    await repo.saveMap(MAPA, mapa);
    const op = {
        protocolVersion: 2, id: `op-${featureId}`, entityType: 'feature', operationType: 'create',
        entityId: featureId, mapId: MAPA, data: ponto(featureId, 5),
        timestamp: Date.now(), clientId: 'cliente-de-teste', atlasId, scopeSuffix: escopo.dbSuffix,
    };
    await operationQueue.enqueueAll([op]);
    return op;
};

/** Fecha a sessão como um F5 faria, deixando o disco e o cursor durável. */
const fechar = () => {
    syncEngine.disconnect();
    h.ws.disconnect();
    syncEngine._session = null;
    syncEngine._lastVersion = 0;
};

/** O servidor andou: um colega criou `idDoColega`, e a cauda desde 7 passou do teto. */
const servidorAndou = (idDoColega) => {
    h.servidor.versao = 900;
    h.servidor.cauda = Array.from({ length: 501 }, (_, i) => ({ serverVersion: 8 + i }));
    h.servidor.montarRetrato = () => ({
        atlas: { ...createAtlas('Atlas remoto'), id: atlasId, settings: {} },
        maps: [{ ...getEmptyMapData(), id: MAPA, name: 'Mapa 1',
            features: { ...getEmptyMapData().features, points: [ponto(idDoColega, 1)] } }],
        briefings: [],
        currentVersion: h.servidor.versao,
    });
};

beforeEach(async () => {
    vi.clearAllMocks();
    const armazenamento = new Map();
    vi.stubGlobal('localStorage', {
        getItem: chave => armazenamento.get(chave) ?? null,
        setItem: (chave, valor) => armazenamento.set(chave, String(valor)),
        removeItem: chave => armazenamento.delete(chave),
    });

    // THE ACCOUNT IS KNOWN BEFORE THE FIRST CONNECT, as in the app (login and the F5 restore both
    // set the session before any atlas opens). The durable cursor is trusted only by the principal
    // it was staged for (`_durablePullCursor`), so a first connect with no user would stage a
    // visitor's generation and the second connect, after the socket named the user, would
    // rightly refuse its cursor: the harness would be measuring the visitor case, not this one.
    sessionContext.setSession({ userId: 'user-1', role: 'owner' });
    atlasId = crypto.randomUUID();
    escopo = remoteScope(atlasId);
    activateScope(escopo);
    await clearAtlasDatabases(escopo);

    h.servidor.versao = 7;
    h.servidor.versaoMinima = 0;
    h.servidor.retratosServidos = 0;
    h.servidor.caudasServidas = 0;
    h.servidor.avisosDeRePuxar = 0;
    h.servidor.cauda = [];
    h.servidor.montarRetrato = () => ({
        atlas: { ...createAtlas('Atlas remoto'), id: atlasId, settings: {} },
        maps: [{ ...getEmptyMapData(), id: MAPA, name: 'Mapa 1' }],
        briefings: [],
        currentVersion: h.servidor.versao,
    });
    h.pedidosHttp.length = 0;
    h.pedidosWs.length = 0;
    h.empurradas.length = 0;

    setRemoteHandlerEventBus({ emit: vi.fn() });
    syncEngine._session?.close();
    syncEngine._session = null;
    syncEngine._atlasId = null;
    syncEngine._lastVersion = 0;
    syncEngine._haveSnapshot = false;
    syncEngine._handlersWired = false;
});

afterEach(async () => {
    vi.restoreAllMocks();
    h.ws.disconnect();
    await operationQueue.clear().catch(() => {});
    clearActiveScope();
    vi.unstubAllGlobals();
});

describe('cauda acima do teto: o servidor responde retrato e a edição local sobrevive', () => {
    it('REST, no connect a partir do cursor durável', async () => {
        await syncEngine.connect(atlasId);
        await assentar();
        const primeira = readGeneration(escopo);
        expect(primeira.cursor, 'PISO: a primeira abertura gravou 7').toBe(7);
        fechar();

        const minhaFeicao = crypto.randomUUID();
        const minha = await editarLocalmente(minhaFeicao);
        const doColega = crypto.randomUUID();
        servidorAndou(doColega);
        h.pedidosHttp.length = 0;

        await syncEngine.connect(atlasId);
        await assentar();

        expect(h.pedidosHttp, 'o connect pediu a CAUDA desde o cursor').toEqual([7]);
        expect(h.servidor.retratosServidos, 'e recebeu o retrato no lugar dela').toBe(2);

        const geracao = readGeneration(escopo);
        expect(geracao.active, 'a geração do retrato foi criada').not.toBe(primeira.active);
        expect(geracao.cursor, 'o cursor durável foi à versão do retrato').toBe(900);
        expect([...geracao.known].sort(), 'a poda de sempre: a ativa e UMA anterior')
            .toEqual([primeira.active, geracao.active].sort());

        const pontos = await pontosNoDisco();
        expect(pontos, 'o que o servidor tinha chegou').toContain(doColega);
        expect(pontos, 'a projeção local não sumiu').toContain(minhaFeicao);

        expect((await operationQueue.peek(25)).map(op => op.id), 'a edição continua na fila').toEqual([minha.id]);
        await syncEngine.flush();
        expect(h.empurradas, 'e sobe no flush').toEqual([minha.id]);
    });

    it('WS, no sync_request do meio da sessão: o aviso de re-puxar leva ao retrato pelo HTTP', async () => {
        await syncEngine.connect(atlasId);
        await assentar();
        const primeira = readGeneration(escopo);
        expect(primeira.cursor).toBe(7);

        const minhaFeicao = crypto.randomUUID();
        const minha = await editarLocalmente(minhaFeicao);
        const doColega = crypto.randomUUID();
        servidorAndou(doColega);
        h.pedidosWs.length = 0;
        h.pedidosHttp.length = 0;

        // O reconectar do socket pede a cauda desde o que já aplicou.
        h.ws.requestSync(7);
        await assentar();

        expect(h.pedidosWs).toEqual([{ desde: 7, temRetrato: true }]);
        expect(h.servidor.avisosDeRePuxar, 'o socket respondeu o aviso, e não o retrato').toBe(1);
        expect(h.pedidosHttp, 'o retrato veio pelo HTTP, pedido do zero pelo resync').toEqual([0]);
        expect(h.servidor.retratosServidos).toBe(2);

        const geracao = readGeneration(escopo);
        expect(geracao.active).not.toBe(primeira.active);
        expect(geracao.cursor).toBe(900);
        expect([...geracao.known].sort()).toEqual([primeira.active, geracao.active].sort());
        expect(syncEngine.lastVersion, 'o motor parte da versão do retrato').toBe(900);

        const pontos = await pontosNoDisco();
        expect(pontos).toContain(doColega);
        expect(pontos).toContain(minhaFeicao);

        expect((await operationQueue.peek(25)).map(op => op.id)).toEqual([minha.id]);
        await syncEngine.flush();
        expect(h.empurradas).toEqual([minha.id]);
    });

    // CONTROLE DO INSTRUMENTO: o que prende a projeção local é a REPROJEÇÃO das intenções
    // pendentes dentro de `applyRemoteSnapshot`. Sem ela o mesmo retrato apaga a edição da tela,
    // e este caso é o que prova que os dois acima medem isso e não o acaso de o disco ter sobrado.
    it('CONTROLE: sem a reprojeção das pendentes, o retrato apaga a projeção local', async () => {
        await syncEngine.connect(atlasId);
        await assentar();
        fechar();

        const minhaFeicao = crypto.randomUUID();
        await editarLocalmente(minhaFeicao);
        servidorAndou(crypto.randomUUID());
        vi.spyOn(OperationQueue.prototype, 'getPendingProjection').mockResolvedValue([]);

        await syncEngine.connect(atlasId);
        await assentar();

        expect(readGeneration(escopo).cursor).toBe(900);
        expect(await pontosNoDisco()).not.toContain(minhaFeicao);
    });
});
