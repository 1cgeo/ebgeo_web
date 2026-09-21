// Path: tests/unit/preferencia-de-atlas-passa-pelo-guard.test.js
//
// QUEM SÓ LÊ NÃO PRODUZ ESCRITA (2026-09-16).
//
// MEDIDO, e não suposto: com um usuário de compartilhamento `read` aberto num atlas do servidor, o
// crachá de sincronização ficava preso em "Enviando 2…" para sempre. As duas operações eram
// `setting:update` com a chave `colorUsage`, que o boot grava ao recontar as cores do mapa
// (`setColorUsageCompat` → `logAtlasSetting`), e o servidor respondia 403 a cada tentativa
// ("Seu acesso a este atlas é somente leitura."). A op não desenfileirava, e como a fila é FIFO
// com retenção de cabeça, nada mais daquele cliente sairia dali em diante.
//
// `logAtlasSetting` é a porta ÚNICA das preferências de atlas (mapOrder, mapBadgeColors,
// customIcons, terrainExaggeration), então o guarda mora nela e vale por todos os chamadores —
// inclusive os que ninguém lembrou de auditar.
//
// A CHAVE QUE CAUSOU O DEFEITO NÃO PASSA MAIS POR AQUI, e por isso os casos abaixo usam outra.
// Em 2026-09-21 a contagem de cores deixou de ser sincronizada (é derivada das feições, e cada
// cliente a recalcula), então `setColorUsageCompat` não chama mais esta porta: ver
// `tests/unit/contagem-de-cores-nao-sincroniza.test.js`. Isso FECHA o caso medido por uma segunda
// porta e não aposenta o guarda, que continua valendo para as quatro preferências que viajam; se
// os casos continuassem escritos com `colorUsage` eles mediriam um chamador que não existe mais.
//
// Irmão de `config-de-mapa-passa-pelo-guard.repro.test.js`, que fechou a mesma classe nas três
// configurações POR MAPA. A diferença é o eixo: lá era o mapa, aqui é o atlas.
//
// O QUE ELE NÃO ALCANÇA: o servidor. Que o 403 seja a resposta é assunto de
// `assertOperationAllowed` e dos testes de backend; aqui se mede que o cliente não chega a pedir.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessao = vi.hoisted(() => ({ offline: false, remoto: true, podeEditar: true }));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    PermissionAction: Object.freeze({
        EDIT: 'canEdit', DELETE: 'canDelete', DELETE_MAP: 'canDeleteMap',
        COMMENT: 'canComment', MANAGE_USERS: 'canManageUsers', LOCK_MAPS: 'canLockMaps',
    }),
    sessionContext: {
        get role() { return sessao.podeEditar ? 'editor' : 'viewer'; },
        isOffline: () => sessao.offline,
        isAtlasRoleResolved: () => true,
        canPerformAction: (nome) => (nome === 'canEdit' ? sessao.podeEditar : false),
    },
}));

vi.mock('../../src/js/store/store-origin.js', () => ({ isRemoteStoreSync: () => sessao.remoto }));

// O id PRECISA ser UUID: `logOperation` descarta `setting` com id não-UUID antes da fila
// (`DropReason.NON_UUID_SETTING_ID`), e um fixture com 'atlas-1' faria o controle positivo falhar
// por um motivo que nada tem a ver com permissão.
const escopo = vi.hoisted(() => ({ kind: 'remote', atlasId: '11111111-2222-4333-8444-555555555555' }));
vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    getActiveScope: () => escopo,
    scopedDbName: () => 'db',
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
}));

/** O que de fato iria para a fila. */
const enfileiradas = vi.hoisted(() => []);

const { logAtlasSetting, enableOperationLogging, disableOperationLogging } =
    await import('../../src/js/store/sync/operation-dispatcher.js');

// A fila real é por ESCOPO (`forScope`), e o dublê precisa ter a mesma forma: sem ela o
// dispatcher estoura e o controle positivo falharia por erro do fixture, não por permissão.
// `vi.hoisted` porque o `vi.mock` abaixo é içado para antes das declarações do módulo.
const filaDeEscopo = vi.hoisted(() => ({
    enqueue: vi.fn(),
    enqueueMany: vi.fn(),
    add: vi.fn(),
    addMany: vi.fn(),
    getAll: vi.fn(),
    peek: vi.fn(),
    count: vi.fn(),
}));
vi.mock('../../src/js/store/sync/operation-queue.js', () => ({
    operationQueue: { ...filaDeEscopo, forScope: () => filaDeEscopo },
}));

beforeEach(() => {
    enfileiradas.length = 0;
    filaDeEscopo.enqueue.mockImplementation(async (op) => { enfileiradas.push(op); });
    filaDeEscopo.enqueueMany.mockImplementation(async (ops) => { enfileiradas.push(...ops); });
    filaDeEscopo.add.mockImplementation(async (op) => { enfileiradas.push(op); });
    filaDeEscopo.addMany.mockImplementation(async (ops) => { enfileiradas.push(...ops); });
    filaDeEscopo.getAll.mockImplementation(async () => enfileiradas);
    filaDeEscopo.peek.mockImplementation(async () => enfileiradas);
    filaDeEscopo.count.mockImplementation(async () => enfileiradas.length);
    sessao.offline = false;
    sessao.remoto = true;
    sessao.podeEditar = true;
    enableOperationLogging();
});

describe('preferência de atlas passa pelo guarda', () => {
    it('CONTROLE POSITIVO: com permissão de escrita, a preferência é enfileirada', async () => {
        // Sem este caso, o teste da recusa passaria verde com um `logAtlasSetting` que não
        // enfileira nada em hipótese nenhuma.
        await logAtlasSetting({ mapBadgeColors: { 'Mapa 1': '#ff0000' } });
        expect(enfileiradas.length).toBeGreaterThan(0);
        expect(enfileiradas.at(-1).entityType).toBe('setting');
    });

    it('com papel de LEITURA, não enfileira nada', async () => {
        sessao.podeEditar = false;
        await logAtlasSetting({ mapBadgeColors: { 'Mapa 1': '#ff0000' } });
        expect(enfileiradas).toEqual([]);
    });

    it('a recusa não estoura: o chamador é o boot, e ele não pode quebrar por causa disto', async () => {
        sessao.podeEditar = false;
        await expect(logAtlasSetting({ mapOrder: ['a', 'b'] })).resolves.toBeUndefined();
    });

    it('OFFLINE continua escrevendo: trabalho local não pede permissão a ninguém', async () => {
        sessao.podeEditar = false;
        sessao.offline = true;
        await logAtlasSetting({ customIcons: { x: 1 } });
        expect(enfileiradas.length).toBeGreaterThan(0);
    });

    it('store LOCAL continua escrevendo, mesmo com sessão viva sem permissão no remoto', async () => {
        sessao.podeEditar = false;
        sessao.remoto = false;
        escopo.kind = 'local';
        try {
            await logAtlasSetting({ mapBadgeColors: { m: '#fff' } });
            expect(enfileiradas.length).toBeGreaterThan(0);
        } finally {
            escopo.kind = 'remote';
        }
    });

    it('com o registro de operações desligado, ninguém enfileira (o caminho do visitante público)', async () => {
        disableOperationLogging();
        await logAtlasSetting({ mapBadgeColors: {} });
        expect(enfileiradas).toEqual([]);
    });
});
