// Path: tests/unit/multiaba-invariantes.test.js

/**
 * @fileoverview The per-atlas namespace and multi-tab invariants, every one of them stated in
 * the CORRECT direction: no case here encodes a defect as the expected result, because a green
 * test that asserts the bug is what cements it.
 *
 * THE CONTRACT OF THIS FILE. A case that already holds is a plain `it`; a case that still fails
 * because the defect is open is `it.fails`, with the stage of `docs/decisions/fase-multiaba-2026-08.md` that closes it
 * named in the comment. `it.fails` is green while the defect lives and turns RED on the commit
 * that fixes it, which is what forces the promotion to `it` instead of letting the file rot.
 *
 * WHY EVERY GROUP HAS A `CONTROLE`. `it.fails` is green when ANY line of the body throws, so a
 * broken harness and a live defect look identical from the outside. Every group therefore also
 * carries a plain `it` that walks the same scenario and asserts the state BEFORE the destructive
 * step; if the harness stops reaching the scenario, the control goes red and says so out loud
 * instead of letting the `it.fails` next to it keep a comfortable green. That is not theory: two
 * harness lies were caught by exactly these controls while this file was being written, and both
 * are written down where they happened (the tab-lock singleton over BroadcastChannel, and the
 * boot's fire-and-forget operation logging).
 *
 * AND WHY THE CONTROL MUST EXECUTE THE DESTRUCTIVE STEP ITSELF. Covering only the shared setup
 * is not enough, and it was MEASURED not to be: with `clearAllDataStore` throwing on its first
 * line, group 3's control and BOTH of its `it.fails` stayed green; with `purgeAllRemoteAtlases`
 * throwing, the whole of group 2 stayed green. A control that stops before the step its
 * neighbours depend on cannot tell a dead harness from a live defect in the only place it
 * matters. Each control below therefore RUNS the same destructive call its group's `it.fails`
 * run, and asserts something only a live one produces.
 *
 * WHAT A CONTROL MAY NOT ASSERT. It may not assert the defect. So a control never says "the
 * namespace died"; it says "the sweep reached the end and destroyed the atlas NOBODY has
 * mounted", or "the wipe ran its last line". Those hold today and they still hold after the
 * etapa closes, which is what keeps the control from having to be rewritten by the commit it
 * is supposed to police.
 *
 * PROMOTING AN `it.fails` IS THE FIRST TIME ITS BODY RUNS PAST THE FIRST FAILING LINE. `it.fails`
 * aborts on the assertion that trips, so every line after it has never executed once: a wrong
 * field name or a stale helper in there surfaces only in the promotion commit. When an etapa
 * closes, run the whole body and read every assertion, do not just watch the case turn green.
 *
 * THE STORAGE IS REAL. `fake-indexeddb` is wired globally (`tests/setup/indexeddb.setup.js`), so
 * localforage runs on its real IndexedDB driver and every assertion below is about bytes in a
 * database addressed by ABSOLUTE NAME (`tests/helpers/idb-helpers.js`). The previous version of
 * this file mocked `localforage` with a `Map`, which could not tell an ABSENT database from an
 * EMPTY one and could not observe a delete at all.
 *
 * The predicate itself (`keysCollide`) is asserted in `tests/unit/tab-lock.test.js`, which owns
 * it; only the CONSEQUENCES of the wiring live here. An assertion about the predicate at the top
 * of a scenario is what kept ATTACK 1b from ever executing its body.
 *
 * THE CLOCK OF THIS FILE IS FAKE, AND THAT IS WHAT MAKES IT DETERMINISTIC. The app's boot
 * schedules an UNOWNED `setTimeout(..., 100)` (`MapManager.loadColorUsageFromDB` arming
 * `performInitialColorAnalysis` for a map with no cached colours). Nothing awaits it, so where it
 * lands is decided by wall-clock time: two, three or four tests later, in the middle of a
 * scenario that has nothing to do with colours. When it lands it does exactly the two things
 * this file measures. It OPENS the maps database of the scope its graph has mounted, which
 * RECREATES a namespace a sweep had just deleted, so `databaseState` answers `empty` where the
 * case demands `absent`; and it enqueues a `setting/update/atlas` operation, so the drain in
 * `iniciarServicos` finds a queue that is not empty. Measured, 16 concurrent runs of this file
 * on a loaded machine: 26 failures in 192 runs, spread over four different cases, not one of
 * them a real defect; with the fake clock, 0 in 128.
 *
 * So `beforeEach` freezes `setTimeout` and `afterEach` returns to the real clock, which DISCARDS
 * whatever the test left pending: an orphan can no longer cross a test boundary. The freeze
 * covers `setTimeout`/`clearTimeout` and NOTHING else, and both exclusions are load-bearing:
 * `Date` stays real because the two registries order themselves by `createdAt`/`updatedAt` and a
 * frozen clock would tie them, and `setImmediate` stays real because that is what
 * `fake-indexeddb` schedules its own work on. Waiting in milliseconds instead was rejected: it
 * is the same race with a bigger number. GRUPO 0 is the control of all this.
 *
 * WHAT THE REAL `Date` STILL LEAVES EXPOSED, stated so nobody has to rediscover it: two atlases
 * registered in the same millisecond TIE on `createdAt`, and both registries order by it
 * (`listRemoteAtlases`, `listLocalAtlases`, and the "most recently updated" pick of the current
 * local slot). Today no assertion in this file is decided by that order: every report list this
 * file compares has ONE element, and every data assertion is by ABSOLUTE database name. The day
 * a case here asserts a multi-element order, or asserts WHICH local slot is current with two
 * slots on disk, that case must inject the clock and advance it explicitly between the two
 * registrations, because a stable sort over tied keys answers by insertion order, not by intent.
 * A tie of exactly this shape (`claimedAt`, then a random `tabId`) was the real cause of the
 * flake in `tests/unit/tab-lock-sync-brake.test.js`, after a wrong cause had been written down.
 *
 * THE FLAKE OF THIS FILE IS NOT THAT ONE, AND IT WAS MEASURED, NOT ASSUMED. The unstable case
 * was group 5's "op pendente de OUTRO atlas", 2 in 15 full-suite runs. Re-measured on
 * 2026-08-15 after E7 and the physical queue: 20 full-suite runs in series 20/20 green, plus
 * 132 valid concurrent runs of this file (12 at a time, the load shape the original signature
 * asked for) with 0 failures. The mechanism that closed it and the two guards that now carry it
 * are written at the case itself, and the premise it depends on is asserted in
 * `abaComTrabalhoNaoSincronizado` instead of assumed, so a return fails where it is caused.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    resetIndexedDB,
    readKey,
    databaseState,
    deleteDatabase,
    listDatabases
} from '../helpers/idb-helpers.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn()
}));

/** Stand-in for the sync engine: the socket is not what these invariants are about. */
const engine = vi.hoisted(() => ({ atlasId: null }));
engine.logoutAndDisconnect = vi.fn(async () => { engine.atlasId = null; });
engine.disconnect = vi.fn(() => { engine.atlasId = null; });
engine.connect = vi.fn(async (atlasId) => { engine.atlasId = atlasId; });
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: engine }));
vi.mock('@store/sync/sync-flush.js', () => ({ startAutoFlush: vi.fn(), stopAutoFlush: vi.fn() }));

/** The upload half of "Enviar ao servidor": the network, and nothing else. */
const upload = vi.hoisted(() => ({ fn: null }));
upload.fn = vi.fn();
vi.mock('@js/import_export/save-local-atlas.service.js', () => ({
    saveLocalAtlasToServer: (...args) => upload.fn(...args)
}));

/** The create-atlas dialog: captures the callback so the test can play the user's click. */
const modal = vi.hoisted(() => ({ onCreate: null }));
vi.mock('@modals/create-atlas.modal.js', () => ({
    showCreateAtlasModal: ({ onCreate }) => { modal.onCreate = onCreate; }
}));

/**
 * The tab lock is stubbed to GRANT, and only the two functions that TAKE a claim; the
 * predicate and the key builders stay real, because `tests/unit/tab-lock.test.js` owns the
 * arbitration and this file only asks what the keys promise about databases.
 *
 * IT IS NOT A CONVENIENCE. The real `TabLock` is a module singleton over a BroadcastChannel
 * that `vi.resetModules()` does not tear down, so the instance of an earlier test keeps
 * answering as a live PEER holding the same key. A later `acquireTabLock` is then refused,
 * `saveLocalToServer` returns early on that refusal, and the flow never reaches the code under
 * test while every assertion still fails in exactly the way the open defect makes them fail.
 * That was measured here, and it is the reason the CONTROLE of the last group exists.
 */
vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    acquireTabLock: vi.fn(async () => ({ granted: true, blockedBy: null, degraded: false })),
    setTabLockKey: vi.fn(() => false)
}));

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
/** A third server atlas NOBODY has mounted: the one every sweep must destroy. */
const Z = '33333333-3333-4333-8333-333333333333';

/** Distinct sentinel keys. One key for two different writers cannot say which one landed. */
const SENT_LOCAL = '__sentinela_trabalho_local__';
const SENT_SERVIDOR = '__sentinela_dado_de_servidor__';

/**
 * `localStorage`, que o node não tem e o veto do resgate precisa.
 *
 * O veto mora FORA do IndexedDB de propósito (`remote-atlas.api.js`): o que falha no resgate é
 * uma escrita no `ebgeo_global`, e guardar o veto ali seria dar a ele o modo de falha que ele
 * existe para cobrir. Sem este dobro `retainRemoteAtlasForRescue` é um no-op silencioso e o
 * caso da retenção ficaria verde-como-defeito, ou seja, exatamente como antes de E6.
 */
const memoriaLocal = (() => {
    let dados = new Map();
    return {
        getItem: k => (dados.has(k) ? dados.get(k) : null),
        setItem: (k, v) => { dados.set(k, String(v)); },
        removeItem: k => { dados.delete(k); },
        clear: () => { dados = new Map(); }
    };
})();
if (typeof globalThis.localStorage === 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', { value: memoriaLocal, writable: true });
}

const mapsDb = suffix => (suffix ? `ebgeo_maps__${suffix}` : 'ebgeo_maps');
const remoteMapsDb = atlasId => mapsDb(`remote-${atlasId}`);

let ns, remoteApi, localApi, origem, fila, fabrica, toast;

beforeEach(async () => {
    vi.resetModules();
    // Mocks are module-level and survive `resetModules`, so a call count read in one test would
    // otherwise include the calls of every test before it.
    vi.clearAllMocks();
    await resetIndexedDB();
    // O veto do resgate não mora em módulo nenhum, então `resetModules` não o alcança: sem esta
    // linha um veto de X vazaria para todo caso seguinte, e X é o atlas de quase todos.
    globalThis.localStorage.clear();
    engine.atlasId = null;
    modal.onCreate = null;
    upload.fn.mockReset();

    // AFTER `resetIndexedDB`, which needs a real clock for its own bound on a delete. From here
    // on no timer of the app runs unless a test says so; see the fileoverview and GRUPO 0.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    ns = await import('@store/atlas-namespace.js');
    remoteApi = await import('@store/remote-atlas.api.js');
    localApi = await import('@store/local-atlas.api.js');
    origem = await import('@store/store-origin.js');
    fila = (await import('@store/sync/operation-queue.js')).operationQueue;
    fabrica = await import('@store/sync/operation-factory.js');
    toast = await import('@utils/toast_service.js');
});

afterEach(() => {
    // Back to the real clock, which DISCARDS every timer the test left pending. That discard is
    // the whole fix: the boot's orphan can no longer be inherited by the next test.
    vi.useRealTimers();
    // `Date` é global de verdade e NÃO volta com o `resetModules`: o caso do prazo do veto
    // adianta o relógio um dia, e sem esta linha ele o adiantaria para o resto do arquivo.
    vi.restoreAllMocks();
});

/**
 * Boots the service container the way a page does, and then makes the outbound queue hold
 * EXACTLY what a test puts in it.
 *
 * THE ORDER OF THE STEPS IS THE POINT, and each one covers a different half. Turning the logging
 * off stops work that has not started; awaiting the resolver lets work that ALREADY started
 * finish and land; `clear()` then wipes whatever landed, and the count is the control, because
 * without it the caller would be building on a queue nobody proved empty.
 *
 * IT NO LONGER RACES A TIMER. This drain used to be defeated from OUTSIDE: the boot's unowned
 * 100 ms timer (see the fileoverview) landed after the count and dirtied the queue mid-scenario.
 * The fake clock is what closed that, not a longer wait here.
 * @returns {Promise<void>}
 */
async function iniciarServicos() {
    const { initServices } = await import('@store/services.js');
    const { awaitMapResolverReady } = await import('@store/services/map-resolver.service.js');
    const { disableOperationLogging } = await import('@store/sync/operation-dispatcher.js');
    initServices();
    await awaitMapResolverReady();
    disableOperationLogging();
    await fila.clear();
    expect(await fila.count()).toBe(0);
}

/**
 * Writes a sentinel into every per-atlas database of a scope, through the real factory.
 * @param {Object} scope - A scope built by `localScope()`/`remoteScope()`.
 * @param {string} key - Sentinel key.
 * @param {*} marca - Value.
 * @returns {Promise<void>}
 */
async function semear(scope, key, marca) {
    for (const { store } of ns.listAtlasStores(scope)) await store.setItem(key, marca);
}

/**
 * @param {string} dbName - Absolute database name.
 * @param {string} key - Sentinel key.
 * @returns {Promise<boolean>} True when the sentinel is readable there. Never creates the
 *   database, so "false" cannot be an artefact of the reading.
 */
async function vivo(dbName, key) {
    return (await readKey(dbName, key)) !== null;
}

/**
 * Advances the event loop by ORDER (turns of the macrotask queue), never by milliseconds.
 *
 * `fake-indexeddb` schedules its own work on `setImmediate`, which the fake clock does NOT
 * replace, so `advanceTimersByTimeAsync` fires a callback but cannot carry the database work
 * that callback starts through to the end. Yielding a fixed number of turns does, and it does it
 * the same way on an idle machine and on a loaded one.
 *
 * @param {number} [voltas=30] - Turns to yield.
 * @returns {Promise<void>}
 */
async function voltasDoLaco(voltas = 30) {
    for (let i = 0; i < voltas; i += 1) {
        await new Promise(resolve => { globalThis.setImmediate(resolve); });
    }
}

// =====================================================================================
// GRUPO 0 — o timer órfão do boot, que é o relógio de todo o resto
//
// Este grupo não afirma invariante de produto nenhum: ele afirma o ANDAIME, e existe porque um
// andaime que some não deixa vestígio. Sem ele, tirar o `useFakeTimers` do `beforeEach` devolve
// o arquivo à taxa de 26 falhas em 192 rodadas sob carga, todas em casos que não têm nada a ver
// com relógio, e a próxima pessoa reabre a mesma investigação do zero.
// =====================================================================================

describe('o timer órfão do boot', () => {
    // VERMELHO SE: o relógio falso sair do `beforeEach` (medido: o caso reprova), OU o app parar
    // de agendar o órfão (medido: reprova também). O segundo vermelho é BOA notícia, e o conserto
    // dele é APAGAR o relógio falso junto com este caso, não remendar a asserção.
    it('CONTROLE: o boot agenda um timer que RESSUSCITA banco, e o relógio falso o segura', async () => {
        await correrSaveLocalToServer();
        expect(ns.resolveDbName(ns.StoreName.MAPS)).toBe(remoteMapsDb(X));

        // O órfão está pendente. Com relógio de verdade ele já teria disparado sozinho em algum
        // ponto arbitrário daqui a 100 ms, que é o defeito inteiro.
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        // O banco de mapas do namespace montado some, como numa varredura de logout.
        await deleteDatabase(remoteMapsDb(X));
        expect(await databaseState(remoteMapsDb(X))).toBe('absent');

        // Só agora, e porque este teste mandou, o órfão corre. Ele REABRE o banco destruído: é
        // este `empty` que aparecia no meio de outro cenário como se fosse regressão.
        await vi.advanceTimersByTimeAsync(1000);
        await voltasDoLaco();
        expect(await databaseState(remoteMapsDb(X))).toBe('empty');
    });
});

// =====================================================================================
// GRUPO 1 — "Salvar atlas local no servidor" (ATAQUE 1a)
//
// Driven through the REAL `AccountControl.saveLocalToServer`, not a hand replay of its
// steps. The previous version of this attack read the SOURCE of the function and matched
// substrings inside a slice delimited by two anchors; breaking the closing anchor grew the
// analysed body from 4407 to 19315 characters and all four assertions stayed green. A source
// match cannot fail when the source moves, and the source is not what ships.
// =====================================================================================

/**
 * Runs the whole "Enviar ao servidor" flow the way the menu item does.
 * @returns {Promise<Object>} The `AccountControl` instance, after the flow settled.
 */
async function correrSaveLocalToServer() {
    const { registerControl } = await import('@store/control.registry.js');
    await iniciarServicos();
    registerControl('exportImport', { exportProject: vi.fn() });

    await localApi.initLocalAtlases();
    // A local map with one feature: `saveLocalToServer` refuses an empty store up front, so
    // without this the flow returns before reaching anything under test.
    await ns.getStore(ns.StoreName.MAPS).setItem('Principal', {
        features: {
            point: [{
                type: 'Feature',
                properties: { id: 'f1' },
                geometry: { type: 'Point', coordinates: [0, 0] }
            }]
        }
    });
    upload.fn.mockResolvedValue({
        atlasId: X,
        stats: { maps: 1, features: 1 },
        imageStats: { skipped: 0, failed: 0 }
    });

    const { AccountControl } = await import('@js/account/account.control.js');
    const control = new AccountControl();
    // The control renders into the DOM and the suite runs on `node`. Stubbing the render is
    // what keeps an unrelated ReferenceError from being swallowed by the flow's own catch and
    // read as "the path completed".
    control._render = () => {};

    await control.saveLocalToServer();
    await modal.onCreate('Operação Alfa', null);
    return control;
}

describe('salvar atlas local no servidor', () => {
    // VERMELHO SE: the flow stops short (an unmocked dependency, a refusal, a throw caught by
    // the function's own `catch`). This is the control that gives the two `it.fails` below
    // their meaning: without it, they would be green whether the defect is real or the harness
    // never reached the code.
    it('CONTROLE: o fluxo real chega ao fim, anuncia sucesso e marca a origem REMOTE', async () => {
        await correrSaveLocalToServer();

        expect(upload.fn).toHaveBeenCalledTimes(1);
        expect(engine.connect).toHaveBeenCalledWith(X, { initialPull: true });
        expect(toast.showSuccess).toHaveBeenCalledTimes(1);
        expect(toast.showError).not.toHaveBeenCalled();
        expect(origem.getStoreOriginSync()).toEqual({ kind: 'remote', atlasId: X });
    });

    // FECHADO POR E3 em 2026-08-15, promovido de `it.fails`. Era verde-como-defeito porque o
    // atlas novo nunca era registrado nem ativado: a origem dizia REMOTE enquanto o escopo
    // ativo continuava sendo o slot LOCAL. `saveLocalToServer` ganhou `activateRemoteAtlas`
    // entre o claim e o wipe, que é a ordem que `openRemoteAtlas` já seguia.
    it('o atlas de servidor recém-criado ganha namespace próprio e entra no registro', async () => {
        await correrSaveLocalToServer();

        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.REMOTE);
        expect(ns.resolveDbName(ns.StoreName.MAPS)).toBe(remoteMapsDb(X));
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).toEqual([X]);
    });

    // FECHADO POR E3 em 2026-08-15, promovido de `it.fails`. Era verde-como-defeito porque o
    // snapshot do servidor era escrito no escopo ATIVO, que era o slot local: ficava fora de
    // todo registro, o expurgo do logout não o alcançava, e a próxima carga deslogada montava
    // esse banco como o atlas local do usuário. Dado de servidor legível offline, para sempre.
    it('o dado de servidor não fica legível no slot local depois do logout', async () => {
        await correrSaveLocalToServer();

        // O que o pull do `connect` faz: escreve no escopo ativo.
        await ns.getStore(ns.StoreName.MAPS).setItem(SENT_SERVIDOR, { atlas: X });

        // O usuário abre outro projeto e sai da conta.
        await remoteApi.activateRemoteAtlas(Y);
        await remoteApi.purgeAllRemoteAtlases();
        await origem.markStoreLocal();

        expect(await vivo('ebgeo_maps', SENT_SERVIDOR)).toBe(false);
    });
});

// =====================================================================================
// GRUPO 2 — duas abas em atlas de servidor DIFERENTES (ATAQUE 1b)
//
// This scenario never ran before. Its first line asserted `keysCollide(remote X, remote Y)
// === false`, which the hold in `tab-lock.js` refused, so the body below (the sweep of one tab
// destroying the LIVE namespace of the other) died on line one and the hole that motivates half
// the plan was an inference from reading, not a reproduction. The hold came out in E7
// (2026-08-15) and the predicate now answers `false`, which is what `tests/unit/tab-lock.test.js`
// asserts; the model below no longer depends on it either way (see the paragraph after next).
//
// O MODELO FOI CORRIGIDO EM 2026-08-15 (P13/P12), e a versão anterior é o motivo deste
// parágrafo. Ela modelava as duas abas como DUAS ATIVAÇÕES NO MESMO CLIENTE, terminando com X
// montado, e pedia que a varredura poupasse Y. Sob o Web Lock de montagem isso é falso por
// desenho: `activateScope(X)` depois de `activateScope(Y)` É "esta aba desmontou Y"
// (`acquireMountLock` solta o lock anterior), então Y não tem montagem viva e ser destruído é
// a resposta CERTA. Exigir o contrário afirmaria que uma aba monta dois atlas ao mesmo tempo,
// que é justamente o desenho que deixa resíduo imortal. O caso ficou verde-como-defeito
// enquanto o `it.fails` premiava a resposta errada.
//
// A ABA VIZINHA AGORA É UM LOCK TOMADO DE FORA DO MÓDULO (`outraAbaMonta`, o mesmo helper de
// `remote-atlas-api.test.js` e de `wipe-unificado-de-atlas.test.js`). Um `navigator.locks`
// pedido fora do sujeito é, para ele, um cliente TERCEIRO: indistinguível de outra aba, que é
// o mais perto de duas abas que um processo alcança. O predicado do tab-lock continua fora
// disto de propósito; quem o afirma é `tests/unit/tab-lock.test.js`.
//
// KNOW THE LIMIT OF THIS MODEL, BECAUSE IT IS NOT THE WHOLE REQUIREMENT. Everything here still
// runs in ONE process, e "outro PROCESSO tem montado" segue inalcançável. A metade entre abas
// de verdade vive em `tests/e2e-ui/browser-multi-tab-namespace.spec.js`, caso A3, e um verde
// aqui não significa, sozinho, que o lock funciona no navegador.
// =====================================================================================

/**
 * Segura o lock de montagem como faria OUTRA ABA, com o `navigator.locks` de verdade.
 *
 * O nome está ESCRITO À MÃO, não derivado de `atlasMountLockName`: é contrato entre abas (e um
 * dia entre versões do app), então uma mudança de formato tem de aparecer como vermelho aqui em
 * vez de acompanhar silenciosamente a fonte que ela deveria estar conferindo. O gêmeo desta
 * função em `wipe-unificado-de-atlas.test.js` carrega a mesma decisão.
 *
 * @param {string} atlasId - Atlas de servidor que a outra aba mantém montado.
 * @returns {Promise<() => Promise<void>>} Função que solta o lock e espera a soltura.
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

/**
 * Two tabs, each in its own server atlas, each having written to its own namespace, with the
 * SWEEPING tab (A, on X) mounted at the end and tab B holding the mount of Y from OUTSIDE this
 * module. See the block comment above for why the neighbour cannot be a second activation.
 *
 * A ordem final importa: quem varre está em X e pede à varredura que poupe Y, um namespace que
 * NÃO é o escopo ativo do chamador. Com Y ativo, uma implementação que apenas pulasse o PRÓPRIO
 * escopo satisfaria os casos abaixo sem Web Lock nenhum e sem conhecimento entre abas, que é
 * exatamente o mecanismo que E2 (D1) existe para construir.
 *
 * @returns {Promise<() => Promise<void>>} Função que fecha a aba B (solta o lock de Y).
 */
async function duasAbasEmAtlasDiferentes() {
    await localApi.initLocalAtlases();
    await remoteApi.activateRemoteAtlas(X);
    await semear(ns.remoteScope(X), SENT_SERVIDOR, { atlas: X });
    await remoteApi.activateRemoteAtlas(Y);
    await semear(ns.remoteScope(Y), SENT_SERVIDOR, { atlas: Y });
    // Tab A is the one that logs out, and tab A is on X.
    await remoteApi.activateRemoteAtlas(X);
    // ...e a aba B continua VIVA em Y, o que só um cliente de fora pode representar.
    return outraAbaMonta(Y);
}

describe('duas abas em atlas de servidor diferentes', () => {
    // VERMELHO SE: two scopes ever resolve onto one set of databases, the registration that
    // must precede the first write stops happening, OR the sweep the two cases below depend on
    // stops working. That last clause is the reason the control runs `purgeAllRemoteAtlases`
    // itself: MEDIDO, com o expurgo LANÇANDO, a versão anterior deste controle ficava verde e
    // os dois `it.fails` do grupo também, isto é, harness morto e defeito vivo davam a mesma
    // resposta exatamente aqui.
    //
    // O alvo do expurgo é Z, um atlas que NINGUÉM tem montado: destruí-lo é obrigação em todo
    // desenho, hoje e depois de E2, então este controle não codifica defeito nenhum.
    it('CONTROLE: dois atlas são dois blocos de bancos, e a varredura destes casos realmente destrói', async () => {
        const fecharAbaB = await duasAbasEmAtlasDiferentes();

        // ----- ANTES: os dois blocos existem, com dado, e ambos registrados.
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });
        expect(await readKey(remoteMapsDb(Y), SENT_SERVIDOR)).toEqual({ atlas: Y });
        expect(await databaseState(remoteMapsDb(X))).toBe('populated');
        expect(await databaseState(remoteMapsDb(Y))).toBe('populated');
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId).sort())
            .toEqual([X, Y].sort());

        // ----- um terceiro atlas, aberto e abandonado por uma aba que já morreu.
        await remoteApi.activateRemoteAtlas(Z);
        await semear(ns.remoteScope(Z), SENT_SERVIDOR, { atlas: Z });
        expect(await databaseState(remoteMapsDb(Z))).toBe('populated');
        await remoteApi.activateRemoteAtlas(X);

        // ----- A MESMA chamada de que os dois casos abaixo dependem.
        const relatorio = await remoteApi.purgeAllRemoteAtlases();
        await fecharAbaB();

        expect(relatorio.atlases).toContain(Z);
        expect(await databaseState(remoteMapsDb(Z))).toBe('absent');
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).not.toContain(Z);
    });

    // FECHADO POR E2 em 2026-08-15, promovido de `it.fails` DEPOIS de o modelo ser corrigido
    // (P12), e a ordem dessas duas coisas é a lição. Enquanto a aba vizinha era uma segunda
    // ativação no MESMO cliente, este caso exigia poupar um namespace que ninguém tinha
    // montado: era verde por afirmar a resposta errada, e teria continuado verde depois de E2,
    // que é a pior categoria deste arquivo. Com a aba B representada por um lock de fora, E2
    // responde exatamente o que o requisito pede e o caso passa.
    it('o logout de uma aba poupa o namespace que a outra tem montado', async () => {
        const fecharAbaB = await duasAbasEmAtlasDiferentes();

        const relatorio = await remoteApi.purgeAllRemoteAtlases();
        await fecharAbaB();

        expect(relatorio.atlases).toEqual([X]);
        expect(relatorio.spared).toEqual([Y]);
        expect(await readKey(remoteMapsDb(Y), SENT_SERVIDOR)).toEqual({ atlas: Y });
        // a ENTRADA sobrevive junto com o dado: é ela que faz o caso seguinte ser possível
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).toEqual([Y]);
        // e o namespace de quem varreu morreu na MESMA chamada, senão "poupou Y" e "não varreu
        // nada" seriam a mesma resposta.
        expect(await databaseState(remoteMapsDb(X))).toBe('absent');
    });

    // FECHADO POR E2 em 2026-08-15, promovido de `it.fails`, com o mesmo conserto de modelo.
    // O que ele mede: a aba B sobreviveu à varredura da irmã, seguiu escrevendo, e o que ela
    // escreveu continua ENUMERÁVEL. Antes de E2 a entrada de Y saía do registro junto com os
    // bancos, então a escrita seguinte recriava `ebgeo_maps__remote-Y` fora de todo registro e
    // nenhuma varredura futura o enxergava: resíduo permanente de dado de servidor num usuário
    // deslogado, que é o invariante mais duro do store.
    //
    // A ABA B FECHA ANTES DA SEGUNDA VARREDURA, e tem de fechar: com o lock ainda segurado a
    // resposta certa é poupar de novo, e o que este caso afirma não é "a segunda varredura
    // destrói de qualquer jeito", é "quando a última aba sair, ainda há por onde alcançar".
    it('o que a aba sobrevivente escreve depois continua alcançável por uma varredura futura', async () => {
        const fecharAbaB = await duasAbasEmAtlasDiferentes();
        const primeira = await remoteApi.purgeAllRemoteAtlases();
        // PREMISSA deste caso, e ela é o mecanismo: Y foi poupado COM a entrada de pé.
        expect(primeira.spared).toEqual([Y]);

        // A aba B nunca soube de nada e segue persistindo.
        await ns.getStoreFor(ns.StoreName.MAPS, ns.remoteScope(Y))
            .setItem(SENT_SERVIDOR, { atlas: Y, depois: true });
        expect(await vivo(remoteMapsDb(Y), SENT_SERVIDOR)).toBe(true);

        await fecharAbaB();
        const segunda = await remoteApi.purgeAllRemoteAtlases();

        expect(segunda.atlases).toContain(Y);
        expect(await databaseState(remoteMapsDb(Y))).toBe('absent');
    });
});

// =====================================================================================
// GRUPO 3 — link público, visitante anônimo (ATAQUE 1c)
// =====================================================================================

/**
 * The user's local work, then the public-link entry: claim, register+activate, wipe.
 * `clearAllDataStore` is the REAL one, and with nobody authenticated it is the branch that
 * also sweeps every registered remote namespace.
 *
 * It RETURNS the "antes", captured on the way through, so the control can assert the premise
 * of the whole group and the effect of the wipe in ONE run of the real path. The previous
 * control inlined a copy of the scenario that stopped short of `clearAllDataStore`, and that
 * is measurably worthless: with a `throw` on the first line of the wipe, the control and both
 * `it.fails` of this group stayed green.
 *
 * @returns {Promise<{ trabalhoLocal: *, dbAtivo: string, registro: string[] }>}
 */
async function visitanteDeLinkPublico() {
    await iniciarServicos();
    const { clearAllDataStore } = await import('@store/store.js');

    await localApi.initLocalAtlases();
    await ns.getStore(ns.StoreName.MAPS).setItem(SENT_LOCAL, { trabalho: 'do usuário' });
    const trabalhoLocal = await readKey('ebgeo_maps', SENT_LOCAL);

    // index.js openPublicAtlasFromUrl: acquireTabLock -> activateRemoteAtlas -> clearAllDataStore
    await remoteApi.activateRemoteAtlas(X);
    const antes = {
        trabalhoLocal,
        dbAtivo: ns.resolveDbName(ns.StoreName.MAPS),
        registro: (await remoteApi.listRemoteAtlases()).map(e => e.atlasId),
        carimbados: await settingsCarimbados()
    };

    await clearAllDataStore();
    return antes;
}

/**
 * Every settings database on disk that already carries a `schemaVersion` stamp.
 *
 * It is the tail marker of `clearAllDataStore`: the stamp is written near the END of that
 * function (`setAppSetting('schemaVersion', ...)`), into whichever scope is active. Asking
 * "which databases carry it" instead of "does THIS database carry it" is what makes the
 * before/after pair survive E1 moving the active scope: the count goes from none to one
 * either way.
 * @returns {Promise<string[]>} Absolute names, sorted.
 */
async function settingsCarimbados() {
    const encontrados = [];
    for (const nome of await listDatabases()) {
        if (!nome.startsWith('ebgeo_app_settings')) continue;
        if ((await readKey(nome, 'schemaVersion')) != null) encontrados.push(nome);
    }
    return encontrados.sort();
}

describe('link público (visitante anônimo)', () => {
    // VERMELHO SE: the public entry stops registering/activating before the wipe, the local
    // sentinel is not where this says it is, OR `clearAllDataStore` fails to run to the end.
    //
    // The assertion after the wipe is an effect of its LAST lines (the schema stamp written
    // into whichever scope is active), phrased so it holds today AND after E1 moves that
    // scope: this control does not have to be rewritten by the commit it polices, and it
    // cannot be satisfied by a wipe that threw on line one.
    it('CONTROLE: o "antes" é o que este grupo afirma, e o wipe de entrada roda até o fim', async () => {
        const antes = await visitanteDeLinkPublico();

        // ----- ANTES (positivo): o trabalho local existia, o namespace público foi
        //       registrado e montado, e NENHUM banco de settings estava carimbado.
        expect(antes.trabalhoLocal).toEqual({ trabalho: 'do usuário' });
        expect(antes.dbAtivo).toBe(remoteMapsDb(X));
        expect(antes.registro).toEqual([X]);
        expect(antes.carimbados).toEqual([]);

        // ----- DEPOIS: o wipe COMPLETOU, e completou DENTRO do namespace público. A asserção é
        //       por ENDEREÇO ABSOLUTO, nunca por contagem: contar deixaria "carimbou o banco
        //       certo" e "carimbou outro banco qualquer" com o mesmo resultado, e o endereço é
        //       exatamente o que E1 mudou. Um wipe que lança na primeira linha não carimba nada;
        //       um wipe que ainda devolvesse o escopo ao slot local carimbaria só o legado.
        //
        // OS DOIS NOMES SÃO ESPERADOS, E O SEGUNDO DOCUMENTA UM DEFEITO QUE E5 FECHA. O carimbo
        // no namespace público vem de `setAppSetting` no fim do wipe, que escreve no escopo
        // ATIVO, e é o que este controle mede. O carimbo em `ebgeo_app_settings` vem da cadeia
        // de migração rodada por `initializeRepository`, que abre esse banco por NOME FIXO
        // (`migration.service.js`) e portanto ignora o escopo montado. Confirmação independente
        // do achado de E5: a migração é single-slot e ancorada em nome, não no escopo.
        const carimbados = await settingsCarimbados();
        expect(carimbados).toEqual(['ebgeo_app_settings', `ebgeo_app_settings__remote-${X}`]);
        expect(await readKey(`ebgeo_app_settings__remote-${X}`, 'schemaVersion'))
            .toBe(ATLAS_SCHEMA_VERSION);
    });

    // FECHADO POR E1 em 2026-08-15, promovido de `it.fails`. Era verde-como-defeito porque o
    // `clearAllDataStore` de um anônimo chamava `discardRemoteAtlasNamespaces`, que destruía o
    // namespace registrado três linhas antes e devolvia o escopo ao slot LOCAL. A varredura
    // agora é chamada por nome nos dois caminhos que significam "a sessão acabou".
    it('a ativação do namespace público sobrevive ao wipe de entrada', async () => {
        await visitanteDeLinkPublico();

        expect(ns.getActiveScope().kind).toBe(ns.StoreScopeKind.REMOTE);
        expect(ns.resolveDbName(ns.StoreName.MAPS)).toBe(remoteMapsDb(X));
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId)).toEqual([X]);
    });

    // FECHADO POR E1 em 2026-08-15, promovido de `it.fails`. Era verde-como-defeito porque o
    // escopo voltava a ser LOCAL e o snapshot público caía em `ebgeo_maps`, dentro do atlas
    // local do usuário e fora do registro remoto. As duas
    // sentinelas são chaves DIFERENTES de propósito: com uma chave só, "há dado em ebgeo_maps"
    // não distingue o trabalho do usuário do snapshot do servidor.
    it('o snapshot público cai no namespace de X e não dentro do atlas local', async () => {
        await visitanteDeLinkPublico();

        // markStoreRemote + connectPublic: o pull escreve no escopo ativo.
        await origem.markStoreRemote(X);
        await ns.getStore(ns.StoreName.MAPS).setItem(SENT_SERVIDOR, { atlas: 'público X' });

        expect(await vivo(remoteMapsDb(X), SENT_SERVIDOR)).toBe(true);
        expect(await vivo('ebgeo_maps', SENT_SERVIDOR)).toBe(false);
    });
});

// =====================================================================================
// GRUPO 4 — a fila de saída (ATAQUE 3)
// =====================================================================================

describe('fila de saída com dois atlas remotos', () => {
    // VERMELHO SE: the queue stops persisting, or `peek` stops reading from disk. The "antes"
    // for the two cases below: the operation of X EXISTS and is readable while X is mounted.
    it('CONTROLE: a op nascida em X é lida enquanto X está montado', async () => {
        await localApi.initLocalAtlases();
        await remoteApi.activateRemoteAtlas(X);

        const op = fabrica.createOperation('feature', 'create', 'feat-1', 'mapa-de-X', { a: 1 });
        await fila.enqueue(op);

        expect(await fila.count()).toBe(1);
        expect((await fila.peek(10)).map(o => o.id)).toEqual([op.id]);
    });

    // FECHADO POR E2B (primeira metade) em 2026-08-15, promovido de `it.fails`. Era
    // verde-como-defeito porque o envelope não carregava atlas nenhum: quem lia a op no
    // servidor ou no resgate não tinha como saber de onde ela veio.
    //
    // O plano pede os DOIS campos, e o corpo agora afirma os dois: `scopeSuffix` é o endereço
    // do banco (quem pode ler a op de volta) e `atlasId` é o atlas de servidor (o que o
    // backend pode conferir). Eles só coincidem porque X está montado como atlas REMOTO;
    // num slot local adotado pelo resgate o endereço é o mesmo e o kind não.
    it('o envelope carrega o atlas de origem da operação', async () => {
        await localApi.initLocalAtlases();
        await remoteApi.activateRemoteAtlas(X);

        const op = fabrica.createOperation('feature', 'create', 'feat-1', 'mapa-de-X', { a: 1 });

        expect(op.atlasId).toBe(X);
        expect(op.scopeSuffix).toBe(`remote-${X}`);
    });

    // FECHADO POR E2B (primeira metade) em 2026-08-15, promovido de `it.fails`. Era
    // verde-como-defeito porque a fila é UM banco global: em Y o `peek` devolvia a op de X (o
    // flush de Y a empurraria para o servidor errado) e o `clear` do desmonte apagava a fila
    // INTEIRA, isto é, o trabalho não sincronizado da outra aba.
    //
    // O banco continua sendo UM: o que isola é o carimbo na op mais o filtro por escopo ativo
    // em toda leitura (`operation-queue.js`). A separação física é a segunda metade da etapa,
    // e quando ela entrar este caso continua valendo sem mudar uma linha.
    it('a fila de X não é visível nem apagável a partir de Y', async () => {
        await localApi.initLocalAtlases();
        await remoteApi.activateRemoteAtlas(X);
        const op = fabrica.createOperation('feature', 'create', 'feat-1', 'mapa-de-X', { a: 1 });
        await fila.enqueue(op);

        await remoteApi.activateRemoteAtlas(Y);
        expect((await fila.peek(10)).map(o => o.id)).not.toContain(op.id);

        // O que `unmountCurrentAtlas` faz ao trocar de projeto na aba de Y.
        await fila.clear();

        await remoteApi.activateRemoteAtlas(X);
        expect(await fila.count()).toBe(1);
    });
});

// =====================================================================================
// GRUPO 5 — o resgate de trabalho não sincronizado (ATAQUE 2)
// =====================================================================================

/**
 * A tab mounted on X with unsynced work, at the moment an involuntary logout fires.
 *
 * THE TWO COUNTS BELOW ARE THE PREMISE OF THE WHOLE GROUP, ASSERTED INSTEAD OF ASSUMED, and
 * they are here because the scenario's only input to the code under test is a NUMBER:
 * `_handleLogout` reads `operationQueue.count()` and hands it to `shouldPreserveLocalWork`,
 * which decides rescue or wipe. Everything the cases below assert is downstream of that number.
 *
 * The first count closes an EMPTY COVERAGE. Nothing used to prove the operation had been
 * enqueued at all, so an `enqueue` that silently wrote nowhere left "op pendente de OUTRO
 * atlas" with no operation in it, and the case that carries that name stayed green while
 * measuring nothing. It is asserted while `opDe` is still mounted, which is the only scope
 * that may read it back.
 *
 * The second is the one that names the failure when it comes back. This scenario was flaky
 * (2 in 15 full-suite runs) and the failure surfaced three steps later, as "listLocalAtlases
 * contains remote-X", which reads like a defect in the rescue and is not: any operation that
 * lands in X's scope before the logout makes `preserve` true and produces exactly that
 * symptom. The stray does not have to be the one this scenario enqueued (the boot's
 * fire-and-forget logging can produce one), so the count is the fact to pin, not the atlas.
 * A red HERE says "the premise broke, an operation reached X"; a red three steps later sent
 * the previous investigation looking at the adoption.
 *
 * @param {Object} [options]
 * @param {string} [options.opDe=X] - Atlas the pending operation was born in.
 * @returns {Promise<Object>} The `AccountControl`, before the logout.
 */
async function abaComTrabalhoNaoSincronizado({ opDe = X } = {}) {
    await iniciarServicos();

    await localApi.initLocalAtlases();

    // The pending operation belongs to whichever atlas was mounted when it was created.
    await remoteApi.activateRemoteAtlas(opDe);
    await fila.enqueue(fabrica.createOperation('feature', 'create', 'f1', 'm1', { a: 1 }));
    expect(await fila.count()).toBe(1);

    await remoteApi.activateRemoteAtlas(X);
    // What the logout is about to read. `opDe === X` is the rescue scenario (one pending op),
    // `opDe === Y` is the one where X must be left with nothing of its own.
    expect(await fila.count()).toBe(opDe === X ? 1 : 0);
    await origem.markStoreRemote(X);
    await semear(ns.remoteScope(X), SENT_SERVIDOR, { atlas: X });

    const { AccountControl } = await import('@js/account/account.control.js');
    const control = new AccountControl();
    control._render = () => {};
    control._atlasCache = { id: X, name: 'Operação Alfa' };
    engine.atlasId = X;
    return control;
}

describe('resgate de trabalho não sincronizado no logout involuntário', () => {
    // VERMELHO SE: the rescue stops adopting the namespace, or the purge stops skipping an
    // adopted one. This is both the positive control of the harness AND the behaviour the
    // product promises, so it is a plain `it`: it must never regress.
    // O SEGUNDO ATLAS REMOTO NÃO É DECORAÇÃO. Com um atlas só no cenário, "o expurgo poupou o
    // adotado" e "o expurgo não varreu nada" são a MESMA resposta, e MEDIDO: com
    // `purgeAllRemoteAtlases` virado no-op este caso continuava verde. Z é registrado, tem
    // sentinela própria, NÃO é adotado, e tem que morrer na MESMA varredura em que X sobrevive.
    it('CONTROLE POSITIVO: fila pendente do PRÓPRIO atlas, o trabalho fica (e o não-adotado morre)', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });

        // Um atlas de servidor que ninguém resgatou, aberto antes por esta mesma instalação.
        await remoteApi.activateRemoteAtlas(Z);
        await semear(ns.remoteScope(Z), SENT_SERVIDOR, { atlas: Z });
        await remoteApi.activateRemoteAtlas(X);

        // ANTES: os dois dados existem e os dois atlas estão no registro REMOTO.
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });
        expect(await readKey(remoteMapsDb(Z), SENT_SERVIDOR)).toEqual({ atlas: Z });
        expect((await remoteApi.listRemoteAtlases()).map(e => e.atlasId).sort())
            .toEqual([X, Z].sort());
        expect(await fila.count()).toBe(1);

        await control._handleLogout({ involuntary: true });
        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(toast.showError).not.toHaveBeenCalled();
        expect(toast.showWarning).toHaveBeenCalledTimes(1);
        expect(toast.showWarning.mock.calls[0][0]).toContain('mantidas neste computador');
        // DEPOIS, e as duas metades na MESMA varredura: o adotado sobrevive...
        //
        // Repare em COMO ele sobrevive, que não é pelo braço `adopted`: o resgate MOVE a
        // reivindicação entre os registros, isto é, remove a chave remota de X, então a
        // varredura seguinte não enxerga X de jeito nenhum. `adopted` é o outro caminho (a
        // entrada remota sobreviveu e um slot local reivindica o mesmo sufixo). Por isso o
        // relatório sai com X em lugar NENHUM, e é exatamente essa resposta que, com um único
        // atlas no cenário, era indistinguível de um expurgo que não varreu coisa alguma.
        expect(relatorio.atlases).not.toContain(X);
        expect(relatorio.adopted).not.toContain(X);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });
        // ...e o que ninguém reivindicou é destruído, que é o que distingue "poupou" de
        // "não varreu".
        expect(relatorio.atlases).toEqual([Z]);
        expect(await databaseState(remoteMapsDb(Z))).toBe('absent');
        // O namespace adotado virou slot LOCAL, com os mesmos bancos.
        const locais = localApi.listLocalAtlases();
        expect(locais.map(a => a.name)).toContain('Operação Alfa');
        expect(locais.map(a => a.dbSuffix)).toContain(`remote-${X}`);
    });

    // FECHADO POR E2B (primeira metade) em 2026-08-15, promovido de `it.fails`. Era
    // verde-como-defeito porque a fila era global E cega: a op pendente da aba que está em Y
    // fazia ESTA aba, que está em X e não tem op nenhuma, adotar X como atlas local
    // permanente. Uma cópia editável de atlas de servidor criada por uma operação que nunca
    // foi dele. O que fecha é o `count()` por escopo: `shouldPreserveLocalWork` pergunta
    // quantas ops PENDENTES existem, e a resposta passou a ser sobre o atlas montado.
    //
    // ESTE CASO FOI INSTÁVEL, 2 EM 15 RODADAS DA SUÍTE COMPLETA, E A INSTABILIDADE NÃO FOI
    // ENCONTRADA DE NOVO. Medida em 2026-08-15, depois de E7 e da fila física: 20 rodadas da
    // suíte completa em série, 20/20 verdes, mais 132 execuções válidas deste arquivo em
    // paralelo 12 a 12 (a carga é o que a assinatura original pedia: passava isolado, falhava
    // na suíte), 0 reprovações. Taxa observada 0/152; a anterior era 2/15.
    //
    // POR QUE ELA SUMIU, e é uma explicação sobre o código, não sobre a sorte: hoje SÃO DOIS
    // guardas onde havia zero, e cada um bastaria. A op nasce carimbada com o endereço do
    // escopo (`scopeSuffix`, `operation-factory.js`) e toda leitura filtra por ele
    // (`operationBelongsToScope`); e a fila virou FÍSICA por atlas (`perAtlas: true`), então a
    // op de Y nem sequer mora no banco que X abre. Repare que o filtro sozinho NÃO cobriria o
    // caso geral: `operationBelongsToScope` aceita a op SEM carimbo, de propósito (não perder
    // trabalho de uma migração incompleta), e uma op sem carimbo é contada por todo escopo.
    // É a separação física que fecha essa fresta, e é por isso que as duas metades são
    // load-bearing juntas.
    //
    // O QUE ME FARIA MUDAR DE IDEIA: uma reprovação em que o `count()` da premissa (no helper)
    // esteja verde e ESTAS asserções vermelhas, que seria um defeito no resgate e não na fila;
    // ou a premissa vermelha, que é uma op estranha chegando ao escopo de X, e aí o suspeito é
    // trabalho fire-and-forget do boot, não o carimbo.
    it('op pendente de OUTRO atlas não transforma X em atlas local permanente', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: Y });

        await control._handleLogout({ involuntary: true });
        await remoteApi.purgeAllRemoteAtlases();

        // TESTEMUNHA INDEPENDENTE, e ela vem primeiro porque falha mais perto da causa: o
        // aviso é a metade visível do resgate (`preserveUnsyncedWorkAsLocal` o dispara, e só
        // ele), então a ausência dele diz que o ramo do resgate não correu. Sem esta linha,
        // "não houve adoção" e "houve adoção e a leitura do registro não a viu" produzem a
        // mesma resposta nas duas asserções seguintes.
        expect(toast.showWarning).not.toHaveBeenCalled();
        expect(localApi.listLocalAtlases().map(a => a.dbSuffix)).not.toContain(`remote-${X}`);
        expect(await databaseState(remoteMapsDb(X))).toBe('absent');
    });

    // FECHADO EM E6 (segunda metade, a que faltava), 2026-08-15, promovido de `it.fails`.
    //
    // A PRIMEIRA METADE só tinha consertado a MENSAGEM: o resgate passou a confirmar a adoção por
    // leitura de disco e, falhando, devolvia false, não marcava LOCAL e o usuário lia que NÃO foi
    // possível guardar. O dado continuava condenado, porque ninguém reivindicava o namespace e a
    // varredura seguinte o destruía. Informar a perda é melhor que enganar e não é suficiente.
    //
    // O QUE FECHA, e a razão está escrita no `fileoverview` de `remote-atlas.api.js`: um VETO com
    // prazo. O resgate que falha chama `retainRemoteAtlasForRescue`, a varredura pula o namespace
    // enquanto o veto vale, e o login que o toast de erro pede ainda encontra o trabalho. A
    // exportação de emergência que o plano previa foi REJEITADA: download precisa de gesto do
    // usuário, e esta sessão morreu sem nenhum, possivelmente com a aba em segundo plano.
    //
    // A INJEÇÃO MUDOU DE FORMA, E DE PROPÓSITO. Era `mockRejectedValueOnce`, que derrubava a
    // PRIMEIRA escrita qualquer no banco global e só por acaso era a do registro local. Agora ela
    // mira a chave (o comentário dela sempre disse "a gravação do registro LOCAL falha"), e a
    // diferença é que o resto do caminho continua podendo escrever: sem isso, este caso mediria
    // "a segunda escrita foi bloqueada" em vez do que ele afirma.
    //
    // E POR ISSO O CASO CARREGA CONTROLES DE QUE O RESGATE REALMENTE FALHOU. Sem eles, "o dado
    // sobreviveu" tem DOIS caminhos até o verde: a retenção (o que se quer provar) e uma adoção
    // bem-sucedida, que também deixa o dado vivo, pelo braço `adopted`. Chegar ao mesmo estado por
    // outro caminho é verde-como-defeito, e é a forma que este arquivo já pagou antes.
    it('adoção que falha preserva o trabalho, e o aviso não mente', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });
        // Um atlas de servidor que ninguém vetou: ele tem que morrer na MESMA varredura, senão
        // "a retenção poupou X" e "a varredura não varreu nada" são a mesma resposta.
        await remoteApi.activateRemoteAtlas(Z);
        await semear(ns.remoteScope(Z), SENT_SERVIDOR, { atlas: Z });
        await remoteApi.activateRemoteAtlas(X);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });

        // A gravação do registro LOCAL falha (cota, IDB), e só ela.
        const globalStore = ns.getGlobalStore();
        const escreverDeVerdade = globalStore.setItem.bind(globalStore);
        vi.spyOn(globalStore, 'setItem').mockImplementation(async (chave, valor) => {
            if (ns.isLocalAtlasRegistryKey(chave)) throw new Error('QuotaExceeded');
            return escreverDeVerdade(chave, valor);
        });

        await control._handleLogout({ involuntary: true });
        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        // CONTROLES DE QUE ESTE É O CAMINHO DA FALHA, e vêm primeiro porque falham perto da causa.
        expect(toast.showWarning).not.toHaveBeenCalled();
        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(toast.showError.mock.calls[0][0]).toContain('NÃO foi possível guardar');
        // A mensagem do caso RETIDO, e ela é diferente da do caso perdido logo abaixo.
        expect(toast.showError.mock.calls[0][0]).toContain('por tempo limitado');
        expect(localApi.listLocalAtlases().map(a => a.dbSuffix)).not.toContain(`remote-${X}`);
        // Do DISCO, que é onde o boot seguinte vai olhar: nenhum slot local reivindica X, então
        // o dado NÃO sobrevive pelo braço `adopted`.
        expect((await ns.readLocalAtlasRegistry()).map(e => e.dbSuffix)).not.toContain(`remote-${X}`);
        expect(relatorio.adopted).toEqual([]);
        // O marcador segue REMOTO: marcar LOCAL sobre um namespace que nenhum atlas local
        // reivindica é a mentira que a primeira metade de E6 removeu.
        expect(origem.isRemoteStoreSync()).toBe(true);

        // E O TRABALHO ESTÁ LÁ, retido pelo veto e não por acidente...
        expect(relatorio.retained).toEqual([X]);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });
        // ...na mesma varredura em que o não vetado morre.
        expect(relatorio.atlases).toEqual([Z]);
        expect(await databaseState(remoteMapsDb(Z))).toBe('absent');
    });

    // O SEGUNDO JEITO DE FALHAR, e ele NÃO é o de cima. A adoção pode RESOLVER sem gravar (um
    // store que engole a escrita), e aí quem descobre é o read-back de disco, DEPOIS de
    // `adoptRemoteAtlasAsLocal` já ter removido a chave do registro remoto como último passo.
    //
    // ESTE CASO EXISTE PORQUE O CONTROLE NEGATIVO O EXIGIU. Com só o caso de cima, trocar esta
    // saída por um `return false` seco ficava VERDE: as duas saídas do resgate são caminhos
    // distintos e um teste que só exercita uma delas mede metade. E o que ele encontrou é PIOR
    // que a perda: sem entrada no registro a varredura nem visita o atlas, o veto nunca é
    // consultado e o dado de servidor ficaria no disco para sempre.
    it('adoção que RESOLVE sem chegar ao disco também retém o trabalho', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });

        const globalStore = ns.getGlobalStore();
        const escreverDeVerdade = globalStore.setItem.bind(globalStore);
        vi.spyOn(globalStore, 'setItem').mockImplementation(async (chave, valor) => {
            // Resolve e não grava. A adoção não lança, então só o read-back pega.
            if (ns.isLocalAtlasRegistryKey(chave)) return valor;
            return escreverDeVerdade(chave, valor);
        });

        await control._handleLogout({ involuntary: true });

        // A chave remota SAIU (a adoção chegou até o fim) e o slot local não existe: sem a
        // retenção este namespace não pertenceria a registro nenhum.
        expect((await ns.readLocalAtlasRegistry()).map(e => e.dbSuffix)).not.toContain(`remote-${X}`);
        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(toast.showWarning).not.toHaveBeenCalled();

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([X]);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });
    });

    // O CASO EM QUE A RETENÇÃO NÃO É POSSÍVEL, e ele é o controle negativo da mensagem: sem
    // `localStorage` (modo privado, iframe com storage bloqueado) não há onde gravar o veto, o
    // trabalho realmente depende da aba continuar viva, e o toast volta a dizer isso. Sem este
    // par, "por tempo limitado" seria uma frase fixa que ninguém conferiu contra o que aconteceu,
    // que é exatamente o defeito que a primeira metade de E6 removeu.
    it('sem armazenamento para o veto, a mensagem volta a pedir a aba aberta, e o dado morre', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });

        const globalStore = ns.getGlobalStore();
        const escreverDeVerdade = globalStore.setItem.bind(globalStore);
        vi.spyOn(globalStore, 'setItem').mockImplementation(async (chave, valor) => {
            if (ns.isLocalAtlasRegistryKey(chave)) throw new Error('QuotaExceeded');
            return escreverDeVerdade(chave, valor);
        });

        const guardado = globalThis.localStorage;
        Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true });
        try {
            await control._handleLogout({ involuntary: true });
        } finally {
            Object.defineProperty(globalThis, 'localStorage', { value: guardado, writable: true });
        }

        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(toast.showError.mock.calls[0][0]).toContain('Não feche esta aba');
        expect(toast.showError.mock.calls[0][0]).not.toContain('por tempo limitado');
        // E o aviso é verdadeiro: sem veto, a varredura seguinte leva o trabalho.
        const relatorio = await remoteApi.purgeAllRemoteAtlases();
        expect(relatorio.retained).toEqual([]);
        expect(relatorio.atlases).toEqual([X]);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toBeNull();
    });

    // HIGIENE, E ESTA ETIQUETA É O ACHADO. O controle negativo mostrou que apagar a soltura do
    // veto no caminho de SUCESSO não deixava nada vermelho, e a investigação disse por quê: o
    // expurgo pergunta `claimed` ANTES do veto, então sobre um namespace já adotado o veto não
    // muda desfecho nenhum. Ele é lixo em `localStorage`, não proteção. O caso é alcançável com
    // duas abas no mesmo atlas (uma falha o resgate, a outra o completa), a linha custa uma
    // chamada, e o que este caso afirma é o que ela faz de verdade: não deixar rastro. Chamá-la
    // de invariante seria a mentira que a primeira metade de E6 removeu do toast.
    it('HIGIENE: um resgate que dá certo não deixa veto pendurado', async () => {
        await abaComTrabalhoNaoSincronizado({ opDe: X });
        // Uma tentativa anterior (outra aba, mesmo atlas) que falhou e vetou.
        await remoteApi.retainRemoteAtlasForRescue(X);
        expect(remoteApi.remoteAtlasRescueVetoSince(X)).toBeGreaterThan(0);

        const { preserveUnsyncedWorkAsLocal } = await import('@js/account/account.control.js');
        expect(await preserveUnsyncedWorkAsLocal(X, 'Operação Alfa')).toBe(true);

        expect(localApi.listLocalAtlases().map(a => a.dbSuffix)).toContain(`remote-${X}`);
        expect(remoteApi.remoteAtlasRescueVetoSince(X)).toBe(0);
    });

    // O OUTRO LADO DO MESMO INVARIANTE, e sem ele a correção acima seria uma perda nova: reter
    // sem prazo não ADIA o resíduo, torna-o PERMANENTE, porque o único coletor de dado remoto só
    // roda com ninguém autenticado e `restoreSessionFromStorage` reautentica a cada boot. Foi
    // essa a conclusão de E2, e ela está no `fileoverview` de `remote-atlas.api.js`.
    //
    // O PRAZO LIDO AQUI É A CONSTANTE QUE EMBARCA (`RESCUE_VETO_GRACE_MS`), não um número passado
    // ao expurgo: um caso com `rescueGraceMs: 0` provaria que a opção existe e nada sobre o padrão.
    it('um deslogado não fica com dado de servidor legível para sempre: o veto vence', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });

        const globalStore = ns.getGlobalStore();
        const escreverDeVerdade = globalStore.setItem.bind(globalStore);
        vi.spyOn(globalStore, 'setItem').mockImplementation(async (chave, valor) => {
            if (ns.isLocalAtlasRegistryKey(chave)) throw new Error('QuotaExceeded');
            return escreverDeVerdade(chave, valor);
        });
        await control._handleLogout({ involuntary: true });

        // Boot deslogado dentro do prazo: o dado fica.
        expect((await remoteApi.purgeAllRemoteAtlases()).retained).toEqual([X]);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toEqual({ atlas: X });

        // Um dia e um milissegundo depois, no boot deslogado seguinte.
        const vetadoEm = remoteApi.remoteAtlasRescueVetoSince(X);
        expect(vetadoEm).toBeGreaterThan(0);
        vi.spyOn(Date, 'now').mockReturnValue(vetadoEm + remoteApi.RESCUE_VETO_GRACE_MS + 1);

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.retained).toEqual([]);
        expect(relatorio.atlases).toEqual([X]);
        expect(await readKey(remoteMapsDb(X), SENT_SERVIDOR)).toBeNull();
        expect(remoteApi.remoteAtlasRescueVetoSince(X)).toBe(0);
    });

    // FECHADO EM E6 (segunda metade), 2026-08-15, promovido de `it.fails`. O espelho em
    // memória era escrito ANTES da persistência, então depois de uma escrita recusada ele
    // afirmava um slot que nenhum boot encontraria, apontando para bancos que a varredura
    // seguinte esvazia: a UI listava o resgate e o dado já estava condenado.
    // `adoptRemoteAtlasAsLocal` agora persiste primeiro e espelha depois.
    it('o registro em memória nunca afirma um slot que não chegou ao disco', async () => {
        const control = await abaComTrabalhoNaoSincronizado({ opDe: X });

        vi.spyOn(ns.getGlobalStore(), 'setItem')
            .mockRejectedValueOnce(new Error('QuotaExceeded'));
        await control._handleLogout({ involuntary: true });

        // A CHAVE CERTA. Isto lia `GlobalKey.LOCAL_ATLASES`, o array único que E4 APOSENTOU:
        // `persistRegistry` escreve uma chave POR SLOT (`local_atlas:<id>`), então `emDisco`
        // era sempre null, `sufixosEmDisco` sempre `[]`, e a asserção reprovava EXISTA OU NÃO
        // o defeito. Um `it.fails` nessas condições não policia nada: consertar E6 não o
        // tornaria vermelho, logo ele nunca forçaria a promoção. Era cobertura vazia com
        // aparência de portão, que é a classe que o cabeçalho deste arquivo avisa.
        const globalStore = ns.getGlobalStore();
        const sufixosEmDisco = [];
        for (const chave of await globalStore.keys()) {
            if (!ns.isLocalAtlasRegistryKey(chave)) continue;
            sufixosEmDisco.push((await globalStore.getItem(chave))?.dbSuffix);
        }

        // Controle de leitura: se a varredura não achar chave nenhuma, a comparação abaixo
        // vira "vazio contra vazio" e passaria com o registro inteiro perdido.
        expect(sufixosEmDisco.length).toBeGreaterThan(0);
        expect(localApi.listLocalAtlases().map(a => a.dbSuffix).sort())
            .toEqual(sufixosEmDisco.sort());
    });
});

// =====================================================================================
// GRUPO 6 — importar um `.ebgeo` com um atlas de servidor aberto (ATAQUE 5)
// =====================================================================================

/**
 * A `.ebgeo` imported while a server atlas is open. `clearAllDataStore` empties the mounted
 * scope and marks the store LOCAL, but does not MOVE the scope, so the import writes inside
 * the remote namespace.
 * @returns {Promise<void>}
 */
async function importarComAtlasDeServidorAberto() {
    // `switchToNewLocalAtlas` passa por `clearAllDataStore`, que precisa do container de
    // serviços montado (ele toca o layerManager). É o mesmo boot que os outros grupos usam.
    await iniciarServicos();
    await localApi.initLocalAtlases();
    await remoteApi.activateRemoteAtlas(X);
    await origem.markStoreRemote(X);

    // O IMPORT REAL, e não um `setItem` no escopo ativo. Modelar o import como uma escrita crua
    // era fiel ao código de quando este helper foi escrito, e deixou de ser: o import de
    // `.ebgeo` dentro de um atlas de servidor passou a CRIAR um slot local e TROCAR para ele
    // (`switchToNewLocalAtlas`, o único caminho até um atlas local novo). Um helper que ainda
    // escreve no escopo montado mede o defeito que o produto já não tem, e por isso este caso
    // continuava vermelho depois de a correção existir.
    const { switchToNewLocalAtlas } = await import('@js/account/open-atlas.service.js');
    await switchToNewLocalAtlas('Projeto Importado');

    // E aí sim o import escreve, no escopo que a troca montou.
    await ns.getStore(ns.StoreName.MAPS).setItem(SENT_LOCAL, { origem: 'ebgeo' });
}

/**
 * @param {string} chave - Sentinel key.
 * @returns {Promise<string[]>} Every existing `ebgeo_maps*` database where the sentinel is
 *   readable. Absent databases are never opened, so an empty answer means "nowhere".
 */
async function ondeEstaLegivel(chave) {
    const encontrados = [];
    for (const nome of await listDatabases()) {
        if (!nome.startsWith('ebgeo_maps')) continue;
        if (await vivo(nome, chave)) encontrados.push(nome);
    }
    return encontrados;
}

describe('import .ebgeo sob namespace', () => {
    // VERMELHO SE: `purgeAllRemoteAtlases` vira no-op, ou passa a varrer o slot local também.
    // O controle anterior semeava SÓ o banco legado e concluía "sobreviveu" de um expurgo que
    // não tinha NADA registrado para varrer, isto é, cobertura vazia: ele ficaria verde com o
    // expurgo inteiro comentado. Aqui os dois lados são asseridos na MESMA varredura, o remoto
    // morre e o local sobrevive, então "poupou" e "não varreu" deixam de ser a mesma resposta.
    it('CONTROLE: a varredura é mirada — mata o namespace remoto e poupa o slot local', async () => {
        await localApi.initLocalAtlases();
        await ns.getStore(ns.StoreName.MAPS).setItem(SENT_LOCAL, { origem: 'ebgeo' });
        await remoteApi.activateRemoteAtlas(X);
        await semear(ns.remoteScope(X), SENT_SERVIDOR, { atlas: X });

        expect(await vivo('ebgeo_maps', SENT_LOCAL)).toBe(true);
        expect(await vivo(remoteMapsDb(X), SENT_SERVIDOR)).toBe(true);

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        expect(relatorio.atlases).toEqual([X]);
        expect(await databaseState(remoteMapsDb(X))).toBe('absent');
        expect(await vivo('ebgeo_maps', SENT_LOCAL)).toBe(true);
    });

    // CONTROLE, REESCRITO em 2026-08-15 junto com o helper. Ele afirmava que o projeto importado
    // nasce DENTRO do namespace do atlas de servidor, que era o defeito, e o helper o produzia
    // escrevendo à mão no escopo montado. Hoje o import cria um slot LOCAL e troca para ele
    // (`switchToNewLocalAtlas`), então o "antes" do caso seguinte é outro: o projeto existe, e
    // existe num banco que NÃO é o do servidor.
    //
    // VERMELHO SE: o import voltar a escrever no escopo montado, ou deixar de escrever.
    it('CONTROLE: o projeto importado nasce em um slot LOCAL próprio, fora do namespace do servidor', async () => {
        await importarComAtlasDeServidorAberto();

        const onde = await ondeEstaLegivel(SENT_LOCAL);
        // Existe em algum lugar (senão "sobreviveu" abaixo seria satisfeito por nunca ter havido
        // nada), e esse lugar NÃO é o namespace do atlas de servidor.
        expect(onde).toHaveLength(1);
        expect(onde).not.toContain(remoteMapsDb(X));
        expect(onde[0]).toMatch(/^ebgeo_maps__/);
        // E a origem é LOCAL: a troca de atlas declarou o que montou.
        expect(origem.isRemoteStoreSync()).toBe(false);
    });

    // FECHADO POR E3 + P4, promovido de `it.fails` em 2026-08-15. Era verde-como-defeito porque
    // o import escrevia no escopo montado (o do servidor) e a varredura do logout, derivada do
    // registro remoto, apagava o namespace inteiro e com ele o projeto recém-importado.
    //
    // AO PROMOVER foi preciso consertar o HELPER antes: ele modelava o import como um `setItem`
    // cru no escopo ativo, que é exatamente o que o import deixou de fazer, então o caso
    // continuava vermelho depois de a correção existir. Um teste que modela o mundo antigo não
    // reconhece o conserto.
    it('o projeto importado sobrevive à próxima carga deslogada', async () => {
        await importarComAtlasDeServidorAberto();

        const relatorio = await remoteApi.purgeAllRemoteAtlases();

        // O projeto importado continua legível...
        expect(await ondeEstaLegivel(SENT_LOCAL)).not.toEqual([]);
        // ...e a varredura REALMENTE rodou, senão "sobreviveu" não distingue a correção de uma
        // varredura que não varreu nada.
        expect(relatorio.registered).toContain(X);
        expect(await databaseState(remoteMapsDb(X))).toBe('absent');
    });
});

// =====================================================================================
// GRUPO 7 — o endereço que a chave do tab-lock promete (ATAQUE 4)
//
// The five rows of the owner's rule are asserted in `tests/unit/tab-lock.test.js` (ROW 1 to
// ROW 6), which is the predicate's own file; a third copy here would just be a copy that
// drifts. What belongs here is the one claim the predicate cannot check on its own: whether
// the key a tab holds names the databases the tab actually writes to.
// =====================================================================================

describe('a chave do tab-lock contra o banco realmente montado', () => {
    // VERMELHO SE: `saveLocalToServer` passar a mover o escopo (E3), ou `resolveDbName` mudar o
    // nome que constrói. É a PREMISSA do caso abaixo, e ela é asserida ABSOLUTAMENTE, cada lado
    // contra a string esperada. A versão anterior comparava `resolveDbName(MAPS, escopoLocal)`
    // com ele mesmo: a MESMA expressão dos dois lados de um `expect`, que nenhuma implementação
    // pode reprovar, nem uma que devolvesse `undefined`.
    // REESCRITO POR E3 em 2026-08-15, exatamente como o par anterior mandava. Ele dizia:
    // "quando E3 fechar, a aba A passa a montar `ebgeo_maps__remote-X`, a premissa do controle
    // cai, e o par tem que ser reescrito como endereços diferentes, logo não colidem".
    //
    // Antes de E3, `saveLocalToServer` nunca ativava o namespace: a aba A carregava a chave
    // `remote:X` com o escopo ativo ainda no slot LOCAL, então as duas abas escreviam em
    // `ebgeo_maps` enquanto o predicado as considerava independentes. Era a única combinação
    // que o requisito proíbe. Agora os endereços divergem, e a independência é verdadeira.
    it('CONTROLE: depois do "Enviar ao servidor" as duas abas endereçam bancos DIFERENTES', async () => {
        await correrSaveLocalToServer();
        const slot = localApi.listLocalAtlases()[0];

        // Aba A: a que salvou no servidor, montada no namespace do atlas NOVO.
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope()))
            .toBe(`ebgeo_maps__remote-${X}`);
        // Aba B: parada no slot local, que segue sendo o dela.
        expect(ns.resolveDbName(ns.StoreName.MAPS, localApi.scopeOfLocalAtlas(slot)))
            .toBe('ebgeo_maps');
        // ...e a aba A anuncia um atlas de SERVIDOR, porque a origem foi marcada REMOTE.
        expect(origem.getStoreOriginSync()).toEqual({ kind: 'remote', atlasId: X });
    });

    // O outro lado do mesmo fato, e a razão de o par existir: o predicado agora ACERTA porque
    // os endereços são de fato distintos, não porque foi afrouxado. As duas asserções juntas
    // são o que separa "as abas são independentes" de "o predicado parou de olhar".
    it('duas abas em bancos diferentes NÃO colidem, e é verdade no disco', async () => {
        const lock = await import('@utils/tab-lock.js');
        await correrSaveLocalToServer();
        const slot = localApi.listLocalAtlases()[0];

        expect(lock.keysCollide(lock.remoteAtlasKey(X), lock.localAtlasKey(slot.id))).toBe(false);
        // A independência é verdadeira no ENDEREÇO, que é o que o predicado deveria estar
        // medindo. Sem esta linha, um predicado que devolvesse `false` para tudo passaria.
        expect(ns.resolveDbName(ns.StoreName.MAPS, ns.getActiveScope()))
            .not.toBe(ns.resolveDbName(ns.StoreName.MAPS, localApi.scopeOfLocalAtlas(slot)));
    });
});
