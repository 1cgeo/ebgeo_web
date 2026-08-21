import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Mock operation-factory.js (dependency of session-context.js)
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

import {
    SessionContext,
    SessionMode,
    GlobalRole,
    UserRole,
    PermissionAction,
    sessionUserInfoFromMe
} from '../../src/js/store/sync/session-context.js';

let ctx;

beforeEach(() => {
    ctx = new SessionContext();
});

/** Caminho de um módulo de `src/js/`, para os casos que leem o ARQUIVO. */
const arquivo = (rel) => fileURLToPath(new URL(`../../src/js/${rel}`, import.meta.url));

const FONTE_SESSION = readFileSync(arquivo('store/sync/session-context.js'), 'utf8');

/**
 * Apaga o CONTEÚDO dos comentários preservando a contagem de linhas, para que prosa que NOMEIA o
 * que está proibida de fazer (e os arquivos deste eixo nomeiam bastante) não vire uma violação.
 * @param {string} texto
 * @returns {string}
 */
function semComentarios(texto) {
    return texto
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

// ============================================================================
// Initial state
// ============================================================================

describe('SessionContext initial state', () => {
    it('starts in offline mode', () => {
        expect(ctx.mode).toBe(SessionMode.OFFLINE);
    });

    it('userId is null when offline', () => {
        expect(ctx.userId).toBeNull();
    });

    it('role is null when offline', () => {
        expect(ctx.role).toBeNull();
    });

    it('is not authenticated when offline', () => {
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('isOffline returns true', () => {
        expect(ctx.isOffline()).toBe(true);
    });

    it('clientId returns value from operation-factory', () => {
        expect(ctx.clientId).toBe('mock-client-id-123');
    });
});

// ============================================================================
// getUserId
// ============================================================================

describe('getUserId', () => {
    it('returns clientId when offline', () => {
        expect(ctx.getUserId()).toBe('mock-client-id-123');
    });

    it('returns userId when online', () => {
        ctx.setSession({ userId: 'user-abc', role: UserRole.EDITOR });
        expect(ctx.getUserId()).toBe('user-abc');
    });
});

// ============================================================================
// Permissions
// ============================================================================

describe('Permissions', () => {
    it('offline user can perform any action', () => {
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(true);
    });

    it('viewer cannot edit, delete, or comment', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(false);
    });

    it('commenter can comment but cannot edit, delete, or manage users', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.COMMENTER });
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(false);
    });

    it('editor can edit and delete but not manage users', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(false);
    });

    it('admin can do everything', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(true);
    });

    it('owner can do everything', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
    });

    it('custom permissions override role defaults', () => {
        ctx.setSession({
            userId: 'u1',
            role: UserRole.VIEWER,
            permissions: { canEdit: true }
        });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
    });
});

// ============================================================================
// setSession / clearSession
// ============================================================================

describe('setSession', () => {
    it('transitions to online mode', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.mode).toBe(SessionMode.ONLINE);
        expect(ctx.userId).toBe('u1');
        expect(ctx.role).toBe(UserRole.EDITOR);
        expect(ctx.isAuthenticated()).toBe(true);
    });

    it('throws if userId is missing', () => {
        expect(() => ctx.setSession({})).toThrow('userId is required');
        expect(() => ctx.setSession(null)).toThrow();
    });

    it('defaults to viewer if role not provided', () => {
        ctx.setSession({ userId: 'u1' });
        expect(ctx.role).toBe(UserRole.VIEWER);
    });
});

// ============================================================================
// globalRole / isAdmin (global system role, distinct from per-atlas role)
// ============================================================================

describe('globalRole / isAdmin', () => {
    it('globalRole is null and isAdmin is false when offline', () => {
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('isAdmin is true when globalRole is admin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        expect(ctx.globalRole).toBe('admin');
        expect(ctx.isAdmin()).toBe(true);
    });

    it('isAdmin is false when globalRole is user', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER, globalRole: 'user' });
        expect(ctx.isAdmin()).toBe(false);
    });

    it('global admin is independent of the per-atlas role (viewer access does not drop admin)', () => {
        // A system admin opening an atlas where they only have VIEWER access stays a system admin.
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN, globalRole: 'admin' });
        expect(ctx.isAdmin()).toBe(true);
        // connect() re-sets only the per-atlas role, omitting globalRole → it must be PRESERVED.
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.role).toBe(UserRole.VIEWER);
        expect(ctx.isAdmin()).toBe(true);
    });

    it('globalRole is preserved when a later setSession omits it', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER }); // no globalRole
        expect(ctx.globalRole).toBe('admin');
    });

    it('clearSession resets globalRole and isAdmin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN, globalRole: 'admin' });
        ctx.clearSession();
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('a visitor is never a global admin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        ctx.setVisitorSession();
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('getSnapshot includes globalRole', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        expect(ctx.getSnapshot().globalRole).toBe('admin');
    });
});

// ============================================================================
// O EIXO GLOBAL: quatro papéis que não são uma escada
// ============================================================================

/** Põe uma sessão online com um papel GLOBAL, deixando o papel por atlas no mínimo. */
function comPapelGlobal(globalRole, producerOrgId = null) {
    ctx.setSession({ userId: 'u1', role: UserRole.VIEWER, globalRole, producerOrgId });
}

describe('GlobalRole: quatro papéis, nenhum contendo o outro', () => {
    it('tem exatamente os quatro valores do banco', () => {
        // ABSOLUTO de propósito: um `toContain` aceitaria em silêncio um quinto papel, e papel
        // novo no eixo global é decisão do dono, não efeito colateral de uma tela.
        expect(Object.values(GlobalRole).sort()).toEqual(['admin', 'credenciado', 'producer', 'user']);
    });

    it('`curator` foi SUBSTITUÍDO, não alargado: o valor antigo não sobrou no módulo', () => {
        // Substituir e alargar dão o MESMO verde em qualquer caso que só pergunte pelo valor novo.
        // O que distingue os dois é esta linha: o vocabulário antigo tem de ter morrido.
        expect(Object.values(GlobalRole)).not.toContain('curator');
        expect(FONTE_SESSION, 'o literal `curator` voltou a session-context.js').not.toMatch(/curator/i);
    });

    it('compartilha UMA palavra com o vocabulário POR ATLAS, e ela é homônima', () => {
        const comuns = Object.values(GlobalRole).filter((v) => Object.values(UserRole).includes(v));
        expect(comuns).toEqual(['admin']);
        // As três palavras do eixo global que não existem no de atlas...
        for (const papel of [GlobalRole.USER, GlobalRole.PRODUCER, GlobalRole.CREDENCIADO]) {
            expect(Object.values(UserRole), `${papel} vazou para o eixo por atlas`).not.toContain(papel);
        }
        // ...e as cinco do eixo de atlas que não existem no global. As duas metades juntas são o
        // que faz "os dois eixos não compartilham palavra" ser uma afirmação e não uma esperança.
        for (const papel of [UserRole.OWNER, UserRole.MANAGER, UserRole.EDITOR,
            UserRole.COMMENTER, UserRole.VIEWER]) {
            expect(Object.values(GlobalRole), `${papel} vazou para o eixo global`).not.toContain(papel);
        }
    });
});

// ============================================================================
// hasGlobalDataAccess: quem LÊ todo recurso privado (admin + credenciado)
// ============================================================================

describe('hasGlobalDataAccess', () => {
    it('cobre o administrador e o credenciado, e no MESMO corpo não cobre o usuário comum', () => {
        comPapelGlobal(GlobalRole.ADMIN);
        expect(ctx.hasGlobalDataAccess()).toBe(true);

        comPapelGlobal(GlobalRole.CREDENCIADO);
        expect(ctx.hasGlobalDataAccess()).toBe(true);

        // O par discriminante, no mesmo corpo: sem ele, um predicado que devolvesse `true` para
        // qualquer sessão online passaria nas duas linhas acima.
        comPapelGlobal(GlobalRole.USER);
        expect(ctx.hasGlobalDataAccess()).toBe(false);
    });

    it('NÃO cobre o produtor, com escopo ou sem ele', () => {
        // O produtor lê o privado DA OM DELE, e isso chega pelo payload de
        // `/resource-access/visible`, não por papel de leitura global. Enfiá-lo aqui daria a ele o
        // acervo privado do sistema inteiro numa linha só.
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        expect(ctx.isProducer(), 'controle: esta sessão É de produtor').toBe(true);
        expect(ctx.hasGlobalDataAccess()).toBe(false);

        comPapelGlobal(GlobalRole.PRODUCER, null);
        expect(ctx.hasGlobalDataAccess()).toBe(false);
    });

    it('é falso deslogado, falso para o visitante e falso depois de clearSession', () => {
        expect(ctx.hasGlobalDataAccess()).toBe(false);

        comPapelGlobal(GlobalRole.CREDENCIADO);
        ctx.setVisitorSession();
        expect(ctx.hasGlobalDataAccess()).toBe(false);

        comPapelGlobal(GlobalRole.ADMIN);
        ctx.clearSession();
        expect(ctx.hasGlobalDataAccess()).toBe(false);
    });

    it('não é `isAdmin`: o credenciado lê tudo e não administra nada', () => {
        comPapelGlobal(GlobalRole.CREDENCIADO);
        expect(ctx.hasGlobalDataAccess()).toBe(true);
        expect(ctx.isAdmin(), 'o credenciado passou a abrir o painel do administrador').toBe(false);

        // O par: no administrador os dois predicados coincidem, que é justamente o que torna fácil
        // colá-los num só e o que esta dupla de asserções existe para impedir.
        comPapelGlobal(GlobalRole.ADMIN);
        expect(ctx.hasGlobalDataAccess()).toBe(true);
        expect(ctx.isAdmin()).toBe(true);
    });

    it('sobrevive a um setSession que só re-põe o papel POR ATLAS (o caminho do `connect`)', () => {
        comPapelGlobal(GlobalRole.CREDENCIADO);
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.globalRole).toBe(GlobalRole.CREDENCIADO);
        expect(ctx.hasGlobalDataAccess()).toBe(true);
    });
});

// ============================================================================
// Escopo de produção: crachá e escopo são UM fato só
// ============================================================================

describe('escopo de produção (producerOrgId / isProducer / canProduceFor)', () => {
    it('chega junto com o papel global, e os dois leitores concordam', () => {
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        expect(ctx.globalRole).toBe('producer');
        expect(ctx.producerOrgId).toBe('om-a');
        expect(ctx.isProducer()).toBe(true);
    });

    it('crachá SEM escopo não é produtor: degrada para "produtor de nada"', () => {
        // No banco o par é um bicondicional, então este é um estado impossível lá. Se ele chegar
        // aqui assim mesmo (token legado, resposta pela metade), a degradação tem de ser a
        // FECHADA: aceitar o crachá sozinho leria "produtor de tudo".
        comPapelGlobal(GlobalRole.PRODUCER, null);
        expect(ctx.isProducer()).toBe(false);
        expect(ctx.canProduceFor('om-a')).toBe(false);

        // O par, no mesmo corpo: o MESMO papel com escopo produz.
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        expect(ctx.isProducer()).toBe(true);
        expect(ctx.canProduceFor('om-a')).toBe(true);
    });

    it('escopo SEM crachá também não é produtor', () => {
        comPapelGlobal(GlobalRole.USER, 'om-a');
        expect(ctx.producerOrgId).toBe('om-a');
        expect(ctx.isProducer()).toBe(false);
        expect(ctx.canProduceFor('om-a')).toBe(false);
    });

    it('o produtor mantém a OM dele e nenhuma outra', () => {
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        expect(ctx.canProduceFor('om-a')).toBe(true);
        expect(ctx.canProduceFor('om-b')).toBe(false);
        // Recurso institucional (`owner_org_id` nulo) é do administrador e de mais ninguém.
        expect(ctx.canProduceFor(null)).toBe(false);
        expect(ctx.canProduceFor(undefined)).toBe(false);
        expect(ctx.canProduceFor('')).toBe(false);
    });

    it('o administrador mantém qualquer OM, inclusive o recurso institucional', () => {
        comPapelGlobal(GlobalRole.ADMIN);
        expect(ctx.canProduceFor('om-a')).toBe(true);
        expect(ctx.canProduceFor('om-b')).toBe(true);
        expect(ctx.canProduceFor(null)).toBe(true);
    });

    it('credenciado e usuário comum não mantêm nada', () => {
        comPapelGlobal(GlobalRole.CREDENCIADO);
        expect(ctx.isProducer()).toBe(false);
        expect(ctx.canProduceFor('om-a')).toBe(false);

        comPapelGlobal(GlobalRole.USER);
        expect(ctx.canProduceFor('om-a')).toBe(false);

        // E deslogado, que é o estado em que a página do admin começa.
        ctx.clearSession();
        expect(ctx.canProduceFor('om-a')).toBe(false);
    });

    it('o escopo é PRESERVADO quando um setSession posterior o omite, junto com o papel', () => {
        // Mesma regra do `globalRole`, e pelo mesmo motivo: `connect()` re-põe só o papel por
        // atlas. Preservar um e zerar o outro deixaria exatamente o estado impossível do banco.
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER });
        expect(ctx.producerOrgId).toBe('om-a');
        expect(ctx.isProducer()).toBe(true);
    });

    it('e é ZERADO quando vem explicitamente nulo (o rebaixamento)', () => {
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        comPapelGlobal(GlobalRole.USER, null);
        expect(ctx.producerOrgId).toBeNull();
        expect(ctx.isProducer()).toBe(false);
    });

    it('clearSession, setVisitorSession e _reset zeram o escopo', () => {
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        ctx.clearSession();
        expect(ctx.producerOrgId).toBeNull();

        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        ctx.setVisitorSession();
        expect(ctx.producerOrgId).toBeNull();
        expect(ctx.isProducer()).toBe(false);

        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        ctx._reset();
        expect(ctx.producerOrgId).toBeNull();
    });

    it('getSnapshot leva o escopo junto (é por ele que a UI se re-gateia)', () => {
        comPapelGlobal(GlobalRole.PRODUCER, 'om-a');
        const snap = ctx.getSnapshot();
        expect(snap.globalRole).toBe('producer');
        expect(snap.producerOrgId).toBe('om-a');
    });
});

// ============================================================================
// sessionUserInfoFromMe: a forma ÚNICA de hidratação
// ============================================================================

describe('sessionUserInfoFromMe', () => {
    it('traduz o registro do backend para o argumento de setSession', () => {
        const info = sessionUserInfoFromMe({
            id: 'u9',
            // O campo do eixo de OM viaja no registro de propósito (backend legado, token
            // legado): o contrato de hoje é que ele seja IGNORADO, e um registro já sem ele
            // mediria a ausência em vez da indiferença.
            org_role: 'admin',
            role: GlobalRole.PRODUCER,
            producer_org_id: 'om-a',
            username: 'ana'
        });
        // Igualdade ESTRITA: um campo a mais na hidratação é um campo que `setSession` não conhece
        // e que se perde em silêncio.
        expect(info).toEqual({
            userId: 'u9',
            role: UserRole.VIEWER,
            globalRole: GlobalRole.PRODUCER,
            producerOrgId: 'om-a',
            username: 'ana'
        });
    });

    it('degrada para o lado FECHADO quando o registro vem sem os campos novos', () => {
        const info = sessionUserInfoFromMe({ id: 'u9' });
        expect(info.role).toBe(UserRole.VIEWER);
        expect(info.globalRole).toBe(GlobalRole.USER);
        expect(info.producerOrgId).toBeNull();
    });

    it('emite a chave `producerOrgId` SEMPRE, e é isso que permite rebaixar', () => {
        // `setSession` preserva o que chega `undefined`. Se o helper omitisse a chave para quem não
        // é produtor, o rebaixamento de um produtor deixaria o escopo antigo de pé na sessão viva e
        // `canProduceFor` continuaria dizendo sim depois da perda do papel.
        expect(Object.keys(sessionUserInfoFromMe({ id: 'u9', role: 'user' }))).toContain('producerOrgId');

        ctx.setSession(sessionUserInfoFromMe({
            id: 'u9', role: GlobalRole.PRODUCER, producer_org_id: 'om-a'
        }));
        expect(ctx.isProducer()).toBe(true);

        ctx.setSession(sessionUserInfoFromMe({ id: 'u9', role: GlobalRole.USER }));
        expect(ctx.isProducer()).toBe(false);
        expect(ctx.producerOrgId).toBeNull();
    });

    it('o nome de exibição cai para `nome` e depois para o que o formulário sabe', () => {
        expect(sessionUserInfoFromMe({ id: 'u9', nome: 'Ana' }).username).toBe('Ana');
        expect(sessionUserInfoFromMe({ id: 'u9' }, 'ana.silva').username).toBe('ana.silva');
    });
});

describe('as CINCO hidratações passam por este helper', () => {
    /**
     * Os cinco sítios que montam uma sessão a partir de um registro do backend. A cópia da forma
     * já existiu cinco vezes e já tinha divergido; o campo cuja ausência falha CALADO é o escopo de
     * produção (`isProducer()` vira falso e a tela some, sem erro nenhum).
     */
    const SITIOS = [
        'index.js',
        'projects/projects-page.js',
        'admin/admin-page.js',
        'calibration/calibracao-page.js',
        'store/sync/sync-engine.js'
    ].map((rel) => ({ nome: rel, codigo: semComentarios(readFileSync(arquivo(rel), 'utf8')) }));

    it('coleta os cinco arquivos (guarda contra a lista esvaziar em silêncio)', () => {
        expect(SITIOS).toHaveLength(5);
        for (const { nome, codigo } of SITIOS) {
            expect(codigo.length, `${nome} veio vazio`).toBeGreaterThan(1000);
        }
    });

    it('cada um chama sessionUserInfoFromMe', () => {
        for (const { nome, codigo } of SITIOS) {
            expect(codigo, `${nome} não hidrata pelo helper`).toMatch(/sessionUserInfoFromMe\(/);
        }
    });

    it('e nenhum monta a forma à mão', () => {
        for (const { nome, codigo } of SITIOS) {
            expect(codigo, `${nome} lê producer_org_id por fora do helper`).not.toMatch(/producer_org_id/);
            expect(codigo, `${nome} monta globalRole à mão`).not.toMatch(/globalRole\s*:/);
        }
    });

    it('CONTROLE: quem lê `producer_org_id` é o próprio helper', () => {
        // Sem esta linha, o caso acima passaria idêntico se o campo tivesse sumido do produto
        // inteiro, que é a falha que ele deveria acusar mais alto.
        expect(semComentarios(FONTE_SESSION)).toMatch(/producer_org_id/);
    });
});

// ============================================================================
// A fronteira: o eixo global não encosta no vocabulário POR ATLAS
// ============================================================================

/** O vetor completo de permissões da sessão, lido pela única porta pública que existe. */
function vetor(sessao) {
    return Object.fromEntries(
        Object.values(PermissionAction).map((acao) => [acao, sessao.canPerformAction(acao)])
    );
}

const VETORES_POR_ATLAS = Object.freeze({
    [UserRole.OWNER]: { canEdit: true, canDelete: true, canDeleteMap: true, canComment: true, canManageUsers: true, canLockMaps: true },
    [UserRole.ADMIN]: { canEdit: true, canDelete: true, canDeleteMap: true, canComment: true, canManageUsers: true, canLockMaps: true },
    [UserRole.MANAGER]: { canEdit: true, canDelete: true, canDeleteMap: true, canComment: true, canManageUsers: true, canLockMaps: true },
    [UserRole.EDITOR]: { canEdit: true, canDelete: true, canDeleteMap: false, canComment: true, canManageUsers: false, canLockMaps: false },
    [UserRole.COMMENTER]: { canEdit: false, canDelete: false, canDeleteMap: false, canComment: true, canManageUsers: false, canLockMaps: false },
    [UserRole.VIEWER]: { canEdit: false, canDelete: false, canDeleteMap: false, canComment: false, canManageUsers: false, canLockMaps: false }
});

describe('os dois eixos não se contaminam: UserRole e ROLE_PERMISSIONS intactos', () => {
    it('UserRole continua com os SEIS papéis por atlas', () => {
        expect(Object.values(UserRole).sort())
            .toEqual(['admin', 'commenter', 'editor', 'manager', 'owner', 'viewer']);
    });

    it('cada papel por atlas mantém exatamente o vetor de permissões que sempre teve', () => {
        // A tabela `ROLE_PERMISSIONS` é privada; este é o vetor dela lido pela porta pública. Vale
        // como asserção ABSOLUTA: uma flag que mude de lado aparece aqui, mesmo que nenhuma tela
        // ainda a leia. Repare em `canDeleteMap`, que é flag separada de `canDelete` por contrato
        // com o servidor.
        for (const [papel, esperado] of Object.entries(VETORES_POR_ATLAS)) {
            ctx.setSession({ userId: 'u1', role: papel });
            expect(vetor(ctx), `o vetor de ${papel} mudou`).toEqual(esperado);
        }
    });

    it('o papel GLOBAL não mexe no vetor por atlas', () => {
        // Um administrador global abrindo um atlas onde ele é Leitor continua Leitor NAQUELE atlas,
        // e um credenciado (que lê todo o privado) não ganha uma tecla de edição por causa disso.
        for (const globalRole of Object.values(GlobalRole)) {
            comPapelGlobal(globalRole, globalRole === GlobalRole.PRODUCER ? 'om-a' : null);
            expect(vetor(ctx), `${globalRole} mexeu no vetor de VIEWER`)
                .toEqual(VETORES_POR_ATLAS[UserRole.VIEWER]);
        }

        // O par: com o mesmo papel global, é o papel POR ATLAS que muda o vetor. Sem esta linha, um
        // `canPerformAction` que devolvesse `false` sempre passaria no laço acima.
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: GlobalRole.CREDENCIADO });
        expect(vetor(ctx)).toEqual(VETORES_POR_ATLAS[UserRole.EDITOR]);
    });

    it('um valor do eixo GLOBAL usado como papel de atlas não vale permissão nenhuma', () => {
        // As duas tabelas não se cruzam: `producer` e `credenciado` não são chave de
        // `ROLE_PERMISSIONS`, então caem no piso de Leitor em vez de virar um papel de atlas novo.
        for (const papel of [GlobalRole.PRODUCER, GlobalRole.CREDENCIADO, GlobalRole.USER]) {
            ctx.setSession({ userId: 'u1', role: papel });
            expect(vetor(ctx), `${papel} virou papel por atlas`).toEqual(VETORES_POR_ATLAS[UserRole.VIEWER]);
        }

        // Controle: um papel de atlas de verdade não cai no piso.
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
    });
});

describe('clearSession', () => {
    it('returns to offline mode', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        ctx.clearSession();
        expect(ctx.mode).toBe(SessionMode.OFFLINE);
        expect(ctx.userId).toBeNull();
        expect(ctx.role).toBeNull();
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('restores full permissions', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);

        ctx.clearSession();
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
    });
});

// ============================================================================
// setVisitorSession (anonymous public view-link)
// ============================================================================

describe('setVisitorSession', () => {
    it('is an online, read-only VIEWER with no account identity', () => {
        ctx.setVisitorSession();
        expect(ctx.mode).toBe(SessionMode.ONLINE);
        expect(ctx.role).toBe(UserRole.VIEWER);
        expect(ctx.userId).toBeNull();
        expect(ctx.isVisitor()).toBe(true);
        // No account: isAuthenticated must stay false so the account menu stays hidden.
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('cannot edit, delete, or comment (public link is view-only)', () => {
        ctx.setVisitorSession();
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
    });

    it('clearSession restores offline full control and drops the visitor flag', () => {
        ctx.setVisitorSession();
        ctx.clearSession();
        expect(ctx.isOffline()).toBe(true);
        expect(ctx.isVisitor()).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
    });
});

// ============================================================================
// Observer
// ============================================================================

describe('onSessionChanged', () => {
    it('notifies on setSession', () => {
        const listener = vi.fn();
        ctx.onSessionChanged(listener);
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            mode: SessionMode.ONLINE,
            userId: 'u1',
            role: UserRole.EDITOR
        }));
    });

    it('notifies on clearSession', () => {
        const listener = vi.fn();
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        ctx.onSessionChanged(listener);
        ctx.clearSession();

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            mode: SessionMode.OFFLINE,
            userId: null
        }));
    });

    it('returns unsubscribe function', () => {
        const listener = vi.fn();
        const unsub = ctx.onSessionChanged(listener);
        unsub();
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(listener).not.toHaveBeenCalled();
    });

    it('throws if callback is not a function', () => {
        expect(() => ctx.onSessionChanged('not a function')).toThrow();
    });

    it('does not crash if listener throws', () => {
        ctx.onSessionChanged(() => { throw new Error('boom'); });
        expect(() => ctx.setSession({ userId: 'u1', role: UserRole.EDITOR })).not.toThrow();
    });
});

// ============================================================================
// getSnapshot
// ============================================================================

describe('getSnapshot', () => {
    it('returns current state as plain object', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        const snap = ctx.getSnapshot();
        expect(snap.mode).toBe(SessionMode.ONLINE);
        expect(snap.userId).toBe('u1');
        expect(snap.clientId).toBe('mock-client-id-123');
        expect(snap.role).toBe(UserRole.ADMIN);
        expect(snap.permissions.canEdit).toBe(true);
    });

    it('snapshot permissions are a copy (not a reference)', () => {
        const snap = ctx.getSnapshot();
        snap.permissions.canEdit = false;
        expect(ctx.permissions.canEdit).toBe(true);
    });
});

// ============================================================================
// _reset
// ============================================================================

describe('_reset', () => {
    it('clears the username (parity with clearSession)', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, username: 'alice' });
        expect(ctx.username).toBe('alice');
        ctx._reset();
        expect(ctx.username).toBeNull();
    });

    it('returns to initial state and clears listeners', () => {
        const listener = vi.fn();
        ctx.onSessionChanged(listener);
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        ctx._reset();

        expect(ctx.mode).toBe(SessionMode.OFFLINE);
        expect(ctx.userId).toBeNull();

        // Listener should have been cleared
        ctx.setSession({ userId: 'u2', role: UserRole.EDITOR });
        expect(listener).toHaveBeenCalledTimes(1); // Only the first call
    });
});
