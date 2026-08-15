import { describe, it, expect, vi } from 'vitest';

// §item9: the origin marker is the explicit, additive separation between data that
// PERSISTS on the machine (local atlas — incl. the logged-out default) and data that
// only lives here TEMPORARILY while connected (a remote server atlas). It must default
// to LOCAL so the offline/standalone user is never affected.
//
// Since the namespace factory landed, WHERE the marker lives is part of the invariant:
// it is read before any scope is active and it decides the scope, so it lives in the
// GLOBAL database, not in the per-atlas app settings. The fake below is keyed by
// database name precisely so those two are distinguishable.

const { dbs, control, makeStore, resetFake } = vi.hoisted(() => {
    const dbs = new Map();
    const control = { failWritesTo: null };

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function backingOf(name, storeName = null) {
        const key = keyOf(name, storeName);
        const existing = dbs.get(key);
        if (existing) return existing;
        const created = new Map();
        dbs.set(key, created);
        return created;
    }

    function makeStore({ name, storeName = null }) {
        const backing = backingOf(name, storeName);
        return {
            setItem: async (k, v) => {
                if (control.failWritesTo === name) throw new Error('QuotaExceeded (simulated)');
                backing.set(k, v);
                return v;
            },
            getItem: async (k) => (backing.has(k) ? backing.get(k) : null),
            removeItem: async (k) => { backing.delete(k); },
            keys: async () => [...backing.keys()],
            clear: async () => { backing.clear(); }
        };
    }

    function resetFake() {
        dbs.clear();
        control.failWritesTo = null;
    }

    return { dbs, control, makeStore, resetFake };
});

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(async () => {})
    }
}));

const GLOBAL_DB = 'ebgeo_global';
const LEGACY_SETTINGS_DB = 'ebgeo_app_settings';
const ORIGIN_KEY = '__store_origin__';

/** Both modules keep module-level state (the instance cache, the in-memory mirror). */
async function loadFresh() {
    vi.resetModules();
    resetFake();
    const namespace = await import('../../src/js/store/atlas-namespace.js');
    const origin = await import('../../src/js/store/store-origin.js');
    return { namespace, origin };
}

/** Writes straight into a fake database, bypassing the module under test. */
function seed(dbName, key, value) {
    const mapKey = `${dbName}::keyvaluepairs`;
    if (!dbs.has(mapKey)) dbs.set(mapKey, new Map());
    dbs.get(mapKey).set(key, value);
}

/** Reads straight from a fake database. */
function read(dbName, key) {
    return dbs.get(`${dbName}::keyvaluepairs`)?.get(key) ?? null;
}

/** @returns {boolean} Whether a database holds the key at all. */
function has(dbName, key) {
    return dbs.get(`${dbName}::keyvaluepairs`)?.has(key) ?? false;
}

/**
 * Mounts a server atlas's namespace, which is the precondition `markStoreRemote` now asserts.
 * It goes through `activateScope(remoteScope(id))` rather than `activateRemoteAtlas` on purpose:
 * this file's subject is the marker, so the registry entry is seeded (or not) BY EACH CASE.
 * @param {Object} namespace - The `atlas-namespace.js` module.
 * @param {string} atlasId
 * @returns {void}
 */
function mountRemote(namespace, atlasId) {
    namespace.activateScope(namespace.remoteScope(atlasId));
}

/** Writes a remote-registry entry straight into the fake global database. */
function seedRemoteEntry(atlasId) {
    seed(GLOBAL_DB, `remote_atlas:${atlasId}`, {
        atlasId, dbSuffix: `remote-${atlasId}`, createdAt: 1, updatedAt: 1, sparedAt: 0
    });
}

/** Writes a local-registry entry straight into the fake global database. */
function seedLocalSlot(id, dbSuffix) {
    seed(GLOBAL_DB, `local_atlas:${id}`, { version: 1, id, name: id, dbSuffix, createdAt: 1, updatedAt: 1 });
}

describe('store-origin marker', () => {
    it('defaults to LOCAL when nothing is persisted (offline user untouched)', async () => {
        const { origin } = await loadFresh();
        await origin.loadStoreOrigin();
        expect(origin.getStoreOriginSync().kind).toBe(origin.StoreOriginKind.LOCAL);
        expect(origin.isRemoteStoreSync()).toBe(false);
    });

    it('markStoreRemote persists the atlas id and survives a reload', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'atlas-123');
        await origin.markStoreRemote('atlas-123');
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync()).toEqual({ kind: 'remote', atlasId: 'atlas-123' });

        await origin.loadStoreOrigin(); // simulate a fresh boot reading the persisted value
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync().atlasId).toBe('atlas-123');
    });

    it('markStoreLocal clears the remote marker', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'atlas-123');
        await origin.markStoreRemote('atlas-123');
        await origin.markStoreLocal();
        expect(origin.isRemoteStoreSync()).toBe(false);
        expect(origin.getStoreOriginSync()).toEqual({ kind: 'local', atlasId: null });
    });

    it('loadStoreOrigin falls back to LOCAL on a malformed persisted value', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { bogus: true }); // no kind field
        await origin.loadStoreOrigin();
        expect(origin.getStoreOriginSync().kind).toBe(origin.StoreOriginKind.LOCAL);
    });
});

// =====================================================================================
// P5 — O MARCADOR NÃO PODE AFIRMAR UMA MONTAGEM QUE NÃO ACONTECEU
// =====================================================================================
//
// `markStoreRemote` era escrita livre: qualquer chamador declarava REMOTE e nada comparava
// aquilo com o que a aba tinha montado. Foi exatamente a forma do defeito do
// `saveLocalToServer` (a origem dizia servidor, o escopo continuava no slot LOCAL, e o pull
// escreveu o snapshot do servidor dentro dos bancos locais, fora de todo registro).
describe('P5: declarar a origem REMOTE exige ter montado aquele namespace', () => {
    it('recusa quando NENHUM escopo está montado', async () => {
        const { namespace, origin } = await loadFresh();
        expect(namespace.getActiveScope()).toBeNull();

        await expect(origin.markStoreRemote('server-1')).rejects.toThrow(/has not mounted/);
        // E não deixou rastro durável: uma recusa que já escreveu não é uma recusa.
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
    });

    it('recusa quando o escopo montado é um slot LOCAL', async () => {
        const { namespace, origin } = await loadFresh();
        namespace.activateScope(namespace.localScope('slot-1', 'aaa'));

        await expect(origin.markStoreRemote('server-1')).rejects.toThrow(/has not mounted/);
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
    });

    it('recusa quando o escopo montado é OUTRO atlas de servidor', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'server-2');

        await expect(origin.markStoreRemote('server-1')).rejects.toThrow(/has not mounted/);
        // O marcador continua descrevendo o atlas realmente montado, nunca o pedido.
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
    });

    // CONTROLE: sem este caso, os três acima passariam com um `markStoreRemote` que recusa
    // SEMPRE, e o portão viraria uma função quebrada com cara de guarda.
    it('CONTROLE: aceita, e persiste, quando o namespace daquele atlas está montado', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'server-1');

        await origin.markStoreRemote('server-1');

        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });
});

// =====================================================================================
// P5 — O PORTÃO: MARCADOR E REGISTRO DISCORDAM, E O REGISTRO VENCE
// =====================================================================================
describe('P5: o marcador é um cache do registro, e o registro vence', () => {
    // A JANELA É REAL E TEM GESTO: `adoptRemoteAtlasAsLocal` move a reivindicação do registro
    // remoto para o local e SÓ ENTÃO o chamador marca LOCAL. A aba fechada no meio (ou uma
    // escrita de marcador recusada por cota) deixa marcador REMOTE sobre um namespace que um
    // slot LOCAL possui. O boot deslogado seguinte varre, não acha entrada remota,
    // `purgeReachedAtlas` responde false, e o segundo wipe cai sobre os bancos sem sufixo:
    // o atlas local do próprio usuário.
    it('um namespace reivindicado por um slot LOCAL derruba o marcador REMOTE (o resgate interrompido)', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-1' });
        seedLocalSlot('slot-resgatado', 'remote-server-1');

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'local', atlasId: null });
        expect(origin.isRemoteStoreSync()).toBe(false);
        // O cache é RECONSTRUÍDO da fonte, não só ignorado nesta leitura.
        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'local', atlasId: null });
    });

    // CONTROLE 1: o registro CONCORDANDO tem de deixar o marcador de pé. Sem ele o caso acima
    // passaria com uma reconciliação que responde LOCAL para tudo, o que apagaria a origem
    // REMOTE de toda sessão viva.
    it('CONTROLE: com a entrada remota no registro, o marcador REMOTE permanece', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-1' });
        seedLocalSlot('slot-1', '');
        seedRemoteEntry('server-1');

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-1' });
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });

    // CONTROLE 2, E ELE GUARDA O INVARIANTE MAIS DURO DA CASA. Numa instalação PRÉ-NAMESPACE
    // não existe registro nenhum, o dado de servidor está nos bancos sem sufixo e o marcador é
    // a ÚNICA prova de que ele está lá. Se a ausência de registro vetasse, o boot deslogado
    // devolveria "LOCAL" e deixaria uma cópia editável e permanente de um atlas de servidor.
    it('CONTROLE: numa instalação SEM registro, a ausência de entrada NÃO derruba o marcador', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-1' });

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-1' });
        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });

    // CONTROLE 3, e é o que separa "um slot local reivindica ESTE namespace" de "existe algum
    // slot local". A segunda leitura foi tentada e derrubou 2 casos da suíte de fixture 2.2: o
    // boot cria um slot local ANTES de a migração reler a origem, então a mesma instalação
    // responde diferente nas duas leituras e o atlas de servidor deixa de ser descartado.
    it('CONTROLE: um slot local que NÃO reivindica este namespace não derruba o marcador', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-1' });
        seedLocalSlot('slot-1', '');
        seedLocalSlot('slot-2', 'outro-slot');

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-1' });
        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });

    // Um marcador REMOTE sem id não nomeia namespace nenhum, então o registro não tem o que
    // dizer sobre ele e o tratamento do guarda de boot fica exatamente como estava.
    it('um marcador REMOTE sem atlasId atravessa intacto', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'remote', atlasId: null });
        seedLocalSlot('slot-1', '');

        expect(await origin.loadStoreOrigin()).toEqual({ kind: 'remote', atlasId: null });
    });
});

describe('store-origin lives in the global database, never in a namespace', () => {
    it('writes the marker to ebgeo_global and to no per-atlas settings database', async () => {
        const { namespace, origin } = await loadFresh();
        // Materialise the local slot's settings database, so the assertion below is about a
        // database that EXISTS and not about one the fake never created.
        namespace.activateScope(namespace.localScope('atlas-a', 'aaa'));
        await namespace.getStore(namespace.StoreName.SETTINGS).setItem('schemaVersion', '2.3');

        mountRemote(namespace, 'server-1');
        await origin.markStoreRemote('server-1');

        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-1' });
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(false);
        expect(has('ebgeo_app_settings__aaa', 'schemaVersion')).toBe(true);
        expect(has('ebgeo_app_settings__aaa', ORIGIN_KEY)).toBe(false);
    });

    it('is readable with NO scope active, which is what lets it decide the scope', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'server-1');
        await origin.markStoreRemote('server-1');

        namespace.clearActiveScope();
        expect(namespace.getActiveScope()).toBeNull();
        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-1' });
    });

    it('survives a switch of local atlas (a per-atlas marker would vanish)', async () => {
        const { namespace, origin } = await loadFresh();
        mountRemote(namespace, 'server-1');
        await origin.markStoreRemote('server-1');

        namespace.activateScope(namespace.localScope('atlas-b', 'bbb'));
        await origin.loadStoreOrigin();

        expect(origin.isRemoteStoreSync()).toBe(true);
        expect(origin.getStoreOriginSync().atlasId).toBe('server-1');
    });
});

describe('store-origin legacy fallback (the upgrade boot)', () => {
    it('reads a REMOTE marker left in the pre-namespace settings database', async () => {
        // The invariant: an installation that upgrades while holding a server atlas must
        // still be seen as REMOTE, or the boot guard keeps that atlas as local data.
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(origin.isRemoteStoreSync()).toBe(true);
    });

    it('promotes the legacy marker to the global database and removes the old copy', async () => {
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });

        await origin.loadStoreOrigin();

        expect(read(GLOBAL_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(false);
    });

    it('keeps the legacy copy when the promotion write fails, and still reports REMOTE', async () => {
        // A failed promotion must never downgrade the boot to LOCAL, and must never delete
        // the only surviving copy of the marker.
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'server-9' });
        control.failWritesTo = GLOBAL_DB;

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'remote', atlasId: 'server-9' });
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
        expect(has(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toBe(true);
    });

    it('prefers the global marker over a stale legacy one', async () => {
        const { origin } = await loadFresh();
        seed(GLOBAL_DB, ORIGIN_KEY, { kind: 'local', atlasId: null });
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { kind: 'remote', atlasId: 'stale' });

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'local', atlasId: null });
        // The stale copy is left alone: only a promotion (global was empty) touches it.
        expect(read(LEGACY_SETTINGS_DB, ORIGIN_KEY)).toEqual({ kind: 'remote', atlasId: 'stale' });
    });

    it('ignores a malformed legacy marker and stays LOCAL', async () => {
        const { origin } = await loadFresh();
        seed(LEGACY_SETTINGS_DB, ORIGIN_KEY, { atlasId: 'x' }); // no kind

        const loaded = await origin.loadStoreOrigin();

        expect(loaded).toEqual({ kind: 'local', atlasId: null });
        expect(has(GLOBAL_DB, ORIGIN_KEY)).toBe(false);
    });
});
