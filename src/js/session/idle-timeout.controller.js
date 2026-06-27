// Path: js/session/idle-timeout.controller.js

/**
 * @fileoverview Idle session timeout (client-side). While logged in, inactivity for N minutes ends
 * the session — but first a warning gives the user a chance to stay connected (the banking/Google
 * pattern). On expiry the account control tears the session down to anonymous and re-opens login.
 *
 * Lifecycle is driven by SESSION_CHANGED: the detector runs only while authenticated and stops on
 * logout. The timing core (IdleTimer) is pure + unit-tested; this module wires real DOM activity,
 * the warning overlay, and the expiry action. N is config-driven (config.features.idle_timeout_minutes,
 * default 30); the warning window is fixed at WARN_MS.
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getControl } from '@store';
import config from '@js/config.js';
import { setupCleanup, subscribe } from '@utils/event-cleanup.js';
import { IdleTimer } from './idle-timer.js';

const DEFAULT_IDLE_MINUTES = 30;
const DEFAULT_WARN_SECONDS = 60;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'wheel', 'touchstart', 'pointermove'];
const ACTIVITY_THROTTLE_MS = 1000;

/** @returns {number} The configured idle window in ms (default 30 min). */
function resolveIdleMs() {
    const minutes = Number(config?.features?.idle_timeout_minutes);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE_MINUTES) * 60_000;
}

/** @returns {number} The configured warning window in ms (default 60 s). */
function resolveWarnMs() {
    const seconds = Number(config?.features?.idle_warning_seconds);
    return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_WARN_SECONDS) * 1000;
}

export class IdleTimeoutController {
    constructor() {
        /** @type {IdleTimer|null} */
        this._timer = null;
        this._active = false;
        this._lastActivity = 0;
        this._activityHandler = () => this._onActivity();
        /** @type {HTMLElement|null} */
        this._warnEl = null;
        this._countdownEl = null;
        this._countdownHandle = null;
        this._remaining = 0;
        setupCleanup(this);
    }

    /** Wire the session listener and sync to the current state. Idempotent; call once at boot. */
    init() {
        subscribe(this, getEventBus(), EventTypes.SESSION_CHANGED, () => this._syncFromSession());
        this._syncFromSession();
    }

    /** @private Start the detector when authenticated, stop it otherwise. */
    _syncFromSession() {
        if (sessionContext.isAuthenticated()) this._start();
        else this._stop();
    }

    /** @private */
    _start() {
        if (this._active) return;
        this._active = true;
        this._timer = new IdleTimer({
            idleMs: resolveIdleMs(),
            warnMs: resolveWarnMs(),
            onWarn: (ms) => this._showWarning(ms),
            onExpire: () => this._expire(),
        });
        for (const ev of ACTIVITY_EVENTS) {
            window.addEventListener(ev, this._activityHandler, { passive: true });
        }
        this._timer.start();
    }

    /** @private */
    _stop() {
        if (!this._active) return;
        this._active = false;
        for (const ev of ACTIVITY_EVENTS) {
            window.removeEventListener(ev, this._activityHandler, { passive: true });
        }
        if (this._timer) {
            this._timer.stop();
            this._timer = null;
        }
        this._dismissWarning();
    }

    /** @private Throttled activity → reset the idle countdown. */
    _onActivity() {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (now - this._lastActivity < ACTIVITY_THROTTLE_MS) return;
        this._lastActivity = now;
        this._timer?.notifyActivity();
    }

    /** @private User chose to stay connected. */
    _stayActive() {
        this._dismissWarning();
        this._timer?.stayActive();
    }

    /** @private The warning lapsed: end the session and re-open login. */
    _expire() {
        this._dismissWarning();
        const account = getControl('account');
        if (account && typeof account.handleSessionLost === 'function') {
            account.handleSessionLost('Sua sessão expirou por inatividade. Entre novamente.');
        }
    }

    /** @private Builds + shows the warning overlay with a live countdown. */
    _showWarning(ms) {
        if (this._warnEl) return;
        this._remaining = Math.ceil(ms / 1000);

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
        countdown.textContent = String(this._remaining);
        message.append('Você será desconectado por inatividade em ', countdown, ' s. Deseja continuar conectado?');

        const actions = document.createElement('div');
        actions.className = 'idle-warning__actions';

        const stayBtn = document.createElement('button');
        stayBtn.type = 'button';
        stayBtn.className = 'idle-warning__btn idle-warning__btn--primary';
        stayBtn.dataset.testid = 'idle-warning-stay';
        stayBtn.textContent = 'Continuar conectado';
        stayBtn.addEventListener('click', () => this._stayActive());

        const logoutBtn = document.createElement('button');
        logoutBtn.type = 'button';
        logoutBtn.className = 'idle-warning__btn idle-warning__btn--ghost';
        logoutBtn.dataset.testid = 'idle-warning-logout';
        logoutBtn.textContent = 'Sair agora';
        logoutBtn.addEventListener('click', () => this._expire());

        actions.append(stayBtn, logoutBtn);
        dialog.append(title, message, actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        this._warnEl = overlay;
        this._countdownEl = countdown;
        stayBtn.focus();

        // Escape on the warning = "I'm here" → stay connected (the natural dismiss reflex). Tracked so
        // it's torn down with the overlay; the AtlasDrive/AdminPanel beneath exclude this overlay from
        // their own Escape handlers, so this is the only thing Escape acts on while the warning is up.
        this._warnKeydown = (e) => { if (e.key === 'Escape') this._stayActive(); };
        document.addEventListener('keydown', this._warnKeydown);

        this._countdownHandle = setInterval(() => {
            this._remaining -= 1;
            if (this._countdownEl) this._countdownEl.textContent = String(Math.max(0, this._remaining));
        }, 1000);
    }

    /** @private Removes the warning overlay + countdown ticker + key handler (no session action). */
    _dismissWarning() {
        if (this._countdownHandle != null) {
            clearInterval(this._countdownHandle);
            this._countdownHandle = null;
        }
        if (this._warnKeydown) {
            document.removeEventListener('keydown', this._warnKeydown);
            this._warnKeydown = null;
        }
        if (this._warnEl) {
            this._warnEl.remove();
            this._warnEl = null;
            this._countdownEl = null;
        }
    }
}

export default IdleTimeoutController;
