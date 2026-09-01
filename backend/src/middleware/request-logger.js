// Path: src/middleware/request-logger.js
import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import { redactUrl } from '../utils/redact-url.js';

/**
 * Value written to `ip` when the address is not determinable.
 *
 * An ABSENT key would be indistinguishable from an older build that did not log the
 * address at all, and an empty string reads like a real answer. The sentinel says the
 * one thing that is true: we looked, and the socket had nothing to tell. It is also the
 * only value in this field that can never come from a caller, so a query for it selects
 * exactly the broken cases.
 */
export const UNKNOWN_ADDRESS = 'unknown';

/**
 * The client address, as a string that is always safe to write to the log.
 *
 * `req.ip` is the CLIENT here and not nginx, and that is not free: it holds only because
 * `app.js` runs `app.set('trust proxy', config.trustProxy)` with `TRUST_PROXY_HOPS`
 * (default 1) matching the one reverse proxy the documented deployment puts in front. The
 * coupling is worth stating out loud, because it fails in the direction that looks fine:
 * if the hop count ever stops matching the deploy, this field silently becomes the SAME
 * address on every line, which is worse than no field at all. Two live guards already
 * watch that condition from the other side: express-rate-limit's `trustProxy` and
 * `xForwardedForHeader` validations, left ON outside the test suite (`rate-limit.js`).
 *
 * Express returns `undefined` when there is no socket address to derive (a connection
 * already torn down), and `X-Forwarded-For` is caller-supplied text on the trusted hop,
 * so neither the presence nor the type of `req.ip` may be assumed.
 *
 * @param {{ip?: unknown}} req - the Express request.
 * @returns {string} a non-empty string; `UNKNOWN_ADDRESS` when nothing is determinable.
 */
export function clientAddress(req) {
  const raw = req?.ip;
  if (typeof raw !== 'string') return UNKNOWN_ADDRESS;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_ADDRESS;
}

/**
 * Builds the object handed to pino for one finished request. Separated from the
 * middleware so the SHAPE is testable: under `NODE_ENV=test` the logger runs at level
 * `silent`, so a test that spies on pino's output would pass green with the field gone.
 * Same split, and for the same reason, as `queryLogPayload` in `src/database/index.js`.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} duration - milliseconds elapsed since the request entered.
 * @returns {object} the pino payload.
 */
export function requestLogPayload(req, res, duration) {
  return {
    reqId: req.id,
    // O ENDEREÇO É DADO PESSOAL, e entra aqui porque é a única forma de responder "quem
    // está tentando entrar". A pergunta não tem outra fonte neste servidor: `LOGIN_FAILED`
    // está FORA de `audit_trail` por impossibilidade de esquema (`audit_trail.actor_id` é
    // NOT NULL, e numa tentativa que falha não há ator para gravar), então uma rajada de
    // login errado não deixa linha nenhuma na trilha. Quem procurar lá não vai achar: o
    // `.jsonl` em `data/logs` é a ÚNICA evidência desse evento, e é ele que a retenção por
    // idade limita (`LOG_RETENTION_DAYS`, default 30 dias, em `src/utils/log-diario.js`).
    // A guarda do dado é o prazo, não a ausência do campo.
    //
    // EM TODA REQUISIÇÃO, e não só nas rotas de credencial, por três razões:
    //  - o firehose já é UMA linha por requisição, então o campo a mais é barato, enquanto
    //    um campo que aparece em algumas linhas e não em outras é pior que confuso: não se
    //    distingue "não foi logado" de "não foi determinável";
    //  - a pergunta que vem logo depois de "quem tentou entrar" é "o que MAIS esse endereço
    //    tocou", e ela só se responde se o endereço estiver nas linhas que NÃO são de
    //    /auth. Restringir o campo às rotas de credencial responderia a primeira pergunta e
    //    fecharia a segunda, que é a que dura mais tempo num incidente;
    //  - é aqui, e não na linha de 429, que mora a resposta a "quem TENTOU". O limitador só
    //    fala quando um balde estoura, e a chave do `authLimiter` inclui o `username`: mil
    //    contas tentadas uma vez cada do mesmo endereço são mil baldes com um acerto, zero
    //    recusas e zero linhas de 429. O que enxerga essa varredura é esta linha, com
    //    `statusCode: 401` repetido sob o mesmo `ip`.
    ip: clientAddress(req),
    method: req.method,
    // `originalUrl`, NUNCA `req.url`, e a diferença só aparece a jusante. O Express
    // REESCREVE `req.url` ao entrar num router montado, tirando o prefixo do mount, e
    // este ouvinte roda no `finish`, que dispara enquanto a pilha de routers ainda está
    // em pé: o que se lia aqui era o caminho relativo ao último router visitado. Medido
    // na aba Diagnóstico em 2026-08-30, e o custo era exatamente o que o relatório existe
    // para evitar: a MESMA rota aparecia em duas linhas (`POST /erro-cliente` com 3
    // chamadas e `POST /api/v1/diag/erro-cliente` com 1), e `POST /login` era
    // indistinguível de qualquer outro `/login` montado em outro prefixo. `originalUrl` é
    // posto uma vez, no início do pedido, e nenhum router o toca.
    url: redactUrl(req.originalUrl || req.url),
    statusCode: res.statusCode,
    duration,
    userId: req.user?.id,
  };
}

/**
 * Request logging middleware using Pino.
 *
 * `req.id` É PARTE DO CONTRATO DO LOG, e não conveniência: UMA requisição que falha produz
 * DUAS linhas, a deste middleware (com `statusCode` e `duration`) e a do `errorHandler`
 * (com o objeto de erro e a pilha), e até 2026-08-30 nada as ligava. A consequência era
 * medida, não hipotética: o relatório de `scripts/diag.js` contava cada erro duas vezes e
 * ainda partia a contagem em duas assinaturas, porque as duas linhas não têm o mesmo
 * formato. Com o id, `diag-consulta.js` funde as duas e fica com a mais rica. A recusa por
 * limitador (`rate-limit.js`) carimba o mesmo `reqId` pela mesma razão.
 *
 * O id é gerado AQUI, e não num middleware próprio, porque este é o primeiro ponto por
 * onde toda requisição logada passa. A consequência é conhecida e está declarada: uma
 * falha ANTERIOR a este ponto (corpo malformado, que morre no parser de JSON montado logo
 * acima) não tem `req.id` nem linha de requisição, só a do `errorHandler`. Ela continua no
 * relatório, sozinha, que é o comportamento correto para uma requisição que nunca chegou a
 * ser processada.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  req.id = randomUUID();

  res.on('finish', () => {
    const logData = requestLogPayload(req, res, Date.now() - start);

    if (res.statusCode >= 400) {
      logger.warn(logData, 'request error');
    } else {
      logger.info(logData, 'request');
    }
  });

  next();
}
