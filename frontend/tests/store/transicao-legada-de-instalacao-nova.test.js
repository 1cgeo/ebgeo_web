// Path: tests/store/transicao-legada-de-instalacao-nova.test.js
//
// UM NAVEGADOR SEM NADA NÃO TEM O QUE MIGRAR, e o portão da atualização tem de deixá-lo passar.
//
// O CASO REAL, de 2026-09-16: uma pessoa que nunca tinha aberto o EBGeo entrou pela primeira vez,
// recebeu a tela de "problema na atualização" e baixou um pacote de recuperação. O pacote veio
// com `records: []` e `inventory: []` — vazio, porque não havia nada. Ou seja, a aplicação
// interrompeu o boot de um usuário novo para lhe oferecer o resgate de um acervo inexistente.
//
// A CAUSA, e são duas condições que só se encontram fora desta máquina:
//
//   1. `classifySource` (`legacy-transition.js:59`) só reconhece o escopo vazio quando JÁ existe
//      atlas no registro: `if (inventory.length === 0 && entries.length)`. Num navegador novo o
//      registro está vazio, a guarda não vale, e a função segue até o fim e devolve
//      `kind: 'local'` com inventário ZERO. A partir daí o portão trata a instalação nova como
//      uma cópia a transicionar.
//
//   2. `prepareLegacyTransition` então exige Web Locks, e `navigator.locks` só existe em CONTEXTO
//      SEGURO. Pelo `localhost` do desenvolvimento ele existe, e por isso o defeito nunca apareceu
//      aqui; por `http://<ip>:<porta>` da rede interna ele NÃO existe, e a chamada lança
//      `lock_unavailable`, que é exatamente a tela que a pessoa viu.
//
// As duas juntas fazem o caminho. O CONSERTO é no ponto do lock e não na classificação, e a
// diferença importa: a instalação nova PRECISA continuar nascendo num escopo isolado
// (`upgrade-<uuid>`), porque os bancos sem sufixo são os da `main` (decisão de 2026-09-13), e
// tratá-la como "escopo vazio, nada a fazer" a mandaria escrever justamente lá. O que o lock
// protege é a CÓPIA concorrente; com inventário vazio não há cópia, e o portão segue sem ele.
//
// O CONTROLE do fim é o que separa "deixa passar" de "deixou de proteger": um escopo COM dado,
// no mesmo navegador sem locks, continua parando.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

/** Escreve direto no fake, sem passar pelo código sob teste. */
function raw(dbName) {
    return makeStore({ name: dbName });
}

beforeEach(() => {
    resetFake();
    vi.resetModules();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * O navegador da OUTRA MÁQUINA: a página veio por `http://<ip>:<porta>`, que não é contexto
 * seguro, então a API de Web Locks não existe. É a diferença entre a estação de quem desenvolve
 * (localhost, contexto seguro) e a de quem usa pela rede.
 * @returns {void}
 */
function semWebLocks() {
    // `vi.stubGlobal`, e não `delete navigator.locks`: o `navigator` do ambiente de teste não
    // aceita a remoção da propriedade, e o delete passa calado — a primeira versão desta régua
    // rodou a transição inteira achando que a tinha desligado.
    vi.stubGlobal('navigator', { ...globalThis.navigator, locks: undefined });
}

/** O navegador de quem abre por localhost ou por HTTPS: a API existe. */
function comWebLocks() {
    vi.stubGlobal('navigator', {
        ...globalThis.navigator,
        locks: { request: async (_nome, corpo) => corpo() }
    });
}

describe('o portão da atualização num navegador NOVO', () => {
    it('não pede Web Locks quando não há nada para migrar', async () => {
        // O caso do relato, reproduzido: nada em disco, registro vazio, navegador sem locks.
        semWebLocks();
        const { prepareLegacyTransition } = await import('../../src/js/store/migration/legacy-transition.js');

        const resultado = await prepareLegacyTransition();

        // O que importa é NÃO ter lançado. O veredito pode ser `empty` ou `remote`, conforme a
        // classificação, e nenhum dos dois interrompe o boot.
        expect(resultado?.kind).not.toBe('local');
    });

    it('e a instalação nova nasce ISOLADA, como nasceria com os locks', async () => {
        // O QUE TEM DE ACONTECER, e não "nada deve acontecer": pela decisão de 2026-09-13 os
        // bancos SEM SUFIXO são os da `main`, e uma instalação nova nasce num escopo próprio
        // (`upgrade-<uuid>`) com uma entrada no registro. Medir ausência de transição aqui seria
        // pedir que o usuário novo passasse a escrever nos bancos da outra linha do produto.
        // `tests/integration/legacy-transition.test.js` prende esse desenho pelo outro lado.
        semWebLocks();
        const { prepareLegacyTransition } = await import('../../src/js/store/migration/legacy-transition.js');
        const ns = await import('../../src/js/store/atlas-namespace.js');

        const resultado = await prepareLegacyTransition();

        expect(resultado.kind).toBe('ready');
        expect(resultado.state.destination).not.toBe('');
        expect(await ns.readLocalAtlasRegistry()).toHaveLength(1);
        // E os bancos da `main` continuam intocados.
        expect(await raw('ebgeo_maps').keys()).toEqual([]);
    });

    it('com Web Locks disponíveis o desfecho é o MESMO', async () => {
        // O controle que separa "consertou" de "escondeu atrás da ausência da API": o navegador
        // com locks (localhost, HTTPS) tem de chegar ao mesmo lugar, e é por isso que o defeito
        // nunca apareceu na estação de quem desenvolve.
        comWebLocks();
        const { prepareLegacyTransition } = await import('../../src/js/store/migration/legacy-transition.js');

        const resultado = await prepareLegacyTransition();

        expect(resultado?.kind).not.toBe('local');
    });

    it('CONTROLE: com dado em disco e sem Web Locks, o portão continua parando', async () => {
        // O outro lado. Se a proteção fosse removida em vez de corrigida, este caso ficaria
        // verde junto com os de cima, e um acervo de verdade seria transicionado sem a
        // coordenação entre abas que o lock existe para dar.
        await raw('ebgeo_maps').setItem('Mapa 1', { id: 'm-1', name: 'Mapa 1', features: {} });
        await raw('ebgeo_app_settings').setItem('schemaVersion', '2.4');
        semWebLocks();
        const { prepareLegacyTransition } = await import('../../src/js/store/migration/legacy-transition.js');

        await expect(prepareLegacyTransition()).rejects.toMatchObject({ code: 'lock_unavailable' });
    });
});
