// Path: js/session/ambiente-do-navegador.js

/**
 * @fileoverview WHAT MACHINE AN ERROR HAPPENED ON, and which browser families the usage report
 * groups by. Vocabulary, one User-Agent parser, and the collector of the environment block that
 * rides each error report.
 *
 * ZERO IMPORTS, by contract, like the other telemetry leaves: the error capturer and the usage
 * batch load it on the first line of all four pages, three of which boot without the store, and
 * the admin page reads the same parser to label old occurrences.
 *
 * THE VOCABULARY IS A MIRROR. Its twin is `backend/src/modules/uso/ambiente-do-navegador.js`,
 * whose lists feed the Joi of both anonymous routes and the CHECK constraints of
 * `uso_sessoes.navegador`, `uso_sessoes.so` and `defeitos.navegadores`. A value added here and not
 * there costs the WHOLE report or batch in a 422, so a new value enters the three places in the
 * same commit; `frontend/tests/unit/ambiente-do-navegador-espelha-backend.test.js` is the guard.
 *
 * ONE PARSER, and that is the reason this file exists. Until 2026-09-23 there were two (the usage
 * family and the admin label), and they already disagreed on Opera. The usage batch, the error
 * report and the admin fallback for reports that predate the environment block all go through
 * {@link analisarUserAgent}.
 *
 * WHAT IT DOES NOT COLLECT, and the absence is the design: no model name, no fonts, no plugin
 * list, no canvas or audio hash, no address, no persistent device id. The fields below describe
 * the MACHINE (browser, system, screen, GPU class, storage quota) and each one answers a question
 * a defect of this product already asked. Together they add fingerprint entropy beyond the UA,
 * which is why they only ever reach the per-occurrence evidence (at most twenty per defect, the
 * newest, kept by `DELETE_OCORRENCIAS_EXCEDENTES`, and gone with the defect itself when
 * `DELETE_DEFEITOS_EXPIRADOS` prunes it by its last sighting; read only by administrators) and
 * never the usage batch, which carries three low-cardinality dimensions: family, major version
 * and system family. The storage quota is rounded to a power of two for the same reason
 * ({@link cotaArredondadaMb}).
 *
 * NOTHING HERE THROWS. Every read of `navigator`, `screen`, WebGL or storage sits in a `try`: a
 * getter that throws inside the error capturer is the worst defect this subsystem can have.
 */

/**
 * Browser families. Order is the contract of the mirror and of the CHECK.
 * @type {ReadonlyArray<string>}
 */
export const FAMILIAS_DE_NAVEGADOR = Object.freeze(['chrome', 'firefox', 'edge', 'safari', 'opera', 'outro']);

/**
 * Operating system families. `ios` includes iPadOS (an iPad in desktop mode is detected by touch).
 * @type {ReadonlyArray<string>}
 */
export const FAMILIAS_DE_SO = Object.freeze(['windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'outro']);

/** @type {ReadonlyArray<string>} */
export const TIPOS_DE_DISPOSITIVO = Object.freeze(['desktop', 'movel', 'tablet']);

/** @type {ReadonlyArray<string>} */
export const VERSOES_DE_WEBGL = Object.freeze(['webgl2', 'webgl', 'nenhum']);

/**
 * Size and range limits of the environment block, the same numbers the route validates.
 * Cutting here is what keeps one odd value from costing the whole report in a 422.
 */
export const TETOS_DE_AMBIENTE = Object.freeze({
    versao: 30,
    idioma: 35,
    fuso: 64,
    gpu: 160,
    toque: 256,
    pixels: 100000,
    escala: 20,
    nucleos: 4096,
    memoriaGb: 4096,
    texturaMax: 1048576,
    megabytes: 1000000000,
    versaoPrincipal: 9999,
});

/**
 * The accepted shapes of the four free text fields. Mirrored by source text with the backend.
 * `gpu` is printable ASCII only: a renderer string is driver text, never typed by a person.
 */
export const FORMAS_DE_AMBIENTE = Object.freeze({
    versao: /^\d{1,6}(?:\.\d{1,8}){0,4}$/,
    idioma: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/,
    fuso: /^[A-Za-z0-9_+\-/]{1,64}$/,
    gpu: /^[\x20-\x7E]{1,160}$/,
});

const RE_EDGE = /\b(?:Edg|EdgA|EdgiOS|Edge)\/(\d+(?:\.\d+)*)/;
const RE_OPERA = /\b(?:OPR|OPiOS|OPT)\/(\d+(?:\.\d+)*)/;
const RE_OPERA_ANTIGO = /\bOpera\b/;
const RE_FIREFOX = /\b(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/;
// `HeadlessChrome` is spelled out because `\b` does not split "sChrome": without it the headless
// browser of the test harness fell through to the Safari branch, in the old parser too.
const RE_CHROME = /\b(?:HeadlessChrome|Chrome|CriOS|Chromium)\/(\d+(?:\.\d+)*)/;
const RE_VERSAO_SAFARI = /\bVersion\/(\d+(?:\.\d+)*)/;
const RE_SAFARI = /\bSafari\//;

/**
 * A version string reduced to the accepted shape, or `null`.
 * @param {*} texto
 * @returns {string|null}
 */
function versaoLimpa(texto) {
    if (typeof texto !== 'string') return null;
    const v = texto.trim().replace(/_/g, '.').slice(0, TETOS_DE_AMBIENTE.versao);
    return FORMAS_DE_AMBIENTE.versao.test(v) ? v : null;
}

/**
 * The major version (the first number) of a version string, or `null`.
 * @param {*} versao
 * @returns {number|null}
 */
export function versaoPrincipal(versao) {
    const v = versaoLimpa(typeof versao === 'number' ? String(versao) : versao);
    if (!v) return null;
    const n = Number.parseInt(v.split('.')[0], 10);
    return Number.isInteger(n) && n >= 0 && n <= TETOS_DE_AMBIENTE.versaoPrincipal ? n : null;
}

/**
 * The browser family and full version declared by a User-Agent.
 *
 * THE ORDER OF THE BRANCHES IS THE CONTRACT: Edge and Opera announce themselves as Chrome, and
 * Chrome announces itself as Safari, so asking for Chrome first classifies every Edge as Chrome
 * and asking for Safari first classifies every Chrome as Safari, without any error.
 * @param {string} ua
 * @returns {{navegador: string, navegadorVersao: string|null}}
 */
function navegadorDoUa(ua) {
    let m = RE_EDGE.exec(ua);
    if (m) return { navegador: 'edge', navegadorVersao: versaoLimpa(m[1]) };
    m = RE_OPERA.exec(ua);
    if (m) return { navegador: 'opera', navegadorVersao: versaoLimpa(m[1]) };
    if (RE_OPERA_ANTIGO.test(ua)) {
        const v = RE_VERSAO_SAFARI.exec(ua);
        return { navegador: 'opera', navegadorVersao: v ? versaoLimpa(v[1]) : null };
    }
    m = RE_FIREFOX.exec(ua);
    if (m) return { navegador: 'firefox', navegadorVersao: versaoLimpa(m[1]) };
    m = RE_CHROME.exec(ua);
    if (m) return { navegador: 'chrome', navegadorVersao: versaoLimpa(m[1]) };
    if (RE_SAFARI.test(ua)) {
        const v = RE_VERSAO_SAFARI.exec(ua);
        return { navegador: 'safari', navegadorVersao: v ? versaoLimpa(v[1]) : null };
    }
    return { navegador: 'outro', navegadorVersao: null };
}

/**
 * The system family and version declared by a User-Agent.
 *
 * ORDER MATTERS here too: an iPhone says "like Mac OS X", Android says "Linux; Android", and
 * ChromeOS says "X11; CrOS". The more specific token is always asked first.
 *
 * THE VERSION IS WHAT THE UA SAYS, and in current browsers much of it is FROZEN: every Windows 10
 * and 11 says "Windows NT 10.0", Chromium on macOS says "10_15_7" and on Android says "10". The
 * real value, when there is one, comes from the Client Hints (`soVersaoCh`), and the admin label
 * says which of the two it is reading.
 * @param {string} ua
 * @returns {{so: string, soVersao: string|null}}
 */
function sistemaDoUa(ua) {
    let m = /\bWindows NT (\d+\.\d+)/.exec(ua);
    if (m) return { so: 'windows', soVersao: versaoLimpa(m[1]) };
    if (/\bWindows\b/.test(ua)) return { so: 'windows', soVersao: null };
    if (/\bCrOS\b/.test(ua)) {
        m = /\bCrOS \S+ (\d+(?:\.\d+)*)/.exec(ua);
        return { so: 'chromeos', soVersao: m ? versaoLimpa(m[1]) : null };
    }
    if (/\bAndroid\b/.test(ua)) {
        m = /\bAndroid (\d+(?:\.\d+)*)/.exec(ua);
        return { so: 'android', soVersao: m ? versaoLimpa(m[1]) : null };
    }
    if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) {
        m = /\bOS (\d+(?:_\d+)*)/.exec(ua);
        return { so: 'ios', soVersao: m ? versaoLimpa(m[1]) : null };
    }
    if (/\bMac OS X\b/.test(ua)) {
        m = /\bMac OS X (\d+(?:[._]\d+)*)/.exec(ua);
        return { so: 'macos', soVersao: m ? versaoLimpa(m[1]) : null };
    }
    if (/\b(?:Linux|X11|Ubuntu|Fedora)\b/.test(ua)) return { so: 'linux', soVersao: null };
    return { so: 'outro', soVersao: null };
}

/**
 * What a User-Agent says about browser, system and device. Pure, total, never throws.
 *
 * AN EMPTY OR NON-STRING UA IS `outro`, not an error: it is the answer the usage batch has
 * always sent for it, and the report still counts the session.
 * @param {*} ua
 * @returns {{navegador: string, navegadorVersao: string|null, so: string, soVersao: string|null,
 *   dispositivo: string}}
 */
export function analisarUserAgent(ua) {
    try {
        // The route cuts the header at 300; a longer string is not a real UA, and a regex over
        // megabytes inside the error path is a cost nobody asked for.
        const texto = typeof ua === 'string' ? ua.slice(0, 1000) : '';
        const { navegador, navegadorVersao } = texto ? navegadorDoUa(texto) : { navegador: 'outro', navegadorVersao: null };
        const { so, soVersao } = texto ? sistemaDoUa(texto) : { so: 'outro', soVersao: null };
        let dispositivo = 'desktop';
        if (/\biPad\b/.test(texto) || /\bTablet\b/i.test(texto) || (so === 'android' && !/\bMobile\b/.test(texto))) {
            dispositivo = 'tablet';
        } else if (/\bMobi|\biPhone\b|\biPod\b/.test(texto)) {
            dispositivo = 'movel';
        }
        return { navegador, navegadorVersao, so, soVersao, dispositivo };
    } catch {
        return { navegador: 'outro', navegadorVersao: null, so: 'outro', soVersao: null, dispositivo: 'desktop' };
    }
}

/** The brand each family carries in the Client Hints `fullVersionList`. */
const MARCAS_POR_FAMILIA = Object.freeze({
    edge: ['Microsoft Edge'],
    opera: ['Opera', 'Opera GX'],
    chrome: ['Google Chrome', 'Chromium'],
});

/**
 * Reads `navigator`, never throws.
 * @param {*} alvo
 * @returns {Object|null}
 */
function navegadorDe(alvo) {
    try {
        const nav = alvo?.navigator;
        return nav && typeof nav === 'object' ? nav : null;
    } catch {
        return null;
    }
}

/**
 * Browser, system and device of THIS page, refined by what the page can say synchronously.
 *
 * TWO REFINEMENTS, each for a lie the UA tells: an iPad in desktop mode says "Macintosh" and is
 * told apart by touch points; and the Client Hints, when the page already has them (they are
 * asynchronous and only exist on Chromium in a secure context), carry the real system version
 * and the full browser version the reduced UA froze.
 * @param {Object} [opcoes]
 * @param {*} [opcoes.alvo] - The window (default: `globalThis`).
 * @param {{platformVersion?: string, fullVersionList?: Array<{brand: string, version: string}>}|null} [opcoes.dicas]
 * @returns {{navegador: string, navegadorVersao: string|null, so: string, soVersao: string|null,
 *   soVersaoCh: string|null, dispositivo: string, toque: number|null}|null} `null` without a navigator.
 */
export function identificarNavegador({ alvo = globalThis, dicas = null } = {}) {
    const nav = navegadorDe(alvo);
    if (!nav) return null;
    let ua = '';
    try {
        ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
    } catch {
        ua = '';
    }
    const base = analisarUserAgent(ua);
    let toque = null;
    try {
        const t = nav.maxTouchPoints;
        toque = Number.isInteger(t) && t >= 0 ? Math.min(t, TETOS_DE_AMBIENTE.toque) : null;
    } catch {
        toque = null;
    }
    const saida = { ...base, soVersaoCh: null, toque };
    if (saida.so === 'macos' && toque !== null && toque > 1) {
        saida.so = 'ios';
        saida.soVersao = null;
        saida.dispositivo = 'tablet';
    }
    try {
        const movel = nav.userAgentData?.mobile;
        if (movel === true && saida.dispositivo === 'desktop') saida.dispositivo = 'movel';
    } catch {
        // No Client Hints: the UA answer stands.
    }
    if (dicas && typeof dicas === 'object') {
        saida.soVersaoCh = versaoLimpa(dicas.platformVersion);
        const marcas = MARCAS_POR_FAMILIA[saida.navegador];
        if (marcas && Array.isArray(dicas.fullVersionList)) {
            const achada = dicas.fullVersionList.find((m) => marcas.includes(m?.brand));
            const completa = versaoLimpa(achada?.version);
            if (completa) saida.navegadorVersao = completa;
        }
    }
    return saida;
}

/** @param {*} v @param {number} teto @returns {number|null} */
function inteiroNaFaixa(v, teto) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    const n = Math.round(v);
    return n <= teto ? n : null;
}

/** @param {*} v @param {RegExp} forma @param {number} teto @returns {string|null} */
function textoNaForma(v, forma, teto) {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim().slice(0, teto);
    return forma.test(t) ? t : null;
}

/**
 * A positive fraction ROUNDED FIRST and range-checked AFTER, or `null`.
 *
 * THE ORDER IS THE FIX: checking `> 0` before rounding let `0.0001` through and turned it into
 * `0`, which the route refuses (`greater(0)`), and the refusal is of the WHOLE report.
 * @param {*} v @param {number} casas @param {number} teto @returns {number|null}
 */
function fracaoPositiva(v, casas, teto) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const fator = 10 ** casas;
    const r = Math.round(v * fator) / fator;
    return r > 0 && r <= teto ? r : null;
}

/**
 * The storage quota ROUNDED TO THE NEAREST POWER OF TWO in megabytes, or `null`.
 *
 * PRIVACY, NOT PRECISION: Chromium derives the quota from the disk size (a fixed share of it), so
 * the exact number is close to a disk identifier, and next to the rest of the block it links
 * anonymous occurrences of the same machine to each other. A power of two keeps what the number
 * is FOR (is this browser short of space?) and leaves about one bit per doubling. The nearest
 * power is taken in log scale, so 6144 becomes 8192 and 300 becomes 256. The route accepts only
 * powers of two (`ehPotenciaDeDois`, in the backend leaf).
 * @param {*} mb
 * @returns {number|null}
 */
export function cotaArredondadaMb(mb) {
    if (typeof mb !== 'number' || !Number.isFinite(mb) || mb < 1) return null;
    const r = 2 ** Math.round(Math.log2(mb));
    return r <= TETOS_DE_AMBIENTE.megabytes ? r : null;
}

/** @param {ReadonlyArray<string>} vocab @returns {(v: *) => (string|null)} */
const naLista = (vocab) => (v) => (typeof v === 'string' && vocab.includes(v) ? v : null);
/** @param {RegExp} forma @param {number} teto @returns {(v: *) => (string|null)} */
const naForma = (forma, teto) => (v) => textoNaForma(v, forma, teto);
/** @param {number} teto @returns {(v: *) => (number|null)} */
const inteiroAte = (teto) => (v) => inteiroNaFaixa(v, teto);
/** @param {*} v @returns {boolean|null} */
const logico = (v) => (typeof v === 'boolean' ? v : null);

/**
 * THE CLOSED SHAPE, one rule per field: the rule returns the value that may travel, or `null`.
 *
 * A TABLE AND NOT A SEQUENCE OF STATEMENTS, because the table is also the LIST: its keys are
 * {@link CAMPOS_DE_AMBIENTE}, which the mirror test compares with the Joi of the route. A field
 * written only here, or only in the Joi, is a 422 that the capturer does not queue, that is, a
 * report lost in silence; with the list derived from the rules, adding a field on one side only
 * turns the mirror red.
 */
const REGRAS_DE_AMBIENTE = Object.freeze({
    navegador: naLista(FAMILIAS_DE_NAVEGADOR),
    navegadorVersao: naForma(FORMAS_DE_AMBIENTE.versao, TETOS_DE_AMBIENTE.versao),
    so: naLista(FAMILIAS_DE_SO),
    soVersao: naForma(FORMAS_DE_AMBIENTE.versao, TETOS_DE_AMBIENTE.versao),
    soVersaoCh: naForma(FORMAS_DE_AMBIENTE.versao, TETOS_DE_AMBIENTE.versao),
    dispositivo: naLista(TIPOS_DE_DISPOSITIVO),
    toque: inteiroAte(TETOS_DE_AMBIENTE.toque),
    telaLargura: inteiroAte(TETOS_DE_AMBIENTE.pixels),
    telaAltura: inteiroAte(TETOS_DE_AMBIENTE.pixels),
    janelaLargura: inteiroAte(TETOS_DE_AMBIENTE.pixels),
    janelaAltura: inteiroAte(TETOS_DE_AMBIENTE.pixels),
    escala: (v) => fracaoPositiva(v, 3, TETOS_DE_AMBIENTE.escala),
    idioma: naForma(FORMAS_DE_AMBIENTE.idioma, TETOS_DE_AMBIENTE.idioma),
    fuso: naForma(FORMAS_DE_AMBIENTE.fuso, TETOS_DE_AMBIENTE.fuso),
    nucleos: inteiroAte(TETOS_DE_AMBIENTE.nucleos),
    memoriaGb: (v) => fracaoPositiva(v, 2, TETOS_DE_AMBIENTE.memoriaGb),
    webgl: naLista(VERSOES_DE_WEBGL),
    gpu: naForma(FORMAS_DE_AMBIENTE.gpu, TETOS_DE_AMBIENTE.gpu),
    texturaMax: inteiroAte(TETOS_DE_AMBIENTE.texturaMax),
    armazenamentoUsoMb: inteiroAte(TETOS_DE_AMBIENTE.megabytes),
    armazenamentoCotaMb: cotaArredondadaMb,
    armazenamentoPersistente: logico,
    online: logico,
    cookies: logico,
    contextoSeguro: logico,
    indexedDB: logico,
});

/**
 * The fields of the environment block. Mirrored with `CAMPOS_DE_AMBIENTE` of
 * `backend/src/modules/uso/ambiente-do-navegador.js` and with the keys of `ambienteSchema`.
 * @type {ReadonlyArray<string>}
 */
export const CAMPOS_DE_AMBIENTE = Object.freeze(Object.keys(REGRAS_DE_AMBIENTE));

/**
 * The environment block reduced to the closed shape the route accepts.
 *
 * IT REBUILDS INSTEAD OF FILTERING, for the reason `migalhasSeguras` does: the route validates
 * with `unknown(false)`, where one extra key refuses the WHOLE report. Only the fields of the
 * rule table can come out, which makes the extra key impossible, not just unlikely. A field
 * outside its vocabulary, shape or range is DROPPED, never clamped into a value that was not
 * measured; the exceptions are rounding (the two fractions, and the quota, rounded to a power of
 * two on purpose).
 * @param {*} bruto
 * @returns {Object|null} `null` when nothing survived, so the field simply does not travel.
 */
export function ambienteSeguro(bruto) {
    try {
        if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
        const saida = {};
        for (const campo of CAMPOS_DE_AMBIENTE) {
            let valor;
            try {
                valor = bruto[campo];
            } catch {
                continue;
            }
            const limpo = REGRAS_DE_AMBIENTE[campo](valor);
            if (limpo !== null && limpo !== undefined) saida[campo] = limpo;
        }
        return Object.keys(saida).length > 0 ? saida : null;
    } catch {
        return null;
    }
}

/** The renderer strings that say nothing: they are the API name, not the GPU. */
const RENDERIZADOR_GENERICO = /^(?:webkit webgl|mozilla|)$/i;

/**
 * Creates ONE small WebGL context, reads what it says about the GPU, and loses it on purpose.
 *
 * WHY THE CONTEXT IS LOST RIGHT AWAY: browsers cap live WebGL contexts per page and evict the
 * OLDEST when the cap is passed, and the oldest is the map's. Holding a probe context would be
 * the telemetry breaking the thing it observes.
 *
 * WHY FIREFOX NEVER ASKS FOR THE DEBUG EXTENSION: since version 92 Firefox answers `RENDERER`
 * with the sanitized real renderer ("..., or similar") and logs a deprecation warning when a page
 * asks for `WEBGL_debug_renderer_info`. The extension is asked for only when `RENDERER` came back
 * as the generic API name, which is what Chromium and Safari do.
 * @param {*} alvo
 * @returns {{webgl: string, gpu?: string, texturaMax?: number}|null}
 */
function sondarWebgl(alvo) {
    // A detached `<canvas>` FIRST, and `OffscreenCanvas` only without a document: Safari shipped
    // `OffscreenCanvas` years before it could hold a WebGL context, and probing there would record
    // "no WebGL" on a machine whose map draws fine.
    let canvas = null;
    try {
        if (typeof alvo?.document?.createElement === 'function') canvas = alvo.document.createElement('canvas');
        else if (typeof alvo?.OffscreenCanvas === 'function') canvas = new alvo.OffscreenCanvas(1, 1);
    } catch {
        canvas = null;
    }
    if (!canvas || typeof canvas.getContext !== 'function') return null;

    let gl = null;
    let versao = 'nenhum';
    try {
        gl = canvas.getContext('webgl2');
        if (gl) versao = 'webgl2';
    } catch {
        gl = null;
    }
    if (!gl) {
        try {
            gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) versao = 'webgl';
        } catch {
            gl = null;
        }
    }
    if (!gl) return { webgl: 'nenhum' };

    const saida = { webgl: versao };
    try {
        let gpu = gl.getParameter(gl.RENDERER);
        if (typeof gpu !== 'string' || RENDERIZADOR_GENERICO.test(gpu.trim())) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
        if (typeof gpu === 'string' && !RENDERIZADOR_GENERICO.test(gpu.trim())) {
            saida.gpu = gpu.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
        }
    } catch {
        // A driver that refuses to name itself is an answer: the field stays out.
    }
    try {
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (Number.isInteger(max)) saida.texturaMax = max;
    } catch {
        // idem
    }
    try {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
        // The context goes away with the canvas anyway.
    }
    return saida;
}

/** Bytes to whole megabytes, or `null`. @param {*} bytes @returns {number|null} */
function megabytes(bytes) {
    return typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0
        ? Math.round(bytes / 1048576)
        : null;
}

/**
 * The environment collector of one page.
 *
 * THREE READS ARE ASYNCHRONOUS OR EXPENSIVE, and none of them may happen inside the capture:
 *  - the high-entropy Client Hints (`getHighEntropyValues`) and the storage estimate are
 *    promises. {@link iniciar} starts both at install and caches the answers; a report sent
 *    before they arrive simply lacks those fields;
 *  - the WebGL probe creates a context, which is NOT done at boot (it would cost every page load
 *    of every user, and the headless test harness already crashes at map boot a few percent of
 *    the time). It runs LAZILY on the first report of the page and is cached, failure included.
 * The storage estimate is refreshed after each collection, so the next report carries a newer one.
 * @param {Object} [opcoes]
 * @param {*} [opcoes.alvo] - The window (default: `globalThis`).
 * @returns {{iniciar: () => void, coletar: () => (Object|null), dicas: () => (Object|null)}}
 */
export function criarColetorDeAmbiente({ alvo = globalThis } = {}) {
    let dicas = null;
    let armazenamento = null;
    let webgl;

    const lerDicas = () => {
        try {
            const uad = navegadorDe(alvo)?.userAgentData;
            if (typeof uad?.getHighEntropyValues !== 'function') return;
            const pendente = uad.getHighEntropyValues(['platformVersion', 'fullVersionList']);
            if (pendente && typeof pendente.then === 'function') {
                pendente.then((valores) => {
                    if (valores && typeof valores === 'object') {
                        dicas = { platformVersion: valores.platformVersion, fullVersionList: valores.fullVersionList };
                    }
                }, () => {});
            }
        } catch {
            // Not Chromium, or not a secure context: the UA answer stands.
        }
    };

    const lerArmazenamento = () => {
        try {
            const storage = navegadorDe(alvo)?.storage;
            if (typeof storage?.estimate !== 'function') return;
            const estimativa = storage.estimate();
            if (estimativa && typeof estimativa.then === 'function') {
                estimativa.then((e) => {
                    armazenamento = { ...(armazenamento ?? {}), usoMb: megabytes(e?.usage), cotaMb: megabytes(e?.quota) };
                }, () => {});
            }
            if (typeof storage.persisted === 'function') {
                const persistido = storage.persisted();
                if (persistido && typeof persistido.then === 'function') {
                    persistido.then((p) => {
                        if (typeof p === 'boolean') armazenamento = { ...(armazenamento ?? {}), persistente: p };
                    }, () => {});
                }
            }
        } catch {
            // `navigator.storage` only exists in a secure context.
        }
    };

    const ler = (fn) => {
        try {
            return fn();
        } catch {
            return undefined;
        }
    };

    return {
        iniciar() {
            lerDicas();
            lerArmazenamento();
        },
        dicas: () => dicas,
        coletar() {
            try {
                const id = identificarNavegador({ alvo, dicas });
                if (!id) return null;
                const nav = navegadorDe(alvo);
                if (webgl === undefined) webgl = sondarWebgl(alvo);
                const bruto = {
                    ...id,
                    telaLargura: ler(() => alvo.screen.width),
                    telaAltura: ler(() => alvo.screen.height),
                    escala: ler(() => alvo.devicePixelRatio),
                    janelaLargura: ler(() => alvo.innerWidth),
                    janelaAltura: ler(() => alvo.innerHeight),
                    idioma: ler(() => nav.language),
                    fuso: ler(() => alvo.Intl.DateTimeFormat().resolvedOptions().timeZone),
                    nucleos: ler(() => nav.hardwareConcurrency),
                    memoriaGb: ler(() => nav.deviceMemory),
                    online: ler(() => nav.onLine),
                    cookies: ler(() => nav.cookieEnabled),
                    contextoSeguro: ler(() => alvo.isSecureContext),
                    // Reading `indexedDB` THROWS in some Firefox configurations (cookies blocked for
                    // the site), and that is exactly the case worth recording as `false`.
                    indexedDB: ler(() => alvo.indexedDB !== null && typeof alvo.indexedDB === 'object') ?? false,
                    ...(webgl ?? {}),
                    armazenamentoUsoMb: armazenamento?.usoMb,
                    armazenamentoCotaMb: armazenamento?.cotaMb,
                    armazenamentoPersistente: armazenamento?.persistente,
                };
                lerArmazenamento();
                return ambienteSeguro(bruto);
            } catch {
                return null;
            }
        },
    };
}
