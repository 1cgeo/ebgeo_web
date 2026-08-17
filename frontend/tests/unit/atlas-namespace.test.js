// Path: tests/unit/atlas-namespace.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    localAtlasDiskKey,
    localSlotsOnDisk,
    LOCAL_ATLAS_KEY_PREFIX,
    LEGACY_LOCAL_REGISTRY_KEY,
    REMOTE_ATLAS_KEY_PREFIX,
    CURRENT_LOCAL_ATLAS_KEY
} from '../helpers/atlas-registry-disk.js';

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
    it('declara exatamente 12 bancos, 11 por atlas e 1 global', () => {
        expect(ns.STORE_DESCRIPTORS).toHaveLength(12);
        expect(ns.STORE_DESCRIPTORS.filter(d => d.perAtlas)).toHaveLength(11);

        const globals = ns.STORE_DESCRIPTORS.filter(d => !d.perAtlas).map(d => d.id);
        expect(globals).toEqual([ns.StoreName.GLOBAL]);
    });

    // AS DUAS LISTAS SÃO DIFERENTES, e este é o caso que prende a diferença. `perAtlas`
    // responde "morre com o atlas"; `atlasData` responde "é esvaziado pelo wipe de atlas".
    // A fila é a única linha em que as duas respostas divergem, e confundi-las é uma perda
    // de dado em cada sentido: dentro do wipe ela apaga a fila do atlas que está ABRINDO,
    // fora da destruição ela deixa o payload das entidades de um atlas de servidor no disco
    // depois do logout.
    it('a fila é por atlas mas NÃO é dado do atlas, e é a única assim', () => {
        const soDaFila = ns.STORE_DESCRIPTORS.filter(d => d.perAtlas && !d.atlasData);
        expect(soDaFila.map(d => d.id)).toEqual([ns.StoreName.OPERATION_QUEUE]);

        const dados = ns.STORE_DESCRIPTORS.filter(d => d.atlasData).map(d => d.dbName);
        expect(dados.sort()).toEqual([...PER_ATLAS_BASE_NAMES].sort());
        // Controle absoluto: nada com `atlasData` pode estar fora do namespace.
        expect(ns.STORE_DESCRIPTORS.filter(d => d.atlasData && !d.perAtlas)).toEqual([]);
    });

    it('a fila de operacoes mantem name ebgeo + storeName operation_queue', () => {
        const queue = ns.STORE_DESCRIPTORS.find(d => d.id === ns.StoreName.OPERATION_QUEUE);
        expect(queue.dbName).toBe('ebgeo');
        expect(queue.storeName).toBe('operation_queue');
        expect(queue.perAtlas).toBe(true);
        expect(queue.atlasData).toBe(false);
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
        }
        // e resolve mesmo sem escopo ativo nenhum
        expect(ns.resolveDbName(ns.StoreName.GLOBAL)).toBe('ebgeo_global');
    });

    // A fila deixou de ser global e virou o 11º banco por atlas. O nome do slot LEGADO é o
    // mesmo de sempre (`ebgeo`), que é o que faz a instalação comum não mover byte nenhum, e
    // é justamente por isso que o caso precisa das duas metades: a igualdade sozinha ficaria
    // verde com a fila global de volta.
    it('a fila resolve um banco por atlas, e o legado continua sendo `ebgeo`', () => {
        expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, ns.localScope('a', '')))
            .toBe('ebgeo');
        expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, ns.localScope('b', 'bbb')))
            .toBe('ebgeo__bbb');
        expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, ns.remoteScope('atlas-servidor')))
            .toBe('ebgeo__remote-atlas-servidor');

        // O escopo de recuo, usado enquanto nada está montado: é o legado, nunca um nome novo.
        expect(ns.UNMOUNTED_QUEUE_SCOPE.dbSuffix).toBe(ns.LEGACY_DB_SUFFIX);
        expect(ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, ns.UNMOUNTED_QUEUE_SCOPE))
            .toBe('ebgeo');
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

// ============================================================================
// O LAYOUT DO REGISTRO NO DISCO, asserido de propósito e só aqui.
//
// Sete arquivos de teste conheciam este layout de cor, e a última mudança dele (de um array
// sob `local_atlases` para uma chave por slot) deixou 31 casos vermelhos sem um único bug no
// código. A leitura passou para `tests/helpers/atlas-registry-disk.js` e ninguém mais precisa
// saber o nome das chaves. Este bloco é a exceção deliberada: é contrato de DISCO, um dia
// alguém vai precisar migrá-lo de novo, e nesse dia a mudança tem que aparecer aqui, num
// vermelho nomeado, em vez de espalhada por vinte casos que falam de outra coisa.
//
// Ele também é a junta entre instrumento e sujeito. O helper reescreve as chaves literalmente
// para NÃO chamar `readLocalAtlasRegistry` (senão medida e medido concordariam por
// construção); o preço é que as duas declarações podem divergir em silêncio. As duas primeiras
// asserções abaixo são o que torna essa divergência um vermelho.
// ============================================================================

describe('atlas-namespace :: layout do registro no disco', () => {
    const GLOBAL_DISK = 'ebgeo_global::keyvaluepairs';

    it('as chaves sao `local_atlas:<id>` e `remote_atlas:<id>`, e a antiga e `local_atlases`', () => {
        expect(ns.GlobalKey.LOCAL_ATLAS_PREFIX).toBe('local_atlas:');
        expect(ns.GlobalKey.REMOTE_ATLAS_PREFIX).toBe('remote_atlas:');
        expect(ns.GlobalKey.LOCAL_ATLASES).toBe('local_atlases');
        expect(ns.GlobalKey.CURRENT_LOCAL_ATLAS).toBe('current_local_atlas');

        expect(ns.localAtlasRegistryKey('abc')).toBe('local_atlas:abc');
        expect(ns.remoteAtlasRegistryKey('abc')).toBe('remote_atlas:abc');
        expect(ns.atlasIdFromLocalRegistryKey('local_atlas:abc')).toBe('abc');
        expect(ns.isLocalAtlasRegistryKey('local_atlases')).toBe(false);
    });

    // P8: `remoteAtlasKey` existia com DOIS significados, um import de distância um do outro.
    // Aqui é a chave de REGISTRO (uma string, endereço no banco global); em
    // `utilities/tab-lock.js` é a chave de REIVINDICAÇÃO entre abas (um objeto
    // `{kind, atlasId}`, que nunca toca disco). O par local já dizia `localAtlasRegistryKey`;
    // esta é a simetria que faltava, e o caso abaixo é o que impede o nome ambíguo de voltar
    // pela porta dos fundos — reintroduzi-lo aqui reprova.
    it('a fábrica NÃO exporta o nome ambíguo `remoteAtlasKey` (o homônimo é do tab-lock)', async () => {
        expect(typeof ns.remoteAtlasRegistryKey).toBe('function');
        expect(ns.remoteAtlasKey).toBeUndefined();

        // Controle positivo do sujeito: o homônimo EXISTE e devolve outra coisa, senão este
        // caso passaria numa árvore em que o tab-lock nem tem essa função.
        const tabLock = await import('@utils/tab-lock.js');
        expect(typeof tabLock.remoteAtlasKey).toBe('function');
        expect(tabLock.remoteAtlasKey('abc')).not.toBe(ns.remoteAtlasRegistryKey('abc'));
        expect(typeof tabLock.remoteAtlasKey('abc')).toBe('object');
    });

    // `describeRemoteNamespaceClaim` é a leitura que permite ao marcador de origem parar de
    // ser uma segunda fonte de verdade (P5): quem possui o namespace de um atlas de servidor,
    // perguntado aos DOIS registros e a mais nada.
    describe('describeRemoteNamespaceClaim', () => {
        it('devolve `remote` quando o registro remoto ainda nomeia o atlas', async () => {
            await ns.getGlobalStore().setItem('remote_atlas:srv', { atlasId: 'srv' });
            expect(await ns.describeRemoteNamespaceClaim('srv')).toBe('remote');
        });

        it('devolve `local` quando um slot local reivindica aquele sufixo (o resgate)', async () => {
            await ns.getGlobalStore().setItem('local_atlas:resgate', { dbSuffix: 'remote-srv' });
            expect(await ns.describeRemoteNamespaceClaim('srv')).toBe('local');
        });

        // A ORDEM É A DO RESGATE: `adoptRemoteAtlasAsLocal` escreve a entrada local ANTES de
        // remover a remota, então um crash no meio deixa as duas de pé. Ler a remota primeiro
        // chamaria de "dado de servidor" um slot que já é do usuário.
        it('com AS DUAS entradas de pé, o slot local vence', async () => {
            const globalStore = ns.getGlobalStore();
            await globalStore.setItem('remote_atlas:srv', { atlasId: 'srv' });
            await globalStore.setItem('local_atlas:resgate', { dbSuffix: 'remote-srv' });
            expect(await ns.describeRemoteNamespaceClaim('srv')).toBe('local');
        });

        it('devolve `none` quando nenhum registro o nomeia, e um slot local de OUTRO sufixo não conta', async () => {
            await ns.getGlobalStore().setItem('local_atlas:slot', { dbSuffix: 'aaa' });
            expect(await ns.describeRemoteNamespaceClaim('srv')).toBe('none');
        });

        // Borda: um id que `remoteScope` recusa não nomeia namespace nenhum, e a leitura não
        // pode propagar o throw para dentro de um boot.
        it('um id que não pode virar namespace devolve `none` em vez de lançar', async () => {
            expect(() => ns.remoteScope('id/inválido')).toThrow();
            expect(await ns.describeRemoteNamespaceClaim('id/inválido')).toBe('none');
            expect(await ns.describeRemoteNamespaceClaim('')).toBe('none');
        });
    });

    it('o helper de teste declara as MESMAS chaves que a producao', () => {
        // Sem esta amarra, o helper poderia envelhecer apontando para um layout que já não
        // existe, e todos os testes que dependem dele passariam a medir um disco vazio.
        expect(LOCAL_ATLAS_KEY_PREFIX).toBe(ns.GlobalKey.LOCAL_ATLAS_PREFIX);
        expect(REMOTE_ATLAS_KEY_PREFIX).toBe(ns.GlobalKey.REMOTE_ATLAS_PREFIX);
        expect(LEGACY_LOCAL_REGISTRY_KEY).toBe(ns.GlobalKey.LOCAL_ATLASES);
        expect(CURRENT_LOCAL_ATLAS_KEY).toBe(ns.GlobalKey.CURRENT_LOCAL_ATLAS);
    });

    it('readLocalAtlasRegistry le UMA CHAVE POR SLOT, com a identidade vinda da chave', async () => {
        const globalStore = ns.getGlobalStore();
        await globalStore.setItem('local_atlas:alfa', { name: 'Alfa', dbSuffix: '', createdAt: 1 });
        await globalStore.setItem('local_atlas:bravo', { name: 'Bravo', dbSuffix: 'bbb', createdAt: 2 });
        // Vizinhos que NÃO são entrada de registro: um quase-prefixo e o ponteiro corrente.
        await globalStore.setItem('local_atlasX', { name: 'Nao sou slot' });
        await globalStore.setItem('current_local_atlas', 'alfa');

        const slots = await ns.readLocalAtlasRegistry();

        expect(slots.map(s => s.id).sort()).toEqual(['alfa', 'bravo']);
        expect(slots.find(s => s.id === 'bravo').dbSuffix).toBe('bbb');
        // E o helper, lendo as chaves cruas do mesmo disco por caminho independente, concorda.
        expect(localSlotsOnDisk(databases.get(GLOBAL_DISK)).map(s => s.id)).toEqual(['alfa', 'bravo']);
    });

    it('a instalacao que so tem o array antigo continua enxergavel, e a chave nova VENCE', async () => {
        const globalStore = ns.getGlobalStore();
        await globalStore.setItem('local_atlas:alfa', { name: 'Alfa migrado', dbSuffix: '' });
        await globalStore.setItem('local_atlases', {
            version: 1,
            atlases: [
                { id: 'alfa', name: 'Alfa velho', dbSuffix: '' },
                { id: 'charlie', name: 'Charlie', dbSuffix: 'ccc' }
            ]
        });

        const slots = await ns.readLocalAtlasRegistry();
        const porId = Object.fromEntries(slots.map(s => [s.id, s]));

        expect(Object.keys(porId).sort()).toEqual(['alfa', 'charlie']);
        // A cópia antiga não pode ressuscitar por cima da migrada: um slot renomeado (ou
        // apagado) voltaria com o nome de antes a cada boot.
        expect(porId.alfa.name).toBe('Alfa migrado');
        expect(porId.charlie.dbSuffix).toBe('ccc');
        // O helper vê SÓ a forma atual, de propósito: é o que separa "migrou" de "não migrou".
        expect(localSlotsOnDisk(databases.get(GLOBAL_DISK)).map(s => s.id)).toEqual(['alfa']);
    });

    it('valor corrompido sob chave de registro NAO vira slot sem sufixo', async () => {
        // Um slot sem `dbSuffix` resolve para os bancos SEM sufixo, que são os do espaço de
        // trabalho real da instalação. Promover lixo a slot apontaria uma entrada estranha para
        // os dez bancos do usuário, então a leitura descarta o que não é objeto.
        const globalStore = ns.getGlobalStore();
        await globalStore.setItem('local_atlas:bom', { name: 'Bom', dbSuffix: 'bbb' });
        await globalStore.setItem('local_atlas:lixo', 'nao sou objeto');

        const slots = await ns.readLocalAtlasRegistry();

        expect(slots.map(s => s.id)).toEqual(['bom']);
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

    // DEZ, não onze, e o caso existe para prender essa exclusão. `listAtlasStores` é a lista
    // do WIPE DE ATLAS (`clearAllAtlasStores`), e `openRemoteAtlas` ativa o namespace do atlas
    // que está abrindo e esvazia três linhas depois: a fila aqui dentro seria o trabalho
    // pendente DAQUELE atlas, destruído segundos antes do `connect` que o drenaria.
    it('listAtlasStores devolve os 10 bancos de DADO do escopo, e a fila fica de fora', () => {
        const stores = ns.listAtlasStores(ns.localScope('b', 'bbb'));
        expect(stores).toHaveLength(10);
        expect(stores.map(s => s.store.__dbName).sort())
            .toEqual(PER_ATLAS_BASE_NAMES.map(n => `${n}__bbb`).sort());
        expect(stores.map(s => s.id)).not.toContain(ns.StoreName.OPERATION_QUEUE);
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

/**
 * Os ONZE bancos de um escopo: os dez de dado mais a fila. Escritos à mão a partir das
 * constantes do teste, nunca derivados do módulo sob teste, porque derivar faria sujeito e
 * instrumento concordarem por construção.
 * @param {string} sufixo - Sufixo de banco do escopo.
 * @returns {string[]} Nomes absolutos.
 */
function bancosDoEscopo(sufixo) {
    return [...PER_ATLAS_BASE_NAMES.map(n => `${n}__${sufixo}`), `ebgeo__${sufixo}`];
}

describe('atlas-namespace :: destruicao de bancos', () => {
    // ONZE: a fila do escopo morre com ele. Uma operação carrega o payload da entidade, então
    // apagar os dez bancos de dado e deixar `ebgeo__<sufixo>` de pé seria dado de servidor
    // legível no disco depois do logout, sob um nome que mais nada abre.
    it('apaga os 11 bancos do escopo (dado + fila) e NAO toca no global', async () => {
        const scope = ns.localScope('a', 'aaa');
        // materializa os bancos do slot, a fila DELE, e o banco global
        for (const { store } of ns.listAtlasStores(scope)) {
            await store.setItem('k', 1);
        }
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, scope).setItem('op_1', {});
        await ns.getGlobalStore().setItem(localAtlasDiskKey('slot-1'), { id: 'slot-1', dbSuffix: '' });
        // A fila do slot LEGADO (`ebgeo`), de outro atlas, tem que sobreviver a esta destruição.
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, ns.localScope('legado', ''))
            .setItem('op_do_legado', {});

        const { dropped, blocked } = await ns.dropAtlasDatabases(scope);

        expect(dropped).toHaveLength(11);
        expect(blocked).toEqual([]);
        expect([...dropped].sort()).toEqual(bancosDoEscopo('aaa').sort());
        for (const name of dropped) {
            expect(databases.has(`${name}::keyvaluepairs`) || databases.has(`${name}::operation_queue`))
                .toBe(false);
        }
        // controle negativo: o global e a fila do vizinho continuam de pe, com o dado dentro
        expect(databases.has('ebgeo_global::keyvaluepairs')).toBe(true);
        expect(databases.get('ebgeo::operation_queue')?.has('op_do_legado')).toBe(true);
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
        expect(blocked).toHaveLength(11);
        expect([...blocked].sort()).toEqual(bancosDoEscopo('aaa').sort());
    });

    it('CONTROLE NEGATIVO: com o mesmo tempo limite e um delete que responde, blocked e vazio', async () => {
        const scope = ns.localScope('a', 'aaa');

        const { dropped, blocked } = await ns.dropAtlasDatabases(scope, { timeoutMs: 5 });

        expect(blocked).toEqual([]);
        expect(dropped).toHaveLength(11);
    });

    it('delete que REJEITA conta como blocked: dos dois jeitos o banco ficou no disco', async () => {
        const localforage = (await import('localforage')).default;
        localforage.dropInstance.mockImplementation(async ({ name }) => {
            if (name === 'ebgeo_images__aaa') throw new Error('UnknownError');
        });

        const { dropped, blocked } = await ns.dropAtlasDatabases(ns.localScope('a', 'aaa'), { timeoutMs: 5 });

        expect(blocked).toEqual(['ebgeo_images__aaa']);
        expect(dropped).toHaveLength(10);
    });

    it('clearAtlasDatabases ESVAZIA os onze sem apagar nenhum', async () => {
        const localforage = (await import('localforage')).default;
        const scope = ns.localScope('a', 'aaa');
        for (const { store } of ns.listAtlasStores(scope)) await store.setItem('k', 1);
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, scope).setItem('op_1', {});

        const { names, cleared } = await ns.clearAtlasDatabases(scope);

        expect([...names].sort()).toEqual(bancosDoEscopo('aaa').sort());
        expect([...cleared].sort()).toEqual(bancosDoEscopo('aaa').sort());
        for (const { store } of ns.listAtlasStores(scope)) {
            expect(await store.getItem('k')).toBeNull();
        }
        expect(await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, scope).getItem('op_1'))
            .toBeNull();
        // continua de pé: esvaziar não é destruir
        expect(localforage.dropInstance).not.toHaveBeenCalled();
        expect(databases.has('ebgeo_maps__aaa::keyvaluepairs')).toBe(true);
    });

    // ------------------------------------------------------------------------
    // P3: esvaziar um escopo que nunca foi escrito não é uma destruição que aconteceu.
    //
    // O par abaixo é o que dá sentido ao caso acima: sem o escopo COM dado, "cleared vazio"
    // e "clearAtlasDatabases parou de funcionar" seriam o mesmo verde.
    // ------------------------------------------------------------------------

    it('escopo NUNCA escrito: nenhum banco entra em cleared, e nada é esvaziado', async () => {
        const escopoNovo = ns.localScope('z', 'zzz');

        const { names, cleared } = await ns.clearAtlasDatabases(escopoNovo);

        expect(cleared).toEqual([]);
        // os onze continuam sendo o alvo declarado: o que muda é a afirmação sobre eles
        expect(names).toHaveLength(11);
        // e o `clear()` do dobro nem foi chamado, que é o efeito que `cleared` relatava
        for (const { store } of ns.listAtlasStores(escopoNovo)) {
            expect(store.clear).not.toHaveBeenCalled();
        }
    });

    it('um único banco com dado: só ELE entra em cleared', async () => {
        const scope = ns.localScope('a', 'aaa');
        await ns.getStoreFor(ns.StoreName.MAPS, scope).setItem('k', 1);

        const { cleared } = await ns.clearAtlasDatabases(scope);

        expect(cleared).toEqual(['ebgeo_maps__aaa']);
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

// ============================================================================
// Decisão 5: o lock de montagem, medido com o primitivo DE VERDADE (`navigator.locks`
// existe no node que roda a suíte). Nada aqui usa dobro: um lock simulado provaria a
// simulação, e é o navegador que arbitra em produção.
// ============================================================================

describe('atlas-namespace :: lock de montagem', () => {
    /**
     * O que uma OUTRA aba veria ao tentar destruir aquele namespace.
     * @param {{dbSuffix: string}} scope - Escopo alvo.
     * @returns {Promise<boolean>} True quando ninguém tem o escopo montado.
     */
    function exclusivoDisponivel(scope) {
        return navigator.locks.request(
            ns.atlasMountLockName(scope.dbSuffix),
            { mode: 'exclusive', ifAvailable: true },
            lock => lock !== null
        );
    }

    it('o runtime da suíte TEM navigator.locks: sem isto o resto seria simulação', () => {
        expect(ns.hasMountLockSupport()).toBe(true);
        expect(typeof navigator.locks.request).toBe('function');
    });

    it('montar segura o lock daquele escopo, e só daquele', async () => {
        const montado = ns.remoteScope('servidor-1');
        const outro = ns.remoteScope('servidor-2');

        ns.activateScope(montado);

        expect(await exclusivoDisponivel(montado)).toBe(false);
        // controle negativo: um nome que ninguém montou continua livre, senão o `false`
        // acima seria indistinguível de um pedido que sempre falha
        expect(await exclusivoDisponivel(outro)).toBe(true);
    });

    it('trocar de escopo SOLTA o anterior: uma aba monta um atlas de cada vez', async () => {
        const primeiro = ns.remoteScope('servidor-1');
        const segundo = ns.remoteScope('servidor-2');
        ns.activateScope(primeiro);

        ns.activateScope(segundo);
        // a soltura do anterior é disparada sem espera; esta é a espera do chamador
        await ns.releaseMountLock(primeiro);

        expect(await exclusivoDisponivel(primeiro)).toBe(true);
        expect(await exclusivoDisponivel(segundo)).toBe(false);
    });

    it('releaseMountLock com escopo errado NÃO solta o que está montado', async () => {
        const montado = ns.remoteScope('servidor-1');
        ns.activateScope(montado);

        expect(await ns.releaseMountLock(ns.remoteScope('servidor-9'))).toBe(false);
        expect(await exclusivoDisponivel(montado)).toBe(false);

        expect(await ns.releaseMountLock(montado)).toBe(true);
        expect(await exclusivoDisponivel(montado)).toBe(true);
    });

    it('releaseRemoteMountLock solta um escopo REMOTO e deixa o LOCAL montado', async () => {
        const local = ns.localScope('a', 'aaa');
        ns.activateScope(local);

        expect(await ns.releaseRemoteMountLock()).toBe(false);
        expect(await exclusivoDisponivel(local)).toBe(false);

        const remoto = ns.remoteScope('servidor-1');
        ns.activateScope(remoto);
        expect(await ns.releaseRemoteMountLock()).toBe(true);
        expect(await exclusivoDisponivel(remoto)).toBe(true);
    });

    it('withExclusiveAtlasLock não executa nada quando alguém tem montado', async () => {
        const scope = ns.remoteScope('servidor-1');
        ns.activateScope(scope);
        const tarefa = vi.fn(async () => 'destruiu');

        const { granted, result } = await ns.withExclusiveAtlasLock(scope, tarefa);

        expect(granted).toBe(false);
        expect(result).toBeNull();
        expect(tarefa).not.toHaveBeenCalled();
    });

    it('CONTROLE NEGATIVO: solto o lock, a MESMA chamada executa a tarefa', async () => {
        const scope = ns.remoteScope('servidor-1');
        ns.activateScope(scope);
        await ns.releaseMountLock(scope);
        const tarefa = vi.fn(async () => 'destruiu');

        const { granted, result } = await ns.withExclusiveAtlasLock(scope, tarefa);

        expect(granted).toBe(true);
        expect(result).toBe('destruiu');
        expect(tarefa).toHaveBeenCalledTimes(1);
    });

    it('o nome do lock é injetivo, inclusive para o slot legado de sufixo vazio', () => {
        expect(ns.atlasMountLockName('')).not.toBe(ns.atlasMountLockName('legacy'));
        expect(ns.atlasMountLockName('remote-x')).not.toBe(ns.atlasMountLockName('remote-y'));
        // Esta linha era `expect(f('aaa')).toBe(f('aaa'))`, que é verdade para QUALQUER função
        // pura e portanto não media nada: a injetividade inteira estava nas duas linhas acima.
        // No lugar dela, o nome ABSOLUTO, porque a forma dele é contrato e não detalhe:
        // `releaseMountLockIfRemote` reconhece o lock por `startsWith(MOUNT_LOCK_PREFIX)` e recupera
        // o sufixo cortando em `MOUNT_LOCK_PREFIX.length + 1`, isto é, conta com o prefixo E com o
        // separador de um caractere. Uma implementação que devolvesse só o sufixo, ou que trocasse
        // o `#` por `-`, passaria nas duas linhas acima e quebraria aquele leitor.
        expect(ns.atlasMountLockName('aaa')).toBe('ebgeo-atlas:#aaa');
        expect(ns.atlasMountLockName('')).toBe('ebgeo-atlas:#');
        expect(ns.atlasMountLockName('remote-x')).toBe('ebgeo-atlas:#remote-x');
        // E o `#` é o que torna a aplicação injetiva, porque `VALID_SUFFIX` o proíbe dentro do
        // sufixo: sem separador nenhum, `remote-` + `x` e `remote-x` + `` dariam o mesmo nome.
        expect(ns.atlasMountLockName('remote-x').slice('ebgeo-atlas:'.length + 1)).toBe('remote-x');
    });

    // CONTEXTO NÃO SEGURO (HTTP puro): `navigator.locks` não existe, e ali o invariante duro
    // vence a conveniência. Sem este caso, "poupa" e "não tem como perguntar" seriam a mesma
    // resposta na única configuração em que a diferença apaga dado de servidor.
    it('sem navigator.locks o expurgo DESTRÓI em vez de poupar', async () => {
        const scope = ns.remoteScope('servidor-1');
        ns.activateScope(scope);
        const tarefa = vi.fn(async () => 'destruiu');

        vi.stubGlobal('navigator', {});
        try {
            expect(ns.hasMountLockSupport()).toBe(false);
            const { granted, result } = await ns.withExclusiveAtlasLock(scope, tarefa);
            expect(granted).toBe(true);
            expect(result).toBe('destruiu');
        } finally {
            vi.unstubAllGlobals();
        }
        // e o mesmo escopo, com o lock de volta e ainda montado, volta a ser poupado
        expect((await ns.withExclusiveAtlasLock(scope, tarefa)).granted).toBe(false);
        expect(tarefa).toHaveBeenCalledTimes(1);
    });

    // O lock pertence ao CLIENTE, não à instância do módulo: `vi.resetModules()` (como o HMR do
    // Vite) constrói uma segunda instância dentro do mesmo cliente, e um lock esquecido pela
    // instância descartada seria um namespace que nenhum expurgo consegue destruir de novo.
    it('sobrevive à troca de instância do módulo: o cliente é um só', async () => {
        const scope = ns.remoteScope('servidor-1');
        ns.activateScope(scope);

        const outraInstancia = await loadNamespace();

        expect(await exclusivoDisponivel(scope)).toBe(false);
        expect(await outraInstancia.releaseMountLock()).toBe(true);
        expect(await exclusivoDisponivel(scope)).toBe(true);
    });
});

// ============================================================================
// O PONTEIRO DE MONTAGEM POR ABA (Decisão 6)
//
// "Que atlas esta aba monta" é pergunta POR ABA, e todo ponteiro que existia antes era
// global à instalação. Com um namespace por atlas, uma resposta global responde a aba
// errada: a aba A dá F5 e monta o atlas da aba B, porque a última escrita no ponteiro
// compartilhado foi a de B.
//
// O QUE ESTES VERDES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO: as asserções são sobre o
// CONTEÚDO do armazenamento por aba e sobre o escopo RECONSTRUÍDO a partir dele, nunca
// sobre "a função foi chamada". Um `activateScope` que parasse de escrever o ponteiro
// derruba o primeiro bloco; um leitor que devolvesse o objeto guardado como veio (em vez
// de refazê-lo pelos construtores de escopo) derruba o bloco de adulteração.
// ============================================================================

/**
 * Um `sessionStorage` de mentira, com um respaldo por ABA.
 *
 * Guardar só strings é deliberado: o real também guarda, e um duplo que aceitasse objetos
 * esconderia um `JSON.parse` que nunca foi exercitado.
 * @param {Map<string, string>} [backing] - Respaldo da aba.
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

describe('atlas-namespace :: ponteiro de montagem por aba', () => {
    let storage;

    beforeEach(() => {
        storage = fakeTabStorage();
        vi.stubGlobal('sessionStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('a MONTAGEM escreve o ponteiro, e a leitura devolve o mesmo escopo', () => {
        const scope = ns.remoteScope('servidor-1');
        ns.activateScope(scope);

        // Absoluto: a chave existe com este nome, e é a única. Um ponteiro guardado com
        // outro nome seria invisível para o boot e este caso não veria diferença.
        expect([...storage.__backing.keys()]).toEqual([ns.TAB_MOUNT_KEY]);
        expect(ns.readTabMountPointer()).toEqual(scope);
    });

    it('o slot LOCAL legado (sufixo vazio) sobrevive à ida e volta', () => {
        const scope = ns.localScope('slot-1', '');
        ns.activateScope(scope);

        expect(ns.readTabMountPointer()).toEqual({ kind: 'local', atlasId: 'slot-1', dbSuffix: '' });
    });

    it('o slot LOCAL adotado mantém o sufixo `remote-<id>` e a espécie LOCAL', () => {
        // O resgate move a reivindicação e ZERO bytes, então o slot local carrega o sufixo do
        // atlas de servidor de onde veio. Um ponteiro que "consertasse" isso para REMOTE faria
        // o próximo boot tratar o trabalho resgatado como dado de servidor a destruir.
        const scope = ns.localScope('slot-resgatado', 'remote-servidor-1');
        ns.activateScope(scope);

        expect(ns.readTabMountPointer()).toEqual(scope);
    });

    it('trocar de escopo SOBRESCREVE o ponteiro: uma aba monta um atlas de cada vez', () => {
        ns.activateScope(ns.localScope('slot-1', 'aaa'));
        ns.activateScope(ns.remoteScope('servidor-2'));

        expect(storage.__backing.size).toBe(1);
        expect(ns.readTabMountPointer()).toEqual(ns.remoteScope('servidor-2'));
    });

    it('destruir o escopo apaga o ponteiro: nenhum boot reabre o que foi destruído', () => {
        ns.activateScope(ns.remoteScope('servidor-1'));
        // Asserção POSITIVA antes: sem ela, "apagou" e "nunca escreveu" são o mesmo verde.
        expect(ns.readTabMountPointer()).not.toBeNull();

        ns.clearActiveScope();

        expect(storage.__backing.has(ns.TAB_MOUNT_KEY)).toBe(false);
        expect(ns.readTabMountPointer()).toBeNull();
    });

    it('sem sessionStorage a montagem funciona igual, e o ponteiro é AUSENTE', () => {
        // Node (o runtime da suíte) e um contexto de armazenamento bloqueado caem aqui. O modo
        // degradado é o comportamento anterior à Decisão 6, nunca uma montagem que falha.
        vi.unstubAllGlobals();

        const scope = ns.remoteScope('servidor-1');
        expect(() => ns.activateScope(scope)).not.toThrow();
        expect(ns.getActiveScope()).toEqual(scope);
        expect(ns.readTabMountPointer()).toBeNull();
    });

    it('um armazenamento que RECUSA a escrita não derruba a montagem', () => {
        vi.stubGlobal('sessionStorage', {
            getItem: () => { throw new Error('bloqueado'); },
            setItem: () => { throw new Error('cota'); },
            removeItem: () => { throw new Error('bloqueado'); }
        });

        const scope = ns.localScope('slot-1', 'aaa');
        expect(() => ns.activateScope(scope)).not.toThrow();
        expect(ns.getActiveScope()).toEqual(scope);
        expect(ns.readTabMountPointer()).toBeNull();
        expect(() => ns.clearActiveScope()).not.toThrow();
    });
});

describe('atlas-namespace :: o ponteiro guardado NÃO é confiado, é REFEITO', () => {
    let storage;

    /** @param {object} registro - Valor cru a plantar na chave do ponteiro. */
    function plantar(registro) {
        storage.__backing.set(ns.TAB_MOUNT_KEY, JSON.stringify(registro));
    }

    beforeEach(() => {
        storage = fakeTabStorage();
        vi.stubGlobal('sessionStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('o sufixo REMOTO é derivado do id, não lido: adulterá-lo não redireciona a montagem', () => {
        plantar({ version: 1, kind: 'remote', atlasId: 'servidor-1', dbSuffix: 'remote-servidor-9' });

        // Este é o caso que separa "refaz pelo construtor" de "devolve o que estava lá".
        expect(ns.readTabMountPointer()).toEqual({
            kind: 'remote',
            atlasId: 'servidor-1',
            dbSuffix: 'remote-servidor-1'
        });
    });

    it('um sufixo LOCAL inválido é recusado inteiro, não sanitizado', () => {
        plantar({ version: 1, kind: 'local', atlasId: 'slot-1', dbSuffix: 'nao/vale' });
        expect(ns.readTabMountPointer()).toBeNull();

        // E o sufixo reservado do rascunho remoto continua recusado por aqui também.
        plantar({ version: 1, kind: 'local', atlasId: 'slot-1', dbSuffix: 'remote' });
        expect(ns.readTabMountPointer()).toBeNull();
    });

    it('versão desconhecida lê como AUSENTE, e a chave continua no disco', () => {
        plantar({ version: 99, kind: 'local', atlasId: 'slot-1', dbSuffix: 'aaa' });

        expect(ns.readTabMountPointer()).toBeNull();
        // Controle: a ausência veio da RECUSA, não de a chave não existir.
        expect(storage.__backing.has(ns.TAB_MOUNT_KEY)).toBe(true);
        // Controle positivo do MESMO registro com a versão certa, que prova que o único motivo
        // da recusa acima foi a versão.
        plantar({ version: 1, kind: 'local', atlasId: 'slot-1', dbSuffix: 'aaa' });
        expect(ns.readTabMountPointer()).toEqual({ kind: 'local', atlasId: 'slot-1', dbSuffix: 'aaa' });
    });

    it('lixo, vazio e campos faltando leem como AUSENTE', () => {
        storage.__backing.set(ns.TAB_MOUNT_KEY, 'isto nao e json {');
        expect(ns.readTabMountPointer()).toBeNull();

        storage.__backing.set(ns.TAB_MOUNT_KEY, '');
        expect(ns.readTabMountPointer()).toBeNull();

        plantar({ version: 1, kind: 'remote', atlasId: null, dbSuffix: 'remote-x' });
        expect(ns.readTabMountPointer()).toBeNull();

        plantar({ version: 1, kind: 'local', atlasId: '', dbSuffix: 'aaa' });
        expect(ns.readTabMountPointer()).toBeNull();
    });
});

// ============================================================================
// O `.ebgeo` PENDENTE (GlobalKey.PENDING_IMPORT)
//
// A entrega entre DUAS PÁGINAS: "Seus atlas" grava os bytes, o boot do mapa os consome. O banco
// global é o único lugar que as duas alcançam sem montar atlas nenhum, e é também o único que
// NENHUM expurgo deste repositório varre, o que faz do "remove antes de validar" a propriedade
// central aqui: sem ela, um arquivo que falha ao abrir fica preso para sempre e refalha a cada F5.
// ============================================================================

describe('atlas-namespace :: o .ebgeo pendente', () => {
    const GLOBAL_DISK = 'ebgeo_global::keyvaluepairs';
    const bytes = () => new Uint8Array([1, 2, 3, 4]).buffer;

    it('grava no banco GLOBAL, e em nenhum banco por atlas', async () => {
        await ns.savePendingImport({ name: 'Operação Alfa', data: bytes() });

        const global = databases.get(GLOBAL_DISK);
        expect(global.has(ns.GlobalKey.PENDING_IMPORT)).toBe(true);
        // Controle absoluto: nenhum outro banco foi sequer aberto por causa disto.
        expect([...databases.keys()]).toEqual([GLOBAL_DISK]);
        // E a chave é do banco global por DECLARAÇÃO, não por acidente do escopo ativo: não há
        // escopo ativo nenhum neste teste, e a escrita mesmo assim resolveu.
        expect(ns.getActiveScope()).toBeNull();
    });

    it('a leitura devolve o registro e o APAGA, na primeira vez e só na primeira', async () => {
        await ns.savePendingImport({ name: 'Operação Alfa', data: bytes() });

        const primeiro = await ns.takePendingImport();

        expect(primeiro).toMatchObject({ name: 'Operação Alfa' });
        // O registro NÃO nomeia mais um slot: quem cria o atlas é o consumidor, no instante em que
        // vai importar, e é isso que impede um boot que RECUSA de deixar um atlas órfão na lista.
        expect(primeiro.atlasId).toBeUndefined();
        expect(new Uint8Array(primeiro.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(databases.get(GLOBAL_DISK).has(ns.GlobalKey.PENDING_IMPORT)).toBe(false);
        expect(await ns.takePendingImport()).toBeNull();
    });

    it('um registro ILEGÍVEL some do disco em vez de voltar a cada boot', async () => {
        // O caso que motiva "apagar antes de validar": nada mais neste código varre o banco
        // global, então um registro que a validação recusa e o leitor não apaga é lixo eterno.
        // A PRIMEIRA da lista é o shape v1, o do deploy anterior: ele nomeava um slot que a TELA
        // criava antes de navegar. Aceitá-lo hoje faria o consumidor criar um segundo atlas ao lado
        // daquele, então ele é lixo pela mesma porta dos outros dois.
        const podres = [
            { version: 1, atlasId: 'slot-da-tela-antiga', name: 'Alfa', savedAt: Date.now(), data: bytes() },
            { version: 99, name: 'x', data: bytes() },
            'texto solto',
            42
        ];
        for (const podre of podres) {
            await ns.getGlobalStore().setItem(ns.GlobalKey.PENDING_IMPORT, podre);

            expect(await ns.takePendingImport()).toBeNull();
            expect(databases.get(GLOBAL_DISK).has(ns.GlobalKey.PENDING_IMPORT)).toBe(false);
        }
    });

    it('expira por idade, e o limite é o do módulo (não um número copiado aqui)', async () => {
        await ns.savePendingImport({ name: 'Velho', data: bytes() });
        const registro = databases.get(GLOBAL_DISK).get(ns.GlobalKey.PENDING_IMPORT);

        // Um milissegundo DENTRO do prazo ainda é lido: sem este controle positivo, o caso abaixo
        // passaria também contra um leitor que recusa tudo.
        registro.savedAt = Date.now() - ns.PENDING_IMPORT_MAX_AGE_MS + 1000;
        expect(await ns.takePendingImport()).not.toBeNull();

        await ns.savePendingImport({ name: 'Velho', data: bytes() });
        databases.get(GLOBAL_DISK).get(ns.GlobalKey.PENDING_IMPORT).savedAt =
            Date.now() - ns.PENDING_IMPORT_MAX_AGE_MS - 1000;

        expect(await ns.takePendingImport()).toBeNull();
        expect(databases.get(GLOBAL_DISK).has(ns.GlobalKey.PENDING_IMPORT)).toBe(false);
    });

    it('recusa um registro sem nome ou sem bytes, que é bug do chamador', async () => {
        // O nome virou obrigatório e não-vazio quando o slot deixou de ser criado pela tela: ele é
        // o NOME COM QUE O ATLAS VAI NASCER, e `createLocalAtlas` lança em nome em branco.
        await expect(ns.savePendingImport({ name: '', data: bytes() })).rejects.toThrow();
        await expect(ns.savePendingImport({ name: '   ', data: bytes() })).rejects.toThrow();
        await expect(ns.savePendingImport({ name: 'x', data: 'nao e buffer' })).rejects.toThrow();
        expect(databases.get(GLOBAL_DISK)?.has(ns.GlobalKey.PENDING_IMPORT) ?? false).toBe(false);
    });

    it('`clearPendingImport` é o desistir do PRODUTOR, e não consome nada', async () => {
        await ns.savePendingImport({ name: 'Alfa', data: bytes() });

        await ns.clearPendingImport();

        expect(databases.get(GLOBAL_DISK).has(ns.GlobalKey.PENDING_IMPORT)).toBe(false);
        expect(await ns.takePendingImport()).toBeNull();
    });

    it('a chave NÃO ganhou um descritor: continuam 12 bancos', () => {
        // O caminho recusado por escrito no `GlobalKey`: um 13º banco, ou um object store novo
        // dentro do banco global (que seria upgrade de versão do IndexedDB).
        expect(ns.STORE_DESCRIPTORS).toHaveLength(12);
        expect(ns.GlobalKey.PENDING_IMPORT).toBe('pending_import');
    });
});
