// Path: tests/e2e/sync-request-em-dia.e2e.test.js

/**
 * @fileoverview E2E de CONTRATO: o handshake que diz "estou em dia" recebe cauda vazia, e o que
 * não diz nada continua recebendo o retrato inteiro. Os dois lados são reais (WsClient de
 * produção contra o gateway do backend), que é o ponto: o campo `haveSnapshot` é fio, e fio só se
 * verifica com os dois pacotes no ar.
 *
 * O DEFEITO QUE ELE FECHA. `lastVersion: 0` dizia duas coisas ao mesmo tempo, "não tenho nada" e
 * "estou em dia com um atlas que nunca teve operação escrita", e todo atlas fica em
 * `current_version = 0` até a primeira op. `pullOperations` lia o zero como "manda tudo", então a
 * abertura de todo atlas novo era servida com DOIS retratos completos idênticos: o do pull HTTP e
 * o do handshake logo em seguida. O cliente já recusava ENCENAR o segundo (`eb24ba9f`); o que
 * sobrava era banda.
 *
 * O ATLAS DESTE ARQUIVO É O CASO EXATO, e ele não é artificial: `POST /atlas` cria o atlas, o
 * mapa "Mapa 1" e as camadas dele FORA do log de operações, então o retrato tem conteúdo e a
 * versão é zero. É o que torna as duas afirmações distinguíveis: a cauda vem vazia enquanto o
 * retrato que ela substituiu traria um mapa inteiro.
 *
 * O CONTROLE ESTÁ NO MESMO ARQUIVO de propósito: um cliente que NÃO manda o campo, no MESMO
 * atlas e no mesmo instante, tem de continuar recebendo o retrato. É o que garante que o conserto
 * não é "o servidor parou de mandar retrato", e é a compatibilidade com o cliente que ainda não
 * conhece o campo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('e2e: sync_request de um cliente em dia com um atlas em versão zero', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient[]} */
    const sockets = [];

    /** Abre um WsClient real, coleta os `sync_response` e devolve os dois. */
    async function abrir(opts) {
        const ws = makeWs(api, { clientId: newClientId() });
        sockets.push(ws);
        /** @type {Object[]} */
        const respostas = [];
        // Devolver `true` é obrigatório: `_queueApply` lê `false` como falha de escrita local e
        // fecha o socket, e a resposta que este teste quer ler é justamente esta.
        ws.on('syncResponse', (msg) => {
            respostas.push(msg);
            return true;
        });
        const conectado = await ws.connect(atlasId, opts);
        expect(conectado.type).toBe('connected');
        return { ws, respostas };
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Em Dia' });
        const atlas = await createAtlas(api, { name: 'Atlas em versão zero' });
        atlasId = atlas.id;
    });

    afterAll(() => {
        for (const ws of sockets) ws.disconnect();
    });

    it('a premissa: um atlas recém-criado tem conteúdo e está em versão ZERO', async () => {
        // Asserida, não suposta: se `POST /atlas` passar a escrever uma op, os dois casos abaixo
        // deixam de medir o zero e passam a medir uma versão qualquer, verdes e mudos.
        const inicial = await api.pullSync(atlasId, 0);
        expect(inicial.isSnapshot).toBe(true);
        expect(inicial.currentVersion).toBe(0);
        expect(inicial.snapshot.maps.length).toBeGreaterThan(0);
    });

    it('COM o campo, o handshake recebe cauda vazia em vez do retrato', async () => {
        const { respostas } = await abrir({ lastVersion: 0, haveSnapshot: true });

        const resposta = await waitFor(() => respostas[0], { timeout: 6000 });
        expect(resposta.isSnapshot).toBe(false);
        expect(resposta.ops).toEqual([]);
        expect(resposta.snapshot).toBeUndefined();
        expect(resposta.currentVersion).toBe(0);
    });

    it('SEM o campo, o mesmo handshake continua recebendo o retrato completo', async () => {
        const { respostas } = await abrir({ lastVersion: 0 });

        const resposta = await waitFor(() => respostas[0], { timeout: 6000 });
        expect(resposta.isSnapshot).toBe(true);
        expect(resposta.snapshot.atlas.id).toBe(atlasId);
        expect(resposta.snapshot.maps.length).toBeGreaterThan(0);
    });
});
