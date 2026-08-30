// Path: src/middleware/request-logger.js
import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';
import { redactUrl } from '../utils/redact-url.js';

/**
 * Request logging middleware using Pino.
 *
 * `req.id` É PARTE DO CONTRATO DO LOG, e não conveniência: UMA requisição que falha produz
 * DUAS linhas, a deste middleware (com `statusCode` e `duration`) e a do `errorHandler`
 * (com o objeto de erro e a pilha), e até 2026-08-30 nada as ligava. A consequência era
 * medida, não hipotética: o relatório de `scripts/diag.js` contava cada erro duas vezes e
 * ainda partia a contagem em duas assinaturas, porque as duas linhas não têm o mesmo
 * formato. Com o id, `diag-consulta.js` funde as duas e fica com a mais rica.
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
    const duration = Date.now() - start;
    const logData = {
      reqId: req.id,
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

    if (res.statusCode >= 400) {
      logger.warn(logData, 'request error');
    } else {
      logger.info(logData, 'request');
    }
  });

  next();
}
