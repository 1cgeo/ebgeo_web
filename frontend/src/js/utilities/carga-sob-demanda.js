// Path: js/utilities/carga-sob-demanda.js

/**
 * @fileoverview What happens when code loaded ON DEMAND does not arrive: one more attempt, and then
 * a NON-MODAL notice with a "Recarregar" button. The rules live in `carga-sob-demanda.model.js`;
 * this file is the part that touches the DOM, the network and the event of the bundler.
 *
 * TWO LAYERS, AND THEY ARE NOT REDUNDANT.
 *
 *   1. `carregarSobDemanda(() => import('...'))` wraps the DOORS of a feature (the tool registry,
 *      the Turf / milsymbol / GDAL loaders, the 3D, first-person and 360 viewers, import and
 *      export). It retries once, and notices when the retry fails. The census of those doors is
 *      `tests/unit/carga-sob-demanda-portas.test.js`.
 *   2. `instalarRedeDeCargaSobDemanda()` listens to `vite:preloadError`, the event Vite's preload
 *      helper dispatches for EVERY dynamic import of the production bundle that fails (the module
 *      and each CSS dependency; the same test pins that contract against the installed Vite). It
 *      catches the hundred-odd `import()` sites that are not doors, where a failure used to leave a
 *      click that did nothing. It never calls `preventDefault()`: prevented, the helper RESOLVES the
 *      import with `undefined`, and every `const { x } = await import(...)` would then throw a
 *      `TypeError` of its own, far from the cause.
 *
 * HOW THE TWO AVOID SPEAKING TWICE. The helper dispatches the event synchronously and rethrows the
 * SAME error object; the wrapper's `catch` runs in the microtasks that follow and CLAIMS that
 * object. The net decides one macrotask later, so a failure a door is already handling (and will
 * retry) is never announced by the net. An unguarded failure is claimed by nobody, and the net
 * speaks.
 *
 * IT NEVER RELOADS BY ITSELF. The person may have a dialog open or a gesture half done; the write
 * path is write-ahead, but the reload is the person's gesture, and the button is how it is given.
 */

import {
    ESPERA_DA_NOVA_TENTATIVA_MS,
    ROTULO_FECHAR,
    ROTULO_RECARREGAR,
    decidirAposFalha,
    ehFalhaDeCarga,
    fraseDeFalhaDeCarga,
    urlDoCssQueFalhou,
    versaoNovaPublicada,
} from './carga-sob-demanda.model.js';

/** How long a re-requested stylesheet may take before it counts as failed again, in ms. */
const PRAZO_DA_FOLHA_DE_ESTILO_MS = 10000;

/** Errors a door already handles. Weak, because an error must not outlive whoever threw it. */
const reivindicadas = new WeakSet();

/**
 * @param {*} erro
 * @returns {void}
 */
function reivindicar(erro) {
    if (erro !== null && (typeof erro === 'object' || typeof erro === 'function')) {
        reivindicadas.add(erro);
    }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function esperarPadrao(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Requests a stylesheet whose preload failed, once more.
 *
 * The preload helper already marked that URL as seen, so the retry of the loader will SKIP it: if
 * nobody fetches it again here, the feature opens without its styles. Resolves true when it loads.
 * @param {string} url - As the helper reported it (already absolute).
 * @returns {Promise<boolean>}
 */
function recarregarFolhaDeEstilo(url) {
    const doc = globalThis.document;
    if (!doc?.head || typeof doc.createElement !== 'function') return Promise.resolve(false);
    return new Promise((resolve) => {
        const link = doc.createElement('link');
        let prazo = null;
        const terminar = (ok) => {
            clearTimeout(prazo);
            link.removeEventListener('load', aoCarregar);
            link.removeEventListener('error', aoFalhar);
            if (!ok) link.remove();
            resolve(ok);
        };
        const aoCarregar = () => terminar(true);
        const aoFalhar = () => terminar(false);
        link.rel = 'stylesheet';
        link.href = url;
        link.addEventListener('load', aoCarregar);
        link.addEventListener('error', aoFalhar);
        prazo = setTimeout(aoFalhar, PRAZO_DA_FOLHA_DE_ESTILO_MS);
        doc.head.appendChild(link);
    });
}

/**
 * Loads a module on demand, with ONE retry for a load that did not arrive, and a notice when the
 * retry fails too. Anything that is not a load failure (a bug inside the module) goes back to the
 * caller at once, untouched: retrying a bug fixes nothing.
 *
 * It always REJECTS when the module does not arrive, so the caller's own `catch` keeps undoing
 * whatever it had started (loading screen, `isOpen` flags): a tool must never be left half on.
 *
 * @template T
 * @param {() => Promise<T>} carregar - The `import()` thunk. Its specifier must stay a string
 *   literal: the bundler and the weight guard only see literals.
 * @param {Object} [opcoes]
 * @param {boolean} [opcoes.avisar=true] - False for a caller that announces the failure itself.
 * @param {(ms: number) => Promise<void>} [opcoes.esperar] - Test seam.
 * @param {(url: string) => Promise<boolean>} [opcoes.recarregarCss] - Test seam.
 * @param {() => void} [opcoes.aoAvisar] - Test seam; defaults to {@link avisarFalhaDeCarga}.
 * @returns {Promise<T>}
 */
export async function carregarSobDemanda(carregar, opcoes = {}) {
    const {
        avisar = true,
        esperar = esperarPadrao,
        recarregarCss = recarregarFolhaDeEstilo,
        aoAvisar = avisarFalhaDeCarga,
    } = opcoes;
    const falhou = (erro) => {
        reivindicar(erro);
        if (avisar) aoAvisar();
        throw erro;
    };

    try {
        return await carregar();
    } catch (primeiro) {
        if (decidirAposFalha(primeiro, 1) === 'relancar') throw primeiro;
        reivindicar(primeiro);
        await esperar(ESPERA_DA_NOVA_TENTATIVA_MS);

        const css = urlDoCssQueFalhou(primeiro);
        if (css && !(await recarregarCss(css))) return falhou(primeiro);

        try {
            return await carregar();
        } catch (segundo) {
            if (decidirAposFalha(segundo, 2) === 'relancar') throw segundo;
            return falhou(segundo);
        }
    }
}

// ============================================================================================
// THE NET
// ============================================================================================

/** @type {(() => void)|null} */
let desinstalarRede = null;

/**
 * Installs the net over `vite:preloadError`. Idempotent; returns the uninstaller.
 * @param {EventTarget} [alvo=globalThis.window]
 * @param {{aoAvisar?: () => void}} [opcoes] - Test seam.
 * @returns {() => void}
 */
export function instalarRedeDeCargaSobDemanda(alvo = globalThis.window, { aoAvisar = avisarFalhaDeCarga } = {}) {
    if (!alvo || typeof alvo.addEventListener !== 'function') return () => {};
    if (desinstalarRede) return desinstalarRede;

    const pendentes = new Set();
    const aoFalharPreload = (evento) => {
        const erro = evento?.payload;
        // A module that ARRIVED and threw while evaluating also reaches this event; that is a bug,
        // and "recarregue" would send the person back to the same bug.
        if (!ehFalhaDeCarga(erro)) return;
        const timer = setTimeout(() => {
            pendentes.delete(timer);
            if (!reivindicadas.has(erro)) aoAvisar();
        }, 0);
        pendentes.add(timer);
    };

    alvo.addEventListener('vite:preloadError', aoFalharPreload);
    desinstalarRede = () => {
        alvo.removeEventListener('vite:preloadError', aoFalharPreload);
        for (const timer of pendentes) clearTimeout(timer);
        pendentes.clear();
        desinstalarRede = null;
    };
    return desinstalarRede;
}

// ============================================================================================
// THE NOTICE
// ============================================================================================

/** @type {{raiz: HTMLElement, texto: HTMLElement}|null} */
let aviso = null;

/** Sticky once true: a newer build does not un-publish itself. */
let versaoNova = null;

/** @type {Promise<boolean|null>|null} */
let consultando = null;

/** @returns {*} `navigator.onLine`, or undefined. */
function online() {
    return globalThis.navigator?.onLine;
}

/** @returns {void} */
function atualizarTexto() {
    if (!aviso) return;
    aviso.texto.textContent = fraseDeFalhaDeCarga({ versaoNova, online: online() });
}

/**
 * Asks the server for the page as it is published NOW and compares its entry script with this
 * tab's. One request at a time; any failure answers null ("unknown"), never "same build".
 * @returns {Promise<boolean|null>}
 */
function consultarVersaoPublicada() {
    if (versaoNova === true) return Promise.resolve(true);
    if (consultando) return consultando;
    const doc = globalThis.document;
    const loc = globalThis.location;
    if (!doc || !loc?.pathname || typeof globalThis.fetch !== 'function') return Promise.resolve(null);

    consultando = globalThis.fetch(loc.pathname, { cache: 'no-store', credentials: 'same-origin' })
        .then((resposta) => (resposta?.ok ? resposta.text() : null))
        .then((html) => {
            if (html === null) return null;
            const daAba = [...doc.querySelectorAll('script[type="module"][src]')]
                .map((script) => script.getAttribute('src'));
            const resultado = versaoNovaPublicada(html, daAba);
            if (resultado === true) versaoNova = true;
            return resultado;
        })
        .catch(() => null)
        .finally(() => { consultando = null; });
    return consultando;
}

/**
 * @param {Document} doc
 * @returns {{raiz: HTMLElement, texto: HTMLElement}}
 */
function montarAviso(doc) {
    const raiz = doc.createElement('div');
    raiz.className = 'aviso-de-carga';
    raiz.setAttribute('role', 'alert');

    const texto = doc.createElement('span');
    texto.className = 'aviso-de-carga__texto';

    const recarregar = doc.createElement('button');
    recarregar.type = 'button';
    recarregar.className = 'aviso-de-carga__recarregar';
    recarregar.textContent = ROTULO_RECARREGAR;
    recarregar.addEventListener('click', () => {
        // The STATE refuses the click, naming itself: reloading offline trades this screen for
        // "EBGeo indisponível", which is worse than a function that did not load.
        if (online() === false) {
            atualizarTexto();
            return;
        }
        globalThis.location?.reload();
    });

    const fechar = doc.createElement('button');
    fechar.type = 'button';
    fechar.className = 'aviso-de-carga__fechar';
    fechar.setAttribute('aria-label', ROTULO_FECHAR);
    fechar.textContent = '×';
    fechar.addEventListener('click', () => {
        raiz.remove();
        aviso = null;
    });

    raiz.append(texto, recarregar, fechar);
    doc.body.appendChild(raiz);
    return { raiz, texto };
}

/**
 * Shows the notice (one at a time; a second failure only refreshes its sentence), and asks in the
 * background whether a newer build was published, upgrading the sentence when it was.
 * A page without a document (node, a worker) does nothing.
 * @returns {void}
 */
export function avisarFalhaDeCarga() {
    const doc = globalThis.document;
    if (!doc?.body || typeof doc.createElement !== 'function') return;
    if (!aviso || !aviso.raiz.isConnected) aviso = montarAviso(doc);
    atualizarTexto();
    consultarVersaoPublicada().then(atualizarTexto, () => {});
}

/**
 * Test seam: forgets the notice, the version memo and the net.
 * @returns {void}
 */
export function resetCargaSobDemanda() {
    aviso?.raiz.remove();
    aviso = null;
    versaoNova = null;
    consultando = null;
    desinstalarRede?.();
}
