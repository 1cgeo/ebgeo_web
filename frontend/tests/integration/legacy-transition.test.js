import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { seedDatabase, readKey, readDatabase, resetIndexedDB } from '../helpers/idb-helpers.js';
import { sha256, encodeStorageValue, decodeStorageValue } from '@store/migration/storage-value.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetIndexedDB(); });

async function seed(version = '1.7') {
    await seedDatabase('ebgeo_app_settings', { schemaVersion: version, lastActiveMap: 'Antigo' });
    await seedDatabase('ebgeo_maps', { Antigo: {
        features: { images: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] },
            properties: { id: 'old-image', source: 'image', layerId: 'old-layer', groupId: 'old-group' } }] }
    } });
    await seedDatabase('ebgeo_images', { 'old-image': new Uint8Array([1, 3, 5, 7]) });
    await seedDatabase('ebgeo_layers', { layers_Antigo: [{ id: 'old-layer' }], activeLayer_Antigo: 'old-layer' });
    await seedDatabase('ebgeo_groups', { Antigo: { 'old-group': { id: 'old-group', features: [{ id: 'old-image' }] } } });
}

async function modules() {
    return {
        ns: await import('@store/atlas-namespace.js'),
        transition: await import('@store/migration/legacy-transition.js'),
        state: await import('@store/migration/transition-state.js')
    };
}

it('SHA-256 portable confere com vetores conhecidos', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const large = 'Acervo aéreo 🗺️'.repeat(10000);
    expect(sha256(large)).toBe(createHash('sha256').update(large).digest('hex'));
});

it.each(['1.3', '1.4', '1.5', '1.6', '1.7', '2.0', '2.1', '2.2', '2.3', '2.4', '3.0'])(
    'a entrada histórica %s conserva dados, binários e a origem em três boots', async version => {
        await seed(version);
        await seedDatabase('ebgeo_cesium3d', { cesium3d_Antigo: { cameraPositions: [{ name: 'Visada' }], custom: 42 } });
        const { ns, transition } = await modules();
        const original = await transition.inventoryScope(ns.localScope('original', ''));
        const first = await transition.prepareLegacyTransition();
        const destination = ns.localScope(first.state.entry.id, first.state.destination);
        expect(await ns.getStoreFor(ns.StoreName.SETTINGS, destination).getItem('schemaVersion')).toBe('3.0');
        const map = await ns.getStoreFor(ns.StoreName.MAPS, destination).getItem('Antigo');
        expect(await ns.getStoreFor(ns.StoreName.IMAGES, destination).getItem(map.features.images[0].properties.id))
            .toEqual(new Uint8Array([1, 3, 5, 7]));
        expect(await ns.getStoreFor(ns.StoreName.CESIUM3D, destination).getItem('cesium3d_Antigo'))
            .toMatchObject({ cameraPositions: [{ name: 'Visada' }], custom: 42 });
        vi.resetModules();
        const second = await modules();
        expect((await second.transition.prepareLegacyTransition()).state.destination).toBe(first.state.destination);
        expect((await second.transition.prepareLegacyTransition()).state.destination).toBe(first.state.destination);
        expect(await second.transition.inventoryScope(ns.localScope('original', ''))).toEqual(original);
    });

it('preserva identidade de atlas já adotado e não modifica outros atlas', async () => {
    await seed('1.7');
    await seedDatabase('ebgeo_atlas', { current_atlas: { id: 'old', name: 'Nome próprio', schemaVersion: '3.0' } });
    const { ns, transition } = await modules();
    const adopted = { id: 'adopted', name: 'Nome próprio', dbSuffix: '', version: 1, createdAt: 1, updatedAt: 2 };
    const other = { ...adopted, id: 'other', dbSuffix: 'other', name: 'Outro' };
    await ns.getGlobalStore().setItem(ns.localAtlasRegistryKey(adopted.id), adopted);
    await ns.getGlobalStore().setItem(ns.localAtlasRegistryKey(other.id), other);
    const otherScope = ns.localScope(other.id, other.dbSuffix);
    await ns.getStoreFor(ns.StoreName.MAPS, otherScope).setItem('Intacto', { value: 100 });
    const inventory = await transition.inventoryScope(otherScope);
    const { state } = await transition.prepareLegacyTransition();
    expect(state.entry.id).toBe(adopted.id);
    expect(await ns.readLocalAtlasRegistry()).toHaveLength(2);
    expect(await transition.inventoryScope(otherScope)).toEqual(inventory);
    expect(await ns.getStoreFor(ns.StoreName.SETTINGS, ns.localScope(adopted.id, state.destination)).getItem('schemaVersion')).toBe('3.0');
});

it('origem remota sem reivindicação local não é copiada nem exportada como local', async () => {
    await seed('2.4');
    await seedDatabase('ebgeo_app_settings', { __store_origin__: { kind: 'remote', atlasId: 'server' } });
    const { transition, ns } = await modules();
    const original = await transition.inventoryScope(ns.localScope('original', ''));
    expect(await transition.prepareLegacyTransition()).toEqual({ kind: 'remote' });
    expect(await transition.inventoryScope(ns.localScope('original', ''))).toEqual(original);
    const recovery = await import('@store/migration/recovery-archive.js');
    expect((await recovery.readRecoveryArchive(await recovery.buildRecoveryArchive())).scopes).toHaveLength(0);
});

it('a fila inerte da main continua na origem e não segue para sincronização', async () => {
    await seed();
    const { ns, transition } = await modules();
    const source = ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, ns.UNMOUNTED_QUEUE_SCOPE);
    await source.setItem('op_old', { id: 'old', payload: { value: 7 } });
    const { state } = await transition.prepareLegacyTransition();
    const queue = await import('@store/sync/operation-queue-migration.js');
    expect(await queue.migratePendingOperationsToScopedQueues({ scope: ns.localScope(state.entry.id, state.destination) }))
        .toMatchObject({ moved: 0, kept: 1 });
    expect(await source.getItem('op_old')).toBeTruthy();
    expect(await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, ns.localScope(state.entry.id, state.destination)).keys()).toEqual([]);
});

it('exportação bruta e restauração conservam bytes sem substituir o atlas atualizado', async () => {
    await seed();
    const { ns, transition } = await modules();
    const { state } = await transition.prepareLegacyTransition();
    const destination = ns.localScope(state.entry.id, state.destination);
    const original = await transition.inventoryScope(destination);
    const recovery = await import('@store/migration/recovery-archive.js');
    const archive = await recovery.readRecoveryArchive(await recovery.buildRecoveryArchive());
    const entry = await recovery.restoreRecoveryArchive(archive, 0);
    expect(entry.id).not.toBe(state.entry.id);
    const scope = ns.localScope(entry.id, entry.dbSuffix);
    const map = await ns.getStoreFor(ns.StoreName.MAPS, scope).getItem('Antigo');
    expect(await ns.getStoreFor(ns.StoreName.IMAGES, scope).getItem(map.features.images[0].properties.id))
        .toEqual(new Uint8Array([1, 3, 5, 7]));
    expect(await transition.inventoryScope(destination)).toEqual(original);
});

it('alterações tardias são recuperadas em outro atlas e deixam o próximo boot continuar', async () => {
    await seed();
    const { ns, transition } = await modules();
    const { state } = await transition.prepareLegacyTransition();
    const destination = ns.localScope(state.entry.id, state.destination);
    const original = await transition.inventoryScope(destination);
    await seedDatabase('ebgeo_maps', { Depois: { features: { points: [] } } });
    const { recoverLateLegacyChanges } = await import('@store/migration/recovery-archive.js');
    const entry = await recoverLateLegacyChanges();
    expect(await ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(entry.id, entry.dbSuffix)).getItem('Depois')).toBeTruthy();
    expect(await transition.inventoryScope(destination)).toEqual(original);
    expect(await transition.legacyHasChanged()).toBe(false);
    await expect(transition.prepareLegacyTransition()).resolves.toHaveProperty('kind', 'ready');
});

it.each(['before', 'after'])('quota %s da gravação inicial preserva o acervo e permite retomar', async when => {
    await seed();
    const { ns, transition, state } = await modules();
    const original = await transition.inventoryScope(ns.localScope('original', ''));
    const global = ns.getGlobalStore();
    await global.ready();
    const write = global.setItem.bind(global);
    let fault = false;
    vi.spyOn(global, 'setItem').mockImplementation(async (key, value) => {
        if (key === state.LEGACY_TRANSITION_KEY && !fault) {
            fault = true;
            if (when === 'after') await write(key, value);
            throw new DOMException('Sem espaço', 'QuotaExceededError');
        }
        return write(key, value);
    });
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await ns.readLocalAtlasRegistry()).toHaveLength(0);
    expect(await transition.inventoryScope(ns.localScope('original', ''))).toEqual(original);
    vi.restoreAllMocks(); vi.resetModules();
    await expect((await modules()).transition.prepareLegacyTransition()).resolves.toHaveProperty('kind', 'ready');
});

it('sem coordenação segura a migração bloqueia e a cópia de recuperação continua disponível', async () => {
    await seed();
    vi.stubGlobal('navigator', { locks: undefined });
    const { transition, state } = await modules();
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'lock_unavailable' });
    expect(await state.readLegacyTransition()).toBeNull();
    const recovery = await import('@store/migration/recovery-archive.js');
    const archive = await recovery.readRecoveryArchive(await recovery.buildRecoveryArchive());
    expect(archive.scopes[0].records.length).toBeGreaterThan(4);
});

it('recuperacao conserva binarios, tipos e propriedades que parecem marcadores', async () => {
    const input = { binary: new Blob([new Uint8Array([5, 6])], { type: 'image/png' }),
        array: new Uint16Array([300, 600]), undefined, tag: 'binary', date: new Date(0) };
    const output = decodeStorageValue(await encodeStorageValue(input));
    expect(await output.binary.arrayBuffer()).toEqual(await input.binary.arrayBuffer());
    expect(output.binary.type).toBe('image/png');
    expect(output.array).toEqual(input.array);
    expect(output.date).toEqual(input.date);
    expect(output.tag).toBe('binary');
    expect(Object.hasOwn(output, 'undefined')).toBe(true);
});

it('migra para outro endereco preservando a origem e as associacoes', async () => {
    await seed();
    const { ns, transition } = await modules();
    const original = await transition.inventoryScope(ns.localScope('source', ''));
    const { state } = await transition.prepareLegacyTransition();
    expect(state.status).toBe('committed');
    expect(state.destination).not.toBe('');
    expect(await transition.inventoryScope(ns.localScope('source', ''))).toEqual(original);
    const scope = ns.localScope(state.entry.id, state.destination);
    const map = await ns.getStoreFor(ns.StoreName.MAPS, scope).getItem('Antigo');
    const feature = map.features.images[0];
    expect(await ns.getStoreFor(ns.StoreName.IMAGES, scope).getItem(feature.properties.id)).toEqual(new Uint8Array([1, 3, 5, 7]));
    expect((await ns.getStoreFor(ns.StoreName.LAYERS, scope).getItem('layers_Antigo'))[0].id).toBe(feature.properties.layerId);
    expect(await ns.getStoreFor(ns.StoreName.LAYERS, scope).getItem('activeLayer_Antigo')).toBe(feature.properties.layerId);
    expect((await ns.getStoreFor(ns.StoreName.GROUPS, scope).getItem('Antigo'))[feature.properties.groupId].features[0].id).toBe(feature.properties.id);
    expect((await transition.prepareLegacyTransition()).state.destination).toBe(state.destination);
    expect(await readKey('ebgeo_app_settings', 'schemaVersion')).toBe('1.7');
});

it('falha na gravacao do registro nao ativa copia parcial e retoma o mesmo destino', async () => {
    await seed();
    const { ns, transition, state } = await modules();
    const global = ns.getGlobalStore();
    await global.ready();
    const write = global.setItem.bind(global);
    vi.spyOn(global, 'setItem').mockImplementation(async (key, value) => {
        if (ns.isLocalAtlasRegistryKey(key)) throw new Error('quota');
        return write(key, value);
    });
    await expect(transition.prepareLegacyTransition()).rejects.toThrow('quota');
    const pending = await state.readLegacyTransition();
    expect(pending.status).toBe('ready');
    expect(await ns.readLocalAtlasRegistry()).toEqual([]);
    vi.restoreAllMocks();
    vi.resetModules();
    const fresh = await modules();
    expect((await fresh.transition.prepareLegacyTransition()).state.destination).toBe(pending.destination);
    expect(await fresh.ns.readLocalAtlasRegistry()).toHaveLength(1);
});

it('falha no mapa durante o degrau retoma com os mesmos ids do plano', async () => {
    await seed();
    let injected = false;
    const m = await modules();
    const global = m.ns.getGlobalStore();
    await global.ready();
    const write = global.setItem.bind(global);
    vi.spyOn(global, 'setItem').mockImplementation(async (key, value) => {
        await write(key, value);
        if (key === m.state.LEGACY_TRANSITION_KEY && value.status === 'migrating' && !injected) {
            injected = true;
            const maps = m.ns.getStoreFor(m.ns.StoreName.MAPS, m.ns.localScope(value.entry.id, value.destination));
            await maps.ready();
            vi.spyOn(maps, 'setItem').mockRejectedValueOnce(new Error('disk'));
        }
        return value;
    });
    await expect(m.transition.prepareLegacyTransition()).rejects.toThrow('disk');
    const pending = await m.state.readLegacyTransition();
    const scope = m.ns.localScope(pending.entry.id, pending.destination);
    const plan = await m.ns.getStoreFor(m.ns.StoreName.SETTINGS, scope).getItem('__migration_v2_plan__');
    expect(plan.images).toHaveLength(1);
    vi.restoreAllMocks(); vi.resetModules();
    const fresh = await modules();
    await fresh.transition.prepareLegacyTransition();
    const map = await fresh.ns.getStoreFor(fresh.ns.StoreName.MAPS, scope).getItem('Antigo');
    expect(map.features.images[0].properties.id).toBe(plan.images[0][1]);
    expect(await readKey('ebgeo_app_settings', 'schemaVersion')).toBe('1.7');
});

it('aba antiga que volta nao sobrescreve o destino e gera recuperacao explicita', async () => {
    await seed('2.4');
    const { transition, ns } = await modules();
    const { state } = await transition.prepareLegacyTransition();
    const scope = ns.localScope(state.entry.id, state.destination);
    const destination = await transition.inventoryScope(scope);
    await seedDatabase('ebgeo_maps', { Depois: { features: { points: [] } } });
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'legacy_changes' });
    expect(await transition.inventoryScope(scope)).toEqual(destination);
    expect(await readKey('ebgeo_maps', 'Depois')).toBeTruthy();
});

it('dois boots convergem para uma copia e uma entrada no registro', async () => {
    await seed('2.4');
    const { transition, ns } = await modules();
    const [first, second] = await Promise.all([transition.prepareLegacyTransition(), transition.prepareLegacyTransition()]);
    expect(first.state.destination).toBe(second.state.destination);
    expect(await ns.readLocalAtlasRegistry()).toHaveLength(1);
});

it('instalacao nova nasce isolada sem escrever bancos da main', async () => {
    const { transition, ns } = await modules();
    const { state } = await transition.prepareLegacyTransition();
    expect(state.destination).not.toBe('');
    expect(await readDatabase('ebgeo_maps')).toEqual({});
    expect(await ns.readLocalAtlasRegistry()).toHaveLength(1);
});

it('versao sem suporte preserva dados e nao cria uma transicao', async () => {
    await seed('1.2');
    const { transition, state } = await modules();
    await expect(transition.prepareLegacyTransition()).rejects.toMatchObject({ code: 'unsupported_version' });
    expect(await state.readLegacyTransition()).toBeNull();
    expect(await readKey('ebgeo_maps', 'Antigo')).toBeTruthy();
});

it('interrupção antes e depois de CADA gravação converge sem perder dados ou associações', async () => {
    async function exercise(stop = Infinity, after = false) {
        vi.restoreAllMocks(); vi.resetModules(); await resetIndexedDB(); await seed();
        const { ns, transition, state } = await modules();
        const original = await transition.inventoryScope(ns.localScope('original', ''));
        const global = ns.getGlobalStore();
        await global.ready();
        let writes = 0;
        let watched = false;
        const intercept = (store, beforeWrite) => {
            const write = store.setItem.bind(store);
            vi.spyOn(store, 'setItem').mockImplementation(async (key, value) => {
                await beforeWrite?.(key, value);
                writes++;
                if (writes === stop && !after) throw new Error('interruption');
                const result = await write(key, value);
                if (writes === stop && after) throw new Error('interruption');
                return result;
            });
        };
        intercept(global, async (key, value) => {
            if (watched || key !== state.LEGACY_TRANSITION_KEY) return;
            watched = true;
            for (const { store } of ns.listAtlasStores(ns.localScope(value.entry.id, value.destination))) {
                await store.ready();
                intercept(store);
            }
        });
        if (Number.isFinite(stop)) await expect(transition.prepareLegacyTransition()).rejects.toThrow('interruption');
        else await transition.prepareLegacyTransition();
        const count = writes;
        vi.restoreAllMocks(); vi.resetModules();
        const fresh = await modules();
        const { state: completed } = await fresh.transition.prepareLegacyTransition();
        const scope = fresh.ns.localScope(completed.entry.id, completed.destination);
        const store = id => fresh.ns.getStoreFor(id, scope);
        const map = await store(fresh.ns.StoreName.MAPS).getItem('Antigo');
        const feature = map.features.images[0].properties;
        expect(await store(fresh.ns.StoreName.IMAGES).getItem(feature.id)).toEqual(new Uint8Array([1, 3, 5, 7]));
        expect((await store(fresh.ns.StoreName.LAYERS).getItem('layers_Antigo'))[0].id).toBe(feature.layerId);
        expect((await store(fresh.ns.StoreName.GROUPS).getItem('Antigo'))[feature.groupId].features[0].id).toBe(feature.id);
        expect(await fresh.ns.readLocalAtlasRegistry()).toHaveLength(1);
        expect(await fresh.transition.inventoryScope(ns.localScope('original', ''))).toEqual(original);
        expect(fresh.ns.getActiveScope()).toBeNull();
        return count;
    }
    const count = await exercise();
    expect(count).toBeGreaterThan(20);
    console.info(`Interrupções verificadas: ${count} gravações, antes e depois (${count * 2} cenários).`);
    for (let boundary = 1; boundary <= count; boundary++) {
        await exercise(boundary, false);
        await exercise(boundary, true);
    }
}, 60000);

it('preparação e recuperação não mudam o atlas que a aba já tinha escolhido', async () => {
    await seed();
    const { ns, transition } = await modules();
    const scope = ns.localScope('another', 'another');
    ns.activateScope(scope);
    await transition.prepareLegacyTransition();
    expect(ns.getActiveScope()).toEqual(scope);
    const recovery = await import('@store/migration/recovery-archive.js');
    const archive = await recovery.readRecoveryArchive(await recovery.buildRecoveryArchive());
    await recovery.restoreRecoveryArchive(archive, 0);
    expect(ns.getActiveScope()).toEqual(scope);
});

it('recuperação tardia interrompida retoma o mesmo plano sem recobrir os mapas migrados com dados crus', async () => {
    await seed();
    const { ns, transition, state } = await modules();
    await transition.prepareLegacyTransition();
    await seedDatabase('ebgeo_maps', { Depois: { features: { points: [] } } });
    const global = ns.getGlobalStore();
    await global.ready();
    const write = global.setItem.bind(global);
    let interrupted = false;
    vi.spyOn(global, 'setItem').mockImplementation(async (key, value) => {
        await write(key, value);
        if (!interrupted && key.startsWith('recovery_pending:') && value.status === 'migrating') {
            interrupted = true;
            const maps = ns.getStoreFor(ns.StoreName.MAPS, ns.localScope(value.id, value.dbSuffix));
            await maps.ready();
            vi.spyOn(maps, 'setItem').mockRejectedValueOnce(new Error('interruption'));
        }
        return value;
    });
    const recovery = await import('@store/migration/recovery-archive.js');
    await expect(recovery.recoverLateLegacyChanges()).rejects.toThrow('interruption');
    const pending = await state.readLegacyTransition();
    vi.restoreAllMocks(); vi.resetModules();
    const fresh = await modules();
    const entry = await (await import('@store/migration/recovery-archive.js')).recoverLateLegacyChanges();
    expect(entry.id).toBe(pending.recovery.id);
    const scope = fresh.ns.localScope(entry.id, entry.dbSuffix);
    const map = await fresh.ns.getStoreFor(fresh.ns.StoreName.MAPS, scope).getItem('Antigo');
    expect(await fresh.ns.getStoreFor(fresh.ns.StoreName.IMAGES, scope).getItem(map.features.images[0].properties.id))
        .toEqual(new Uint8Array([1, 3, 5, 7]));
    expect(await fresh.ns.readLocalAtlasRegistry()).toHaveLength(2);
    expect(await fresh.transition.legacyHasChanged()).toBe(false);
});
