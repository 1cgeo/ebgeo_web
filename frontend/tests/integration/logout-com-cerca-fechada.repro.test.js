// Path: tests/integration/logout-com-cerca-fechada.repro.test.js

/**
 * @fileoverview REPRO: sair da conta deixava as feicoes do servidor DESENHADAS na tela.
 *
 * O SINTOMA, medido em navegador por `frontend/tests/e2e-ui/browser-logout-clears-map.repro.spec.js`:
 * depois do logout a store zerava e as sources vivas do MapLibre continuavam com a feicao do atlas
 * de servidor, para sempre (a assercao e um `poll`, entao nao e corrida que assenta).
 *
 * A CADEIA. O gesto de sair confirma primeiro (`session/confirm-logout.js`), e a confirmacao chama
 * `requestRemoteAtlasDiscard` (`store/remote-atlas.api.js`), que FECHA A CERCA de escrita de todo
 * namespace remoto nao reivindicado localmente — o que esta aba tem MONTADO inclusive
 * (`discardRemoteWrites`, `store/remote-write-fence.js`). So depois disso o logout chama
 * `clearAllDataStore({ reinitialize: false })`, cujas escritas seguintes vao todas para o escopo
 * ativo por `getScopedStore`, que embrulha o store em `fenceStore` quando o escopo e remoto. Cada
 * uma delas passa a lancar `AbortError`, e a primeira aborta a funcao inteira ANTES da ultima
 * linha dela, que e o `emit(ALL_DATA_CLEARED)`.
 *
 * E E O EVENTO QUE O USUARIO VE. Quem apaga o traco na tela e o ouvinte de `ALL_DATA_CLEARED` no
 * `BaseLayerControl`, que com `rebuild: false` chama `clearFeatureSources` (`layers/layer_setup.js`).
 * Sem o evento, ninguem esvazia as sources. O disco ja tinha sido esvaziado antes do ponto de
 * aborto, por `clearAllAtlasStores`, que usa os handles CRUS e nao passa pela cerca: por isso a
 * metade de store do spec passava e so a metade de TELA reprovava, que e a combinacao mais dificil
 * de acreditar.
 *
 * O CONSERTO E DE CONTRATO, NAO DE ORDEM. Um namespace com a cerca fechada esta CONDENADO: o
 * proprio logout o destroi logo em seguida (`discardRemoteAtlasNamespaces`). Reconstruir dentro
 * dele o mapa em branco e o carimbo de schema e trabalho que morre duas linhas depois, e ser
 * recusado nesse trabalho nao e falha. A recusa virou, entao, o que a constituicao chama de falha
 * ESPERADA: as escritas de reconstrucao sao puladas e o anuncio acontece do mesmo jeito.
 *
 * CONTROLE NEGATIVO EMBUTIDO: o mesmo wipe com a cerca ABERTA tem de continuar reconstruindo o
 * mapa em branco e anunciando. Sem esse caso, "passou a anunciar sempre" seria indistinguivel de
 * "parou de reconstruir nunca".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco de mentira, keyed por (banco, object store) — molde de
// tests/unit/wipe-unificado-de-atlas.test.js, que e onde o wipe ja e exercitado.
// ============================================================================

const { databases, storeOf, seed, readKey, resetDisk } = vi.hoisted(() => {
    const databases = new Map();

    const keyOf = (name, storeName) => `${name}::${storeName || 'keyvaluepairs'}`;

    function backingOf(name, storeName = null) {
        const key = keyOf(name, storeName);
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

    return {
        databases,
        storeOf,
        seed: (name, key, value, storeName = null) => backingOf(name, storeName).set(key, value),
        readKey: (name, key, storeName = null) => backingOf(name, storeName).get(key) ?? null,
        resetDisk: () => databases.clear()
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async () => {})
    }
}));

// A CERCA SO EXISTE DENTRO DE UM DOCUMENTO, e e por isso que estas duas linhas sao parte do
// sujeito e nao higiene: `insideDocument()` (`store/remote-write-fence.js`) pergunta por
// `globalThis.window`, e `read` sem `localStorage` degrada ABERTO fora dele. Um teste desta
// cadeia sem as duas mediria a ausencia da cerca e passaria verde com o defeito no lugar.
if (typeof globalThis.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
}
if (typeof globalThis.localStorage === 'undefined') {
    const backing = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (k) => (backing.has(k) ? backing.get(k) : null),
            setItem: (k, v) => { backing.set(k, String(v)); },
            removeItem: (k) => { backing.delete(k); },
            clear: () => backing.clear()
        }
    });
}

const ATLAS = '33333333-3333-4333-8333-333333333333';
const SUFIXO = `remote-${ATLAS}`;

/**
 * Monta o atlas remoto, semeia uma feicao nele e devolve a fachada da store viva.
 * @returns {Promise<{store: Object, eventBus: Object, scope: Object}>}
 */
async function montarAtlasRemoto() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    const services = initServices();
    const { activateScope, remoteScope } = await import('@store/atlas-namespace.js');
    const scope = remoteScope(ATLAS);
    activateScope(scope);
    // O registro do atlas remoto, para que o expurgo e o descarte o enxerguem.
    seed('ebgeo_global', `remote_atlas:${ATLAS}`, {
        atlasId: ATLAS, dbSuffix: SUFIXO, createdAt: 1, updatedAt: 1
    });
    seed(`ebgeo_maps__${SUFIXO}`, 'Mapa do Servidor', {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Mapa do Servidor',
        features: { points: [{ type: 'Feature', properties: { id: 'p1', source: 'point' } }] }
    });
    const store = await import('@store/store.js');
    return { store, eventBus: services.eventBus, scope };
}

/**
 * @param {Object} eventBus - O barramento espiao.
 * @returns {string[]} Os tipos de evento emitidos, na ordem.
 */
const tiposEmitidos = (eventBus) => eventBus.emit.mock.calls.map((c) => c[0]);

beforeEach(() => {
    resetDisk();
    globalThis.localStorage.clear();
    vi.clearAllMocks();
});

describe('sair da conta com a cerca de escrita ja fechada', () => {

    it('REPRO: o wipe ANUNCIA que os dados sairam, mesmo sem poder reconstruir o namespace', async () => {
        const { store, eventBus, scope } = await montarAtlasRemoto();
        const { discardRemoteWrites } = await import('@store/remote-write-fence.js');
        const { EventTypes } = await import('@events/event_types.js');
        vi.spyOn(eventBus, 'emit');

        // O ATO QUE A CONFIRMACAO DE SAIDA JA FEZ antes de o wipe comecar.
        discardRemoteWrites(scope);

        await expect(
            store.clearAllDataStore({ reinitialize: false }),
            'o wipe do logout nao pode terminar em AbortError: e ele que anuncia o fim do dado',
        ).resolves.not.toThrow();

        // A LINHA DO DEFEITO. Sem ela o `BaseLayerControl` nunca chama `clearFeatureSources`, e a
        // feicao do servidor fica desenhada na tela depois de o disco ja estar vazio.
        expect(tiposEmitidos(eventBus)).toContain(EventTypes.ALL_DATA_CLEARED);
    });

    it('e o disco daquele namespace fica vazio, que e a metade que ja funcionava', async () => {
        const { store, scope } = await montarAtlasRemoto();
        const { discardRemoteWrites } = await import('@store/remote-write-fence.js');
        discardRemoteWrites(scope);

        await store.clearAllDataStore({ reinitialize: false });

        expect(
            readKey(`ebgeo_maps__${SUFIXO}`, 'Mapa do Servidor'),
            'o esvaziamento usa os handles crus e nunca passou pela cerca',
        ).toBeNull();
    });

    it('CONTROLE: com a cerca ABERTA o wipe continua reconstruindo o mapa em branco', async () => {
        const { store, eventBus } = await montarAtlasRemoto();
        const { EventTypes } = await import('@events/event_types.js');
        vi.spyOn(eventBus, 'emit');

        await store.clearAllDataStore({ reinitialize: false });

        expect(tiposEmitidos(eventBus)).toContain(EventTypes.ALL_DATA_CLEARED);
        // ABSOLUTO: o wipe sem cerca semeia o mapa em branco de volta. Se o conserto tivesse
        // simplesmente parado de reconstruir, esta linha reprovaria.
        const mapas = [...databases.get(`ebgeo_maps__${SUFIXO}::keyvaluepairs`).keys()];
        expect(mapas.length, 'o mapa em branco foi semeado de volta').toBeGreaterThan(0);
    });
});
