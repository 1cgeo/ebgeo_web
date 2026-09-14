// Path: src/modules/users/users.rate-limit.js
/**
 * @fileoverview O limitador de `GET /users/search`. UM limiter, UMA rota.
 *
 * POR QUE ELE PRECISA EXISTIR. A rota é legítima e larga de propósito: compartilhar atlas é
 * direito de qualquer conta (cláusula 4.1) e para compartilhar é preciso achar a pessoa, então
 * ela responde sobre TODA organização. O piso de três caracteres e o teto de vinte linhas
 * encarecem a varredura por consulta; o que nenhum dos dois alcança é o NÚMERO de consultas, e
 * sem teto o efetivo inteiro sai vinte linhas por vez, só mais devagar (a alternativa recusada
 * na decisão D13 era exatamente parar no teto de linhas).
 *
 * A CHAVE É O PRINCIPAL, E NÃO O ENDEREÇO, e essa é a divergência deliberada com a família de
 * `middleware/rate-limit.js`, cujos limitadores guardam rota ANÔNIMA (ali só existe endereço
 * para chavear). Aqui a rota é `auth` estrito: quem varre tem conta, e conta é atribuível.
 * Chavear por endereço puniria a OM inteira atrás de um egress NAT pelo que uma conta fez, que
 * é o modo de falha que o comentário de `refreshLimiter` já mediu noutra rota. O endereço é o
 * FALLBACK, para a requisição que chega sem principal utilizável (ela vai levar 401 logo
 * adiante, e mesmo assim não pode ser ilimitada).
 *
 * ELE VEM ANTES DO `validate`, como em `POST /auth/register` e em `POST /diag/erro-cliente`: o
 * teto tem de valer também para o termo malformado, senão a recusa de validação vira a porta
 * barata de bater na rota.
 *
 * O NÚMERO. 60 buscas por minuto por conta. O cliente faz debounce de 250 a 300 ms e só chama
 * a partir de três caracteres, então um humano digitando um nome gasta poucas unidades; 60/min
 * é folgado para quem está caçando alguém em várias telas ao mesmo tempo, e corta a varredura,
 * que precisa de milhares. O knob existe porque 60 é palpite calibrado, não medição.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { makeLimiterHandler } from '../../middleware/rate-limit.js';
import config from '../../config.js';
import { tetoDeEnv } from '../../utils/teto-de-env.js';
import { principalUserId } from '../../utils/principal.js';

export const userSearchLimiter = rateLimit({
  windowMs: tetoDeEnv('RATE_LIMIT_USER_SEARCH_WINDOW_MS', 60_000),
  max: tetoDeEnv('RATE_LIMIT_USER_SEARCH_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false,
  // Mesmos dois desligamentos de `src/middleware/rate-limit.js`, e pelo mesmo motivo: a suíte
  // dirige o limitador por supertest num endereço de loopback, e estas duas checagens avisariam
  // a cada rodada sem indicar problema real. As demais ficam LIGADAS.
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  handler: makeLimiterHandler('user-search'),
  // O `usuario:` do prefixo não é enfeite: sem ele um id de conta e um endereço IPv4 caem no
  // mesmo espaço de chaves, e duas coisas de natureza diferente compartilhariam balde.
  keyGenerator: (req) => {
    const id = principalUserId(req.user);
    return id ? `usuario:${id}` : `endereco:${ipKeyGenerator(req.ip, 56)}`;
  },
  // O store em memória acumularia pela rodada inteira (o app é importado uma vez), então o
  // default em teste é pular; `RATE_LIMIT_FORCE=1` religa para o caso dedicado.
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});
