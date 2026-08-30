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
 * na mesma situação. O que NÃO se copia daquele episódio é a duplicação do envelope 429,
 * que é contrato documentado (`docs/wiki/erros-api.md`): quando este arquivo for dobrado
 * para o middleware, é o `handler` compartilhado de lá que fica.
 *
 * OS NÚMEROS. 60 relatos por minuto por endereço. O cliente honesto manda pouquíssimos (ele
 * dedupe por assinatura antes de falar), então o teto é folgado para o pior caso legítimo —
 * uma OM inteira atrás de um egress NAT abrindo o app na mesma manhã de um deploy ruim,
 * que é exatamente a hora em que estes relatos são a evidência que se quer. Errar para
 * baixo aqui não protege nada e apaga o registro do incidente.
 */

import rateLimit from 'express-rate-limit';
import config from '../../config.js';

const teto = (nome, padrao) => {
  const bruto = parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : padrao;
};

export const clientErrorLimiter = rateLimit({
  windowMs: teto('RATE_LIMIT_CLIENT_ERROR_WINDOW_MS', 60_000),
  max: teto('RATE_LIMIT_CLIENT_ERROR_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false,
  // Mesmos dois desligamentos de `src/middleware/rate-limit.js`, e pelo mesmo motivo: a
  // suíte dirige o limitador por supertest num endereço de loopback, e estas duas
  // checagens avisariam a cada rodada sem indicar problema real. As demais ficam LIGADAS,
  // inclusive as que gritam quando `req.ip` é o endereço do proxy.
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente mais tarde.' },
    });
  },
  // O store em memória acumularia pela rodada inteira (o app é importado uma vez), então o
  // default em teste é pular; `RATE_LIMIT_FORCE=1` religa para o caso dedicado.
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});
