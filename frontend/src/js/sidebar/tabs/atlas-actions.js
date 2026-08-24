// Path: js/sidebar/tabs/atlas-actions.js

/**
 * @fileoverview WHICH commands the "Mapas" tab offers, as a PURE decision.
 *
 * WHY IT IS NOT IN `maps.tab.js` ANY MORE. The table lived there as a module const, and the
 * only way to verify it was to parse the file as text: the tab imports Sortable, the store
 * barrel and MapLibre-bound helpers, none of which load in the node-only test environment of
 * this package. Now the question "what does THIS person see in THIS state" is a function of
 * three plain values, so it is answered by assertion instead of by regex.
 *
 * The module is deliberately dependency-light: the single import is
 * `projects/permission-levels.js`, itself a zero-import leaf. Keep it that way, so a test can
 * load this file without loading the map.
 *
 * TWO INPUTS DECIDE, AND THEY ARE ORTHOGONAL:
 *   - the STORE (local vs. server atlas, plus "is anyone signed in"), which picks the row of
 *     {@link ACTIONS_BY_STATE};
 *   - the PERSON's rung on the per-atlas ladder, which decides the two access commands inside
 *     the server row.
 *
 * Gate by RANK, never by a closed list of level names: `perm === 'write' || perm === 'owner'`
 * silently drops `manage`, which sits above write, and that exact bug shipped twice here.
 */

import { atlasRoleHasAtLeast } from '@js/projects/permission-levels.js';

/**
 * The three states the actions grid distinguishes.
 * @readonly @enum {string}
 */
export const AtlasTabState = Object.freeze({
    /** No session, so necessarily on a local atlas. */
    LOCAL_ANON: 'local-anon',
    /** Signed in, still working on a LOCAL atlas (not connected to a server project). */
    LOCAL_SIGNED_IN: 'local-signed-in',
    /** Connected to a server atlas (a public-link visitor counts, session or not). */
    REMOTE: 'remote'
});

/**
 * THE approved visibility table, in one place, so the reader sees the three columns instead of
 * reconstructing them from scattered booleans. Reasons a row is missing an action:
 *
 * - `save-server` needs a session (there is nowhere to send to) AND a local atlas: it PROMOTES
 *   this workspace to a new server project, which is meaningless while already connected to one.
 * - `clear` is hidden on a server atlas because clearing would only empty THIS client's copy of
 *   a project that lives on the server; leaving a server atlas is the project screen or logout.
 *   It stays for a signed-in user working locally: it used to vanish the moment you signed in,
 *   which stranded that user with no way to wipe their own workspace.
 *
 * `open`, `import` and `save` are in every row: they belong to the atlas you have, whatever it is.
 *
 * THE SERVER ROW IS A CEILING, NOT THE ANSWER. Two of its ids are further gated by the person's
 * rung; see {@link visibleAtlasActions}. A row is what the STORE allows, and it is on purpose
 * that the ladder never edits this table: reading the table alone must never be mistaken for
 * reading the gate.
 * @type {Object<string, string[]>}
 */
export const ACTIONS_BY_STATE = Object.freeze({
    [AtlasTabState.LOCAL_ANON]: ['open', 'import', 'save', 'clear'],
    [AtlasTabState.LOCAL_SIGNED_IN]: ['open', 'save-server', 'import', 'save', 'clear'],
    // "share" fica ao lado de "save" (Exportar) porque as duas respondem "como isto sai daqui".
    // Só no estado REMOTE: compartilhar um atlas local não significa nada (cláusula 7.5).
    //
    // "participants" é o IRMÃO SOMENTE-LEITURA de "share", e os dois nunca aparecem juntos: ver
    // `visibleAtlasActions`. Ele existe porque a cláusula 5.7 diz que todo participante vê quem
    // mais participa e com que nível, e dentro do mapa não havia nenhuma porta para isso depois
    // que "Compartilhar" passou a sumir para quem não gere.
    //
    // "save-local" é o SIMÉTRICO de "save-server" e só existe no estado REMOTE pela mesma razão
    // que aquele só existe nos locais: guardar uma cópia local de um atlas que já É local não
    // significa nada (para isso existe duplicar, na tela de atlas). Ele fica aqui, e não no
    // cartão do atlas em `atlas.html`, porque aquela página não monta store nenhum e não faz a
    // soma de recursos privados: sem a soma, a poda falharia FECHADA e a cópia sairia sem o
    // catálogo público inteiro.
    [AtlasTabState.REMOTE]: ['open', 'import', 'save', 'save-local', 'share', 'participants']
});

/**
 * The minimum rung the SERVER requires to read or write the sharing config of an atlas
 * (`GET|POST|PATCH|DELETE /atlas/:atlasId/sharing`, all four on `requireAtlasPermission`).
 *
 * Written once, as a named constant, because the client must not offer a door the server
 * refuses: that is the failure this whole change exists to remove.
 * @type {string}
 */
const SHARING_RUNG = 'manage';

/**
 * WHICH of the three states the tab is in. There are three, not two: "logged out" and
 * "signed in on the local store" differ by one action, and a signed-in user working locally
 * used to be treated as if they were connected.
 *
 * A public-link visitor (anonymous ON a server atlas) lands in REMOTE, which is right: the
 * question each row asks is about the store, not about the person.
 * @param {{remote?: boolean, authenticated?: boolean}} [context]
 * @returns {string} A key of {@link ACTIONS_BY_STATE}.
 */
export function atlasTabState({ remote = false, authenticated = false } = {}) {
    if (remote) return AtlasTabState.REMOTE;
    return authenticated ? AtlasTabState.LOCAL_SIGNED_IN : AtlasTabState.LOCAL_ANON;
}

/**
 * THE COMMANDS THIS PERSON SEES, in table order.
 *
 * "Compartilhar" USED TO BE UNGATED, and the comment defending that said a Gestor demoted
 * mid-session would watch the button vanish with no explanation. That case is real and it is
 * rare; what it bought was a dead end in the COMMON case, because the server requires
 * {@link SHARING_RUNG} on every sharing route and a public-link visitor is refused one layer
 * earlier still (`confineVisitorPrincipal`, `backend/src/middleware/auth.js`), so the Leitor,
 * the Comentarista, the Editor and the link visitor all got a button whose click died in a
 * generic error. The owner of the product decided the button goes. 2026-08-23.
 *
 * WHAT THE OLD REASONING PROTECTED IS KEPT, and it was cheap: the tab already re-runs this
 * decision on `SESSION_CHANGED` and on `CONNECTION_STATE_CHANGED` (`maps.tab.js`,
 * `_setupEventListeners`), which are the two events a live demotion arrives on. So the swap
 * happens on the same repaint that changes the padlock and the atlas header, not underneath a
 * click. It is still silent, in the sense that no toast announces it; a toast fired by a
 * background role change would be worse, because it would also fire on every reconnect.
 *
 * WHO REACHES THE READ-ONLY DOOR, then: everyone the button just left, minus the public-link
 * visitor. `participants` is the answer to "quem participa e com que nível" (cláusula 5.7), it
 * reads `GET /atlas/overview`, and that route needs a real account (the visitor's own token is
 * confined to its atlas and the route names no atlas, so it answers 403). Offering it to the
 * visitor would swap one dead end for another.
 *
 * FAIL-CLOSED ON AN UNKNOWN LEVEL: `atlasRoleHasAtLeast` ranks anything it does not recognize
 * BELOW `read`, so a role this build has never heard of gets neither door. Losing a click is
 * cheaper than offering an action the server refuses.
 *
 * A FRESH ARRAY every call, so a caller may sort or filter it without poisoning the next one.
 * @param {Object} [context]
 * @param {boolean} [context.remote] - Is the mounted store a SERVER atlas?
 * @param {boolean} [context.authenticated] - Is there a real account signed in?
 * @param {*} [context.role] - `sessionContext.role` (a `UserRole`) or a raw server permission.
 * @returns {string[]} Action ids, in the order {@link ACTIONS_BY_STATE} declares them.
 */
export function visibleAtlasActions({ remote = false, authenticated = false, role = null } = {}) {
    const state = atlasTabState({ remote, authenticated });
    const row = ACTIONS_BY_STATE[state];
    if (state !== AtlasTabState.REMOTE) return [...row];

    const manages = atlasRoleHasAtLeast(role, SHARING_RUNG);
    return row.filter((id) => {
        if (id === 'share') return manages;
        if (id === 'participants') return authenticated && !manages;
        return true;
    });
}
