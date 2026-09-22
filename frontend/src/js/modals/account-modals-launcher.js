// Path: js/modals/account-modals-launcher.js

/**
 * @fileoverview The three dialogs the account menu opens, and the only place that loads their code.
 *
 * WHY THEY TRAVEL. `account/account.control.js` is an `IControl` instantiated by `map_sig.js`, so
 * everything it imports statically rides in the BOOT payload of the map. Three of its imports are
 * screens that only exist after a click AND only make sense with a reachable server: the login
 * form, the "novo atlas" dialog and the sharing screen. Measured in this tree on 2026-09-21, with
 * a fresh production build on BOTH sides and the ruler of
 * `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` (metade (b), `payloadDe`): the map's eager
 * payload went from 78 files / 4286417 bytes to 77 / 4218590, i.e. 67827 bytes less, about 66 kB
 * (and 1102 -> 1085 kB in gzip). The eager import graph went from 548 modules / 7867 kB of source
 * to 539 / 7647. The chunks that left the page's list account for 66439 of those bytes: login
 * (17958), "novo atlas" (15340), the sharing core (31162), the wrapper-plus-presence pair (1153)
 * and the password eye (1826), which followed the two dialogs that were its only readers here.
 *
 * THE SHARING ONE WAS ALREADY HALF-LAZY, and that is the cheapest of the three: `sidebar/tabs/
 * maps.tab.js` has fetched `@modals/sharing.modal.js` on the click since before this file existed,
 * so the static import here was the ONLY thing keeping that chunk in the boot payload. The same
 * specifier from two `import()` sites is one chunk, not two.
 *
 * WHAT IT DOES NOT COVER. `modals/login.modal.js` and `modals/create-atlas.modal.js` remain STATIC
 * imports of `projects/projects-page.js` and `projects/atlas-drive.js`. That is deliberate and it
 * is not a leak: `atlas.html` is another entry, the login form is the first thing a visitor sees
 * there, and the chunk they share stays referenced by THAT page only.
 *
 * WHAT THE CHUNK COSTS WHEN IT DOES NOT ARRIVE is the half that had to be designed rather than
 * deleted, and it is the same browser fact `modals/signup-launcher.js` documents at length: a
 * module whose fetch fails is recorded as failed in the page's MODULE MAP, so every later
 * `import()` of the SAME specifier is rejected from that record without touching the network
 * (measured in Chromium and pinned by `tests/e2e-ui/painel-de-pendencias-volta-com-a-rede.spec.js`).
 * So the failure is said OUT LOUD and the way out it offers is RELOADING THE PAGE, never "tente de
 * novo", which cannot work, and never silence, which leaves a menu item that does nothing.
 *
 * THE MEMO IS THE ONE FROM `signup-launcher.js`, imported rather than copied. It is a leaf with
 * zero static imports of its own, so reusing it costs nothing in weight and keeps ONE forgetting
 * rule in the repository instead of two that drift apart. A second copy is how "a carga que falhou
 * é esquecida" becomes true in one launcher and false in the other.
 *
 * THE SPECIFIERS ARE STRING LITERALS, and that is not style: the weight guard walks the graph with
 * a regex and only sees literals, so a template with a variable would erase the edge and leave the
 * guard measuring a graph that does not exist.
 */

import { memoizarCarga } from './signup-launcher.js';

/** Fetches `modals/login.modal.js`, at most once per success. */
export const carregarLogin = memoizarCarga(() => import('./login.modal.js'));

/** Fetches `modals/create-atlas.modal.js`, at most once per success. */
export const carregarCriarAtlas = memoizarCarga(() => import('./create-atlas.modal.js'));

/** Fetches `modals/sharing.modal.js` (the MAP's entry point, with live presence wired). */
export const carregarCompartilhamento = memoizarCarga(() => import('./sharing.modal.js'));

/**
 * What each screen is called in a sentence, and what the person came to do with it.
 *
 * TWO FIELDS AND NOT ONE, because the sentence names the screen AND the act: "atualize a página"
 * on its own tells someone to throw away what they have without saying what they get back. The
 * words are the ones on the command that was clicked ("Entrar", "Enviar ao servidor",
 * "Compartilhar"), never "chunk", "módulo" nor "import": the person did not ask for a module.
 */
const TELAS = Object.freeze({
    login: Object.freeze({ assunto: 'o formulário de login', acao: 'entrar na sua conta' }),
    criarAtlas: Object.freeze({
        assunto: 'a tela de novo atlas',
        acao: 'enviar o seu atlas ao servidor',
    }),
    compartilhamento: Object.freeze({
        assunto: 'a tela de compartilhamento',
        acao: 'compartilhar o atlas',
    }),
});

/** The degraded pair, for a key nobody registered. See {@link telaIndisponivelTexto}. */
const TELA_GENERICA = Object.freeze({ assunto: 'esta tela', acao: 'abri-la' });

/**
 * What to say when a screen's code did not arrive.
 *
 * BOTH BRANCHES END AT THE SAME ACT, the reload, because the module map leaves no other way out
 * (see the `@fileoverview`). What the online bit changes is WHEN that act is worth doing, and
 * getting it wrong is what a single sentence could not avoid: the map's own boot is fail-fast on
 * `GET /api/config`, so telling someone with no connection to reload trades the screen they have
 * for "EBGeo indisponível".
 *
 *   - offline: the network is named, and the reload is made CONDITIONAL on it coming back;
 *   - online: the likeliest remaining cause is a build swapped under an open session, which is
 *     named, and the reload is immediate.
 *
 * AN UNKNOWN VALUE OF `online` FALLS TO THE ONLINE SENTENCE, on purpose: it is the one whose
 * advice works right now, so a missing `navigator.onLine` degrades into an act rather than a wait.
 * AN UNKNOWN `tela` degrades to a generic pair rather than interpolating `undefined`, which is the
 * one outcome a phrase function must never produce.
 *
 * @param {string} tela - A key of {@link TELAS}.
 * @param {*} online - `navigator.onLine`, or anything else.
 * @returns {string} A pt-BR sentence.
 */
export function telaIndisponivelTexto(tela, online) {
    const { assunto, acao } = Object.hasOwn(TELAS, tela) ? TELAS[tela] : TELA_GENERICA;
    if (online === false) {
        return `Sem conexão para carregar ${assunto}. Quando a rede voltar, atualize a página `
            + `para ${acao}.`;
    }
    return `Não foi possível carregar ${assunto}. O EBGeo pode ter sido atualizado no servidor: `
        + `atualize a página para ${acao}.`;
}

/**
 * Loads the login dialog and shows it. Rejects when the module does not arrive; the caller that
 * owns the clicked command is the one that says so, because it is the one that can name it.
 * @param {Object} options - Passed through to `showLoginModal`.
 * @returns {Promise<Object>} The modal.
 */
export async function abrirLogin(options) {
    const { showLoginModal } = await carregarLogin();
    return showLoginModal(options);
}

/**
 * Loads the "novo atlas" dialog and shows it.
 * @param {Object} options - Passed through to `showCreateAtlasModal`.
 * @returns {Promise<Object>} The modal.
 */
export async function abrirCriarAtlas(options) {
    const { showCreateAtlasModal } = await carregarCriarAtlas();
    return showCreateAtlasModal(options);
}

/**
 * Loads the sharing dialog and shows it.
 *
 * `aindaQuerido` IS ASKED AFTER THE LOAD AND NOT BEFORE, which is the whole of it: the module
 * travels over the network, and the atlas it is about can be closed, deleted by an owner or
 * swapped for another while it does. Without the question the answer arrives late and a sharing
 * screen opens over an atlas nobody is in.
 *
 * @param {string} atlasId - Atlas to manage sharing for.
 * @param {Object} [options] - Passed through to `showSharingModal`.
 * @param {{ aindaQuerido?: () => boolean }} [gate] - Asked once the code is here.
 * @returns {Promise<Object|null>} The modal, or `null` when the gesture was abandoned.
 */
export async function abrirCompartilhamento(atlasId, options = {}, { aindaQuerido } = {}) {
    const { showSharingModal } = await carregarCompartilhamento();
    if (typeof aindaQuerido === 'function' && !aindaQuerido()) return null;
    return showSharingModal(atlasId, options);
}
