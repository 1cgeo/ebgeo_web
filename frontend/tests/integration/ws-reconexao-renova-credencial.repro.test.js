// Path: tests/integration/ws-reconexao-renova-credencial.repro.test.js
//
// A RECONEXÃO DO SOCKET DE COLABORAÇÃO BATIA 401 EM LAÇO. Medido no nginx do stack de teste em
// 2026-09-22: 24 `401 GET /ebgeo_novo/api/v1/collab` em quatro dias, mais os defeitos "WebSocket de
// colaboração: closed".
//
// A CAUSA. O token do socket viaja na URL do upgrade (`apiClient.wsUrl`), e o upgrade responde 401 a
// um JWT vencido (`backend/src/modules/collab/collab.gateway.js`). A reconexão lia o token da
// memória e abria, sem renovar: depois de uma suspensão mais longa que a vida do access token (15
// min), toda tentativa do backoff era recusada. Quem renovaria (o envio HTTP da fila) só roda com a
// conexão ONLINE, que é justamente o que o socket tentava ficar. O navegador não entrega o status de
// um upgrade recusado: o fechamento é igual ao de uma queda de rede, então o cliente não tinha como
// saber que o problema era a credencial.
//
// O QUE ESTE ARQUIVO PRENDE, com um controle para cada lado:
//   1. token vencido COM renovação: renova ANTES de abrir, e o socket novo leva o token novo
//      (revertido o conserto, ele leva o vencido: é o controle negativo do caso);
//   2. renovação que falha de vez: a sessão acabou, o aviso é do tratador de sessão perdida, e o
//      socket PARA de tentar (um token vazio seria um 400 por passo do backoff);
//   3. renovação que falha por instabilidade: os tokens ficam, e o laço continua tentando;
//   4. token de link público vencido: não há o que renove, então PARA e avisa uma vez;
//   5. token ainda bom: nenhuma renovação, e a reconexão segue como sempre;
//   6. troca de atlas ou saída DURANTE a renovação: nenhum socket aberto para a intenção velha.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WsClient, decidirReconexao } from '../../src/js/store/sync/ws-client.js';
import { ConnectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

/** Minimal fake of the global WebSocket (onopen/onmessage/onclose/onerror + send/close). */
class FakeSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.sent = [];
        FakeSocket.instances.push(this);
    }
    send(str) { this.sent.push(JSON.parse(str)); }
    close(code, reason) {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
    emit(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}
FakeSocket.instances = [];

/** Um JWT de forma real (o cliente só lê `exp` e `sub`; a assinatura é do servidor). */
function jwt(expEmSegundos, sub = 'user-1') {
    const b64 = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: expEmSegundos })}.assinatura`;
}
const agoraEmSegundos = () => Math.floor(Date.now() / 1000);
const VENCIDO = jwt(agoraEmSegundos() - 600);
const NOVO = jwt(agoraEmSegundos() + 900);
const BOM = jwt(agoraEmSegundos() + 900, 'user-1');

/** Uma resposta de `fetch` no formato que `_performRequest` lê. */
function resposta(status, corpo) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
    };
}

/**
 * O cliente real sobre um socket falso. `fetch` responde só `POST /auth/refresh`, e cada pedido
 * fica registrado em `pedidos`, porque "renovou ANTES de abrir" é uma afirmação de ORDEM.
 */
function montar({ refresh } = {}) {
    FakeSocket.instances = [];
    const ordem = [];
    const fetch = vi.fn(async (url, init) => {
        ordem.push(`fetch ${new URL(url).pathname}`);
        return refresh ? refresh(url, init) : resposta(500, { error: { message: 'sem resposta' } });
    });
    const api = new ApiClient({ baseUrl: 'http://h:3001/api/v1', fetch });
    const conn = new ConnectionState();
    const ws = new WsClient({
        apiClient: api,
        connectionState: conn,
        socketFactory: (url) => {
            ordem.push('socket');
            return new FakeSocket(url);
        },
        clientId: 'me',
        heartbeatMs: 10_000_000,
        reconnectBaseMs: 5,
        reconnectMaxMs: 5,
    });
    return { api, conn, ws, fetch, ordem };
}

/** Conecta com um token BOM (como a abertura real, que vem depois de um pull HTTP) e completa. */
async function conectar(ctx) {
    const aberto = ctx.ws.connect('atlas-1');
    FakeSocket.instances[0].emit({ type: 'connected', sessionId: 'me', permission: 'owner' });
    await aberto;
}

const tokenDoSocket = (i) => new URL(FakeSocket.instances[i].url).searchParams.get('token');
const esperar = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

afterEach(() => {
    vi.restoreAllMocks();
});

describe('decidirReconexao', () => {
    it.each([
        ['resposta desconhecida (cliente antigo): abre, como antes', null, 'reabrir'],
        ['token bom', { token: 't', expired: false, renewable: true }, 'reabrir'],
        ['vencido mas renovável (renovação instável): abre e deixa o laço tentar', { token: 't', expired: true, renewable: true }, 'reabrir'],
        ['sem token: a sessão acabou', { token: null, expired: false, renewable: false }, 'parar-sessao-perdida'],
        ['token vazio conta como sem token', { token: '', expired: false, renewable: true }, 'parar-sessao-perdida'],
        ['vencido e sem renovação (link público)', { token: 't', expired: true, renewable: false }, 'parar-credencial-vencida'],
    ])('%s', (_nome, credencial, esperado) => {
        expect(decidirReconexao(credencial)).toBe(esperado);
    });
});

describe('a reconexão renova a credencial ANTES de abrir', () => {
    it('REPRO: token vencido e renovável: o socket novo leva o token NOVO, renovado antes', async () => {
        const ctx = montar({
            refresh: async () => resposta(200, { data: { accessToken: NOVO, refreshToken: 'r2' } }),
        });
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        // A suspensão: o access token venceu com o socket aberto (o servidor não derruba por isso).
        ctx.api.setTokens({ accessToken: VENCIDO, refreshToken: 'r1' });
        ctx.ordem.length = 0;
        FakeSocket.instances[0].close(1006, 'queda');

        await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
        expect(tokenDoSocket(1)).toBe(NOVO);
        expect(tokenDoSocket(1)).not.toBe(VENCIDO);
        expect(ctx.ordem).toEqual(['fetch /api/v1/auth/refresh', 'socket']);
        ctx.ws.disconnect();
    });

    it('token ainda bom: nenhuma renovação, e a reconexão segue com o mesmo token', async () => {
        const ctx = montar();
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        FakeSocket.instances[0].close(1006, 'queda');

        await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
        expect(tokenDoSocket(1)).toBe(BOM);
        expect(ctx.fetch).not.toHaveBeenCalled();
        ctx.ws.disconnect();
    });

    it('renovação que falha DE VEZ: para de tentar, fica OFFLINE, e quem avisa é o tratador de sessão', async () => {
        const ctx = montar({ refresh: async () => resposta(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }) });
        const sessaoPerdida = vi.fn();
        ctx.api.setAuthLostHandler(sessaoPerdida);
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        ctx.api.setTokens({ accessToken: VENCIDO, refreshToken: 'r1' });
        FakeSocket.instances[0].close(1006, 'queda');

        await vi.waitFor(() => expect(sessaoPerdida).toHaveBeenCalledTimes(1));
        await esperar(40);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(ctx.conn.getState()).toBe(ConnectionStates.OFFLINE);
        // Um único pedido de renovação: o laço não voltou a bater.
        expect(ctx.fetch).toHaveBeenCalledTimes(1);
    });

    it('renovação que falha por INSTABILIDADE: os tokens ficam e o laço continua tentando', async () => {
        const ctx = montar({ refresh: async () => resposta(503, { error: { message: 'fora' } }) });
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        ctx.api.setTokens({ accessToken: VENCIDO, refreshToken: 'r1' });
        FakeSocket.instances[0].close(1006, 'queda');

        await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(2));
        expect(ctx.api.getAccessToken()).toBe(VENCIDO);
        expect(ctx.conn.getState()).not.toBe(ConnectionStates.OFFLINE);
        ctx.ws.disconnect();
    });

    it('link público vencido: não há renovação possível, então PARA e avisa UMA vez', async () => {
        const ctx = montar();
        const vencida = vi.fn();
        ctx.ws.on('credentialExpired', vencida);
        ctx.api.setEphemeralToken(BOM);
        await conectar(ctx);

        ctx.api.setEphemeralToken(VENCIDO);
        FakeSocket.instances[0].close(1006, 'queda');

        await vi.waitFor(() => expect(vencida).toHaveBeenCalledTimes(1));
        await esperar(40);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(ctx.conn.getState()).toBe(ConnectionStates.OFFLINE);
        expect(ctx.fetch).not.toHaveBeenCalled();
        expect(vencida).toHaveBeenCalledTimes(1);
    });

    it('saída DURANTE a renovação: nenhum socket é aberto para a intenção que acabou', async () => {
        let liberar;
        const pendente = new Promise((resolve) => { liberar = resolve; });
        const ctx = montar({
            refresh: async () => {
                await pendente;
                return resposta(200, { data: { accessToken: NOVO, refreshToken: 'r2' } });
            },
        });
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        ctx.api.setTokens({ accessToken: VENCIDO, refreshToken: 'r1' });
        FakeSocket.instances[0].close(1006, 'queda');
        await vi.waitFor(() => expect(ctx.fetch).toHaveBeenCalledTimes(1));

        ctx.ws.disconnect();
        liberar();
        await esperar(40);

        expect(FakeSocket.instances).toHaveLength(1);
        expect(ctx.conn.getState()).toBe(ConnectionStates.OFFLINE);
    });

    it('troca de atlas DURANTE a renovação: só o socket do atlas novo existe', async () => {
        let liberar;
        const pendente = new Promise((resolve) => { liberar = resolve; });
        const ctx = montar({
            refresh: async () => {
                await pendente;
                return resposta(200, { data: { accessToken: NOVO, refreshToken: 'r2' } });
            },
        });
        ctx.api.setTokens({ accessToken: BOM, refreshToken: 'r1' });
        await conectar(ctx);

        ctx.api.setTokens({ accessToken: VENCIDO, refreshToken: 'r1' });
        FakeSocket.instances[0].close(1006, 'queda');
        await vi.waitFor(() => expect(ctx.fetch).toHaveBeenCalledTimes(1));

        ctx.ws.connect('atlas-2').catch(() => {});
        liberar();
        await esperar(40);

        expect(FakeSocket.instances).toHaveLength(2);
        expect(new URL(FakeSocket.instances[1].url).searchParams.get('atlasId')).toBe('atlas-2');
        ctx.ws.disconnect();
    });
});
