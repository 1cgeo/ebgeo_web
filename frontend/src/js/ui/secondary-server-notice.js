// Path: js/ui/secondary-server-notice.js

/**
 * @fileoverview Startup notice for the secondary EBGeo server.
 *
 * EBGeo runs on two servers: the primary one at the 7° CTA in Brasília and a secondary one at the
 * 1° CGEO in Porto Alegre. A deployment on the secondary server answers `GET /api/config` with
 * `app.avisoServidorSecundario: true`, and this module then shows a blocking notice on every
 * startup that recommends the primary server and lets the person go there or stay.
 *
 * THE CONFIG IS READ AT CALL TIME, NEVER AT IMPORT TIME, and on this branch that is the whole
 * adaptation. `src/js/config.js` is a SHELL that carries no deploy data: boot is fail-fast in
 * `GET /api/config` and `applyRuntimeConfig` deep-merges the server payload INTO that same object
 * (`store/sync/runtime-config.js`). A module-scope read here would see the empty shell and the
 * notice would never open, whatever the deployment said. `index.js` calls
 * {@link initSecondaryServerNotice} right after the hydration resolves.
 *
 * THE URL IS DEPLOY DATA TOO, and it is NOT hardcoded here: `app.urlServidorPrincipal` carries it.
 * A missing, empty or non-http(s) value drops the link button and keeps the notice, which still
 * says what this server is. Only `http:` and `https:` are accepted, because the value lands in an
 * `href`: a `javascript:` string from a mis-set config would otherwise be a click-to-run script.
 *
 * Nothing is persisted on purpose: being on the secondary server is a fact of the deployment, not
 * a user preference, so the notice returns on every load.
 *
 * The overlay sits above the loading screen (`--z-startup-notice`), so the notice is readable
 * while the map loads, and it still shows if the app never finishes loading, which is exactly when
 * the recommendation matters most.
 *
 * The pure half ({@link deveMostrarAviso}, {@link urlDoServidorPrincipal}, {@link montarModelo})
 * is separated from the DOM half on purpose: the suite runs in `node` with no jsdom, so the
 * decision is what a test can reach.
 */

import config from '@js/config.js';
import {
    setupCleanup,
    addDomListener,
    trackTimer,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/** Matches `--transition-normal` (design-tokens.css): the overlay leaves the DOM after the fade-out. */
const FADE_OUT_MS = 200;

/** Schemes allowed in the primary-server link. Everything else drops the button. */
const PROTOCOLOS_ACEITOS = new Set(['http:', 'https:']);

/** Warning triangle icon (static SVG, no user data). */
const WARNING_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
    + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

/**
 * Whether the notice is enabled for a given configuration.
 *
 * Only the boolean `true` enables it. A missing `app` block, a missing key, `false`, `null`, a
 * string or a number all read as disabled, so a payload that predates the key behaves exactly as
 * before.
 *
 * @param {Object} [cfg=config] - Hydrated configuration object
 * @returns {boolean}
 */
export function deveMostrarAviso(cfg = config) {
    return cfg?.app?.avisoServidorSecundario === true;
}

/**
 * The primary-server address the deployment published, parsed and vetted.
 *
 * @param {Object} [cfg=config] - Hydrated configuration object
 * @returns {{href: string, hostname: string}|null} Null when the key is absent, empty, not a
 *   string, unparseable, or not http(s).
 */
export function urlDoServidorPrincipal(cfg = config) {
    const bruta = cfg?.app?.urlServidorPrincipal;
    if (typeof bruta !== 'string') return null;

    const texto = bruta.trim();
    if (!texto) return null;

    let url;
    try {
        url = new URL(texto);
    } catch {
        return null;
    }
    if (!PROTOCOLOS_ACEITOS.has(url.protocol)) return null;
    if (!url.hostname) return null;

    return { href: url.href, hostname: url.hostname };
}

/**
 * The whole notice as data: what it says and which actions it offers.
 *
 * The second paragraph NAMES the primary server only when the deployment published its address,
 * so the text never promises a server it cannot point at.
 *
 * @param {Object} [cfg=config] - Hydrated configuration object
 * @returns {{title: string, paragraphs: string[], stayLabel: string,
 *   primary: {label: string, url: string}|null}|null} Null when the notice is disabled.
 */
export function montarModelo(cfg = config) {
    if (!deveMostrarAviso(cfg)) return null;

    const principal = urlDoServidorPrincipal(cfg);
    const nomeado = principal ? `o servidor principal, ${principal.hostname},` : 'o servidor principal,';

    return Object.freeze({
        title: 'Este é o servidor secundário do EBGeo',
        paragraphs: Object.freeze([
            'Você está acessando o servidor secundário do EBGeo, hospedado no '
                + '1° Centro de Geoinformação, em Porto Alegre.',
            `Recomenda-se utilizar ${nomeado} hospedado em Brasília na infraestrutura do `
                + '7° Centro de Telemática de Área. Ele tem maior tempo de disponibilidade e não '
                + 'está sujeito a problemas de energia e de rede do 1° CGEO.',
        ]),
        stayLabel: 'Continuar neste servidor',
        primary: principal
            ? Object.freeze({ label: `Ir para ${principal.hostname}`, url: principal.href })
            : null,
    });
}

/**
 * The blocking notice: one overlay, one or two actions, shown once per page load.
 */
class SecondaryServerNotice {
    /**
     * @param {{title: string, paragraphs: string[], stayLabel: string,
     *   primary: {label: string, url: string}|null}} modelo - Result of {@link montarModelo}
     */
    constructor(modelo) {
        setupCleanup(this);
        this._modelo = modelo;
        this._overlay = null;
        /** Focusable actions in Tab order (neutral first, recommended last). */
        this._actions = [];
    }

    /**
     * Mounts the overlay and takes the keyboard.
     *
     * Focus lands on "stay here", as the confirm modal focuses cancel: an accidental Enter at
     * startup must not navigate away.
     */
    show() {
        const el = this._createOverlay();
        this._overlay = el;
        // Restored on dismiss, as every dialog of the house does (modal.base.js): the notice
        // takes focus for its own buttons and must hand it back to whoever had it.
        this._previousFocus = document.activeElement;
        document.body.appendChild(el);

        // Capture on window runs before every keydown handler the app registers on document
        // (keyboard-shortcuts.js, the tools, the modals), so no shortcut fires behind the notice.
        // Default actions are kept: Tab still moves focus, Enter and Space still press the focused
        // control.
        addDomListener(this, window, 'keydown', this._onKeydown.bind(this), { capture: true });

        requestAnimationFrame(() => {
            // Dismissed before the first frame: do not resurrect the fading overlay.
            if (this._overlay !== el) return;
            el.classList.add('server-notice--visible');
            this._actions[0]?.focus();
        });
    }

    /**
     * Releases the keyboard, fades out, then leaves the DOM.
     */
    dismiss() {
        const el = this._overlay;
        if (!el) return;

        this._overlay = null;
        cleanup(this);

        const previous = this._previousFocus;
        this._previousFocus = null;
        if (previous && previous !== document.body && typeof previous.focus === 'function' && document.contains(previous)) {
            previous.focus();
        }

        el.classList.remove('server-notice--visible');
        trackTimer(this, setTimeout(() => removeElement(el), FADE_OUT_MS));
    }

    /**
     * Swallows every key while the notice is up. Escape dismisses, Tab stays inside the dialog;
     * `aria-modal` alone does not trap focus.
     * @private
     * @param {KeyboardEvent} event
     */
    _onKeydown(event) {
        event.stopImmediatePropagation();

        if (event.key === 'Escape') {
            event.preventDefault();
            this.dismiss();
            return;
        }

        if (event.key === 'Tab') {
            this._trapFocus(event);
        }
    }

    /**
     * Cycles Tab and Shift+Tab between the actions. With a single action (no published URL) first
     * and last are the same button, and the cycle keeps focus on it.
     * @private
     * @param {KeyboardEvent} event
     */
    _trapFocus(event) {
        const first = this._actions[0];
        const last = this._actions[this._actions.length - 1];
        const active = document.activeElement;

        if (!first || !last) return;

        if (!this._overlay?.contains(active)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    /**
     * Builds the overlay. Text goes in through `textContent` and the address through
     * `setAttribute`; the only `innerHTML` is the static icon.
     * @private
     * @returns {HTMLElement}
     */
    _createOverlay() {
        const modelo = this._modelo;

        const el = document.createElement('div');
        el.className = 'server-notice';
        el.setAttribute('role', 'alertdialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', 'server-notice-title');
        el.setAttribute('aria-describedby', 'server-notice-message');

        const card = document.createElement('div');
        card.className = 'server-notice__card';

        const icon = document.createElement('div');
        icon.className = 'server-notice__icon';
        icon.innerHTML = WARNING_ICON;

        const title = document.createElement('h2');
        title.className = 'server-notice__title';
        title.id = 'server-notice-title';
        title.textContent = modelo.title;

        const message = document.createElement('div');
        message.className = 'server-notice__message';
        message.id = 'server-notice-message';
        for (const text of modelo.paragraphs) {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            message.appendChild(paragraph);
        }

        const actions = document.createElement('div');
        actions.className = 'server-notice__actions';

        // Same order as the confirm modal: the neutral action left, the recommended one right.
        const stayHere = document.createElement('button');
        stayHere.type = 'button';
        stayHere.className = 'server-notice__button server-notice__button--secondary';
        stayHere.textContent = modelo.stayLabel;
        addDomListener(this, stayHere, 'click', () => this.dismiss());

        this._actions = [stayHere];
        actions.appendChild(stayHere);

        // NO PUBLISHED ADDRESS, NO BUTTON. Drawing a link with an empty `href` would reload the
        // current page, which is the one thing the recommendation is not.
        if (modelo.primary) {
            const goToPrimary = document.createElement('a');
            goToPrimary.className = 'server-notice__button server-notice__button--primary';
            goToPrimary.setAttribute('href', modelo.primary.url);
            goToPrimary.textContent = modelo.primary.label;
            this._actions.push(goToPrimary);
            actions.appendChild(goToPrimary);
        }

        card.append(icon, title, message, actions);
        el.appendChild(card);
        return el;
    }
}

/** The single notice of this page load (HMR guard). */
let notice = null;

/**
 * Shows the notice when the hydrated configuration enables it. Idempotent.
 *
 * Call it AFTER `applyRuntimeConfig` resolved: before that, `config.app` is the empty shell.
 *
 * @param {Object} [cfg=config] - Hydrated configuration object
 * @returns {boolean} True if the notice was shown in this page load
 */
export function initSecondaryServerNotice(cfg = config) {
    const modelo = montarModelo(cfg);
    if (!modelo) return false;
    if (notice) return true;

    notice = new SecondaryServerNotice(modelo);
    notice.show();
    return true;
}

/** Tears the notice down (tests / teardown). */
export function destroySecondaryServerNotice() {
    notice?.dismiss();
    notice = null;
}
