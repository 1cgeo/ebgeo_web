// Path: js/ui/unavailable-screen.js

/**
 * @fileoverview Branded full-screen block, shown when there is nothing left to render.
 *
 * IT HAS TWO CAUSES, NOT ONE, and that is the whole point of the rewrite. It was born for the
 * fail-fast boot (`GET /api/config` unreachable: the deploy always ships a backend and the
 * config/catalog is 100% server-sourced, so without it there is nothing to boot) and then became
 * the catch-all of the top-level `catch` of all four pages. An unhandled JS exception while
 * building the Atlas Drive announced "Não foi possível conectar ao servidor. Verifique sua
 * conexão" — the one piece of advice that cannot help, because the server had answered.
 *
 * The words live in `ui/blocking-screen-phrases.js`, which is pure and tested; this file is the
 * DOM.
 *
 * IDEMPOTENT PER CAUSE, not per session. The old guard was a bare `if (_shown) return`, so the
 * FIRST cause won for the rest of the page's life: a network failure at boot followed by a real
 * app error left the network text on screen forever. Now a second, DIFFERENT cause repaints; the
 * same cause twice still does nothing.
 */

import { BlockingCause, blockingScreenContent } from './blocking-screen-phrases.js';
// Por ARQUIVO, e nunca pelo barril: esta tela é montada pelas QUATRO páginas, e três delas bootam
// sem a store. `erro-telemetria.js` alcança `store/sync/runtime-config.js` (que importa só
// `config.js` e `api-client.js`, ambos de zero imports) e `store/sync/resource-scope.js`, que é
// folha declarada: nada disso arrasta a store, e as três páginas já carregavam este grafo, porque
// as três chamam `instalarTelemetriaDeErro` na primeira linha.
import { relatarErro } from '@js/session/erro-telemetria.js';
import { OrigemDeErro } from '@js/session/origens-de-erro.js';

/** The cause currently painted, or null. Module state: the screen replaces the whole page. */
let _shownCause = null;

/**
 * Whether this page life has already reported. Separate from {@link _shownCause}, which is per
 * CAUSE: the screen repaints when the cause changes, and a second report of "the product is dead"
 * says nothing the first did not.
 */
let _reported = false;

/**
 * SE O RELATO DESTA TELA TEM DE ESPERAR A PRÓXIMA CARGA DA PÁGINA, ou pode sair agora.
 *
 * AS DUAS CAUSAS NÃO DIZEM A MESMA COISA SOBRE O SERVIDOR, e tratá-las juntas é o defeito que esta
 * função existe para impedir. `SERVER_UNREACHABLE` significa literalmente que o `GET /api/config`
 * não respondeu: mandar o relato agora é gastar um pedido contra quem acabou de não responder, e
 * por isso ele vai para a fila e sai no próximo boot que conseguir falar. `APP_ERROR` é o oposto:
 * o servidor RESPONDEU e foi o nosso código que quebrou depois (a frase de
 * `blocking-screen-phrases.js` diz isso à pessoa em voz alta), então a rede está de pé e enfileirar
 * só atrasaria a notícia até a próxima visita — que pode não acontecer.
 *
 * PURA E EXPORTADA de propósito: é a única decisão desta tela que se pode testar sem um `document`.
 * @param {string} cause - Um valor de {@link BlockingCause}.
 * @returns {boolean} `true` quando o relato deve ir para a fila em vez da rede.
 */
export function deveEnfileirarIndisponivel(cause) {
    return cause === BlockingCause.SERVER_UNREACHABLE;
}

/**
 * Renders the full-screen block for a cause.
 *
 * @param {string} [cause] - A {@link BlockingCause} value. Omitted, it means the server could not
 *   be reached, which is the original caller (the fail-fast boot) and the only one that may keep
 *   the short form.
 */
export function showUnavailableScreen(cause = BlockingCause.SERVER_UNREACHABLE) {
    if (_shownCause === cause) return;
    const repainting = _shownCause !== null;
    _shownCause = cause;

    // ESTA TELA É O ÚNICO DEFEITO QUE A TELEMETRIA NÃO CONSEGUIA REGISTRAR quando a causa é o
    // servidor fora, e o motivo é circular: o relato daquele fato não tem para onde ir.
    // `enfileirarSempre` resolve o círculo guardando o corpo no `localStorage` sem sequer tentar a
    // rede; ele sai no próximo boot que conseguir falar com o servidor
    // (`descarregarFilaDeRelatos`, chamado logo depois do primeiro `GET /api/config` que dá certo,
    // nas QUATRO páginas). Sem isso, um dia inteiro de servidor fora é indistinguível, no banco,
    // de um dia em que ninguém abriu o produto. A escolha entre fila e rede é
    // {@link deveEnfileirarIndisponivel}, e ela NÃO é a mesma para as duas causas.
    //
    // UMA VEZ POR VIDA DA PÁGINA, e antes de desenhar: montar a tela mexe no DOM, e uma exceção
    // ali levaria junto a única notícia que sobreviveria à página.
    if (!_reported) {
        _reported = true;
        relatarErro(`EBGeo indisponível: ${cause}`, {
            origem: OrigemDeErro.INDISPONIVEL,
            contexto: { causa: cause },
            enfileirarSempre: deveEnfileirarIndisponivel(cause),
        });
    }

    // The boot splash (#initial-loader) is normally removed once the app finishes loading; on a
    // fail-fast boot it never does, so remove it here so the screen is visible.
    document.getElementById('initial-loader')?.remove();
    // On a repaint, the previous screen has to go, or the two stack and the older (wrong) one is
    // the one the person reads, since it sits first in the DOM.
    if (repainting) document.querySelector('.ebgeo-unavailable')?.remove();

    const texto = blockingScreenContent(cause);

    const screen = document.createElement('div');
    screen.className = 'ebgeo-unavailable';
    screen.setAttribute('role', 'alert');
    screen.dataset.testid = 'ebgeo-unavailable';
    // Legível por teste e por quem inspeciona: qual das duas telas está no ar.
    screen.dataset.cause = cause;

    const card = document.createElement('div');
    card.className = 'ebgeo-unavailable__card';

    const logo = document.createElement('img');
    logo.className = 'ebgeo-unavailable__logo';
    logo.src = '/images/logo_ebgeo.webp';
    logo.alt = 'EBGeo';
    card.appendChild(logo);

    const title = document.createElement('h1');
    title.className = 'ebgeo-unavailable__title';
    title.textContent = texto.title;
    card.appendChild(title);

    const msg = document.createElement('p');
    msg.className = 'ebgeo-unavailable__msg';
    msg.textContent = texto.message;
    card.appendChild(msg);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ebgeo-unavailable__btn';
    btn.dataset.testid = 'ebgeo-unavailable-retry';
    btn.textContent = texto.retryLabel;
    btn.addEventListener('click', () => window.location.reload());
    card.appendChild(btn);

    screen.appendChild(card);
    document.body.appendChild(screen);
}

export { BlockingCause };
