// Path: tests/store/espelho-do-registro-em-localstorage.test.js
//
// O REGISTRO DE ATLAS LOCAIS TEM UM ESPELHO EM `localStorage`, E ELE EXISTE PARA UM CASO MEDIDO.
//
// `localStorage` e o IndexedDB são armazenamentos SEPARADOS da mesma origem: o `ebgeo_global`
// pode ser perdido, esvaziado ou corromper-se sem levar o espelho junto. Medido em 2026-09-07
// (I1): com dois slots, perder só o `ebgeo_global` fazia o boot readotar o slot #1 com um id novo
// e deixava 251 registros do segundo atlas (14 mapas, 807 feições, 149 imagens) no disco, com um
// cartão de um na tela e ZERO linhas no console. O sufixo daquele segundo slot só era conhecível
// pela entrada do registro, então, perdida ela, os dez bancos dele não são alcançáveis por
// expurgo nenhum nem por tela nenhuma.
//
// O espelho não reconstrói por adivinhação, que é a classe de defeito OPOSTA: ele carrega id,
// nome e sufixo, escritos ao lado da própria entrada do registro, pelos dois únicos escritores
// dela. E ele só é consultado com o registro VAZIO, porque um espelho reconciliado contra um
// registro vivo seria uma segunda fonte de verdade para uma pergunta que o registro já responde,
// e a primeira entrada velha ressuscitaria um atlas excluído.
//
// A entrada de sufixo VAZIO não se restaura, e a razão está no código: o endereço dela é o que
// todo boot já sabe reivindicar, o nome de verdade dela está no registro de atlas em disco, e
// restaurá-la poderia reimportar uma reivindicação sobre bancos que uma exclusão já derrubou.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localSlotsOnDisk } from '../helpers/atlas-registry-disk.js';

// ============================================================================
// Fake do localforage por nome de banco, no formato dos vizinhos.
// ============================================================================

const { databases, instances, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();
    const instances = new Map();

    const clone = (v) => (v === undefined ? v : structuredClone(v));

    function makeStore({ name, storeName = null }) {
        const key = storeName ? `${name}::${storeName}` : name;
        if (instances.has(key)) return instances.get(key);

        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);

        const instance = {
            __dbName: key,
            __backing: backing,
            setItem: vi.fn(async (k, v) => { backing.set(k, clone(v)); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? clone(backing.get(k)) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (cb) => { for (const [k, v] of backing) cb(clone(v), k); })
        };
        instances.set(key, instance);
        return instance;
    }

    return {
        databases,
        instances,
        makeStore,
        resetFake: () => { databases.clear(); instances.clear(); }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((options) => makeStore(options)),
        dropInstance: vi.fn(async ({ name }) => {
            for (const chave of [...databases.keys()]) {
                if (chave === name || chave.startsWith(`${name}::`)) {
                    databases.delete(chave);
                    instances.delete(chave);
                }
            }
        })
    }
}));

// O aviso de teardown abriria um BroadcastChannel e esperaria por abas que não existem aqui.
vi.mock('@utils/tab-lock.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        announceTabLockTeardown: vi.fn(async (addresses, options) => ({
            addresses, peers: 0, acked: 0, frozen: 0, timedOut: false, degraded: false, options
        }))
    };
});

const { uuidCounter } = vi.hoisted(() => ({ uuidCounter: { value: 0 } }));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `00000000-0000-4000-8000-${String(uuidCounter.value).padStart(12, '0')}`;
    }),
    isValidUUID: vi.fn((v) => typeof v === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true)
}));

// ============================================================================
// Insumo e ajudantes
// ============================================================================

/** A chave do espelho. Repetida aqui de propósito: o teste não a importa do código sob teste. */
const CHAVE_DO_ESPELHO = 'ebgeo_local_atlas_mirror';

const ORIGEM_LOCAL = { kind: 'local', atlasId: null };
const MAPAS = 14;

/** Escreve direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/**
 * Um `localStorage` de mentira, em memória, com as três operações que o código usa.
 * @returns {{loja: Map<string,string>, storage: Object}}
 */
function criarLocalStorage() {
    const loja = new Map();
    return {
        loja,
        storage: {
            getItem: (chave) => (loja.has(chave) ? loja.get(chave) : null),
            setItem: (chave, valor) => { loja.set(chave, String(valor)); },
            removeItem: (chave) => { loja.delete(chave); }
        }
    };
}

/** @returns {Promise<void>} Bancos sem sufixo com 14 mapas, como a instalação que atravessou. */
async function semearBancosSemSufixo() {
    await raw('ebgeo_atlas').setItem('current_atlas', {
        id: 'atlas-do-chefe', name: 'Atlas do Chefe', schemaVersion: '3.0',
        mapOrder: Array.from({ length: MAPAS }, (_, i) => `Mapa ${i + 1}`)
    });
    for (let i = 1; i <= MAPAS; i++) {
        await raw('ebgeo_maps').setItem(`Mapa ${i}`, { id: `mapa-${i}`, name: `Mapa ${i}` });
    }
    await raw('ebgeo_app_settings').setItem('schemaVersion', '3.0');
}

/** @param {Array<Object>} entradas - O espelho, como o disco o teria. */
function semearEspelho(entradas, storage) {
    storage.setItem(CHAVE_DO_ESPELHO, JSON.stringify(entradas));
}

/** @returns {Array<Object>} O espelho lido cru. */
function lerEspelhoCru(storage) {
    const bruto = storage.getItem(CHAVE_DO_ESPELHO);
    return bruto ? JSON.parse(bruto) : [];
}

/** Um grafo de módulos NOVO: registro e fábrica de namespace têm estado de módulo. */
async function carregarPagina() {
    vi.resetModules();
    const [localAtlas, ns] = await Promise.all([
        import('@store/local-atlas.api.js'),
        import('@store/atlas-namespace.js')
    ]);
    return { localAtlas, ns };
}

/** @returns {Promise<Array<object>>} Os slots gravados no banco global. */
async function slotsNoDisco() {
    const store = raw('ebgeo_global');
    const saida = new Map();
    for (const chave of await store.keys()) saida.set(chave, await store.getItem(chave));
    return localSlotsOnDisk(saida);
}

let dublado;

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
    vi.restoreAllMocks();
    dublado = criarLocalStorage();
    vi.stubGlobal('localStorage', dublado.storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ============================================================================
// A restauração no boot
// ============================================================================

describe('B4-8: registro vazio e espelho com slots, no boot', () => {
    it('restaura os dois slots do espelho e o bootstrap NÃO cria um terceiro', async () => {
        await semearBancosSemSufixo();
        semearEspelho([
            { id: 'slot-a', name: 'Alfa', dbSuffix: 'slot-a', createdAt: 10, updatedAt: 11 },
            { id: 'slot-b', name: 'Bravo', dbSuffix: 'slot-b', createdAt: 20, updatedAt: 21 }
        ], dublado.storage);
        const avisos = [];
        vi.spyOn(console, 'warn').mockImplementation((...args) => {
            if (typeof args[0] === 'string') avisos.push(args[0]);
        });

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        const linha = avisos.find(texto => texto.includes('espelho'));
        expect((await slotsNoDisco()).map(e => `${e.id}:${e.name}:${e.dbSuffix}`))
            .toEqual(['slot-a:Alfa:slot-a', 'slot-b:Bravo:slot-b']);
        expect(pagina.localAtlas.listLocalAtlases()).toHaveLength(2);
        expect(linha).toBeDefined();
        expect(linha).toContain('2');
        expect(linha).toContain('"Alfa"');
        expect(linha).toContain('"Bravo"');
    });

    it('CONTROLE: espelho vazio e registro vazio continuam no bootstrap normal', async () => {
        // Sem este caso, um espelho que nunca restaura passaria, e o caminho de toda instalação
        // nova (e da que atravessa) morreria em silêncio.
        await semearBancosSemSufixo();

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        const slots = await slotsNoDisco();
        expect(slots).toHaveLength(1);
        expect(slots[0].dbSuffix).toBe('');
    });

    it('com o slot sem sufixo TAMBÉM no espelho, ele volta pelo bootstrap e nada fica órfão', async () => {
        // O caso I1 inteiro: dois slots, o #1 nos bancos sem sufixo e o #2 com sufixo próprio. O
        // com sufixo se restaura (o endereço dele não é conhecível por mais nada); o sem sufixo
        // segue a regra normal do bootstrap, que sabe reivindicá-lo e sabe o nome dele pelo
        // registro de atlas em disco. O que não pode acontecer é o segundo ficar de fora.
        await semearBancosSemSufixo();
        semearEspelho([
            { id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 2 },
            { id: 'slot-b', name: 'Bravo', dbSuffix: 'slot-b', createdAt: 20, updatedAt: 21 }
        ], dublado.storage);

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        const slots = await slotsNoDisco();
        expect(slots.map(e => e.dbSuffix).sort()).toEqual(['', 'slot-b']);
        expect((await raw('ebgeo_maps').keys()).length).toBe(MAPAS);
    });

    it('com o registro CHEIO o espelho não é consultado, e um atlas excluído não ressuscita', async () => {
        // A restauração é só para registro VAZIO. Aqui o espelho ainda carrega o "Bravo" que o
        // usuário excluiu num boot anterior, e o registro tem o slot que sobrou: reconciliar os
        // dois traria o excluído de volta, que é a classe de defeito oposta e igualmente cara.
        await semearBancosSemSufixo();
        await raw('ebgeo_global').setItem('local_atlas:slot-1', {
            version: 1, id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 2
        });
        await raw('ebgeo_global').setItem('current_local_atlas', 'slot-1');
        semearEspelho([
            { id: 'slot-1', name: 'Atlas do Chefe', dbSuffix: '', createdAt: 1, updatedAt: 2 },
            { id: 'slot-b', name: 'Bravo', dbSuffix: 'slot-b', createdAt: 20, updatedAt: 21 }
        ], dublado.storage);

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        expect((await slotsNoDisco()).map(e => e.id)).toEqual(['slot-1']);
    });
});

// ============================================================================
// Quem escreve o espelho
// ============================================================================

describe('B4-8: o espelho é escrito pelos dois escritores do registro', () => {
    it('o slot que o bootstrap cria aparece no espelho, com id, nome e sufixo', async () => {
        await semearBancosSemSufixo();

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        const espelho = lerEspelhoCru(dublado.storage);
        const noDisco = await slotsNoDisco();
        expect(espelho).toHaveLength(1);
        expect(espelho[0]).toEqual({
            id: noDisco[0].id,
            name: noDisco[0].name,
            dbSuffix: '',
            createdAt: expect.any(Number),
            updatedAt: expect.any(Number)
        });
    });

    it('o atlas criado entra no espelho e o excluído SAI dele', async () => {
        await semearBancosSemSufixo();

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });
        const criado = await pagina.localAtlas.createLocalAtlas('Bravo');
        const depoisDeCriar = lerEspelhoCru(dublado.storage).map(e => e.name);

        await pagina.localAtlas.deleteLocalAtlas(criado.atlas.id);

        expect({
            depoisDeCriar,
            depoisDeExcluir: lerEspelhoCru(dublado.storage).map(e => e.name),
            noDisco: (await slotsNoDisco()).length
        }).toEqual({
            depoisDeCriar: ['Meu Atlas', 'Bravo'],
            depoisDeExcluir: ['Meu Atlas'],
            noDisco: 1
        });
    });

    it('um localStorage que LANÇA em toda operação não custa o boot', async () => {
        // Ler `localStorage` LANÇA (não devolve null) num navegador configurado para bloquear
        // dado de sítio, e escrever lança por cota. O espelho é conveniência: ele não pode custar
        // uma sessão. O insumo degenerado é este, e sem ele o `try/catch` não estaria provado.
        await semearBancosSemSufixo();
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('acesso a localStorage negado'); },
            setItem: () => { throw new Error('acesso a localStorage negado'); },
            removeItem: () => { throw new Error('acesso a localStorage negado'); }
        });

        const pagina = await carregarPagina();
        await pagina.localAtlas.initLocalAtlases({ origin: ORIGEM_LOCAL, isAuthenticated: false });

        expect((await slotsNoDisco())).toHaveLength(1);
        expect((await raw('ebgeo_maps').keys()).length).toBe(MAPAS);
    });
});
