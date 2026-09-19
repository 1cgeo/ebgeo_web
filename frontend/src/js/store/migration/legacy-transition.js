// Path: js/store/migration/legacy-transition.js
/** Isolate the databases main still knows. Originals are never written by this procedure. */
import {
    ATLAS_RECORD_KEY, GlobalKey, StoreName, StoreScopeKind,
    getGlobalStore, getStoreFor, listAtlasStores, localAtlasRegistryKey, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { generateUUID } from '../../utilities/uuid.js';
import { compareVersions, MIN_SCHEMA_VERSION } from '../repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { prepareIsolatedScope } from './prepare-scope.js';
import { fingerprint, sameStorageValue } from './storage-value.js';
import {
    LEGACY_TRANSITION_KEY, TRANSITION_LOCK, MigrationRecoveryError,
    TransitionStatus, readLegacyTransition, transitionIsSettled
} from './transition-state.js';

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
    // A DELETION IN FLIGHT IS NOT A CHANGE TO RECOVER. While the drop runs, the journal still
    // carries the inventory of an acervo that is being emptied on purpose, and comparing it
    // would put the "recover the old changes" screen in front of the user who asked for the
    // opposite. Once the drop COMMITS, the comparison comes back and is worth having: the
    // journal's inventory is emptied with the databases, so a legacy tab that writes again
    // shows up here as a real change, which is exactly what it is.
    if (state.status === TransitionStatus.DROPPING_SOURCE) return false;
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
    for (const marker of [settings, atlas?.schemaVersion]) {
        if (marker == null) continue;
        if (typeof marker !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(marker)) {
            throw new MigrationRecoveryError('unknown_version', 'Não foi possível identificar a versão dos dados.');
        }
        if (compareVersions(marker, MIN_SCHEMA_VERSION) < 0 || compareVersions(marker, ATLAS_SCHEMA_VERSION) > 0) {
            throw new MigrationRecoveryError('unsupported_version', 'Esta versão dos dados precisa de recuperação assistida.');
        }
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
    state.status = TransitionStatus.MIGRATING;
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
    state.status = TransitionStatus.READY;
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
    state.status = TransitionStatus.COMMITTED;
    await save(state);
    console.info('Atualização local concluída: cópia verificada; origem preservada.');
}

export async function prepareLegacyTransition({ onProgress } = {}) {
    const initial = await readLegacyTransition();
    const classification = initial ? null : await classifySource();
    if (classification?.kind !== 'local' && !initial) return classification;
    if (!globalThis.navigator?.locks?.request) {
        // SEM WEB LOCKS, INTERROMPER SÓ FAZ SENTIDO SE HÁ O QUE PERDER.
        //
        // `navigator.locks` exige CONTEXTO SEGURO: existe em `localhost` e em HTTPS, e não
        // existe numa origem `http://<ip>:<porta>`, que é como o EBGeo é aberto de outra
        // máquina da rede interna. Até 2026-09-16 a ausência da API interrompia o boot de
        // QUALQUER pessoa nessa origem, inclusive de quem nunca tinha aberto o produto: a
        // instalação nova é classificada como `local` com inventário ZERO (a guarda de escopo
        // vazio em `classifySource` pede também um registro que ela ainda não tem), e a pessoa
        // recebia a tela de recuperação com um pacote de zero registros para salvar. O relato e
        // o `.zip` medido (`records: []`, `inventory: []`) são de 2026-09-16.
        //
        // O QUE O LOCK PROTEGE é a cópia concorrente: duas abas copiando o mesmo acervo para
        // dois destinos, e o `dois boots convergem para uma copia` que mede isso. Com inventário
        // vazio não há cópia, e o que resta é a criação do slot, que `commitDestination` já
        // resolve por registro. Então o portão segue sem lock NESSE caso, e continua parando no
        // outro, que é onde há dado de alguém em jogo.
        const nadaACopiar = !initial && classification?.kind === 'local'
            && classification.inventory.length === 0;
        if (!nadaACopiar) {
            throw new MigrationRecoveryError('lock_unavailable', 'Este navegador não permite coordenar a atualização com segurança. Salve uma cópia de recuperação.');
        }
        return semLock(classification, onProgress);
    }
    return navigator.locks.request(TRANSITION_LOCK, async () => {
        let state = await readLegacyTransition();
        if (!state) {
            const source = await classifySource();
            if (source.kind !== 'local') return source;
            state = {
                version: 1, status: TransitionStatus.COPYING, entry: source.entry,
                destination: `upgrade-${generateUUID()}`, sourceInventory: source.inventory,
                copied: 0, history: []
            };
            await save(state);
        }
        if (transitionIsSettled(state)) {
            if (await legacyHasChanged(state)) {
                throw new MigrationRecoveryError('legacy_changes', 'Uma janela antiga gravou alterações. Salve uma cópia de recuperação antes de continuar.');
            }
            return { kind: 'ready', state };
        }
        if (state.status === TransitionStatus.COPYING) await copyAndCheck(state, onProgress);
        if (state.status === TransitionStatus.MIGRATING) await migrateDestination(state);
        if (state.status === TransitionStatus.READY) await commitDestination(state);
        if (!transitionIsSettled(state)) throw new MigrationRecoveryError('unreadable', 'A etapa da atualização não foi reconhecida.');
        return { kind: 'ready', state };
    });
}

/**
 * A MESMA sequência do corpo do lock, para o único caso em que ele não é necessário: instalação
 * nova, inventário vazio, navegador sem Web Locks. Ela é extraída em vez de duplicada para que
 * um passo novo no fluxo não entre só de um lado.
 * @param {Object} classification - O veredito de `classifySource`, com `kind: 'local'`.
 * @param {Function} [onProgress] - Relatório de progresso da cópia.
 * @returns {Promise<Object>}
 */
async function semLock(classification, onProgress) {
    const state = {
        version: 1, status: TransitionStatus.COPYING, entry: classification.entry,
        destination: `upgrade-${generateUUID()}`, sourceInventory: classification.inventory,
        copied: 0, history: []
    };
    await save(state);
    if (state.status === TransitionStatus.COPYING) await copyAndCheck(state, onProgress);
    if (state.status === TransitionStatus.MIGRATING) await migrateDestination(state);
    if (state.status === TransitionStatus.READY) await commitDestination(state);
    if (!transitionIsSettled(state)) throw new MigrationRecoveryError('unreadable', 'A etapa da atualização não foi reconhecida.');
    return { kind: 'ready', state };
}

export async function restartLegacyCopy() {
    if (!navigator.locks?.request) throw new MigrationRecoveryError('lock_unavailable', 'Coordenação entre janelas indisponível.');
    await navigator.locks.request(TRANSITION_LOCK, async () => {
        const state = await readLegacyTransition();
        if (!state || transitionIsSettled(state)) return;
        // Keep interrupted destinations accessible to the recovery exporter.
        state.history.push(state.destination);
        state.destination = `upgrade-${generateUUID()}`;
        state.sourceInventory = await inventoryScope(SOURCE);
        state.copied = 0;
        state.status = TransitionStatus.COPYING;
        delete state.resultInventory;
        await save(state);
    });
}
