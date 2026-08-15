import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// The factory is the ONLY place allowed to call localforage.createInstance, so the
// fake below is keyed by (name, storeName) exactly like a real origin's database
// namespace: two calls with the same name MUST reach the same backing store, and a
// different name MUST reach a different one. That is the property under test.
// ============================================================================

const { databases, createCalls, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const createCalls = [];

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        createCalls.push(keyOf(name, storeName));
        const key = keyOf(name, storeName);
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: name,
            __storeName: storeName,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }

    function resetFake() {
        databases.clear();
        createCalls.length = 0;
    }

    return { databases, createCalls, makeStore, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async ({ name }) => {
            for (const key of [...databases.keys()]) {
                if (key.startsWith(`${name}::`)) databases.delete(key);
            }
        })
    }
}));

/** Fresh module state per test: the factory caches instances at module level. */
async function loadNamespace() {
    vi.resetModules();
    resetFake();
    return await import('../../src/js/store/atlas-namespace.js');
}

/** The ten per-atlas databases, written out instead of derived (see coverage note below). */
const PER_ATLAS_BASE_NAMES = [
    'ebgeo_atlas',
    'ebgeo_maps',
    'ebgeo_images',
    'ebgeo_app_settings',
    'ebgeo_groups',
    'ebgeo_layers',
    'ebgeo_cesium3d',
    'ebgeo_streetview360',
    'ebgeo_briefings',
    'ebgeo_comments'
];

let ns;

beforeEach(async () => {
    ns = await loadNamespace();
});

describe('atlas-namespace :: descritores', () => {
    // Absolute counts on purpose. A test that only compares the module against itself
    // ("everything in the list is namespaced") passes green on an empty list.
    it('declara exatamente 12 bancos, 10 por atlas e 2 globais', () => {
        expect(ns.STORE_DESCRIPTORS).toHaveLength(12);
        expect(ns.STORE_DESCRIPTORS.filter(d => d.perAtlas)).toHaveLength(10);

        const globals = ns.STORE_DESCRIPTORS.filter(d => !d.perAtlas).map(d => d.id);
        expect(globals.sort()).toEqual([ns.StoreName.GLOBAL, ns.StoreName.OPERATION_QUEUE].sort());
    });

    it('os nomes base dos bancos por atlas sao os de hoje, sem renomear nada', () => {
        const perAtlas = ns.STORE_DESCRIPTORS.filter(d => d.perAtlas).map(d => d.dbName);
        expect(perAtlas.sort()).toEqual([...PER_ATLAS_BASE_NAMES].sort());
    });

    it('a fila de operacoes mantem name ebgeo + storeName operation_queue', () => {
        const queue = ns.STORE_DESCRIPTORS.find(d => d.id === ns.StoreName.OPERATION_QUEUE);
        expect(queue.dbName).toBe('ebgeo');
        expect(queue.storeName).toBe('operation_queue');
        expect(queue.perAtlas).toBe(false);
    });
});

describe('atlas-namespace :: resolucao de nome', () => {
    it('o slot legado resolve para os nomes SEM sufixo (migracao sem copia)', () => {
        const scope = ns.localScope('atlas-legado', ns.LEGACY_DB_SUFFIX);
        for (const base of PER_ATLAS_BASE_NAMES) {
            const id = ns.STORE_DESCRIPTORS.find(d => d.dbName === base).id;
            expect(ns.resolveDbName(id, scope)).toBe(base);
        }
    });

    it('um slot novo resolve para base__<sufixo>', () => {
        const scope = ns.localScope('atlas-2', 'abc123');
        expect(ns.resolveDbName(ns.StoreName.MAPS, scope)).toBe('ebgeo_maps__abc123');
        expect(ns.resolveDbName(ns.StoreName.IMAGES, scope)).toBe('ebgeo_images__abc123');
        expect(ns.resolveDbName(ns.StoreName.ATLAS, scope)).toBe('ebgeo_atlas__abc123');
    });

    it('dois slots diferentes nunca compartilham banco', () => {
        const a = ns.localScope('a', 'aaa');
        const b = ns.localScope('b', 'bbb');
        for (const base of PER_ATLAS_BASE_NAMES) {
            const id = ns.STORE_DESCRIPTORS.find(d => d.dbName === base).id;
            expect(ns.resolveDbName(id, a)).not.toBe(ns.resolveDbName(id, b));
        }
    });

    it('INVARIANTE: todo atlas REMOTO cai no mesmo rascunho, sem banco por atlasId', () => {
        const primeiro = ns.remoteScope('11111111-1111-4111-8111-111111111111');
        const segundo = ns.remoteScope('22222222-2222-4222-8222-222222222222');

        for (const base of PER_ATLAS_BASE_NAMES) {
            const id = ns.STORE_DESCRIPTORS.find(d => d.dbName === base).id;
            expect(ns.resolveDbName(id, primeiro)).toBe(`${base}__remote`);
            expect(ns.resolveDbName(id, segundo)).toBe(ns.resolveDbName(id, primeiro));
            // e o rascunho jamais colide com um slot local
            expect(ns.resolveDbName(id, primeiro)).not.toBe(base);
        }
    });

    it('o que e GLOBAL resolve igual em local, remoto e slots diferentes', () => {
        const escopos = [
            ns.localScope('a', ''),
            ns.localScope('b', 'bbb'),
            ns.remoteScope('atlas-servidor')
        ];
        for (const scope of escopos) {
            expect(ns.resolveDbName(ns.StoreName.GLOBAL, scope)).toBe('ebgeo_global');
            expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, scope)).toBe('ebgeo');
        }
        // e resolvem mesmo sem escopo ativo nenhum
        expect(ns.resolveDbName(ns.StoreName.GLOBAL)).toBe('ebgeo_global');
        expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE)).toBe('ebgeo');
    });

    it('recusa sufixo que nao seja id opaco, e o sufixo reservado do remoto', () => {
        expect(() => ns.localScope('a', 'Meu Atlas')).toThrow(/dbSuffix/);
        expect(() => ns.localScope('a', 'operação')).toThrow(/dbSuffix/);
        expect(() => ns.localScope('a', 'remote')).toThrow(/reserved/);
        expect(() => ns.localScope('', 'aaa')).toThrow(/atlasId/);
    });

    it('id de store desconhecido quebra alto, nao devolve nome adivinhado', () => {
        expect(() => ns.resolveDbName('inexistente', ns.localScope('a', ''))).toThrow(/Unknown store id/);
    });
});

describe('atlas-namespace :: escopo ativo', () => {
    it('acessar store por atlas sem escopo ativo quebra alto', () => {
        expect(() => ns.getStore(ns.StoreName.MAPS)).toThrow(/no active atlas scope/);
    });

    it('store global funciona antes de qualquer escopo (bootstrap do boot)', () => {
        expect(ns.getGlobalStore().__dbName).toBe('ebgeo_global');
    });

    it('activateScope re-aponta todos os acessores de uma vez', () => {
        ns.activateScope(ns.localScope('a', ''));
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps');

        ns.activateScope(ns.localScope('b', 'bbb'));
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__bbb');
        expect(ns.getStore(ns.StoreName.LAYERS).__dbName).toBe('ebgeo_layers__bbb');

        ns.activateScope(ns.remoteScope('servidor'));
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__remote');
        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.REMOTE);
    });

    it('listAtlasStores devolve os 10 bancos por atlas do escopo', () => {
        const stores = ns.listAtlasStores(ns.localScope('b', 'bbb'));
        expect(stores).toHaveLength(10);
        expect(stores.map(s => s.store.__dbName).sort())
            .toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__bbb`).sort());
    });
});

describe('atlas-namespace :: cache de instancia', () => {
    it('mesma store e mesmo escopo devolvem O MESMO handle', () => {
        const scope = ns.localScope('a', 'aaa');
        const primeiro = ns.getStoreFor(ns.StoreName.MAPS, scope);
        const segundo = ns.getStoreFor(ns.StoreName.MAPS, scope);

        expect(segundo).toBe(primeiro);
        expect(createCalls.filter(c => c === 'ebgeo_maps__aaa::keyvaluepairs')).toHaveLength(1);
    });

    it('escopos diferentes devolvem handles diferentes', () => {
        const a = ns.getStoreFor(ns.StoreName.MAPS, ns.localScope('a', 'aaa'));
        const b = ns.getStoreFor(ns.StoreName.MAPS, ns.localScope('b', 'bbb'));
        expect(b).not.toBe(a);
    });

    it('clearStoreCache(escopo) invalida so aquele escopo', () => {
        const escopoA = ns.localScope('a', 'aaa');
        const escopoB = ns.localScope('b', 'bbb');
        const a1 = ns.getStoreFor(ns.StoreName.MAPS, escopoA);
        const b1 = ns.getStoreFor(ns.StoreName.MAPS, escopoB);

        ns.clearStoreCache(escopoA);

        expect(ns.getStoreFor(ns.StoreName.MAPS, escopoA)).not.toBe(a1);
        expect(ns.getStoreFor(ns.StoreName.MAPS, escopoB)).toBe(b1);
    });
});

describe('atlas-namespace :: destruicao de bancos', () => {
    it('apaga os 10 bancos do escopo e NAO toca nos globais', async () => {
        const scope = ns.localScope('a', 'aaa');
        // materializa os bancos do slot mais os dois globais
        for (const { store } of ns.listAtlasStores(scope)) {
            await store.setItem('k', 1);
        }
        await ns.getGlobalStore().setItem('local_atlases', { version: 1, atlases: [] });
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE).setItem('op_1', {});

        const dropped = await ns.dropAtlasDatabases(scope);

        expect(dropped).toHaveLength(10);
        expect(dropped.sort()).toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__aaa`).sort());
        for (const name of dropped) {
            expect(databases.has(`${name}::keyvaluepairs`)).toBe(false);
        }
        // controle negativo: os globais continuam de pe, com o dado dentro
        expect(databases.has('ebgeo_global::keyvaluepairs')).toBe(true);
        expect(databases.has('ebgeo::operation_queue')).toBe(true);
    });

    it('nao alcanca outro slot local', async () => {
        const alvo = ns.localScope('a', 'aaa');
        const vizinho = ns.localScope('b', 'bbb');
        await ns.getStoreFor(ns.StoreName.MAPS, alvo).setItem('m', 'do alvo');
        await ns.getStoreFor(ns.StoreName.MAPS, vizinho).setItem('m', 'do vizinho');

        await ns.dropAtlasDatabases(alvo);

        expect(databases.has('ebgeo_maps__aaa::keyvaluepairs')).toBe(false);
        expect(await ns.getStoreFor(ns.StoreName.MAPS, vizinho).getItem('m')).toBe('do vizinho');
    });
});
