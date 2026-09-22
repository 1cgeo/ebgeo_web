// Path: js/admin/admin-icon-button.js

/**
 * @fileoverview Compact icon buttons for the row actions of the "Usuários" table.
 *
 * WHY THEY EXIST. The row carried up to four TEXT buttons (Editar, Senha, Aprovar, Desativar or
 * Reativar), and the actions column is sized by its widest row (`width: 1%` plus `nowrap`, see
 * `.admin-users__actions` in `css/admin.css`): the text row took width from every other column,
 * and PAPEL was the one squeezed first (owner's request, 2026-09-22). An icon button is a fixed
 * square, so the column costs the same on every row.
 *
 * THE ACCESSIBLE NAME IS STILL THE ACTION. The icon is decoration (`aria-hidden`, `focusable`
 * false), and the name lives in `aria-label` with the same words in `title`, so a screen reader
 * and a hovering mouse read the verb the button used to show. The e2e layer drives these
 * buttons by `data-testid`, never by text, and a spec that looks one up by role and name
 * (`getByRole('button', { name: 'Editar' })`) keeps matching.
 *
 * ZERO IMPORTS, on purpose: `admin.html` boots without the store, and a leaf module cannot drag
 * a barrel in. The table below is pure data, so `tests/unit/admin-botoes-de-icone.test.js` reads
 * it in plain node.
 *
 * Every icon is static markup written here, never user data.
 */

/**
 * The product's pencil, the same drawing as the "edit" icon of `sidebar/tabs/maps.tab.js` and
 * `sidebar/tabs/briefings.tab.js`.
 */
const ICON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

/**
 * The key, the same drawing as the rail icon of "Concessões" (`admin-dom.js`). A key and not a
 * padlock: in this product the padlock already means a LOCKED thing (a locked map, the "Privado"
 * badge), and resetting a password hands out a credential, which is what a key is.
 */
const ICON_PASSWORD = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.3-8.3"/><path d="m16 6 3 3"/><path d="m19 3 2 2"/></svg>';

/**
 * An envelope with a check: approving a pending account declares its E-MAIL confirmed, so the
 * glyph is about the address and not about the person (the person glyph belongs to reactivation).
 */
const ICON_APPROVE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/><path d="m16 19 2 2 4-4"/></svg>';

/**
 * The power switch, and not a trash can: deactivating is `is_active = false`, the row stays in
 * the table and the account can be reactivated. A bin would promise a deletion that never happens.
 */
const ICON_DEACTIVATE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>';

/**
 * A person with a check, and deliberately NOT an undo arrow nor the power switch again.
 * Reactivating does not undo the deactivation (the pruned grants stay revoked, see
 * `reactivationNotice`), so a "back" glyph would promise the symmetry the confirmation exists to
 * deny; and the same switch in another colour would tell the two apart by colour alone.
 */
const ICON_REACTIVATE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>';

/** The two looks a row action takes, both already defined by `.admin-btn--*` in `admin.css`. */
export const IconButtonVariant = Object.freeze({
    GHOST: 'ghost',
    DANGER: 'danger',
});

/**
 * The row actions of the "Usuários" table: accessible name, icon, look and test id.
 *
 * `label` is the verb the text button used to show. The one word that changed is "Senha", a noun
 * that named the field and not the action: alone in a tooltip over a key it does not say what the
 * click does, and "Redefinir senha" is what the form it opens is titled.
 *
 * @type {Readonly<Record<string, {label: string, icon: string, variant: string, testid: string}>>}
 */
export const USER_ROW_ACTION = Object.freeze({
    EDIT: Object.freeze({
        label: 'Editar', icon: ICON_EDIT, variant: IconButtonVariant.GHOST, testid: 'admin-user-edit',
    }),
    PASSWORD: Object.freeze({
        label: 'Redefinir senha', icon: ICON_PASSWORD, variant: IconButtonVariant.GHOST,
        testid: 'admin-user-password',
    }),
    APPROVE: Object.freeze({
        label: 'Aprovar', icon: ICON_APPROVE, variant: IconButtonVariant.GHOST,
        testid: 'admin-user-approve',
    }),
    DEACTIVATE: Object.freeze({
        label: 'Desativar', icon: ICON_DEACTIVATE, variant: IconButtonVariant.DANGER,
        testid: 'admin-user-deactivate',
    }),
    REACTIVATE: Object.freeze({
        label: 'Reativar', icon: ICON_REACTIVATE, variant: IconButtonVariant.GHOST,
        testid: 'admin-user-reactivate',
    }),
});

/**
 * The class list of an icon button. An unknown variant falls back to the ghost look instead of
 * producing `admin-btn--undefined`, which would draw a button with no border and no hover.
 * @param {string} [variant]
 * @returns {string}
 */
export function iconButtonClassName(variant) {
    const known = Object.values(IconButtonVariant).includes(variant) ? variant : IconButtonVariant.GHOST;
    return `admin-btn admin-btn--${known} admin-btn--icon`;
}

/**
 * Builds one icon button from a row action.
 * @param {{label: string, icon: string, variant?: string, testid?: string}} action
 * @param {?Function} onClick
 * @returns {HTMLButtonElement}
 */
export function createIconButton(action, onClick) {
    const btn = document.createElement('button');
    // Explicit, because a button with no type inside a form is a SUBMIT button.
    btn.type = 'button';
    btn.className = iconButtonClassName(action.variant);
    if (action.testid) btn.dataset.testid = action.testid;
    btn.setAttribute('aria-label', action.label);
    btn.title = action.label;
    // Static icon markup from the table above, never user data.
    btn.innerHTML = action.icon;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
}
