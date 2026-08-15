// Path: tests/unit/operation-queue-wipe-de-entrada.test.js

/**
 * @fileoverview O PORTÃO DE E2B: a fila do atlas que está ABRINDO sobrevive ao wipe de
 * entrada.
 *
 * `openRemoteAtlas` faz, nesta ordem: reivindica o atlas, ATIVA o namespace dele
 * (`activateRemoteAtlas`) e só então esvazia (`clearAllDataStore`), porque o wipe tem de
 * mirar o namespace que esta aba acabou de reivindicar e não o da irmã. Com a fila virando
 * o 11º banco POR ATLAS, isso põe a fila do atlas de destino dentro do alcance do wipe: as
 * operações que o usuário deixou pendentes naquele projeto seriam destruídas segundos antes
 * do `connect` que as drenaria.
 *
 * A exclusão é explícita em dois lugares e este arquivo assere os dois:
 *   - `listAtlasStores` (a lista do wipe) só devolve o que é `atlasData`;
 *   - `clearAllDataStore` decide sobre a fila por `clearQueue`, cujo padrão segue `markLocal`.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: cada caso lê o BANCO POR NOME
 * ABSOLUTO (`ebgeo__remote-<id>::operation_queue`), nunca pelo acessor, e todo caso que
 * exige sobrevivência tem ao lado o caso que exige destruição. "A fila de X sobreviveu" e
 * "o clear virou no-op" são o mesmo verde sem o segundo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { databases, storeOf, resetDisk } = vi.hoisted(() => {
    const databases = new Map();

    function backingOf(name, storeName = null) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        if (!databases.has(key)) databases.set(key, new Map());
        return databases.get(key);
    }

    function storeOf({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            length: vi.fn(async () => backing.size),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (callback) => {
                for (const [k, v] of backing.entries()) callback(v, k);
            })
        };
    }

    return { databases, storeOf, resetDisk: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async () => {})
    }
}));

const ATLAS_X = '11111111-1111-4111-8111-111111111111';
const ATLAS_Y = '22222222-2222-4222-8222-222222222222';

/**
 * @param {string} atlasId - Atlas de servidor.
 * @returns {string} Chave do banco de fila daquele atlas no disco falso, ABSOLUTA.
 */
function filaDe(atlasId) {
    return `ebgeo__remote-${atlasId}::operation_queue`;
}

/**
 * @param {string} chaveDeBanco - Chave do disco falso.
 * @returns {string[]} `entityId` das operações guardadas ali, em ordem de chave.
 */
function opsEm(chaveDeBanco) {
    const banco = databases.get(chaveDeBanco);
    if (!banco) return [];
    return [...banco.keys()].sort().map(k => banco.get(k).entityId);
}

/**
 * A fachada do store num grafo de módulos novo. `initServices()` é a fiação de boot de
 * verdade, então os caminhos sob teste rodam contra os managers reais.
 * @returns {Promise<{store: Object, queue: Object, factory: Object}>}
 */
async function carregarFachada() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    initServices();
    const store = await import('@store/store.js');
    const { operationQueue } = await import('@store/sync/operation-queue.js');
    const factory = await import('@store/sync/operation-factory.js');
    return { store, queue: operationQueue, factory };
}

/**
 * Enfileira N operações carimbadas pela FÁBRICA no escopo ativo. Carimbar à mão faria o
 * caso ficar verde se a fábrica parasse de carimbar.
 * @param {Object} queue - A fila.
 * @param {Object} factory - O módulo da fábrica.
 * @param {string[]} entityIds - Um id por operação.
 * @returns {Promise<void>}
 */
async function enfileirar(queue, factory, entityIds) {
    let ts = 1700000000000;
    for (const entityId of entityIds) {
        const op = factory.createOperation(
            'feature', 'create', entityId, '4a22f7df-df6d-47df-80bb-f26df86d31ec', { nome: entityId }
        );
        op.timestamp = ts++;
        await queue.enqueue(op);
    }
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

describe('o wipe de entrada e a fila do atlas de destino', () => {
    it('PORTÃO: 3 ops em X, sai para Y, VOLTA para X — as 3 sobrevivem ao wipe de entrada', async () => {
        const { store, queue, factory } = await carregarFachada();

        await store.activateRemoteAtlas(ATLAS_X);
        await enfileirar(queue, factory, ['x1', 'x2', 'x3']);
        // POSITIVA antes de qualquer negativa: sem ela, um 3 adiante poderia vir de qualquer
        // lugar, e um 0 seria indistinguível de uma fila que nunca recebeu nada.
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2', 'x3']);

        // Sai para Y exatamente como `openRemoteAtlas`: ativa o namespace de destino e SÓ
        // ENTÃO esvazia, com `markLocal: false` porque quem vai marcar a origem é o open.
        await store.activateRemoteAtlas(ATLAS_Y);
        await store.clearAllDataStore({ markLocal: false });

        // E volta para X, do mesmo jeito. O `count()` é lido DEPOIS do wipe e ANTES de
        // qualquer `connect`: é essa janela que o defeito destruía.
        await store.activateRemoteAtlas(ATLAS_X);
        await store.clearAllDataStore({ markLocal: false });

        expect(await queue.count()).toBe(3);
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2', 'x3']);
    });

    it('CONTROLE NEGATIVO do portão: com `clearQueue: true` as mesmas 3 morrem', async () => {
        // Sem este caso, o de cima não distingue "a fila foi preservada" de "o wipe parou de
        // funcionar". A mutação é feita pelo parâmetro, no mesmo cenário, e não por uma
        // segunda montagem que poderia divergir.
        const { store, queue, factory } = await carregarFachada();

        await store.activateRemoteAtlas(ATLAS_X);
        await enfileirar(queue, factory, ['x1', 'x2', 'x3']);
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2', 'x3']);

        await store.clearAllDataStore({ markLocal: false, clearQueue: true });

        expect(await queue.count()).toBe(0);
        expect(opsEm(filaDe(ATLAS_X))).toEqual([]);
    });

    it('o wipe que TERMINA em local (o padrão) esvazia a fila do atlas montado', async () => {
        // "Limpar Tudo", import `.ebgeo`, logout: o dado que aquelas operações descrevem está
        // sendo abandonado junto, e mantê-las empurraria fantasmas de entidades apagadas no
        // próximo connect. O padrão de `clearQueue` segue `markLocal` por essa razão.
        const { store, queue, factory } = await carregarFachada();

        await store.activateRemoteAtlas(ATLAS_X);
        await enfileirar(queue, factory, ['x1', 'x2']);
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2']);

        await store.clearAllDataStore();

        expect(await queue.count()).toBe(0);
        expect(opsEm(filaDe(ATLAS_X))).toEqual([]);
    });

    it('PORTÃO (duas abas): a aba B troca de projeto e a fila de X, da aba A, sobrevive', async () => {
        // O gesto mais comum do produto, e o defeito mais caro do grupo B: o que se perdia
        // era o payload da entidade, isto é, a feição que o usuário desenhou e não subiu.
        const { store, queue, factory } = await carregarFachada();

        // Aba A trabalhando em X.
        await store.activateRemoteAtlas(ATLAS_X);
        await enfileirar(queue, factory, ['x1', 'x2', 'x3']);
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2', 'x3']);

        // Aba B, no mesmo disco, abre Y e faz o wipe DELA. Um único processo não tem duas
        // abas, então o que se simula é o que a aba B faz ao disco: montar outro namespace e
        // esvaziar. Do ponto de vista do dado de X, é indistinguível.
        await store.activateRemoteAtlas(ATLAS_Y);
        await enfileirar(queue, factory, ['y1']);
        await store.clearAllDataStore();

        expect(opsEm(filaDe(ATLAS_Y))).toEqual([]);
        expect(opsEm(filaDe(ATLAS_X))).toEqual(['x1', 'x2', 'x3']);

        // E a aba A continua enxergando as suas ao voltar.
        await store.activateRemoteAtlas(ATLAS_X);
        expect(await queue.count()).toBe(3);
    });

    it('ESTRUTURAL: a fila não está na lista que o wipe de atlas deriva', async () => {
        // A metade estrutural do portão. Sem ela, os casos acima continuariam verdes se a
        // exclusão migrasse para uma condicional em `clearAllDataStore` e a lista derivada
        // voltasse a incluir a fila — e aí qualquer outro chamador de `clearAllAtlasStores`
        // (o guarda de boot, o repositório) passaria a destruí-la.
        const ns = await import('@store/atlas-namespace.js');
        const ids = ns.listAtlasStores(ns.remoteScope(ATLAS_X)).map(s => s.id);

        expect(ids).toHaveLength(10);
        expect(ids).not.toContain(ns.StoreName.OPERATION_QUEUE);
        // Controle positivo: a fila EXISTE como banco por atlas, ela só não é dado de atlas.
        const fila = ns.STORE_DESCRIPTORS.find(d => d.id === ns.StoreName.OPERATION_QUEUE);
        expect(fila.perAtlas).toBe(true);
        expect(fila.atlasData).toBe(false);
    });
});
