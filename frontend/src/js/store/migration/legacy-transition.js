// Path: js/store/migration/legacy-transition.js
/** Isolate the databases main still knows. Originals are never written by this procedure. */
import {
    ATLAS_RECORD_KEY, GlobalKey, StoreName, StoreScopeKind,
    getGlobalStore, getStoreFor, listAtlasStores, localAtlasRegistryKey, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { generateUUID } from '../../utilities/uuid.js';
import { prepareIsolatedScope } from './prepare-scope.js';
import { fingerprint, sameStorageValue } from './storage-value.js';
import { LEGACY_TRANSITION_KEY, TRANSITION_LOCK, MigrationRecoveryError, readLegacyTransition } from './transition-state.js';

const SOURCE = legacyScope();
const save = state => getGlobalStore().setItem(LEGACY_TRANSITION_KEY, state);

export async function inventoryScope(scope) {
    const inventory = [];
    for (const { id, store } of listAtlasStores(scope)) {
        for (const key of (await store.keys()).sort()) {
            inventory.push([id, key, await fingerprint(await store.getItem(key))]);
        }
    }
    return inventory;
}

function equalInventory(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export async function legacyHasChanged(state = null) {
    state ??= await readLegacyTransition();
    if (!state?.sourceInventory) return false;
    return !equalInventory(state.acknowledgedInventory || state.sourceInventory, await inventoryScope(SOURCE));
}

async function classifySource() {
    const entries = await readLocalAtlasRegistry();
    const existing = entries.find(entry => entry.dbSuffix === '');
    if (entries.filter(entry => entry.dbSuffix === '').length > 1) {
        throw new MigrationRecoveryError('ambiguous_registry', 'Mais de um atlas aponta para os dados antigos. Salve uma cópia para recuperação assistida.');
    }
    const globalOrigin = await getGlobalStore().getItem(GlobalKey.STORE_ORIGIN);
    const legacyOrigin = await getStoreFor(StoreName.SETTINGS, SOURCE).getItem('__store_origin__');
    // An authenticated server snapshot must never become a permanent local copy.
    if (!existing && (legacyOrigin?.kind === StoreScopeKind.REMOTE || globalOrigin?.kind === StoreScopeKind.REMOTE)) {
        return { kind: 'remote' };
    }
    const inventory = await inventoryScope(SOURCE);
    if (inventory.length === 0 && entries.length) return { kind: 'empty' };
    const atlas = await getStoreFor(StoreName.ATLAS, SOURCE).getItem(ATLAS_RECORD_KEY);
    const settings = await getStoreFor(StoreName.SETTINGS, SOURCE).getItem('schemaVersion');
    const version = atlas?.schemaVersion || settings;
    if (!version && inventory.length) {
        throw new MigrationRecoveryError('unknown_version', 'Os dados não têm uma versão identificável. Salve uma cópia para recuperação assistida.');
    }
    if (version != null && (typeof version !== 'string' || !/^\d+\.\d+$/.test(version))) {
        throw new MigrationRecoveryError('unknown_version', 'Não foi possível identificar a versão dos dados.');
    }
    if (version && (Number(version) < 1.3 || Number(version) > 3)) {
        throw new MigrationRecoveryError('unsupported_version', 'Esta versão dos dados precisa de recuperação assistida.');
    }
    const id = existing?.id || generateUUID();
    return {
        kind: 'local', inventory, version,
        entry: existing ? { ...existing, name: atlas?.name || existing.name }
            : { id, name: atlas?.name || 'Meu Atlas', createdAt: Date.now(), updatedAt: Date.now() }
    };
}

async function copyAndCheck(state, onProgress) {
    const destination = localScope(state.entry.id, state.destination);
    for (let i = state.copied || 0; i < state.sourceInventory.length; i++) {
        const [id, key, expected] = state.sourceInventory[i];
        const value = await getStoreFor(id, SOURCE).getItem(key);
        if (await fingerprint(value) !== expected) {
            throw new MigrationRecoveryError('source_changed', 'Os dados antigos mudaram durante a atualização.');
        }
        const target = getStoreFor(id, destination);
        await target.setItem(key, value);
        if (!await sameStorageValue(value, await target.getItem(key))) {
            throw new MigrationRecoveryError('copy_failed', 'A cópia dos dados não passou na verificação.');
        }
        state.copied = i + 1;
        await save(state);
        onProgress?.({ copied: state.copied, total: state.sourceInventory.length });
    }
    if (!equalInventory(state.sourceInventory, await inventoryScope(destination))) {
        throw new MigrationRecoveryError('copy_failed', 'O inventário da cópia diverge dos dados originais.');
    }
    if (await legacyHasChanged(state)) throw new MigrationRecoveryError('source_changed', 'Os dados antigos foram alterados.');
    state.status = 'migrating';
    await save(state);
}

async function migrateDestination(state) {
    const destination = localScope(state.entry.id, state.destination);
    await prepareIsolatedScope(destination, state.entry.name, { empty: state.sourceInventory.length === 0 });
    state.resultInventory = await inventoryScope(destination);
    const landed = new Map(state.resultInventory.map(([id, key, hash]) => [JSON.stringify([id, key]), hash]));
    const unchangedStores = new Set([StoreName.IMAGES, StoreName.STREETVIEW360, StoreName.BRIEFINGS, StoreName.COMMENTS]);
    for (const [id, key, hash] of state.sourceInventory) {
        const found = landed.get(JSON.stringify([id, key]));
        if (!found || (unchangedStores.has(id) && found !== hash)) {
            throw new MigrationRecoveryError('copy_failed', 'Um registro original não foi preservado na cópia atualizada.');
        }
    }
    state.status = 'ready';
    await save(state);
}

async function commitDestination(state) {
    const destination = localScope(state.entry.id, state.destination);
    if (!equalInventory(state.resultInventory, await inventoryScope(destination))) {
        throw new MigrationRecoveryError('copy_failed', 'O destino da atualização mudou antes da ativação.');
    }
    if (await legacyHasChanged(state)) throw new MigrationRecoveryError('source_changed', 'Há alterações nos dados antigos para recuperar.');
    const global = getGlobalStore();
    // The registry entry is the activation commit. If the following writes fail, boot resumes
    // this SAME ready destination; it never starts a second copy over it.
    await global.setItem(localAtlasRegistryKey(state.entry.id), {
        ...state.entry, version: 1, dbSuffix: state.destination, adoptedLegacy: true
    });
    const current = await global.getItem(GlobalKey.CURRENT_LOCAL_ATLAS);
    if (!current) await global.setItem(GlobalKey.CURRENT_LOCAL_ATLAS, state.entry.id);
    if (!await global.getItem(GlobalKey.STORE_ORIGIN)) {
        await global.setItem(GlobalKey.STORE_ORIGIN, { kind: StoreScopeKind.LOCAL, atlasId: null });
    }
    state.status = 'committed';
    await save(state);
    console.info('Atualização local concluída: cópia verificada; origem preservada.');
}

export async function prepareLegacyTransition({ onProgress } = {}) {
    const initial = await readLegacyTransition();
    const classification = initial ? null : await classifySource();
    if (classification?.kind !== 'local' && !initial) return classification;
    if (!globalThis.navigator?.locks?.request) {
        throw new MigrationRecoveryError('lock_unavailable', 'Este navegador não permite coordenar a atualização com segurança. Salve uma cópia de recuperação.');
    }
    return navigator.locks.request(TRANSITION_LOCK, async () => {
        let state = await readLegacyTransition();
        if (!state) {
            const source = await classifySource();
            if (source.kind !== 'local') return source;
            state = {
                version: 1, status: 'copying', entry: source.entry,
                destination: `upgrade-${generateUUID()}`, sourceInventory: source.inventory,
                copied: 0, history: []
            };
            await save(state);
        }
        if (state.status === 'committed') {
            if (await legacyHasChanged(state)) {
                throw new MigrationRecoveryError('legacy_changes', 'Uma janela antiga gravou alterações. Salve uma cópia de recuperação antes de continuar.');
            }
            return { kind: 'ready', state };
        }
        if (state.status === 'copying') await copyAndCheck(state, onProgress);
        if (state.status === 'migrating') await migrateDestination(state);
        if (state.status === 'ready') await commitDestination(state);
        if (state.status !== 'committed') throw new MigrationRecoveryError('unreadable', 'A etapa da atualização não foi reconhecida.');
        return { kind: 'ready', state };
    });
}

export async function restartLegacyCopy() {
    if (!navigator.locks?.request) throw new MigrationRecoveryError('lock_unavailable', 'Coordenação entre janelas indisponível.');
    await navigator.locks.request(TRANSITION_LOCK, async () => {
        const state = await readLegacyTransition();
        if (!state || state.status === 'committed') return;
        // Keep interrupted destinations accessible to the recovery exporter.
        state.history.push(state.destination);
        state.destination = `upgrade-${generateUUID()}`;
        state.sourceInventory = await inventoryScope(SOURCE);
        state.copied = 0;
        state.status = 'copying';
        delete state.resultInventory;
        await save(state);
    });
}
