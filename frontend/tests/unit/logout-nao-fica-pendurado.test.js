// Path: tests/unit/logout-nao-fica-pendurado.test.js

/**
 * @fileoverview A saida da conta contra um backend que aceita a conexao e nunca responde.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE. `apiClient.logout()` chamava `_request` sem `timeoutMs`, e
 * `_request` so monta o `AbortController` quando recebe um. O padrao SEM limite e deliberado e
 * serve a transferencia grande em rede degradando, onde abortar e pior que esperar; um logout nao
 * transfere nada. O resultado era uma saida pendurada pelo tempo de vida do socket, com o usuario
 * olhando um menu que nao fecha.
 *
 * O QUE ESTE VERDE NAO PROMETE. Ele nao promete ganho de tempo: contra um backend que responde, o
 * ganho e ZERO, e o caso "o backend que responde nao espera o prazo" existe justamente para dizer
 * isso por medida. O que se prova aqui e a conversao de uma espera INFINITA numa espera LIMITADA.
 *
 * O QUE ESTE VERDE PROVARIA SE O CODIGO ESTIVESSE ERRADO. O caso do backend mudo afirma tres
 * coisas em sequencia, e a do meio e o controle negativo: o pedido SAI (senao um logout que nem
 * chama a rota passaria), ANTES do prazo ainda esta pendurado (senao qualquer coisa que resolva
 * cedo passaria), e DEPOIS do prazo assentou com os tokens fora.
 *
 * O prazo e LIDO DA FONTE, nunca digitado aqui: um teste com o numero copiado mede a copia, e
 * continua verde depois de alguem trocar a constante por um valor absurdo.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiClient } from '@store/sync/api-client.js';

/** @returns {Promise<string>} O texto-fonte de um arquivo do app, para asseracao estrutural. */
async function fonteDe(caminhoRelativo) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(caminhoRelativo, import.meta.url), 'utf-8');
}

/** @returns {Promise<number>} O valor de `LOGOUT_TIMEOUT_MS`, lido do proprio api-client. */
async function prazoDoLogout() {
    const fonte = await fonteDe('../../src/js/store/sync/api-client.js');
    const achado = fonte.match(/const LOGOUT_TIMEOUT_MS = (\d+);/);
    // Cobertura vazia: uma regex que nao casa devolveria NaN e faria todo avanco de relogio
    // abaixo virar no-op, com os casos passando por acidente.
    expect(achado?.[1]).toBeTruthy();
    return Number(achado[1]);
}

/** @returns {Error} O erro que um `fetch` real produz quando o sinal aborta. */
function erroDeAborto() {
    const erro = new Error('The operation was aborted');
    erro.name = 'AbortError';
    return erro;
}

/**
 * Um backend que aceita a conexao e nunca responde. Ele honra o `AbortSignal` como o `fetch` real:
 * rejeita quando abortam, e fica pendurado para sempre quando nao ha sinal nenhum.
 * @param {Array<{url: string, signal: AbortSignal|null}>} registro
 * @returns {Function}
 */
function fetchMudo(registro) {
    return vi.fn((url, opts = {}) => new Promise((_resolve, reject) => {
        const signal = opts.signal ?? null;
        registro.push({ url, signal });
        if (!signal) return;
        if (signal.aborted) { reject(erroDeAborto()); return; }
        signal.addEventListener('abort', () => reject(erroDeAborto()));
    }));
}

/**
 * @param {Function} fetchImpl
 * @returns {ApiClient} Cliente com um par de tokens que NAO sao JWT, para que a renovacao
 *   proativa leia `exp` como ilegivel e nao dispare um refresh no meio da medida.
 */
function clienteAutenticado(fetchImpl) {
    const client = new ApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchImpl });
    client.setTokens({ accessToken: 'access-nao-jwt', refreshToken: 'refresh-nao-jwt' });
    return client;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('logout com limite de tempo', () => {
    it('o backend mudo nao pendura a saida, e os tokens saem assim mesmo', async () => {
        const prazo = await prazoDoLogout();
        vi.useFakeTimers();
        const chamadas = [];
        const client = clienteAutenticado(fetchMudo(chamadas));

        let assentou = false;
        const saida = client.logout().then(() => { assentou = true; });

        // O pedido SAI, e sai com sinal. Sem `timeoutMs` o `_request` nao monta
        // `AbortController` nenhum, e e a ausencia do sinal que deixava a saida eterna.
        await vi.advanceTimersByTimeAsync(0);
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0].url).toContain('/auth/logout');
        expect(chamadas[0].signal).not.toBe(null);

        // CONTROLE NEGATIVO: um milissegundo antes do prazo ainda esta pendurado. Sem esta
        // metade, o verde abaixo ficaria igual num logout que resolve por qualquer outro motivo.
        await vi.advanceTimersByTimeAsync(prazo - 1);
        expect(assentou).toBe(false);
        expect(client.isAuthenticated()).toBe(true);

        await vi.advanceTimersByTimeAsync(2);
        await saida;
        expect(assentou).toBe(true);
        // O `AbortError` e rejeicao de fetch: cai no `catch` vazio, e o `finally` limpa.
        expect(client.isAuthenticated()).toBe(false);
        // E o servidor foi chamado UMA vez: `_retry: false` continua valendo, e um refresh mais
        // repeticao pediria ao servidor que revogasse com um token que ele acabou de recusar.
        expect(chamadas).toHaveLength(1);

        client.dispose();
    });

    it('o backend que responde nao espera o prazo: o ganho de tempo aqui e ZERO', async () => {
        vi.useFakeTimers();
        const fetchOk = vi.fn(async () => ({ ok: true, status: 204, text: async () => '' }));
        const client = clienteAutenticado(fetchOk);

        let assentou = false;
        const saida = client.logout().then(() => { assentou = true; });

        // Sem avancar um milissegundo alem do necessario para drenar as microtarefas.
        await vi.advanceTimersByTimeAsync(0);
        await saida;

        expect(assentou).toBe(true);
        expect(fetchOk).toHaveBeenCalledTimes(1);
        expect(client.isAuthenticated()).toBe(false);

        client.dispose();
    });

    it('sem tokens nao ha o que revogar, e nada e pedido ao servidor', async () => {
        const chamadas = [];
        const client = new ApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchMudo(chamadas) });

        await client.logout();

        expect(chamadas).toHaveLength(0);
        expect(client.isAuthenticated()).toBe(false);

        client.dispose();
    });

    it('o corpo do logout carrega o prazo, mantem _retry: false e ainda limpa no finally', async () => {
        const fonte = await fonteDe('../../src/js/store/sync/api-client.js');
        const inicio = fonte.indexOf('    async logout() {');
        expect(inicio).toBeGreaterThan(0);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n    }', inicio));

        expect(corpo).toContain('timeoutMs: LOGOUT_TIMEOUT_MS');
        expect(corpo).toContain('_retry: false');
        expect(corpo).toContain('clearTokens()');
        expect(corpo).toMatch(/finally\s*\{/);

        // O LIMITE DO REFRESH NAO FOI TOCADO. Ele e compartilhado por todo o cliente e tem
        // alcance muito maior que o de uma saida, entao um prazo de logout que vazasse para la
        // seria uma mudanca de escopo disfarcada de conserto de latencia.
        const refresh = fonte.slice(fonte.indexOf('    async refresh() {'));
        expect(refresh.slice(0, refresh.indexOf('\n    }'))).not.toContain('LOGOUT_TIMEOUT_MS');
    });
});
