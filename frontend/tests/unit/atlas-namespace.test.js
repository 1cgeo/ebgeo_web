import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// The factory is the ONLY place allowed to call localforage.createInstance, so the
// fake below is keyed by (name, storeName) exactly like a real origin's database
// namespace: two calls with the same name MUST reach the same backing store, and a
// different name MUST reach a different one. That is the property under test.
// ============================================================================

const { databases, createCalls, makeStore, dropFromFake, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const createCalls = [];

    /** Default behaviour of `dropInstance`: the delete completes. Named so a test that
     * overrides it (a delete another tab is holding open) can put it back. */
    async function dropFromFake({ name }) {
        for (const key of [...databases.keys()]) {
            if (key.startsWith(`${name}::`)) databases.delete(key);
        }
    }

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

    return { databases, createCalls, makeStore, dropFromFake, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(dropFromFake)
    }
}));

/**
 * Fresh module state per test: the factory caches instances at module level.
 *
 * The localforage double does NOT come back fresh (the mock survives `vi.resetModules()`),
 * so its implementation is restored explicitly. Without this, a test that makes a delete
 * hang leaves every later test running against a store that never deletes, which is the
 * kind of green that proves nothing.
 */
async function loadNamespace() {
    vi.resetModules();
    resetFake();
    const localforage = (await import('localforage')).default;
    localforage.dropInstance.mockReset();
    localforage.dropInstance.mockImplementation(dropFromFake);
    localforage.createInstance.mockClear();
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

    // Este bloco AFIRMAVA o contrário ("todo atlas REMOTO cai no mesmo rascunho"), que era a
    // regra antiga: um único rascunho `__remote` para todos. Duas abas em atlas remotos
    // diferentes escreveriam nos MESMOS bancos, que não é disputa de acesso, é o mesmo
    // endereço. A asserção foi invertida junto com o código, não removida.
    it('INVARIANTE: dois atlas REMOTOS distintos nunca compartilham banco', () => {
        const primeiro = ns.remoteScope('11111111-1111-4111-8111-111111111111');
        const segundo = ns.remoteScope('22222222-2222-4222-8222-222222222222');

        for (const base of PER_ATLAS_BASE_NAMES) {
            const id = ns.STORE_DESCRIPTORS.find(d => d.dbName === base).id;
            expect(ns.resolveDbName(id, primeiro))
                .toBe(`${base}__remote-11111111-1111-4111-8111-111111111111`);
            expect(ns.resolveDbName(id, segundo))
                .toBe(`${base}__remote-22222222-2222-4222-8222-222222222222`);
            expect(ns.resolveDbName(id, segundo)).not.toBe(ns.resolveDbName(id, primeiro));
            // e nenhum dos dois colide com um slot local (nem com o legado, sem sufixo)
            expect(ns.resolveDbName(id, primeiro)).not.toBe(base);
            expect(ns.resolveDbName(id, primeiro))
                .not.toBe(ns.resolveDbName(id, ns.localScope('a', 'aaa')));
        }
    });

    it('escopo remoto sem id nao cai num nome compartilhado: quebra alto', () => {
        expect(() => ns.remoteScope()).toThrow(/atlasId/);
        expect(() => ns.remoteScope(null)).toThrow(/atlasId/);
        expect(() => ns.remoteScope('')).toThrow(/atlasId/);
        // controle negativo: com id opaco, resolve
        expect(ns.remoteScope('servidor-1').dbSuffix).toBe('remote-servidor-1');
    });

    it('recusa id de atlas remoto que nao seja opaco (ele chega ao nome do banco)', () => {
        expect(() => ns.remoteScope('Operação Alfa')).toThrow(/atlasId/);
        expect(() => ns.remoteScope('a/b')).toThrow(/atlasId/);
    });

    it('o sufixo adotado (remote-<id>) e legal como slot LOCAL, e o rascunho nu nao', () => {
        // O resgate de trabalho não sincronizado transfere a posse do namespace para o
        // registro local SEM copiar dez bancos, então este sufixo precisa ser aceitável.
        expect(ns.localScope('adotado', 'remote-servidor-1').dbSuffix).toBe('remote-servidor-1');
        expect(() => ns.localScope('a', 'remote')).toThrow(/reserved/);
        expect(ns.isRemoteDbSuffix('remote-servidor-1')).toBe(true);
        expect(ns.isRemoteDbSuffix('remote')).toBe(false);
        expect(ns.isRemoteDbSuffix('')).toBe(false);
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
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__remote-servidor');
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

        const { dropped, blocked } = await ns.dropAtlasDatabases(scope);

        expect(dropped).toHaveLength(10);
        expect(blocked).toEqual([]);
        expect([...dropped].sort()).toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__aaa`).sort());
        for (const name of dropped) {
            expect(databases.has(`${name}::keyvaluepairs`)).toBe(false);
        }
        // controle negativo: os globais continuam de pe, com o dado dentro
        expect(databases.has('ebgeo_global::keyvaluepairs')).toBe(true);
        expect(databases.has('ebgeo::operation_queue')).toBe(true);
    });

    // ------------------------------------------------------------------------
    // Decisão 4: um delete que não completa não pode virar espera muda.
    // ------------------------------------------------------------------------

    it('delete que fica PENDENTE e reportado como blocked, sem travar a espera', async () => {
        const localforage = (await import('localforage')).default;
        const scope = ns.localScope('a', 'aaa');
        // Uma aba vizinha segura a conexão: o dropInstance nunca resolve.
        localforage.dropInstance.mockImplementation(() => new Promise(() => {}));

        const { dropped, blocked } = await ns.dropAtlasDatabases(scope, { timeoutMs: 5 });

        expect(dropped).toEqual([]);
        expect(blocked).toHaveLength(10);
        expect([...blocked].sort()).toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__aaa`).sort());
    });

    it('CONTROLE NEGATIVO: com o mesmo tempo limite e um delete que responde, blocked e vazio', async () => {
        const scope = ns.localScope('a', 'aaa');

        const { dropped, blocked } = await ns.dropAtlasDatabases(scope, { timeoutMs: 5 });

        expect(blocked).toEqual([]);
        expect(dropped).toHaveLength(10);
    });

    it('delete que REJEITA conta como blocked: dos dois jeitos o banco ficou no disco', async () => {
        const localforage = (await import('localforage')).default;
        localforage.dropInstance.mockImplementation(async ({ name }) => {
            if (name === 'ebgeo_images__aaa') throw new Error('UnknownError');
        });

        const { dropped, blocked } = await ns.dropAtlasDatabases(ns.localScope('a', 'aaa'), { timeoutMs: 5 });

        expect(blocked).toEqual(['ebgeo_images__aaa']);
        expect(dropped).toHaveLength(9);
    });

    it('clearAtlasDatabases ESVAZIA os dez sem apagar nenhum', async () => {
        const localforage = (await import('localforage')).default;
        const scope = ns.localScope('a', 'aaa');
        for (const { store } of ns.listAtlasStores(scope)) await store.setItem('k', 1);

        const cleared = await ns.clearAtlasDatabases(scope);

        expect([...cleared].sort()).toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__aaa`).sort());
        for (const { store } of ns.listAtlasStores(scope)) {
            expect(await store.getItem('k')).toBeNull();
        }
        // continua de pé: esvaziar não é destruir
        expect(localforage.dropInstance).not.toHaveBeenCalled();
        expect(databases.has('ebgeo_maps__aaa::keyvaluepairs')).toBe(true);
    });

    it('clearActiveScope deixa o proximo getStore sem escopo, em vez de reviver o destruido', async () => {
        ns.activateScope(ns.remoteScope('servidor-1'));
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__remote-servidor-1');

        ns.clearActiveScope();

        expect(ns.getActiveScope()).toBeNull();
        expect(() => ns.getStore(ns.StoreName.MAPS)).toThrow(/no active atlas scope/);
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
