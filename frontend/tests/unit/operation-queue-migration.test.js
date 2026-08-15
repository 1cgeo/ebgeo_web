// Path: tests/unit/operation-queue-migration.test.js

/**
 * @fileoverview O roteamento das operações que já estão no disco quando a fila vira por atlas.
 *
 * Uma instalação que atualiza com fila pendente tem trabalho do usuário guardado em
 * `ebgeo`/`operation_queue`, um endereço que a partir de agora pertence só ao slot local #1.
 * Este arquivo prende as duas metades da regra e, sobretudo, a que custa caro: NADA é
 * descartado. A operação é escrita no destino e LIDA DE VOLTA antes de sair da origem, então
 * toda falha deixa o trabalho exatamente onde estava.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: cada caso conta as operações nos
 * DOIS bancos, por nome absoluto, antes e depois. Uma migração que apagasse a origem sem
 * escrever o destino, ou que escrevesse os dois, falha pela contagem; um caso que só olhasse
 * o destino ficaria verde nas duas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { databases, storeOf, resetDisk, falharAoEscreverEm } = vi.hoisted(() => {
    const databases = new Map();
    /** @type {Set<string>} Nomes de banco cujo `setItem` rejeita. */
    const escritaQuebrada = new Set();

    function backingOf(name, storeName = null) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        if (!databases.has(key)) databases.set(key, new Map());
        return databases.get(key);
    }

    function storeOf({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => {
                if (escritaQuebrada.has(name)) throw new Error(`QuotaExceededError em ${name}`);
                backing.set(k, v);
                return v;
            }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }

    return {
        databases,
        storeOf,
        falharAoEscreverEm: (name) => escritaQuebrada.add(name),
        resetDisk: () => { databases.clear(); escritaQuebrada.clear(); }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async () => {})
    }
}));

const FILA_LEGADA = 'ebgeo::operation_queue';
const ATLAS_X = '11111111-1111-4111-8111-111111111111';

/**
 * @param {string} sufixo - Sufixo de banco.
 * @returns {string} Chave do banco de fila daquele escopo no disco falso.
 */
function filaDe(sufixo) {
    return sufixo === '' ? FILA_LEGADA : `ebgeo__${sufixo}::operation_queue`;
}

/**
 * @param {string} chave - Chave do disco falso.
 * @returns {string[]} Ids das operações guardadas ali.
 */
function idsEm(chave) {
    const banco = databases.get(chave);
    return banco ? [...banco.values()].map(op => op.id).sort() : [];
}

/**
 * Escreve uma operação DIRETO no banco legado, que é a forma que ela tem no disco de quem
 * atualizou o app. Escrever pela fila usaria o endereço ativo e não reproduziria o cenário.
 * @param {string} id - Id da operação.
 * @param {string|null} scopeSuffix - Carimbo, ou null para a geração sem carimbo.
 * @returns {void}
 */
function semearNoLegado(id, scopeSuffix) {
    const op = {
        id,
        entityType: 'feature',
        operationType: 'create',
        entityId: `feicao-${id}`,
        mapId: 'map-1',
        data: { nome: id },
        timestamp: 1700000000000,
        lamportTimestamp: 1,
        clientId: 'c1'
    };
    if (scopeSuffix !== null) op.scopeSuffix = scopeSuffix;
    const key = `${FILA_LEGADA}`;
    if (!databases.has(key)) databases.set(key, new Map());
    databases.get(key).set(`op_${op.timestamp}_${id}`, op);
}

/** @returns {Promise<{ns: Object, migrar: Function}>} Módulos num grafo novo. */
async function carregar() {
    vi.resetModules();
    const ns = await import('@store/atlas-namespace.js');
    const { migratePendingOperationsToScopedQueues } =
        await import('@store/sync/operation-queue-migration.js');
    return { ns, migrar: migratePendingOperationsToScopedQueues };
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

describe('roteamento das operações pendentes para a fila do seu atlas', () => {
    it('a op CARIMBADA vai para o banco do seu carimbo, e some da origem', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-do-X', `remote-${ATLAS_X}`);
        ns.activateScope(ns.localScope('slot-1', ''));
        // Positiva antes da negativa: a origem TINHA a operação.
        expect(idsEm(FILA_LEGADA)).toEqual(['op-do-X']);

        const relatorio = await migrar();

        expect(relatorio).toEqual({ moved: 1, kept: 0, failed: 0 });
        expect(idsEm(filaDe(`remote-${ATLAS_X}`))).toEqual(['op-do-X']);
        expect(idsEm(FILA_LEGADA)).toEqual([]);
    });

    it('a op SEM carimbo vai para o atlas montado agora, que é a regra escrita', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-antiga', null);
        ns.activateScope(ns.remoteScope(ATLAS_X));

        const relatorio = await migrar();

        expect(relatorio.moved).toBe(1);
        expect(idsEm(filaDe(`remote-${ATLAS_X}`))).toEqual(['op-antiga']);
        expect(idsEm(FILA_LEGADA)).toEqual([]);
    });

    it('a op do PRÓPRIO slot legado fica onde está: nenhum byte se move na instalação comum', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-carimbada-legado', '');
        semearNoLegado('op-sem-carimbo', null);
        ns.activateScope(ns.localScope('slot-1', ''));

        const relatorio = await migrar();

        expect(relatorio).toEqual({ moved: 0, kept: 2, failed: 0 });
        expect(idsEm(FILA_LEGADA)).toEqual(['op-carimbada-legado', 'op-sem-carimbo']);
        // E nenhum banco novo foi materializado por engano.
        expect([...databases.keys()].filter(k => k.startsWith('ebgeo__'))).toEqual([]);
    });

    it('sem atlas montado não há dono a inferir, e nada se move', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-antiga', null);
        expect(ns.getActiveScope()).toBeNull();

        const relatorio = await migrar();

        expect(relatorio).toEqual({ moved: 0, kept: 0, failed: 0 });
        expect(idsEm(FILA_LEGADA)).toEqual(['op-antiga']);
    });

    // ------------------------------------------------------------------------------------
    // A propriedade que não se pode perder: uma falha PRESERVA. É o caso que separa esta
    // migração de um `removeItem` otimista.
    // ------------------------------------------------------------------------------------
    it('destino que recusa a escrita: a op FICA na origem e o relatório diz que ficou', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-do-X', `remote-${ATLAS_X}`);
        semearNoLegado('op-que-passa', 'bbb');
        falharAoEscreverEm(`ebgeo__remote-${ATLAS_X}`);
        ns.activateScope(ns.localScope('slot-1', ''));

        const relatorio = await migrar();

        expect(relatorio).toEqual({ moved: 1, kept: 0, failed: 1 });
        // a que falhou continua inteira na origem
        expect(idsEm(FILA_LEGADA)).toEqual(['op-do-X']);
        expect(idsEm(filaDe(`remote-${ATLAS_X}`))).toEqual([]);
        // e a vizinha, que não falhou, atravessou: o `failed` não é uma parada geral
        expect(idsEm(filaDe('bbb'))).toEqual(['op-que-passa']);
    });

    it('rodar de novo não duplica nem perde: o segundo passe não tem o que fazer', async () => {
        const { ns, migrar } = await carregar();
        semearNoLegado('op-do-X', `remote-${ATLAS_X}`);
        ns.activateScope(ns.localScope('slot-1', ''));

        await migrar();
        const segundo = await migrar();

        expect(segundo).toEqual({ moved: 0, kept: 0, failed: 0 });
        expect(idsEm(filaDe(`remote-${ATLAS_X}`))).toEqual(['op-do-X']);
        expect(idsEm(FILA_LEGADA)).toEqual([]);
    });

    it('chave que não é entrada de fila é ignorada, não movida', async () => {
        const { ns, migrar } = await carregar();
        databases.set(FILA_LEGADA, new Map([['algum_outro_registro', { id: 'x' }]]));
        ns.activateScope(ns.remoteScope(ATLAS_X));

        const relatorio = await migrar();

        expect(relatorio).toEqual({ moved: 0, kept: 0, failed: 0 });
        expect(databases.get(FILA_LEGADA).has('algum_outro_registro')).toBe(true);
    });

    // ------------------------------------------------------------------------------------
    // A FIAÇÃO. Uma migração correta que ninguém chama é código morto com aparência de
    // conserto, e o único jeito de saber é dirigir o boot de verdade.
    // ------------------------------------------------------------------------------------
    it('o BOOT roda o roteamento, depois de montar o escopo', async () => {
        semearNoLegado('op-do-X', `remote-${ATLAS_X}`);
        semearNoLegado('op-do-slot-1', null);

        vi.resetModules();
        const { initServices } = await import('@store/services.js');
        initServices();
        const { sessionContext } = await import('@store/sync/session-context.js');
        vi.spyOn(sessionContext, 'isAuthenticated').mockReturnValue(false);
        const store = await import('@store/store.js');

        await store.initializeWithLastActiveMap();

        // A carimbada foi para o namespace do atlas dela...
        expect(idsEm(filaDe(`remote-${ATLAS_X}`))).toEqual(['op-do-X']);
        // ...e a sem carimbo ficou com o slot montado no boot, que é o legado. Nenhuma sumiu.
        expect(idsEm(FILA_LEGADA)).toEqual(['op-do-slot-1']);
    });

    it('a operação atravessa INTEIRA: o envelope no destino é idêntico ao da origem', async () => {
        // Mover é reendereçar, nunca reescrever. Um carimbo "consertado" no caminho mudaria
        // o que o servidor recebe, e o payload é o trabalho do usuário.
        const { ns, migrar } = await carregar();
        semearNoLegado('op-do-X', `remote-${ATLAS_X}`);
        const antes = structuredClone([...databases.get(FILA_LEGADA).entries()][0]);
        ns.activateScope(ns.localScope('slot-1', ''));

        await migrar();

        const depois = [...databases.get(filaDe(`remote-${ATLAS_X}`)).entries()][0];
        expect(depois).toEqual(antes);
    });
});
