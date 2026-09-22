// Path: js/admin/user-email-model.js

/**
 * @fileoverview The e-mail field of the administrator's user form, in its two uses (create and
 * edit), as rules and sentences with no DOM and no I/O.
 *
 * WHY IT EXISTS. On 2026-09-22 the owner asked that the administrator be able to type the address
 * when CREATING an account. Until then `createUserAdminSchema` had no such field, the form offered
 * the address only on edit, and the "E-mail verificado" box was drawn only when the stored row
 * already had an address. Three rules of the server now reach this form, and each one is
 * mirrored here so the screen says it BEFORE the click:
 *
 *   1. A NEW ADDRESS IS BORN PENDING, unless the SAME request says otherwise (`resolveCreationEmail`
 *      on create, `resolveAdminEmail` on edit, both in `backend/src/modules/users/users.service.js`).
 *      So the box starts UNCHECKED for a new address, and changing the address unchecks it again:
 *      a box that kept its old state would send `email_verified: true` for an address nobody
 *      looked at, which is exactly the confirmation by inertia the server refuses. Until this file,
 *      the edit form did that: the box was drawn with the stored state and ALWAYS sent.
 *   2. A PENDING ACCOUNT DOES NOT LOG IN (`login()` refuses `user.email && !user.email_verified`),
 *      and an account without an address does. The hint says which of the two the administrator is
 *      about to create.
 *   3. `email_verified` WITHOUT AN ADDRESS IS MEANINGLESS, and the payload never carries it: on
 *      edit, clearing the address with the box still checked used to send `email_verified: true`
 *      over a NULL, which `resolveAdminEmail` then wrote.
 *
 * ONE IMPORT, and it is a leaf: the loose shape rule comes from `admin/account-model.js`, which has
 * zero imports, so the two screens that type an address cannot disagree on what one looks like,
 * and this file stays loadable in node without alias resolution.
 */

import { emailAddressProblem } from './account-model.js';

/** The box label, shared by create and edit so both forms name the same act the same way. */
export const EMAIL_VERIFIED_LABEL = 'E-mail verificado (aprovar acesso)';

/** @param {*} value @returns {string} */
function trimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** @param {*} value @returns {string} The comparison key of the server's unique index. */
function emailKey(value) {
    return trimmed(value).toLowerCase();
}

/**
 * Client-side check of the address field, so an obvious refusal never costs a round trip.
 *
 * EMPTY IS VALID, and means "no address": on create that is the account that logs in at once, on
 * edit it clears the stored address. An address EQUAL to the stored one is valid too, whatever it
 * looks like, because it does not travel (see `adminEmailPayload`): refusing a legacy address
 * nobody touched would block an edit of the rank.
 *
 * @param {*} value - What the field holds.
 * @param {*} [originalEmail] - The stored address (edit), or nothing (create).
 * @returns {{ valid: boolean, message: string, email: string }} `email` is the trimmed address.
 */
export function validateAdminEmail(value, originalEmail = '') {
    const email = trimmed(value);
    if (!email) return { valid: true, message: '', email: '' };
    if (email === trimmed(originalEmail)) return { valid: true, message: '', email };
    const problem = emailAddressProblem(email);
    if (problem) return { valid: false, message: problem, email };
    return { valid: true, message: '', email };
}

/**
 * Whether the "E-mail verificado" box is offered, and in which state, for what the field holds.
 *
 * Recomputed on every change of the field. The comparison with the stored address ignores case,
 * like the server's `mesmoEmail`: a case-only edit is not a new address, and the server keeps the
 * confirmation for it, so the box keeps it too.
 *
 * @param {{ originalEmail?: *, originalVerified?: *, typedEmail?: * }} input
 * @returns {{ visible: boolean, checked: boolean }}
 */
export function verifiedBoxState({ originalEmail, originalVerified, typedEmail } = {}) {
    const typed = emailKey(typedEmail);
    if (!typed) return { visible: false, checked: false };
    if (typed === emailKey(originalEmail)) {
        return { visible: true, checked: originalVerified === true };
    }
    return { visible: true, checked: false };
}

/**
 * The e-mail part of the request body.
 *
 * CREATE: the address and the box, or nothing at all when the field is empty.
 *
 * EDIT: the address ONLY IF IT CHANGED (exact comparison, so a case fix is written), because
 * resending the same address would make the server treat the edit as a change and drop the
 * confirmation of an account nobody meant to touch; `''` clears it. The box travels whenever there
 * is an address, which keeps the approve-by-edit path working, and never when there is none.
 *
 * @param {{ isEdit?: boolean, originalEmail?: *, typedEmail?: *, verifiedChecked?: * }} input
 * @returns {{ email?: string, email_verified?: boolean }}
 */
export function adminEmailPayload({ isEdit, originalEmail, typedEmail, verifiedChecked } = {}) {
    const typed = trimmed(typedEmail);
    const verified = verifiedChecked === true;
    if (!isEdit) {
        return typed ? { email: typed, email_verified: verified } : {};
    }
    const payload = {};
    if (typed !== trimmed(originalEmail)) payload.email = typed;
    if (typed) payload.email_verified = verified;
    return payload;
}

/**
 * The hint under the field: what the administrator is about to create, said before the click.
 *
 * `canDeliver` is the server's delivery predicate as `GET /api/config` reports it
 * (`features.password_reset_email`, which IS `canDeliverAccountMail()`): only where it holds does
 * a pending account created here receive a confirmation link.
 *
 * @param {{ isEdit?: boolean, canDeliver?: boolean }} input
 * @returns {string}
 */
export function adminEmailHint({ isEdit, canDeliver } = {}) {
    if (isEdit) {
        return canDeliver === true
            ? 'Trocar o endereço desmarca "E-mail verificado": sem a marca, a conta só entra depois '
              + 'de confirmar o endereço novo, pelo link que a pessoa pede na tela de entrada.'
            : 'Trocar o endereço desmarca "E-mail verificado": este servidor não envia e-mail, '
              + 'então sem a marca a conta fica sem entrar.';
    }
    return canDeliver === true
        ? 'Opcional. Sem e-mail, a conta entra na hora. Com e-mail, ela só entra depois que a '
          + 'pessoa abrir o link de confirmação enviado a esse endereço, a menos que você marque '
          + '"E-mail verificado".'
        : 'Opcional. Sem e-mail, a conta entra na hora. Este servidor não envia e-mail: com '
          + 'e-mail e sem a marca "E-mail verificado", a conta fica sem entrar até alguém '
          + 'marcar a caixa, aqui ou depois, na edição.';
}

/**
 * The toast after a creation, from what the SERVER says it wrote, never from what was typed.
 *
 * TWO TONES: the account that cannot log in and will receive no link (a pending address where the
 * server delivers no mail) is created, but it is not a success the administrator can walk away
 * from, so it is said as a warning that names the one act that unlocks it.
 *
 * @param {{ email?: *, email_verified?: * }|null|undefined} created - The row `POST /users`
 *   returned.
 * @param {{ canDeliver?: boolean }} [options]
 * @returns {{ tone: 'success'|'warning', text: string }}
 */
export function createdUserNotice(created, { canDeliver } = {}) {
    if (!trimmed(created?.email)) return { tone: 'success', text: 'Usuário criado.' };
    if (created?.email_verified === true) {
        return {
            tone: 'success',
            text: 'Usuário criado, com o e-mail verificado: a conta já pode entrar.',
        };
    }
    if (canDeliver === true) {
        return {
            tone: 'success',
            text: 'Usuário criado. A conta entra depois que a pessoa abrir o link de confirmação '
                + 'enviado ao e-mail informado.',
        };
    }
    return {
        tone: 'warning',
        text: 'Usuário criado, mas ainda sem entrar: marque "E-mail verificado" na edição para '
            + 'liberar o acesso.',
    };
}
