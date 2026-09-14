// Path: tests/e2e/matriz-posto-por-acao.e2e.test.js

/**
 * @fileoverview A MATRIZ POSTO x ACAO, medida no SERVIDOR REAL e conferida contra o CLIENTE.
 *
 * O eixo por atlas e uma escada de cinco degraus (`read < comment < write < manage < owner`) e
 * a constituicao (clausula 5.2) manda gatear por hierarquia, porque lista fechada exclui em
 * silencio o degrau que nascer no meio. A cobertura de contrato que existia media DOIS degraus:
 * `permissions-viewer` mede `read`, `sharing-write` mede `write` e o estranho. Faltavam
 * justamente `comment` e `manage`, que sao os dois que a lista fechada historicamente excluiu,
 * nos dois pacotes, com bug real.
 *
 * ESTE ARQUIVO MEDE OS CINCO CONTRA SEIS ACOES, uma por degrau de exigencia mais duas de
 * leitura, e o que ele prova nao e "o gate existe": e que a escada e MONOTONICA em cada acao
 * (quem pode, todo mundo acima pode) e que o degrau de corte e o que a constituicao declara.
 * Amostrar dois degraus nao distingue uma escada de uma lista fechada que por acaso acerta nos
 * dois amostrados.
 *
 * E ELE CONFERE O CLIENTE CONTRA A MESMA MEDICAO, que e a parte que so um teste de contrato
 * pode fazer: as duas metades desta discordancia custam coisas diferentes e as duas ja foram
 * pagas aqui. Cliente mais FROUXO que o servidor desenha um comando que enfileira uma op
 * recusada, e recusa nao-2xx nao e desenfileirada, entao a fila daquela pessoa para de andar.
 * Cliente mais ESTRITO esconde funcao que a pessoa tem direito de usar, e isso nao deixa rastro
 * nenhum: ninguem abre chamado sobre um botao que nunca viu.
 *
 * COMO O LADO DO CLIENTE E LIDO. `sessionContext.canPerformAction` e a fonte, e nao uma tabela
 * copiada para ca: copiar `ROLE_PERMISSIONS` faria este arquivo concordar consigo mesmo para
 * sempre. O papel entra por `updateRole`, que e o caminho por onde o papel do servidor de fato
 * chega (`connected` e `sharing_updated`), e a traducao de degrau para `UserRole` e a inversa
 * declarada de `toFrontendRole`.
 *
 * O QUE ELE DELIBERADAMENTE NAO MEDE: o `admin` GLOBAL. Ele nao e um degrau desta escada, e sim
 * a palavra que os dois eixos compartilham; `toFrontendRole` o dobra para o topo, sem share
 * nenhum, e medi-lo aqui misturaria os eixos dentro da unica tabela que existe para separa-los.
 * Quem o cobre e `backend/tests/integration/sharing-gaps.test.js`.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { PERMISSION_ORDER, permissionRank } from '../../src/js/projects/permission-levels.js';
import { sessionContext, PermissionAction, UserRole } from '../../src/js/store/sync/session-context.js';

/**
 * A inversa DECLARADA de `toFrontendRole` (`backend/src/utils/roles.js`), sem o ramo do
 * `admin` global, que nao e degrau desta escada.
 */
const ROLE_DO_DEGRAU = Object.freeze({
    read: UserRole.VIEWER,
    comment: UserRole.COMMENTER,
    write: UserRole.EDITOR,
    manage: UserRole.MANAGER,
    owner: UserRole.OWNER,
});

/**
 * AS SEIS ACOES, com o degrau que a constituicao e o servidor declaram para cada uma, e a
 * capacidade do cliente que deveria responder o mesmo.
 *
 * `capacidade: null` marca a acao que o cliente NAO gateia por posto, e a ausencia e uma
 * afirmacao, nao um buraco: ler o snapshot e ler o compartilhamento sao decisoes de rota, o
 * cliente simplesmente pede e le a resposta.
 */
const ACOES = [
    {
        nome: 'ler o snapshot (pullSync)',
        degrauMinimo: 'read',
        capacidade: null,
        executar: (api, ctx) => api.pullSync(ctx.atlasId, 0),
    },
    {
        nome: 'escrever COMENTARIO espacial',
        degrauMinimo: 'comment',
        capacidade: PermissionAction.COMMENT,
        executar: (api, ctx) => api.pushOperations(ctx.atlasId, [
            createOperation('comment', 'create', generateUUID(), ctx.mapId, {
                texto: 'matriz', lng: -43.18, lat: -22.91, resolvido: false,
            }),
        ]),
    },
    {
        nome: 'escrever FEICAO',
        degrauMinimo: 'write',
        capacidade: PermissionAction.EDIT,
        executar: (api, ctx) => api.pushOperations(ctx.atlasId, [
            createOperation('feature', 'create', generateUUID(), ctx.mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
                properties: { source: 'point', layerId: null },
            }),
        ]),
    },
    {
        nome: 'ler o COMPARTILHAMENTO',
        degrauMinimo: 'manage',
        capacidade: PermissionAction.MANAGE_USERS,
        executar: (api, ctx) => api._request('GET', `/atlas/${ctx.atlasId}/sharing`),
    },
    {
        nome: 'configurar o atlas (PATCH /settings)',
        degrauMinimo: 'manage',
        capacidade: null,
        executar: (api, ctx) => api._request('PATCH', `/atlas/${ctx.atlasId}/settings`, {
            body: { basemaps: [] },
        }),
    },
    {
        nome: 'excluir o ATLAS',
        degrauMinimo: 'owner',
        capacidade: null,
        // Medida por um atlas DESCARTAVEL por chamada: um DELETE que passe destroi o sujeito
        // das medicoes seguintes, e um caso que so funciona quando falha nao mede nada.
        executar: async (api, ctx) => api._request('DELETE', `/atlas/${ctx.atlasDescartavelId}`),
        precisaDeAtlasDescartavel: true,
    },
];

describe.skipIf(E2E_SKIP)('e2e: a matriz posto x acao, nos cinco degraus', () => {
    /** @type {Object<string, Object>} um ApiClient logado por degrau. */
    const apiPorDegrau = {};
    /** @type {Object} */
    let donoApi;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        donoApi = makeApi();
        await registerAndLogin(donoApi, { nome: 'Dono da Matriz' });
        const atlas = await createAtlas(donoApi, { name: 'Atlas da Matriz' });
        atlasId = atlas.id;
        mapId = await createMap(donoApi, atlasId, { name: 'Mapa da Matriz' });

        // `owner` nao e um share: e a coluna `atlas.owner_id`, entao o degrau do topo e o
        // proprio dono. Os quatro concediveis ganham uma conta cada.
        apiPorDegrau.owner = donoApi;
        for (const degrau of ['read', 'comment', 'write', 'manage']) {
            const api = makeApi();
            const { user } = await registerAndLogin(api, { nome: `Conta ${degrau}` });
            await donoApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
                body: { userId: user.id, permission: degrau },
            });
            apiPorDegrau[degrau] = api;
        }
    }, 60000);

    /**
     * Roda a acao e responde apenas SE o servidor permitiu, traduzindo a recusa de
     * autorizacao. Erro que NAO seja 401/403 sobe: ele significa que o caso mediu outra
     * coisa (schema, rota inexistente, banco), e engolir isso transformaria um teste
     * quebrado num teste que passa dizendo "negado".
     * @param {Function} executar
     * @param {Object} api
     * @param {Object} ctx
     * @returns {Promise<boolean>}
     */
    async function servidorPermite(executar, api, ctx) {
        try {
            await executar(api, ctx);
            return true;
        } catch (err) {
            if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return false;
            // 404 e a recusa anti-enumeracao da clausula 5.6 para quem nao tem relacao
            // nenhuma com o atlas. Aqui TODOS tem relacao, entao um 404 e defeito e sobe.
            throw err;
        }
    }

    /**
     * O que o CLIENTE responderia para aquela capacidade naquele degrau, lido da fonte
     * (`sessionContext`) e nunca de uma tabela copiada para este arquivo.
     * @param {string} degrau
     * @param {string} capacidade
     * @returns {boolean}
     */
    function clientePermite(degrau, capacidade) {
        sessionContext.setSession({ userId: 'matriz-user', role: ROLE_DO_DEGRAU[degrau] });
        sessionContext.updateRole(ROLE_DO_DEGRAU[degrau]);
        const resposta = sessionContext.canPerformAction(capacidade);
        sessionContext.clearSession();
        return resposta;
    }

    for (const acao of ACOES) {
        it(`"${acao.nome}" corta em \`${acao.degrauMinimo}\`, e a escada e monotonica`, async () => {
            const observado = {};
            for (const degrau of PERMISSION_ORDER) {
                const ctx = { atlasId, mapId };
                if (acao.precisaDeAtlasDescartavel) {
                    const descartavel = await createAtlas(donoApi, { name: `Descartavel ${degrau}` });
                    // O degrau precisa alcancar o atlas descartavel do MESMO jeito que alcanca
                    // o principal, senao a recusa seria a da clausula 5.6 (sem relacao nenhuma)
                    // e nao a do posto, e o caso passaria verde medindo a coisa errada.
                    if (degrau !== 'owner') {
                        const { user } = await donoApi._request(
                            'GET', `/users/search?q=Conta ${degrau}`
                        ).then((r) => ({ user: r[0] }));
                        await donoApi._request('POST', `/atlas/${descartavel.id}/sharing/users`, {
                            body: { userId: user.id, permission: degrau },
                        });
                    }
                    ctx.atlasDescartavelId = descartavel.id;
                }
                observado[degrau] = await servidorPermite(acao.executar, apiPorDegrau[degrau], ctx);
            }

            // 1. O corte esta onde a constituicao diz.
            const esperado = Object.fromEntries(PERMISSION_ORDER.map((d) => [
                d, permissionRank(d) >= permissionRank(acao.degrauMinimo),
            ]));
            expect(observado).toEqual(esperado);

            // 2. MONOTONICIDADE, asserida a parte e nao deduzida do item 1: e ela que
            //    distingue uma escada de uma lista fechada que por acaso acerta na amostra.
            //    Uma vez permitido, nunca mais negado ao subir.
            let jaPermitiu = false;
            for (const degrau of PERMISSION_ORDER) {
                if (observado[degrau]) {
                    jaPermitiu = true;
                } else if (jaPermitiu) {
                    throw new Error(
                        `"${acao.nome}" negou \`${degrau}\` depois de permitir um degrau ABAIXO: `
                        + `a escada nao e monotonica. Medido: ${JSON.stringify(observado)}`
                    );
                }
            }

            // 3. O CLIENTE responde o mesmo, degrau a degrau, quando ele gateia por posto.
            if (acao.capacidade) {
                for (const degrau of PERMISSION_ORDER) {
                    expect(
                        clientePermite(degrau, acao.capacidade),
                        `\`${degrau}\` x "${acao.nome}": o cliente responde `
                        + `${clientePermite(degrau, acao.capacidade)} e o servidor ${observado[degrau]}. `
                        + 'Cliente mais frouxo enfileira op recusada e congela a fila; mais estrito '
                        + 'esconde funcao legitima sem deixar rastro.'
                    ).toBe(observado[degrau]);
                }
            }
        }, 60000);
    }

    it('PISO: as cinco contas existem e sao DISTINTAS (senao a matriz mede uma conta so)', async () => {
        const ids = new Set();
        for (const degrau of PERMISSION_ORDER) {
            const me = await apiPorDegrau[degrau]._request('GET', '/auth/me');
            ids.add(me.id ?? me.user?.id);
        }
        expect(ids.size).toBe(PERMISSION_ORDER.length);
    }, 30000);
});
