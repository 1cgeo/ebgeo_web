// Path: js/modals/password-recovery.model.js

/**
 * @fileoverview The rules and the sentences of "Esqueci minha senha", with no DOM and no I/O.
 *
 * WHY IT IS A FILE OF ITS OWN, and it is the same reason `account-settings.model.js` is one: the
 * modal that uses it reaches `apiClient`, the config singleton and `event-cleanup`, so importing
 * it in a node test drags a browser-shaped graph. What is worth pinning here is prose and
 * arithmetic — sentences that must not promise what the server does not do, and password bounds
 * that must MIRROR the server rather than invent a policy.
 *
 * ZERO IMPORTS, and that is contract: the login screen is reachable from `atlas.html` and
 * `admin.html`, which boot without the store.
 *
 * THE TWO FACTS THAT DECIDE EVERY SENTENCE, both measured against the server:
 *
 *   1. THE ADMINISTRATOR PATH IS THE ONE THAT ALWAYS EXISTS. `POST /users/:userId/reset-password`
 *      is gated by `requireAdmin` and is mounted in every deployment. Until 2026-08-23 the only
 *      place in the whole product that said so was a line inside an e-mail
 *      (`sendAccountExistsEmail`, `backend/src/utils/mailer.js`), which nobody reads before
 *      losing a password. So the panel states it, always, even where recovery by e-mail works.
 *
 *   2. RECOVERY BY E-MAIL MAY NOT BE MOUNTED. `/auth/forgot-password` and `/auth/reset-password`
 *      exist only where the server can deliver account mail, and `GET /api/config` reports that
 *      as `features.password_reset_email`. The affordance is gated on the flag and never on
 *      catching a 404, because a deployment without a relay is a supported state and not a
 *      failure to report.
 *
 * AND THE THIRD FACT, which shapes the form rather than the prose: the message carries the token
 * as a CODE to paste, not as a clickable link. The boot of the web app consumes exactly one
 * one-shot query parameter (`?verify=`, in `js/index.js`), and there is no routing for a second
 * one, so a link would land on a page that ignores it. Asking for a paste is the honest version;
 * teaching the boot to route a reset link is the follow-up that removes the paste.
 */

/** Minimum length of a new password. Mirrors `resetPasswordWithTokenSchema.newPassword.min`. */
export const MIN_PASSWORD_LENGTH = 6;

/** Maximum length of a new password. Mirrors `resetPasswordWithTokenSchema.newPassword.max`. */
export const MAX_PASSWORD_LENGTH = 100;

/** The rule, stated before the attempt instead of after the refusal. */
export const PASSWORD_RULE_TEXT =
    `A nova senha precisa ter de ${MIN_PASSWORD_LENGTH} a ${MAX_PASSWORD_LENGTH} caracteres.`;

/**
 * The path that is true in EVERY deployment, and the reason this whole panel is worth having
 * even where nothing else is offered.
 */
export const ADMIN_RECOVERY_TEXT =
    'Peça ao administrador do EBGeo para redefinir a sua senha. Ele consegue fazer isso pelo '
    + 'Painel do Administrador, e é o caminho que sempre funciona.';

/** Said above the e-mail form, where the e-mail path exists. */
export const EMAIL_RECOVERY_INTRO =
    'Se a sua conta tem um e-mail confirmado, você mesmo pode redefinir a senha: pedimos o '
    + 'envio de um código para esse endereço.';

/**
 * What the person sees after asking for a code, written to survive BOTH outcomes.
 *
 * `requestPasswordReset` (`backend/src/modules/auth/auth.service.js`) answers the same
 * `{ success: true }` whether or not the address has a resettable account, so this may not
 * promise that a message is on its way. It also may not hint at the three reasons nothing would
 * arrive (no account, address never confirmed, account deactivated), because listing them is the
 * enumeration the uniform answer exists to prevent. It says what to do next either way.
 */
export const CODE_REQUESTED_TEXT =
    'Se houver uma conta com esse e-mail, o código chega nele em alguns minutos; confira também '
    + 'a caixa de spam. Se nada chegar, use o caminho do administrador acima.';

/** Said next to the code box, because a code that expires without saying so reads as broken. */
export const CODE_PASTE_HINT =
    'Cole aqui o código que veio na mensagem. Ele vale por pouco tempo e serve uma única vez.';

/** The cost of finishing, said before the click and not after the 401. */
export const RESET_SESSION_WARNING =
    'Ao redefinir, todas as sessões abertas desta conta são encerradas. Entre de novo com a '
    + 'senha nova.';

/** Said after a successful reset, on the screen the person is already looking at. */
export const RESET_DONE_TEXT = 'Senha redefinida. Entre com o seu usuário e a senha nova.';

/**
 * The message to show for a failed request: the SERVER's explanation when it sent one, the
 * generic sentence otherwise.
 *
 * A third copy of the same three lines (`sharingErrorMessage`, `accountErrorMessage`), and a copy
 * rather than an import for the same reason the second one is: this module is import-free on
 * purpose. The shared guard is the `HTTP <status>` filter — `_request`
 * (`store/sync/api-client.js`) invents that string when the response carries no message, and it
 * is console copy, never user copy.
 *
 * @param {*} error - The caught error (an `ApiError` carries the server `message`).
 * @param {string} fallback - Generic pt-BR sentence for when there is nothing better.
 * @returns {string}
 */
export function recoveryErrorMessage(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return fallback;
    if (/^HTTP \d{3}$/.test(message)) return fallback;
    return message;
}

/**
 * Whether this deployment offers recovery by e-mail at all.
 *
 * READS THE FLAG AND NOTHING ELSE, and in particular does not fall back to "assume yes": an
 * absent flag means an older server, and offering a route that answers 404 is worse than
 * offering only the administrator path, which is always true.
 *
 * @param {{ features?: { password_reset_email?: * } }} appConfig - The config singleton.
 * @returns {boolean}
 */
export function emailRecoveryEnabled(appConfig) {
    return appConfig?.features?.password_reset_email === true;
}

/**
 * Client-side check of the "send me a code" form.
 *
 * THE SHAPE CHECK IS DELIBERATELY LOOSE, exactly as in `account-settings.model.js`: the authority
 * is `Joi.string().email()` on the server, and a stricter client rule would refuse addresses the
 * server accepts with no way for the person to know the refusal was local.
 *
 * @param {{ email?: * }} form
 * @returns {{ valid: boolean, message: string }}
 */
export function validateRecoveryRequest(form) {
    const email = typeof form?.email === 'string' ? form.email.trim() : '';
    if (!email) {
        return { valid: false, message: 'Informe o e-mail da sua conta.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { valid: false, message: 'Esse endereço de e-mail não parece válido.' };
    }
    return { valid: true, message: '' };
}

/**
 * The uuid shape of a reset code, mirroring `resetPasswordWithTokenSchema.token.uuid()`.
 *
 * Checked on the client so a code mangled by copy and paste (a trailing space, a broken line, the
 * surrounding text grabbed along with it) is named as such instead of coming back as a 422 about
 * a field the person never typed the name of.
 */
const CODE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Client-side check of the "redeem this code" form.
 *
 * The order of the checks is the order the form is filled, so the first complaint is about the
 * first thing that is wrong.
 *
 * @param {{ code?: *, newPassword?: *, confirmPassword?: * }} form
 * @returns {{ valid: boolean, message: string }}
 */
export function validateRecoveryReset(form) {
    const code = typeof form?.code === 'string' ? form.code.trim() : '';
    const next = typeof form?.newPassword === 'string' ? form.newPassword : '';
    const confirm = typeof form?.confirmPassword === 'string' ? form.confirmPassword : '';

    if (!code) {
        return { valid: false, message: 'Cole o código que veio no e-mail.' };
    }
    if (!CODE_PATTERN.test(code)) {
        return {
            valid: false,
            message: 'Esse código não está completo. Copie a linha inteira da mensagem.',
        };
    }
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
        return { valid: false, message: PASSWORD_RULE_TEXT };
    }
    if (next !== confirm) {
        return { valid: false, message: 'A confirmação não confere com a nova senha.' };
    }
    return { valid: true, message: '' };
}

/**
 * The code as it should travel, with the accidents of a paste removed.
 *
 * Trimming and lower-casing are safe here and are NOT the same decision as with an e-mail
 * address: a uuid is hexadecimal, so case carries no information, and the server compares it as a
 * `uuid` column.
 * @param {*} value
 * @returns {string}
 */
export function normalizeRecoveryCode(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
