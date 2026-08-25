// Path: src/middleware/error-handler.js
import logger from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { redactUrl } from '../utils/redact-url.js';
import config from '../config.js';
import { toValidationDetails } from '../utils/validation-messages.js';

/**
 * Centralized error handler middleware.
 * Must be registered last in the middleware chain.
 */
export function errorHandler(err, req, res, next) {
  // Client-caused errors (4xx: Joi, AppError 4xx, body-parser malformed JSON,
  // etc.) are logged at `warn` so they don't pollute the error stream as if they
  // were server faults; genuine 5xx stay at `error`. The URL is redacted so a
  // credential passed via ?api_key= never lands in the logs.
  const loggedStatus = typeof err.statusCode === 'number'
    ? err.statusCode
    : (err.isJoi ? 422 : 500);
  const logFn = loggedStatus < 500 ? logger.warn : logger.error;
  logFn.call(logger, {
    err,
    method: req.method,
    url: redactUrl(req.url),
    userId: req.user?.id,
  }, 'Request error');

  // Once the status line and headers are on the wire, there is no response left to
  // write: `res.json()` calls `res.set('Content-Type', …)` → `setHeader()` after
  // flush → ERR_HTTP_HEADERS_SENT, thrown from INSIDE the last error handler in
  // the chain. Express then hands the new error to finalhandler, which can only
  // destroy the socket — so the client sees a truncated body and the original
  // error is replaced by a bookkeeping one.
  //
  // The guard comes AFTER the log on purpose: this is the only place the failure
  // gets recorded (finalhandler does not log), and losing that record is how a
  // mid-stream fault becomes invisible. `next(err)` is delegation, not recovery:
  // Express's default handler closes the connection, which is the honest outcome.
  //
  // The pattern is already used one level down, in `sv360-error.js:16`. That is a
  // ROUTER-level handler mounted inside one module; this one is global and last,
  // so it is the handler that actually has nowhere to delegate to.
  if (res.headersSent) {
    return next(err);
  }

  // Handle Joi validation errors. The per-field `message` is rendered in pt-BR
  // (`validation-messages.js`) because the web client folds these strings straight into what
  // the user reads; `field` and `code` stay on the wire in English, as machine keys.
  if (err.isJoi) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Falha na validação',
        details: toValidationDetails(err.details),
      },
    });
  }

  // Handle our custom AppError
  if (err instanceof AppError) {
    const response = {
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (err instanceof ValidationError && err.details) {
      response.error.details = err.details;
    }

    return res.status(err.statusCode).json(response);
  }

  // Map common PostgreSQL error codes (SQLSTATE) to clean 4xx responses instead
  // of leaking a raw 500. Messages are generic on purpose — the driver's text can
  // expose column/constraint names, so we never forward err.message here.
  const PG_ERROR_MAP = {
    '23505': { statusCode: 409, code: 'CONFLICT', message: 'Já existe um registro com esses dados. Altere e tente de novo.' },
    '23503': { statusCode: 409, code: 'CONFLICT', message: 'O registro referenciado não existe ou ainda está em uso.' },
    '23502': { statusCode: 400, code: 'BAD_REQUEST', message: 'Preencha todos os campos obrigatórios.' },
    '23514': { statusCode: 400, code: 'BAD_REQUEST', message: 'Um valor não atende a uma regra do sistema.' },
    '22P02': { statusCode: 400, code: 'BAD_REQUEST', message: 'Valor mal formado (identificador ou tipo inválido).' },
    '22003': { statusCode: 400, code: 'BAD_REQUEST', message: 'Valor numérico fora do intervalo permitido.' },
  };
  if (typeof err.code === 'string' && PG_ERROR_MAP[err.code]) {
    const mapped = PG_ERROR_MAP[err.code];
    return res.status(mapped.statusCode).json({
      error: { code: mapped.code, message: mapped.message },
    });
  }

  // Client errors that carry their own status but are not AppErrors — most
  // commonly body-parser failures (malformed JSON → 400 `entity.parse.failed`,
  // oversized body → 413 `entity.too.large`). These are the caller's fault, so
  // label them with a client-error code instead of masquerading as a 500
  // INTERNAL_ERROR.
  //
  // The code is derived from the status so it never contradicts it (a 404 must
  // not be labeled BAD_REQUEST). The message is only forwarded when `err.expose`
  // is set — the `http-errors` convention that body-parser follows to mark a
  // message as safe for the client; anything else falls back to a generic string,
  // matching how the rest of this handler refuses to leak raw error text in prod.
  if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
    const CLIENT_CODES = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
    };
    const safeMessage = (err.expose === true || config.isDev)
      ? err.message
      : 'Requisição inválida.';
    return res.status(err.statusCode).json({
      error: {
        code: CLIENT_CODES[err.statusCode] || 'BAD_REQUEST',
        message: safeMessage || 'Requisição inválida.',
      },
    });
  }

  // Handle unknown errors
  const statusCode = err.statusCode || 500;
  const response = {
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isDev ? err.message : 'Algo deu errado. Tente novamente.',
    },
  };

  // Include stack trace in development
  if (config.isDev) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}
