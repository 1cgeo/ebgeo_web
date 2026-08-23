// Path: js/street_view_tool/reeval-throttle.js

/**
 * @fileoverview The throttle that governs how often the 360 tile loader re-evaluates level and
 * visible tiles. Leading edge AND trailing edge, with the clock and the timer injected.
 *
 * WHAT IT REPLACES, and why the difference is not cosmetic. The previous shape was a RESET DEBOUNCE:
 * every call did `clearTimeout` before arming a new timer. `atualizarCamera` runs once per frame, so
 * while the finger was on the screen the timer restarted faster than the 120 ms window and the
 * re-evaluation NEVER happened. Measured by the original author on the real app, in a run that
 * approved its own evidence: a full 360 degree turn downloaded ZERO tiles and uploaded ZERO bytes of
 * texture, in both repetitions, across 36 frames in 1374 ms. The operator turned all the way around
 * looking at whatever was already on the canvas, and the fine tiles only arrived 120 ms after the
 * gesture ended. After the fix the same gesture measured 32.3 MB of texture in 13 to 20 calls, with
 * 40 to 41 frames in 1362 ms.
 *
 * BOTH EDGES MATTER:
 *
 * - The LEADING edge makes the first movement ask for tiles right away. It is the one that fixes the
 *   turn that loaded nothing.
 * - The TRAILING edge guarantees the FINAL position of the gesture is evaluated. Without it,
 *   stopping inside the window would leave the screen on the tile set from 120 ms ago, which is a
 *   visible hole in the very direction the operator turned to.
 *
 * The de-duplication downstream (in-flight keys, bitmap cache, drawn set) is what makes the leading
 * edge cheap: re-evaluating more often demotes no tile, it only discovers earlier what would be
 * requested anyway.
 *
 * WHY IT IS A MODULE OF ITS OWN, and not a closure inside `tile-loader.js` (which is where the
 * upstream `ebgeo_360` keeps it). NOT because the loader is untestable in node: it is testable, and
 * `frontend/tests/unit/tile-loader-consertos-de-desempenho.test.js` does drive the LEADING edge
 * through the real loader, because that edge is synchronous. What the loader cannot show is
 * everything the window governs: the loader owns real timers for its own request queue, so faking
 * `Date.now` and `setTimeout` around it would fake the queue too and the test would be measuring its
 * own scaffolding. With the clock injected HERE, the window, the trailing edge, the wait arithmetic
 * and `cancelar` are asserted in absolute numbers with nothing sleeping.
 *
 * This file is the FIFTH known adaptation of `tile-loader.js` against
 * `ebgeo_360/public/calibration/js/tile-loader.js`, on top of the three declared in that
 * repository's commit `741a9a4`. See `.claude/rules/common-tasks.md` §"O par que DIVERGE".
 */

/**
 * @typedef {object} ReevalThrottle
 * @property {() => void} pedir - asks for a run; at most one per window, leading and trailing
 * @property {() => void} cancelar - drops any pending trailing run, leaving the window untouched
 * @property {() => boolean} pendente - whether a trailing run is armed (for tests and diagnostics)
 */

/**
 * Builds a leading plus trailing edge throttle.
 *
 * The window starts OPEN: the internal clock of the last run begins at zero, so the very first
 * `pedir()` runs synchronously. That is what takes the screen off the blurred preview on the first
 * camera movement of a photo.
 *
 * `cancelar()` deliberately does NOT reset the last-run stamp. It means "the pending run is no
 * longer wanted" (a new photo is loading, or the loader is being disposed), not "the window
 * reopens"; resetting it would let the next request fire outside the rhythm the window exists to
 * impose.
 *
 * @param {object} opcoes - configuration
 * @param {number} opcoes.intervaloMs - minimum interval between two runs, in ms
 * @param {() => void} opcoes.executar - what to run
 * @param {() => number} [opcoes.agora] - clock, injectable for tests; defaults to `Date.now`
 * @param {(fn: () => void, ms: number) => *} [opcoes.agendar] - timer arming; defaults to `setTimeout`
 * @param {(id: *) => void} [opcoes.cancelarAgendamento] - timer clearing; defaults to `clearTimeout`
 * @returns {ReevalThrottle} the throttle
 */
export function createReevalThrottle({
    intervaloMs,
    executar,
    agora = Date.now,
    agendar = setTimeout,
    cancelarAgendamento = clearTimeout,
}) {
    /** Timer id of the armed trailing run, or null. */
    let temporizador = null;
    /**
     * When the last run happened, on the injected clock.
     *
     * IT STARTS AT `-Infinity`, NOT AT ZERO, and the difference is not decorative. Upstream this
     * stamp starts at zero, which works only because the clock there is always `Date.now()` and
     * `Date.now() - 0 >= 120` is trivially true. With the clock injectable, a clock whose origin is
     * zero (which is exactly what a test harness uses) would make the very first request WAIT, that
     * is, reproduce the defect this module exists to fix. `-Infinity` makes the open window a
     * property of the module instead of a property of the caller's clock, and it is the harness in
     * `frontend/tests/unit/reeval-throttle.test.js` that found this.
     */
    let ultimaExecucao = -Infinity;

    return {
        pedir() {
            const t = agora();
            if (temporizador === null && t - ultimaExecucao >= intervaloMs) {
                ultimaExecucao = t;
                executar();
                return;
            }
            if (temporizador !== null) return;
            const espera = Math.max(0, intervaloMs - (t - ultimaExecucao));
            temporizador = agendar(() => {
                temporizador = null;
                ultimaExecucao = agora();
                executar();
            }, espera);
        },

        cancelar() {
            if (temporizador !== null) {
                cancelarAgendamento(temporizador);
                temporizador = null;
            }
        },

        pendente() {
            return temporizador !== null;
        },
    };
}
