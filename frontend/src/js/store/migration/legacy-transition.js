// Path: js/store/migration/legacy-transition.js
/** Isolate the databases main still knows. Originals are never written by this procedure. */
import {
    ATLAS_RECORD_KEY, GlobalKey, StoreName, StoreScopeKind, atlasMountLockName,
    getGlobalStore, getStoreFor, listAtlasStores, localAtlasRegistryKey, localScope, readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { legacyScope } from './migration-scope.js';
import { generateUUID } from '../../utilities/uuid.js';
import { otherClientHoldsLock } from '../../utilities/tab-lock.js';
import { compareVersions, MIN_SCHEMA_VERSION } from '../repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';
import { prepareIsolatedScope } from './prepare-scope.js';
import { fingerprint, sameStorageValue } from './storage-value.js';
import { LATE_RULE_VERSION, LateOutcome, planLateLegacyChanges } from './late-legacy-plan.js';
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
            if (state.late || await legacyHasChanged(state)) {
                const late = await absorbLateLegacyChanges(state);
                if (late.outcome === LateResult.CONFLICT) {
                    throw new MigrationRecoveryError('legacy_changes', 'Uma janela antiga gravou alterações. Salve uma cópia de recuperação antes de continuar.');
                }
                return { kind: 'ready', state, late };
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

/**
 * What an attempt to absorb the late legacy changes ended in.
 *
 * `DEFERRED` is not a failure: the destination is mounted by a live tab (possibly this one), and
 * writing under a running editor would be undone by its next save of the same map, with the
 * journal already saying the change was absorbed. The next check with nobody mounted does it.
 */
export const LateResult = Object.freeze({
    ABSORBED: 'absorbed',
    NOTHING: 'nothing',
    DEFERRED: 'deferred',
    CONFLICT: 'conflict'
});

/** Statuses of `state.late`, the journal of ONE absorption in flight. */
const LateStatus = Object.freeze({ COPYING: 'copying', APPLYING: 'applying' });

/**
 * Copies the legacy acervo into a staging scope, checking each record against the inventory it
 * was listed with.
 * @param {Object} scope - Staging scope.
 * @param {Array} inventory - Legacy inventory taken just before.
 * @returns {Promise<boolean>} False when the legacy acervo changed during the copy.
 */
async function copyLegacyInto(scope, inventory) {
    for (const [id, key, expected] of inventory) {
        const value = await getStoreFor(id, SOURCE).getItem(key);
        if (await fingerprint(value) !== expected) return false;
        const target = getStoreFor(id, scope);
        await target.setItem(key, value);
        if (!await sameStorageValue(value, await target.getItem(key))) {
            throw new MigrationRecoveryError('copy_failed', 'A cópia dos dados não passou na verificação.');
        }
    }
    return equalInventory(inventory, await inventoryScope(scope));
}

/**
 * @param {Object} scope
 * @returns {Promise<Array<{ key: string, id?: string, name?: string }>>} Every address of every map.
 */
async function mapAddresses(scope) {
    const maps = [];
    await getStoreFor(StoreName.MAPS, scope).iterate((map, key) => { maps.push({ key, id: map?.id, name: map?.name }); });
    return maps;
}

/**
 * The inventory the destination must have after a plan, derived from the snapshot the plan was
 * made on. Compared as a set because `inventoryScope` orders by store and key, and a derived list
 * would have to reproduce that order to be comparable.
 * @param {Object} late - `state.late` at `APPLYING`.
 * @returns {Map<string, string>}
 */
function expectedAfterPlan({ destinationBefore, staged, writes, deletes }) {
    const expected = new Map(destinationBefore.map(([id, key, hash]) => [JSON.stringify([id, key]), hash]));
    const stagedHash = new Map(staged.map(([id, key, hash]) => [JSON.stringify([id, key]), hash]));
    for (const [id, key] of writes) expected.set(JSON.stringify([id, key]), stagedHash.get(JSON.stringify([id, key])));
    for (const [id, key] of deletes) expected.delete(JSON.stringify([id, key]));
    return expected;
}

/**
 * @param {Array} inventory
 * @param {Map<string, string>} expected
 * @returns {boolean}
 */
function inventoryMatches(inventory, expected) {
    return inventory.length === expected.size
        && inventory.every(([id, key, hash]) => expected.get(JSON.stringify([id, key])) === hash);
}

/**
 * Sends a staging address to the history, where `pruneAbandonedCopies` collects it.
 * @param {Object} state
 * @param {string} staging
 */
function retireStaging(state, staging) {
    if (staging && !state.history.includes(staging)) state.history.push(staging);
}

/**
 * Brings into the adopted atlas what the previous product line wrote after the transition, when
 * nothing can be lost by doing so. The rule is `planLateLegacyChanges`; this is the part that
 * touches disk.
 *
 * THE DESTINATION IS WRITTEN IN PLACE, and only after the plan is on the journal. A crash in the
 * middle leaves `state.late` at `APPLYING` with the plan, the staging scope and the snapshot the
 * plan was made on, and the next call re-applies the same writes, which are idempotent. The
 * staging scope enters the history only when the absorption is complete, so the sweep cannot
 * collect it while a plan still reads from it.
 *
 * A CONFLICT IS REMEMBERED with the two inventories it was decided on, so a boot that finds the
 * same two acervos answers from the journal instead of copying and migrating the whole legacy
 * acervo again. The memory carries the version of the rule that decided it (`LATE_RULE_VERSION`),
 * and a conflict decided by an older rule is decided again: the first version of this rule
 * refused a case it should have taken, and every browser that met it remembered the refusal.
 *
 * Runs under `TRANSITION_LOCK`; the caller holds it.
 *
 * @param {Object} state - Journal record, settled.
 * @returns {Promise<{ outcome: string, reason?: string, records?: number }>}
 */
async function absorbLateLegacyChanges(state) {
    // Only a live copy of a still-whole origin has the base this rule needs: after an ordered
    // deletion the origin's inventories are emptied, and an empty base would read the whole
    // migrated atlas as "removed by the old version".
    if (state.status !== TransitionStatus.COMMITTED || !Array.isArray(state.resultInventory)) {
        return { outcome: LateResult.CONFLICT, reason: 'not_absorbable' };
    }
    // `null` (the runtime cannot tell) defers too: guessing "free" is the one wrong answer.
    if (await otherClientHoldsLock(globalThis.navigator?.locks, atlasMountLockName(state.destination), 0) !== false) {
        return { outcome: LateResult.DEFERRED };
    }
    const destination = localScope(state.entry.id, state.destination);
    if (state.late?.status === LateStatus.APPLYING) return applyLatePlan(state, destination);
    if (state.late) {
        // A copy interrupted before any decision: nothing was written to the destination.
        retireStaging(state, state.late.staging);
        delete state.late;
        await save(state);
    }

    const rawNow = await inventoryScope(SOURCE);
    const destinationNow = await inventoryScope(destination);
    const known = state.lateConflict;
    if (known?.rule === LATE_RULE_VERSION
        && equalInventory(known.legacy, rawNow) && equalInventory(known.destination, destinationNow)) {
        return { outcome: LateResult.CONFLICT, reason: known.reason };
    }

    const staging = `upgrade-${generateUUID()}`;
    state.late = { status: LateStatus.COPYING, staging };
    await save(state);
    const stagingScope = localScope(state.entry.id, staging);
    if (!await copyLegacyInto(stagingScope, rawNow)) {
        retireStaging(state, staging);
        delete state.late;
        await save(state);
        return { outcome: LateResult.CONFLICT, reason: 'source_changed' };
    }
    await prepareIsolatedScope(stagingScope, state.entry.name, { empty: rawNow.length === 0 });
    const staged = await inventoryScope(stagingScope);
    const base = state.lateBase
        ?? { raw: state.sourceInventory, migrated: state.resultInventory, destination: state.resultInventory };
    const plan = planLateLegacyChanges({
        migratedBase: base.migrated, staged, destinationBase: base.destination, destination: destinationNow,
        rawBase: base.raw, rawNow, maps: [...await mapAddresses(stagingScope), ...await mapAddresses(destination)]
    });
    if (plan.outcome === LateOutcome.CONFLICT) {
        retireStaging(state, staging);
        delete state.late;
        state.lateConflict = { rule: LATE_RULE_VERSION, reason: plan.reason, legacy: rawNow, destination: destinationNow };
        await save(state);
        return { outcome: LateResult.CONFLICT, reason: plan.reason };
    }
    state.late = {
        status: LateStatus.APPLYING, staging, source: rawNow, staged,
        destinationBefore: destinationNow, writes: plan.writes, deletes: plan.deletes
    };
    await save(state);
    return applyLatePlan(state, destination);
}

/**
 * Applies the plan on the journal to the destination and moves both bases forward.
 * @param {Object} state - Journal record with `late` at `APPLYING`.
 * @param {Object} destination - Destination scope.
 * @returns {Promise<{ outcome: string, records: number }>}
 */
async function applyLatePlan(state, destination) {
    const late = state.late;
    const stagingScope = localScope(state.entry.id, late.staging);
    for (const [id, key] of late.writes) {
        const value = await getStoreFor(id, stagingScope).getItem(key);
        const target = getStoreFor(id, destination);
        await target.setItem(key, value);
        if (!await sameStorageValue(value, await target.getItem(key))) {
            throw new MigrationRecoveryError('copy_failed', 'A incorporação das alterações antigas não passou na verificação.');
        }
    }
    for (const [id, key] of late.deletes) await getStoreFor(id, destination).removeItem(key);
    const landed = await inventoryScope(destination);
    if (!inventoryMatches(landed, expectedAfterPlan(late))) {
        throw new MigrationRecoveryError('copy_failed', 'O atlas não ficou como a incorporação previa.');
    }
    state.lateBase = { raw: late.source, migrated: late.staged, destination: landed };
    state.acknowledgedInventory = late.source;
    retireStaging(state, late.staging);
    delete state.late;
    delete state.lateConflict;
    await save(state);
    const records = late.writes.length + late.deletes.length;
    if (records) console.info(`Alterações da versão antiga incorporadas: ${records} registros.`);
    return { outcome: records ? LateResult.ABSORBED : LateResult.NOTHING, records };
}

/**
 * The same absorption for a page that is already running: the in-session watcher calls it when
 * the old version writes while the new one is open.
 * @returns {Promise<{ outcome: string, reason?: string, records?: number }>}
 */
export async function absorbLateLegacyChangesNow() {
    if (!globalThis.navigator?.locks?.request) return { outcome: LateResult.CONFLICT, reason: 'lock_unavailable' };
    return navigator.locks.request(TRANSITION_LOCK, async () => {
        const state = await readLegacyTransition();
        if (!transitionIsSettled(state)) return { outcome: LateResult.NOTHING, records: 0 };
        if (!state.late && !await legacyHasChanged(state)) return { outcome: LateResult.NOTHING, records: 0 };
        return absorbLateLegacyChanges(state);
    });
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
