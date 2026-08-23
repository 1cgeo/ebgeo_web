// Path: tests/unit/sharing-presence-source.test.js

/**
 * @fileoverview A fonte de presença do modal de compartilhamento, exercitada de verdade.
 *
 * POR QUE ELA MERECE TESTE PRÓPRIO. As três regras que decidem o bloco "Vendo agora" (só o atlas
 * CONECTADO, sem quem está `away`, sem eu mesmo) moraram dentro de um método privado de um modal
 * que só existe com DOM, e por isso nunca tiveram cobertura em node. Ao serem extraídas para
 * `presence/sharing-presence.source.js` elas viraram uma função que recebe um `atlasId` e devolve
 * uma lista, ou seja, exatamente a forma que este ambiente verifica.
 *
 * A REGRA QUE MAIS CUSTA SE CAIR É A PRIMEIRA. Presença é POR ATLAS CONECTADO, e o modal de
 * compartilhamento passou a ser abrível para um atlas que NÃO é o conectado (é o caso inteiro do
 * seletor de atlas). Sem a comparação com `syncEngine.atlasId`, a tela diria "vendo agora" sobre
 * gente que está em outro projeto, e diria isso com cara de fato.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventTypes } from '@events/event_types.js';

const presenceStore = { getUsers: vi.fn(() => []) };
const syncEngine = { atlasId: null };
const sessionContext = { userId: null };
const eventBus = { on: vi.fn(() => () => {}) };

vi.mock('@js/presence/presence-store.js', () => ({ presenceStore }));
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine }));
vi.mock('@store/sync/session-context.js', () => ({ sessionContext }));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBus }));

const { livePresenceSource } = await import('@js/presence/sharing-presence.source.js');

/** Quatro pessoas: eu, uma online, uma `away` e uma sem `userId` (só `clientId`). */
const USUARIOS = Object.freeze([
    { userId: 'eu', userName: 'Eu', away: false },
    { userId: 'ana', userName: 'Ana', away: false },
    { userId: 'bruno', userName: 'Bruno', away: true },
    { clientId: 'anon-1', userName: 'Anônimo', away: false }
]);

describe('livePresenceSource.usersIn', () => {
    beforeEach(() => {
        presenceStore.getUsers.mockReturnValue(USUARIOS.map((u) => ({ ...u })));
        syncEngine.atlasId = 'atlas-A';
        sessionContext.userId = 'eu';
    });

    it('devolve os OUTROS conectados quando o atlas pedido é o conectado', () => {
        const nomes = livePresenceSource.usersIn('atlas-A').map((u) => u.userName);
        // Ana entra; eu saio (paridade com toda superfície de presença), Bruno sai por `away`, e o
        // anônimo sai por não ter identidade de usuário para casar com um membro da lista.
        expect(nomes).toEqual(['Ana']);
    });

    it('devolve VAZIO quando o atlas pedido não é o conectado', () => {
        // O caso do seletor de atlas: administrar o acesso de um projeto que não está aberto.
        expect(livePresenceSource.usersIn('atlas-B')).toEqual([]);
        // E não é o `getUsers` que está vazio: o controle é que a MESMA chamada com o outro id
        // devolve gente. Sem esta linha, um `getUsers` mockado errado daria o mesmo verde.
        expect(livePresenceSource.usersIn('atlas-A')).toHaveLength(1);
    });

    it('devolve VAZIO quando não há atlas conectado', () => {
        syncEngine.atlasId = null;
        expect(livePresenceSource.usersIn('atlas-A')).toEqual([]);
        // E `undefined` pedido contra `null` conectado também não pode casar por frouxidão.
        expect(livePresenceSource.usersIn(undefined)).toEqual([]);
    });

    it('compara a identidade por String, porque o id atravessa a rede como JSON', () => {
        // O `userId` chega do servidor e pode vir como número; `sessionContext.userId` vem do JWT.
        presenceStore.getUsers.mockReturnValue([
            { userId: 7, userName: 'Eu de novo', away: false },
            { userId: 8, userName: 'Ana', away: false }
        ]);
        sessionContext.userId = '7';
        expect(livePresenceSource.usersIn('atlas-A').map((u) => u.userName)).toEqual(['Ana']);
    });

    it('sessão sem identidade não faz todo mundo virar "eu"', () => {
        // `String(null ?? '')` é `''`, e nenhum `userId` real é string vazia: o filtro de self
        // simplesmente não casa, em vez de zerar a lista.
        sessionContext.userId = null;
        expect(livePresenceSource.usersIn('atlas-A').map((u) => u.userName)).toEqual(['Eu', 'Ana']);
    });
});

describe('livePresenceSource.onChange', () => {
    beforeEach(() => {
        eventBus.on.mockClear();
        eventBus.on.mockImplementation(() => () => {});
    });

    it('assina PRESENCE_CHANGED e devolve o desfazer que o barramento deu', () => {
        const desfazer = vi.fn();
        eventBus.on.mockReturnValue(desfazer);
        const off = livePresenceSource.onChange(() => {});
        expect(eventBus.on).toHaveBeenCalledTimes(1);
        expect(eventBus.on.mock.calls[0][0]).toBe(EventTypes.PRESENCE_CHANGED);
        expect(off).toBe(desfazer);
    });

    it('o callback do chamador é o que roda quando o barramento dispara', () => {
        let handler = null;
        eventBus.on.mockImplementation((_tipo, h) => { handler = h; return () => {}; });
        const aviso = vi.fn();
        livePresenceSource.onChange(aviso);
        expect(aviso).not.toHaveBeenCalled();
        handler();
        expect(aviso).toHaveBeenCalledTimes(1);
    });

    it('`getEventBus()` só é chamado na assinatura, nunca no load do módulo', () => {
        // É esta propriedade que permite ao mapa importar a fonte cedo sem exigir `initServices()`
        // no instante do import. O módulo já foi importado no topo deste arquivo; se ele chamasse
        // o barramento ali, a contagem abaixo não seria zero.
        expect(eventBus.on).not.toHaveBeenCalled();
    });
});
