// Path: js/session/idle-timer.js

/**
 * @fileoverview Pure inactivity timer (no DOM, no real clock) — the testable core of the idle
 * session timeout. Two phases: after `idleMs - warnMs` of inactivity it enters a WARNING and calls
 * `onWarn`; if nothing dismisses it within `warnMs` more, it calls `onExpire`. Activity re-arms the
 * idle phase but is IGNORED during the warning (the user must make an explicit choice). Timer
 * functions are injectable so the timing is deterministic in tests.
 */

export class IdleTimer {
    /**
     * @param {Object} opts
     * @param {number} opts.idleMs - Total inactivity before expiry (warning starts `warnMs` before this).
     * @param {number} opts.warnMs - How long the warning is shown before expiry.
     * @param {function(number): void} opts.onWarn - Called when the warning starts (receives `warnMs`).
     * @param {function(): void} opts.onExpire - Called when the session expires.
     * @param {Function} [opts.setTimer] - Injectable scheduler (defaults to setTimeout).
     * @param {Function} [opts.clearTimer] - Injectable canceller (defaults to clearTimeout).
     */
    constructor({ idleMs, warnMs, onWarn, onExpire, setTimer, clearTimer }) {
        this._idleMs = idleMs;
        this._warnMs = warnMs;
        this._onWarn = onWarn;
        this._onExpire = onExpire;
        // Wrap the defaults: a bare `setTimeout` reference called unbound throws "Illegal invocation"
        // in browsers (it needs the window receiver) — harmless in Node, which is why the unit test
        // with injected timers didn't catch it.
        this._setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = clearTimer || ((id) => clearTimeout(id));
        this._handle = null;
        this._warning = false;
    }

    /** Begins the idle countdown. */
    start() {
        this._armIdle();
    }

    /** Cancels everything (e.g. on logout). */
    stop() {
        this._clear();
        this._warning = false;
    }

    /** Resets the idle countdown on user activity — a no-op while the warning is showing. */
    notifyActivity() {
        if (this._warning) return;
        this._armIdle();
    }

    /** User chose to stay connected: dismiss the warning and re-arm the idle countdown. */
    stayActive() {
        this._warning = false;
        this._armIdle();
    }

    /** @returns {boolean} Whether the warning phase is currently active. */
    isWarning() {
        return this._warning;
    }

    /** @private */
    _armIdle() {
        this._clear();
        const delay = Math.max(0, this._idleMs - this._warnMs);
        this._handle = this._setTimer(() => this._enterWarning(), delay);
    }

    /** @private */
    _enterWarning() {
        this._warning = true;
        // Arm expiry FIRST, then notify — so a synchronous stayActive() in onWarn cleanly re-arms.
        this._handle = this._setTimer(() => {
            this._warning = false;
            this._onExpire();
        }, this._warnMs);
        this._onWarn(this._warnMs);
    }

    /** @private */
    _clear() {
        if (this._handle != null) {
            this._clearTimer(this._handle);
            this._handle = null;
        }
    }
}
