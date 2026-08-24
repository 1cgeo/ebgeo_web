// Path: js/modals/account-settings.model.js

/**
 * @fileoverview The rules and the sentences of the "Minha conta" screen, with no DOM and no I/O.
 *
 * WHY IT IS A FILE OF ITS OWN. The modal that uses it reaches `apiClient`, the toast service and
 * `event-cleanup`, so importing it in a node test drags a browser-shaped graph. What is worth
 * testing here is arithmetic and prose: the password rule that has to MIRROR the server, the
 * warnings that have to be shown BEFORE the irreversible click, and the state a section is in.
 * Splitting them out is what makes the verifiable part verifiable.
 *
 * ZERO IMPORTS, and that is contract, for the same reason `ui/role-labels.js` has it: the screen
 * is reachable from `atlas.html` and `admin.html`, which boot without the store.
 *
 * THE PASSWORD BOUNDS ARE A MIRROR, NOT A CHOICE. `updatePasswordSchema`
 * (`backend/src/modules/users/users.schemas.js`) is the authority; the constants below only
 * repeat it so the screen can state the rule BEFORE the server refuses. The mirror is asserted
 * structurally by `frontend/tests/unit/conta-regra-de-senha-espelha-servidor.test.js`, which
 * reads the Joi source: a client that drifts below the server's `min` promises an acceptance the
 * server will deny, and one that drifts above forbids a password the server would take.
 *
 * WHAT THE SERVER DOES NOT TELL US, and why one sentence here is written in the negative: there
 * is no route, and no column selected anywhere in the `users` module, that says whether an
 * account already HAS an API key. So the screen may not claim there is one, may not claim there
 * is none, and says so out loud instead of guessing.
 *
 * THE E-MAIL SENTENCES ARE THE OTHER HALF OF THE SAME DISCIPLINE, added in 2026-08-23 together
 * with the address becoming readable at all (`FIND_USER_BY_ID` did not select `email` nor
 * `email_verified` until then, so "Minha conta" could not show them). Two facts drive every one
 * of them, and both were measured against `requestEmailChange`
 * (`backend/src/modules/users/users.service.js`): asking for a change writes NOTHING on the
 * account until the new mailbox is proven, and the route answers the SAME 200 whether the address
 * was free or already belongs to somebody else. So no sentence here may promise that the change
 * happened, and none may promise that a confirmation is on its way.
 */

/** Minimum length of a new password. Mirrors `updatePasswordSchema.newPassword.min`. */
export const MIN_PASSWORD_LENGTH = 6;

/** Maximum length of a new password. Mirrors `updatePasswordSchema.newPassword.max`. */
export const MAX_PASSWORD_LENGTH = 100;

/** Maximum length of `nome`. Mirrors `updateProfileSchema.nome.max`. */
export const MAX_NAME_LENGTH = 255;

/** Maximum length of an e-mail address. Mirrors `changeEmailSchema.email.max`. */
export const MAX_EMAIL_LENGTH = 255;

/**
 * The only two fields `PUT /users/me` accepts, in the wire spelling.
 *
 * Anything else is dropped by `stripUnknown` with a 200 and no change, which is why offering a
 * third field on this screen would be worse than offering none.
 * @type {readonly string[]}
 */
export const EDITABLE_PROFILE_FIELDS = Object.freeze(['nome', 'rank_id']);

/** The password rule, stated before the attempt instead of after the refusal. */
export const PASSWORD_RULE_TEXT =
    `A nova senha precisa ter de ${MIN_PASSWORD_LENGTH} a ${MAX_PASSWORD_LENGTH} caracteres.`;

/**
 * What changing the password costs, said before the button is pressed.
 *
 * Measured, not assumed: `updatePassword` (`backend/src/modules/users/users.service.js`) runs
 * `REVOKE_ALL_USER_TOKENS`, which revokes the refresh family and stamps
 * `users.sessions_valid_from`, so every live access token of the account is refused from that
 * instant. The route answers `{ success: true }` and no new token pair, so THIS session falls
 * too. Saying "as outras sessões" would be the comfortable lie.
 */
export const PASSWORD_SESSION_WARNING =
    'Ao confirmar, todas as sessões desta conta são encerradas, inclusive esta. '
    + 'Você vai precisar entrar de novo com a senha nova.';

/** Read-only fields exist because the person cannot change them alone; say who can. */
export const ADMIN_ONLY_FIELDS_NOTE =
    'Papel no sistema, lotação e OM de produção só mudam por ato de um administrador.';

/**
 * What changing the e-mail costs, and what it does NOT cost, said before the button.
 *
 * Measured against `requestEmailChange` (`backend/src/modules/users/users.service.js`): the
 * account row is not touched at all until the link in the new mailbox is followed, the current
 * address keeps working meanwhile, and no session is ended (the login credential is username plus
 * password, and neither moves). Saying "trocamos o seu e-mail" would be the comfortable lie: what
 * this button does is send an invitation.
 */
export const EMAIL_CHANGE_WARNING =
    'O endereço novo só passa a valer depois que você abrir o link de confirmação que vamos '
    + 'enviar para ele. Até lá, nada muda: a conta continua com o e-mail atual e a sua sessão '
    + 'segue aberta.';

/**
 * What the person sees after asking, and it is written to survive BOTH outcomes.
 *
 * The route answers the same 200 whether the address was free or already belongs to another
 * account (the anti-enumeration decision of cláusula 5.6, applied to accounts), so this sentence
 * may not promise that a confirmation is on its way. It says what was done and what to check.
 */
export const EMAIL_CHANGE_SENT_TEXT =
    'Pedido registrado. Se o endereço puder ser usado, o link de confirmação chega nele em '
    + 'alguns minutos; confira também a caixa de spam. Se nada chegar, o endereço pode já '
    + 'pertencer a outra conta: nesse caso quem recebe o aviso é a caixa dele.';

/** Why the current password is asked for a change that is not a password change. */
export const EMAIL_CHANGE_PASSWORD_NOTE =
    'Pedimos a senha atual porque o e-mail é o caminho de recuperação da conta.';

/**
 * Said to someone whose address is not confirmed, on the screen where they can act on it.
 *
 * ELA MANDAVA PEDIR O LINK AO ADMINISTRADOR, e isso era desnecessário: `POST
 * /auth/resend-verification` é anônima e está montada sempre. A frase criava trabalho para duas
 * pessoas onde havia um botão, e este é o caso exato do achado A3 (o produto tinha UM reenvio, no
 * diálogo pós-cadastro, que sumia ao primeiro clique).
 */
export const EMAIL_UNVERIFIED_HINT =
    'Enquanto o e-mail não for confirmado, esta conta não entra pelo login. Se o endereço estiver '
    + 'errado, troque-o aqui; se estiver certo, peça um novo link de confirmação.';

/** Rótulo do botão que reenvia o link, ao lado do aviso acima. */
export const EMAIL_RESEND_LABEL = 'Reenviar link de confirmação';

/**
 * Desfecho do reenvio pedido dali. Uniforme por construção, como a rota: ela responde o mesmo 200
 * exista ou não confirmação pendente, e uma frase que afirmasse o envio transformaria a
 * conveniência num oráculo de conta.
 */
export const EMAIL_RESEND_SENT =
    'Se a confirmação ainda estiver pendente, enviamos um novo link para o endereço acima.';

/** Desfecho de falha de rede no reenvio. */
export const EMAIL_RESEND_FAILED =
    'Não foi possível reenviar agora. Tente de novo em instantes.';

/** Said when the server reports no address at all (an account created by an administrator). */
export const EMAIL_ABSENT_TEXT = 'nenhum e-mail cadastrado';

/** Shown before any rotation: the key is readable exactly once. */
export const API_KEY_ONE_TIME_WARNING =
    'A chave aparece uma única vez, na resposta desta operação. Não há como lê-la de novo: '
    + 'se ela se perder, o único caminho é gerar outra.';

/** The honest sentence for a fact the server does not expose. */
export const API_KEY_UNKNOWN_STATE_TEXT =
    'O servidor não informa se esta conta já tem uma chave, e esta tela não tem como descobrir. '
    + 'Se já houver uma, gerar outra invalida a anterior na mesma hora.';

/** Shown next to a revealed key, while it is still on screen. */
export const API_KEY_COPY_NOW_TEXT =
    'Copie a chave agora e guarde em lugar seguro. Ao fechar esta tela ela some para sempre.';

/** What the person is confirming before a rotation. */
export const API_KEY_ROTATE_CONFIRM_TITLE = 'Gerar uma chave de API nova?';

/**
 * The body of the rotation confirmation.
 *
 * It names the concrete consequence (every integration using the current key stops working) and
 * does NOT pretend to know whether a key exists, because nothing here can know that.
 */
export const API_KEY_ROTATE_CONFIRM_MESSAGE =
    'Se esta conta já tiver uma chave, ela deixa de funcionar no mesmo instante, e toda '
    + 'integração que a use para de autenticar até receber a chave nova.\n\n'
    + API_KEY_ONE_TIME_WARNING;

/** Asked when the modal is closed while a key is on screen and was never copied. */
export const API_KEY_DISCARD_CONFIRM_TITLE = 'Fechar sem copiar a chave?';

/** The body of that question. */
export const API_KEY_DISCARD_CONFIRM_MESSAGE =
    'A chave que está na tela não pode ser lida de novo depois que esta janela fechar. '
    + 'Se você não a copiou, vai precisar gerar outra, e a que está aí deixa de valer.';

/**
 * The message to show for a failed request: the SERVER's explanation when it sent one, the
 * generic sentence otherwise.
 *
 * Deliberately a second copy of `sharingErrorMessage` (`modals/sharing.modal.js`) rather than an
 * import: that module pulls presence, the sync engine and the event bus, and this one is
 * import-free on purpose. The guard both share is the `HTTP <status>` filter: `_request`
 * (`store/sync/api-client.js`) invents that string when the response carries no message, and it
 * is console copy, never user copy.
 *
 * @param {*} error - The caught error (an `ApiError` carries the server `message`).
 * @param {string} fallback - Generic pt-BR sentence for when there is nothing better.
 * @returns {string}
 */
export function accountErrorMessage(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return fallback;
    if (/^HTTP \d{3}$/.test(message)) return fallback;
    return message;
}

/**
 * Normalizes a profile field the way the wire wants it.
 *
 * An empty select (or an empty text box) is the CLEAR intent, and `updateProfileSchema` accepts
 * `null` for `rank_id`; `undefined` would mean "leave it alone", which is a different request.
 * @param {*} value
 * @returns {string|null}
 */
function normalizeField(value) {
    if (typeof value !== 'string') return value == null ? null : value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/**
 * The patch to send for a profile edit: only what actually changed, in the wire spelling.
 *
 * Returning `null` for "nothing changed" is what lets the screen keep the save button disabled
 * instead of sending a no-op PUT that still writes an `USER_UPDATE` line to the audit trail.
 *
 * @param {{ nome?: *, rank_id?: * }} original - The profile as the server last returned it.
 * @param {{ nome?: *, rank_id?: * }} draft - What the form holds now.
 * @returns {{ nome?: string|null, rank_id?: string|null }|null}
 */
export function profilePatch(original, draft) {
    const patch = {};
    for (const field of EDITABLE_PROFILE_FIELDS) {
        const before = normalizeField(original?.[field]);
        const after = normalizeField(draft?.[field]);
        if (before !== after) patch[field] = after;
    }
    return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * Client-side check of a profile draft, so an obvious refusal never costs a round trip.
 *
 * `nome` is the only required field: the server's `Joi.string()` refuses the empty string, and a
 * cleared name would be a 422 with the person's name already gone from the box.
 * @param {{ nome?: *, rank_id?: * }} draft
 * @returns {{ valid: boolean, message: string }}
 */
export function validateProfileDraft(draft) {
    const nome = typeof draft?.nome === 'string' ? draft.nome.trim() : '';
    if (!nome) {
        return { valid: false, message: 'Informe o seu nome completo.' };
    }
    if (nome.length > MAX_NAME_LENGTH) {
        return {
            valid: false,
            message: `O nome pode ter no máximo ${MAX_NAME_LENGTH} caracteres.`,
        };
    }
    return { valid: true, message: '' };
}

/**
 * Client-side check of the password form, mirroring `updatePasswordSchema` plus the confirmation
 * box, which is a client-only field (the server never sees it).
 *
 * The order of the checks is the order the person fills the form, so the first complaint is
 * about the first thing that is wrong.
 * @param {{ currentPassword?: *, newPassword?: *, confirmPassword?: * }} form
 * @returns {{ valid: boolean, message: string }}
 */
export function validatePasswordForm(form) {
    const current = typeof form?.currentPassword === 'string' ? form.currentPassword : '';
    const next = typeof form?.newPassword === 'string' ? form.newPassword : '';
    const confirm = typeof form?.confirmPassword === 'string' ? form.confirmPassword : '';

    if (!current) {
        return { valid: false, message: 'Informe a senha atual.' };
    }
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
        return { valid: false, message: PASSWORD_RULE_TEXT };
    }
    if (next !== confirm) {
        return { valid: false, message: 'A confirmação não confere com a nova senha.' };
    }
    if (next === current) {
        return { valid: false, message: 'A nova senha precisa ser diferente da atual.' };
    }
    return { valid: true, message: '' };
}

/**
 * How the account's e-mail should be presented, as data rather than as markup.
 *
 * THREE STATES AND NOT TWO, and the third is the one a boolean would hide: an account can carry
 * NO address at all (`POST /api/v1/users`, the administrative path, has no e-mail field), and
 * that is not the same as an unconfirmed one. Reading `email_verified` alone would draw "não
 * confirmado" over an account that has nothing to confirm.
 *
 * @param {{ email?: *, email_verified?: * }} profile - As `GET /users/me` returned it.
 * @returns {{ state: 'absent'|'unverified'|'verified', address: string, status: string }}
 */
export function emailPresentation(profile) {
    const address = typeof profile?.email === 'string' ? profile.email.trim() : '';
    if (!address) {
        return { state: 'absent', address: '', status: EMAIL_ABSENT_TEXT };
    }
    if (profile?.email_verified === true) {
        return { state: 'verified', address, status: 'confirmado' };
    }
    return { state: 'unverified', address, status: 'não confirmado' };
}

/**
 * Normalizes an address the way the comparison wants it.
 *
 * Lower-cased ONLY for comparison, never for sending: the server's uniqueness index is over
 * `LOWER(email)`, so case never decides acceptance, and lower-casing what is sent would mangle
 * addresses whose provider treats the local part as case-sensitive.
 * @param {*} value
 * @returns {string}
 */
function emailKey(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Client-side check of the e-mail-change form, so an obvious refusal never costs a round trip.
 *
 * THE SHAPE CHECK IS DELIBERATELY LOOSE (a non-empty local part, an `@`, a dot in the domain).
 * The authority is `Joi.string().email()` on the server and this may not pretend to reproduce it:
 * a stricter client rule would refuse addresses the server accepts, and the person would have no
 * way to tell that the refusal came from their own browser.
 *
 * The order of the checks is the order the form is filled, so the first complaint is about the
 * first thing that is wrong.
 *
 * @param {{ email?: *, currentPassword?: *, currentEmail?: * }} form
 * @returns {{ valid: boolean, message: string }}
 */
export function validateEmailChangeForm(form) {
    const email = typeof form?.email === 'string' ? form.email.trim() : '';
    const senha = typeof form?.currentPassword === 'string' ? form.currentPassword : '';

    if (!email) {
        return { valid: false, message: 'Informe o novo endereço de e-mail.' };
    }
    if (email.length > MAX_EMAIL_LENGTH) {
        return {
            valid: false,
            message: `O e-mail pode ter no máximo ${MAX_EMAIL_LENGTH} caracteres.`,
        };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { valid: false, message: 'Esse endereço de e-mail não parece válido.' };
    }
    if (emailKey(email) === emailKey(form?.currentEmail)) {
        return { valid: false, message: 'Este já é o e-mail da sua conta.' };
    }
    if (!senha) {
        return { valid: false, message: 'Informe a senha atual para confirmar a troca.' };
    }
    return { valid: true, message: '' };
}

/**
 * The state the API key section is in, as one word the renderer switches on.
 *
 * `idle` is NOT "there is no key": it is "no key is on screen right now", which is all this
 * client can honestly assert. See the fileoverview.
 *
 * A failure outranks a revealed key on purpose: if the last rotation failed, the key on screen
 * (if any) belongs to a previous attempt and showing it as fresh would be a lie. `rotating`
 * outranks everything because the request is in flight and neither of the other two is settled.
 *
 * @param {{ rotating?: boolean, apiKey?: *, error?: * }} section
 * @returns {'rotating'|'error'|'revealed'|'idle'}
 */
export function apiKeySectionState(section) {
    if (section?.rotating) return 'rotating';
    if (section?.error) return 'error';
    if (typeof section?.apiKey === 'string' && section.apiKey !== '') return 'revealed';
    return 'idle';
}

/**
 * Whether closing the screen would silently throw away a key.
 *
 * `copied` is set only by a SUCCESSFUL copy: a failed clipboard write leaves it false, which is
 * exactly when the person most needs to be stopped.
 * @param {{ apiKey?: *, copied?: boolean }} section
 * @returns {boolean}
 */
export function hasUncopiedKey(section) {
    return apiKeySectionState(section) === 'revealed' && section?.copied !== true;
}
