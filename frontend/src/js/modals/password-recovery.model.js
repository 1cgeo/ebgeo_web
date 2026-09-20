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
 *
 * THE FOURTH FACT IS ABOUT HEIGHT, and it is why `nextLoginView` lives here. Until 2026-09-20 the
 * recovery panel EXPANDED under the login form, so both were on screen at once and the dialog
 * started to scroll: the person who just failed to enter had to scroll past the boxes that failed
 * them to reach the one that helps. They are mutually exclusive VIEWS now, and the recovery view
 * is itself two steps (ask for a code, redeem it), because the whole of it does not fit in 85vh of
 * a 768-pixel screen. Which view and which step is the only decidable part of that, so it is a
 * pure function with a node test instead of a pile of booleans in the DOM builder.
 */

/** Minimum length of a new password. Mirrors `resetPasswordWithTokenSchema.newPassword.min`. */
export const MIN_PASSWORD_LENGTH = 6;

/** Maximum length of a new password. Mirrors `resetPasswordWithTokenSchema.newPassword.max`. */
export const MAX_PASSWORD_LENGTH = 100;

/** Maximum number of UTF-8 BYTES bcrypt reads. Mirrors `MAX_PASSWORD_BYTES` on the server. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * The rule, stated before the attempt instead of after the refusal, and in ONE short line.
 *
 * IT SAYS THE FLOOR AND NOTHING ELSE, since 2026-09-20. It used to recite both bounds plus the
 * byte ceiling ("no máximo 72 bytes em UTF-8, acentos ocupam mais de um byte"), which is the
 * implementation of bcrypt read out loud to someone who is trying to get back into their account.
 * The two ceilings are still enforced, and they are said as REFUSALS, when the person actually
 * hits one, which is the only moment they mean anything.
 */
export const PASSWORD_RULE_TEXT = `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;

/** Refusal: below the floor. The number is the same one the hint above states. */
export const PASSWORD_SHORT_TEXT =
    `Senha curta demais. Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;

/** Refusal: above the ceiling in CHARACTERS, which is a count a person can act on. */
export const PASSWORD_LONG_TEXT =
    `Senha longa demais. Use no máximo ${MAX_PASSWORD_LENGTH} caracteres.`;

/**
 * Refusal: above the ceiling in BYTES, which is a number a person cannot count.
 *
 * NO NUMBER HERE, and that is the point: the byte ceiling bites at a different character count
 * for every password, because an accented letter weighs more than one byte. Naming 72 would
 * announce a limit the person just proved wrong by typing fewer characters than that.
 */
export const PASSWORD_HEAVY_TEXT = 'Senha longa demais. Use uma senha mais curta.';

/**
 * The path that is true in EVERY deployment, said as the WAY OUT of a code that never arrived.
 *
 * IT MOVED OUT OF THE OPENING on 2026-09-20. It used to be the first paragraph of the panel, so
 * the screen answered "ask someone else" before it answered "here is what to do", and the owner
 * read it exactly that way. It is neutral in the sense the uniform answer requires: it is
 * addressed to whoever did not receive a message, which says nothing about whether an account
 * with that address exists.
 */
export const ADMIN_RECOVERY_TEXT =
    'Não recebeu o código? Confira a caixa de spam ou peça ao administrador do EBGeo para '
    + 'redefinir a sua senha.';

/**
 * The WHOLE of the recovery view where the e-mail path is not mounted.
 *
 * Without this sentence that deployment shows an empty screen: there is no form to draw, and the
 * line above is addressed to someone waiting for a code that was never offered.
 */
export const ADMIN_ONLY_RECOVERY_TEXT =
    'A sua senha é redefinida pelo administrador do EBGeo. Peça a ele para criar uma senha nova '
    + 'para você.';

/** The one sentence the recovery view opens with: what to type, and what happens next. */
export const EMAIL_RECOVERY_INTRO =
    'Informe o e-mail da sua conta. Enviaremos um código para você criar uma senha nova.';

/**
 * What the person sees after asking for a code, written to survive BOTH outcomes.
 *
 * `requestPasswordReset` (`backend/src/modules/auth/auth.service.js`) answers the same
 * `{ success: true }` whether or not the address has a resettable account, so this may not
 * promise that a message is on its way. It also may not hint at the three reasons nothing would
 * arrive (no account, address never confirmed, account deactivated), because listing them is the
 * enumeration the uniform answer exists to prevent. What to do when nothing arrives is
 * `ADMIN_RECOVERY_TEXT`, on the line under it.
 */
export const CODE_REQUESTED_TEXT =
    'Se houver uma conta com esse e-mail, o código chega em alguns minutos.';

/** Said next to the code box, because a code that expires without saying so reads as broken. */
export const CODE_PASTE_HINT =
    'Cole aqui o código que veio na mensagem. Ele vale por pouco tempo e serve uma única vez.';

/** The cost of finishing, said before the click and not after the 401, in the words of a user. */
export const RESET_SESSION_WARNING =
    'Ao salvar, você sai de todos os dispositivos e entra de novo com a senha nova.';

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
    // THREE REFUSALS INSTEAD OF ONE, and the split is the whole of the 2026-09-20 rewrite: the
    // single sentence had to cover every case, so it recited the bcrypt byte ceiling to a person
    // whose password was simply too short. Each bound now speaks only when it is the one that bit.
    if (next.length < MIN_PASSWORD_LENGTH) {
        return { valid: false, message: PASSWORD_SHORT_TEXT };
    }
    if (next.length > MAX_PASSWORD_LENGTH) {
        return { valid: false, message: PASSWORD_LONG_TEXT };
    }
    if (new TextEncoder().encode(next).length > MAX_PASSWORD_BYTES) {
        return { valid: false, message: PASSWORD_HEAVY_TEXT };
    }
    if (next !== confirm) {
        return { valid: false, message: 'A confirmação não confere com a nova senha.' };
    }
    return { valid: true, message: '' };
}

/** The two mutually exclusive faces of the login dialog. */
export const LoginView = Object.freeze({
    LOGIN: 'login',
    RECOVERY: 'recovery',
});

/** The two steps INSIDE the recovery view: ask for a code, then redeem it. */
export const RecoveryStep = Object.freeze({
    REQUEST: 'request',
    RESET: 'reset',
});

/** Everything that can move the dialog from one view (or step) to another. */
export const LoginViewAction = Object.freeze({
    OPEN_RECOVERY: 'open-recovery',
    BACK_TO_LOGIN: 'back-to-login',
    CODE_REQUESTED: 'code-requested',
    HAVE_CODE: 'have-code',
    ASK_AGAIN: 'ask-again',
    ESCAPE: 'escape',
});

/** Where the focus belongs after a transition, named by role rather than by element. */
export const LoginFocus = Object.freeze({
    RECOVERY_EMAIL: 'recovery-email',
    RECOVERY_CODE: 'recovery-code',
    RECOVERY_BACK: 'recovery-back',
    LOGIN_FORGOT: 'login-forgot',
});

/**
 * The next view of the login dialog, and where the focus goes.
 *
 * THREE DECISIONS ARE ENCODED HERE, and each one fails in a direction that was chosen:
 *
 *   1. `Escape` CLOSES the dialog from the login view and only GOES BACK from the recovery view.
 *      An unrecognised view is normalised to `login`, so a state this function does not understand
 *      still closes on `Escape` rather than trapping the person in a dialog with no exit.
 *   2. THE RESET STEP DOES NOT EXIST WHERE THE E-MAIL PATH IS OFF. `emailRecoveryEnabled` is false
 *      in every deployment without an account-mail relay, and there the recovery view is one
 *      paragraph: `code-requested` and `have-code` are refused instead of showing a form whose
 *      routes answer 404, and an incoming `step: 'reset'` is normalised away.
 *   3. THE TRANSITIONS INTO THE RECOVERY VIEW ARE ABSOLUTE and the ones inside it are guarded:
 *      `open-recovery` works from anywhere, while `code-requested` from the login view is a no-op,
 *      because a late server answer must never yank the dialog away from someone who already went
 *      back to typing their password.
 *
 * @param {{ view?: *, step?: * }} state - The current view and step.
 * @param {string} action - One of `LoginViewAction`.
 * @param {{ emailEnabled?: boolean }} [options] - Whether recovery by e-mail is offered at all.
 * @returns {{ view: string, step: string, focus: (string|null), closesModal: boolean }}
 */
export function nextLoginView(state, action, options = {}) {
    const emailEnabled = options?.emailEnabled === true;
    const view = state?.view === LoginView.RECOVERY ? LoginView.RECOVERY : LoginView.LOGIN;
    const step = (state?.step === RecoveryStep.RESET && emailEnabled)
        ? RecoveryStep.RESET
        : RecoveryStep.REQUEST;
    const stay = { view, step, focus: null, closesModal: false };
    const toLogin = {
        view: LoginView.LOGIN,
        step: RecoveryStep.REQUEST,
        focus: LoginFocus.LOGIN_FORGOT,
        closesModal: false,
    };

    switch (action) {
        case LoginViewAction.OPEN_RECOVERY:
            return {
                view: LoginView.RECOVERY,
                step: RecoveryStep.REQUEST,
                focus: emailEnabled ? LoginFocus.RECOVERY_EMAIL : LoginFocus.RECOVERY_BACK,
                closesModal: false,
            };
        case LoginViewAction.BACK_TO_LOGIN:
            return toLogin;
        case LoginViewAction.CODE_REQUESTED:
        case LoginViewAction.HAVE_CODE:
            if (view !== LoginView.RECOVERY || !emailEnabled) return stay;
            return {
                view: LoginView.RECOVERY,
                step: RecoveryStep.RESET,
                focus: LoginFocus.RECOVERY_CODE,
                closesModal: false,
            };
        case LoginViewAction.ASK_AGAIN:
            if (view !== LoginView.RECOVERY || !emailEnabled) return stay;
            return {
                view: LoginView.RECOVERY,
                step: RecoveryStep.REQUEST,
                focus: LoginFocus.RECOVERY_EMAIL,
                closesModal: false,
            };
        case LoginViewAction.ESCAPE:
            if (view === LoginView.RECOVERY) return toLogin;
            return { ...toLogin, focus: null, closesModal: true };
        default:
            return stay;
    }
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
