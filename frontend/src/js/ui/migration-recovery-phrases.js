// Path: js/ui/migration-recovery-phrases.js

/**
 * @fileoverview The sentences of the one destructive act on the recovery screen: deleting the
 * copy the previous version of the product left on this computer (decision D8 of 2026-09-13).
 *
 * A LEAF WITH ZERO IMPORTS, like every other destructive-act phrase module in this repository
 * (`producer-scope-phrases.js` and its siblings under `admin/`), so the wording is testable in
 * node without a screen, a store or a browser.
 *
 * THE RULE THAT BINDS THEM: the number the confirmation says is the number the inventory just
 * counted, never an estimate and never a rounding. This is the only screen in the product that
 * can delete an acervo the user cannot get back, and a confirmation that names a wrong size is
 * the one thing worse than no confirmation at all.
 *
 * THE DENIALS ARE KEYED BY STATE, NEVER BY ROLE, which is the same reason `denialNotice` exists
 * for the map: every reason listed here is reversible, and the person reading it is usually the
 * one who can reverse it (finish the update, recover the changes the old window wrote, close the
 * other window). That is why the command is drawn and refuses the click instead of disappearing.
 */

/** Label of the command itself. */
export const DROP_SOURCE_LABEL = 'Apagar a cópia antiga da versão anterior';

/** Label of the second, irreversible step. */
export const DROP_SOURCE_CONFIRM_LABEL = 'Confirmar e apagar';

/** Label of the way out of the second step. */
export const DROP_SOURCE_CANCEL_LABEL = 'Manter a cópia antiga';

/** What the screen says while the deletion runs. */
export const DROP_SOURCE_RUNNING = 'Apagando a cópia antiga da versão anterior…';

/**
 * Why the command refuses, by the verdict `describeLegacySource` returned.
 *
 * Every sentence names the STATE and, where there is one, the way out of it. `drop_blocked` is
 * here too even though it is an error code and not a verdict: it is the same conversation, and
 * the screen should not switch voices between "I will not" and "I could not".
 */
const DENIALS = Object.freeze({
    no_transition: 'Não há uma atualização registrada neste computador, então não existe cópia antiga para apagar.',
    not_committed: 'A atualização ainda não terminou neste computador. Conclua a atualização antes de apagar a cópia antiga.',
    legacy_changes: 'A versão anterior gravou alterações depois da atualização. Recupere essas alterações em outro atlas antes de apagar a cópia antiga.',
    claimed: 'Um atlas da sua lista ainda usa os dados da versão anterior, então eles não são uma cópia antiga.',
    already_dropped: 'A cópia antiga da versão anterior já foi apagada deste computador.',
    unreadable: 'O registro da atualização precisa de recuperação antes de qualquer exclusão.',
    drop_blocked: 'Outra janela ainda mantém os dados da versão anterior abertos. Feche as outras janelas do EBGeo e tente de novo.'
});

/**
 * @param {string} reason - Verdict reason, or the code of a `MigrationRecoveryError`.
 * @returns {string|null} The sentence, or null when this module has nothing to say about that
 *   reason and the caller should show the error's own message. Read with `Object.hasOwn`,
 *   because the value comes from outside: `DENIALS[reason]` answers `Object.prototype.toString`
 *   for a reason named `toString`, and `Object.freeze` does not protect against that.
 */
export function dropSourceDenial(reason) {
    return Object.hasOwn(DENIALS, reason) ? DENIALS[reason] : null;
}

/**
 * @param {number} records - How many records the origin holds.
 * @returns {string} The plural-aware count, or a phrase for a count nobody could read.
 */
function countPhrase(records) {
    if (records === 1) return '1 registro';
    return `${records} registros`;
}

/**
 * The sentence the user reads BEFORE the irreversible step.
 *
 * @param {number} records - Record count from the inventory of the origin.
 * @returns {string} Confirmation naming the size, what survives, and that there is no undo.
 */
export function dropSourceConfirmation(records) {
    if (!Number.isFinite(records) || records < 0) {
        return 'Isto apaga a cópia antiga da versão anterior deste computador, e não há como desfazer. '
            + 'O atlas atualizado, que você está usando agora, não é tocado.';
    }
    if (records === 0) {
        return 'A versão anterior não tem mais registros neste computador: apagar remove apenas os bancos '
            + 'vazios que sobraram. O atlas atualizado não é tocado.';
    }
    return `Isto apaga ${countPhrase(records)} da versão anterior deste computador, e não há como desfazer. `
        + 'O atlas atualizado, que você está usando agora, não é tocado.';
}

/**
 * @param {number} records - Record count that was deleted.
 * @returns {string} What the screen says afterwards, naming the same number.
 */
export function dropSourceDone(records) {
    if (!Number.isFinite(records) || records <= 0) {
        return 'A cópia antiga da versão anterior saiu deste computador. O atlas atualizado continua intacto.';
    }
    return `Cópia antiga apagada: ${countPhrase(records)} da versão anterior saíram deste computador. `
        + 'O atlas atualizado continua intacto.';
}
