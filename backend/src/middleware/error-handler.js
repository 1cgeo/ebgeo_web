// Path: src/middleware/error-handler.js
import logger, { errSerializer } from '../utils/logger.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { redactUrl } from '../utils/redact-url.js';
import config from '../config.js';
import { toValidationDetails } from '../utils/validation-messages.js';

/**
 * The line a failed request writes: level, fields and message.
 *
 * Split out of the handler so the SHAPE is testable. Under `NODE_ENV=test` the logger runs
 * at level `silent`, so a test spying on pino's output would report green with the whole
 * record gone. Same split, and for the same reason, as `limiterDenialPayload`
 * (`middleware/rate-limit.js`) and `queryLogPayload` (`database/index.js`).
 *
 * WHY THE STACK IS DECIDED HERE, of all places. Measured over the `.jsonl` files this house
 * had written up to 2026-09-01: an error line costs ~1665 bytes against ~242 for a normal
 * request line, 79% of those bytes are the stack, and the whole corpus holds EIGHT distinct
 * stacks. A `NotFoundError` from the router emits the same 1.4 kB of express frames for
 * every URL: it describes the path through the handler, never the case. So a 4xx logs
 * WITHOUT the stack and a 5xx keeps it, and the decision cannot live in `errSerializer`,
 * because the serializer only ever sees the error and this is the only place that knows the
 * status. There is no ceiling, no sampling and no state anywhere on this path.
 *
 * WHAT SURVIVES, and it is what diagnosing the looping 400 of 2026-08-30 actually used:
 * `err.type`, `err.message`, `err.code`, `err.statusCode`, the Joi `details` (which field
 * failed), plus `reqId`, `method` and the redacted `url` that `normalizarRota` groups by.
 * The one thing that goes is the throw SITE, which for a 4xx is either a constant
 * (`Route not found`) or already implied by the route.
 *
 * NO top-level `statusCode` here, and that is deliberate for the same reason
 * `limiterDenialPayload` states: `resumirStatus` (`utils/diag-consulta.js`) counts one
 * request per record carrying one, so a failed request would be counted TWICE by
 * `npm run diag -- status`. The status is already in `err.statusCode`, and
 * `fundirPorRequisicao` copies the request line's own into the fused record.
 *
 * @param {Error & {statusCode?: number, isJoi?: boolean}} err
 * @param {import('express').Request} req
 * @returns {{nivel: string, statusRegistrado: number, campos: object, mensagem: string}}
 */
export function requestErrorLogPayload(err, req) {
  // Client-caused errors (4xx: Joi, AppError 4xx, body-parser malformed JSON, etc.) are
  // logged at `warn` so they don't pollute the error stream as if they were server faults;
  // genuine 5xx stay at `error`.
  const statusRegistrado = typeof err?.statusCode === 'number'
    ? err.statusCode
    : (err?.isJoi ? 422 : 500);
  const comPilha = statusRegistrado >= 500;

  // Serialized HERE rather than handed to pino raw, because dropping the stack means acting
  // on the serialized shape. `errSerializer` marks its own output and short-circuits on it,
  // so pino's second pass over this object is a no-op instead of the silent wreck it would
  // otherwise be (it rewrites `type` to `'Object'`; see the marker in `utils/logger.js`).
  const erro = errSerializer(err);
  // `erro` pode não ser objeto: `next('boom')` é legal no Express e o serializer devolve a
  // string crua. Ali não há pilha para tirar nem nada que se possa apagar.
  if (!comPilha && erro !== null && typeof erro === 'object') delete erro.stack;

  const campos = {
    err: erro,
    // O mesmo id que `request-logger.js` carimba na linha de requisição. É o que permite a
    // `scripts/diag.js` fundir as DUAS linhas que uma requisição falha produz, em vez de
    // contar o mesmo erro duas vezes em duas assinaturas diferentes. Ausente quando a
    // falha precede o logger de requisição (corpo malformado), e ali a fusão não é
    // necessária porque a outra linha não existe.
    reqId: req?.id,
    method: req?.method,
    // `originalUrl` pela mesma razão de `request-logger.js`: aqui a pilha de routers está
    // ainda mais garantidamente em pé (o erro veio de dentro dela), então `req.url` é o
    // caminho relativo ao mount, e as duas linhas da MESMA requisição sairiam com URLs
    // diferentes, o oposto do que o `reqId` acima existe para permitir.
    url: redactUrl(req?.originalUrl || req?.url),
    userId: req?.user?.id,
  };

  // A SESSÃO DO NAVEGADOR, quando ela existe. `req.sessaoId` já vem validado por
  // `sessaoDaRequisicao` (`middleware/request-logger.js`), então aqui não há segunda
  // gramática: esta linha ECOA, e é isso que impede as duas linhas da mesma requisição de
  // divergirem sobre quem a fez.
  //
  // O ECO É O QUE FAZ O CAMPO SOBREVIVER À FUSÃO. `fundirPorRequisicao`
  // (`utils/diag-consulta.js`) fica com o registro que carrega `err`, ou seja, com ESTA
  // linha; sem o eco, o `sessaoId` da linha de requisição seria descartado junto com ela em
  // todo erro de rota. (A fusão também o copia da outra linha, e as duas metades são de
  // propósito: esta cobre o relatório que não funde, aquela cobre a linha antiga.)
  //
  // Chave só quando há valor, nunca `sessaoId: null`: o mesmo motivo escrito em
  // `requestLogPayload`. O vão declarado é o de sempre, o mesmo do `reqId`: falha ANTERIOR
  // ao logger de requisição não tem `req.sessaoId`, porque ninguém leu o cabeçalho ainda.
  if (req?.sessaoId) campos.sessaoId = req.sessaoId;

  return {
    nivel: comPilha ? 'error' : 'warn',
    statusRegistrado,
    campos,
    mensagem: 'Request error',
  };
}

/**
 * Centralized error handler middleware.
 * Must be registered last in the middleware chain.
 */
export function errorHandler(err, req, res, next) {
  // The URL is redacted so a credential passed via ?api_key= never lands in the logs; the
  // level and the stack are decided in `requestErrorLogPayload`.
  const linha = requestErrorLogPayload(err, req);
  logger[linha.nivel](linha.campos, linha.mensagem);

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
