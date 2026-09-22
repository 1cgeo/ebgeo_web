// Path: tests/e2e/presenca-visualizador-e-saida.e2e.test.js

/**
 * @fileoverview A FRONTEIRA dos dois consertos de presença de 2026-09-22, pelo transporte REAL do
 * cliente (`makeWs`) contra o backend real.
 *
 *   1. O contexto de visualizador: o `sendViewer` do cliente produz o quadro que o servidor aceita
 *      (`viewer_context`), e o par o recebe no evento `viewerContext`, com a superfície e o recurso
 *      decidido para ELE. Um identificador fora do catálogo chega como superfície sem recurso, e o
 *      retrato de quem entra depois traz a chave `viewer`. O nome e o recorte por destinatário
 *      contra o banco são `backend/tests/ws/presenca-contexto-do-visualizador.test.js`; aqui o que se
 *      prende é o CONTRATO entre os dois pacotes (tipo do quadro, nome do evento, forma do valor).
 *   2. A saída sem fantasma: o cursor mandado logo antes de sair não chega ao par DEPOIS do
 *      `user_left`. É o elo que fazia a pessoa voltar à lista sem nome (relato do dono: "ainda diz
 *      que tem usuário presente mesmo que depois de sair").
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
} from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('presença: visualizador aberto e saída sem fantasma (WS real)', () => {
    let apiA;
    let apiB;
    let atlasId;
    let mapId;
    let userIdB;
    let wsA;
    let wsB;
    const cidA = newClientId();
    const cidB = newClientId();
    /** Tudo o que A recebe, na ordem, para comparar posições. */
    const chegadasA = [];

    const idOf = (u) => u.id ?? u.userId ?? u.sub;

    beforeAll(async () => {
        apiA = makeApi();
        apiB = makeApi();
        await registerAndLogin(apiA, { nome: 'Presença Dono' });
        const authB = await registerAndLogin(apiB, { nome: 'Presença Colega' });
        userIdB = idOf(authB.user);

        const atlas = await createAtlas(apiA, { name: 'Atlas da presença' });
        atlasId = atlas.id;
        mapId = await createMap(apiA, atlasId, { name: 'Mapa da presença' });
        await apiA._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: userIdB, permission: 'read' },
        });

        wsA = makeWs(apiA, { clientId: cidA });
        wsA.on('viewerContext', (m) => chegadasA.push({ canal: 'viewer', m }));
        wsA.on('cursor', (m) => chegadasA.push({ canal: 'cursor', m }));
        wsA.on('presence', (m) => chegadasA.push({ canal: 'presence', m }));
        await wsA.connect(atlasId);
    });

    afterAll(() => {
        wsA?.disconnect();
        wsB?.disconnect();
    });

    it('o visualizador aberto pelo colega chega no evento `viewerContext`, e fechar volta a nulo', async () => {
        wsB = makeWs(apiB, { clientId: cidB });
        wsB.on('cursor', () => {});
        await wsB.connect(atlasId);

        expect(wsB.sendViewer({ surface: '3d', tilesetId: 'nao-existe-no-catalogo' })).toBe(true);
        const aberto = await waitFor(() => chegadasA.find(
            (c) => c.canal === 'viewer' && c.m.clientId === cidB && c.m.viewer,
        ));
        expect(aberto.m.type).toBe('viewer_context');
        expect(aberto.m.userId).toBe(userIdB);
        expect(aberto.m.viewer).toEqual({ surface: '3d', recurso: null });

        wsB.sendViewer({ surface: '2d' });
        await waitFor(() => chegadasA.find(
            (c) => c.canal === 'viewer' && c.m.clientId === cidB && c.m.viewer === null,
        ));
    });

    it('o retrato de quem entra depois traz a chave `viewer` de cada par', async () => {
        wsB.sendViewer({ surface: '360', photoName: 'foto-que-nao-existe.jpg' });
        await waitFor(() => chegadasA.find(
            (c) => c.canal === 'viewer' && c.m.clientId === cidB && c.m.viewer?.surface === '360',
        ));
        const apiC = makeApi();
        const authC = await registerAndLogin(apiC, { nome: 'Presença Tardio' });
        await apiA._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: idOf(authC.user), permission: 'read' },
        });
        const wsC = makeWs(apiC, { clientId: newClientId() });
        try {
            const conectado = await wsC.connect(atlasId);
            const entrada = (conectado.usersOnline ?? []).find((u) => u.clientId === cidB);
            expect(entrada).toBeTruthy();
            expect(entrada.viewer).toEqual({ surface: '360', recurso: null });
        } finally {
            wsC.disconnect();
        }
    });

    it('o cursor mandado logo antes de sair NÃO chega depois do `user_left`', async () => {
        // PISO: o cursor deste mesmo colega atravessa o lote do servidor.
        wsB.sendCursor({ position: { lng: -43.1, lat: -22.8 }, mapId });
        await waitFor(() => chegadasA.find((c) => c.canal === 'cursor' && c.m.clientId === cidB));

        wsB.sendCursor({ position: { lng: -43.2, lat: -22.9 }, mapId });
        wsB.disconnect();
        wsB = null;

        const iSaida = await waitFor(() => {
            const i = chegadasA.findIndex(
                (c) => c.canal === 'presence' && c.m.type === 'user_left' && c.m.clientId === cidB,
            );
            return i >= 0 ? i + 1 : 0;
        }) - 1;
        // Mais que um lote de cursor inteiro (100 ms por padrão) depois do anúncio.
        await new Promise((r) => setTimeout(r, 500));
        const depois = chegadasA.slice(iSaida + 1)
            .filter((c) => c.canal === 'cursor' && c.m.clientId === cidB);
        expect(depois).toEqual([]);
    });
});
