// Path: js/military_tools/military_symbol_tool/attributes/engagement-bar-codec.js

/**
 * @fileoverview THE ENGAGEMENT BAR IS ONE STRING THAT CARRIES THREE FIELDS, and this module is the
 * only place that knows how to fold them together and take them apart.
 *
 * ZERO IMPORTS, on purpose: `encodeEngagementBar` and `decodeEngagementBar` are pure, so they can
 * be exercised in plain node without a DOM. That is the whole reason this file exists.
 *
 * ================= WHY IT WAS EXTRACTED =====================================
 *
 * Until 2026-08-25 both halves lived as closures inside `createEngagementBarContent`
 * (`engagement-bar.section.js`), whose only export builds DOM. The encode ran on a `change`
 * listener and the decode hung off the returned element as `updateFromProperties`, so neither was
 * reachable from a test without a browser. The `TESTING-BACKLOG` listed the pair for months with
 * the note "extrair; nomes sugeridos, ainda não existem".
 *
 * The risk that made it worth extracting is not that either half is hard: it is that they must be
 * INVERSES of each other, and nothing checked that. They were written apart, they read apart, and
 * the round trip is only exercised by a person clicking.
 *
 * ================= THE FORMAT, AND WHERE IT IS AMBIGUOUS ====================
 *
 * `[R:]<estágio>[-<armamento>]`, where the `R:` prefix means "designação remota" and either field
 * may stand alone.
 *
 * IT IS NOT A ROUND TRIP FOR EVERY INPUT, and that is a property of the format, not of this code:
 *
 *  - a lone value has no hyphen, so decoding it cannot tell a stage from a weapon by SHAPE. The
 *    decoder resolves it by asking the catalogue (`ehEstagio`), which is why it takes that
 *    predicate as an argument instead of importing the table: the caller owns the vocabulary and
 *    this module stays a leaf;
 *  - a value containing a hyphen is ambiguous on the way back. `split('-')` used to take the first
 *    two parts and silently drop the rest, so `A-B-C` decoded to `A` + `B`. It now splits ONCE, so
 *    the weapon keeps its hyphens and `A-B-C` decodes to `A` + `B-C`. That is the half that can be
 *    made lossless; a stage with a hyphen still cannot, and the code says so where it happens;
 *  - a value starting with `R:` cannot be told from the remote prefix. Unreachable from the two
 *    catalogues today, and named here rather than guarded, because a guard would have to invent an
 *    escape that the persisted data does not have.
 *
 * Callers persist the result in `properties.engagementBar`, which reaches `milsymbol.js` and
 * travels through sync and `.ebgeo`. `null` means "no engagement bar", never the empty string.
 */

/** The remote-designation prefix. */
const REMOTE_PREFIX = 'R:';

/** What joins stage and weapon. */
const SEPARATOR = '-';

/**
 * Folds stage, weapon and the remote flag into the single persisted string.
 *
 * @param {{stage?: string, weapon?: string, remote?: boolean}} parts
 * @returns {string|null} The persisted value, or `null` when there is nothing to persist.
 */
export function encodeEngagementBar({ stage = '', weapon = '', remote = false } = {}) {
    const s = typeof stage === 'string' ? stage : '';
    const w = typeof weapon === 'string' ? weapon : '';

    // NEITHER field set means the bar is absent, and absent is `null` rather than `''`: the
    // property is read as a truthiness test downstream, and an empty string would round-trip into
    // a bar that draws nothing while claiming to exist.
    if (!s && !w) return null;

    const body = s && w ? `${s}${SEPARATOR}${w}` : (s || w);
    return remote ? `${REMOTE_PREFIX}${body}` : body;
}

/**
 * Takes the persisted string apart, back into the three controls.
 *
 * @param {*} value - The persisted `engagementBar`, or anything at all.
 * @param {{isStage?: (candidate: string) => boolean}} [options] - `isStage` resolves the ambiguous
 *   lone value. Omitted, a lone value is read as a WEAPON, which is what the previous inline
 *   implementation did when the stage table did not know the value.
 * @returns {{stage: string, weapon: string, remote: boolean}} Always all three, never partial.
 */
export function decodeEngagementBar(value, { isStage } = {}) {
    const vazio = { stage: '', weapon: '', remote: false };
    if (typeof value !== 'string' || value === '') return vazio;

    let corpo = value;
    let remote = false;
    if (corpo.startsWith(REMOTE_PREFIX)) {
        remote = true;
        corpo = corpo.slice(REMOTE_PREFIX.length);
    }
    if (corpo === '') return { ...vazio, remote };

    const corte = corpo.indexOf(SEPARATOR);
    if (corte >= 0) {
        // SPLIT ONCE, not `split('-')`: the weapon may legitimately contain a hyphen, and taking
        // `parts[1]` used to drop everything after the second one without a word.
        return {
            stage: corpo.slice(0, corte),
            weapon: corpo.slice(corte + SEPARATOR.length),
            remote,
        };
    }

    // A lone value has no shape that tells stage from weapon; only the vocabulary can.
    const ehEstagio = typeof isStage === 'function' ? isStage(corpo) === true : false;
    return ehEstagio
        ? { stage: corpo, weapon: '', remote }
        : { stage: '', weapon: corpo, remote };
}
