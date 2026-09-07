// Path: js/store/migration/boot-legacy-adoption.js

/**
 * @fileoverview What the boot saw of the pre-namespace installation BEFORE it touched it, and
 * what the schema step then did about it. Two facts and one log line.
 *
 * ===========================================================================================
 * WHY THE OBSERVATION IS A SNAPSHOT AND NOT A LIVE READ
 * ===========================================================================================
 * The 3.0 step decides its branch by ONE question, and the question is about FORM, never about
 * the version number (the number cannot tell the two 2.3 apart, which is the whole reason this
 * schema jumped to 3.0):
 *
 *     does the GLOBAL registry already claim the unsuffixed databases (`dbSuffix === ''`)?
 *
 * Yes means this installation has booted THIS line before. No means the databases were written
 * by `main`, at 2.2, 2.3 or 2.4, and the adoption has never happened.
 *
 * Asked LIVE, from inside the step, the answer is always yes and the question is worthless:
 * `activateBootAtlasScope` (`store.js`) runs `initLocalAtlases` BEFORE `initializeRepository`,
 * and its bootstrap writes exactly that entry. So the question is only answerable before that
 * call, the boot asks it there, and the answer is parked here. The same shape already exists
 * one layer down and for the same reason: `bootTabMountPointer` (`atlas-namespace.js`) reads a
 * boot snapshot because the repository bridge mounts the legacy scope before the boot decides
 * anything.
 *
 * A CALLER THAT NEVER TOOK THE SNAPSHOT gets null, and the step then reads the registry itself.
 * That is the CORRECT answer for it, because there was no boot to pollute the registry: a
 * direct `safelyMigrate()`, a maintenance script, a test.
 *
 * ===========================================================================================
 * WHY THE BOOT ALSO CARRIES THE NAME
 * ===========================================================================================
 * `bootstrapEntry` names slot #1 "Meu Atlas" unless the caller passes a name, and the name the
 * user actually has lives in the atlas record of the legacy databases. The step used to repair
 * that after the fact, which meant every boot recreated the defect and every boot had to undo
 * it. Reading the record here and handing the name to `initLocalAtlases` means the slot is born
 * with the right name; the step's repair stays for the installations that already crossed with
 * the older build.
 *
 * ===========================================================================================
 * AND WHY THE OUTCOME IS RECORDED AT ALL
 * ===========================================================================================
 * Measured on 2026-09-07 in a real browser: a `main` 2.4 repository crossing into this line
 * produced TWELVE console lines, all of them network. Nothing said which branch ran, nothing
 * said the databases had been adopted, nothing said the schema had moved. Support cannot
 * confirm an upgrade it cannot see, and neither can the next agent. `reportBootAtlasScope`
 * writes ONE line, at the end of the boot, naming the branch, what it did and how many maps the
 * mounted scope holds.
 */

import {
    ATLAS_RECORD_KEY,
    LEGACY_DB_SUFFIX,
    StoreName,
    StoreScopeKind,
    getActiveScope,
    getStoreFor,
    readLocalAtlasRegistry
} from '../atlas-namespace.js';
import { isLegacyScope, legacyScope } from './migration-scope.js';

/**
 * Branch the 3.0 step took, as a value rather than a sentence, so the boot line and the tests
 * agree on the vocabulary instead of matching prose.
 */
export const MigrationBranch = Object.freeze({
    /** A namespaced slot: registered and owning its databases already, so only the stamp. */
    NAMESPACED_SLOT: 'slot-com-sufixo',
    /** The legacy databases were already claimed by this line: nothing structural, only the stamp. */
    ALREADY_ADOPTED: 'ja-adotado',
    /** The legacy databases came from `main`: adoption, queue discard, stamp. */
    ADOPTED_LEGACY: 'adocao-do-legado',
    /** No step ran, because the installation was already at the current schema. */
    NONE: 'nenhum'
});

/** @type {{legacyClaimed: boolean, hadRegistry: boolean, bootstrapName: string|undefined}|null} */
let _observation = null;

/** @type {{branch: string, discardedOperations: number, discardedRemote: boolean, recoveredName: string|null}|null} */
let _outcome = null;

/**
 * The name the adopted atlas already carries on disk.
 *
 * Read from the record instead of hard-coded so the exceptions are not relabelled in silence: a
 * workspace the user named something else, or an atlas record that arrived carrying a server
 * atlas's name, must not be renamed by the act of being registered.
 *
 * @returns {Promise<string|undefined>} Name to register, or undefined for the default.
 */
export async function nameOfAdoptedAtlas() {
    const atlas = await getStoreFor(StoreName.ATLAS, legacyScope()).getItem(ATLAS_RECORD_KEY);
    const name = typeof atlas?.name === 'string' ? atlas.name.trim() : '';
    return name.length > 0 ? name : undefined;
}

/**
 * Reads the global registry BEFORE the boot writes to it, and remembers the answer.
 *
 * THE NAME IS ONLY OFFERED WHEN THE STORE IS LOCAL, and the exception is not symmetry for its
 * own sake. A store whose origin marker says REMOTE holds a SERVER atlas in the unsuffixed
 * databases, so its atlas record carries somebody else's atlas name; and a bootstrap on that
 * boot creates a FRESH slot (`adoptLegacy` is false for a REMOTE origin) rather than adopting
 * those databases. Handing the name over would christen an empty local atlas after a server
 * project the user never named, which is the same class of silent relabelling this whole
 * mechanism exists to stop, only pointing the other way.
 *
 * @param {{ kind: string }} [origin] - The origin the boot resolved. Defaults to LOCAL, which
 *   is what a caller with no origin to offer means.
 * @returns {Promise<{legacyClaimed: boolean, hadRegistry: boolean, bootstrapName: string|undefined}>}
 *   `legacyClaimed` is the branch discriminator; `bootstrapName` is what `initLocalAtlases`
 *   should call the slot it may be about to create.
 */
export async function observeLegacyInstallation(origin = null) {
    const entries = await readLocalAtlasRegistry();
    const isRemote = origin?.kind === StoreScopeKind.REMOTE;
    _observation = {
        legacyClaimed: entries.some(entry => entry.dbSuffix === LEGACY_DB_SUFFIX),
        hadRegistry: entries.length > 0,
        bootstrapName: isRemote ? undefined : await nameOfAdoptedAtlas()
    };
    _outcome = null;
    return { ..._observation };
}

/**
 * @returns {{legacyClaimed: boolean, hadRegistry: boolean, bootstrapName: string|undefined}|null}
 *   What the boot saw, or null when no boot took a snapshot.
 */
export function legacyObservation() {
    return _observation ? { ..._observation } : null;
}

/**
 * @param {{branch: string, discardedOperations?: number, discardedRemote?: boolean,
 *   recoveredName?: string|null}} outcome - What the step did.
 * @returns {void}
 */
export function recordMigrationOutcome(outcome) {
    _outcome = {
        branch: outcome.branch,
        discardedOperations: outcome.discardedOperations ?? 0,
        discardedRemote: outcome.discardedRemote ?? false,
        recoveredName: outcome.recoveredName ?? null
    };
}

/**
 * Forgets both facts. Exported for the boot itself: two boots in one page (the tab that logs
 * out and back in) must not read the previous boot's answer.
 * @returns {void}
 */
export function resetBootLegacyAdoption() {
    _observation = null;
    _outcome = null;
}

/**
 * @param {{ kind: string, dbSuffix: string }|null} scope - Scope to describe.
 * @returns {string} Short label, the same vocabulary `migration.service.js` logs with.
 */
function describeScope(scope) {
    if (!scope) return 'nenhum';
    return isLegacyScope(scope) ? 'pre-namespace' : `${scope.kind}:${scope.dbSuffix}`;
}

/**
 * Writes the ONE line the transition never had.
 *
 * Called at the end of the boot, after `initializeRepository`, so it can say what actually
 * happened rather than what was about to. It never throws: a boot that dies while composing a
 * log line would trade the whole session for a diagnostic.
 *
 * @returns {Promise<string|null>} The line written, or null when it could not be composed.
 */
export async function reportBootAtlasScope() {
    try {
        const scope = getActiveScope();
        const maps = scope ? (await getStoreFor(StoreName.MAPS, scope).keys()).length : 0;
        const outcome = _outcome ?? { branch: MigrationBranch.NONE, discardedOperations: 0, discardedRemote: false, recoveredName: null };

        const partes = [`escopo ${describeScope(scope)}`, `${maps} mapa(s)`, `degrau ${outcome.branch}`];
        if (_observation) {
            partes.push(_observation.legacyClaimed
                ? 'bancos sem sufixo ja eram deste app'
                : 'bancos sem sufixo vindos do main');
        }
        if (outcome.discardedRemote) partes.push('residuo REMOTE descartado');
        if (outcome.discardedOperations > 0) {
            partes.push(`${outcome.discardedOperations} operacao(oes) legada(s) descartada(s)`);
        }
        if (outcome.recoveredName) partes.push(`nome recuperado: "${outcome.recoveredName}"`);

        const linha = `Boot do atlas: ${partes.join('; ')}`;
        console.info(linha);
        return linha;
    } catch (error) {
        console.warn('Boot do atlas: nao foi possivel compor a linha de diagnostico:', error);
        return null;
    }
}
