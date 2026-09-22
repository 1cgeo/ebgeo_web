// Path: js/utilities/carga-sob-demanda.model.js

/**
 * @fileoverview The RULES of an on-demand load that fails: which failures are a load failure, what
 * to do after one, whether a newer build was published, and what the person reads. Pure, with
 * ZERO imports, so every decision is testable in node (`tests/unit/carga-sob-demanda.test.js`)
 * and the module can be read by any page without dragging anything along.
 *
 * WHAT WAS MEASURED ON 2026-09-22 (release 1c3c19c9): six defects with a dynamic import that did
 * not arrive (`cesium-integration`, `military-tools`, and the CSS of the 3D viewer), and 404s in
 * the nginx log for chunks with hashes that the release on disk no longer has. Two causes that a
 * browser reports identically: a transient 502 of the network, and a tab opened BEFORE a deploy
 * asking for the previous build's file names. Until then the click did nothing, or left a tool
 * half on, and the only trace was the defect table.
 *
 * WHAT A SECOND ATTEMPT CAN AND CANNOT FIX, and this is the part that must not be promised wrong:
 *
 *   - a failed CSS preload ("Unable to preload CSS for ...") rejects BEFORE the module itself is
 *     requested, so nothing is poisoned. Loading the stylesheet again and calling the loader again
 *     works, and it is the only case where the retry is a real repair;
 *   - a failed MODULE fetch is recorded as failed in the page's module map, and every later
 *     `import()` of the same specifier is refused from that record without touching the network
 *     (measured in Chromium and Firefox on 2026-09-20; see `modals/signup-launcher.js`). The retry
 *     costs nothing there and is kept so a browser that stops caching failures gets the repair for
 *     free, but the notice is what actually rescues the person: a new page is the only fix.
 *
 * A cache-busting specifier is NOT a fix, and the reason is in `modals/signup-launcher.js`: in the
 * bundle the specifier is a hashed chunk the bundler owns, and a second copy under another URL
 * would split module state from every other importer of the same chunk.
 */

/** How long the second attempt waits, in ms: enough for a 502 blip, short enough to feel instant. */
export const ESPERA_DA_NOVA_TENTATIVA_MS = 700;

/** The label of the button. The gesture is the person's, never the page's. */
export const ROTULO_RECARREGAR = 'Recarregar';

/** The accessible label of the close control. */
export const ROTULO_FECHAR = 'Fechar aviso';

/**
 * What the person reads. Three sentences because the advice differs, never because the cause does:
 * no status code, no "módulo", no "chunk" (the person clicked a function, not a file).
 */
export const FRASES_DE_CARGA = Object.freeze({
    generica: 'Não foi possível carregar esta função. Recarregue a página para continuar.',
    versaoNova: 'Uma versão nova foi publicada. Recarregue a página para continuar.',
    // Offline, reloading trades this screen for "EBGeo indisponível" (the map boot is fail-fast on
    // `GET /api/config`), so the reload is made CONDITIONAL on the network coming back.
    semRede: 'Sem conexão para carregar esta função. Quando a rede voltar, recarregue a página.',
});

/**
 * The messages a browser uses for a dynamic import whose FETCH failed, plus Vite's own for a CSS
 * dependency. One line per engine, and each was taken from the engine's real text:
 *   - Chromium: "Failed to fetch dynamically imported module: <url>";
 *   - Firefox: "error loading dynamically imported module: <url>";
 *   - Safari: "Importing a module script failed.";
 *   - Vite's preload helper: "Unable to preload CSS for <url>".
 * An error thrown WHILE EVALUATING a module that did arrive is not in this list, on purpose: a
 * retry cannot fix a bug, and a "recarregue" would send the person to the same bug.
 */
const PADROES_DE_FALHA_DE_CARGA = Object.freeze([
    /Failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /Importing a module script failed/i,
    /Unable to preload CSS for/i,
]);

/**
 * Whether an error is an on-demand load that did not ARRIVE.
 * @param {*} erro - Whatever a rejected `import()` produced.
 * @returns {boolean}
 */
export function ehFalhaDeCarga(erro) {
    let mensagem = '';
    try {
        mensagem = typeof erro === 'string' ? erro : String(erro?.message ?? '');
    } catch {
        return false;
    }
    return PADROES_DE_FALHA_DE_CARGA.some((padrao) => padrao.test(mensagem));
}

/**
 * The stylesheet a failed CSS preload was about, or null.
 * @param {*} erro
 * @returns {string|null}
 */
export function urlDoCssQueFalhou(erro) {
    let mensagem = '';
    try {
        mensagem = String(erro?.message ?? '');
    } catch {
        return null;
    }
    const achado = mensagem.match(/Unable to preload CSS for\s+(\S+)/i);
    return achado ? achado[1] : null;
}

/**
 * What to do after an attempt failed. ONE retry, then the notice; anything that is not a load
 * failure goes back to the caller untouched, on the first attempt.
 * @param {*} erro - The rejection of attempt number `tentativa`.
 * @param {number} tentativa - 1 for the first attempt, 2 for the retry.
 * @returns {'relancar'|'tentar-de-novo'|'avisar'}
 */
export function decidirAposFalha(erro, tentativa) {
    if (!ehFalhaDeCarga(erro)) return 'relancar';
    return tentativa <= 1 ? 'tentar-de-novo' : 'avisar';
}

/**
 * The `src` of every module script in an HTML document, in document order.
 *
 * Attribute order is free in HTML and Vite writes `type` before `src`, so both orders are read.
 * @param {string} html
 * @returns {string[]}
 */
export function entradasDaPagina(html) {
    if (typeof html !== 'string') return [];
    const entradas = [];
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
        if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
        const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (src) entradas.push(src[1]);
    }
    return entradas;
}

/**
 * Whether the page published NOW is another build than the one this tab runs.
 *
 * THE CHEAP WITNESS IS THE ENTRY SCRIPT: every build writes its hash into the name, and the tab
 * still carries its own in the DOM. It costs one GET of a public HTML file, and it reveals nothing
 * the server hides on purpose (the commit stays behind `GET /api/v1/diag/status`).
 *
 * @param {string} htmlPublicado - The page as the server serves it now.
 * @param {string[]} entradasDaAba - `src` of the module scripts this tab loaded.
 * @returns {boolean|null} True when an entry of this tab is missing from the published page;
 *   null when either side has no entry (nothing to compare is not "the same build").
 */
export function versaoNovaPublicada(htmlPublicado, entradasDaAba) {
    const publicadas = entradasDaPagina(htmlPublicado);
    const daAba = Array.isArray(entradasDaAba) ? entradasDaAba.filter((e) => typeof e === 'string' && e) : [];
    if (publicadas.length === 0 || daAba.length === 0) return null;
    return daAba.some((entrada) => !publicadas.includes(entrada));
}

/**
 * The sentence of the notice.
 * @param {{versaoNova?: (boolean|null), online?: *}} [estado]
 * @returns {string}
 */
export function fraseDeFalhaDeCarga({ versaoNova = null, online = true } = {}) {
    if (online === false) return FRASES_DE_CARGA.semRede;
    if (versaoNova === true) return FRASES_DE_CARGA.versaoNova;
    return FRASES_DE_CARGA.generica;
}
