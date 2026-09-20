// Path: js/ui/password-match.model.js

/**
 * @fileoverview The live verdict under "Confirmar senha": does the confirmation match, and is the
 * password within the 72 BYTES bcrypt accepts. Pure, ZERO IMPORTS, testable in node.
 *
 * WHY IT IS A MODULE AND NOT THREE LINES IN THE MODAL: the rule has an asymmetry that is easy to
 * write backwards. An EMPTY confirmation is not a mismatch — it is somebody who has not typed yet,
 * and painting a field red before the first keystroke trains people to ignore the colour. So the
 * empty case has its own state and NO phrase, and only a confirmation with content is ever judged.
 *
 * AND THE ORDER OF THE TWO REFUSALS IS THE SAME AS THE SUBMIT'S, deliberately: mismatch first,
 * length second. `_handleSubmit` in `modals/signup.modal.js` checks them in that order, so a live
 * notice that ranked them the other way would name a different problem than the button does.
 *
 * THE LIMIT IS BYTES, NOT CHARACTERS, and that is the whole reason the check exists at all: bcrypt
 * truncates at 72 BYTES, and in pt-BR an accented character costs two. "senhaçãoçãoçã…" of 40
 * characters is already over the limit while `length` still reads 40.
 */

/** The four states of the confirmation line. */
export const ConfirmacaoSenha = Object.freeze({
    /** Nothing typed in the confirmation yet: say nothing. */
    VAZIO: 'vazio',
    /** Both fields carry the same text, and it fits. */
    COINCIDE: 'coincide',
    /** They differ. */
    DIFERE: 'difere',
    /** They match, but the password is longer than bcrypt accepts. */
    LONGA_DEMAIS: 'longa-demais',
});

/** The most a bcrypt hash reads. Everything past this byte is silently dropped. */
export const MAX_SENHA_BYTES = 72;

/**
 * How many bytes a password costs in UTF-8.
 * @param {*} senha
 * @returns {number} 0 for anything that is not a string.
 */
export function bytesDaSenha(senha) {
    if (typeof senha !== 'string' || senha === '') return 0;
    return new TextEncoder().encode(senha).length;
}

/**
 * The live verdict for a (password, confirmation) pair.
 * @param {*} senha
 * @param {*} confirmacao
 * @returns {{ estado: string, mensagem: string }} `mensagem` is '' exactly when the state is
 *   `VAZIO`; every other state carries the sentence the person reads.
 */
export function avaliarConfirmacao(senha, confirmacao) {
    const digitada = typeof senha === 'string' ? senha : '';
    const repetida = typeof confirmacao === 'string' ? confirmacao : '';

    if (repetida === '') return { estado: ConfirmacaoSenha.VAZIO, mensagem: '' };
    if (digitada !== repetida) {
        return { estado: ConfirmacaoSenha.DIFERE, mensagem: 'As senhas não coincidem.' };
    }
    if (bytesDaSenha(digitada) > MAX_SENHA_BYTES) {
        return {
            estado: ConfirmacaoSenha.LONGA_DEMAIS,
            // Plain words, never "bytes": the owner asked for it (2026-09-20), and the number this
            // would quote is larger than the character count the person just typed. The sentence is
            // the same one the recovery screen shows (`PASSWORD_HEAVY_TEXT`), pinned equal by test.
            mensagem: 'Senha longa demais. Use uma senha mais curta.',
        };
    }
    return { estado: ConfirmacaoSenha.COINCIDE, mensagem: 'As senhas coincidem.' };
}
