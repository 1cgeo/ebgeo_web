// Path: tests/e2e/diag-enderecos.e2e.test.js

/**
 * @fileoverview A FRONTEIRA DE `GET /api/v1/diag/enderecos`, contra o backend REAL.
 *
 * A seção "Endereços de acesso" da aba Diagnóstico (`diag-tab.js`) lê esta rota pelo `_request` do
 * cliente, e as frases dela (`enderecos-phrases.js`) decidem, a partir do documento, se ele é
 * reconhecível e qual dos três desfechos o bloco de nomes tem. O que SÓ esta camada prova é que o
 * documento que o servidor de verdade manda, desembrulhado uma vez pelo cliente de verdade, é o
 * que aquelas duas funções esperam: um campo renomeado de um lado deixaria a seção em falha
 * permanente, com as duas suítes unitárias verdes.
 *
 * O CONTEÚDO NÃO É ASSERIDO, só a FORMA, e de propósito: o backend desta camada roda com
 * `NODE_ENV=test`, em que o log em arquivo fica desligado, e o diretório que ele lê é o do
 * checkout. Esta rota pode, portanto, responder cega ou com as linhas de outra rodada; o que ela
 * não pode é responder num formato que a tela não reconhece.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin } from './helpers/harness.js';
import { promoteToAdmin } from './helpers/db.js';
import {
    DESFECHO_DAS_CONTAS,
    desfechoDasContas,
    enderecosReconhecido,
} from '../../src/js/admin/enderecos-phrases.js';

describe.skipIf(E2E_SKIP)('E2E — os endereços de acesso pela fronteira real', () => {
    let apiAdmin;
    let apiComum;

    beforeAll(async () => {
        apiAdmin = makeApi();
        const { username } = await registerAndLogin(apiAdmin, { nome: 'Monitor E2E' });
        await promoteToAdmin(username);
        apiComum = makeApi();
        await registerAndLogin(apiComum, { nome: 'Comum E2E' });
    });

    it('o administrador recebe um documento que a seção RECONHECE, com a procedência e os nomes', async () => {
        const doc = await apiAdmin._request('GET', '/diag/enderecos?desde=1h&limite=5');

        expect(enderecosReconhecido(doc)).toBe(true);
        // O bloco de nomes EXISTE: ausente, a tela acusaria "o servidor não informou", que é a
        // frase da implantação anterior.
        expect(desfechoDasContas(doc.contas)).not.toBe(DESFECHO_DAS_CONTAS.AUSENTE);
        // A procedência mora em `janela`, que é onde a seção pergunta pelo leitor cego e pela nota.
        expect(doc.janela).toBeTruthy();
        expect(doc.janela.desde).toBe('1h');
        expect(typeof doc.janela.diretorioAusente).toBe('boolean');
        expect(typeof doc.janela.truncado).toBe('boolean');
        expect(typeof doc.recenteMs).toBe('number');
        expect(doc.enderecos.length).toBeLessThanOrEqual(5);
        for (const e of doc.enderecos) {
            for (const campo of ['ip', 'indeterminado', 'primeira', 'ultima', 'recente', 'requisicoes',
                'comErro', 'sessoes', 'anonimas', 'deLinkPublico', 'contasDistintas', 'contas']) {
                expect(e, `o endereço precisa carregar \`${campo}\``).toHaveProperty(campo);
            }
        }
    });

    it('o usuário COMUM é recusado, e a janela além do teto também', async () => {
        await expect(apiComum._request('GET', '/diag/enderecos')).rejects.toThrow();
        await expect(apiAdmin._request('GET', '/diag/enderecos?desde=30d')).rejects.toThrow();
    });
});
