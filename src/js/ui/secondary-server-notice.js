// Path: js/ui/secondary-server-notice.js

/**
 * @module ui/secondary-server-notice
 * @description Startup notice for the secondary EBGeo server.
 *
 * EBGeo runs on two servers: the primary one at the 7° CTA in Brasília
 * (ebgeo.dsg.eb.mil.br) and a secondary one at the 1° CGEO in Porto Alegre.
 * A deployment on the secondary server sets `config.app.avisoServidorSecundario`
 * to `true`, and this module then shows a blocking notice on every startup
 * that recommends the primary server and lets the user go there or stay.
 *
 * Nothing is persisted on purpose: being on the secondary server is a fact of
 * the deployment, not a user preference, so the notice returns on every load.
 *
 * The overlay sits above the loading screen (`--z-startup-notice`), so the
 * notice is readable while the map loads, and it still shows if the app never
 * finishes loading, which is exactly when the recommendation matters most.
 */

import config from '@js/config.js';
import {
    setupCleanup,
    addDomListener,
    trackTimer,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/** Address of the primary EBGeo server (plain http redirects here). */
export const PRIMARY_SERVER_URL = 'https://ebgeo.dsg.eb.mil.br';

/** UI strings (pt-BR). Exported so tests can pin the facts the notice states. */
export const NOTICE_TEXT = Object.freeze({
    title: 'Este é o servidor secundário do EBGeo',
    paragraphs: Object.freeze([
        'Você está acessando o servidor secundário do EBGeo, hospedado no '
            + '1° Centro de Geoinformação, em Porto Alegre.',
        'Recomenda-se utilizar o servidor principal, ebgeo.dsg.eb.mil.br, hospedado '
            + 'em Brasília na infraestrutura do 7° Centro de Telemática de Área. Ele tem '
            + 'maior tempo de disponibilidade e não está sujeito a problemas de energia '
            + 'e de rede do 1° CGEO.',
    ]),
    goToPrimary: 'Ir para ebgeo.dsg.eb.mil.br',
    stayHere: 'Continuar neste servidor',
});

/** Matches `--transition-normal` (design-tokens.css): the overlay leaves the DOM after the fade-out. */
const FADE_OUT_MS = 200;

/** Warning triangle icon (static SVG). */
const WARNING_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
    + '<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

/**
 * Whether the notice is enabled for a given configuration.
 *
 * Only the boolean `true` enables it. A missing `app` block, a missing key,
 * `false`, `null` or a string all read as disabled, so a deployment whose
 * config predates the key (GitHub Pages, a hand-edited production config)
 * behaves exactly as before.
 *
 * @param {Object} [cfg=config] - Configuration object
 * @returns {boolean}
 */
export function isSecondaryServerNoticeEnabled(cfg = config) {
    return cfg?.app?.avisoServidorSecundario === true;
}

/**
 * The blocking notice: one overlay, two actions, shown once per page load.
 */
class SecondaryServerNotice {
    constructor() {
        setupCleanup(this);
        this._overlay = null;
        /** Focusable actions in Tab order (neutral first, recommended last). */
        this._actions = [];
    }

    /**
     * Mounts the overlay and takes the keyboard.
     *
     * Focus lands on "stay here", as the confirm modal focuses cancel: an
     * accidental Enter at startup must not navigate away.
     */
    show() {
        const el = this._createOverlay();
        this._overlay = el;
        document.body.appendChild(el);

        // Capture on window runs before every keydown handler the app registers
        // on document (keyboard-shortcuts.js, the tools, the modals), so no
        // shortcut fires behind the notice. Default actions are kept: Tab still
        // moves focus, Enter and Space still press the focused control.
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

        el.classList.remove('server-notice--visible');
        trackTimer(this, setTimeout(() => removeElement(el), FADE_OUT_MS));
    }

    /**
     * Swallows every key while the notice is up. Escape dismisses, Tab stays
     * inside the dialog; `aria-modal` alone does not trap focus.
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
     * Cycles Tab and Shift+Tab between the two actions.
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
     * Builds the overlay. Text goes in through textContent; the only innerHTML
     * is the static icon.
     * @private
     * @returns {HTMLElement}
     */
    _createOverlay() {
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
        title.textContent = NOTICE_TEXT.title;

        const message = document.createElement('div');
        message.className = 'server-notice__message';
        message.id = 'server-notice-message';
        for (const text of NOTICE_TEXT.paragraphs) {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            message.appendChild(paragraph);
        }

        const actions = document.createElement('div');
        actions.className = 'server-notice__actions';

        // Same order as the confirm modal: the neutral action left, the
        // recommended one right.
        const stayHere = document.createElement('button');
        stayHere.type = 'button';
        stayHere.className = 'server-notice__button server-notice__button--secondary';
        stayHere.textContent = NOTICE_TEXT.stayHere;
        addDomListener(this, stayHere, 'click', () => this.dismiss());

        const goToPrimary = document.createElement('a');
        goToPrimary.className = 'server-notice__button server-notice__button--primary';
        goToPrimary.href = PRIMARY_SERVER_URL;
        goToPrimary.textContent = NOTICE_TEXT.goToPrimary;

        this._actions = [stayHere, goToPrimary];
        actions.append(stayHere, goToPrimary);
        card.append(icon, title, message, actions);
        el.appendChild(card);
        return el;
    }
}

/** The single notice of this page load (HMR guard). */
let notice = null;

/**
 * Shows the notice when the configuration enables it. Idempotent.
 * @returns {boolean} True if the notice was shown in this page load
 */
export function initSecondaryServerNotice() {
    if (!isSecondaryServerNoticeEnabled()) return false;
    if (notice) return true;

    notice = new SecondaryServerNotice();
    notice.show();
    return true;
}
