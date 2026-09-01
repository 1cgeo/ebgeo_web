// Path: src/utils/logger.js
import pino from 'pino';
import pretty from 'pino-pretty';
import config from '../config.js';
import { criarLogDiario } from './log-diario.js';
import { elidirSql } from './elidir-sql.js';

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
 * Fields a PostgreSQL error carries that are FREE TEXT built out of the offending
 * ROW, not out of the schema. `detail` on a CHECK violation reads
 * `Failing row contains (…)` and prints the whole tuple, which for `users` includes
 * the bcrypt `password_hash`; `where` is the PL/pgSQL call context and echoes the
 * arguments a function was called with. Neither has a shape worth parsing, so they
 * are replaced rather than elided, and the marker stays so a reader can tell the
 * driver DID say something and that it was dropped on purpose.
 *
 * `constraint`, `table`, `column`, `schema` and `code` are NOT here: those name the
 * rule that fired, carry no row data, and are the whole diagnostic value of a pg
 * error.
 */
const CAMPOS_PG_COM_LINHA = ['detail', 'where'];

/**
 * Fields a pg-promise / pg error carries that are SQL text, already formatted with the
 * values inlined (see utils/elidir-sql.js for why the values are in the text at all).
 * `internalQuery` is the statement of an inner PL/pgSQL frame.
 */
const CAMPOS_PG_COM_SQL = ['query', 'internalQuery'];

/**
 * Strips the value-bearing fields the PostgreSQL driver hangs off an error.
 *
 * THE LEAK THIS CLOSES. `lib/query.js` of pg-promise stamps `err.query = err.query ||
 * query` and `err.params = err.params || params` before rejecting, and pino's default
 * err serializer copies EVERY enumerable property. With `pgFormatting` at its default
 * `false` that `query` is the statement with the credential substituted into it, so
 * every failed query wrote the api_key, the refresh-token hash or the password hash to
 * the log at level `error` — always on, and 30 days of retention in `data/logs`. The
 * `redact.paths` below could never have caught it: it matches by FIELD NAME, and the
 * field is called `query`.
 *
 * `params` is DELETED rather than elided. On the paths where pg-promise fills it (the
 * ones where its own formatting threw) it is the raw values array, and an array of
 * values has no shape left to preserve once the values are gone.
 *
 * @param {Record<string, unknown>} base - the object pino's err serializer produced.
 * @returns {Record<string, unknown>} the same object, mutated.
 */
function elidirCamposDoPg(base, depth = 0) {
  if (depth > 3 || base === null || typeof base !== 'object') return base;

  for (const campo of CAMPOS_PG_COM_SQL) {
    if (typeof base[campo] === 'string') base[campo] = elidirSql(base[campo]);
  }
  for (const campo of CAMPOS_PG_COM_LINHA) {
    if (base[campo] !== undefined && base[campo] !== null) base[campo] = '[REDACTED]';
  }
  delete base.params;

  // pino's own serializer recurses into error-like properties (`aggregateErrors`, and
  // any enumerable field holding an Error), and those inner objects come back with the
  // driver's fields intact. Following them is not thoroughness for its own sake: a
  // pg-promise transaction rejects with the FIRST error nested under the batch one.
  if (Array.isArray(base.aggregateErrors)) {
    base.aggregateErrors.forEach((e) => elidirCamposDoPg(e, depth + 1));
  }
  for (const chave of Object.keys(base)) {
    const valor = base[chave];
    if (valor && typeof valor === 'object' && !Array.isArray(valor) && typeof valor.stack === 'string') {
      elidirCamposDoPg(valor, depth + 1);
    }
  }
  return base;
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
 *
 * THE SECOND LEAK IT CLOSES, found in 2026-08-31 and of the same family: a PostgreSQL
 * error arrives carrying `query`, `params`, `detail`, `where` and `internalQuery`, and
 * every one of them is a channel for the value that failed. See `elidirCamposDoPg`.
 */
export function errSerializer(err) {
  const base = elidirCamposDoPg(pino.stdSerializers.err(err));

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
/**
 * O destino de ARQUIVO, guardado para que a saída do processo consiga ESPERÁ-LO.
 *
 * Ele é o único destino desta casa com fila própria e o único que sobrevive à sessão, então
 * é o único que precisa ser descarregado antes de um `process.exit()`. Guardar a referência
 * aqui é o que torna `descarregarLog()` possível: o objeto nasce dentro de `montarDestinos`
 * e o `pino.multistream` não devolve caminho de volta até ele (a lista interna guarda o
 * stream, mas atravessá-la seria depender do interno de outra biblioteca para achar o nosso).
 */
let destinoDiario = null;

function montarDestinos() {
  const destinos = [];

  destinos.push({
    stream: config.isProd
      ? process.stdout
      : pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }),
  });

  if (config.log.emArquivo && !config.isTest) {
    destinoDiario = criarLogDiario({
      diretorio: config.log.dir,
      retencaoDias: config.log.retencaoDias,
    });
    destinos.push({ stream: destinoDiario });
  }

  return pino.multistream(destinos);
}

const destinos = montarDestinos();

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
}, destinos);

/** Teto padrão da descarga de saída. Ver `descarregarLog`. */
export const PRAZO_DE_DESCARGA_MS = 2000;

/**
 * Descarrega os destinos de log antes de o processo morrer, COM PRAZO.
 *
 * O QUE O PINO GARANTE AQUI, E O QUE NÃO GARANTE, medido nesta versão (pino 8):
 * `logger.flush(cb)` (`lib/proto.js`) só chama `stream.flush` se o destino tiver um, e
 * `pino.multistream` NÃO tem `flush`, então chamá-lo devolveria o controle na hora tendo
 * descarregado nada, o que é pior que não existir, porque tem cara de descarga. O que o
 * multistream tem é `flushSync`, e ele percorre os destinos chamando `flushSync` NAQUELES
 * QUE TIVEREM UM. Nenhum dos nossos três tem: `process.stdout` não tem, o `Transform` do
 * `pino-pretty` não tem, e o destino diário é um objeto com `write`. Hoje, portanto,
 * `flushSync()` é uma varredura que não descarrega nada; ela é chamada assim mesmo por ser
 * o único gancho que o pino oferece, e assim um destino futuro que traga `flushSync` (um
 * `pino.destination` assíncrono, por exemplo) fica coberto sem ninguém precisar lembrar
 * deste arquivo.
 *
 * A DESCARGA REAL É A DO ARQUIVO, e ela é nossa: `fechar()` espera o `fs.WriteStream`
 * escoar, com teto. Fica DE FORA, declarado: o stdout. Ele não expõe descarga síncrona e,
 * quando é um cano (o caso do container), a escrita é assíncrona no POSIX, então um
 * `process.exit()` pode truncar a última linha do terminal. O arquivo é o destino que esta
 * função existe para salvar, e é ele o que sobrevive ao fechamento do terminal.
 *
 * NUNCA LANÇA. Todo chamador dela está saindo, e uma exceção aqui trocaria uma linha
 * perdida por uma saída pelo caminho errado, com outro código.
 *
 * @param {{prazoMs?: number}} [opts]
 * @returns {Promise<{desfecho: string}>}
 */
export async function descarregarLog({ prazoMs = PRAZO_DE_DESCARGA_MS } = {}) {
  try {
    destinos.flushSync();
  } catch {
    // Um destino que quebre ao descarregar não pode impedir a saída: quem chama está
    // morrendo, e sair com o código certo importa mais que a última linha.
  }
  if (!destinoDiario) return { desfecho: 'sem-arquivo' };
  try {
    return await destinoDiario.fechar({ prazoMs });
  } catch {
    return { desfecho: 'erro' };
  }
}

/**
 * O nível da linha de queda.
 *
 * `fatal` (60) é padrão do pino e é o único acima de `error`, então é ele que separa "o
 * processo MORREU" de "uma requisição falhou" num arquivo onde as duas coisas moram lado a
 * lado. Ele satisfaz também o primeiro termo de `ehErro` (`utils/diag-consulta.js`,
 * `level >= 50`), de modo que a queda aparece em `npm run diag -- erros` sem fiação nova.
 * Se um dia esta casa declarar `customLevels` sem `fatal`, a chamada viraria um
 * "is not a function" DENTRO do handler de queda, que é o pior lugar possível para uma
 * segunda exceção: por isso o teste assere que o nível existe no logger real.
 */
export const NIVEL_DA_QUEDA = 'fatal';

/**
 * O código de saída de uma queda.
 *
 * É 1 de propósito, que é exatamente o que o node já usa para exceção não tratada e, desde
 * que o modo `throw` virou o default, também para rejeição não tratada. O ganho desta
 * camada é o REGISTRO, não um número novo: inventar um aqui mudaria em silêncio o que o
 * supervisor e a política de reinício do container veem hoje, sem contar nada que a linha
 * de log já não conte melhor.
 */
export const CODIGO_DE_SAIDA_NA_QUEDA = 1;

/** Os dois eventos do node que significam "este processo não sabe mais o que faz". */
export const TIPO_DE_QUEDA = Object.freeze({
  EXCECAO: 'uncaughtException',
  REJEICAO: 'unhandledRejection',
});

const MENSAGEM_DE_QUEDA = Object.freeze({
  uncaughtException: 'Exceção não tratada: o processo vai encerrar',
  unhandledRejection: 'Rejeição de promessa não tratada: o processo vai encerrar',
});

/** Teto do texto do valor bruto de uma rejeição que não é `Error`. */
const TETO_DO_VALOR_BRUTO = 300;

/**
 * Um texto curto para o valor de uma rejeição que não é `Error`.
 *
 * DUAS ARMADILHAS. A primeira: descrever pode LANÇAR (referência circular no
 * `JSON.stringify`, `toString` hostil, getter que explode, `BigInt` dentro do objeto), e
 * este é o último lugar do sistema onde uma exceção pode aparecer, porque ela mataria
 * justamente o registro da morte. A segunda: o valor rejeitado costuma ser um corpo de
 * resposta ou um objeto de erro de biblioteca, ou seja, exatamente o tipo de coisa que
 * carrega credencial, então ele passa por `scrubSecrets` ANTES de virar texto. Depois de
 * virar texto não há mais nome de campo para redigir.
 */
function descreverValorBruto(valor) {
  try {
    if (valor === undefined) return 'undefined';
    if (valor === null) return 'null';
    const texto = typeof valor === 'object'
      ? JSON.stringify(scrubSecrets(valor))
      : String(valor);
    return String(texto ?? Object.prototype.toString.call(valor)).slice(0, TETO_DO_VALOR_BRUTO);
  } catch {
    return '[valor não descritível]';
  }
}

/**
 * `Promise.reject('boom')` é legal, e `Promise.reject()` também.
 *
 * O serializer de erro do pino espera algo com `stack`; entregar-lhe uma string produz uma
 * linha sem pilha e sem tipo, que é o mesmo silêncio que esta camada existe para fechar. Um
 * `Error` sintético carrega a pilha DAQUI (que ao menos nomeia o handler) e guarda o valor
 * original num campo próprio.
 */
function erroSintetico(tipo, valor) {
  const err = new Error(`${tipo} com um valor que não é Error (${typeof valor})`);
  err.name = 'QuedaSemErro';
  err.valorBruto = descreverValorBruto(valor);
  return err;
}

/**
 * Monta a linha de uma queda: o que se loga, em que nível e com que código de saída.
 *
 * PURA DE PROPÓSITO, e é essa a razão de ela existir separada do handler. O handler mata o
 * processo, então ele não é exercível dentro de um runner; e asserir contra o `logger` não
 * serviria, porque sob `NODE_ENV=test` ele está em `silent` e um teste assim passaria
 * verde com o defeito intacto. É o mesmo desenho de `queryLogPayload` e `dbErrorLogPayload`
 * (`database/index.js`).
 *
 * `causa` é aceita em qualquer forma: um `Error` de outro realm (um `vm`, um `worker`)
 * reprova no `instanceof` e mesmo assim tem pilha, então o reconhecimento é por FORMA.
 *
 * @param {string} tipo - um valor de `TIPO_DE_QUEDA`.
 * @param {unknown} causa - o erro, ou o que quer que tenha sido rejeitado.
 * @param {string} [origem] - o `origin` que o node passa ao `uncaughtException`.
 * @returns {{nivel: string, mensagem: string, campos: Object, codigoDeSaida: number}}
 */
export function payloadDeQueda(tipo, causa, origem) {
  const pareceErro = causa instanceof Error
    || (Boolean(causa) && typeof causa === 'object' && typeof causa.stack === 'string');
  const campos = { err: pareceErro ? causa : erroSintetico(tipo, causa), queda: tipo };
  // O `origin` só acrescenta quando diverge do evento (o caso do `uncaughtException`
  // levantado a partir de uma rejeição), senão ele repetiria o campo `queda`.
  if (origem && origem !== tipo) campos.origem = origem;

  return {
    nivel: NIVEL_DA_QUEDA,
    // `Object.hasOwn` e não `MENSAGEM_DE_QUEDA[tipo] ?? ...`: um tipo chamado 'constructor'
    // ou 'toString' devolveria função herdada em vez de cair no default.
    mensagem: Object.hasOwn(MENSAGEM_DE_QUEDA, tipo)
      ? MENSAGEM_DE_QUEDA[tipo]
      : 'Queda não classificada: o processo vai encerrar',
    campos,
    codigoDeSaida: CODIGO_DE_SAIDA_NA_QUEDA,
  };
}

export default logger;
