// Path: js/ui/deferred-screen.js

/**
 * @fileoverview A progress screen that only appears when the wait is long enough to be read.
 *
 * WHY IT EXISTS (owner's report, 2026-09-20). The legacy upgrade gate runs on every boot of the
 * four pages that touch the local archive, and on a machine with nothing to migrate it finishes in
 * a fraction of a second. It used to draw its "Preparando seus dados" card at once, so every boot
 * showed a white card that vanished before anyone could read it, on top of the green opening
 * screen that was already saying "loading". A screen that flashes reads as a glitch, and it
 * trains people to ignore the one occasion when that card matters: a real copy of their data.
 *
 * THE RULE: the screen is ARMED, not drawn. It appears when the delay elapses, or IMMEDIATELY when
 * the caller learns the wait is real (`showNow`, called on the first copy-progress tick). Text set
 * while it is still armed is kept and used when it appears.
 *
 * `cancel()` IS THE LOAD-BEARING HALF. The owner of the screen slot reuses it for the recovery
 * screen, so a timer that fires after the gate has settled would either draw a progress card over
 * a finished boot or REPLACE the recovery screen with it. Every exit path cancels first, and after
 * `cancel()` nothing this object does can draw. Zero imports: clock and drawing are injected, so
 * the losing interleaving is a deterministic unit test and not a browser statistic.
 */

/** Long enough that an ordinary boot never draws the card, short enough that a real wait speaks. */
export const PROGRESS_SCREEN_DELAY_MS = 700;

/**
 * @param {Object} options
 * @param {(text: string) => { text: { textContent: string } }} options.show - Draws the screen with
 *     the given message and returns a handle whose `text` node can be updated.
 * @param {string} options.message - Initial message.
 * @param {number} [options.delayMs]
 * @param {(fn: Function, ms: number) => *} [options.setTimer]
 * @param {(id: *) => void} [options.clearTimer]
 * @returns {{ setText: (text: string) => void, showNow: () => void, cancel: () => void,
 *     isShown: () => boolean }}
 */
export function createDeferredScreen({
    show,
    message,
    delayMs = PROGRESS_SCREEN_DELAY_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
}) {
    if (typeof show !== 'function') throw new Error('createDeferredScreen: show must be a function');

    let latest = message;
    let handle = null;
    let cancelled = false;
    let timer = null;

    const draw = () => {
        timer = null;
        if (cancelled || handle) return;
        handle = show(latest);
    };

    timer = setTimer(draw, delayMs);

    return {
        setText(text) {
            latest = text;
            if (handle && !cancelled) handle.text.textContent = text;
        },
        showNow() {
            if (cancelled || handle) return;
            if (timer !== null) { clearTimer(timer); timer = null; }
            draw();
        },
        cancel() {
            cancelled = true;
            if (timer !== null) { clearTimer(timer); timer = null; }
        },
        isShown: () => handle !== null && !cancelled,
    };
}
