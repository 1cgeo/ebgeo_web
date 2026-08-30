// Path: src/utils/logger.js
import pino from 'pino';
import pretty from 'pino-pretty';
import config from '../config.js';
import { criarLogDiario } from './log-diario.js';

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

/**
 * Os destinos do log, montados em 2026-08-30 quando o log passou a SOBREVIVER à sessão.
 *
 * O QUE MUDOU E POR QUÊ. Antes daqui saía uma coisa só: stdout, bonito em desenvolvimento
 * (worker de `pino-pretty` via `transport`) e JSON cru em produção. Ninguém guardava
 * nenhum dos dois, então a evidência de um defeito durava o que durasse o terminal ou o
 * container. Agora são DOIS destinos em paralelo, e os dois valem nos dois ambientes.
 *
 * POR QUE `multistream` E NÃO `transport`. As duas opções do pino são excludentes: com
 * `transport` o destino roda numa thread de trabalho e não se pode passar um stream
 * próprio. O `pino-pretty` também funciona em processo (é o uso legado e suportado,
 * `pino(pretty())`), e é essa forma que permite ter o terminal legível E o arquivo ao
 * mesmo tempo. O custo é a formatação sair no mesmo event loop, o que só importaria num
 * volume de log que esta aplicação não tem.
 *
 * O ARQUIVO VALE EM DESENVOLVIMENTO TAMBÉM, e não é descuido: o defeito que motivou tudo
 * isto (um 400 em laço no push de sync) aconteceu em DEV, e a mensagem do servidor se
 * perdeu porque só existia na rolagem de um terminal. Em teste ele fica desligado, senão a
 * suíte sujaria o disco a cada rodada — e ali o `level` já é `silent`, então não há nada
 * para escrever de qualquer modo.
 */
function montarDestinos() {
  const destinos = [];

  destinos.push({
    stream: config.isProd
      ? process.stdout
      : pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }),
  });

  if (config.log.emArquivo && !config.isTest) {
    destinos.push({
      stream: criarLogDiario({
        diretorio: config.log.dir,
        retencaoDias: config.log.retencaoDias,
      }),
    });
  }

  return pino.multistream(destinos);
}

const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  serializers: { err: errSerializer },
  // Defense in depth for shapes the serializer never sees: anything logged directly
  // as a field rather than nested inside `err`.
  //
  // A redação e o serializer rodam ANTES dos destinos, então o arquivo em disco recebe
  // exatamente o mesmo texto já limpo que o terminal: não há caminho por onde uma
  // credencial chegue ao arquivo e não ao stdout.
  redact: {
    paths: [
      'password', 'newPassword', 'currentPassword',
      'token', 'refreshToken', 'accessToken', 'apiKey',
      'headers.authorization', 'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
}, montarDestinos());

export default logger;
