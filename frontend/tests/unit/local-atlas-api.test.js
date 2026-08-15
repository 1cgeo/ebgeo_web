// Path: tests/unit/local-atlas-api.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    localSlotsOnDisk,
    legacyLocalRegistryOnDisk,
    localAtlasDiskKey,
    LEGACY_LOCAL_REGISTRY_KEY,
    LOCAL_ATLAS_KEY_PREFIX
} from '../helpers/atlas-registry-disk.js';

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

/**
 * The local slots present ON DISK, read by the shared helper instead of by a private copy of
 * the key layout. `listLocalAtlases()` answers from the in-memory mirror, which is a different
 * question and the one that hides a registry that never got written.
 * @returns {Array<object>} Oldest first.
 */
function slotsOnDisk() {
    return localSlotsOnDisk(databases.get('ebgeo_global::keyvaluepairs'));
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

describe('local-atlas.api :: o registro é uma chave POR SLOT (E4)', () => {
    // O DEFEITO QUE ISTO FECHA, e ele custava trabalho do usuário.
    //
    // O registro era um array sob a chave `local_atlases`, reescrito INTEIRO a cada mudança.
    // Duas abas fazem read-modify-write sobre o mesmo valor: A lê [x], acrescenta `a`, grava
    // [x,a]; B lê [x], acrescenta `b`, grava [x,b]. Sobra [x,b], e o slot `a` some do registro
    // com seus dez bancos DE PÉ no disco, invisíveis para todo expurgo e para toda tela.
    //
    // Não é hipotético e não precisa de azar: as duas abas de um usuário cuja sessão morre
    // juntas rodam as duas o resgate (`adoptRemoteAtlasAsLocal`), e o segundo apaga o primeiro.
    // O registro REMOTO já documentava exatamente esse raciocínio (`remote-atlas.api.js`,
    // propriedade 2) e o local o ignorava.
    //
    // Este teste modela as duas abas do jeito que elas de fato se atropelam: dois REGISTROS DE
    // MÓDULO distintos sobre o MESMO disco falso, cada um com seu espelho em memória. Com uma
    // chave por slot as duas escritas sobrevivem; com o array, a segunda apagava a primeira.
    beforeEach(async () => {
        await api.initLocalAtlases();
    });

    it('duas abas criando um slot cada: as DUAS entradas sobrevivem', async () => {
        // Aba A (o registro de módulo já carregado) cria o seu.
        const a = await api.createLocalAtlas('Operação Alfa');
        expect(a.ok).toBe(true);

        // Aba B: outro grafo de módulos, mesmo disco. É o que duas abas realmente são.
        vi.resetModules();
        const apiB = await import('../../src/js/store/local-atlas.api.js');
        await apiB.initLocalAtlases();
        const b = await apiB.createLocalAtlas('Operação Bravo');
        expect(b.ok).toBe(true);

        // Uma terceira leitura, limpa, é quem diz o que ficou NO DISCO. Perguntar a uma das
        // duas abas devolveria o espelho de memória dela, que não é a propriedade em questão.
        vi.resetModules();
        const apiC = await import('../../src/js/store/local-atlas.api.js');
        await apiC.initLocalAtlases();
        const nomes = apiC.listLocalAtlases().map(e => e.name).sort();

        expect(nomes).toEqual(['Meu Atlas', 'Operação Alfa', 'Operação Bravo']);
        // E o disco confirma pelo caminho independente: o espelho de `apiC` foi construído
        // pelo mesmo leitor de produção que está sob teste, então sozinho ele não distingue
        // "as duas entradas ficaram" de "o leitor inventou as duas".
        expect(slotsOnDisk().map(e => e.name).sort())
            .toEqual(['Meu Atlas', 'Operação Alfa', 'Operação Bravo']);
    });

    it('a chave antiga é MIGRADA e removida, e o slot dela continua no disco', async () => {
        // Uma instalação que ainda não bootou desde a mudança: só o array antigo.
        const globalStore = ns.getGlobalStore();
        for (const k of await globalStore.keys()) {
            if (k.startsWith(LOCAL_ATLAS_KEY_PREFIX)) await globalStore.removeItem(k);
        }
        await globalStore.setItem(LEGACY_LOCAL_REGISTRY_KEY, {
            version: 1,
            atlases: [{ id: 'slot-antigo', name: 'Herdado', dbSuffix: '', createdAt: 1, updatedAt: 1 }]
        });

        vi.resetModules();
        const fresco = await import('../../src/js/store/local-atlas.api.js');
        await fresco.initLocalAtlases();

        expect(fresco.listLocalAtlases().map(e => e.id)).toContain('slot-antigo');
        // A chave nova existe...
        expect(await globalStore.getItem(localAtlasDiskKey('slot-antigo')))
            .toMatchObject({ name: 'Herdado' });
        // ...e a antiga saiu, senão a migração re-rodaria para sempre e ressuscitaria um slot
        // que o usuário tivesse apagado no meio tempo. Legada e atual são lidas SEPARADAMENTE
        // de propósito: um leitor que fundisse as duas formas responderia igual antes e depois
        // da migração, que é justamente a diferença medida aqui.
        expect(slotsOnDisk().map(e => e.id)).toEqual(['slot-antigo']);
        expect(legacyLocalRegistryOnDisk(databases.get('ebgeo_global::keyvaluepairs'))).toBeNull();
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

    // VERMELHO SE `seedAtlasRecord` parar de carimbar `schemaVersion` no slot novo.
    //
    // POR QUE ISTO É UMA MINA E NÃO UM DETALHE. `checkAndCleanLegacyData` (`repository.js`) lê
    // essa chave do escopo ATIVO em todo boot e, achando-a ausente ou abaixo do mínimo, chama
    // `clearLegacyStores()`. Um slot criado aqui nasce vazio, então sem o carimbo o PRIMEIRO
    // boot depois de ele receber dado apagaria esse dado, sem erro: o guarda não distingue
    // "slot novo no schema corrente" de "instalação anterior ao schema", e a ausência lê como
    // a segunda. Ninguém tropeçou nisso enquanto o único slot vinha da migração; passa a ser
    // alcançável no primeiro chamador de `createLocalAtlas`, que é o import de `.ebgeo` (E3).
    it('o slot novo nasce CARIMBADO, ou o primeiro boot apaga o que ele receber', async () => {
        // Import dinâmico como o resto do arquivo: os módulos são carregados DEPOIS do mock.
        const { ATLAS_SCHEMA_VERSION } = await import('../../src/js/store/atlas/atlas.entity.js');
        const { MIN_SCHEMA_VERSION, compareVersions } =
            await import('../../src/js/store/repository.utils.js');
        const { atlas } = await api.createLocalAtlas('Operação Bravo');
        const scope = api.scopeOfLocalAtlas(atlas);

        const carimbo = await ns.getStoreFor(ns.StoreName.SETTINGS, scope).getItem('schemaVersion');

        expect(carimbo).toBe(ATLAS_SCHEMA_VERSION);
        // Absoluto, e não "é truthy": um carimbo abaixo do mínimo dispara a mesma limpeza que
        // a ausência, então "tem alguma coisa escrita ali" não é a propriedade que salva o dado.
        expect(compareVersions(carimbo, MIN_SCHEMA_VERSION)).toBeGreaterThanOrEqual(0);
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
        // ONZE desde E2B: a fila de saída daquele slot morre com ele. A do slot LEGADO
        // (nome `ebgeo`, sem sufixo) é outro banco e continua intacta, conferido abaixo.
        expect(resultado.droppedDatabases).toHaveLength(11);
        expect(resultado.droppedDatabases).toContain(`ebgeo__${alvo.dbSuffix}`);
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

// ============================================================================
// QUAL SLOT ESTA ABA REABRE (Decisão 6 de `atlas-namespace.js`)
//
// `GlobalKey.CURRENT_LOCAL_ATLAS` é o ponteiro da INSTALAÇÃO, e responde certo para uma aba
// que nunca montou nada. Para uma aba que montou, ele responde a aba errada: com duas abas
// em dois atlas locais, ele guarda o que foi aberto por último, então um F5 na outra aba a
// leva para o atlas da vizinha.
//
// O QUE ESTES VERDES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO: a asserção é o NOME ABSOLUTO do
// banco montado mais o valor do ponteiro global NO DISCO. Um `preferTabMountPointer` que não
// fizesse nada derruba o primeiro caso; um que reescrevesse o ponteiro global derruba a
// segunda asserção do mesmo caso, que é a metade que protege a vizinha.
// ============================================================================

/**
 * Um `sessionStorage` de mentira, por aba.
 * @param {Map<string, string>} [backing]
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function fakeTabStorage(backing = new Map()) {
    return {
        __backing: backing,
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => { backing.set(k, String(v)); },
        removeItem: (k) => { backing.delete(k); }
    };
}

describe('local-atlas.api :: qual slot esta ABA reabre', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /**
     * Deixa a instalação com DOIS slots e o ponteiro global apontando para o segundo.
     * Roda sem `sessionStorage`, de propósito: a preparação não pode plantar o ponteiro de
     * aba que os casos abaixo estão medindo.
     * @returns {Promise<{primeiro: object, segundo: object}>}
     */
    async function duasSlots() {
        await api.initLocalAtlases();
        const criado = await api.createLocalAtlas('Segundo');
        await api.setCurrentLocalAtlas(criado.atlas.id);
        return { primeiro: api.listLocalAtlases()[0], segundo: criado.atlas };
    }

    /** Simula o F5: grafo de módulos novo sobre o MESMO disco falso. */
    async function recarregar() {
        vi.resetModules();
        ns = await import('../../src/js/store/atlas-namespace.js');
        api = await import('../../src/js/store/local-atlas.api.js');
    }

    /** @param {object} ponteiro - Registro cru a plantar como ponteiro desta aba. */
    function abaMontou(ponteiro) {
        const storage = fakeTabStorage();
        storage.setItem('ebgeo_tab_mount', JSON.stringify({ version: 1, ...ponteiro }));
        vi.stubGlobal('sessionStorage', storage);
        return storage;
    }

    /** @returns {string|null} O ponteiro da instalação, lido do disco falso. */
    function ponteiroGlobalNoDisco() {
        return databases.get('ebgeo_global::keyvaluepairs')?.get('current_local_atlas') ?? null;
    }

    it('o ponteiro da ABA vence o da instalação, e NÃO o reescreve', async () => {
        const { primeiro, segundo } = await duasSlots();
        expect(ponteiroGlobalNoDisco()).toBe(segundo.id);

        abaMontou({ kind: 'local', atlasId: primeiro.id, dbSuffix: primeiro.dbSuffix });
        await recarregar();

        const resultado = await api.initLocalAtlases({ preferTabMountPointer: true });

        expect(resultado.current.id).toBe(primeiro.id);
        // Nome ABSOLUTO: o slot #1 herdou os bancos sem sufixo, então é este o endereço.
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe('ebgeo_maps');
        // E a metade que protege a vizinha: o padrão da instalação continua sendo o dela.
        expect(ponteiroGlobalNoDisco()).toBe(segundo.id);
    });

    it('CONTROLE NEGATIVO: sem a opção, o MESMO disco monta o slot da instalação', async () => {
        const { primeiro, segundo } = await duasSlots();

        abaMontou({ kind: 'local', atlasId: primeiro.id, dbSuffix: primeiro.dbSuffix });
        await recarregar();

        const resultado = await api.initLocalAtlases();

        expect(resultado.current.id).toBe(segundo.id);
        expect(ns.getStore(ns.StoreName.MAPS).__dbName).toBe(`ebgeo_maps__${segundo.dbSuffix}`);
    });

    it('CONTROLE NEGATIVO: aba sem ponteiro (aba nova) cai no ponteiro da instalação', async () => {
        const { segundo } = await duasSlots();

        vi.stubGlobal('sessionStorage', fakeTabStorage());
        await recarregar();

        const resultado = await api.initLocalAtlases({ preferTabMountPointer: true });

        expect(resultado.current.id).toBe(segundo.id);
    });

    it('ponteiro de aba apontando para slot que não existe mais cai no da instalação', async () => {
        // O outro dono pode ter excluído o slot enquanto esta aba estava fechada. Inventar o
        // slot de volta aqui seria uma criação escondida dentro de um boot.
        const { segundo } = await duasSlots();

        abaMontou({ kind: 'local', atlasId: 'slot-que-sumiu', dbSuffix: 'slot-que-sumiu' });
        await recarregar();

        const resultado = await api.initLocalAtlases({ preferTabMountPointer: true });

        expect(resultado.current.id).toBe(segundo.id);
        expect(api.listLocalAtlases()).toHaveLength(2);
    });

    it('ponteiro de aba REMOTO não escolhe slot local: quem decide isso é a origem', async () => {
        const { segundo } = await duasSlots();

        abaMontou({ kind: 'remote', atlasId: 'servidor-1', dbSuffix: 'remote-servidor-1' });
        await recarregar();

        // Sem sessão, a origem REMOTE não monta o namespace de servidor (regra anterior a esta
        // fase), então o que sobra é a escolha de slot local, e ela ignora o ponteiro remoto.
        const resultado = await api.initLocalAtlases({
            preferTabMountPointer: true,
            origin: { kind: 'remote', atlasId: 'servidor-1' },
            isAuthenticated: false
        });

        expect(resultado.current.id).toBe(segundo.id);
        expect(ns.getActiveScope().kind).toBe('local');
    });
});
