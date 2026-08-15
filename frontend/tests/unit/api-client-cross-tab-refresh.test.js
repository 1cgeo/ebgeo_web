// Path: tests/unit/api-client-cross-tab-refresh.test.js
//
// DUAS ABAS, UM REFRESH TOKEN.
//
// O refresh token e de uso unico e a rotacao e por familia: duas abas apresentando o MESMO
// token e o que o servidor le como roubo, e fora da janela de graca de 10 s
// (REFRESH_RACE_GRACE_MS, backend/src/modules/auth/auth.service.js) ele revoga a familia
// inteira, deslogando as duas. O compartilhamento de refresh em voo do ApiClient e por
// INSTANCIA, e ha uma instancia por documento, entao ele nunca cobriu esse caso.
//
// Aqui duas abas sao duas instancias de ApiClient sobre o MESMO localStorage falso, contra um
// servidor de auth falso que implementa rotacao, revogacao, janela de graca e deteccao de
// reuso. As interleavings perigosas sao FORCADAS (a resposta de uma aba fica presa num portao
// ate o teste soltar), nao sorteadas: corrida medida uma vez nao e corrida medida.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// Ambiente do navegador, falsificado: localStorage compartilhado + evento storage
// ---------------------------------------------------------------------------

const ls = (() => {
    const s = {};
    return {
        getItem: (k) => (k in s ? s[k] : null),
        setItem: (k, v) => { s[k] = String(v); },
        removeItem: (k) => { delete s[k]; },
        clear: () => { for (const k of Object.keys(s)) delete s[k]; },
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });

// O ApiClient assina 'storage' no construtor; o Node nao tem addEventListener no globalThis,
// entao o registro e capturado aqui para o teste poder disparar o evento numa aba especifica.
let lastStorageHandler = null;
const removedHandlers = [];
Object.defineProperty(globalThis, 'addEventListener', {
    value: (type, fn) => { if (type === 'storage') lastStorageHandler = fn; },
    configurable: true,
});
Object.defineProperty(globalThis, 'removeEventListener', {
    value: (type, fn) => { if (type === 'storage') removedHandlers.push(fn); },
    configurable: true,
});

import { ApiClient } from '../../src/js/store/sync/api-client.js';

const TOKEN_KEY = 'ebgeo_auth';
/** Igual a TOKEN_RENEWAL_SKEW_MS / REFRESH_LOCK_WAIT_MS do api-client.js. */
const SKEW_MS = 30000;
const LOCK_WAIT_MS = 5000;

/**
 * JWT nao assinado, so o payload importa: o cliente le `exp`/`sub` sem verificar. O `jti` existe
 * para que dois tokens emitidos no MESMO segundo sejam strings diferentes, como no servidor real
 * (`exp` de JWT tem resolucao de segundo, entao ele sozinho nao distingue duas rotacoes seguidas).
 */
let jtiSeq = 0;
function mintAccess({ ttlMs = 15 * 60 * 1000, sub = 'user-1' } = {}) {
    const payload = { sub, jti: `t${++jtiSeq}`, exp: Math.floor((Date.now() + ttlMs) / 1000) };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `hdr.${body}.sig`;
}

// ---------------------------------------------------------------------------
// Servidor de auth falso: rotacao + revogacao + janela de graca + reuso
// ---------------------------------------------------------------------------

function makeAuthServer({ graceMs = 10000, accessTtlMs = 15 * 60 * 1000 } = {}) {
    const state = {
        current: 'R1',
        revokedAt: new Map(),
        familyRevoked: false,
        rotations: 0,
        /** Todo refreshToken apresentado, na ordem. */
        presented: [],
        /** Todo Bearer visto em rota autenticada, na ordem. */
        bearers: [],
        failNextWith: null,
    };

    function json(status, body) {
        return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
    }
    const unauthorized = () => json(401, { error: { code: 'UNAUTHORIZED', message: 'Refresh token inválido' } });

    function handle(url, init = {}) {
        if (url.endsWith('/auth/refresh')) {
            const presented = JSON.parse(init.body).refreshToken;
            state.presented.push(presented);
            if (state.failNextWith) {
                const status = state.failNextWith;
                state.failNextWith = null;
                return json(status, { error: { code: 'SERVER_ERROR', message: 'indisponível' } });
            }
            if (presented === state.current) {
                state.revokedAt.set(presented, Date.now());
                state.current = `R${state.rotations + 2}`;
                state.rotations += 1;
                return json(200, {
                    data: { accessToken: mintAccess({ ttlMs: accessTtlMs }), refreshToken: state.current },
                });
            }
            const revoked = state.revokedAt.get(presented);
            // Reuso FORA da janela de graca e lido como roubo: derruba a familia inteira.
            if (revoked === undefined || Date.now() - revoked > graceMs) {
                state.familyRevoked = true;
                state.current = null;
            }
            return unauthorized();
        }
        if (url.endsWith('/auth/me')) {
            state.bearers.push(init.headers?.Authorization || null);
            return json(200, { data: { id: 'user-1', username: 'diniz' } });
        }
        throw new Error(`rota nao falsificada: ${url}`);
    }

    return {
        state,
        /** Fetch normal. */
        fetch: async (url, init) => handle(url, init),
        /**
         * Fetch com portao: a requisicao fica PRESA antes de ser tratada ate `release()`,
         * o que torna a interleaving perigosa deterministica em vez de sorteada.
         */
        gatedFetch() {
            let release;
            const gate = new Promise((resolve) => { release = resolve; });
            return {
                release,
                fetch: async (url, init) => { await gate; return handle(url, init); },
            };
        },
    };
}

// ---------------------------------------------------------------------------
// navigator.locks falso (fila real, com honra ao AbortSignal enquanto ESPERA)
// ---------------------------------------------------------------------------

function makeLockManager() {
    const queue = new Map();
    const stats = { requests: 0, granted: 0 };
    return {
        stats,
        manager: {
            async request(name, optsOrCb, maybeCb) {
                const opts = typeof optsOrCb === 'function' ? {} : (optsOrCb || {});
                const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
                stats.requests += 1;
                const ahead = queue.get(name) || Promise.resolve();
                let release;
                const mine = new Promise((resolve) => { release = resolve; });
                queue.set(name, ahead.then(() => mine));
                try {
                    await new Promise((resolve, reject) => {
                        let settled = false;
                        ahead.then(() => { if (!settled) { settled = true; resolve(); } });
                        opts.signal?.addEventListener('abort', () => {
                            if (settled) return;
                            settled = true;
                            const err = new Error('lock wait aborted');
                            err.name = 'AbortError';
                            reject(err);
                        });
                    });
                } catch (error) {
                    release();
                    throw error;
                }
                stats.granted += 1;
                try {
                    return await cb({ name });
                } finally {
                    release();
                }
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

/** Cria uma aba (uma instancia) e captura o handler de `storage` que ela registrou. */
function openTab(fetchImpl) {
    lastStorageHandler = null;
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: fetchImpl });
    const handler = lastStorageHandler;
    return {
        client,
        handler,
        /** Entrega a esta aba o evento que o navegador entregaria (o que outra aba escreveu). */
        deliverStorage(newValue = ls.getItem(TOKEN_KEY), key = TOKEN_KEY) {
            handler({ key, newValue });
        },
    };
}

/** Semeia o par inicial no disco e devolve o access token semeado. */
function seedTokens({ ttlMs = 15 * 60 * 1000 } = {}) {
    const accessToken = mintAccess({ ttlMs });
    ls.setItem(TOKEN_KEY, JSON.stringify({ accessToken, refreshToken: 'R1' }));
    return accessToken;
}

beforeEach(() => {
    ls.clear();
    lastStorageHandler = null;
    removedHandlers.length = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('renovação de token entre abas — com navigator.locks', () => {
    /** Instala o LockManager falso e devolve suas estatísticas. */
    function withLocks() {
        const { manager, stats } = makeLockManager();
        vi.stubGlobal('navigator', { locks: manager });
        return stats;
    }

    it('(a) duas abas renovando juntas produzem UMA rotação, e o servidor vê o token uma vez só', async () => {
        const stats = withLocks();
        const server = makeAuthServer();
        // Access token perto de expirar: as duas abas querem renovar.
        seedTokens({ ttlMs: 10000 });

        const a = openTab(server.fetch);
        const b = openTab(server.fetch);
        expect(a.client.loadStoredTokens()).toBe(true);
        expect(b.client.loadStoredTokens()).toBe(true);

        await Promise.all([a.client.refresh(), b.client.refresh()]);

        expect(server.state.rotations).toBe(1);
        expect(server.state.presented).toEqual(['R1']);
        expect(server.state.familyRevoked).toBe(false);
        // A segunda aba saiu do lock com o par NOVO, sem ter falado com o servidor.
        expect(b.client.getAccessToken()).toBe(a.client.getAccessToken());
        expect(JSON.parse(ls.getItem(TOKEN_KEY)).refreshToken).toBe('R2');
        expect(stats.granted).toBe(2);
    });

    it('(b) a segunda aba apresenta o token NOVO quando ainda precisa rotacionar, nunca o revogado', async () => {
        withLocks();
        // Aqui o servidor emite access tokens JÁ dentro da margem de renovação, então adotar
        // não basta e a segunda aba precisa mesmo rotacionar, com o token que adotou.
        const shortLived = makeAuthServer({ accessTtlMs: 10000 });
        seedTokens({ ttlMs: 10000 });

        const a = openTab(shortLived.fetch);
        const b = openTab(shortLived.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        await Promise.all([a.client.refresh(), b.client.refresh()]);

        expect(shortLived.state.presented).toEqual(['R1', 'R2']);
        expect(shortLived.state.rotations).toBe(2);
        expect(shortLived.state.familyRevoked).toBe(false);
        expect(b.client.getAccessToken()).not.toBe(a.client.getAccessToken());
        expect(JSON.parse(ls.getItem(TOKEN_KEY)).refreshToken).toBe('R3');
    });

    it('(e1) erro na rotação solta o lock: a aba seguinte renova normalmente', async () => {
        const stats = withLocks();
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });
        server.state.failNextWith = 503;

        const a = openTab(server.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        await expect(a.client.refresh()).rejects.toMatchObject({ status: 503 });
        await b.client.refresh();

        expect(stats.granted).toBe(2);
        expect(server.state.rotations).toBe(1);
        expect(b.client.getAccessToken()).toBeTruthy();
    });

    it('(e2) aba travada segurando o lock: a espera é limitada, e quem desiste NÃO apresenta o token de novo', async () => {
        // A ESPERA LIMITADA NÃO É PERMISSÃO PARA ROTACIONAR SEM EXCLUSÃO. O detentor está no meio
        // da requisição (o refresh não tem timeout), então o disco ainda não tem o par novo dele:
        // rodar a seção crítica aqui apresentaria o MESMO refresh token. Duas apresentações
        // separadas por mais que a graça de 10 s do servidor são lidas como roubo, e a família
        // inteira é revogada, derrubando as DUAS abas. Não renovar é barato (o access token em
        // geral ainda tem folga, e a próxima chamada tenta de novo); apresentar duas vezes não é.
        withLocks();
        vi.useFakeTimers();
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });

        const gate = server.gatedFetch();
        const a = openTab(gate.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        const pA = a.client.refresh(); // entra no lock e trava lá dentro
        const pB = b.client.refresh(); // fica na fila do lock
        await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS + 1);

        // B desiste de esperar e falha de forma TRANSIENTE, sem falar com o servidor.
        await expect(pB).rejects.toMatchObject({ code: 'REFRESH_LOCK_BUSY' });
        expect(server.state.presented).toEqual([]);
        expect(server.state.rotations).toBe(0);
        // Transiente, e não terminal: os tokens de B continuam onde estavam.
        expect(b.client.isAuthenticated()).toBe(true);

        // O detentor destrava e rotaciona normalmente: uma apresentação, uma rotação.
        gate.release();
        await pA;
        expect(server.state.presented).toEqual(['R1']);
        expect(server.state.rotations).toBe(1);
        expect(server.state.familyRevoked).toBe(false);

        // E B converge pelo evento `storage`, que é o caminho barato.
        b.deliverStorage();
        expect(b.client.getAccessToken()).toBe(a.client.getAccessToken());
    });
});

describe('renovação de token entre abas — aba ociosa (evento storage)', () => {
    it('(c) a aba que dormiu adota o par novo e usa o token novo, sem tentar renovar', async () => {
        const server = makeAuthServer();
        vi.stubGlobal('navigator', { locks: makeLockManager().manager });
        seedTokens({ ttlMs: 10000 });

        const a = openTab(server.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();
        const antigo = b.client.getAccessToken();

        await a.client.refresh();
        const novo = a.client.getAccessToken();
        expect(server.state.presented).toEqual(['R1']);

        // O navegador entrega o evento a TODO documento da origem menos quem escreveu.
        b.deliverStorage();
        expect(b.client.getAccessToken()).toBe(novo);
        expect(b.client.getAccessToken()).not.toBe(antigo);

        // E a próxima requisição da aba ociosa sai com o token novo, sem passar pelo refresh.
        await b.client.getMe();
        expect(server.state.presented).toEqual(['R1']);
        expect(server.state.bearers).toEqual([`Bearer ${novo}`]);
    });

    it('(c2) o evento é entregue ao handler que o construtor registrou, e dispose() o remove', () => {
        const server = makeAuthServer();
        const b = openTab(server.fetch);
        expect(typeof b.handler).toBe('function');
        b.client.dispose();
        expect(removedHandlers).toContain(b.handler);
    });

    it('(f) não pisa no token efêmero do link público (memória sem refresh, disco desatualizado)', () => {
        const server = makeAuthServer();
        seedTokens();
        const b = openTab(server.fetch);
        const publico = mintAccess({ ttlMs: 60 * 60 * 1000, sub: 'link-publico' });
        b.client.setEphemeralToken(publico);

        ls.setItem(TOKEN_KEY, JSON.stringify({
            accessToken: mintAccess({ ttlMs: 60 * 60 * 1000 }),
            refreshToken: 'R9',
        }));
        b.deliverStorage();

        expect(b.client.getAccessToken()).toBe(publico);
    });

    it('(g) remoção do item por outra aba NÃO desloga esta', () => {
        const server = makeAuthServer();
        const acesso = seedTokens();
        const b = openTab(server.fetch);
        b.client.loadStoredTokens();

        b.deliverStorage(null);

        expect(b.client.getAccessToken()).toBe(acesso);
        expect(b.client.isAuthenticated()).toBe(true);
    });

    it('(h) não adota token de OUTRO usuário, nem par mais VELHO, nem chave alheia', () => {
        const server = makeAuthServer();
        const acesso = seedTokens({ ttlMs: 60000 });
        const b = openTab(server.fetch);
        b.client.loadStoredTokens();

        // Outro `sub`, mesmo sendo mais novo.
        b.deliverStorage(JSON.stringify({
            accessToken: mintAccess({ ttlMs: 60 * 60 * 1000, sub: 'user-2' }),
            refreshToken: 'RX',
        }));
        expect(b.client.getAccessToken()).toBe(acesso);

        // Mais velho que o da memória (evento atrasado): ignorado, sem rollback.
        b.deliverStorage(JSON.stringify({
            accessToken: mintAccess({ ttlMs: 5000 }),
            refreshToken: 'RY',
        }));
        expect(b.client.getAccessToken()).toBe(acesso);

        // Outra chave do localStorage não é da conta deste listener.
        b.deliverStorage(JSON.stringify({ accessToken: mintAccess({ ttlMs: 60 * 60 * 1000 }) }), 'ebgeo_trace');
        expect(b.client.getAccessToken()).toBe(acesso);
    });
});

describe('renovação de token entre abas — SEM navigator.locks (caminho degradado)', () => {
    beforeEach(() => {
        // Contexto inseguro (http puro) ou navegador antigo: a API simplesmente não existe.
        vi.stubGlobal('navigator', {});
    });

    it('(d1) a aba atrasada relê o disco e adota, em vez de apresentar o token já revogado', async () => {
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });

        const a = openTab(server.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        await a.client.refresh(); // R1 -> R2, persiste
        // A aba B perdeu o evento (dormindo/bfcache) e ainda tem R1 na memória.
        await b.client.refresh();

        expect(server.state.presented).toEqual(['R1']);
        expect(server.state.familyRevoked).toBe(false);
        expect(b.client.getAccessToken()).toBe(a.client.getAccessToken());
    });

    it('(d2) na corrida real sem lock o perdedor toma 401 e SOBREVIVE adotando o par do vencedor', async () => {
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });

        const gate = server.gatedFetch();
        const a = openTab(gate.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        let perdeuSessao = false;
        a.client.setAuthLostHandler(() => { perdeuSessao = true; });

        const pA = a.client.refresh(); // sai com R1 e fica presa no portão
        await b.client.refresh();      // chega primeiro ao servidor e leva a rotação
        gate.release();
        await pA;                      // 401 dentro da graça, relê o disco, adota

        expect(server.state.presented).toEqual(['R1', 'R1']);
        expect(server.state.rotations).toBe(1);
        expect(server.state.familyRevoked).toBe(false);
        expect(perdeuSessao).toBe(false);
        expect(a.client.getAccessToken()).toBe(b.client.getAccessToken());
        expect(a.client.isAuthenticated()).toBe(true);
    });

    it('(d2b) o perdedor sobrevive mesmo quando o evento `storage` chega ANTES do 401', async () => {
        // ESTA É A ORDEM REAL DO NAVEGADOR, e o caso (d2) acima não a cobre: o evento `storage`
        // é local e síncrono, enquanto a resposta 401 vem pela rede, então na prática o listener
        // já adotou o par do vencedor QUANDO o 401 chega.
        //
        // Foi por aqui que a correção original deslogava uma sessão viva: o tratamento do 401
        // perguntava ao DISCO se havia par mais novo, e como o listener já tinha adotado, o par
        // do disco era idêntico ao da memória, `_adoptStoredTokens` recusava, e o ramo terminal
        // rodava `clearTokens()` mais o aviso de sessão perdida. Pior: o `clearTokens()` apaga a
        // chave do localStorage, então a aba perdedora destruía o par que a vencedora tinha
        // acabado de rotacionar. Medido em navegador real: uma aba morria em 3 de 5 ensaios.
        //
        // A pergunta certa é "o token que apresentei ainda é o que eu tenho".
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });

        const gate = server.gatedFetch();
        const a = openTab(gate.fetch);
        const b = openTab(server.fetch);
        a.client.loadStoredTokens();
        b.client.loadStoredTokens();

        let perdeuSessao = false;
        a.client.setAuthLostHandler(() => { perdeuSessao = true; });

        const pA = a.client.refresh();  // sai com R1, fica presa no portão
        await b.client.refresh();       // vence e rotaciona
        a.deliverStorage();             // o navegador entrega o evento à perdedora AGORA
        gate.release();
        await pA;                       // só então o 401 chega

        expect(perdeuSessao).toBe(false);
        expect(a.client.isAuthenticated()).toBe(true);
        expect(a.client.getAccessToken()).toBe(b.client.getAccessToken());
        expect(server.state.familyRevoked).toBe(false);
        // A perdedora não pode ter apagado do disco o par que a vencedora gravou.
        expect(ls.getItem(TOKEN_KEY)).not.toBeNull();
        expect(JSON.parse(ls.getItem(TOKEN_KEY)).refreshToken).toBe('R2');
    });

    it('(d3) sem lock, uma aba sozinha renova exatamente como antes', async () => {
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });
        const a = openTab(server.fetch);
        a.client.loadStoredTokens();

        await a.client.refresh();

        expect(server.state.rotations).toBe(1);
        expect(JSON.parse(ls.getItem(TOKEN_KEY)).refreshToken).toBe('R2');
    });

    it('(d4) 401 que é MESMO terminal continua encerrando a sessão (o adotar não engole)', async () => {
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });
        const a = openTab(server.fetch);
        a.client.loadStoredTokens();

        let perdeuSessao = false;
        a.client.setAuthLostHandler(() => { perdeuSessao = true; });
        // Senha trocada / família revogada: o disco NÃO tem par mais novo.
        server.state.current = 'OUTRO';

        await expect(a.client.refresh()).rejects.toMatchObject({ status: 401 });

        expect(perdeuSessao).toBe(true);
        expect(a.client.isAuthenticated()).toBe(false);
        expect(ls.getItem(TOKEN_KEY)).toBeNull();
        expect(server.state.familyRevoked).toBe(true);
    });
});

describe('margem de renovação', () => {
    it('adotar só evita a ida ao servidor quando o token adotado sobrevive à margem', async () => {
        // Guarda contra a versão ingênua do desenho: "achei par novo no disco, pronto".
        // Um par novo que já está dentro da margem precisa rotacionar assim mesmo.
        vi.stubGlobal('navigator', {});
        const server = makeAuthServer();
        seedTokens({ ttlMs: 10000 });
        const b = openTab(server.fetch);
        b.client.loadStoredTokens();

        ls.setItem(TOKEN_KEY, JSON.stringify({
            accessToken: mintAccess({ ttlMs: SKEW_MS - 5000 }),
            refreshToken: 'R1',
        }));

        await b.client.refresh();

        expect(server.state.presented).toEqual(['R1']);
        expect(server.state.rotations).toBe(1);
    });
});
