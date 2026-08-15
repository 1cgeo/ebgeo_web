// Path: tests/unit/repository-namespace.test.js
//
// A frente do repositório passou a resolver CADA acesso pela fábrica de namespace, em vez
// de guardar dez handles do localforage no carregamento do módulo. O que este arquivo
// prende:
//
//   1. sem escopo ativo, os bancos continuam sendo EXATAMENTE os de hoje (a fase não muda
//      comportamento visível, e um install que nunca chega ao bootstrap tem que continuar
//      abrindo `ebgeo_maps` e companhia);
//   2. com um escopo local sufixado, o MESMO objeto de repositório passa a escrever no
//      banco daquele atlas, e uma troca de escopo re-aponta tudo. Este é o defeito que a
//      migração inteira existe para impedir: um handle capturado no load fica preso ao
//      atlas que estava ativo quando o módulo foi importado, e continua escrevendo lá
//      depois da troca, sem erro nenhum;
//   3. o wipe é DERIVADO dos descritores, então cobre os dez bancos por atlas do escopo
//      ativo e nenhum dos dois globais. As asserções de cobertura são ABSOLUTAS (dez
//      nomes, dois globais nominais): comparar a lista com ela mesma passaria verde com
//      lista vazia.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Fake do localforage, keyed by database name: dois `createInstance` com o mesmo nome
// precisam alcançar o MESMO backing store (é assim que o IndexedDB se comporta), senão o
// teste de troca de escopo passaria por acidente.
// ============================================================================

const { databases, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();

    function keyOf(name, storeName) {
        return storeName ? `${name}::${storeName}` : name;
    }

    function makeStore({ name, storeName = null }) {
        const key = keyOf(name, storeName);
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: key,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (cb) => { for (const [k, v] of backing) cb(v, k); })
        };
    }

    return {
        databases,
        makeStore,
        resetFake: () => databases.clear()
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((options) => makeStore(options)),
        dropInstance: vi.fn(async ({ name }) => { databases.delete(name); })
    }
}));

/** Nomes dos bancos que receberam alguma escrita (o fake só cria sob demanda). */
const touchedDatabases = () => [...databases.keys()].sort();

/** Conteúdo de um banco do fake, ou null se ele nunca foi aberto. */
const contentsOf = (name) => (databases.has(name) ? [...databases.get(name).keys()] : null);

/**
 * Carrega a frente inteira num grafo de módulos NOVO, para que `_activeScope` da fábrica
 * comece nulo em cada teste. Os bancos do fake sobrevivem ao reset de propósito: é o que
 * simula o disco.
 */
async function loadFront() {
    vi.resetModules();
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    const local = await import('../../src/js/store/repositories/local.repository.js');
    const facade = await import('../../src/js/store/repository.js');
    return { namespace, local, facade, repo: new local.LocalRepository() };
}

beforeEach(() => {
    resetFake();
    vi.clearAllMocks();
});

// ============================================================================
// 1. Comportamento preservado: sem bootstrap, os bancos de hoje
// ============================================================================

describe('escopo ausente: os bancos continuam os de hoje', () => {
    it('escreve no ebgeo_maps sem sufixo quando nada ativou um escopo', async () => {
        const { repo } = await loadFront();

        await repo.saveMap('Principal', { name: 'Principal', features: {} });

        expect(contentsOf('ebgeo_maps')).toEqual(['Principal']);
        expect(contentsOf('ebgeo_maps__')).toBeNull();
    });

    it('abre os DEZ bancos por atlas com os nomes legados, e nenhum outro', async () => {
        const { repo } = await loadFront();

        // clearAll toca os dez, que é o jeito de forçar a resolução de todos de uma vez.
        await repo.clearAll();

        expect(touchedDatabases()).toEqual([
            'ebgeo_app_settings',
            'ebgeo_atlas',
            'ebgeo_briefings',
            'ebgeo_cesium3d',
            'ebgeo_comments',
            'ebgeo_groups',
            'ebgeo_images',
            'ebgeo_layers',
            'ebgeo_maps',
            'ebgeo_streetview360'
        ]);
    });

    it('a ponte não sobrepõe um escopo já ativo', async () => {
        const { namespace, repo } = await loadFront();
        namespace.activateScope(namespace.remoteScope('atlas-do-servidor'));

        await repo.saveMap('Principal', { name: 'Principal', features: {} });

        expect(contentsOf('ebgeo_maps__remote-atlas-do-servidor')).toEqual(['Principal']);
        // O banco legado pode ter sido ABERTO por uma migração que ainda não passou pela
        // fábrica; o que não pode é ter recebido a escrita do escopo remoto.
        expect(contentsOf('ebgeo_maps') ?? []).not.toContain('Principal');
    });
});

// ============================================================================
// 2. O defeito que a migração existe para impedir
// ============================================================================

describe('troca de atlas local', () => {
    it('re-aponta o MESMO objeto de repositório para o banco do novo atlas', async () => {
        const { namespace, repo } = await loadFront();
        const { activateScope, localScope } = namespace;

        activateScope(localScope('atlas-a', 'a'));
        await repo.saveMap('Mapa A', { name: 'Mapa A', features: {} });

        // A troca acontece DEPOIS que o repositório já foi usado: é exatamente aqui que um
        // handle capturado no load do módulo continuaria escrevendo no atlas anterior.
        activateScope(localScope('atlas-b', 'b'));
        expect(await repo.getMap('Mapa A')).toBeNull();

        await repo.saveMap('Mapa B', { name: 'Mapa B', features: {} });
        expect(contentsOf('ebgeo_maps__a')).toEqual(['Mapa A']);
        expect(contentsOf('ebgeo_maps__b')).toEqual(['Mapa B']);

        activateScope(localScope('atlas-a', 'a'));
        expect((await repo.getMap('Mapa A'))?.name).toBe('Mapa A');
        expect(await repo.getMap('Mapa B')).toBeNull();
    });

    it('isola também os side stores (camadas, 3D, 360, comentários, notas)', async () => {
        const { namespace, repo } = await loadFront();
        const { activateScope, localScope } = namespace;

        activateScope(localScope('atlas-a', 'a'));
        await repo.saveLayers('Mapa', [{ id: 'l1', nome: 'Camada A' }]);
        await repo.saveCesium3d('Mapa', { markers: [{ id: 'm1' }], cameraPositions: {} });
        await repo.saveStreetview360('Mapa', { markers: [{ id: 's1' }], orientations: {} });
        await repo.saveMapComments('Mapa', { c1: { id: 'c1' } });
        await repo.saveMapNotes('Mapa', { title: 'A', description: '' });

        activateScope(localScope('atlas-b', 'b'));
        expect(await repo.getLayers('Mapa')).toEqual([expect.objectContaining({ id: 'default' })]);
        expect((await repo.getCesium3d('Mapa')).markers).toEqual([]);
        expect((await repo.getStreetview360('Mapa')).markers).toEqual([]);
        expect(await repo.getMapComments('Mapa')).toEqual({});
        expect(await repo.getMapNotes('Mapa')).toEqual({ title: '', description: '' });

        activateScope(localScope('atlas-a', 'a'));
        expect(await repo.getLayers('Mapa')).toEqual([{ id: 'l1', nome: 'Camada A' }]);
        expect((await repo.getMapComments('Mapa')).c1).toBeTruthy();
    });

    it('o registro de atlas de cada slot mora no banco daquele slot', async () => {
        const { namespace, repo } = await loadFront();
        const { activateScope, localScope, ATLAS_RECORD_KEY } = namespace;

        activateScope(localScope('atlas-a', 'a'));
        const atlasA = await repo.ensureAtlas('Atlas A');

        activateScope(localScope('atlas-b', 'b'));
        expect(await repo.getAtlas()).toBeNull();
        const atlasB = await repo.ensureAtlas('Atlas B');

        expect(atlasB.id).not.toBe(atlasA.id);
        expect(contentsOf('ebgeo_atlas__a')).toEqual([ATLAS_RECORD_KEY]);
        expect(contentsOf('ebgeo_atlas__b')).toEqual([ATLAS_RECORD_KEY]);
    });
});

// ============================================================================
// 3. Wipe derivado: alcance completo, e só do escopo ativo
// ============================================================================

describe('wipe derivado dos descritores', () => {
    /** Semeia uma chave em cada um dos dez bancos por atlas do escopo ativo. */
    async function seedEveryAtlasStore(namespace) {
        const stores = namespace.listAtlasStores();
        for (const { id, store } of stores) {
            await store.setItem(`semente_${id}`, { id });
        }
        return stores;
    }

    it('clearAll() esvazia os DEZ bancos por atlas do escopo ativo', async () => {
        const { namespace, repo } = await loadFront();
        namespace.activateScope(namespace.localScope('atlas-a', 'a'));

        const stores = await seedEveryAtlasStore(namespace);
        expect(stores).toHaveLength(10);
        for (const { store } of stores) {
            expect(await store.keys()).toHaveLength(1);
        }

        await repo.clearAll();

        for (const { id, store } of stores) {
            expect(await store.keys(), `store ${id} deveria ter ficado vazio`).toEqual([]);
        }
    });

    it('clearAll() não encosta nos dois bancos GLOBAIS', async () => {
        const { namespace, repo } = await loadFront();
        namespace.activateScope(namespace.localScope('atlas-a', 'a'));

        const globalStore = namespace.getGlobalStore();
        const queueStore = namespace.getStoreFor(namespace.StoreName.OPERATION_QUEUE);
        await globalStore.setItem(namespace.GlobalKey.LOCAL_ATLASES, { atlases: [] });
        await queueStore.setItem('op_1', { id: 'op_1' });

        await repo.clearAll();

        expect(await globalStore.getItem(namespace.GlobalKey.LOCAL_ATLASES)).toEqual({ atlases: [] });
        expect(await queueStore.getItem('op_1')).toEqual({ id: 'op_1' });
        expect(contentsOf('ebgeo_global')).toEqual([namespace.GlobalKey.LOCAL_ATLASES]);
        expect(contentsOf('ebgeo::operation_queue')).toEqual(['op_1']);
    });

    it('clearAll() não encosta no atlas local vizinho', async () => {
        const { namespace, repo } = await loadFront();
        const { activateScope, localScope } = namespace;

        activateScope(localScope('atlas-a', 'a'));
        await repo.saveMap('Mapa A', { name: 'Mapa A', features: {} });

        activateScope(localScope('atlas-b', 'b'));
        await repo.saveMap('Mapa B', { name: 'Mapa B', features: {} });
        await repo.clearAll();

        expect(contentsOf('ebgeo_maps__b')).toEqual([]);
        expect(contentsOf('ebgeo_maps__a')).toEqual(['Mapa A']);
    });

    it('clearAllAtlasStores() da fachada cobre os mesmos dez bancos', async () => {
        const { namespace, facade } = await loadFront();
        namespace.activateScope(namespace.localScope('atlas-a', 'a'));

        const stores = await seedEveryAtlasStore(namespace);
        expect(stores).toHaveLength(10);

        await facade.clearAllAtlasStores();

        for (const { id, store } of stores) {
            expect(await store.keys(), `store ${id} deveria ter ficado vazio`).toEqual([]);
        }
    });

    it('clearAllAtlasStores() funciona sem escopo ativo, nos bancos legados', async () => {
        const { facade, repo } = await loadFront();

        await repo.saveMap('Principal', { name: 'Principal', features: {} });
        await facade.clearAllAtlasStores();

        expect(contentsOf('ebgeo_maps')).toEqual([]);
    });
});

// ============================================================================
// 4. Um handle por banco
// ============================================================================

describe('getScopedStore', () => {
    it('devolve a MESMA instância para o mesmo banco (dois handles é o bug)', async () => {
        const { namespace, local } = await loadFront();
        namespace.activateScope(namespace.localScope('atlas-a', 'a'));

        const primeira = local.getScopedStore(namespace.StoreName.MAPS);
        const segunda = local.getScopedStore(namespace.StoreName.MAPS);

        expect(segunda).toBe(primeira);
        expect(primeira.__dbName).toBe('ebgeo_maps__a');
    });
});

// ============================================================================
// 5. Guarda estrutural: quem ainda cria instância por conta própria
// ============================================================================

describe('createInstance só na fábrica', () => {
    const STORE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/js/store');

    /**
     * Arquivos que AINDA não passaram pela fábrica, com o dono da conversão. A lista é
     * permissiva de propósito (um arquivo que já converteu não quebra este teste), então
     * ela encolhe sozinha; o que ela NÃO permite é um arquivo novo aparecer aqui.
     */
    const PENDENTES = [
        'migration/migration.service.js',
        'migration/v1-to-v2.migration.js',
        'migration/v2-to-v2.1.migration.js',
        'migration/v2.1-to-v2.2.migration.js'
    ];

    function listJsFiles(dir, prefix = '') {
        const out = [];
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                out.push(...listJsFiles(full, `${prefix}${entry}/`));
            } else if (entry.endsWith('.js')) {
                out.push({ rel: `${prefix}${entry}`, full });
            }
        }
        return out;
    }

    it('nenhum arquivo do store cria instância fora da fábrica (salvo os pendentes)', () => {
        const files = listJsFiles(STORE_DIR);
        expect(files.length).toBeGreaterThan(20);

        // `createInstance` em comentário não conta como chamada, e a fábrica cita o nome na
        // própria documentação: só a invocação interessa.
        const callers = files
            .filter(({ full }) => /localforage\.createInstance\s*\(/.test(readFileSync(full, 'utf8')))
            .map(({ rel }) => rel);

        // Guarda de cobertura vazia: uma varredura que não acha nada passaria verde.
        expect(callers).toContain('atlas-namespace.js');

        const forbidden = callers.filter(rel => rel !== 'atlas-namespace.js' && !PENDENTES.includes(rel));
        expect(forbidden).toEqual([]);
    });

    it('os dois arquivos do repositório já não criam instância nenhuma', () => {
        const alvos = ['repository.js', 'repositories/local.repository.js'];
        for (const rel of alvos) {
            const source = readFileSync(join(STORE_DIR, rel), 'utf8');
            expect(source, `${rel} ainda importa localforage`).not.toMatch(/^import localforage/m);
            expect(source, `${rel} ainda cria instância`).not.toMatch(/localforage\.createInstance\s*\(/);
        }
    });
});
