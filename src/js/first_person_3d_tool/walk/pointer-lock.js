// Path: js/first_person_3d_tool/walk/pointer-lock.js

/**
 * @fileoverview The Pointer Lock API, with the four things about it that bite.
 *
 * It is a thin wrapper and it earns its file by NOT being one line. Locking the
 * pointer is asynchronous, refusable, revocable by the browser without anybody
 * asking, and impossible to re-request for a moment after it drops — and every
 * one of those four is a state the caller has to draw on screen.
 *
 *   1. IT IS ASYNCHRONOUS. `requestPointerLock()` resolves later (a Promise in
 *      current Chrome, nothing at all in older browsers), and the truth arrives
 *      as a `pointerlockchange` event. Code that flips a flag on the call and
 *      draws the mode from it will draw a mode that never started.
 *   2. IT CAN BE REFUSED. It requires a user gesture, the document must have
 *      focus, and the browser may simply say no. Failure arrives as
 *      `pointerlockerror`, WITHOUT any detail: there is nothing to report but
 *      that it did not happen.
 *   3. THE BROWSER TAKES IT BACK. Escape, Alt+Tab, switching tabs and losing
 *      focus all release it, and the only notice is `pointerlockchange` with a
 *      null `pointerLockElement`. This is why Escape needs no keyboard handler
 *      here: the browser has already done it, and what is left is to notice.
 *   4. RE-LOCKING TOO SOON THROWS. After a user-initiated exit, Chrome refuses a
 *      new lock for about a second (the "user gesture required" cooldown), and
 *      the rejection is a plain SecurityError. A caller that spams the button
 *      would otherwise get an unhandled rejection in the console.
 *
 * Nothing here decides WHEN the pointer should be locked, or what changes when
 * it is: that belongs to the viewer, and to `walk-mode.js` for the camera.
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';

/**
 * Watches and drives the pointer lock of one element.
 */
export class PointerLock {
    /**
     * @param {HTMLElement} target - Element to lock the pointer to. The one that
     *   receives the mouse events while locked, so it should be the scene.
     * @param {(locked: boolean) => void} onChange - Called on every REAL change
     *   of state, including the ones the browser makes on its own.
     */
    constructor(target, onChange) {
        setupCleanup(this);

        this._target = target || null;
        this._onChange = typeof onChange === 'function' ? onChange : () => {};
        /** Last state announced, so a redundant `pointerlockchange` says nothing. */
        this._locked = false;

        // On the DOCUMENT, never on the target: that is where the spec fires
        // both events, and a listener on the element would simply never run.
        addDomListener(this, document, 'pointerlockchange', () => this._sync());
        addDomListener(this, document, 'pointerlockerror', () => this._sync());
    }

    /**
     * Is the pointer locked to our target RIGHT NOW?
     *
     * Read from the document rather than from a flag of ours, because the
     * browser changes this without asking (Escape, Alt+Tab, tab switch).
     * @returns {boolean} True when locked.
     */
    get locked() {
        return Boolean(this._target) && document.pointerLockElement === this._target;
    }

    /**
     * Is the API available at all?
     *
     * It is absent in a few embedded browsers and blocked inside a sandboxed
     * iframe without `allow-pointer-lock`. The caller uses it to keep a button
     * that cannot work off the toolbar, instead of offering a mode that fails.
     * @returns {boolean} True when the pointer can be locked.
     */
    get supported() {
        return typeof this._target?.requestPointerLock === 'function';
    }

    /**
     * Asks for the lock. MUST be called from a user gesture handler.
     *
     * The failure paths are swallowed on purpose: a refusal is not an error the
     * user can act on, and `_sync` is about to report that nothing changed.
     * @returns {void}
     */
    request() {
        if (!this.supported || this.locked) return;
        try {
            const result = this._target.requestPointerLock();
            // Chrome returns a Promise; older browsers return undefined. An
            // unhandled rejection here is the cooldown of quirk 4, which is not
            // a fault and has nothing to tell the user.
            if (result && typeof result.catch === 'function') {
                result.catch(() => this._sync());
            }
        } catch {
            this._sync();
        }
    }

    /**
     * Gives the lock back. Safe to call when there is none.
     * @returns {void}
     */
    exit() {
        if (document.pointerLockElement) {
            document.exitPointerLock?.();
        }
    }

    /** Drops the listeners. Does NOT release the lock: see `exit`. */
    destroy() {
        cleanup(this);
        this._target = null;
    }

    /**
     * Announces a change, and only a change.
     * @private
     */
    _sync() {
        const now = this.locked;
        if (now === this._locked) return;
        this._locked = now;
        this._onChange(now);
    }
}
