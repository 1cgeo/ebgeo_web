// Path: tests/integration/wipe-poupa-blob-pendente.repro.test.js

/**
 * @fileoverview REPRO: um F5 no meio de uma subida de imagem interrompida apagava os bytes, a
 * pendência que os nomeava, e parava a fila de saída do atlas para sempre.
 *
 * A CADEIA, medida em navegador por `frontend/tests/e2e-ui/browser-collab-imagem-retomada.spec.js`
 * (caso do F5, que lia `{"estado":null,...,"blobLocal":false}` depois do recarregamento):
 *
 *   1. a subida do blob falha por rede. `blob-upload-queue.js` deixa a pendência PENDENTE e a op
 *      da FEIÇÃO fica PREPARADA, isto é, não sai no `peek` (é o desenho: op sem bytes desenha um
 *      buraco no par);
 *   2. a pessoa recarrega. Com `?atlas=` na barra, o boot chama `openRemoteAtlas`, cujo passo 4 é
 *      `clearAllDataStore({ markLocal: false })`;
 *   3. aquele wipe esvazia os DEZ bancos de dado do escopo, e `ebgeo_images` é um deles: morrem a
 *      pendência E o blob. A fila de saída NÃO morre (ela é `atlasData: false`, decisão 2b), então
 *      a op da feição continua lá, preparada;
 *   4. o `connect` seguinte roda `retomarBlobsPendentes`, que não acha registro nenhum. Nada mais
 *      limpa a marca de preparo, e a retenção é head-of-line: a fila inteira do atlas para, para
 *      sempre, sem uma linha vermelha em lugar nenhum.
 *
 * O CONSERTO, e por que ele não é "poupar sempre". O blob pendente é o PAYLOAD de uma operação da
 * fila de saída (não existe op de bytes), então os dois têm uma vida só: `unmountCurrentAtlas`
 * passa `preserveBlobUploads: !clearQueue`, reusando a decisão que a fila já tinha. Wipe que
 * termina num store local em branco abandona as operações, e guardar os bytes delas deixaria
 * dívida que ninguém cobra; wipe que monta um atlas REMOTO na linha seguinte é o caso deste
 * conserto, porque é o mesmo `connect` que vai drenar a fila e retomar a subida.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: cada caso semeia as três espécies de
 * chave que vivem em `ebgeo_images` (a pendência, o blob que ela nomeia, e uma figura que o
 * servidor já tem) e exige o desfecho de cada uma por nome. Desfazer o conserto deixa o primeiro
 * caso vermelho na pendência e no blob; poupar SEMPRE deixa o controle negativo vermelho; poupar
 * por prefixo sem olhar o ESTADO deixa o terceiro caso vermelho.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco de mentira keyed por (banco, object store) — molde de
// tests/unit/wipe-unificado-de-atlas.test.js, que é onde o wipe já é exercitado.
// ============================================================================

const { storeOf, seed, readKey, keysOf, resetDisk } = vi.hoisted(() => {
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
        seed: (name, key, value) => backingOf(name).set(key, value),
        readKey: (name, key) => (backingOf(name).has(key) ? backingOf(name).get(key) : null),
        keysOf: (name) => [...backingOf(name).keys()],
        resetDisk: () => databases.clear()
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async () => {})
    }
}));

/** O banco de imagens do escopo, que é onde as três espécies de chave convivem. */
const IMAGENS = 'ebgeo_images';

/** Um banco de dado QUALQUER que não é o de imagens: a exceção tem de ser de UM banco só. */
const CAMADAS = 'ebgeo_layers';

/**
 * O prefixo escrito por extenso, e não importado do módulo sob teste.
 *
 * Derivá-lo faria este arquivo concordar com qualquer renomeação, inclusive uma que quebrasse
 * `store/atlas-contents.js`, que é o outro leitor daquele banco.
 */
const PREFIXO = 'upload_pendente__';

const BLOB_PENDENTE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const BLOB_JA_NO_SERVIDOR = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const SENTINELA = '__sentinela_do_teste__';

/**
 * Semeia o banco de imagens com as três espécies de chave, e a sentinela num segundo banco.
 * @param {string} estado - Estado da pendência semeada.
 * @returns {void}
 */
function semearImagens(estado) {
    seed(IMAGENS, `${PREFIXO}tentativa-1`, {
        tentativaId: 'tentativa-1',
        imageId: BLOB_PENDENTE,
        atlasId: 'atlas-1',
        estado
    });
    seed(IMAGENS, BLOB_PENDENTE, { fingeSerBlob: true, de: 'pendente' });
    seed(IMAGENS, BLOB_JA_NO_SERVIDOR, { fingeSerBlob: true, de: 'ja-subiu' });
    seed(CAMADAS, SENTINELA, { alvo: CAMADAS });
}

/**
 * A fachada da store num grafo de módulos novo, como o modelo do wipe unificado.
 * @returns {Promise<Object>}
 */
async function carregarStore() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    initServices();
    return import('@store/store.js');
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

describe('o wipe de ENTRADA (o que um F5 de atlas de servidor roda) poupa a dívida de bytes', () => {
    it('a pendência PENDENTE e o blob que ela nomeia sobrevivem', async () => {
        const store = await carregarStore();
        semearImagens('pendente');

        // `markLocal: false` é o que `openRemoteAtlas` passa, e dele sai `clearQueue: false`: o
        // atlas está sendo MONTADO, então a fila e a dívida dela são desta abertura.
        await store.clearAllDataStore({ markLocal: false });

        expect(readKey(IMAGENS, `${PREFIXO}tentativa-1`)).toMatchObject({ estado: 'pendente' });
        expect(readKey(IMAGENS, BLOB_PENDENTE)).toEqual({ fingeSerBlob: true, de: 'pendente' });
    });

    it('a figura que o servidor JÁ tem morre, porque o snapshot a traz de volta', async () => {
        const store = await carregarStore();
        semearImagens('pendente');

        await store.clearAllDataStore({ markLocal: false });

        expect(readKey(IMAGENS, BLOB_JA_NO_SERVIDOR)).toBeNull();
        // E a exceção é de UM banco só: nada mais do escopo escapa por tabela.
        expect(keysOf(IMAGENS).sort()).toEqual([`${PREFIXO}tentativa-1`, BLOB_PENDENTE].sort());
        expect(readKey(CAMADAS, SENTINELA)).toBeNull();
    });

    it('CONTROLE: pendência CONFIRMADA não poupa nada, nem a si mesma', async () => {
        const store = await carregarStore();
        semearImagens('confirmado');

        await store.clearAllDataStore({ markLocal: false });

        // Os bytes estão no servidor: guardá-los aqui seria cache que nenhum wipe alcança.
        expect(readKey(IMAGENS, BLOB_PENDENTE)).toBeNull();
        expect(readKey(IMAGENS, `${PREFIXO}tentativa-1`)).toBeNull();
        expect(keysOf(IMAGENS)).toEqual([]);
    });

    it('CONTROLE: pendência RECUSADA também não poupa nada, porque retentativa não a conserta', async () => {
        const store = await carregarStore();
        semearImagens('recusado');

        await store.clearAllDataStore({ markLocal: false });

        expect(keysOf(IMAGENS)).toEqual([]);
    });
});

describe('o wipe que ENCERRA (e leva a fila junto) não guarda dívida de ninguém', () => {
    it('CONTROLE NEGATIVO: com a fila esvaziada, a pendência e o blob morrem', async () => {
        const store = await carregarStore();
        semearImagens('pendente');

        // O padrão (`markLocal: true`) é o wipe que termina num store local em branco: as
        // operações que descreviam aqueles bytes vão embora com ele.
        await store.clearAllDataStore();

        expect(readKey(IMAGENS, `${PREFIXO}tentativa-1`)).toBeNull();
        expect(readKey(IMAGENS, BLOB_PENDENTE)).toBeNull();
        expect(keysOf(IMAGENS)).toEqual([]);
    });
});
