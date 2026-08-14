// Path: js/deep-link/route-decision.js

/**
 * @module deep-link/route-decision
 * @description The boot's phase -1 decision: hand this visit over to `projetos.html`,
 * or build the map?
 *
 * It lives here, out of `index.js`, for one reason: `index.js` calls `initApp()` at
 * import time, so nothing in it can be exercised by a test. The rule below has now
 * been wrong once in a way only behaviour revealed (the hash was dropped, see the
 * doc of `shouldRouteToProjects`), and a rule that has already broken belongs where
 * a guard can reach it.
 */

// From `./parse.js`, never from `./deep-link.js`: the openers there pull in
// `@store` and the `@utils` barrel, and this decision runs before either exists.
import { parseDeepLink } from './parse.js';
import { hasLocalMapIntent } from './local-intent.js';

/**
 * Whether this boot should hand over to the project chooser page instead of building a map.
 *
 * True only for a signed-in visitor at a bare `/`. Every other case belongs on the map:
 *   - `?atlas=` / `?atlasPublico=` — the URL already names what to open;
 *   - `#view=360` / `#view=3d` / `#view=fp` — so does the hash;
 *   - `?verify=` — a one-shot e-mail confirmation that must be consumed here;
 *   - "Mapa local" — an explicit, tab-scoped choice to work without a server project;
 *   - anonymous — the map IS the product for someone not signed in.
 *
 * The hash clause is a BUG FIX, not a new feature of the first-person link. The redirect
 * is `window.location.replace('./projetos.html')`, which carries no fragment: a signed-in
 * visitor opening a shared `#view=…` link landed on "Seus projetos" and the payload of the
 * link was gone, with nothing logged and nothing to retry. It was already true for
 * `#view=360` and `#view=3d`; the first-person scene made it intolerable, because
 * "Compartilhar esta posição" is one of the three tools inside the scene — the link IS the
 * product. Deciding from `parseDeepLink()` rather than from "the hash is non-empty" keeps
 * the three viewers and this router reading the same grammar: a hash that names no viewer
 * (`#`, `#algo`) is not a reason to skip the chooser.
 *
 * @param {{atlasId: string}|null} atlasLink - The parsed `?atlas=` deep link, if any.
 * @param {string|null} publicLink - The `?atlasPublico=` link, if any.
 * @param {boolean} hasStoredTokens - Whether a persisted session exists. Passed in rather
 *   than read here so the decision stays free of the API client (and testable without it).
 * @returns {boolean}
 */
export function shouldRouteToProjects(atlasLink, publicLink, hasStoredTokens) {
    if (atlasLink || publicLink) return false;
    if (parseDeepLink()) return false;
    if (new URLSearchParams(window.location.search).has('verify')) return false;
    if (hasLocalMapIntent()) return false;
    return !!hasStoredTokens;
}
