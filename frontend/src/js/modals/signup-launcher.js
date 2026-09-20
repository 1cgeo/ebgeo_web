// Path: js/modals/signup-launcher.js

/**
 * @fileoverview The one door to the signup dialog, and the only place that loads its code.
 *
 * WHY THE DIALOG TRAVELS. "Criar conta" is a screen of a single visit: whoever opens it either
 * gets an account or goes back to the login form, and neither page that offers it opens it again.
 * Until 2026-09-20 it was a STATIC import of `account/account.control.js` and of
 * `projects/projects-page.js`, so it rode in the boot payload of the map AND of `atlas.html`,
 * dragging `ui/searchable-select.js`, its model and `ui/password-match.model.js` with it. (The eye
 * on the password fields, `ui/password-visibility.js`, is NOT part of that: `modals/login.modal.js`
 * uses it too, so it stays eager either way.)
 *
 * ZERO STATIC IMPORTS, and that is contract for two separate reasons. The first is the usual one:
 * `atlas.html` boots without the store, so a module both pages reach may not pull a barrel. The
 * second is that the two decisions worth pinning here (the memo and the sentence) are then
 * reachable from a node test, which is what `tests/unit/cadastro-sob-demanda.test.js` does.
 *
 * THE SPECIFIER IS A STRING LITERAL, and that is not style either: the weight guard
 * (`tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`) walks the graph with a regex and only sees
 * literals, so a template with a variable would erase the edge and leave the guard measuring a
 * graph that does not exist.
 *
 * WHAT THE CHUNK COSTS WHEN IT DOES NOT ARRIVE is the reason this was not done earlier, and it is
 * the half that needed designing rather than deleting. A dynamic import fails for two reasons that
 * a browser reports identically (a `TypeError` about a module that could not be fetched): the
 * network is gone, or the deploy replaced the build under a session that still holds the old
 * hashed name, which answers 404. The person cannot be left with a link that does nothing, so the
 * failure is named out loud, and the way out it offers is RELOADING THE PAGE.
 *
 * AND THE WAY OUT IS NOT "CLIQUE DE NOVO", WHICH WAS MEASURED AND IS FALSE. The first version of
 * this file promised a retry, because the memo below forgets a failed load and the click is left
 * enabled. The browser does not cooperate: a module whose fetch fails is recorded as failed in the
 * page's MODULE MAP, and every later `import()` of the SAME specifier is rejected from that record
 * without touching the network. Measured in Chromium on 2026-09-20, with the request intercepted
 * once and then freed: the second click produced ZERO network requests and the identical
 * `TypeError`, while importing the same file under a different query string (`?tentativa=2`)
 * resolved normally. So the only thing that clears the record is a new page, and the sentence says
 * that instead of teaching the person to click a button that cannot work. A cache-busting query is
 * NOT the fix either: in the production bundle the specifier is a hashed chunk name the bundler
 * owns, and a computed specifier would neither be emitted nor resolve.
 *
 * (The pendency panel of `account/sync-status.control.js` carried the same false promise and was
 * fixed the same day: it no longer ATTEMPTS the load without a connection, and its sentence sends
 * the person to reload. The browser fact both rest on is pinned by
 * `tests/e2e-ui/painel-de-pendencias-volta-com-a-rede.spec.js`, in Chromium and in Firefox.)
 *
 * The memo still forgets, and that is still worth having: a second click costs nothing, re-states
 * the notice instead of going quiet, and the forgetting is what makes the load happen again in the
 * one case the module map does not poison, which is a rejection that never reached the fetch.
 */

/**
 * Memoises a load and FORGETS it when it fails.
 *
 * THE FORGETTING IS THE WHOLE POINT, and it is the same decision as in
 * `account/sync-status.control.js`: a cached rejection would answer "no" for the rest of the
 * session to a person who came back online and clicked again, which is precisely the case the
 * retry exists for. Memoising the PROMISE (rather than a "loaded" flag) is what makes two quick
 * clicks share one download instead of racing two.
 *
 * `Promise.resolve().then(carregar)` rather than `carregar()` so that a loader that throws
 * SYNCHRONOUSLY still lands in the `catch` below, instead of escaping past the memo and leaving it
 * poisoned with a promise that was never created.
 *
 * @param {() => Promise<*>} carregar - The actual load, called at most once per success.
 * @returns {() => Promise<*>} The memoised loader.
 */
export function memoizarCarga(carregar) {
    let emVoo = null;
    return () => {
        if (!emVoo) {
            emVoo = Promise.resolve().then(carregar).catch((erro) => {
                emVoo = null;
                throw erro;
            });
        }
        return emVoo;
    };
}

/** Fetches `modals/signup.modal.js`, at most once per success. */
export const carregarCadastro = memoizarCarga(() => import('./signup.modal.js'));

/**
 * What to say when the signup form did not arrive.
 *
 * BOTH BRANCHES END AT THE SAME ACT, the reload, because the module map leaves no other way out
 * (see the `@fileoverview`). What the online bit changes is WHEN that act is worth doing, and
 * getting that wrong is what a single sentence could not avoid: telling someone with no
 * connection to reload sends them to a page whose own boot is fail-fast on `GET /api/config`, so
 * they would lose the screen they are on and get "EBGeo indisponível" in its place.
 *
 *   - offline: the network is named, and the reload is made CONDITIONAL on it coming back;
 *   - online: the likeliest remaining cause is a build swapped under an open session, which is
 *     named, and the reload is immediate.
 *
 * AN UNKNOWN VALUE FALLS TO THE ONLINE SENTENCE, on purpose: it is the one whose advice works
 * right now, so a missing `navigator.onLine` degrades into an act rather than into a wait.
 *
 * IT DOES NOT SAY "chunk", "módulo" NOR "import": the person did not ask for a module, they asked
 * for a form, and the noun they are given has to be the one they clicked.
 *
 * @param {*} online - `navigator.onLine`, or anything else.
 * @returns {string} A pt-BR sentence.
 */
export function cadastroIndisponivelTexto(online) {
    if (online === false) {
        return 'Sem conexão para carregar o formulário de cadastro. Quando a rede voltar, '
            + 'atualize a página para abrir o cadastro.';
    }
    return 'Não foi possível carregar o formulário de cadastro. O EBGeo pode ter sido atualizado '
        + 'no servidor: atualize a página para abrir o cadastro.';
}

/**
 * Loads the signup dialog and shows it.
 *
 * `aindaQuerido` IS ASKED AFTER THE LOAD AND NOT BEFORE, which is the whole of it: the module
 * travels over the network, and the person may cancel, press `Escape` or go back to the login form
 * while it does. Without this question the answer arrives late and a signup dialog appears by
 * itself over a screen nobody asked it of — the "late response" class that
 * `tests/e2e-ui/browser-account-recovery-audit.spec.js` already pins for the register REQUEST.
 *
 * It REJECTS when the module does not arrive; the caller that owns the clicked command is the one
 * that says so, because it is the one that can also offer the retry.
 *
 * `antesDeAbrir` RUNS IN THE SAME TICK AS `showSignupModal`, right before it. It is how the dialog
 * that owned the clicked command closes itself WITHOUT a gap and without closing LAST: a dialog
 * that closes after the new one is shown runs its `hide()` afterwards, and `ModalBase.hide()`
 * clears the body scroll lock the new dialog has just set.
 *
 * @param {Object} options - Passed through to `showSignupModal`.
 * @param {{ aindaQuerido?: () => boolean, antesDeAbrir?: () => void }} [gate] - Asked, then run,
 *   once the code is here.
 * @returns {Promise<Object|null>} The modal, or `null` when the gesture was abandoned.
 */
export async function abrirCadastro(options, { aindaQuerido, antesDeAbrir } = {}) {
    const { showSignupModal } = await carregarCadastro();
    if (typeof aindaQuerido === 'function' && !aindaQuerido()) return null;
    if (typeof antesDeAbrir === 'function') antesDeAbrir();
    return showSignupModal(options);
}
