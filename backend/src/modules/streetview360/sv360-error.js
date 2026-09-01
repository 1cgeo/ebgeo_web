// Path: src/modules/streetview360/sv360-error.js
// Router-level error middleware for the StreetView 360 module. Mounted as the
// LAST handler inside sv360.routes.js so it intercepts errors from these routes
// before they reach the global errorHandler (which would emit the backend-wide
// { error: { code, message } } shape). The 360 contract is the FROZEN flat
// envelope { error: 'message string' }.
//
// Status codes are preserved from AppError subclasses (404/403/401/409/...).
// Joi validation errors -> 422. 500s never leak internals outside dev.
//
// PORQUE ELE REGISTRA, E POR QUE COM A GRAMATICA DO HANDLER GLOBAL. Interceptar
// antes do `errorHandler` custava o REGISTRO junto com o envelope: ate 2026-09-01
// este arquivo nao logava nada, entao todo erro do 360 saia sem mensagem e sem
// pilha, e no `npm run diag -- erros` sobrava so a linha do logger de requisicao,
// sem `err`, colapsada numa assinatura generica. Visualizador 360 quebrado na tela
// era silencio do lado do servidor.
//
// A linha copia campo a campo a de `src/middleware/error-handler.js` (`err`,
// `reqId`, `method`, `url` por `redactUrl`, `userId`, e a mesma mensagem
// 'Request error'), e isso NAO e simetria estetica: `fundirPorRequisicao`
// (`src/utils/diag-consulta.js`) funde as DUAS linhas de uma requisicao falha pelo
// `reqId`, e `assinaturaDeErro` agrupa por rota mais tipo mais mensagem. Divergir
// aqui produziria assinatura propria, que conta o mesmo erro duas vezes: pior que
// o silencio de ontem, porque passa a contar errado.
//
// O ERRO VAI COMO `err`, INTEIRO, e nunca como texto ja formatado: o campo `err` e
// o unico que passa pelo `errSerializer` de `src/utils/logger.js`, que e quem
// elide `query`/`params`/`detail`/`where` que o driver do Postgres pendura no erro
// (e o `23505` logo abaixo e exatamente um erro desses). Formatar aqui contornaria
// o serializer e devolveria o vazamento pela porta de tras.
import config from '../../config.js';
import logger, { errSerializer } from '../../utils/logger.js';
import { redactUrl } from '../../utils/redact-url.js';

/**
 * O status que ESTE handler vai responder.
 *
 * Existe a parte para que o NIVEL do log e o corpo da resposta nao possam divergir:
 * os dois derivam daqui, e um ramo novo abaixo que esqueca esta funcao aparece como
 * 500 logado contra 409 respondido.
 * @param {Object} err
 * @returns {number}
 */
export function sv360StatusDoErro(err) {
  if (err?.isJoi) return 422;
  if (err?.code === '23505' || err?.code === '23503') return 409;
  return err?.statusCode || 500;
}

/**
 * Monta o objeto da linha de log, sem escrever nada.
 *
 * Separado da escrita pelo mesmo motivo de `queryLogPayload`/`dbErrorLogPayload`
 * (`src/database/index.js`): sob `NODE_ENV=test` o pino fica em nivel `silent`,
 * entao um teste que espiasse o stream passaria verde com o defeito intacto. O que
 * se asserta e o objeto construido.
 * @param {Object} err
 * @param {Object} req
 * @returns {{err: Object, reqId: string|undefined, method: string|undefined, url: string|undefined, userId: string|undefined}}
 */
export function sv360ErrorLogPayload(err, req) {
  // A PILHA SO VAI NO 5xx, a mesma regra de `requestErrorLogPayload` no handler global, e
  // pela mesma medicao: 80% dos bytes de uma linha de erro eram pilha, e a do 4xx descreve o
  // caminho do HANDLER, nao o caso (o mesmo quadro para toda URL). Este modulo era a ultima
  // superficie 4xx que ainda escrevia pilha, e ele e justamente o que serve as rotas SEM
  // limitador de taxa, ou seja onde um laco de 404 amplifica mais.
  //
  // Serializa AQUI, e nao entrega o erro cru ao pino, porque apagar a pilha e agir sobre a
  // forma ja serializada. O `errSerializer` marca a propria saida e curto-circuita na
  // segunda passada do pino; sem essa marca, a re-serializacao reescreveria `type` para
  // 'Object' e colapsaria a assinatura do relatorio.
  const erro = errSerializer(err);
  if (sv360StatusDoErro(err) < 500 && erro !== null && typeof erro === 'object') delete erro.stack;

  return {
    err: erro,
    // O mesmo id que o logger de requisicao carimba. E o que permite fundir as duas
    // linhas da mesma requisicao em vez de contar o erro duas vezes.
    reqId: req?.id,
    method: req?.method,
    // `originalUrl` e nao `req.url`: aqui dentro do router o segundo e o caminho
    // relativo ao mount, e as duas linhas da MESMA requisicao sairiam com URLs
    // diferentes, que e o oposto do que o `reqId` acima existe para permitir.
    url: redactUrl(req?.originalUrl || req?.url),
    userId: req?.user?.id,
  };
}

/**
 * Escreve a linha no nivel certo.
 *
 * 4xx em `warn` e 5xx em `error`, a mesma regra do handler global: erro do cliente
 * nao e falha do servidor e nao pode poluir o fluxo de erro. O 4xx NAO some do
 * relatorio por causa disso, e isso foi conferido no `ehErro` real
 * (`src/utils/diag-consulta.js`), que tem TRES termos em OU: `level >= 50`, a
 * PRESENCA de `err` e `statusCode >= 400`. Como esta linha sempre carrega `err`,
 * ela entra pelo segundo termo em qualquer nivel. Escolher `error` para 4xx seria
 * ganhar nada e perder a distincao que o operador usa para separar as duas coisas.
 * @param {Object} err
 * @param {Object} req
 * @param {number} status
 */
function registrar(err, req, status) {
  const logFn = status < 500 ? logger.warn : logger.error;
  logFn.call(logger, sv360ErrorLogPayload(err, req), 'Request error');
}

// The 4-arg signature (err, req, res, next) is what marks this as an Express
// error handler. `next` must stay in the signature even when only used for the
// headersSent re-throw path.
export function sv360ErrorHandler(err, req, res, next) {
  // O registro vem DEPOIS desta guarda, ao contrario do handler global, e a
  // assimetria e o desenho: la o `next(err)` cai no finalhandler, que nao loga, e
  // perder o registro ali torna a falha invisivel; aqui o `next(err)` cai no
  // proprio `errorHandler`, que loga com esta mesma gramatica. Logar antes daria
  // duas linhas para a mesma falha.
  if (res.headersSent) return next(err);

  const status = sv360StatusDoErro(err);
  registrar(err, req, status);

  if (err.isJoi) {
    return res.status(422).json({ error: err.details?.[0]?.message || 'Falha na validação' });
  }

  // L11 — a unique-violation is a CONFLICT, not a server fault. The global
  // handler already maps SQLSTATE 23505 → 409, but this router-level handler
  // intercepts first, so without this branch an sv360 duplicate surfaced as a
  // 500 — contradicting the comment on the very query that relies on it.
  // The driver message can name columns/constraints, so it is never forwarded.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Já existe um registro com esses dados. Altere e tente de novo.' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'O registro referenciado não existe ou ainda está em uso.' });
  }

  const message = status >= 500 ? (config.isDev ? err.message : 'Erro interno do servidor.') : err.message;
  return res.status(status).json({ error: message });
}
