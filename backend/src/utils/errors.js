// Path: src/utils/errors.js
//
// LANGUAGE CONTRACT. `message` is HUMAN text and ships in pt-BR: the web client folds
// it straight into what the user reads (`buildApiErrorMessage`,
// frontend/src/js/store/sync/api-client.js), so an English default put English on a
// Brazilian user's screen. `code` is a MACHINE identifier and stays English forever —
// clients branch on it, so translating it would break them.
//
// The defaults below are what every `new XError()` WITHOUT an argument emits, which is
// why translating this one file moves many call sites at once.
//
// WORDING RULE: prefer a sentence that says what to DO. Where the class covers many
// unrelated causes (403, 400, the generic 422 headline) the text stays deliberately
// vague, because a message that names the WRONG cause is worse than one that names none.
//
// `NotFoundError` TRANSLATES BY TABLE since 2026-09-22 (`NOT_FOUND_SENTENCES`, below). Its
// resource comes from ~98 call sites as an English noun ('Atlas', 'Photo', 'User'), so
// translating only the template would yield 'Photo não encontrado', half English and with
// the wrong gender for every feminine noun. The table gives each noun a whole sentence.
// Two things stay as they were, and both are deliberate:
//   - a noun NOT in the table keeps `${resource} not found`. That is where the 360 module's
//     nouns live ('Photo', 'Project', 'Target', 'Tile'...): its flat `{ error }` envelope is
//     the frozen sv360 contract, and its tests pin those strings by name;
//   - an argument that is ALREADY a sentence (it ends in a period) is used as-is. Two call
//     sites passed one ('Preparação da importação não encontrada.', the diag module's
//     `DEFEITO_INEXISTENTE`) and got "... not found" glued after it.

// CAUSE CONTRACT, added 2026-09-01. Every class here takes a trailing, OPTIONAL
// `options` object and forwards it to `Error`, which reads exactly one key from it,
// `cause`. It exists for the site that TRANSLATES a driver error into an AppError:
// without it the original is dropped on the floor, and an `EBUSY` or an `EACCES` on a
// bundle of tens of GB reaches the operator as "not a valid SQLite file", sending him
// to look for corruption in a perfect file.
//
// THE CAUSE IS FOR THE LOG, NEVER FOR THE CLIENT, and that separation is not a
// convention, it is how the two paths happen to be built. The response body is written
// from `err.message` (the `AppError` branch of `middleware/error-handler.js`, and the
// flat `{ error }` envelope of `modules/streetview360/sv360-error.js`), and `message` is
// the FIRST argument, untouched by the option. Nothing in either handler reads `cause`.
//
// WHAT PINO 8.21 DOES WITH IT, measured on the installed tree (pino-std-serializers
// 6.2.2, `lib/err.js` + `lib/err-helpers.js`), because it decides whether this is safe:
//   - `new Error(m, { cause })` installs `cause` NON-enumerable (spec:
//     CreateNonEnumerableDataPropertyOrThrow), so `Object.keys` and `for...in` miss it;
//   - the serializer FOLDS the cause into TWO STRINGS, `messageWithCauses` giving
//     `'outer: inner'` and `stackWithCauses` appending `'\ncaused by: <inner stack>'`;
//   - it NEVER copies the cause as a field: its property loop skips it by name
//     (`key !== 'cause'`), so even the enumerable form (`err.cause = x`, by assignment)
//     is not copied.
// The consequence that matters: the value-bearing fields the PostgreSQL driver hangs off
// an error (`detail` with the failing ROW, `where`, `query` with the credential inlined,
// `params`) do NOT reach the log line when that error is a CAUSE. They are absent, not
// elided: `elidirCamposDoPg` (`utils/logger.js`) walks `Object.keys` looking for nested
// error-like values, and there is nothing there to walk. Only the cause's own `message`
// and `stack` travel, and neither carries row data.
//
// So DO NOT hang a driver error anywhere but on `cause`. An error-like value under any
// OTHER enumerable field (`err.original = pgErr`) IS copied whole by the same
// serializer, and then it depends on the elision having reached it.
export class AppError extends Error {
  /**
   * @param {string} message - human text, pt-BR; this is what the client reads.
   * @param {number} statusCode
   * @param {string} code - machine identifier, English forever.
   * @param {{cause?: unknown}} [options] - forwarded to `Error`; only `cause` is read.
   *   Omitting it is the pre-2026-09-01 behaviour, byte for byte: `Error` installs no
   *   `cause` when the argument is not an object.
   */
  constructor(message, statusCode, code, options) {
    super(message, options);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Expected errors (vs programming bugs)
  }
}

/**
 * The pt-BR sentence for each resource noun the web screens can show. See the header for what
 * is deliberately left out.
 * @type {Readonly<Record<string, string>>}
 */
const NOT_FOUND_SENTENCES = Object.freeze({
  'Resource': 'Recurso não encontrado.',
  'Atlas': 'Atlas não encontrado.',
  'Atlas resource': 'Este recurso não está emprestado a este atlas.',
  'User': 'Usuário não encontrado.',
  'API key': 'Chave de API não encontrada.',
  'Catalog item': 'Item de catálogo não encontrado.',
  'Access group': 'Grupo de acesso não encontrado.',
  'Group member': 'Esta pessoa não está no grupo.',
  'Share': 'Compartilhamento não encontrado.',
  'Grant': 'Concessão não encontrada.',
  'Rank': 'Posto ou graduação não encontrado.',
  'Organization': 'Organização não encontrada.',
  'Map': 'Mapa não encontrado.',
  'Source map': 'Mapa de origem não encontrado.',
  'Briefing': 'Briefing não encontrado.',
  '3D asset': 'Modelo 3D não encontrado.',
  '3D model': 'Modelo 3D não encontrado.',
  'Image': 'Imagem não encontrada.',
  'Image file': 'Arquivo da imagem não encontrado.',
  'Video': 'Vídeo não encontrado.',
});

/**
 * @param {*} resource - An English noun, or a finished pt-BR sentence.
 * @returns {string}
 */
function notFoundMessage(resource) {
  const texto = String(resource);
  if (/[.!?]$/.test(texto.trim())) return texto;
  return Object.hasOwn(NOT_FOUND_SENTENCES, texto) ? NOT_FOUND_SENTENCES[texto] : `${texto} not found`;
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', options) {
    super(notFoundMessage(resource), 404, 'NOT_FOUND', options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Você não tem permissão para esta ação.', options) {
    super(message, 403, 'FORBIDDEN', options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Faça login para continuar.', options) {
    super(message, 401, 'UNAUTHORIZED', options);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito com o estado atual. Recarregue a página e tente de novo.', options) {
    super(message, 409, 'CONFLICT', options);
  }
}

// `options` is THIRD here, not second: `details` already owns that slot and is part of
// the response body (the `ValidationError` branch of the error handler puts it on the
// wire). Reordering to match the siblings would silently turn every existing
// `new ValidationError(msg, details)` into one carrying `details` as a cause.
export class ValidationError extends AppError {
  constructor(message = 'Falha na validação', details = null, options) {
    super(message, 422, 'VALIDATION_ERROR', options);
    this.details = details;
  }
}

/**
 * 429 — a conta bateu num TETO DE RECURSO declarado (decisão D12 de 2026-09-14).
 *
 * Distinta do 429 do limitador de taxa, e a distinção está no `code`, não no status: o limitador
 * (`middleware/rate-limit.js`) responde por conta própria, sem passar pelo `errorHandler`, e diz
 * "pedidos demais em sequência"; esta diz "você já tem N destes". O cliente que olhe só o status
 * trata as duas como backoff, e é por isso que a `message` precisa nomear o teto: ela é o que a
 * pessoa lê, e aqui esperar não resolve.
 *
 * SEM `message` PADRÃO, de propósito. Um teto sem número não diz o que fazer, e o número varia
 * por instalação (as duas faixas são env, e zero desliga), então a frase é montada no sítio que
 * conhece o teto e a contagem.
 */
export class QuotaExceededError extends AppError {
  constructor(message, options) {
    super(message, 429, 'QUOTA_EXCEEDED', options);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Requisição inválida.', options) {
    super(message, 400, 'BAD_REQUEST', options);
  }
}

/**
 * 503 — sobrecarga TRANSITÓRIA: o cliente deve tentar de novo.
 * Distinto do 500: nada quebrou, o recurso só está temporariamente ocupado
 * (ex.: o advisory lock por atlas do push de sync estourou o `lock_timeout`).
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Serviço temporariamente indisponível. Tente novamente em instantes.', options) {
    super(message, 503, 'SERVICE_UNAVAILABLE', options);
  }
}
