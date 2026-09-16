// Path: tests/store/boot-de-instalacao-nova.test.js
//
// QUEM NUNCA ABRIU O EBGEO ENTRA EM SILÊNCIO, e é isso que este arquivo mede.
//
// A pergunta veio do chefe em 2026-09-16, depois de ver no console a linha "Boot do atlas:
// ESCOPO PRESERVADO. Carimbo de esquema ausente...". Aquela linha é a guarda de 2026-09-07
// funcionando sobre um escopo QUE TEM DADO: carimbo ausente e conteúdo presente são
// indistinguíveis de "carimbo perdido", e o boot se recusa a apagar. A pergunta seguinte é a
// que falta responder: o usuário NOVO, cujo navegador não tem nada, cai na mesma linha?
//
// Não pode cair, e a diferença é só uma: sem dado, `medirEscopo` devolve zero chaves e o
// caminho é o de instalação, não o de preservação. O que este arquivo prende é o conjunto do
// que isso significa, porque a cobertura de hoje só afirmava o carimbo
// (`boot-nao-apaga-sob-erro-de-leitura.test.js`, o CONTROLE do escopo vazio):
//
//   1. NENHUM erro no console. Um `console.error` num boot são é ruído que ensina o usuário (e
//      o suporte) a ignorar o console, e é justamente ele que a pergunta do chefe levantou.
//   2. O carimbo sai na versão CORRENTE, e não no literal legado `1.7`.
//   3. A cadeia legada NÃO roda: não há de onde migrar, e rodá-la fabricaria a "entrada 1.7"
//      que a decisão de 2026-09-07 nomeia como a mais cara da outra linha.
//   4. O boot devolve um mapa utilizável, e não `undefined`.
//   5. O que nasce é o MÍNIMO e está nomeado: o carimbo e um mapa chamado `Principal`, que é o
//      mesmo que o boot devolve como ativo. Imagem, camada, grupo e registro de atlas ficam em
//      zero.
//
// A DISCRIMINAÇÃO É O ÚLTIMO CASO: o mesmo boot, com UMA chave de dado e sem carimbo, tem de
// tomar o outro caminho e gritar. Sem ele, um boot que nunca falasse passaria neste arquivo
// inteiro.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Fake do localforage por nome de banco, no mesmo formato de
// `boot-nao-apaga-sob-erro-de-leitura.test.js`.
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

    return { databases, instances, makeStore, resetFake: () => { databases.clear(); instances.clear(); } };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((options) => makeStore(options)),
        dropInstance: vi.fn(async ({ name }) => { databases.delete(name); instances.delete(name); })
    }
}));

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

/** Escreve e lê direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

/** Carrega a cadeia num grafo de módulos NOVO. Importações SEQUENCIAIS, pela razão do vizinho. */
async function loadModules() {
    vi.resetModules();
    const repository = await import('../../src/js/store/repository.js');
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    return { repository, namespace };
}

/** O que existe nos cinco bancos que o boot alcança, contado pelas CHAVES relidas do fake. */
async function noDisco() {
    return {
        maps: (await raw('ebgeo_maps').keys()).length,
        images: (await raw('ebgeo_images').keys()).length,
        layers: (await raw('ebgeo_layers').keys()).length,
        groups: (await raw('ebgeo_groups').keys()).length
    };
}

let erros;
let avisos;

beforeEach(() => {
    resetFake();
    uuidCounter.value = 0;
    vi.restoreAllMocks();
    // O console é MEDIDO, não silenciado: é ele o objeto do primeiro caso.
    erros = [];
    avisos = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => erros.push(a.join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...a) => avisos.push(a.join(' ')));
});

describe('o boot de quem nunca abriu o EBGeo', () => {
    it('não escreve NENHUM erro no console', async () => {
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(erros, `o boot de instalação nova falou: ${JSON.stringify(erros)}`).toEqual([]);
    });

    it('não menciona escopo preservado nem carimbo ausente em nenhum canal', async () => {
        // A frase exata que o chefe viu, procurada também entre os AVISOS: mudar o nível de
        // `error` para `warn` calaria o caso acima sem calar o usuário.
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        const tudo = [...erros, ...avisos].join('\n');
        expect(tudo).not.toMatch(/ESCOPO PRESERVADO/);
        expect(tudo).not.toMatch(/Carimbo de esquema/);
    });

    it('carimba a versão CORRENTE, e não o literal legado 1.7', async () => {
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        const carimbo = await raw('ebgeo_app_settings').getItem('schemaVersion');
        expect(carimbo).toBe('3.0');
        expect(carimbo).not.toBe('1.7');
    });

    it('devolve um mapa utilizável, e não undefined', async () => {
        // O retorno do boot é o mapa ativo, e é com ele que o editor abre. Um `undefined` aqui é
        // a tela vazia que não explica por quê.
        const mods = await loadModules();

        const mapa = await mods.repository.initializeRepository();

        expect(typeof mapa).toBe('string');
        expect(mapa.length).toBeGreaterThan(0);
    });

    it('nasce UM mapa, e é ele que o boot devolve', async () => {
        // O QUE A INSTALAÇÃO NOVA PRODUZ, medido em vez de suposto: o boot não deixa o
        // repositório vazio, ele semeia um mapa inicial para o editor ter onde abrir. Imagem,
        // camada e grupo continuam em zero, que é o que separa "semeou o mínimo" de "inventou
        // acervo".
        const mods = await loadModules();

        const ativo = await mods.repository.initializeRepository();

        expect(await noDisco()).toEqual({ maps: 1, images: 0, layers: 0, groups: 0 });
        const chaves = await raw('ebgeo_maps').keys();
        expect(chaves).toHaveLength(1);
        // O mapa semeado é o MESMO que o boot devolve como ativo: um boot que semeasse um e
        // apontasse outro abriria numa tela que não existe.
        const documento = await raw('ebgeo_maps').getItem(chaves[0]);
        expect([chaves[0], documento?.name, documento?.id]).toContain(ativo);
    });

    it('o escopo novo NÃO ganha registro de atlas, e isso é o desenho', async () => {
        // MEDIDO, e contra a suposição: um boot de instalação nova deixa DUAS coisas no disco, o
        // carimbo e o mapa `Principal`, e mais nada. O registro de atlas (`current_atlas`), que é
        // a verdade de versão do 3.0, nasce depois e por outro gesto: abrir um atlas do servidor
        // ou criar um slot local. Fixar isto aqui é o que faz um boot que passasse a semear um
        // registro fantasma aparecer como mudança, e não como detalhe.
        const mods = await loadModules();

        await mods.repository.initializeRepository();

        expect(await raw('ebgeo_atlas').keys()).toEqual([]);
        expect(await raw('ebgeo_app_settings').keys()).toEqual(['schemaVersion']);
    });

    it('DISCRIMINAÇÃO: com UMA chave de dado e sem carimbo, o mesmo boot fala e preserva', async () => {
        // O caso que separa "o boot está são" de "o boot emudeceu". Uma única chave basta: a
        // guarda é por CONTEÚDO, não por volume.
        await raw('ebgeo_maps').setItem('Mapa 1', { id: 'm-1', name: 'Mapa 1', features: {} });

        const mods = await loadModules();
        await mods.repository.initializeRepository();

        expect(erros.join('\n')).toMatch(/ESCOPO PRESERVADO/);
        expect((await noDisco()).maps).toBe(1);
    });
});
