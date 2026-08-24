// Path: js/store/sync/resource-access-phrases.js

/**
 * @fileoverview WHAT THE SCREEN SAYS when the private-catalogue sum did not land, plus the
 * four-way outcome vocabulary that decides whether it says anything at all.
 *
 * ZERO IMPORTS, and that is a contract, for the same reason as `store/denial-phrases.js`:
 * this is read by a MapLibre control that lives in the map's top bar, and anything reachable
 * from here would ride along into that bundle. It also keeps the whole thing testable in
 * plain node.
 *
 * THE DEFECT IT EXISTS TO CLOSE, and it erases a whole global role in silence.
 * `refreshVisibleResources` is best-effort by design: its `catch` returns `false` and never
 * propagates, and all three call sites (`sync-engine.login`, the atlas-open overlay and the
 * boot in `index.js`) drop that `false` on the floor. When the FIRST sum of a session fails,
 * `_privados` stays empty and stays empty forever. For an account whose global role is
 * `credenciado` (it reads every private resource of the collection), the consequence is
 * total: `isPrivateResource` answers `false` for everything, no card is marked "Privado",
 * the "Compartilhar" action (gated on `privado && canShareResource(...)`) disappears with the
 * role fully intact, and the catalogue becomes byte for byte the one an anonymous visitor
 * sees. Nothing on screen says so.
 *
 * FALSE COVERS THREE OUTCOMES AND ONLY ONE OF THEM IS A FAILURE. The sum can come back
 * unapplied because the server was unreachable (a failure, and the only one a person can act
 * on), because a newer request superseded this one, or because the sum was wiped mid-flight
 * (logout, disconnect). The last two are the normal ending of a race that the service
 * deliberately arbitrates by comparing counters ON ARRIVAL, and lighting a warning for them
 * would mean accusing the product of an error every time somebody switches atlas quickly.
 * That is how a warning teaches people to ignore warnings.
 *
 * THE SENTENCE NAMES THE EFFECT, NEVER THE CAUSE. "Um endpoint falhou" is not something a
 * person can act on, and it is not what happened to them: what happened is that their private
 * collection is missing from the catalogue while their account is untouched. Saying the
 * account is intact is the half the person cannot possibly know, and it is the half that
 * stops them from concluding that access was taken away from them.
 */

/**
 * How one requested sum ended.
 *
 * `SUPERSEDED` and `CLEARED` are told apart because the service can tell them apart (two
 * independent counters) and because they mean different things to a reader of a diagnostic:
 * the first is two requests racing, the second is the session ending underneath one. Neither
 * is a failure, so for the purposes of {@link resourceAccessDegradedAfter} they behave the
 * same; keeping them distinct costs one line and buys a truthful answer from
 * `lastResourceSumOutcome()`.
 * @enum {string}
 */
export const ResourceSumOutcome = Object.freeze({
    /** The payload landed and the sum is in the `config` baseline. */
    APPLIED: 'applied',
    /** The server was unreachable, refused, or answered something unusable. */
    FAILED: 'failed',
    /** A newer request was issued while this one was in flight. */
    SUPERSEDED: 'superseded',
    /** The sum was wiped while this one was in flight (logout, disconnect). */
    CLEARED: 'cleared',
});

/**
 * The "the last REQUESTED sum failed" flag, folded over one outcome.
 *
 * This is the whole distinction the notice rests on, as a pure function, so it can be pinned
 * without a network double: only `FAILED` raises the flag, only `APPLIED` lowers it, and
 * every other ending (including an outcome value this build does not know) leaves it exactly
 * as it was. Defaulting an unknown outcome to `false` would silently switch the notice off on
 * the day someone adds a fifth ending; defaulting it to `true` would light it for a normal
 * race. Carrying the previous value forward is the only branch that asserts nothing new.
 *
 * @param {boolean} previous - The flag before this sum ended.
 * @param {string} outcome - A {@link ResourceSumOutcome} value.
 * @returns {boolean} The flag after it.
 */
export function resourceAccessDegradedAfter(previous, outcome) {
    if (outcome === ResourceSumOutcome.APPLIED) return false;
    if (outcome === ResourceSumOutcome.FAILED) return true;
    return previous === true;
}

/**
 * The tone of the notice, as a ROLE and not as a colour. The stylesheet resolves the token;
 * putting "amarelo" in a phrase module is design leaking into testable logic.
 * @enum {string}
 */
export const RESOURCE_NOTICE_TONE = Object.freeze({
    /** Something the person lost and can try to get back. */
    WARN: 'warn',
    /** A repair is in flight; nothing to do but wait. */
    BUSY: 'busy',
});

/**
 * What to show about the private-catalogue sum, or `null` for "show nothing".
 *
 * ANONYMOUS ALWAYS GETS `null`, and that is not an optimisation. A visitor who never signed
 * in did not lose anything: the public catalogue IS their catalogue. Telling them that a
 * private collection failed to load would be pure noise about a thing they do not have, and
 * it would be the most common case of all, which is how a warning becomes wallpaper.
 *
 * NOT MODAL AND NOT BLOCKING is a property of the caller, not of this module, but the shape
 * here encodes the intent: a short `label` for the bar, a long `detail` for `title` and
 * `aria-label`, and an `actionLabel` that is `null` exactly when there is nothing to click.
 *
 * @param {Object} [input]
 * @param {boolean} [input.authenticated] - `sessionContext.isAuthenticated()`. Anything other
 *   than `true` counts as anonymous: the question is "did this person lose something of
 *   theirs", and an uncertain answer is NO.
 * @param {boolean} [input.degraded] - Whether the last REQUESTED sum failed.
 * @param {boolean} [input.repairing] - Whether a repair attempt is in flight right now.
 * @returns {{label: string, detail: string, actionLabel: string|null, tone: string}|null}
 */
export function resourceAccessNotice({ authenticated, degraded, repairing } = {}) {
    if (authenticated !== true) return null;
    if (degraded !== true) return null;

    if (repairing === true) {
        return {
            label: 'Recuperando acervo…',
            detail: 'Buscando de novo os itens restritos a você. Até a resposta chegar, o '
                + 'catálogo continua mostrando só o conteúdo público.',
            actionLabel: null,
            tone: RESOURCE_NOTICE_TONE.BUSY,
        };
    }

    return {
        label: 'Acervo privado indisponível',
        detail: 'Os itens restritos a você não puderam ser carregados, então o catálogo está '
            + 'mostrando só o conteúdo público e as ações de compartilhar deles não aparecem. '
            + 'Sua conta e suas permissões continuam as mesmas. Clique para tentar de novo.',
        actionLabel: 'Tentar de novo',
        tone: RESOURCE_NOTICE_TONE.WARN,
    };
}
