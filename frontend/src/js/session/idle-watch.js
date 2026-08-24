// Path: js/session/idle-watch.js

/**
 * @fileoverview Idle-session watch: real DOM activity + the warning overlay wired around the pure
 * {@link IdleTimer}. Extracted from `idle-timeout.controller.js` when the admin panel became its own
 * page (`admin.html`): that page has no event bus and no control registry, so it cannot use the
 * session-aware controller — but leaving it without an idle watch would silently drop the timeout
 * for anyone working in Administração.
 *
 * This module is deliberately dependency-light (config + IdleTimer only): no store, no services, no
 * MapLibre. What differs per page is only WHAT expiry does, so that is the caller's `onExpire`.
 */

import config from '@js/config.js';
import { IdleTimer } from './idle-timer.js';

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_WARN_SECONDS = 60;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointermove'];
const ACTIVITY_THROTTLE_MS = 1000;

/** @returns {number} The configured idle window in ms (default 30 min). */
export function resolveIdleMs() {
    const minutes = Number(config?.features?.idle_timeout_minutes);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60_000;
}

/** @returns {number} The configured warning window in ms (default 60 s). */
export function resolveWarnMs() {
    const seconds = Number(config?.features?.idle_warning_seconds);
    return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_WARN_SECONDS) * 1000;
}

/**
 * Builds + shows the "session about to expire" overlay with a live countdown.
 *
 * Escape on the warning means "I'm here" → stay connected (the natural dismiss reflex). Every other
 * full-screen surface (AtlasDrive) excludes `.idle-warning__overlay` from its own Escape handler so
 * this stays the only thing Escape acts on while the warning is up.
 *
 * @param {Object} opts
 * @param {number} opts.ms - Warning window in ms (drives the countdown).
 * @param {function(): void} opts.onStay - The user chose to stay connected.
 * @param {function(): void} opts.onLogout - The user chose to leave now.
 * @returns {function(): void} Dismisses the overlay (idempotent); takes no session action.
 */
export function showIdleWarning({ ms, onStay, onLogout }) {
    let remaining = Math.ceil(ms / 1000);

    const overlay = document.createElement('div');
    overlay.className = 'idle-warning__overlay';
    overlay.dataset.testid = 'idle-warning';

    const dialog = document.createElement('div');
    dialog.className = 'idle-warning__dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.className = 'idle-warning__title';
    title.textContent = 'Sessão prestes a expirar';

    const message = document.createElement('p');
    message.className = 'idle-warning__message';
    const countdown = document.createElement('strong');
    countdown.className = 'idle-warning__countdown';
    countdown.dataset.testid = 'idle-warning-countdown';
    countdown.textContent = String(remaining);
    message.append('Você será desconectado por inatividade em ', countdown, ' s. Deseja continuar conectado?');

    const actions = document.createElement('div');
    actions.className = 'idle-warning__actions';

    const stayBtn = document.createElement('button');
    stayBtn.type = 'button';
    stayBtn.className = 'idle-warning__btn idle-warning__btn--primary';
    stayBtn.dataset.testid = 'idle-warning-stay';
    stayBtn.textContent = 'Continuar conectado';
    stayBtn.addEventListener('click', () => onStay());

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'idle-warning__btn idle-warning__btn--ghost';
    logoutBtn.dataset.testid = 'idle-warning-logout';
    logoutBtn.textContent = 'Sair agora';
    logoutBtn.addEventListener('click', () => onLogout());

    actions.append(stayBtn, logoutBtn);
    dialog.append(title, message, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    stayBtn.focus();

    const onKeyDown = (e) => { if (e.key === 'Escape') onStay(); };
    document.addEventListener('keydown', onKeyDown);

    const ticker = setInterval(() => {
        remaining -= 1;
        countdown.textContent = String(Math.max(0, remaining));
    }, 1000);

    let dismissed = false;
    return () => {
        if (dismissed) return;
        dismissed = true;
        clearInterval(ticker);
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
    };
}

/**
 * Starts watching for inactivity: real DOM activity re-arms the countdown, a warning overlay offers
 * the chance to stay, and `onExpire` runs if the warning lapses. Call the returned function to stop
 * (e.g. on logout) — it also dismisses any warning on screen.
 *
 * @param {Object} opts
 * @param {function(): void} opts.onExpire - What ending the session means for this page.
 * @returns {function(): void} Stops the watch (idempotent).
 */
export function startIdleWatch({ onExpire, onLeaveNow = null }) {
    let lastActivity = 0;
    /** @type {(function(): void)|null} */
    let dismissWarning = null;
    let stopped = false;

    const dismiss = () => {
        if (dismissWarning) {
            dismissWarning();
            dismissWarning = null;
        }
    };

    const timer = new IdleTimer({
        idleMs: resolveIdleMs(),
        warnMs: resolveWarnMs(),
        onWarn: (ms) => {
            if (dismissWarning) return;
            dismissWarning = showIdleWarning({
                ms,
                onStay: () => { dismiss(); timer.stayActive(); },
                // SAIR DE PROPÓSITO NÃO É EXPIRAR, e os dois recebiam o MESMO corpo de callback.
                // Quem clicou "Sair agora" era tratado como quem deixou o prazo vencer: no mapa,
                // `IdleTimeoutController._expire` chamava `handleSessionLost` com a frase de
                // expiração, que termina pedindo login de volta. Nada tinha expirado, e a pessoa
                // acabara de dizer que queria sair; reabrir o login é desfazer o gesto dela.
                //
                // `onLeaveNow` é opcional para não obrigar todo chamador a distinguir de uma vez;
                // quem não passar cai no comportamento antigo, que continua correto para páginas
                // onde sair e expirar de fato terminam igual.
                onLogout: () => { dismiss(); (onLeaveNow ?? onExpire)(); },
            });
        },
        onExpire: () => { dismiss(); onExpire(); },
    });

    // Throttled: pointermove alone would otherwise re-arm the timer on every mouse sample.
    const onActivity = () => {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
        lastActivity = now;
        timer.notifyActivity();
    };

    for (const ev of ACTIVITY_EVENTS) {
        window.addEventListener(ev, onActivity, { passive: true });
    }
    timer.start();

    return () => {
        if (stopped) return;
        stopped = true;
        for (const ev of ACTIVITY_EVENTS) {
            window.removeEventListener(ev, onActivity, { passive: true });
        }
        timer.stop();
        dismiss();
    };
}
