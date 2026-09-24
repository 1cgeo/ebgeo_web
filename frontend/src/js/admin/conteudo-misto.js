// Path: js/admin/conteudo-misto.js

/**
 * @fileoverview Would the browser BLOCK an address as mixed content on the page that saves it?
 *
 * Two fields of the Sistema tab name servers that EVERY browser of the deploy fetches from: the
 * weather source (`services.meteorologiaUrl`, fetched by the point panel) and the tile server
 * (`services.tileServerUrl`, the base of the UTM grid sources and of the tile credential). On a
 * page served over https, a `fetch` to an `http://` address is blocked as mixed content before it
 * leaves the browser, and the failure reads as "no connection" (the weather panel) or as a grid
 * that never draws. The server accepts both schemes (`config.admin.schemas.js`), and it has to:
 * it does not know which scheme the app is served over. The page that saves the value does.
 *
 * `localhost`, `127.0.0.1` and `[::1]` are NOT blocked: Chromium and Firefox treat them as
 * potentially trustworthy origins. A relative address (`/tiles`) is same-origin and never mixed.
 *
 * Zero imports on purpose: node-testable, and loadable by `admin.html` without the store.
 */

/** Hosts the browser treats as potentially trustworthy even over http. */
const HOSTS_CONFIAVEIS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {*} endereco - What the administrator typed (already trimmed).
 * @param {*} protocoloDaPagina - `location.protocol` of the page saving it.
 * @returns {boolean} True when the browser would block a fetch to it from that page.
 */
export function bloqueadaPorConteudoMisto(endereco, protocoloDaPagina) {
    if (protocoloDaPagina !== 'https:' || typeof endereco !== 'string') return false;
    let url;
    try {
        url = new URL(endereco);
    } catch {
        return false; // relative, hence same-origin
    }
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return !(HOSTS_CONFIAVEIS.has(host) || host.endsWith('.localhost'));
}

/**
 * The refusal, naming the field and what to type instead.
 * @param {string} campo - How the tab labels the field, e.g. "A fonte da previsão meteorológica".
 * @returns {string}
 */
export function fraseDeConteudoMisto(campo) {
    return `${campo} precisa começar com https://. O EBGeo é aberto em https://, e o navegador `
        + 'bloqueia endereços http:// nessa página.';
}
