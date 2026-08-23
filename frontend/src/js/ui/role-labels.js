// Path: js/ui/role-labels.js

/**
 * @fileoverview The pt-BR names of the GLOBAL role axis, and one sentence saying what each role
 * MAY DO, in a single definition every page can reach.
 *
 * WHY IT EXISTS. The four labels lived in ONE file, `admin/users-tab.js` (`ROLE_CHIP`), inside a
 * tab only a global administrator ever opens: they named the role of OTHER people and were
 * unreachable to the person whose role they described. Measured consequence: a `credenciado` had
 * no way to learn why they see resources a colleague does not, and a `producer` had no way to
 * learn that they may calibrate. The labels here are copied VERBATIM from that constant, and
 * `tests/unit/papel-global-rotulos.test.js` compares the two sources so they cannot drift.
 *
 * THE DESCRIPTION IS THE POINT, not the label. "Administrador" on its own teaches nobody
 * anything; the sentence is what turns a badge into an explanation, and it is meant to be shown
 * as the badge's `title` or as a secondary line, never dropped.
 *
 * IT IS NOT A LADDER. None of the four contains another (`GlobalRole` in
 * `store/sync/session-context.js` says so at length), so this module offers no ordering, no rank
 * and no comparison: only names. The ordered axis is the PER-ATLAS one, and its single
 * implementation is `projects/permission-levels.js`.
 *
 * AN UNKNOWN ROLE IS HANDLED OUT LOUD. A value the server invents after this build shipped must
 * neither vanish from the screen nor break it: the raw value becomes the badge and the sentence
 * says the app does not know that role. Falling back to "Usuário" would be the silent demotion,
 * and hiding the badge would be the silent disappearance.
 *
 * ZERO IMPORTS, and that is contract: `atlas.html`, `admin.html` and `calibracao.html` boot
 * without the store, so anything reached from here would be reached from them.
 */

/**
 * pt-BR name of each global role. Copied verbatim from `ROLE_CHIP` in `admin/users-tab.js`.
 * @type {Readonly<Object<string, string>>}
 */
export const GLOBAL_ROLE_LABELS = Object.freeze({
    user: 'Usuário',
    producer: 'Produtor',
    credenciado: 'Credenciado',
    admin: 'Administrador',
});

/**
 * What each role MAY DO, in one sentence, written for the person who holds it.
 *
 * Each sentence names the axis the role acts on, because that is the fact the four labels hide:
 * the producer acts inside ONE organization, the credenciado reads the whole private catalogue
 * and writes none of it, and neither of them administers the system.
 * @type {Readonly<Object<string, string>>}
 */
export const GLOBAL_ROLE_DESCRIPTIONS = Object.freeze({
    user: 'Usa o mapa e colabora nos atlas de que participa, no nível que cada atlas lhe der.',
    producer: 'Mantém o que a sua OM produz: itens do catálogo e projetos 360, inclusive a calibração.',
    credenciado: 'Enxerga todo recurso privado do acervo e pode conceder acesso a ele, sem editá-lo.',
    admin: 'Administra o sistema: contas, configuração, catálogo e acervo, em qualquer atlas.',
});

/**
 * Whether `role` is one of the four values this build knows.
 * @param {*} role
 * @returns {boolean}
 */
export function isKnownGlobalRole(role) {
    return typeof role === 'string' && Object.hasOwn(GLOBAL_ROLE_LABELS, role);
}

/**
 * Display name of a global role. An unknown value falls back to its own raw text (trimmed): a
 * badge reading `auditor` is a legible surprise, while no badge is the silent failure. Only an
 * absent/empty role yields an empty string.
 * @param {*} role
 * @returns {string}
 */
export function getGlobalRoleLabel(role) {
    if (isKnownGlobalRole(role)) return GLOBAL_ROLE_LABELS[role];
    if (typeof role === 'string') return role.trim();
    return '';
}

/**
 * The sentence for a global role. An unknown value gets a sentence that SAYS it is unknown,
 * naming it, instead of borrowing the sentence of another role.
 * @param {*} role
 * @returns {string} Empty only when there is no role at all.
 */
export function getGlobalRoleDescription(role) {
    if (isKnownGlobalRole(role)) return GLOBAL_ROLE_DESCRIPTIONS[role];
    const raw = getGlobalRoleLabel(role);
    if (!raw) return '';
    return `Papel "${raw}" definido pelo servidor. Esta versão do aplicativo não sabe descrevê-lo: `
        + 'consulte o administrador.';
}

/**
 * The badge a screen draws for the signed-in person: one word plus the sentence that explains it.
 *
 * @param {*} role - The GLOBAL role (`sessionContext.globalRole`).
 * @param {Object} [context]
 * @param {string} [context.orgName] - Display name of the organization a PRODUCER maintains. It
 *   is appended to the sentence, because the scope is the boundary that role acts inside, and
 *   until now the only screen showing it was the catalogue's create form.
 * @returns {{label: string, title: string}|null} Null when there is no role to show, which is the
 *   anonymous visitor: inventing a "Visitante" badge would state something the server never said.
 */
export function globalRoleBadge(role, { orgName = '' } = {}) {
    const label = getGlobalRoleLabel(role);
    if (!label) return null;
    let title = getGlobalRoleDescription(role);
    const om = typeof orgName === 'string' ? orgName.trim() : '';
    if (om && role === 'producer') {
        title += ` OM: ${om}.`;
    }
    return { label, title };
}
