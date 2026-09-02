// Path: tests/unit/migalhas-no-cliente-http.test.js

/**
 * @fileoverview O ALIMENTADOR DE MIGALHAS DO CLIENTE HTTP: uma linha por pedido TERMINADO, com a
 * forma da rota, o código e a duração, e nada mais.
 *
 * POR QUE ELE VALE A PENA: a assinatura de um `TypeError` é a mesma quando o servidor respondeu 200
 * e quando respondeu 500 três vezes antes, e as duas leituras pedem providências opostas. O que
 * torna isto seguro é o que NÃO entra: o corpo (feição, nome, coordenada), a query (`?verify=`, o
 * termo digitado) e o id de qualquer linha, que `normalizarRota` troca por `:id`/`:n`.
 *
 * O `fetch` É INJETADO, que é a única forma honesta de medir o caminho de falha: um pedido que não
 * teve resposta é justamente o mais informativo da trilha, e é o que um registro feito só no
 * caminho feliz perderia.
 *
 * CONTROLE NEGATIVO conferido revertendo: tire o `catch` que registra a falha de rede e o caso
 * "sem-resposta" fica vermelho; troque `normalizarRota(caminho)` por `caminho` e os casos do UUID e
 * da query ficam vermelhos.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from '@store/sync/api-client.js';
import { migalhas, TipoDeMigalha } from '@js/session/migalhas.js';

const ATLAS = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** Uma resposta com a superfície que `_request` lê. */
function resposta(status, corpo) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
    };
}

/** Um cliente com `fetch` de mentira, que também guarda o que lhe pediram. */
function clienteCom(fetchImpl) {
    const pedidos = [];
    const cliente = new ApiClient({
        baseUrl: 'http://api.test/api/v1',
        fetch: (url, opcoes) => {
            pedidos.push({ url, opcoes });
            return fetchImpl(url, opcoes);
        },
    });
    return { cliente, pedidos };
}

/** Os textos das migalhas de API registradas até agora. */
const trilhaDeApi = () => migalhas.listar()
    .filter((m) => m.tipo === TipoDeMigalha.API)
    .map((m) => m.texto);

beforeEach(() => {
    migalhas.limpar();
});

afterEach(() => {
    migalhas.limpar();
});

describe('uma migalha por pedido terminado', () => {
    it('o pedido bem-sucedido vira `MÉTODO rota status duração`', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: { ok: true } }));
        await cliente._request('GET', '/config', { auth: false });
        expect(trilhaDeApi()).toHaveLength(1);
        expect(trilhaDeApi()[0]).toMatch(/^GET \/config 200 \d+ms$/);
        expect(migalhas.listar()[0].tipo).toBe(TipoDeMigalha.API);
    });

    it('o UUID da rota vira `:id` e o número vira `:n`', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: [] }));
        await cliente._request('GET', `/atlas/${ATLAS}/maps/12`, { auth: false });
        expect(trilhaDeApi()[0]).toMatch(/^GET \/atlas\/:id\/maps\/:n 200 \d+ms$/);
        expect(trilhaDeApi()[0]).not.toContain(ATLAS);
    });

    it('a QUERY não viaja, credencial de uso único inclusive', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: [] }));
        await cliente._request('GET', '/nomes/busca?q=Cel%20Fulano&verify=segredo', { auth: false });
        const [migalha] = trilhaDeApi();
        expect(migalha).not.toContain('?');
        expect(migalha).not.toContain('Fulano');
        expect(migalha).not.toContain('segredo');
        expect(migalha).toMatch(/^GET \/nomes\/busca 200 \d+ms$/);
    });

    it('o CORPO enviado não viaja', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: {} }));
        await cliente._request('POST', '/atlas', {
            auth: false,
            body: { nome: 'Atlas do Cel Fulano', coords: [-43.98765, -22.12345] },
        });
        expect(trilhaDeApi()).toHaveLength(1);
        expect(trilhaDeApi().join(' ')).not.toContain('Fulano');
        expect(trilhaDeApi().join(' ')).not.toContain('43.98');
        expect(trilhaDeApi()[0]).toMatch(/^POST \/atlas 200 \d+ms$/);
    });

    it('o pedido que FALHA registra o status, e continua lançando `ApiError`', async () => {
        const { cliente } = clienteCom(async () => resposta(500, { error: { message: 'boom' } }));
        await expect(cliente._request('POST', `/atlas/${ATLAS}/sync`, { auth: false }))
            .rejects.toBeInstanceOf(ApiError);
        expect(trilhaDeApi()[0]).toMatch(/^POST \/atlas\/:id\/sync 500 \d+ms$/);
    });

    it('o 204 sem corpo também deixa migalha (ele é um pedido que terminou)', async () => {
        const { cliente } = clienteCom(async () => resposta(204));
        await cliente._request('POST', '/auth/logout', { auth: false });
        expect(trilhaDeApi()[0]).toMatch(/^POST \/auth\/logout 204 \d+ms$/);
    });
});

describe('o pedido SEM resposta, que é o mais informativo da trilha', () => {
    it('a rejeição do `fetch` vira `sem-resposta`, e o erro segue subindo', async () => {
        const { cliente } = clienteCom(async () => { throw new TypeError('Failed to fetch'); });
        await expect(cliente._request('GET', '/config', { auth: false }))
            .rejects.toThrow('Failed to fetch');
        expect(trilhaDeApi()).toEqual([expect.stringMatching(/^GET \/config sem-resposta \d+ms$/)]);
    });

    it('o prazo estourado (abort) também vira `sem-resposta`', async () => {
        const { cliente } = clienteCom((url, opcoes) => new Promise((_, rejeitar) => {
            opcoes.signal.addEventListener('abort', () => {
                const erro = new Error('The operation was aborted');
                erro.name = 'AbortError';
                rejeitar(erro);
            });
        }));
        await expect(cliente._request('GET', '/config', { auth: false, timeoutMs: 5 }))
            .rejects.toThrow(/aborted/);
        expect(trilhaDeApi()[0]).toMatch(/^GET \/config sem-resposta \d+ms$/);
    });
});

describe('a telemetria nunca custa um pedido', () => {
    it('vários pedidos produzem várias migalhas, na ordem', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: null }));
        await cliente._request('GET', '/config', { auth: false });
        await cliente._request('GET', '/auth/me', { auth: false });
        expect(trilhaDeApi()).toHaveLength(2);
        expect(trilhaDeApi()[0]).toContain('/config');
        expect(trilhaDeApi()[1]).toContain('/auth/me');
    });

    it('o anel cheio não quebra pedido nenhum (o mais velho apenas cai)', async () => {
        const { cliente } = clienteCom(async () => resposta(200, { data: null }));
        for (let i = 0; i < 40; i++) {
            await cliente._request('GET', `/atlas/${i}`, { auth: false });
        }
        expect(migalhas.tamanho()).toBe(30);
        expect(trilhaDeApi()[29]).toMatch(/^GET \/atlas\/:n 200 \d+ms$/);
    });
});
