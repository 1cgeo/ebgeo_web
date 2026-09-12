// Path: js/store/migration/recovery-archive.js
import JSZip from 'jszip';
import {
    GlobalKey, StoreName, StoreScopeKind,
    getGlobalStore, getStoreFor, listAtlasStores, localAtlasRegistryKey, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { encodeStorageValue, decodeStorageValue, sameStorageValue, sha256 } from './storage-value.js';
import { inventoryScope } from './legacy-transition.js';
import { LEGACY_TRANSITION_KEY, TRANSITION_LOCK, MigrationRecoveryError, readLegacyTransition } from './transition-state.js';
import { generateUUID } from '../../utilities/uuid.js';
import { prepareIsolatedScope } from './prepare-scope.js';

async function snapshot(scope, label) {
    const before = await inventoryScope(scope);
    const records = [];
    for (const { id, store } of listAtlasStores(scope)) {
        for (const key of (await store.keys()).sort()) records.push({ store: id, key, value: await encodeStorageValue(await store.getItem(key)) });
    }
    if (JSON.stringify(before) !== JSON.stringify(await inventoryScope(scope))) {
        throw new MigrationRecoveryError('source_changed', 'Os dados mudaram durante a cópia. Feche as outras janelas e tente novamente.');
    }
    const item = { label, records, inventory: before };
    verifySnapshot(item);
    return item;
}

function verifySnapshot(item) {
    const hashes = item.records.map(record => [record.store, record.key, sha256(JSON.stringify(record.value))]);
    if (JSON.stringify(hashes) !== JSON.stringify(item.inventory)) throw new Error('O inventário da cópia de recuperação não confere.');
}

export async function buildRecoveryArchive() {
    const entries = await readLocalAtlasRegistry();
    // A damaged journal must not prevent export of the independently registered local data.
    let state = null;
    try { state = await readLegacyTransition(); } catch { /* raw source classification below */ }
    const source = legacyScope();
    const origin = await getStoreFor(StoreName.SETTINGS, source).getItem('__store_origin__')
        || await getGlobalStore().getItem(GlobalKey.STORE_ORIGIN);
    const scopes = [];
    const seen = new Set();
    const add = async (scope, label) => {
        if (seen.has(scope.dbSuffix)) return;
        seen.add(scope.dbSuffix);
        scopes.push(await snapshot(scope, label));
    };
    if (state || entries.some(entry => entry.dbSuffix === '') || origin?.kind !== StoreScopeKind.REMOTE) {
        await add(source, 'Dados da versão antiga');
    }
    for (const entry of entries) await add(localScope(entry.id, entry.dbSuffix), entry.name);
    if (state) {
        for (const suffix of [state.destination, ...(state.history || [])]) {
            await add(localScope(state.entry.id, suffix), 'Cópia da atualização');
        }
    }
    const global = getGlobalStore();
    for (const key of await global.keys()) {
        if (!key.startsWith('recovery_pending:')) continue;
        const entry = await global.getItem(key);
        if (entry?.id && entry.dbSuffix) await add(localScope(entry.id, entry.dbSuffix), entry.name);
    }
    const zip = new JSZip();
    zip.file('recovery.json', JSON.stringify({ format: 'ebgeo-local-recovery', version: 1, scopes }));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function readRecoveryArchive(data) {
    const zip = await JSZip.loadAsync(data instanceof Blob ? await data.arrayBuffer() : data);
    const file = zip.file('recovery.json');
    if (!file) throw new Error('Este arquivo não é uma cópia de recuperação do EBGeo.');
    const archive = JSON.parse(await file.async('string'));
    if (archive.format !== 'ebgeo-local-recovery' || archive.version !== 1 || !Array.isArray(archive.scopes)) {
        throw new Error('Versão da cópia de recuperação não suportada.');
    }
    const allowed = new Set(listAtlasStores(legacyScope()).map(item => item.id));
    for (const item of archive.scopes) {
        if (typeof item.label !== 'string' || !Array.isArray(item.records)) throw new Error('Cópia de recuperação inválida.');
        const keys = new Set();
        for (const record of item.records) {
            if (!allowed.has(record.store) || typeof record.key !== 'string' || !Array.isArray(record.value)) {
                throw new Error('Registro de recuperação inválido.');
            }
            const key = JSON.stringify([record.store, record.key]);
            if (keys.has(key)) throw new Error('A cópia contém registros duplicados.');
            keys.add(key);
            decodeStorageValue(record.value);
        }
        verifySnapshot(item);
    }
    return archive;
}

async function restoreSnapshot(item, { id = generateUUID(), beforeCommit } = {}) {
    verifySnapshot(item);
    const global = getGlobalStore();
    const entries = await readLocalAtlasRegistry();
    if (entries.some(entry => entry.id === id)) return entries.find(entry => entry.id === id);
    if (entries.length >= 10) throw new Error('O limite de atlas locais foi atingido. Salve a cópia de recuperação em arquivo.');
    const entry = { id, dbSuffix: `recovery-${id}`, name: `Recuperado — ${item.label}`,
        createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
    const pendingKey = `recovery_pending:${id}`;
    let pending = await global.getItem(pendingKey);
    if (pending && JSON.stringify(pending.inventory) !== JSON.stringify(item.inventory)) {
        throw new Error('A recuperação pendente pertence a outra cópia. Os dois acervos foram preservados.');
    }
    pending ??= { ...entry, status: 'copying', copied: 0, inventory: item.inventory };
    await global.setItem(pendingKey, pending);
    const scope = localScope(id, entry.dbSuffix);
    if (pending.status === 'copying') {
        for (let i = pending.copied; i < item.records.length; i++) {
            const record = item.records[i];
            const value = decodeStorageValue(record.value);
            const store = getStoreFor(record.store, scope);
            await store.setItem(record.key, value);
            if (!await sameStorageValue(value, await store.getItem(record.key))) throw new Error('Falha ao verificar a cópia restaurada.');
            pending.copied = i + 1;
            await global.setItem(pendingKey, pending);
        }
        if (JSON.stringify(await inventoryScope(scope)) !== JSON.stringify(item.inventory)) throw new Error('A cópia restaurada não confere com o inventário.');
        pending.status = 'migrating';
        await global.setItem(pendingKey, pending);
    }
    await prepareIsolatedScope(scope, entry.name, { empty: item.records.length === 0 });
    await beforeCommit?.();
    await global.setItem(localAtlasRegistryKey(id), entry);
    await global.removeItem(pendingKey);
    return entry;
}

export async function restoreRecoveryArchive(archive, index) {
    if (!navigator.locks?.request) throw new Error('A restauração requer coordenação entre janelas.');
    if (!archive?.scopes?.[index]) throw new Error('Selecione o acervo que deseja recuperar.');
    return navigator.locks.request(TRANSITION_LOCK, () => restoreSnapshot(archive.scopes[index]));
}

export async function recoverLateLegacyChanges() {
    if (!navigator.locks?.request) throw new Error('A recuperação requer coordenação entre janelas.');
    return navigator.locks.request(TRANSITION_LOCK, async () => {
        const state = await readLegacyTransition();
        if (state?.status !== 'committed') throw new Error('Conclua a atualização antes de recuperar alterações tardias.');
        const item = await snapshot(legacyScope(), 'alterações da versão antiga');
        if (!state.recovery) {
            state.recovery = { id: generateUUID(), inventory: item.inventory };
            await getGlobalStore().setItem(LEGACY_TRANSITION_KEY, state);
        }
        if (JSON.stringify(state.recovery.inventory) !== JSON.stringify(item.inventory)) {
            throw new Error('Os dados antigos mudaram novamente. Exporte a cópia de recuperação para preservar todas as versões.');
        }
        const entry = await restoreSnapshot(item, { id: state.recovery.id, beforeCommit: async () => {
            if (JSON.stringify(item.inventory) !== JSON.stringify(await inventoryScope(legacyScope()))) {
                throw new Error('A janela antiga continua gravando. Feche-a e tente novamente.');
            }
        } });
        state.acknowledgedInventory = item.inventory;
        delete state.recovery;
        await getGlobalStore().setItem(LEGACY_TRANSITION_KEY, state);
        return entry;
    });
}
