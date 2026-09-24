// Path: tests/integration/limpar-tudo-esquece-o-mapa.repro.test.js

/**
 * @fileoverview REPRO: depois de "Limpar tudo", todo desenho era recusado com o aviso FALSO
 * "O mapa de origem não está mais aberto. O desenho não foi salvo em outro atlas."
 *
 * A CADEIA. `clearAllDataStore` (`store/store.js`) começa por `unmountCurrentAtlas`, que chama
 * `mapResolver.clear()`, e depois semeia o mapa em branco e o torna corrente. Nada reconstruía o
 * resolvedor: os outros três caminhos que o zeram (`resetAtlasView`, `adoptMountedLocalAtlas` e
 * `activateBootAtlasScope`) o refazem logo depois, e este era o único que não. O mapa em branco
 * é chaveado pelo NOME (`seedBlankDefaultMap`) e `getMap` por chave direta não registra nada, então
 * o índice ficava vazio pelo resto da sessão.
 *
 * O ÍNDICE VAZIO É O QUE A FERRAMENTA PERGUNTA. `captureFeatureCreation`
 * (`tool_manager/helpers/feature-creation-context.js`) resolve o mapa corrente para um id e, ao
 * salvar, exige `mapResolver.isKnown(mapId)`: com o índice vazio o nome volta como ele mesmo e
 * `isKnown` responde falso, então TODA feição desenhada depois do wipe era descartada com o aviso
 * de outro atlas, sem erro nenhum no console.
 *
 * CONTROLE NEGATIVO EMBUTIDO: o mesmo mapa, antes do wipe, é conhecido. Sem esse caso, um disco de
 * mentira que nunca registrasse mapa nenhum reprovaria o repro pelo motivo errado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storeOf, seed, resetDisk } = vi.hoisted(() => {
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
        storeOf,
        seed: (name, key, value, storeName = null) => backingOf(name, storeName).set(key, value),
        resetDisk: () => databases.clear()
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async () => {})
    }
}));

const SUFIXO = 'local-1';

/**
 * Monta um atlas local com um mapa que NÃO é o padrão, para o wipe ter o que trocar.
 * @returns {Promise<{store: Object, mapResolver: Object}>}
 */
async function montarAtlasLocal() {
    vi.resetModules();
    const { activateScope, localScope } = await import('@store/atlas-namespace.js');
    activateScope(localScope('slot-1', SUFIXO));
    seed(`ebgeo_maps__${SUFIXO}`, 'Mapa Antigo', {
        id: 'Mapa Antigo',
        name: 'Mapa Antigo',
        features: { points: [{ type: 'Feature', properties: { id: 'p1', source: 'point' } }] }
    });
    const { initServices } = await import('@store/services.js');
    initServices();
    const { awaitMapResolverReady, mapResolver } = await import('@store/services/map-resolver.service.js');
    await awaitMapResolverReady();
    const store = await import('@store/store.js');
    return { store, mapResolver };
}

/**
 * As MESMAS duas perguntas que `captureFeatureCreation` faz: o nome corrente vira id, e o id
 * precisa ser conhecido para o desenho ser salvo.
 * @param {Object} store - Fachada da store.
 * @param {Object} mapResolver - O resolvedor vivo.
 * @returns {boolean}
 */
function desenhoSeriaSalvo(store, mapResolver) {
    const mapId = mapResolver.resolveToId(store.getCurrentMapNameSync());
    return mapResolver.isKnown(mapId);
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

describe('"Limpar tudo" e o desenho seguinte', () => {

    it('CONTROLE: antes do wipe, o mapa corrente é conhecido pelo resolvedor', async () => {
        const { store, mapResolver } = await montarAtlasLocal();
        await store.setCurrentMap('Mapa Antigo');

        expect(desenhoSeriaSalvo(store, mapResolver)).toBe(true);
    });

    it('REPRO: depois do wipe, o mapa em branco que ficou corrente continua conhecido', async () => {
        const { store, mapResolver } = await montarAtlasLocal();
        await store.setCurrentMap('Mapa Antigo');

        await store.clearAllDataStore();

        expect(store.getCurrentMapNameSync(), 'o wipe deixa o mapa em branco corrente').toBe('Principal');
        // A LINHA DO DEFEITO. Com o índice vazio, `canSave` recusava toda feição nova com o aviso
        // de que o mapa de origem não estava mais aberto.
        expect(
            desenhoSeriaSalvo(store, mapResolver),
            'o resolvedor foi zerado pelo wipe e ninguém o reconstruiu',
        ).toBe(true);
        // O mapa apagado não pode continuar resolvendo: reconstruir não é o mesmo que não limpar.
        expect(mapResolver.isKnown('Mapa Antigo')).toBe(false);
    });
});
