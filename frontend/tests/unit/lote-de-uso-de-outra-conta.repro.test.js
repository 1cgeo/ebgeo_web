// Path: tests/unit/lote-de-uso-de-outra-conta.repro.test.js

/**
 * O LOTE DE USO DE OUTRA CONTA ESPERA O DONO, e não é apagado (2026-09-23).
 *
 * A RAIZ. As quatro páginas instalam a telemetria ANTES de restaurar a sessão, então toda carga de
 * página de quem está logado começa com identidade `null` e só depois vira a conta. O primeiro
 * lote dessa carga passava por `coletar()`, cujo `valido()` APAGAVA todo lote guardado de outra
 * identidade e somava uma falha por lote. O lote apagado era justamente o que a página anterior
 * escreveu no `pagehide`: quem está logado perdia esse lote sempre que ele não chegava na primeira
 * tentativa (o anônimo não, porque `null` é a identidade dele nas duas páginas), e toda navegação
 * logada mandava `falhasColeta = 2` no pulso de presença, alarme falso no painel.
 *
 * O CONTROLE foi medido contra o código anterior: o primeiro caso reprova com o lote apagado e
 * uma falha contada, e o caso da fiação reprova porque o lote nunca é enviado.
 *
 * O SEGUNDO DEFEITO, da mesma família: a descarga do `pagehide` fazia `await authHeader()`, que
 * renova o token nos últimos 30 s, e dentro de uma página que está saindo a renovação morre com
 * ela e o `fetch` nunca sai. O caso "na saída" prende que o pedido sai SÍNCRONO, com o token em
 * memória, sem passar pela renovação.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sessao = vi.hoisted(() => {
    const ouvintes = new Set();
    return {
        userId: null,
        ouvintes,
        mudar(id) {
            this.userId = id;
            for (const f of [...ouvintes]) f({ userId: id });
        },
    };
});

const credencial = vi.hoisted(() => ({
    token: null,
    // A renovação que nunca responde: é o que acontece com a rotação iniciada numa página que sai.
    renovacaoTravada: false,
}));

vi.mock('@store/sync/session-context.js', () => ({
    sessionContext: {
        get userId() { return sessao.userId; },
        onSessionChanged(f) { sessao.ouvintes.add(f); return () => sessao.ouvintes.delete(f); },
    },
}));

vi.mock('@store/sync/api-client.js', () => ({
    apiClient: {
        authHeader: vi.fn(() => (credencial.renovacaoTravada
            ? new Promise(() => {})
            : Promise.resolve(credencial.token ? { Authorization: `Bearer ${credencial.token}` } : {}))),
        getAccessToken: vi.fn(() => credencial.token),
    },
}));

const { apiClient } = await import('@store/sync/api-client.js');
const { criarTransporteDeUso, TETO_DA_FILA } = await import('@js/session/uso-transporte.js');
const { instalarUso } = await import('@js/session/uso-telemetria.js');
const { anunciarSaidaDaConta, descartarCorpo } = await import('@js/session/uso-lote.js');
const { instalarPresenca, configurarPendenciasDePresenca } = await import('@js/session/presenca.js');

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const URL_DE_USO = '/api/v1/uso/eventos';
const PREFIXO = 'ebgeo:telemetria:lote:';

/** Um `localStorage` de mentira, com a ordem de inserção como ordem de chave. */
function criarArmazenamento() {
    const dados = new Map();
    return {
        dados,
        get length() { return dados.size; },
        key: (i) => [...dados.keys()][i] ?? null,
        getItem: (k) => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: (k) => { dados.delete(k); },
    };
}

let contador = 0;
/** Guarda um lote como a página anterior o teria deixado. */
function guardarLote(armazenamento, identidade, { expiraEm = 3600000 } = {}) {
    contador++;
    const loteId = `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
    armazenamento.setItem(PREFIXO + loteId, JSON.stringify({
        corpo: { loteId, identidade, eventos: [] },
        url: URL_DE_USO,
        identidade,
        expira: Date.now() + expiraEm,
    }));
    return loteId;
}

/** As identidades dos lotes guardados, na ordem das chaves. */
function identidadesGuardadas(armazenamento) {
    return [...armazenamento.dados.entries()]
        .filter(([k]) => k.startsWith(PREFIXO))
        .map(([, v]) => JSON.parse(v).identidade);
}

/** Os `loteId` que o `fetch` de mentira recebeu na rota de uso. */
function lotesEnviados(fetch) {
    return fetch.mock.calls
        .filter(([url]) => String(url).endsWith('/uso/eventos'))
        .map(([, init]) => JSON.parse(init.body).loteId);
}

beforeEach(() => {
    sessao.userId = null;
    sessao.ouvintes.clear();
    credencial.token = null;
    credencial.renovacaoTravada = false;
    apiClient.authHeader.mockClear();
    apiClient.getAccessToken.mockClear();
});

describe('criarTransporteDeUso: lote de outra identidade', () => {
    it('com identidade null, um lote pendente de U NÃO é apagado nem conta falha', async () => {
        const armazenamento = criarArmazenamento();
        const loteDeU = guardarLote(armazenamento, U);
        const fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => null });

        t.enviar({ eventos: [] }, URL_DE_USO);
        await vi.waitFor(() => expect(lotesEnviados(fetch)).toHaveLength(1));

        const resultado = {
            sobreviveu: armazenamento.dados.has(PREFIXO + loteDeU),
            enviado: lotesEnviados(fetch).includes(loteDeU),
            falhas: t.falhas(),
        };
        expect(resultado).toEqual({ sobreviveu: true, enviado: false, falhas: 0 });
    });

    it('com identidade U, `retomar()` envia o lote de U e o anônimo, e nunca o de V', async () => {
        const armazenamento = criarArmazenamento();
        const loteDeU = guardarLote(armazenamento, U);
        const loteDeV = guardarLote(armazenamento, V);
        const loteAnonimo = guardarLote(armazenamento, null);
        credencial.token = 'token-de-u';
        const fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => U });

        t.retomar();
        await vi.waitFor(() => expect(lotesEnviados(fetch)).toHaveLength(2));

        expect(lotesEnviados(fetch).sort()).toEqual([loteDeU, loteAnonimo].sort());
        expect(lotesEnviados(fetch)).not.toContain(loteDeV);
        const cabecalhos = fetch.mock.calls.map(([, init]) => init.headers.Authorization);
        expect(cabecalhos).toEqual(['Bearer token-de-u', 'Bearer token-de-u']);
        // O de V continua guardado, esperando o dono, e nada disso é falha.
        await vi.waitFor(() => expect(identidadesGuardadas(armazenamento)).toEqual([V]));
        expect(t.falhas()).toBe(0);
    });

    it('a identidade relida depois do cabeçalho PULA o lote, sem apagar e sem contar', async () => {
        const armazenamento = criarArmazenamento();
        const loteDeU = guardarLote(armazenamento, U);
        let quem = U;
        // COM credencial, para que o pulo medido aqui seja o da identidade, e não o da falta de token.
        credencial.token = 'token-de-u';
        const fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => quem });

        t.retomar();
        // A conta sai entre a leitura do cabeçalho e o pedido.
        quem = null;
        await Promise.resolve();
        await Promise.resolve();

        expect(fetch).not.toHaveBeenCalled();
        expect(armazenamento.dados.has(PREFIXO + loteDeU)).toBe(true);
        expect(t.falhas()).toBe(0);
    });

    it('o teto de 30 conta também os lotes de outra identidade, e o excedente é o mais velho', () => {
        const armazenamento = criarArmazenamento();
        const deV = [];
        for (let n = 0; n < TETO_DA_FILA + 5; n++) deV.push(guardarLote(armazenamento, V, { expiraEm: 1000 + n }));
        const fetch = vi.fn(() => new Promise(() => {}));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => null });

        t.enviar({ eventos: [] }, URL_DE_USO);

        expect(TETO_DA_FILA).toBe(30);
        expect(armazenamento.dados.size).toBe(30);
        // 35 de V mais o novo: saem os seis de V que vencem primeiro, e só eles.
        for (const id of deV.slice(0, 6)) expect(armazenamento.dados.has(PREFIXO + id)).toBe(false);
        for (const id of deV.slice(6)) expect(armazenamento.dados.has(PREFIXO + id)).toBe(true);
        expect(t.falhas()).toBe(6);
    });

    it('`esquecerDaConta(U)` apaga só os lotes de U, e não é falha', () => {
        const armazenamento = criarArmazenamento();
        guardarLote(armazenamento, U);
        guardarLote(armazenamento, U);
        guardarLote(armazenamento, V);
        guardarLote(armazenamento, null);
        armazenamento.setItem('outra-chave', JSON.stringify({ identidade: U }));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch: vi.fn() }, identidade: () => null });

        expect(t.esquecerDaConta(U)).toBe(2);
        expect(identidadesGuardadas(armazenamento)).toEqual([V, null]);
        expect(armazenamento.dados.has('outra-chave')).toBe(true);
        expect(t.esquecerDaConta(null)).toBe(0);
        expect(t.falhas()).toBe(0);
    });
});

describe('criarTransporteDeUso: na saída da página, sem renovar', () => {
    it('`motivo: saida` manda SÍNCRONO, com o token em memória, sem chamar `authHeader`', () => {
        const armazenamento = criarArmazenamento();
        credencial.token = 'token-em-memoria';
        credencial.renovacaoTravada = true;
        const fetch = vi.fn(() => new Promise(() => {}));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => U });

        t.enviar({ eventos: [] }, URL_DE_USO, { motivo: 'saida' });

        // Nenhum `await` no meio: dentro do `pagehide`, é agora ou nunca.
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-em-memoria');
        expect(fetch.mock.calls[0][1].keepalive).toBe(true);
        expect(apiClient.authHeader).not.toHaveBeenCalled();
    });

    it('`motivo: oculta` também não renova (fechar a aba esconde antes de sair)', () => {
        credencial.token = 'token-em-memoria';
        credencial.renovacaoTravada = true;
        const fetch = vi.fn(() => new Promise(() => {}));
        const t = criarTransporteDeUso({ alvo: { localStorage: criarArmazenamento(), fetch }, identidade: () => U });

        t.enviar({ eventos: [] }, URL_DE_USO, { motivo: 'oculta' });

        expect(fetch).toHaveBeenCalledOnce();
        expect(apiClient.authHeader).not.toHaveBeenCalled();
    });

    it('fora da saída, a descarga ainda renova antes de mandar', async () => {
        credencial.token = 't';
        const fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        const t = criarTransporteDeUso({ alvo: { localStorage: criarArmazenamento(), fetch }, identidade: () => U });

        t.enviar({ eventos: [] }, URL_DE_USO, { motivo: 'intervalo' });

        expect(fetch).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(apiClient.authHeader).toHaveBeenCalledOnce();
    });

    it.each([
        // Lote da CONTA: recusa de credencial é token velho, e o lote espera a renovação.
        ['saida', U, 409, true],
        ['saida', U, 401, true],
        [undefined, U, 409, true],
        [undefined, U, 401, true],
        // O que nenhum reenvio conserta sai, com conta ou sem.
        ['saida', U, 422, false],
        [undefined, U, 403, false],
        [undefined, null, 400, false],
        // Lote ANÔNIMO: não há credencial a consertar, então 409 e 401 são finais.
        [undefined, null, 409, false],
        ['saida', null, 409, false],
        [undefined, null, 401, false],
    ])('motivo %s, lote de %s, recusa %i: o lote fica para a próxima retomada = %s', async (motivo, dono, status, fica) => {
        const armazenamento = criarArmazenamento();
        credencial.token = 'token-vencido';
        const fetch = vi.fn(async () => ({ ok: false, status }));
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => dono });

        t.enviar({ eventos: [] }, URL_DE_USO, { motivo });
        await vi.waitFor(() => expect(t.falhas()).toBe(1));

        expect(fetch).toHaveBeenCalledOnce();
        expect(armazenamento.dados.size).toBe(fica ? 1 : 0);
    });
});

describe('criarTransporteDeUso: o lote da conta não sai sem credencial', () => {
    /**
     * Um servidor de mentira com a regra do controller de verdade (`registrarEventos`,
     * `backend/src/modules/uso/uso.controller.js`): corpo com identidade e pedido sem principal
     * válido é 409. `aceito` é o único token que o servidor reconhece.
     */
    function servidor(aceito) {
        return vi.fn(async (_url, init) => {
            const corpo = JSON.parse(init.body);
            const principal = init.headers.Authorization === `Bearer ${aceito}` ? U : null;
            if (corpo.identidade != null && corpo.identidade !== principal) return { ok: false, status: 409 };
            return { ok: true, status: 204 };
        });
    }

    it('logout involuntário: tokens já apagados e identidade ainda U, a retomada PULA o lote', async () => {
        // A janela de `handleSessionLost` → `_handleLogout`: `clearTokens()` já rodou, e o
        // `clearSession()` vem vários `await` depois. `authHeader()` devolve `{}` nela.
        const armazenamento = criarArmazenamento();
        const loteDeU = guardarLote(armazenamento, U);
        credencial.token = null;
        const fetch = servidor('token-de-u');
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => U });

        t.retomar();
        await vi.waitFor(() => expect(apiClient.authHeader).toHaveBeenCalledOnce());
        await new Promise((r) => { setTimeout(r, 0); });

        expect({
            enviado: fetch.mock.calls.length,
            sobreviveu: armazenamento.dados.has(PREFIXO + loteDeU),
            falhas: t.falhas(),
        }).toEqual({ enviado: 0, sobreviveu: true, falhas: 0 });
    });

    it('na saída sem token em memória, o lote da conta também não sai, e fica', () => {
        const armazenamento = criarArmazenamento();
        credencial.token = null;
        const fetch = servidor('token-de-u');
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => U });

        t.enviar({ eventos: [] }, URL_DE_USO, { motivo: 'saida' });

        expect(fetch).not.toHaveBeenCalled();
        expect(identidadesGuardadas(armazenamento)).toEqual([U]);
        expect(t.falhas()).toBe(0);
    });

    it('o lote ANÔNIMO continua saindo sem credencial', async () => {
        const armazenamento = criarArmazenamento();
        credencial.token = null;
        const fetch = servidor('token-de-u');
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => null });

        t.enviar({ eventos: [] }, URL_DE_USO);

        await vi.waitFor(() => expect(armazenamento.dados.size).toBe(0));
        expect(fetch).toHaveBeenCalledOnce();
        expect(t.falhas()).toBe(0);
    });

    it('token vencido depois de renovação que falhou: o 409 guarda o lote, e a retomada renovada o entrega', async () => {
        const armazenamento = criarArmazenamento();
        const loteDeU = guardarLote(armazenamento, U);
        credencial.token = 'token-vencido';
        const fetch = servidor('token-renovado');
        const t = criarTransporteDeUso({ alvo: { localStorage: armazenamento, fetch }, identidade: () => U });

        t.retomar();
        await vi.waitFor(() => expect(t.falhas()).toBe(1));
        expect(armazenamento.dados.has(PREFIXO + loteDeU)).toBe(true);

        credencial.token = 'token-renovado';
        t.retomar();
        await vi.waitFor(() => expect(armazenamento.dados.has(PREFIXO + loteDeU)).toBe(false));
        expect(fetch.mock.calls.map(([, init]) => init.headers.Authorization))
            .toEqual(['Bearer token-vencido', 'Bearer token-renovado']);
        expect(t.falhas()).toBe(1);
    });
});

describe('presença e corpo de resposta', () => {
    it('o pulso em voo quando a página sai NÃO pede o cabeçalho (a renovação morreria com ela)', async () => {
        let soltarPendencias;
        configurarPendenciasDePresenca(() => new Promise((resolve) => { soltarPendencias = resolve; }));
        const ouvintes = new Map();
        const fetch = vi.fn(async () => ({ ok: true, status: 204 }));
        const p = instalarPresenca({ alvo: {
            fetch, setTimeout, clearTimeout,
            addEventListener: (tipo, f) => ouvintes.set(tipo, f),
            removeEventListener: () => {},
        } });
        try {
            await vi.waitFor(() => expect(soltarPendencias).toBeTypeOf('function'));
            ouvintes.get('pagehide')({ persisted: false });
            soltarPendencias({});
            await new Promise((r) => { setTimeout(r, 20); });

            expect(apiClient.authHeader).not.toHaveBeenCalled();
            // Só a saída explícita foi ao servidor.
            expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).saindo)).toEqual([true]);
        } finally { p.desinstalar(); configurarPendenciasDePresenca(null); }
    });

    it('`descartarCorpo` LÊ o corpo (cancelar é o que o Chromium registra como abortado), e nunca lança', async () => {
        const cancel = vi.fn(() => Promise.resolve());
        const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
        descartarCorpo({ bodyUsed: false, body: { cancel }, arrayBuffer });
        expect(arrayBuffer).toHaveBeenCalledOnce();
        expect(cancel).not.toHaveBeenCalled();

        const jaLido = vi.fn(() => Promise.reject(new Error('já lido')));
        descartarCorpo({ bodyUsed: true, arrayBuffer: jaLido });
        expect(jaLido).not.toHaveBeenCalled();

        const rejeita = vi.fn(() => Promise.reject(new Error('rede caiu no meio')));
        descartarCorpo({ bodyUsed: false, arrayBuffer: rejeita });
        expect(rejeita).toHaveBeenCalledOnce();

        expect(() => descartarCorpo(undefined)).not.toThrow();
        expect(() => descartarCorpo({ ok: true })).not.toThrow();
        expect(() => descartarCorpo({ arrayBuffer: () => { throw new Error('travado'); } })).not.toThrow();
        await Promise.resolve();
    });

    it('o pulso de presença lê o corpo da resposta', async () => {
        const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
        const fetch = vi.fn(async () => ({ ok: true, status: 204, bodyUsed: false, arrayBuffer }));
        const p = instalarPresenca({ alvo: { fetch, setTimeout, clearTimeout } });
        try {
            await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
        } finally { p.desinstalar(); }
    });

    it('o lote de uso lê o corpo da resposta', async () => {
        const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
        const fetch = vi.fn(async () => ({ ok: true, status: 204, bodyUsed: false, arrayBuffer }));
        const t = criarTransporteDeUso({ alvo: { localStorage: criarArmazenamento(), fetch }, identidade: () => null });
        t.enviar({ eventos: [] }, URL_DE_USO);
        await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
    });
});

describe('instalarUso: a fiação da identidade', () => {
    let alvo;
    let desinstalar = () => {};

    /** Uma janela com o que a telemetria de uso e a presença tocam. */
    function criarAlvo() {
        const ouvintes = new Map();
        return {
            localStorage: criarArmazenamento(),
            fetch: vi.fn(async () => ({ ok: true, status: 204 })),
            setInterval: () => 0,
            clearInterval: () => {},
            setTimeout,
            clearTimeout,
            addEventListener: (tipo, f) => { ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), f]); },
            removeEventListener: (tipo, f) => {
                ouvintes.set(tipo, (ouvintes.get(tipo) ?? []).filter((g) => g !== f));
            },
            disparar: (tipo, evento = {}) => { for (const f of ouvintes.get(tipo) ?? []) f(evento); },
            document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
            location: { pathname: '/atlas.html' },
            navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0' },
        };
    }

    /** O `falhasColeta` de cada pulso de presença que saiu. */
    function falhasNosPulsos() {
        return alvo.fetch.mock.calls
            .filter(([url]) => String(url).endsWith('/uso/presenca'))
            .map(([, init]) => JSON.parse(init.body).falhasColeta)
            .filter((n) => n !== undefined);
    }

    beforeEach(() => { alvo = criarAlvo(); });
    afterEach(() => { desinstalar(); desinstalar = () => {}; });

    it('a sessão que assenta em U reenvia o lote de U da página anterior, e o pulso diz zero falhas', async () => {
        const loteDaPaginaAnterior = guardarLote(alvo.localStorage, U);
        const instalacao = instalarUso({ alvo });
        desinstalar = instalacao.desinstalar;
        expect(instalacao.instalada).toBe(true);

        credencial.token = 'token-de-u';
        sessao.mudar(U);

        await vi.waitFor(() => expect(lotesEnviados(alvo.fetch)).toContain(loteDaPaginaAnterior));
        await vi.waitFor(() => expect(alvo.localStorage.dados.has(PREFIXO + loteDaPaginaAnterior)).toBe(false));
        await vi.waitFor(() => expect(falhasNosPulsos().length).toBeGreaterThanOrEqual(2));
        expect(falhasNosPulsos().every((n) => n === 0)).toBe(true);
    });

    it('o `pagehide` de quem está logado manda o lote na hora, mesmo com a renovação travada', async () => {
        credencial.token = 'token-quase-vencido';
        desinstalar = instalarUso({ alvo }).desinstalar;
        sessao.mudar(U);
        await vi.waitFor(() => expect(lotesEnviados(alvo.fetch).length).toBeGreaterThanOrEqual(1));
        const antes = lotesEnviados(alvo.fetch).length;
        credencial.renovacaoTravada = true;

        alvo.disparar('pagehide', { persisted: false });

        const depois = alvo.fetch.mock.calls.filter(([url]) => String(url).endsWith('/uso/eventos'));
        expect(depois).toHaveLength(antes + 1);
        const ultimo = depois.at(-1)[1];
        expect(JSON.parse(ultimo.body).identidade).toBe(U);
        expect(ultimo.headers.Authorization).toBe('Bearer token-quase-vencido');
    });

    /**
     * Espera TODO envio em voo terminar. Os duplos respondem sem rede, então o que está pendente
     * depois de uma troca de identidade são promessas já resolvidas (cabeçalho, resposta), e uma
     * volta de macrotarefa as esgota; duas, por folga contra uma cadeia mais longa.
     */
    async function assentar() {
        for (let i = 0; i < 2; i++) await new Promise((r) => { setTimeout(r, 0); });
    }

    /** As chaves dos lotes guardados de uma identidade. */
    function chavesDe(identidade) {
        return [...alvo.localStorage.dados.entries()]
            .filter(([k, v]) => k.startsWith(PREFIXO) && JSON.parse(v).identidade === identidade)
            .map(([k]) => k)
            .sort();
    }

    /** Deixa lotes de U pendentes: o servidor recusa com 503 tudo o que é de uso. */
    async function entrarComServidorRecusando() {
        desinstalar = instalarUso({ alvo }).desinstalar;
        credencial.token = 'token-de-u';
        sessao.mudar(U);
        alvo.fetch.mockImplementation(async (url) => (String(url).endsWith('/uso/eventos')
            ? { ok: false, status: 503 }
            : { ok: true, status: 204 }));
        alvo.disparar('pagehide', { persisted: false });
        await assentar();
        expect(chavesDe(U).length).toBeGreaterThanOrEqual(1);
    }

    it('o gesto Sair apaga os lotes pendentes da conta que sai, e só os dela', async () => {
        const deV = guardarLote(alvo.localStorage, V);
        await entrarComServidorRecusando();

        anunciarSaidaDaConta();
        credencial.token = null;
        sessao.mudar(null);
        await assentar();

        expect(chavesDe(U)).toEqual([]);
        expect(alvo.localStorage.dados.has(PREFIXO + deV)).toBe(true);
    });

    it('a sessão perdida SEM o gesto guarda TODOS os lotes da conta, o da última descarga inclusive', async () => {
        await entrarComServidorRecusando();
        const antes = chavesDe(U);
        const enviadosAntes = alvo.fetch.mock.calls.length;

        // O CAMINHO INVOLUNTÁRIO NA ORDEM REAL: `clearTokens()` e só depois `clearSession()`.
        credencial.token = null;
        sessao.mudar(null);
        await assentar();

        const depois = chavesDe(U);
        // Nada do que estava guardado saiu, e a descarga da troca acrescentou exatamente UM lote da
        // conta (o trecho que acabou), que espera o dono em vez de sair anônimo ou ser apagado.
        expect(antes.every((k) => depois.includes(k))).toBe(true);
        expect(depois).toHaveLength(antes.length + 1);
        // E nenhum lote da conta foi ao servidor depois da troca, com ou sem credencial.
        const lotesDeUDepois = alvo.fetch.mock.calls.slice(enviadosAntes)
            .filter(([url]) => String(url).endsWith('/uso/eventos'))
            .map(([, init]) => JSON.parse(init.body).identidade)
            .filter((id) => id === U);
        expect(lotesDeUDepois).toEqual([]);
    });
});
