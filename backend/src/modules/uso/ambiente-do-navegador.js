// Path: src/modules/uso/ambiente-do-navegador.js
/**
 * @fileoverview The VOCABULARY and limits of the browser environment the telemetry carries.
 *
 * THIS FILE IS A MIRROR. Its twin is `frontend/src/js/session/ambiente-do-navegador.js`, which
 * also holds the one User-Agent parser of the product; this side only validates. The lists feed
 * the Joi of the two anonymous telemetry routes (`POST /diag/erro-cliente` and
 * `POST /uso/eventos`) and are repeated in three CHECK constraints (`uso_sessoes_navegador_check`,
 * `uso_sessoes_so_check` and `defeitos_navegadores_check`). A new value enters the frontend leaf,
 * this leaf and the CHECK in the same commit; the guards are
 * `frontend/tests/unit/ambiente-do-navegador-espelha-backend.test.js` and
 * `tests/unit/ambiente-do-navegador-check.test.js`.
 *
 * ZERO IMPORTS, by contract, for the reason of `eventos-de-uso.js`: the Joi and the tests load
 * it, and it must stay loadable without `DATABASE_URL` and `JWT_SECRET`.
 *
 * THE SERVER NEVER PARSES A USER-AGENT. The family of a report comes from the client parser,
 * like every other field of the body: a second parser here would disagree with the first one
 * the day either is fixed, and the admin table would show two answers for the same header.
 */

/** @type {ReadonlyArray<string>} */
export const FAMILIAS_DE_NAVEGADOR = Object.freeze(['chrome', 'firefox', 'edge', 'safari', 'opera', 'outro']);

/** @type {ReadonlyArray<string>} */
export const FAMILIAS_DE_SO = Object.freeze(['windows', 'macos', 'linux', 'chromeos', 'android', 'ios', 'outro']);

/** @type {ReadonlyArray<string>} */
export const TIPOS_DE_DISPOSITIVO = Object.freeze(['desktop', 'movel', 'tablet']);

/** @type {ReadonlyArray<string>} */
export const VERSOES_DE_WEBGL = Object.freeze(['webgl2', 'webgl', 'nenhum']);

/** Size and range limits, the same numbers the client cuts to. */
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
 * The fields of the environment block, which are EXACTLY the keys of `ambienteSchema`
 * (`src/modules/diag/diag.schemas.js`) and of the client rule table (`CAMPOS_DE_AMBIENTE` in
 * `frontend/src/js/session/ambiente-do-navegador.js`). A field on one side only is a 422 for the
 * whole report, and the capturer does not queue a 4xx: the report is lost in silence. Guards:
 * `tests/unit/ambiente-do-navegador-check.test.js` (this list against the Joi) and the frontend
 * mirror (this list against the client, and the Joi source against the client).
 * @type {ReadonlyArray<string>}
 */
export const CAMPOS_DE_AMBIENTE = Object.freeze([
  'navegador', 'navegadorVersao', 'so', 'soVersao', 'soVersaoCh', 'dispositivo', 'toque',
  'telaLargura', 'telaAltura', 'janelaLargura', 'janelaAltura', 'escala', 'idioma', 'fuso',
  'nucleos', 'memoriaGb', 'webgl', 'gpu', 'texturaMax', 'armazenamentoUsoMb',
  'armazenamentoCotaMb', 'armazenamentoPersistente', 'online', 'cookies', 'contextoSeguro',
  'indexedDB',
]);

/**
 * Whether a number is a positive power of two. The storage quota travels ONLY as one: the client
 * rounds it (`cotaArredondadaMb`) because the exact Chromium quota derives from the disk size and,
 * next to the rest of the block, links anonymous occurrences of the same machine.
 * @param {*} n
 * @returns {boolean}
 */
export function ehPotenciaDeDois(n) {
  return Number.isInteger(n) && n >= 1 && Math.log2(n) % 1 === 0;
}

/** The accepted shapes of the four free text fields. Mirrored by source text with the client. */
export const FORMAS_DE_AMBIENTE = Object.freeze({
  versao: /^\d{1,6}(?:\.\d{1,8}){0,4}$/,
  idioma: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/,
  fuso: /^[A-Za-z0-9_+\-/]{1,64}$/,
  gpu: /^[\x20-\x7E]{1,160}$/,
});

/**
 * One line that says what machine an occurrence happened on, for the terminal.
 *
 * It prints what the client declared, and nothing is inferred here (no "Windows 11" from a
 * version number): the admin tab does that reading, and a second reading in the command would
 * diverge from it. Missing fields are simply left out.
 * @param {*} a - The `ambiente` of an occurrence.
 * @returns {string} Empty when there is nothing to say.
 */
export function resumoDoAmbiente(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return '';
  const partes = [];
  const junto = (...xs) => xs.filter((x) => x !== undefined && x !== null && x !== '').join(' ');
  const nav = junto(a.navegador, a.navegadorVersao);
  if (nav) partes.push(nav);
  const so = junto(a.so, a.soVersaoCh ? `${a.soVersaoCh} (dicas)` : a.soVersao);
  if (so) partes.push(so);
  if (a.dispositivo) partes.push(`${a.dispositivo}${Number.isInteger(a.toque) ? ` toque=${a.toque}` : ''}`);
  if (Number.isInteger(a.telaLargura) && Number.isInteger(a.telaAltura)) {
    partes.push(`tela ${a.telaLargura}x${a.telaAltura}${Number.isFinite(a.escala) ? `@${a.escala}` : ''}`);
  }
  if (Number.isInteger(a.janelaLargura) && Number.isInteger(a.janelaAltura)) {
    partes.push(`janela ${a.janelaLargura}x${a.janelaAltura}`);
  }
  const lugar = junto(a.idioma, a.fuso);
  if (lugar) partes.push(lugar);
  if (Number.isInteger(a.nucleos)) partes.push(`${a.nucleos} nucleos`);
  if (Number.isFinite(a.memoriaGb)) partes.push(`${a.memoriaGb} GB`);
  if (a.webgl) partes.push(junto(a.webgl, a.gpu ? `"${a.gpu}"` : null, Number.isInteger(a.texturaMax) ? `tex=${a.texturaMax}` : null));
  if (Number.isInteger(a.armazenamentoUsoMb) || Number.isInteger(a.armazenamentoCotaMb)) {
    partes.push(`disco ${a.armazenamentoUsoMb ?? '?'}/${a.armazenamentoCotaMb ?? '?'} MB`);
  }
  const bandeiras = ['online', 'cookies', 'contextoSeguro', 'indexedDB']
    .filter((k) => typeof a[k] === 'boolean')
    .map((k) => `${k}=${a[k] ? 'sim' : 'nao'}`);
  if (bandeiras.length) partes.push(bandeiras.join(' '));
  return partes.join(' | ');
}
