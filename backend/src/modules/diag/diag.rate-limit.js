// Path: src/modules/diag/diag.rate-limit.js
/**
 * @fileoverview O limitador de `POST /diag/erro-cliente`. UM limiter, UMA rota.
 *
 * POR QUE ELE PRECISA EXISTIR. É o único endpoint ANÔNIMO deste servidor que ESCREVE no
 * banco. O UPSERT por assinatura já tira o pior (mil ocorrências do mesmo defeito são uma
 * linha), mas ele não cobre o caso adversário: assinaturas DIFERENTES a cada requisição
 * inserem uma linha cada, e aí a telemetria vira a porta de entrada. O teto por endereço é
 * o que separa "um navegador em laço" de "alguém enchendo a tabela".
 *
 * STORE PRÓPRIO, como todo limitador desta casa (`src/middleware/rate-limit.js`): uma
 * instância compartilhada faz o tráfego de uma rota gastar a cota de outra, e aqui isso
 * seria pior que o normal — um cliente com defeito silenciaria o `/api/config`, que é o
 * endpoint sem o qual o app nem boota.
 *
 * POR QUE ELE NASCE AQUI, e não em `src/middleware/rate-limit.js`. Precedente literal: o
 * `configLimiter` nasceu dentro do módulo de config porque aquele arquivo estava sendo
 * editado em paralelo, e foi dobrado para lá assim que as duas edições pousaram. Este está
 * na mesma situação, e a metade que já pôde ser dobrada foi: o `handler` é o
 * `makeLimiterHandler` compartilhado desde 2026-09-01. A configuração continua aqui porque a
 * ROTA é daqui; o que não podia continuar era a RECUSA MUDA.
 *
 * A DOBRA DO HANDLER, e por que ela não é cosmética. Este arquivo repetia o envelope 429 e
 * não registrava nada, ou seja, ele recusava e ninguém ficava sabendo, que é exatamente o
 * defeito que `makeLimiterHandler` existe para ter fechado no resto da casa. Num endpoint
 * ANÔNIMO que ESCREVE no banco, a recusa é o único sinal de que alguém está enchendo a
 * tabela: sem ela o ataque é indistinguível de silêncio. O envelope não mudou, e a
 * identidade foi conferida antes da dobra (mesmo status, mesmo JSON byte a byte), porque
 * ele é contrato documentado em `docs/wiki/erros-api.md`.
 *
 * OS NÚMEROS. 60 relatos por minuto por endereço. O cliente honesto manda pouquíssimos (ele
 * dedupe por assinatura antes de falar), então o teto é folgado para o pior caso legítimo —
 * uma OM inteira atrás de um egress NAT abrindo o app na mesma manhã de um deploy ruim,
 * que é exatamente a hora em que estes relatos são a evidência que se quer. Errar para
 * baixo aqui não protege nada e apaga o registro do incidente.
 */

import rateLimit from 'express-rate-limit';
import { makeLimiterHandler } from '../../middleware/rate-limit.js';
import config from '../../config.js';
import { tetoDeEnv } from '../../utils/teto-de-env.js';

export const clientErrorLimiter = rateLimit({
  windowMs: tetoDeEnv('RATE_LIMIT_CLIENT_ERROR_WINDOW_MS', 60_000),
  max: tetoDeEnv('RATE_LIMIT_CLIENT_ERROR_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false,
  // Mesmos dois desligamentos de `src/middleware/rate-limit.js`, e pelo mesmo motivo: a
  // suíte dirige o limitador por supertest num endereço de loopback, e estas duas
  // checagens avisariam a cada rodada sem indicar problema real. As demais ficam LIGADAS,
  // inclusive as que gritam quando `req.ip` é o endereço do proxy.
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  // O nome viaja na linha de recusa e é o que separa esta rota de todo outro limitador: o
  // `req` sozinho não o carrega. Ver `limiterDenialPayload`.
  handler: makeLimiterHandler('client-error'),
  // O store em memória acumularia pela rodada inteira (o app é importado uma vez), então o
  // default em teste é pular; `RATE_LIMIT_FORCE=1` religa para o caso dedicado.
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});
