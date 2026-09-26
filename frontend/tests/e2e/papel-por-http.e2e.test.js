// Path: tests/e2e/papel-por-http.e2e.test.js
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    makeWs,
    newClientId,
    E2E_SKIP,
} from './helpers/harness.js';

/**
 * @fileoverview E2E de contrato: O PAPEL LIDO POR HTTP É O PAPEL QUE O SOCKET ANUNCIA (2026-09-25).
 *
 * Sem tempo real (`src/js/store/sync/sem-tempo-real.js`) o quadro `connected` do socket não chega, e o
 * cliente lê o nível por atlas do `user_permission` de `GET /atlas/:atlasId` (campo aditivo, somado
 * pelo `getAtlas` do backend) e o traduz por `atlasRoleForPermission`. A mudança cruza os dois
 * pacotes, e é por isso que ela se prova aqui, contra o backend REAL e pelos dois canais na mesma
 * conta: para cada degrau da escada, o `user_permission` do HTTP tem de ser o `permission` do quadro
 * `connected`, e a tradução do cliente tem de dar o `role` que o servidor mandou pelo socket.
 *
 * O ADMINISTRADOR GLOBAL fica de fora desta perna (a conta nasce pela rota pública, e promover exige
 * SQL); ele é cobrado pelo produto cartesiano contra `toFrontendRole` em
 * `tests/unit/papel-por-http-espelha-servidor.test.js` e pelo backend em
 * `backend/tests/integration/atlas-get-traz-o-nivel.test.js`.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import { atlasRoleForPermission } from '../../src/js/projects/permission-levels.js';

describe.skipIf(E2E_SKIP)('e2e: o papel por HTTP espelha o do socket', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    let atlas;
    const sockets = [];

    beforeAll(async () => {
        ownerApi = makeApi();
        await registerAndLogin(ownerApi, { nome: 'Dono do Papel' });
        atlas = await createAtlas(ownerApi, { name: 'Papel por HTTP' });
    }, 30000);

    afterEach(() => {
        while (sockets.length > 0) sockets.pop().disconnect();
    });

    /** What each channel says about `api` in the atlas: the HTTP level and the socket's frame. */
    async function osDoisCanais(api) {
        const http = await api.getAtlas(atlas.id);
        const ws = makeWs(api, { clientId: newClientId() });
        sockets.push(ws);
        const conectado = await ws.connect(atlas.id);
        return { nivelHttp: http.user_permission, conectado, corpo: http };
    }

    it('o dono: `owner` nos dois canais, e o resto do corpo continua lá', async () => {
        const { nivelHttp, conectado, corpo } = await osDoisCanais(ownerApi);
        expect(nivelHttp).toBe('owner');
        expect(conectado.permission).toBe(nivelHttp);
        expect(atlasRoleForPermission(nivelHttp)).toBe(conectado.role);
        expect(corpo.id).toBe(atlas.id);
        expect(corpo.name).toBe('Papel por HTTP');
    }, 30000);

    for (const nivel of ['read', 'comment', 'write', 'manage']) {
        it(`compartilhado com \`${nivel}\`: o mesmo nível e o mesmo papel pelos dois canais`, async () => {
            const api = makeApi();
            const { user } = await registerAndLogin(api, { nome: `Colega ${nivel}` });
            const share = await ownerApi._request('POST', `/atlas/${atlas.id}/sharing/users`,
                { body: { userId: user.id, permission: nivel } });
            expect(share.permission).toBe(nivel);

            const { nivelHttp, conectado } = await osDoisCanais(api);
            expect(nivelHttp).toBe(nivel);
            expect(conectado.permission).toBe(nivelHttp);
            expect(atlasRoleForPermission(nivelHttp)).toBe(conectado.role);
        }, 30000);
    }
});
