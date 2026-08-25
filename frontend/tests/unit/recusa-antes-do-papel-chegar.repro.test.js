// Path: tests/unit/recusa-antes-do-papel-chegar.repro.test.js
//
// A RECUSA FALSA DA JANELA DE HIDRATACAO, medida em 2026-08-25.
//
// O chefe enviou um atlas local ao servidor, virou DONO dele, e a tela anunciou
// "Seu nivel neste atlas nao permite editar." O mesmo aviso voltava a cada F5.
//
// A CAUSA, em uma linha: o cliente nao distingue "sem permissao" de "ainda nao sei".
//
//   1. `sessionUserInfoFromMe` (session-context.js) semeia o papel POR ATLAS em VIEWER
//      SEMPRE, por decisao D7. O papel real chega DEPOIS, do servidor, no payload
//      `connected` do WebSocket (`sync-engine.js` connect).
//   2. `isRemoteStoreSync()` ja responde REMOTO no boot: o marcador e duravel e foi
//      gravado por `markStoreRemote` na sessao anterior.
//   3. Entre 1 e 2 existe uma JANELA em que o guarda recusa toda escrita, e o boot
//      escreve: `switchMap` -> `switchLayer` -> `setBaseLayer` (base-layer.control.js),
//      que emite STORE_OPERATION_BLOCKED com `required: 'canEdit'`.
//   4. O ouvinte de toast traduz esse `canEdit` na frase acima, que e FALSA para o dono.
//
// O QUE ESTE ARQUIVO PRENDE e a propriedade, nao a redacao: enquanto o papel por atlas
// for DESCONHECIDO, a recusa e SILENCIOSA. Ela continua sendo recusa (falha fechada, a
// escrita nao passa), so nao vira acusacao. Quando o papel chega e e mesmo de leitura, a
// frase volta a aparecer.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// `session-context.js` importa `getClientId` daqui, e o modulo real arrasta o namespace
// de atlas inteiro. O dublê e o mesmo que os outros repros de papel usam.
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

// O GUARDA SO EXISTE EM ATLAS REMOTO CONECTADO. Sem este dublê todos os casos abaixo
// passariam verdes por um motivo que nao tem nada a ver com papel.
vi.mock('../../src/js/store/store-origin.js', () => ({
    isRemoteStoreSync: () => true
}));

const toasts = vi.hoisted(() => ({ mostrados: [] }));

vi.mock('../../src/js/utilities/toast_service.js', () => ({
    showInChannel: (canal, texto, tom, opts) => {
        toasts.mostrados.push({ canal, texto, tom, opts });
    }
}));

vi.mock('../../src/js/presence/presence-store.js', () => ({
    presenceStore: { getUsers: () => [] }
}));

import { sessionContext, sessionUserInfoFromMe, UserRole } from '../../src/js/store/sync/session-context.js';
import { checkPermission } from '../../src/js/store/sync/permission-guard.js';
import { registerStoreErrorListeners } from '../../src/js/store/store-error-listener.js';
import { StoreErrorEvents } from '../../src/js/store/store-errors.js';

/**
 * O registro que o backend devolve para o chefe: papel GLOBAL `credenciado` (nao `admin`,
 * que tem atalhos no cliente), e nenhum campo de papel por atlas. Ele e o DONO do atlas,
 * e o servidor so vai dizer isso no payload `connected`.
 */
const REGISTRO_DO_DONO = Object.freeze({
    id: 'u-diniz',
    role: 'credenciado',
    username: 'diniz'
});

/** O payload exato que `setBaseLayer` emite quando o guarda recusa no boot. */
const RECUSA_DO_BOOT = Object.freeze({
    operation: 'setBaseLayer',
    reason: 'Permissao insuficiente: UPDATE_MAP requer canEdit (role atual: viewer)',
    required: 'canEdit'
});

/** Barramento minimo: o ouvinte so usa `on`, e os casos emitem a mao. */
function criarBarramento() {
    const handlers = new Map();
    return {
        on(tipo, fn) { handlers.set(tipo, fn); },
        emit(tipo, payload) { handlers.get(tipo)?.(payload); }
    };
}

let barramento;

// O ouvinte debounce por 3 s POR TIPO, num estado de modulo que sobrevive entre casos.
// O relogio anda 60 s a cada caso para que nenhum toast seja engolido por engano.
const relogioReal = Date.now;
let relogio = relogioReal();
vi.spyOn(Date, 'now').mockImplementation(() => relogio);
afterAll(() => { Date.now = relogioReal; });

beforeEach(() => {
    relogio += 60_000;
    toasts.mostrados = [];
    sessionContext.clearSession();
    barramento = criarBarramento();
    registerStoreErrorListeners(barramento);
});

/** Hidrata a sessao como o F5 faz: `GET /users/me` -> `setSession`. O papel nao veio. */
function hidratarComoNoF5() {
    sessionContext.setSession(sessionUserInfoFromMe(REGISTRO_DO_DONO));
}

/** O servidor responde: e o dono. E o que `sync-engine.connect` faz com `payload.role`. */
function servidorDizQueEDono() {
    sessionContext.setSession({
        userId: REGISTRO_DO_DONO.id,
        role: UserRole.OWNER,
        username: REGISTRO_DO_DONO.username
    });
}

// ============================================================================
// 1. Controle positivo: a janela existe mesmo, e o gate e alcancado
// ============================================================================

describe('a janela de hidratacao existe', () => {
    it('logo apos o F5 o guarda RECUSA a escrita de boot, e depois do `connected` permite', () => {
        hidratarComoNoF5();
        expect(sessionContext.role, 'D7: a semente e sempre VIEWER').toBe(UserRole.VIEWER);
        expect(checkPermission('UPDATE_MAP').allowed).toBe(false);

        servidorDizQueEDono();
        expect(checkPermission('UPDATE_MAP').allowed).toBe(true);
    });

    it('CONTROLE DE VACUO: o Visualizador de verdade tambem e recusado, pelo mesmo gate', () => {
        sessionContext.setSession({ userId: 'u-leitor', role: UserRole.VIEWER });
        expect(checkPermission('UPDATE_MAP').allowed).toBe(false);
    });
});

// ============================================================================
// 2. O terceiro estado, no ponto da DECISAO
// ============================================================================

describe('o guarda distingue "ainda nao sei" de "nao pode"', () => {
    it('a recusa da janela se declara PENDENTE', () => {
        hidratarComoNoF5();
        expect(checkPermission('UPDATE_MAP').pending).toBe(true);
    });

    it('a recusa de um Visualizador de verdade NAO e pendente', () => {
        sessionContext.setSession({ userId: 'u-leitor', role: UserRole.VIEWER });
        expect(checkPermission('UPDATE_MAP').pending).toBe(false);
    });

    it('o visitante anonimo do link publico tem papel RESOLVIDO, nao pendente', () => {
        // Ele e leitor por construcao, e ninguem vai mandar papel nenhum depois.
        sessionContext.setVisitorSession();
        expect(checkPermission('UPDATE_MAP').pending).toBe(false);
    });
});

// ============================================================================
// 3. O DEFEITO que o chefe viu
// ============================================================================

describe('a recusa da janela nao vira acusacao', () => {
    it('F5 no atlas do qual a pessoa e DONA: a escrita de boot NAO produz toast', () => {
        hidratarComoNoF5();

        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, { ...RECUSA_DO_BOOT });

        expect(
            toasts.mostrados.map((t) => t.texto),
            'a tela acusou um nivel que o servidor ainda nao tinha informado'
        ).toEqual([]);
    });

    it('e a recusa continua FECHADA: o guarda nao passou a permitir por otimismo', () => {
        hidratarComoNoF5();
        expect(checkPermission('UPDATE_MAP').allowed).toBe(false);
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);
        expect(checkPermission('DELETE_MAP').allowed).toBe(false);
    });

    it('DISCRIMINACAO: com o papel JA resolvido em leitura, a frase volta a aparecer', () => {
        // Sem esta metade, o conserto poderia ser "nunca mais avise nada" e passaria verde.
        sessionContext.setSession({ userId: 'u-leitor', role: UserRole.VIEWER });

        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'setBaseLayer', reason: 'x', required: 'canEdit'
        });

        expect(toasts.mostrados).toHaveLength(1);
        expect(toasts.mostrados[0].texto).toBe('Seu nível neste atlas não permite editar.');
    });

    it('a sequencia inteira do F5: silencio na janela, fala depois que o papel chegou', () => {
        hidratarComoNoF5();
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, { ...RECUSA_DO_BOOT });
        expect(toasts.mostrados).toEqual([]);

        servidorDizQueEDono();
        expect(checkPermission('UPDATE_MAP').allowed).toBe(true);

        // E se o servidor tivesse dito "leitor", a mesma recusa falaria.
        sessionContext.updateRole(UserRole.VIEWER);
        relogio += 60_000;
        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, { ...RECUSA_DO_BOOT });
        expect(toasts.mostrados).toHaveLength(1);
    });
});

// ============================================================================
// 4. O papel e do atlas, e sai com ele
// ============================================================================

describe('sair do atlas devolve o papel ao estado desconhecido', () => {
    it('o papel resolvido do atlas A nao sobrevive ao `forgetAtlasRole`', () => {
        // Direcao perigosa: o `owner` de A valendo na janela de conexao de B seria CONCEDER
        // o que o servidor ainda nao respondeu. `syncEngine.disconnect` chama isto.
        servidorDizQueEDono();
        expect(checkPermission('UPDATE_MAP').allowed).toBe(true);

        sessionContext.forgetAtlasRole();

        expect(sessionContext.isAtlasRoleResolved()).toBe(false);
        expect(checkPermission('UPDATE_MAP').allowed).toBe(false);
        expect(checkPermission('UPDATE_MAP').pending).toBe(true);
    });

    it('e a identidade fica intacta: quem sai do atlas nao sai da conta', () => {
        hidratarComoNoF5();
        servidorDizQueEDono();
        sessionContext.forgetAtlasRole();

        expect(sessionContext.isAuthenticated()).toBe(true);
        expect(sessionContext.userId).toBe(REGISTRO_DO_DONO.id);
        expect(sessionContext.username).toBe(REGISTRO_DO_DONO.username);
        expect(sessionContext.globalRole).toBe('credenciado');
    });
});

// ============================================================================
// 5. O que o conserto NAO pode calar
// ============================================================================

describe('o silencio e estreito', () => {
    it('mapa travado continua avisando, mesmo na janela', () => {
        // O cadeado nao depende de papel nenhum: cala-lo seria trocar um defeito por outro.
        hidratarComoNoF5();

        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'renameMap', reason: 'map_locked'
        });

        expect(toasts.mostrados).toHaveLength(1);
        expect(toasts.mostrados[0].texto).toMatch(/bloqueado/i);
    });

    it('o anonimo que tenta comentar continua sendo avisado', () => {
        // Offline o papel por atlas nunca e resolvido, mas a recusa dali nao fala de papel:
        // `comment.operations.js` recusa por falta de AUTOR. Calar esta seria trocar o defeito
        // do dono pelo defeito do anonimo.
        sessionContext.clearSession();
        expect(sessionContext.isOffline()).toBe(true);

        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'createComment', reason: 'not-authenticated'
        });

        expect(toasts.mostrados).toHaveLength(1);
    });

    it('recusa com mensagem propria continua falando, mesmo na janela', () => {
        hidratarComoNoF5();

        barramento.emit(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'criarAtlasLocal', message: 'Limite de 10 atlas locais atingido.'
        });

        expect(toasts.mostrados).toHaveLength(1);
        expect(toasts.mostrados[0].texto).toBe('Limite de 10 atlas locais atingido.');
    });
});
