// Path: js/first_person_3d_tool/splat-parse-timeout.js

/**
 * @fileoverview A CEILING OVER THE SPLAT ENGINE'S PARSE, because the engine has none and a worker
 * that never loads hangs it forever, in silence.
 *
 * WHAT WAS MEASURED, on 2026-09-22, by reading the pinned third-party bundle
 * (`@manycore/aholo-viewer/dist/index.js`) and by driving the viewer:
 *
 *   - `parseSplatData` builds a deferred, takes a worker from its pool and wires `worker.onmessage`
 *     ONLY. There is no `onerror` and no `addEventListener('error')` anywhere on that path, so the
 *     deferred is settled by a MESSAGE or never. A worker whose script does not load sends no
 *     message, and `new Worker(...)` does not throw for that: it fires an `error` event that this
 *     engine does not listen to.
 *   - The worker is a blob module whose whole body is `import "<base>/splat-worker.js";`, and the
 *     blob URL is memoized at module scope. So a base URL that answers 404 stays wrong for the life
 *     of the page: every later worker imports the same dead address. THE PAGE IS POISONED, which is
 *     why the sentence this failure produces says to reload and never "tente de novo" (the same
 *     rule `account/sync-status.control.js` states for a failed `import()`).
 *   - With the worker reachable, the parse of a 19,1 MB scene took 439 ms. With it refused, the
 *     wait ran past 280 s with no error line anywhere and the screen frozen on
 *     "Carregando o modelo 3D... 19,1 MB de 19,1 MB".
 *
 * WHY 30 s, then. It is about seventy times the measured parse and still leaves room for a machine
 * a lot slower than this one; the cost of being wrong is asymmetric (a ceiling that fires early
 * turns a slow success into a false failure, a ceiling that never fires is the defect being fixed).
 *
 * THE ENGINE'S PROMISE IS NOT CANCELLABLE, and pretending otherwise would be the leak: the worker
 * keeps whatever it holds and the deferred stays pending. What this module guarantees is narrower
 * and is the part that matters to the caller: the returned promise SETTLES, and the abandoned one
 * carries handlers from the start, so a late rejection is never an unhandled rejection.
 *
 * NO FABRICATED HTTP STATUS. `loadSplat` puts `Response.status` on its errors because it MEASURED
 * one; here no response is involved at all, so a status field would be prose dressed as
 * measurement, and `layerLoadFailureStatusDetail` would print "Código: 504" about a
 * server that answered 200 with every byte. What travels instead is {@link SPLAT_PARSE_TIMEOUT} on
 * `error.code`, read by {@link isSplatParseTimeout} and never parsed back out of a message.
 *
 * ZERO IMPORTS, so it loads in node: the module that uses it (`first_person_viewer.js`) pulls in
 * the whole splat engine on its first line and cannot be loaded in a unit test at all.
 */

/** How long the engine is given to parse the `.sog`, in milliseconds. See the header for the 439 ms. */
export const TEMPO_LIMITE_DE_ANALISE_MS = 30000;

/** The `code` a timed-out parse carries, so the outcome is read from a field and not from prose. */
export const SPLAT_PARSE_TIMEOUT = 'splat-parse-timeout';

/**
 * Whether an error is the parse ceiling firing, as opposed to any other failure of the open.
 * @param {*} error
 * @returns {boolean}
 */
export function isSplatParseTimeout(error) {
    return error?.code === SPLAT_PARSE_TIMEOUT;
}

/**
 * The error the ceiling throws. English, like every other developer-facing message here: the
 * sentence the PERSON reads is built by `scene3dEngineTimeoutMessage` in `scene3d-failure.js`.
 * @param {number} ms
 * @returns {Error}
 */
function tempoEsgotado(ms) {
    const erro = new Error(`splat engine did not answer in ${ms} ms while parsing the .sog`);
    erro.code = SPLAT_PARSE_TIMEOUT;
    erro.timeoutMs = ms;
    return erro;
}

/**
 * Settle on whichever comes first: the engine's answer, or the ceiling.
 *
 * The handlers on `promessa` are attached BEFORE this function returns, and they are attached
 * unconditionally, which is what keeps an abandoned rejection from surfacing as an unhandled one
 * after the ceiling already rejected.
 *
 * @param {Promise<*>|*} promessa - What the engine returned. Anything non-thenable resolves as is.
 * @param {{ms?: number}} [opcoes] - `ms` overrides the ceiling, for tests and for nothing else.
 * @returns {Promise<*>} The engine's value, or a rejection carrying {@link SPLAT_PARSE_TIMEOUT}.
 */
export function comTetoDeAnalise(promessa, { ms = TEMPO_LIMITE_DE_ANALISE_MS } = {}) {
    const limite = Number.isFinite(ms) && ms > 0 ? ms : TEMPO_LIMITE_DE_ANALISE_MS;
    return new Promise((resolve, reject) => {
        let decidido = false;
        const id = setTimeout(() => {
            if (decidido) return;
            decidido = true;
            reject(tempoEsgotado(limite));
        }, limite);

        Promise.resolve(promessa).then(
            (valor) => {
                if (decidido) return;
                decidido = true;
                clearTimeout(id);
                resolve(valor);
            },
            (erro) => {
                if (decidido) return;
                decidido = true;
                clearTimeout(id);
                reject(erro);
            }
        );
    });
}
