// Path: src/utils/logger.js
import pino from 'pino';
import config from '../config.js';

/**
 * Fields that must never reach the logs, whatever object they arrive inside.
 * Matched by NAME at any depth, because the leak below arrived through a path
 * nobody would have thought to enumerate.
 */
const SECRET_FIELDS = new Set([
  'password', 'newPassword', 'currentPassword', 'senha',
  'token', 'refreshToken', 'accessToken', 'apiKey', 'api_key',
  'password_hash', 'passwordHash', 'pass', 'secret', 'authorization',
]);

/**
 * Recursively strips secret-named fields. Depth- and size-bounded so a hostile or
 * merely huge payload cannot turn error logging into a CPU sink.
 */
export function scrubSecrets(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubSecrets(v, depth + 1));

  const out = {};
  let n = 0;
  for (const key of Object.keys(value)) {
    if (++n > 100) { out['...'] = 'truncated'; break; }
    out[key] = SECRET_FIELDS.has(key) ? '[REDACTED]' : scrubSecrets(value[key], depth + 1);
  }
  return out;
}

/**
 * Error serializer that keeps pino's standard output but drops the payload that
 * validation errors drag along.
 *
 * THE LEAK THIS CLOSES: pino applies `stdSerializers.err` by default, and that
 * serializer copies EVERY enumerable property of the error (`for (const key in err)`).
 * A `Joi.ValidationError` carries the entire validated body in `_original`, plus each
 * rejected value in `details[].context.value`. Validation runs at the edge, BEFORE the
 * controller, so a failed `POST /auth/login` or `/auth/register` — a wrong password, a
 * too-short one, a typo'd field — wrote the submitted password to the log in clear
 * text, at `warn`, on every 422.
 *
 * The irony is exact: error-handler.js already documents this worry ("a credential
 * passed via ?api_key= never lands in the logs") and guards the URL with `redactUrl`,
 * while the request BODY walked in through the adjacent door.
 *
 * Scrubbing by field NAME rather than by pino `redact` paths is deliberate: paths
 * require knowing the shape in advance, and the shape here (`err._original.password`)
 * is an internal of a third-party library that can change on any upgrade.
 */
export function errSerializer(err) {
  const base = pino.stdSerializers.err(err);

  // Joi's copy of the whole submitted body. Never useful in a log, and the direct
  // carrier of the credential.
  delete base._original;

  if (Array.isArray(base.details)) {
    base.details = base.details.map((d) => ({
      message: d?.message,
      path: d?.path,
      type: d?.type,
      // context.value IS the rejected value; keep only which key it belonged to.
      context: d?.context ? { key: d.context.key, label: d.context.label } : undefined,
    }));
  }

  return scrubSecrets(base);
}

const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  serializers: { err: errSerializer },
  // Defense in depth for shapes the serializer never sees: anything logged directly
  // as a field rather than nested inside `err`.
  redact: {
    paths: [
      'password', 'newPassword', 'currentPassword',
      'token', 'refreshToken', 'accessToken', 'apiKey',
      'headers.authorization', 'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  transport: config.isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});

export default logger;
