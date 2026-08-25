// Path: src/utils/safe-error-message.js
//
// Sanitized client-facing text for errors that reach the client through a channel
// the global `errorHandler` NEVER sees:
//
//   - the collaboration WebSocket (`{type:'error', code, message}` — not an Express
//     response, so no middleware runs);
//   - per-item `failed[]` arrays inside a 2xx envelope (bulk image upload, 360 batch
//     calibration) — a partial-success contract, so the request never errors at all.
//
// Those three sites forwarded `err.message` verbatim, which for a pg-promise error is
// the driver's own text: constraint and index names (`images_pkey`,
// `valid_feature_type`), column names, the offending row, and — for an fs error —
// the ABSOLUTE server path. `error-handler.js` refuses to forward that text on the
// REST side (see its PG_ERROR_MAP comment) and `sv360-error.js` refuses it on the 360
// side; these channels were the half of the system that did not.
//
// FORM COPIED FROM `integrityRejectionReason` (sync.service.js): map SQLSTATE to a
// fixed generic sentence, send the RAW error to the logger. Deliberately WITHOUT a
// `config.isDev` passthrough, unlike error-handler.js:114 — there the raw text is the
// only diagnostic a developer gets from a 500, whereas here the caller always logs the
// full `err`, so a dev branch would add an environment-dependent output for zero
// diagnostic gain. Behaviour identical in every environment is also what makes it
// testable (`config.isDev` is false under NODE_ENV=test, so an isDev branch would be a
// dead branch the suite could never exercise).
//
// The texts mirror `PG_ERROR_MAP` in error-handler.js on purpose: the whole defect was
// that the same database failure got a masked answer over REST and a raw one over WS.
// Same failure, same words.

/**
 * SQLSTATE -> fixed client-safe text. Keys and wording track error-handler.js's
 * PG_ERROR_MAP; the two extra classes (22001/22003) come from the 360/images paths,
 * where an over-long filename or an out-of-range INTEGER is reachable from the body.
 */
const PG_SAFE_MESSAGES = Object.freeze({
  '22001': 'Valor longo demais para o campo.',
  '22003': 'Valor numérico fora do intervalo permitido.',
  '22P02': 'Valor mal formado (identificador ou tipo inválido).',
  '23502': 'Preencha todos os campos obrigatórios.',
  '23503': 'O registro referenciado não existe ou ainda está em uso.',
  '23505': 'Já existe um registro com esses dados. Altere e tente de novo.',
  '23514': 'Um valor não atende a uma regra do sistema.',
});

/**
 * Client-safe message for an error whose raw text must not cross the API boundary.
 *
 * Three outcomes, in order:
 *  1. `err.isOperational` (an `AppError` subclass) -> `err.message` unchanged. That
 *     text was WRITTEN for the user ('Photo not found', 'Seu acesso a este atlas e
 *     somente leitura.', the 503 of a busy sync push); masking it would turn a precise,
 *     actionable answer into noise. This is the branch that keeps the 360 batch's
 *     NotFound/Forbidden per-item reasons informative.
 *  2. A recognized SQLSTATE -> the fixed sentence above.
 *  3. Anything else (fs errno, TypeError, an unmapped SQLSTATE) -> `fallback`.
 *
 * Note that (3) is reached by MEMBERSHIP in the map, not by a shape heuristic on
 * `err.code`: several fs errno values (`EPERM`, `EBUSY`, `EROFS`) are five uppercase
 * characters and would pass any "looks like a SQLSTATE" regex. An unmapped SQLSTATE
 * landing in `fallback` is the correct trade — the client learns nothing extra, which
 * is the invariant, and the operator still has the whole error in the log.
 *
 * @param {unknown} err - The caught error. Never mutated.
 * @param {string} [fallback] - Generic text for the unclassified case.
 * @returns {string} A message safe to send to any authenticated client.
 */
export function safeErrorMessage(err, fallback = 'A operação falhou.') {
  if (!err || typeof err !== 'object') return fallback;

  if (err.isOperational === true && typeof err.message === 'string' && err.message.length > 0) {
    return err.message;
  }

  const code = typeof err.code === 'string' ? err.code : null;
  if (code && Object.prototype.hasOwnProperty.call(PG_SAFE_MESSAGES, code)) {
    return PG_SAFE_MESSAGES[code];
  }

  return fallback;
}
