import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Same name-keyed fake as the factory test: the point of these tests is WHICH
// database a write landed in, so the fake must distinguish databases by name.
// ============================================================================

const { databases, makeStore, resetFake, uuidCounter } = vi.hoisted(() => {
    const databases = new Map();
    const uuidCounter = { value: 0 };

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        const key = keyOf(name, storeName);
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); })
        };
    }

    function resetFake() {
        databases.clear();
        uuidCounter.value = 0;
    }

    return { databases, makeStore, resetFake, uuidCounter };
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

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `id-${uuidCounter.value}`;
    }),
    isValidUUID: vi.fn(() => true),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true)
}));

let ns;
let api;
let bus;
let clock;

beforeEach(async () => {
    vi.resetModules();
    resetFake();

    // Monotonic clock so createdAt/updatedAt never tie: "the most recently updated
    // remaining atlas" is a real ordering assertion, not a coin flip.
    clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));

    ns = await import('../../src/js/store/atlas-namespace.js');
    api = await import('../../src/js/store/local-atlas.api.js');
    const errors = await import('../../src/js/store/store-errors.js');
    bus = { emit: vi.fn() };
    errors.setStoreErrorEventBus(bus);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Databases of a slot that actually exist in the fake origin. */
function dbNamesWithSuffix(suffix) {
    return [...databases.keys()].filter(k => k.includes(`__${suffix}::`));
}

describe('local-atlas.api :: boot e ponteiro de atlas corrente', () => {
    it('instalacao sem registro nasce com "Meu Atlas" herdando os bancos legados', async () => {
        const resultado = await api.initLocalAtlases();

        expect(resultado.current.name).toBe('Meu Atlas');
        expect(resultado.current.dbSuffix).toBe('');
        expect(api.listLocalAtlases()).toHaveLength(1);
        expect(api.getCurrentLocalAtlasId()).toBe(resultado.current.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps');
    });

    it('o slot legado NAO recebe registro de atlas semeado (nao sobrescreve o do usuario migrado)', async () => {
        const { scope } = await api.initLocalAtlases();
        const registro = await ns.getStoreFor(ns.StoreName.ATLAS, scope).getItem('current_atlas');
        expect(registro).toBeNull();
    });

    it('INVARIANTE: com origem REMOTE o bootstrap nao adota os bancos legados', async () => {
        await ns.getGlobalStore().setItem(ns.GlobalKey.STORE_ORIGIN, { kind: 'remote', atlasId: 'servidor-1' });

        const { current, scope } = await api.initLocalAtlases({ isAuthenticated: false });

        expect(current.dbSuffix).not.toBe('');
        expect(scope.kind).toBe('local');
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${current.dbSuffix}`);

        const registro = await ns.getStoreFor(ns.StoreName.ATLAS, scope).getItem('current_atlas');
        expect(registro.id).toBe(current.id);
        expect(registro.name).toBe('Meu Atlas');
    });

    it('adoptLegacyDatabases explicito vence o padrao vindo da origem', async () => {
        await ns.getGlobalStore().setItem(ns.GlobalKey.STORE_ORIGIN, { kind: 'remote', atlasId: 'servidor-1' });
        const { current } = await api.initLocalAtlases({ adoptLegacyDatabases: true });
        expect(current.dbSuffix).toBe('');
    });

    it('origem REMOTE com sessao viva ativa o rascunho remoto e preserva o ponteiro local', async () => {
        await ns.getGlobalStore().setItem(ns.GlobalKey.STORE_ORIGIN, { kind: 'remote', atlasId: 'servidor-1' });

        const { scope, current } = await api.initLocalAtlases({ isAuthenticated: true });

        expect(scope.kind).toBe('remote');
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__remote-servidor-1');
        expect(api.getCurrentLocalAtlasId()).toBe(current.id);
    });

    it('bootar duas vezes nao duplica o atlas nem move o ponteiro', async () => {
        const primeiro = await api.initLocalAtlases();
        const segundo = await api.initLocalAtlases();

        expect(api.listLocalAtlases()).toHaveLength(1);
        expect(segundo.current.id).toBe(primeiro.current.id);
    });

    it('ponteiro apontando para atlas inexistente cai no mais recente e se conserta', async () => {
        await api.initLocalAtlases();
        await api.createLocalAtlas('Operação Alfa');
        await ns.getGlobalStore().setItem(ns.GlobalKey.CURRENT_LOCAL_ATLAS, 'id-que-nao-existe');

        const { current } = await api.initLocalAtlases();

        expect(current.name).toBe('Operação Alfa');
        expect(await ns.getGlobalStore().getItem(ns.GlobalKey.CURRENT_LOCAL_ATLAS)).toBe(current.id);
    });
});

describe('local-atlas.api :: criar e listar', () => {
    beforeEach(async () => {
        await api.initLocalAtlases();
    });

    it('cria um atlas com sufixo opaco e o semeia, sem trocar o corrente', async () => {
        const anterior = api.getCurrentLocalAtlasId();
        const resultado = await api.createLocalAtlas('Operação Alfa');

        expect(resultado.ok).toBe(true);
        expect(resultado.atlas.name).toBe('Operação Alfa');
        expect(resultado.atlas.dbSuffix).toBe(resultado.atlas.id);
        expect(api.listLocalAtlases()).toHaveLength(2);

        // não troca sozinho: quem troca é setCurrentLocalAtlas, depois de desmontar
        expect(api.getCurrentLocalAtlasId()).toBe(anterior);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps');

        const scope = api.scopeOfLocalAtlas(resultado.atlas);
        const registro = await ns.getStoreFor(ns.StoreName.ATLAS, scope).getItem('current_atlas');
        expect(registro.id).toBe(resultado.atlas.id);
        expect(registro.name).toBe('Operação Alfa');
    });

    it('o sufixo do banco nunca e o nome do usuario', async () => {
        const { atlas } = await api.createLocalAtlas('Operação Alfa 2026');
        const nome = ns.resolveDbName(ns.StoreName.MAPS, api.scopeOfLocalAtlas(atlas));
        expect(nome).not.toContain('Opera');
        expect(nome).toBe(`ebgeo_maps__${atlas.id}`);
    });

    it('nome duplicado e sufixado, nunca recusado', async () => {
        const segundo = await api.createLocalAtlas('Meu Atlas');
        const terceiro = await api.createLocalAtlas('Meu Atlas');
        const quarto = await api.createLocalAtlas('meu atlas');

        expect(segundo.atlas.name).toBe('Meu Atlas (2)');
        expect(terceiro.atlas.name).toBe('Meu Atlas (3)');
        expect(quarto.atlas.name).toBe('meu atlas (4)');
        expect(api.listLocalAtlases()).toHaveLength(4);
    });

    it('nome vazio e bug do chamador, entao lanca', async () => {
        await expect(api.createLocalAtlas('')).rejects.toThrow(/non-empty string/);
        await expect(api.createLocalAtlas('   ')).rejects.toThrow(/non-empty string/);
        await expect(api.createLocalAtlas(null)).rejects.toThrow(/non-empty string/);
    });

    it('a lista sai do mais antigo para o mais novo', async () => {
        await api.createLocalAtlas('Bravo');
        await api.createLocalAtlas('Charlie');
        expect(api.listLocalAtlases().map(a => a.name)).toEqual(['Meu Atlas', 'Bravo', 'Charlie']);
    });

    it('operar sem initLocalAtlases e bug do chamador', async () => {
        vi.resetModules();
        const fresco = await import('../../src/js/store/local-atlas.api.js');
        expect(() => fresco.listLocalAtlases()).toThrow(/initLocalAtlases/);
    });
});

describe('local-atlas.api :: teto de 10', () => {
    beforeEach(async () => {
        await api.initLocalAtlases();
    });

    it('aceita ate o DECIMO e recusa o DECIMO PRIMEIRO com erro nomeado', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i++) {
            const resultado = await api.createLocalAtlas(`Atlas ${i}`);
            // controle da borda de baixo: se o teto disparasse cedo, isto ficaria vermelho
            expect(resultado.ok).toBe(true);
        }
        expect(api.listLocalAtlases()).toHaveLength(10);

        const estouro = await api.createLocalAtlas('Atlas 11');

        expect(estouro.ok).toBe(false);
        expect(estouro.error).toBe(api.LocalAtlasError.LIMIT_REACHED);
        expect(estouro.message).toBe('Limite de 10 atlas locais atingido. Exclua um atlas antes de criar outro.');
        expect(api.listLocalAtlases()).toHaveLength(10);
    });

    it('a recusa e visivel: emite STORE_OPERATION_BLOCKED com a mensagem em pt-BR', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i++) {
            await api.createLocalAtlas(`Atlas ${i}`);
        }
        bus.emit.mockClear();

        await api.createLocalAtlas('Atlas 11');

        expect(bus.emit).toHaveBeenCalledTimes(1);
        expect(bus.emit).toHaveBeenCalledWith('store:operationBlocked', expect.objectContaining({
            operation: 'localAtlas',
            reason: 'local_atlas_limit',
            message: expect.stringContaining('Limite de 10 atlas locais'),
            count: 10,
            max: 10
        }));
    });

    it('a recusa nao cria banco nenhum', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i++) {
            await api.createLocalAtlas(`Atlas ${i}`);
        }
        const antes = [...databases.keys()].filter(k => k.startsWith('ebgeo_atlas__')).length;
        expect(antes).toBe(9); // os 9 slots com sufixo; o legado usa o nome sem sufixo

        await api.createLocalAtlas('Atlas 11');

        expect([...databases.keys()].filter(k => k.startsWith('ebgeo_atlas__')).length).toBe(9);
    });

    it('o teto sobrevive ao reboot (vale para migracao e import de .ebgeo)', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i++) {
            await api.createLocalAtlas(`Atlas ${i}`);
        }
        await api.initLocalAtlases();

        expect(api.listLocalAtlases()).toHaveLength(10);
        const estouro = await api.createLocalAtlas('Atlas 11');
        expect(estouro.error).toBe(api.LocalAtlasError.LIMIT_REACHED);
    });

    it('excluir libera vaga', async () => {
        for (let i = 2; i <= api.MAX_LOCAL_ATLASES; i++) {
            await api.createLocalAtlas(`Atlas ${i}`);
        }
        const vitima = api.listLocalAtlases().find(a => a.name === 'Atlas 5');

        await api.deleteLocalAtlas(vitima.id);
        const depois = await api.createLocalAtlas('Atlas 11');

        expect(depois.ok).toBe(true);
        expect(api.listLocalAtlases()).toHaveLength(10);
    });
});

describe('local-atlas.api :: trocar de atlas corrente', () => {
    beforeEach(async () => {
        await api.initLocalAtlases();
    });

    it('troca o ponteiro e re-aponta os acessores', async () => {
        const { atlas } = await api.createLocalAtlas('Operação Alfa');

        const resultado = await api.setCurrentLocalAtlas(atlas.id);

        expect(resultado.ok).toBe(true);
        expect(api.getCurrentLocalAtlasId()).toBe(atlas.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${atlas.id}`);
        expect(ns.getStore(ns.StoreName.COMMENTS).__dbName).toBe(`ebgeo_comments__${atlas.id}`);
    });

    it('a troca persiste no ponteiro global e sobrevive ao reboot', async () => {
        const { atlas } = await api.createLocalAtlas('Operação Alfa');
        await api.setCurrentLocalAtlas(atlas.id);

        const { current } = await api.initLocalAtlases();

        expect(current.id).toBe(atlas.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${atlas.id}`);
    });

    it('id inexistente e recusa nomeada, sem mover o ponteiro', async () => {
        const anterior = api.getCurrentLocalAtlasId();

        const resultado = await api.setCurrentLocalAtlas('id-que-nao-existe');

        expect(resultado.ok).toBe(false);
        expect(resultado.error).toBe(api.LocalAtlasError.NOT_FOUND);
        expect(resultado.message).toContain('Atlas local não encontrado');
        expect(api.getCurrentLocalAtlasId()).toBe(anterior);
        expect(bus.emit).toHaveBeenCalledWith('store:operationBlocked', expect.objectContaining({
            reason: 'local_atlas_not_found'
        }));
    });

    it('com o rascunho REMOTO ativo o ponteiro muda, mas o escopo ativo nao', async () => {
        const { atlas } = await api.createLocalAtlas('Operação Alfa');
        ns.activateScope(ns.remoteScope('servidor-1'));

        await api.setCurrentLocalAtlas(atlas.id);

        expect(api.getCurrentLocalAtlasId()).toBe(atlas.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps__remote-servidor-1');
    });
});

describe('local-atlas.api :: excluir atlas', () => {
    beforeEach(async () => {
        await api.initLocalAtlases();
    });

    it('apaga os 10 bancos do atlas e preserva o vizinho e os globais', async () => {
        const alvo = (await api.createLocalAtlas('Alvo')).atlas;
        const vizinho = (await api.createLocalAtlas('Vizinho')).atlas;
        await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(alvo)).setItem('m', 'do alvo');
        await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(vizinho)).setItem('m', 'do vizinho');
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE).setItem('op_1', {});

        const resultado = await api.deleteLocalAtlas(alvo.id);

        expect(resultado.ok).toBe(true);
        expect(resultado.droppedDatabases).toHaveLength(10);
        expect(api.listLocalAtlases().map(a => a.name)).toEqual(['Meu Atlas', 'Vizinho']);
        expect(dbNamesWithSuffix(alvo.dbSuffix)).toHaveLength(0);

        // controles negativos: vizinho e globais intactos
        expect(await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(vizinho)).getItem('m'))
            .toBe('do vizinho');
        expect(databases.has('ebgeo::operation_queue')).toBe(true);
        expect(databases.has('ebgeo_global::keyvaluepairs')).toBe(true);
    });

    it('excluir o CORRENTE move o ponteiro para o mais recente e re-aponta os acessores', async () => {
        const alfa = (await api.createLocalAtlas('Alfa')).atlas;
        const bravo = (await api.createLocalAtlas('Bravo')).atlas;
        await api.setCurrentLocalAtlas(alfa.id);

        const resultado = await api.deleteLocalAtlas(alfa.id);

        expect(resultado.ok).toBe(true);
        expect(api.getCurrentLocalAtlasId()).toBe(bravo.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${bravo.id}`);
        expect(api.listLocalAtlases()).toHaveLength(2);
    });

    it('o ponteiro reparado sobrevive ao reboot', async () => {
        const alfa = (await api.createLocalAtlas('Alfa')).atlas;
        await api.setCurrentLocalAtlas(alfa.id);
        await api.deleteLocalAtlas(alfa.id);

        const { current } = await api.initLocalAtlases();

        expect(current.name).toBe('Meu Atlas');
    });

    it('o ULTIMO atlas local nao pode ser excluido, e seus bancos ficam de pe', async () => {
        const unico = api.listLocalAtlases()[0];
        await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(unico)).setItem('m', 'trabalho');

        const resultado = await api.deleteLocalAtlas(unico.id);

        expect(resultado.ok).toBe(false);
        expect(resultado.error).toBe(api.LocalAtlasError.LAST_ATLAS);
        expect(resultado.message).toContain('único atlas local');
        expect(api.listLocalAtlases()).toHaveLength(1);
        expect(await ns.getStoreFor(ns.StoreName.MAPS, api.scopeOfLocalAtlas(unico)).getItem('m'))
            .toBe('trabalho');
    });

    it('id inexistente e recusa nomeada', async () => {
        await api.createLocalAtlas('Alfa');
        const resultado = await api.deleteLocalAtlas('id-que-nao-existe');

        expect(resultado.ok).toBe(false);
        expect(resultado.error).toBe(api.LocalAtlasError.NOT_FOUND);
        expect(api.listLocalAtlases()).toHaveLength(2);
    });
});
