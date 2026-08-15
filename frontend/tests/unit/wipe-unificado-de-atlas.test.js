// Path: tests/unit/wipe-unificado-de-atlas.test.js

/**
 * @fileoverview The wipe of the mounted atlas, pinned end to end.
 *
 * `store.js` used to carry TWO hand-written lists of the same ten databases: one in the
 * logged-out boot guard (`enforceLocalStoreWhenLoggedOut`) and one in `clearAllDataStore`.
 * Nothing forced them to agree, so a side-store added to one and forgotten in the other
 * would leave server data behind on exactly one of the two paths, silently. Both now route
 * through a single derived wipe (`clearAllAtlasStores` -> `listAtlasStores()`).
 *
 * WHAT WOULD THIS GREEN PROVE IF THE CODE WERE WRONG: each test seeds a sentinel key into
 * every per-atlas database and requires it to be GONE afterwards, so a database left out of
 * the wipe keeps its sentinel and fails by name. Deriving the expectation from the same
 * list the code derives from would pass with an empty list, so the ten names are written
 * out ABSOLUTELY here and the factory's descriptors are checked against that literal.
 *
 * It also pins the distinction the phase must not lose: unmounting an atlas EMPTIES its
 * databases (`clear`) and never DELETES them (`dropInstance`), which is a separate
 * operation owned by the deletion of a named local atlas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// A fake IndexedDB keyed by (database name, object store), so the test can see WHICH
// database each call reached. It survives `vi.resetModules()` on purpose: that is what
// makes it behave like a disk across a simulated reload.
// ============================================================================

const { databases, dropped, storeOf, seed, readKey, resetDisk } = vi.hoisted(() => {
    const databases = new Map();
    const dropped = [];

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

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
        dropped,
        storeOf,
        seed: (name, key, value, storeName = null) => backingOf(name, storeName).set(key, value),
        readKey: (name, key, storeName = null) => backingOf(name, storeName).get(key) ?? null,
        resetDisk: () => { databases.clear(); dropped.length = 0; }
    };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(storeOf),
        dropInstance: vi.fn(async ({ name }) => { dropped.push(name); })
    }
}));

// ============================================================================
// The ten per-atlas databases, written out instead of derived from the module under test.
// ============================================================================

const ATLAS_DATABASES = [
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

/** The databases that belong to the INSTALLATION and must survive a wipe of the atlas. */
const GLOBAL_DATABASE = 'ebgeo_global';

const SENTINEL = '__sentinela_do_teste__';

/** Seeds the sentinel into every per-atlas database plus the global one. */
function seedSentinels() {
    for (const name of ATLAS_DATABASES) seed(name, SENTINEL, { alvo: name });
    seed(GLOBAL_DATABASE, SENTINEL, { alvo: GLOBAL_DATABASE });
}

/** @returns {string[]} Names of the per-atlas databases that still hold the sentinel. */
function databasesStillHoldingSentinel() {
    return ATLAS_DATABASES.filter(name => readKey(name, SENTINEL) !== null);
}

// ============================================================================
// Um atlas REMOTO tem os mesmos dez bancos, sob o sufixo `remote-<atlasId>`, e o wipe do
// logout precisa alcançar TODOS os registrados, não só o que este boot montou.
// ============================================================================

const ATLAS_A = '11111111-1111-4111-8111-111111111111';
const ATLAS_B = '22222222-2222-4222-8222-222222222222';

/** @returns {string[]} Os dez bancos de um atlas remoto, escritos absolutamente. */
function remoteDatabases(atlasId) {
    return ATLAS_DATABASES.map(name => `${name}__remote-${atlasId}`);
}

/** Registra um atlas remoto no banco global e semeia a sentinela nos seus dez bancos. */
function seedRemoteAtlas(atlasId) {
    seed(GLOBAL_DATABASE, `remote_atlas:${atlasId}`, {
        atlasId,
        dbSuffix: `remote-${atlasId}`,
        createdAt: 1,
        updatedAt: 1
    });
    for (const name of remoteDatabases(atlasId)) seed(name, SENTINEL, { alvo: name });
}

/** @returns {string[]} Bancos daquele atlas remoto que ainda guardam a sentinela. */
function remoteDatabasesStillHoldingSentinel(atlasId) {
    return remoteDatabases(atlasId).filter(name => readKey(name, SENTINEL) !== null);
}

/**
 * Finge uma sessão viva no grafo de módulos recém-carregado.
 * @param {boolean} authenticated - Se há alguém autenticado.
 * @returns {Promise<void>}
 */
async function setSession(authenticated) {
    const { sessionContext } = await import('@store/sync/session-context.js');
    vi.spyOn(sessionContext, 'isAuthenticated').mockReturnValue(authenticated);
}

/**
 * A store facade on a fresh module graph. `initServices()` is the real boot wiring (it
 * calls `initStoreEvents` itself), so the paths under test run against the real managers
 * rather than against stubs that could hide a missing store.
 * @returns {Promise<{ store: Object, services: Object }>}
 */
async function loadStoreFacade() {
    vi.resetModules();
    const { initServices } = await import('@store/services.js');
    const services = initServices();
    const store = await import('@store/store.js');
    return { store, services };
}

beforeEach(() => {
    resetDisk();
    vi.clearAllMocks();
});

// ============================================================================
// The derived list
// ============================================================================

describe('a lista de bases do atlas', () => {
    it('tem exatamente estas dez bases marcadas como DADO de atlas', async () => {
        const { STORE_DESCRIPTORS } = await import('@store/atlas-namespace.js');
        const atlasData = STORE_DESCRIPTORS.filter(d => d.perAtlas && d.atlasData).map(d => d.dbName);

        expect(atlasData).toHaveLength(10);
        expect(atlasData).toEqual(ATLAS_DATABASES);
    });

    // TROCADO NA AUDITORIA DE E2B (2026-08-15), nunca somado. Este caso afirmava "os DOIS
    // bancos globais", e a fila de saída era o segundo. Ela virou por atlas, e o descritor
    // ganhou um segundo eixo: `perAtlas` = morre com o atlas (destruição), `atlasData` = é
    // esvaziado pelo wipe de ENTRADA. A fila é a ÚNICA linha em que os dois divergem, e é
    // por isso que uma troca de projeto não apaga o trabalho pendente do usuário. Ler um
    // eixo só chamaria os dois de sinônimos, que é o defeito que esta fase corrigiu.
    it('a fila de saída morre com o atlas SEM ser dado dele, e é a única divergência', async () => {
        const { STORE_DESCRIPTORS } = await import('@store/atlas-namespace.js');
        const perAtlas = STORE_DESCRIPTORS.filter(d => d.perAtlas).map(d => d.dbName);
        const divergentes = STORE_DESCRIPTORS.filter(d => d.perAtlas !== d.atlasData).map(d => d.dbName);

        expect(perAtlas).toHaveLength(11);
        expect(perAtlas).toEqual([...ATLAS_DATABASES, 'ebgeo']);
        expect(divergentes).toEqual(['ebgeo']);
    });

    it('deixa de fora a base da instalação, que nenhum wipe de atlas pode tocar', async () => {
        const { STORE_DESCRIPTORS } = await import('@store/atlas-namespace.js');
        const globals = STORE_DESCRIPTORS.filter(d => !d.perAtlas).map(d => d.dbName);

        expect(globals).toHaveLength(1);
        expect(globals).toEqual([GLOBAL_DATABASE]);
    });
});

// ============================================================================
// Path 1: "limpar todos os dados" / troca de atlas
// ============================================================================

describe('clearAllDataStore', () => {
    it('esvazia TODAS as dez bases do atlas montado', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(databasesStillHoldingSentinel()).toEqual([]);
    });

    it('não toca na base global da instalação', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(readKey(GLOBAL_DATABASE, SENTINEL)).toEqual({ alvo: GLOBAL_DATABASE });
    });

    it('esvazia a fila de saída, que é global e sobreviveria à troca de atlas', async () => {
        const { store } = await loadStoreFacade();
        seed('ebgeo', 'op_teste', { id: 'op_teste' }, 'operation_queue');

        await store.clearAllDataStore();

        expect(readKey('ebgeo', 'op_teste', 'operation_queue')).toBeNull();
    });

    it('desmonta sem destruir: nenhuma base é apagada do disco', async () => {
        const localforage = (await import('localforage')).default;
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        expect(localforage.dropInstance).not.toHaveBeenCalled();
        expect(dropped).toEqual([]);
    });

    it('mantém os nomes de banco de hoje enquanto existe um único atlas local', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();

        await store.clearAllDataStore();

        const touched = [...databases.keys()].map(k => k.split('::')[0]);
        for (const name of ATLAS_DATABASES) {
            expect(touched).toContain(name);
        }
        expect(touched.filter(name => name.includes('__'))).toEqual([]);
    });
});

// ============================================================================
// Path 1.b: o logout ATIVO, no meio do uso
//
// `enforceLocalStoreWhenLoggedOut` só roda no boot e desmonta o atlas CORRENTE. Com um
// namespace por atlas remoto, sair da sessão no meio do uso tem de varrer o REGISTRO, senão
// sobra dado de servidor no disco até a próxima recarga.
// ============================================================================

// REESCRITO EM E1 (2026-08-15), e a versão anterior é o motivo de este comentário existir.
//
// Este par afirmava que `clearAllDataStore` VARRE todo namespace remoto quando ninguém está
// autenticado, e não varre quando há sessão. Era a descrição fiel do código, e o código estava
// errado: a condição fazia de todo wipe anônimo um logout. O visitante de um link público
// registra um namespace e chama o wipe três linhas depois (`index.js openPublicAtlasFromUrl`),
// então ele destruía o namespace que acabara de registrar. O import de `.ebgeo` e o "Limpar
// Tudo" herdavam a mesma coisa.
//
// Os casos foram TROCADOS, nunca somados: um teste que continuasse exigindo a varredura dentro
// do wipe faria a correção parecer regressão, que é como uma suíte passa a defender um defeito.
describe('clearAllDataStore não varre namespace nenhum, com ou sem sessão', () => {
    it('DESLOGADO: esvazia o atlas montado e NÃO toca os outros namespaces registrados', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedRemoteAtlas(ATLAS_A);
        seedRemoteAtlas(ATLAS_B);

        await store.clearAllDataStore();

        // Os dois sobrevivem: destruí-los é trabalho do logout, chamado por nome.
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_B)).toEqual(remoteDatabases(ATLAS_B));
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).not.toBeNull();
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_B}`)).not.toBeNull();
    });

    it('LOGADO: idem, porque a sessão deixou de ser consultada', async () => {
        const { store } = await loadStoreFacade();
        await setSession(true);
        seedRemoteAtlas(ATLAS_A);
        seedRemoteAtlas(ATLAS_B);

        await store.clearAllDataStore();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_B)).toEqual(remoteDatabases(ATLAS_B));
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).not.toBeNull();
    });
});

describe('discardRemoteAtlasNamespaces: a varredura, agora chamada por nome', () => {
    // CONTROLE POSITIVO do par acima. Sem ele, "o wipe não varreu" seria indistinguível de
    // "a varredura não funciona mais": os dois casos anteriores ficariam verdes se
    // `purgeAllRemoteAtlases` tivesse simplesmente quebrado.
    it('destrói TODOS os namespaces registrados, que é o que o logout precisa', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedRemoteAtlas(ATLAS_A);
        seedRemoteAtlas(ATLAS_B);
        // ANTES (positivo): os dois estão lá, senão "sumiu" e "nunca existiu" se confundem.
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_B)).toEqual(remoteDatabases(ATLAS_B));

        await store.discardRemoteAtlasNamespaces();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_B)).toEqual([]);
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_B}`)).toBeNull();
    });
});

// ============================================================================
// Path 2: o guarda de boot do usuário deslogado
// ============================================================================

describe('guarda de boot com dado remoto e ninguém autenticado', () => {
    it('esvazia as mesmas dez bases, pela mesma lista', async () => {
        const { store } = await loadStoreFacade();
        seedSentinels();
        // The marker that makes the guard fire: the store holds a server atlas.
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        await store.initializeWithLastActiveMap();

        expect(databasesStillHoldingSentinel()).toEqual([]);
    });

    it('não apaga banco nenhum: quem só deslogou continua com seus slots de pé', async () => {
        const localforage = (await import('localforage')).default;
        const { store } = await loadStoreFacade();
        seedSentinels();
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: 'atlas-do-servidor' });

        await store.initializeWithLastActiveMap();

        expect(localforage.dropInstance).not.toHaveBeenCalled();
    });

    it('varre TAMBÉM os namespaces remotos registrados, que o marcador não menciona', async () => {
        const { store } = await loadStoreFacade();
        seedRemoteAtlas(ATLAS_A);
        seedRemoteAtlas(ATLAS_B);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_B)).toEqual([]);
    });

    it('não dispara com origem local: o dado do usuário offline fica onde está', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        seedSentinels();
        // Without a schema version the boot takes the fresh-install path and discards the
        // legacy subset, which would hide the negative control behind unrelated cleanup.
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);

        await store.initializeWithLastActiveMap();

        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
    });
});

// ============================================================================
// Path 3: o órfão que uma aba morta deixou no registro
//
// A origem diz LOCAL (esta aba nunca abriu nada de servidor) e mesmo assim existe namespace
// remoto registrado, porque OUTRA aba abriu e morreu. Sem sessão, ele não pode ficar.
// ============================================================================

// ============================================================================
// Path 2.b: o guarda de boot quando o namespace foi POUPADO (E2)
//
// A perda que esta seção existe para impedir: um namespace poupado não entra em `atlases` nem
// em `adopted`, então um predicado que o ignorasse responderia "não alcancei" e o guarda
// esvaziaria o slot local #1 do usuário sobre a ponte legada, no boot, sem erro nenhum.
// ============================================================================

/**
 * Segura o lock de montagem como faria OUTRA ABA, com o `navigator.locks` de verdade.
 *
 * O nome está ESCRITO À MÃO, não derivado de `atlasMountLockName`: é contrato entre abas (e um
 * dia entre versões do app), então uma mudança de formato tem de aparecer como vermelho aqui em
 * vez de acompanhar silenciosamente a fonte que ela deveria estar conferindo.
 *
 * @param {string} atlasId - Atlas de servidor mantido montado.
 * @returns {Promise<() => Promise<void>>} Função que solta o lock.
 */
async function outraAbaMonta(atlasId) {
    let release;
    let granted;
    const ateSoltar = new Promise(resolve => { release = resolve; });
    const concedido = new Promise(resolve => { granted = resolve; });
    const settled = navigator.locks.request(
        `ebgeo-atlas:#remote-${atlasId}`,
        { mode: 'shared' },
        () => { granted(); return ateSoltar; }
    );
    settled.catch(() => undefined);
    await concedido;
    return async () => { release(); await settled; };
}

describe('guarda de boot com um namespace remoto POUPADO', () => {
    it('poupa o namespace da outra aba E NÃO esvazia o slot local deste boot', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seedRemoteAtlas(ATLAS_A);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        const soltar = await outraAbaMonta(ATLAS_A);
        // ANTES (positivo): os dois blocos estão de pé, senão "sobreviveu" e "nunca esteve lá"
        // seriam o mesmo verde.
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);

        await store.initializeWithLastActiveMap();
        await soltar();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).not.toBeNull();
        // o trabalho local do usuário continua inteiro: é ele que a falta de `spared` apagaria
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
    });

    // ========================================================================
    // P13, FECHADO EM 2026-08-15 POR DECISÃO DO DONO. Os dois casos abaixo eram `it.fails`.
    //
    // A OUTRA METADE DE P3 tinha aberto uma perda nova: `purgeReachedAtlas` contava `atlases`,
    // `adopted` e `spared` e deliberadamente NÃO contava `empty`. A intenção era boa (um
    // namespace fabricado não pode falar o guarda para fora do wipe que importa), mas `empty`
    // mistura DUAS coisas: "nunca foi registrado" e "registrado e nunca escrito". A primeira nem
    // aparece no relatório, que é DERIVADO do registro, então ela já respondia false sozinha e o
    // segundo wipe seguia rodando: é o caso pré-namespace, e é para ele que o segundo wipe
    // existe. A segunda é um atlas que POSSUI namespace, logo o dado dele nunca esteve nos
    // bancos sem sufixo, logo o segundo wipe não tinha o que terminar ali e caía sobre o slot
    // local #1.
    //
    // A JANELA É REAL E TEM GESTO: `openRemoteAtlas` registra o namespace
    // (`activateRemoteAtlas`) e marca a origem REMOTE ANTES de `syncEngine.connect`
    // (`open-atlas.service.js`). O `catch` do connect reverte a origem, mas a aba FECHADA no
    // meio do pull nunca roda o catch. O boot deslogado seguinte encontrava: entrada no
    // registro, dez bancos vazios, marcador REMOTE — e esvaziava o trabalho local do usuário.
    //
    // O que P3 temia (o expurgo FABRICAR dez bancos e chamá-los de destruídos) foi eliminado na
    // ORIGEM pela guarda de `keys()` em `clearAtlasDatabases`, então nenhum braço deste
    // relatório pode ser inventado pelo ato de ler.
    //
    // Localizado por bissecção: com o `hadData` pré-P3 (`true` incondicional) os dois casos
    // passavam, o que põe o defeito dentro de E2 e não antes dela. A mesma bissecção é o
    // controle negativo desta correção: com `empty` fora do predicado os dois voltam a VERMELHO.
    it('namespace REGISTRADO e VAZIO não pode esvaziar o slot local #1', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        // registrado, mas sem um byte nos dez bancos: a aba morreu durante o pull inicial
        seed(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`, {
            atlasId: ATLAS_A, dbSuffix: `remote-${ATLAS_A}`, createdAt: 1, updatedAt: 1
        });
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        // ANTES (positivo): sem isto, "o slot local sobreviveu" e "nunca teve nada" seriam o
        // mesmo verde, e o namespace remoto precisa estar de fato VAZIO, senão o cenário é o do
        // controle logo abaixo e não este.
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);

        await store.initializeWithLastActiveMap();

        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
        // e o namespace vazio foi mesmo ALCANÇADO, não ignorado: a entrada saiu do registro.
        // Sem esta linha, um expurgo que não enxergasse ATLAS_A daria o mesmo verde acima.
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
    });

    it('destruição FORÇADA de um namespace vazio não pode esvaziar o slot local #1', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seed(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`, {
            atlasId: ATLAS_A, dbSuffix: `remote-${ATLAS_A}`, createdAt: 1, updatedAt: 1,
            sparedAt: 1
        });
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        const soltar = await outraAbaMonta(ATLAS_A);
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);

        await store.initializeWithLastActiveMap();
        await soltar();

        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
        // `sparedAt: 1` é um prazo vencido em 1970, então este boot passou pelo braço FORÇADO e
        // não pelo `spared`: a entrada tem de ter sumido. Se ela sobrevivesse, o caso teria sido
        // poupado e estaria medindo o caminho do vizinho, que já é medido logo acima.
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
    });

    // CONTROLE dos dois acima, e ele roda a MESMA chamada destrutiva: com dado no namespace o
    // atlas cai em `atlases`, o predicado responde true e o slot local sobrevive. Se este
    // ficar vermelho, o harness parou de alcançar o cenário e os dois `it.fails` acima estão
    // verdes por motivo errado.
    it('CONTROLE: com dado no namespace, o mesmo boot NÃO esvazia o slot local #1', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seedRemoteAtlas(ATLAS_A);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);

        await store.initializeWithLastActiveMap();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
    });

    it('CONTROLE: sem ninguém montado, o MESMO boot destrói o namespace', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seedRemoteAtlas(ATLAS_A);
        seed(GLOBAL_DATABASE, '__store_origin__', { kind: 'remote', atlasId: ATLAS_A });

        await store.initializeWithLastActiveMap();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
    });
});

// ============================================================================
// O AVISO DE DESMONTAGEM NO BOOT
//
// A varredura destrutiva tem DOIS chamadores que significam "a sessão acabou": o logout e a
// guarda de boot. O aviso existia só no primeiro, então o ramo `forced` (prazo de 24 h vencido)
// destruía o namespace de uma aba VIVA sem que ela soubesse, que é exatamente o buraco que o
// protocolo TEARDOWN existe para fechar.
//
// E o conserto óbvio (chamar `announceTabLockTeardown` aqui também) seria FANTASMA: `index.js`
// só chama `initTabLock` DEPOIS que o boot da store termina, então no instante desta varredura
// não existe lock nenhum nesta página e a função devolvia um relatório sem postar nada. Por isso
// estes casos medem o que a VIZINHA recebeu, nunca o que a função devolveu.
// ============================================================================

describe('a varredura avisa as outras abas antes de destruir', () => {
    /** @type {Array<{destroy: () => void}>} */
    let abas = [];

    afterEach(() => {
        for (const aba of abas) aba.destroy();
        abas = [];
    });

    /**
     * Uma OUTRA ABA de verdade no canal real (`BroadcastChannel`), que é o transporte que a
     * varredura usa quando não há lock de página. Ela responde ao aviso como a aba do mapa
     * responde: "eu escrevo nesse endereço e já parei".
     *
     * @returns {Promise<{avisos: string[][], bancosNoAviso: number[]}>} O que ela recebeu, e
     *   quantos bancos do namespace ainda tinham dado NO INSTANTE do aviso.
     */
    async function abaVizinhaEscutando() {
        const { createTabLock, noneKey } = await import('@utils/tab-lock.js');
        const recebido = { avisos: [], bancosNoAviso: [] };
        abas.push(createTabLock({
            key: noneKey(),
            overlayHost: null,
            onTeardown: (addresses) => {
                recebido.avisos.push(addresses);
                // A ORDEM, medida em vez de suposta: avisar depois de esvaziar é não avisar.
                recebido.bancosNoAviso.push(remoteDatabasesStillHoldingSentinel(ATLAS_A).length);
                return true;
            }
        }));
        return recebido;
    }

    it('o boot deslogado avisa a vizinha, e avisa ANTES de esvaziar', async () => {
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedRemoteAtlas(ATLAS_A);
        const recebido = await abaVizinhaEscutando();

        await store.initializeWithLastActiveMap();

        expect(recebido.avisos).toEqual([[`remote-${ATLAS_A}`]]);
        expect(recebido.bancosNoAviso).toEqual([10]);
    });

    it('e avisa também no ramo FORÇADO, que é o que destrói uma aba viva', async () => {
        // `sparedAt: 1` é um prazo vencido em 1970 e a outra aba segura a montagem: a varredura
        // passa pelo braço `forced` e destrói mesmo assim. É o caso em que o aviso é a ÚNICA
        // proteção que resta, e era justamente onde ele não existia.
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedRemoteAtlas(ATLAS_A);
        seed(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`, {
            atlasId: ATLAS_A, dbSuffix: `remote-${ATLAS_A}`, createdAt: 1, updatedAt: 1, sparedAt: 1
        });
        const soltar = await outraAbaMonta(ATLAS_A);
        const recebido = await abaVizinhaEscutando();

        await store.initializeWithLastActiveMap();
        await soltar();

        expect(recebido.avisos).toEqual([[`remote-${ATLAS_A}`]]);
        // Positivo do cenário: a destruição forçada aconteceu mesmo. Sem isto, um boot que
        // POUPASSE daria o mesmo verde acima e o caso estaria medindo outro braço.
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
    });

    it('CONTROLE: sem namespace remoto registrado, ninguém é avisado à toa', async () => {
        // O caso comum (usuário local, nenhum atlas de servidor nesta máquina). Também é o que
        // impede o boot de pagar o tempo de assentamento do canal por nada.
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        const recebido = await abaVizinhaEscutando();

        await store.initializeWithLastActiveMap();

        expect(recebido.avisos).toEqual([]);
    });

    it('CONTROLE: o slot RESGATADO não é anunciado, porque o expurgo não o toca', async () => {
        // A lista anunciada é a do expurgo, exclusão inclusa: o slot adotado conserva o sufixo
        // `remote-<id>` e muda de registro. Anunciá-lo congelaria à toa a aba que o segura.
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedRemoteAtlas(ATLAS_A);
        seed(GLOBAL_DATABASE, `local_atlas:slot-resgatado`, {
            atlasId: 'slot-resgatado',
            dbSuffix: `remote-${ATLAS_A}`,
            nome: 'Trabalho recuperado',
            createdAt: 1,
            updatedAt: 1
        });
        // O boot monta esse slot (é o único do registro local); sem a versão de schema ele toma o
        // caminho de instalação nova e descarta o subconjunto legado, o que apagaria metade das
        // sentinelas por um motivo que não tem nada a ver com este caso.
        seed(`ebgeo_app_settings__remote-${ATLAS_A}`, 'schemaVersion', ATLAS_SCHEMA_VERSION);
        const recebido = await abaVizinhaEscutando();

        await store.initializeWithLastActiveMap();

        expect(recebido.avisos).toEqual([]);
        // Positivo: o cenário é mesmo o do resgate, e o dado ficou de pé por causa dele.
        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
    });
});

describe('órfão no registro remoto, boot sem sessão', () => {
    it('é recolhido mesmo com a origem LOCAL, que é o caso que um crash deixa', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(false);
        seedSentinels();
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seedRemoteAtlas(ATLAS_A);

        await store.initializeWithLastActiveMap();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual([]);
        expect(readKey(GLOBAL_DATABASE, `remote_atlas:${ATLAS_A}`)).toBeNull();
        // controle negativo: o atlas LOCAL do usuário deslogado não é tocado por isto
        expect(databasesStillHoldingSentinel()).toEqual(ATLAS_DATABASES);
    });

    it('CONTROLE NEGATIVO: com sessão viva o órfão fica, porque pode ser o atlas em uso', async () => {
        const { ATLAS_SCHEMA_VERSION } = await import('@store/atlas/atlas.entity.js');
        const { store } = await loadStoreFacade();
        await setSession(true);
        seed('ebgeo_app_settings', 'schemaVersion', ATLAS_SCHEMA_VERSION);
        seedRemoteAtlas(ATLAS_A);

        await store.initializeWithLastActiveMap();

        expect(remoteDatabasesStillHoldingSentinel(ATLAS_A)).toEqual(remoteDatabases(ATLAS_A));
    });
});
