// Path: tests/integration/abertura-remota-aplica-dois-retratos.repro.test.js
//
// ABRIR UM ATLAS DE SERVIDOR APLICAVA DOIS RETRATOS COMPLETOS, e o segundo era pura repetição
// do primeiro. A cadeia:
//
//   1. `syncEngine.connect` pergunta ao cursor durável de que versão pedir. Sem geração ativa
//      (primeira abertura, ou depois do wipe de entrada de `openRemoteAtlas`) a resposta é ZERO,
//      e o servidor responde ZERO com retrato completo.
//   2. `applyRemoteSnapshot` encena o retrato numa geração NOVA de nove bancos, grava o cursor
//      `{active, cursor}` e poda a geração que sobrou.
//   3. o socket abre e `_onConnected` manda SEMPRE um `sync_request` a partir de `_lastVersion`
//      (o `if (wasReconnecting)` saiu em f8e109ea, e sair foi certo: uma op escrita na janela
//      entre o pull e o socket não chega por mais nenhum caminho).
//   4. o servidor decidia retrato ou cauda pela MESMA regra do pull HTTP (`pullOperations`), e
//      a regra de então era "zero, ou abaixo de `min_version`, é retrato". Um atlas que ainda
//      não escreveu operação nenhuma está em `current_version = 0`, então o cursor que o passo 2
//      acabou de gravar É zero, e o passo 4 respondia OUTRO retrato completo.
//   5. `applyRemoteSnapshot` roda de novo: segunda geração, segundo `pauseStoreWrites`, segunda
//      poda. E é essa segunda pausa que abre a corrida que P6 fechou em `5704671a` (a pintura do
//      mapa-base da abertura batendo na barreira de recuperação).
//
// O RECORTE MEDIDO, e ele é mais estreito do que "toda abertura": o segundo retrato só nasce
// quando o retrato recém-aplicado vale ZERO, porque o protocolo usa o zero para dizer as duas
// coisas ao mesmo tempo ("não tenho nada" e "estou em dia com um atlas que nunca teve op").
// Atlas com qualquer operação escrita (`current_version > 0`) já recebia cauda vazia no passo 4,
// e o segundo caso deste arquivo é o controle que prova isso.
//
// O CONSERTO TEM DUAS METADES, e a primeira era IDEMPOTÊNCIA NO CLIENTE: um retrato completo
// cujo `currentVersion` é exatamente o cursor da geração JÁ ativa não descreve nada que o disco
// não tenha, então ele não é encenado. A comparação vem ANTES de `pauseStoreWrites`, que é o que
// faz a segunda resposta custar zero pausa, zero geração e zero poda.
//
// A SEGUNDA METADE É DO PROTOCOLO, e fechou o que sobrava, que era BANDA: o `sync_request` do
// handshake passou a carregar `haveSnapshot: true` quando o estado local está COMPLETO na versão
// pedida, e com o campo presente o servidor lê o zero como uma versão qualquer, respondendo cauda
// vazia. O campo só viaja quando é verdadeiro, então ausência continua significando "manda tudo",
// que é o que um cliente antigo diz. Por isso `retratosServidos` é UM aqui: sobra o retrato do
// pull HTTP, que é o que de fato povoa o disco na primeira abertura.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================================
// Dublês (declarados antes do import do SUT; `vi.mock` é içado)
// ============================================================================

const h = vi.hoisted(() => {
    /**
     * O servidor de teste, ESPELHO da decisão de `pullOperations`
     * (`backend/src/modules/sync/sync.service.js`): retrato quando o pedido está abaixo de
     * `min_version`, ou quando é zero e o pedinte NÃO afirmou ter retrato completo; cauda no
     * resto. Um dublê que respondesse retrato sempre mediria o dublê; um que respondesse cauda
     * sempre esconderia o defeito. Espelho é dívida declarada: mudada a regra lá, esta muda no
     * mesmo commit, e quem cobra a regra de verdade é `backend/tests/ws/`.
     */
    const servidor = {
        versao: 0,
        versaoMinima: 0,
        retratosServidos: 0,
        caudasServidas: 0,
        /** @type {Object[]} As operações que o pull HTTP do `connect` devolve como cauda. */
        cauda: [],
        /** @type {() => Object} Posto pelo `beforeEach`, que é quem conhece o escopo montado. */
        montarRetrato: () => ({}),
        responder(desde, temRetrato = false) {
            // O TETO DA CAUDA (`PULL_TAIL_MAX_OPS`, 500, desde 2026-09-23) entra no espelho por
            // contagem; os casos deste arquivo usam caudas de uma op, entao ele nao muda nenhum. O
            // arquivo que o exercita e `cauda-longa-vira-retrato.repro.test.js`.
            if ((desde === 0 && temRetrato !== true) || desde < this.versaoMinima || this.cauda.length > 500) {
                this.retratosServidos += 1;
                return { isSnapshot: true, snapshot: this.montarRetrato(), currentVersion: this.versao };
            }
            this.caudasServidas += 1;
            return { isSnapshot: false, operations: [], currentVersion: this.versao };
        },
    };

    const pedidosHttp = [];
    const pedidosWs = [];
    const sockets = [];

    /** Fake do WebSocket global: completa o handshake e responde `sync_request` pelo servidor. */
    class FakeSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 1; // OPEN
            this.sent = [];
            sockets.push(this);
            queueMicrotask(() => this.entregar({
                type: 'connected', sessionId: 's1', userId: 'user-1', permission: 'owner', role: 'owner',
            }));
        }

        send(texto) {
            const msg = JSON.parse(texto);
            this.sent.push(msg);
            if (msg.type !== 'sync_request') return;
            // O PAR INTEIRO, e não só a versão: é a presença do campo que decide a resposta, e
            // registrá-lo é o que faz o teste falar sobre o fio em vez de sobre a versão.
            pedidosWs.push({ desde: msg.lastVersion, temRetrato: msg.haveSnapshot ?? null });
            const resposta = servidor.responder(msg.lastVersion, msg.haveSnapshot);
            queueMicrotask(() => this.entregar({
                type: 'sync_response',
                isSnapshot: resposta.isSnapshot,
                snapshot: resposta.snapshot,
                ops: resposta.operations,
                currentVersion: resposta.currentVersion,
            }));
        }

        close(code, reason) {
            this.readyState = 3; // CLOSED
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
                : { operations: servidor.cauda, currentVersion: resposta.currentVersion, isSnapshot: false };
        }),
        getAtlasSettings: vi.fn(async () => ({})),
        wsUrl: vi.fn(() => 'ws://teste/collab'),
        setTokens: vi.fn(),
    };

    return { servidor, pedidosHttp, pedidosWs, sockets, FakeSocket, apiFake, ws: null };
});

vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: h.apiFake,
    configureApiClient: vi.fn(),
    ApiClient: class ApiClient {},
}));

// O TRANSPORTE É REAL, e é o ponto do arquivo: o `sync_request` do handshake sai da `WsClient`
// de produção, com a versão que ela recebeu, e a resposta volta pelo roteamento de verdade.
// Só o socket é dublê.
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

// ============================================================================
// Imports (SUT depois dos dublês)
// ============================================================================

import {
    activateScope, clearActiveScope, clearAtlasDatabases, remoteScope,
} from '../../src/js/store/atlas-namespace.js';
import { getEmptyMapData, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { readGeneration } from '../../src/js/store/namespace-generation.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';
import { setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';

// ============================================================================
// Instrumentação
// ============================================================================

const CHAVE_GERACAO = 'ebgeo_atlas_generation:';
let atlasId;
let escopo;
/** Toda geração que chegou a ser REGISTRADA (preparada ou ativada). */
let geracoesCunhadas;
/** Cada troca do ponteiro ativo: uma por retrato COMPLETO efetivamente encenado. */
let ativacoes;

/** Deixa o microtask do socket entregar e a cadeia de aplicação do ws-client assentar. */
const assentar = async () => {
    for (let volta = 0; volta < 5; volta += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
        await h.ws._applyChain;
    }
};

beforeEach(async () => {
    vi.clearAllMocks();
    const armazenamento = new Map();
    geracoesCunhadas = new Set();
    ativacoes = [];
    vi.stubGlobal('localStorage', {
        getItem: chave => armazenamento.get(chave) ?? null,
        setItem: (chave, valor) => {
            armazenamento.set(chave, String(valor));
            if (!chave.startsWith(CHAVE_GERACAO)) return;
            const registro = JSON.parse(valor);
            for (const geracao of registro.known) geracoesCunhadas.add(geracao);
            if (registro.active && ativacoes.at(-1) !== registro.active) ativacoes.push(registro.active);
        },
        removeItem: chave => armazenamento.delete(chave),
    });

    atlasId = crypto.randomUUID();
    escopo = remoteScope(atlasId);
    activateScope(escopo);
    await clearAtlasDatabases(escopo);

    h.servidor.versao = 0;
    h.servidor.versaoMinima = 0;
    h.servidor.retratosServidos = 0;
    h.servidor.caudasServidas = 0;
    h.servidor.cauda = [];
    h.servidor.montarRetrato = () => ({
        atlas: { ...createAtlas('Atlas remoto'), id: atlasId, settings: {} },
        maps: [{ ...getEmptyMapData(), id: '51000000-0000-4000-8000-000000000009', name: 'Mapa 1' }],
        briefings: [],
        currentVersion: h.servidor.versao,
    });
    h.pedidosHttp.length = 0;
    h.pedidosWs.length = 0;
    h.sockets.length = 0;

    setRemoteHandlerEventBus({ emit: vi.fn() });
    syncEngine._session?.close();
    syncEngine._session = null;
    syncEngine._atlasId = null;
    syncEngine._lastVersion = 0;
    syncEngine._haveSnapshot = false;
    syncEngine._handlersWired = false;
});

afterEach(() => {
    h.ws.disconnect();
    clearActiveScope();
    vi.unstubAllGlobals();
});

describe('abertura de atlas remoto: quantos retratos completos ela encena', () => {
    it('atlas ainda sem operação: UM retrato servido, UM encenado', async () => {
        await syncEngine.connect(atlasId);
        await assentar();

        // O HANDSHAKE DIZ QUAL ZERO É O DELE. Com `haveSnapshot: true` no `sync_request`, o
        // servidor responde cauda vazia: o retrato que sobra é o do pull HTTP, que é o que de
        // fato povoa o disco. Antes eram dois retratos completos, o segundo idêntico ao
        // primeiro, e o cliente sozinho só conseguia recusar ENCENAR o segundo.
        expect(h.pedidosHttp).toEqual([0]);
        expect(h.pedidosWs).toEqual([{ desde: 0, temRetrato: true }]);
        expect(h.servidor.retratosServidos).toBe(1);
        expect(h.servidor.caudasServidas).toBe(1);

        // O CLIENTE ENCENA UM SÓ. Até o conserto eram dois, com duas gerações e duas podas, e a
        // idempotência do cliente continua sendo a rede que segura o retrato que o servidor
        // decida mandar por qualquer outra razão.
        expect(ativacoes).toHaveLength(1);
        expect(geracoesCunhadas.size).toBe(1);
        expect(readGeneration(escopo)).toEqual({
            active: ativacoes[0], known: [ativacoes[0]], cursor: 0,
        });
    });

    it('o retrato que NÃO é repetição continua sendo encenado', async () => {
        // O CONTROLE do caso acima: se a idempotência olhasse só o `active` e não o cursor, ou
        // se comparasse com o cursor errado, este caso passaria a recusar um retrato legítimo e
        // o atlas ficaria parado na versão antiga, calado.
        h.servidor.versao = 7;
        await syncEngine.connect(atlasId);
        await assentar();
        expect(readGeneration(escopo).cursor).toBe(7);

        // A troca de versão no servidor: o próximo `sync_request` recebe um retrato NOVO, porque
        // o cursor local ficou para trás de `min_version`.
        h.servidor.versao = 40;
        h.servidor.versaoMinima = 30;
        h.ws.requestSync(7);
        await assentar();

        expect(h.servidor.retratosServidos).toBe(2);
        expect(ativacoes).toHaveLength(2);
        expect(readGeneration(escopo).cursor).toBe(40);
    });

    it('o handshake parte do cursor que o retrato acabou de gravar', async () => {
        // Com versão de servidor maior que zero o defeito nunca existiu, e é este o controle
        // que prova que o número acima é sobre o ZERO e não sobre a abertura em geral.
        h.servidor.versao = 7;

        await syncEngine.connect(atlasId);
        await assentar();

        expect(h.pedidosHttp).toEqual([0]);
        expect(h.pedidosWs).toEqual([{ desde: 7, temRetrato: true }]);
        expect(h.servidor.retratosServidos).toBe(1);
        expect(h.servidor.caudasServidas).toBe(1);
        expect(ativacoes).toHaveLength(1);
        expect(readGeneration(escopo).cursor).toBe(7);
        expect(syncEngine.lastVersion).toBe(7);
    });

    it('a segunda abertura não encena retrato nenhum, e essa é a garantia de B7a', async () => {
        h.servidor.versao = 7;
        await syncEngine.connect(atlasId);
        await assentar();
        const primeira = readGeneration(escopo).active;

        syncEngine.disconnect();
        h.ws.disconnect();
        h.pedidosHttp.length = 0;
        h.pedidosWs.length = 0;
        h.servidor.retratosServidos = 0;
        h.servidor.caudasServidas = 0;
        syncEngine._session = null;
        syncEngine._lastVersion = 0;

        await syncEngine.connect(atlasId);
        await assentar();

        expect(h.pedidosHttp).toEqual([7]);
        expect(h.pedidosWs).toEqual([{ desde: 7, temRetrato: true }]);
        expect(h.servidor.retratosServidos).toBe(0);
        expect(readGeneration(escopo).active).toBe(primeira);
        expect(ativacoes).toHaveLength(1);
    });

    it('o wipe de entrada esvazia a geração ativa, e o ponteiro sozinho não pula o retrato', async () => {
        // O CONTRA-CONTROLE DO CASO ACIMA, e o defeito que ele escondia até 2026-09-14.
        //
        // "A segunda abertura não encena retrato nenhum" só vale enquanto a geração ativa
        // REALMENTE tiver o atlas. Mas `openRemoteAtlas` chama `clearAllDataStore` em TODA
        // abertura, e ele esvazia os bancos da geração ATIVA sem tocar no ponteiro: fica um
        // registro dizendo "geração G, cursor 7" sobre nove bancos vazios. O atalho de
        // idempotência lia só o ponteiro, então, quando o servidor TAMBÉM estava na versão 7
        // (isto é, quando nada mudou no atlas entre as duas sessões), ele recusava encenar o
        // retrato sobre o disco em branco. O repositório ficava sem mapa nenhum e
        // `activateAtlasInitialMap` INVENTAVA um "Mapa 1": o F5 aterrissava num mapa vazio, com
        // o atlas certo na barra e sem um erro em lugar nenhum (medido em 2026-09-14 por
        // `browser-f5-reconnect-map.repro.spec.js`, 5 reprovações em 8 rodadas em série).
        h.servidor.versao = 7;
        await syncEngine.connect(atlasId);
        await assentar();
        const primeira = readGeneration(escopo).active;

        // O WIPE DE ENTRADA, e só ele: os bancos esvaziam, o ponteiro fica.
        await clearAtlasDatabases(escopo);
        expect(readGeneration(escopo), 'o ponteiro sobrevive ao wipe, que é a premissa do caso')
            .toEqual({ active: primeira, known: [primeira], cursor: 7 });

        syncEngine.disconnect();
        h.ws.disconnect();
        h.pedidosHttp.length = 0;
        h.servidor.retratosServidos = 0;
        syncEngine._session = null;
        syncEngine._lastVersion = 0;

        await syncEngine.connect(atlasId);
        await assentar();

        // O cursor durável já perguntava ao disco, então o pull parte do zero e o servidor
        // responde retrato. O que faltava era a MESMA pergunta do lado de quem aplica.
        expect(h.pedidosHttp, 'o cursor durável não acreditou no ponteiro').toEqual([0]);
        expect(h.servidor.retratosServidos).toBe(1);
        expect(ativacoes, 'o retrato foi ENCENADO numa geração nova, e não recusado')
            .toHaveLength(2);
        expect(readGeneration(escopo).active).not.toBe(primeira);

        // E O DISCO TEM O MAPA. Sem esta linha, "encenou" seria uma afirmação sobre o ponteiro,
        // que é exatamente a evidência de que este caso existe para desconfiar.
        const mapas = await localRepository.forScope({
            ...escopo, dataGeneration: readGeneration(escopo).active,
        }).getAllMaps();
        expect([...mapas.values()].map(mapa => mapa.name)).toEqual(['Mapa 1']);
    });

    it('sem pull inicial o handshake NÃO afirma nada, e recebe o retrato', async () => {
        // O CONTROLE DA AFIRMAÇÃO. O campo é uma alegação sobre o DISCO, e o cliente só pode
        // fazê-la depois de ter encenado um retrato ou aplicado cauda sobre uma geração completa.
        // Um `connect` que pula o pull inicial não tem essa prova, então o campo não sai, e a
        // resposta é o retrato de sempre. Se o campo fosse posto incondicionalmente, este caso
        // receberia cauda vazia sobre um disco vazio: um atlas sem nada, calado.
        await syncEngine.connect(atlasId, { initialPull: false });
        await assentar();

        expect(h.pedidosHttp).toEqual([]);
        expect(h.pedidosWs).toEqual([{ desde: 0, temRetrato: null }]);
        expect(h.servidor.retratosServidos).toBe(1);
        expect(ativacoes).toHaveLength(1);
    });
});

// ============================================================================
// O CURSOR DURÁVEL ANDA COM A CAUDA (2026-09-21)
// ============================================================================

/**
 * Até 2026-09-21 só um RETRATO gravava o cursor durável. Ele ficava, portanto, na versão da
 * abertura enquanto nenhum retrato novo fosse encenado, e todo recarregamento repuxava e reaplicava
 * a cauda INTEIRA desde a primeira abertura do atlas naquele computador. Hoje a cauda aplicada por
 * inteiro sobre uma geração provada completa leva o cursor até `currentVersion`
 * (`_advanceDurableCursor`, `src/js/store/sync/sync-engine.js`), e as três condições daquela função
 * têm um caso cada, porque cada uma é um jeito de o cursor MENTIR.
 */
describe('o cursor durável anda com a cauda aplicada', () => {
    const MAPA = '51000000-0000-4000-8000-000000000009';
    const feicao = (id, mapId, versao) => ({
        id: crypto.randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId,
        serverVersion: versao, clientId: 'outro-cliente',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id, source: 'point' } },
    });

    /** Abre, fecha e deixa o motor pronto para uma SEGUNDA abertura, como um F5 faria. */
    const abrirEFechar = async () => {
        await syncEngine.connect(atlasId);
        await assentar();
        syncEngine.disconnect();
        h.ws.disconnect();
        h.pedidosHttp.length = 0;
        syncEngine._session = null;
        syncEngine._lastVersion = 0;
    };

    it('cauda aplicada por inteiro: o cursor vai a `currentVersion`, a geração não muda, e a TERCEIRA abertura pede só o que falta', async () => {
        h.servidor.versao = 7;
        await abrirEFechar();
        const geracao = readGeneration(escopo).active;
        expect(readGeneration(escopo).cursor, 'PISO: o retrato gravou 7').toBe(7);

        const id = crypto.randomUUID();
        h.servidor.versao = 12;
        h.servidor.cauda = [feicao(id, MAPA, 12)];
        await abrirEFechar();

        expect(h.servidor.retratosServidos, 'nenhum retrato novo foi servido').toBe(1);
        expect(readGeneration(escopo)).toEqual({ active: geracao, known: [geracao], cursor: 12 });
        // A operação está MESMO no disco: o cursor andou sobre dado gravado, não sobre promessa.
        const mapa = await localRepository.getMap(MAPA);
        expect((mapa?.features?.points ?? []).map(f => f.properties.id)).toContain(id);

        h.servidor.cauda = [];
        await syncEngine.connect(atlasId);
        await assentar();
        expect(h.pedidosHttp, 'a terceira abertura pede a partir de 12, não de 7').toEqual([12]);
    });

    it('uma operação que NÃO foi gravada segura o cursor onde estava', async () => {
        // Feição de um mapa que não existe neste disco: o tratador a guarda em memória e devolve
        // `false`. Um cursor que passasse por ela a tornaria irrecuperável sem retrato inteiro.
        h.servidor.versao = 7;
        await abrirEFechar();

        h.servidor.versao = 12;
        h.servidor.cauda = [feicao(crypto.randomUUID(), '52000000-0000-4000-8000-00000000000a', 12)];
        await abrirEFechar();

        expect(readGeneration(escopo).cursor, 'o cursor ficou em 7').toBe(7);
        h.servidor.cauda = [];
        await syncEngine.connect(atlasId);
        await assentar();
        expect(h.pedidosHttp, 'e a próxima abertura repede a cauda desde 7').toEqual([7]);
    });

    it('o cursor só anda para FRENTE, e só sobre a geração que a cauda recebeu', async () => {
        h.servidor.versao = 7;
        await abrirEFechar();
        const sessao = { scope: escopo };
        const geracao = readGeneration(escopo).active;

        expect(syncEngine._advanceDurableCursor(sessao, 7, geracao), 'igual não é avanço').toBe(false);
        expect(syncEngine._advanceDurableCursor(sessao, 3, geracao), 'para trás, nunca').toBe(false);
        expect(syncEngine._advanceDurableCursor(sessao, 9, 'outra-geracao'), 'outra geração, nunca').toBe(false);
        expect(syncEngine._advanceDurableCursor(sessao, 9, null), 'sem geração provada, nunca').toBe(false);
        for (const ruim of [NaN, Infinity, 9.5, '9', null, undefined, 0, -1]) {
            expect(syncEngine._advanceDurableCursor(sessao, ruim, geracao), String(ruim)).toBe(false);
        }
        expect(readGeneration(escopo).cursor, 'nada disso escreveu').toBe(7);

        expect(syncEngine._advanceDurableCursor(sessao, 9, geracao)).toBe(true);
        expect(readGeneration(escopo)).toEqual({ active: geracao, known: [geracao], cursor: 9 });
    });

    it('abertura de PRIMEIRA vez (retrato) não passa por aqui: o cursor é o do retrato', async () => {
        h.servidor.versao = 7;
        h.servidor.cauda = [feicao(crypto.randomUUID(), MAPA, 99)];
        await syncEngine.connect(atlasId);
        await assentar();
        expect(h.pedidosHttp).toEqual([0]);
        expect(readGeneration(escopo).cursor).toBe(7);
    });
});
