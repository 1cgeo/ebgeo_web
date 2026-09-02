// Path: src/modules/uso/uso.rate-limit.js
/**
 * @fileoverview O limitador de `POST /uso/eventos`. UM limiter, UMA rota.
 *
 * POR QUE ELE PRECISA EXISTIR, e por que o argumento NÃO é o mesmo do relato de erro.
 * `POST /diag/erro-cliente` é protegido porque assinaturas diferentes inserem uma linha
 * cada. Aqui a chave é FECHADA em doze dos treze eventos (dia, página, evento,
 * qualificador), então o pior caso de LINHAS é pequeno por construção. O que precisa de teto
 * são as outras três coisas: a única dimensão de qualificador LIVRE (`ferramenta.ativada`,
 * ver `020_uso_de_produto.sql`), a chegada de sessões inventadas (`uso_sessoes` é uma linha
 * por UUID que o cliente cunha, e ele pode cunhar quantos quiser) e o custo por requisição,
 * que é uma transação com dois UPSERT. Este é o SEGUNDO endpoint anônimo deste servidor que
 * escreve no banco, e o primeiro tem limitador desde o dia em que nasceu.
 *
 * STORE PRÓPRIO, como todo limitador desta casa (`src/middleware/rate-limit.js`): uma
 * instância compartilhada faz o tráfego de uma rota gastar a cota de outra. Aqui isso seria
 * pior que o normal em uma direção específica: telemetria de USO e telemetria de ERRO
 * chegam no mesmo instante, num deploy ruim, e um balde comum faria o relato de erro (que é
 * a evidência do incidente) ser recusado pelo volume de contagem de tela.
 *
 * O `handler` É O `makeLimiterHandler` COMPARTILHADO, e não um envelope próprio, porque a
 * recusa muda foi o defeito que aquele ajudante existe para ter fechado: num endpoint
 * anônimo que escreve no banco, a recusa é o único sinal de que alguém está enchendo a
 * tabela. O nome (`uso-eventos`) viaja na linha e é o que a separa de todo outro limitador.
 *
 * OS NÚMEROS. 30 lotes por minuto por endereço. O cliente honesto manda MUITO menos: ele
 * acumula em memória e descarrega por intervalo e no `visibilitychange`, então uma sessão
 * inteira cabe em poucos lotes. O teto é folgado para o pior caso legítimo, que é uma OM
 * inteira atrás de um egress NAT abrindo o app na mesma manhã, e é o mesmo caso legítimo que
 * fixa o teto do relato de erro em 60. Ele é MENOR que aquele de propósito: perder um lote
 * de contagem custa um número um pouco menor, perder um relato de erro custa a evidência do
 * incidente.
 */

import rateLimit from 'express-rate-limit';
import { makeLimiterHandler } from '../../middleware/rate-limit.js';
import config from '../../config.js';
import { tetoDeEnv } from '../../utils/teto-de-env.js';

export const usoEventosLimiter = rateLimit({
  windowMs: tetoDeEnv('RATE_LIMIT_USO_EVENTOS_WINDOW_MS', 60_000),
  max: tetoDeEnv('RATE_LIMIT_USO_EVENTOS_MAX', 30),
  standardHeaders: true,
  legacyHeaders: false,
  // Mesmos dois desligamentos de `src/middleware/rate-limit.js`, e pelo mesmo motivo: a
  // suíte dirige o limitador por supertest num endereço de loopback, e estas duas checagens
  // avisariam a cada rodada sem indicar problema real. As demais ficam LIGADAS.
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  handler: makeLimiterHandler('uso-eventos'),
  // O store em memória acumularia pela rodada inteira (o app é importado uma vez), então o
  // default em teste é pular; `RATE_LIMIT_FORCE=1` religa para o caso dedicado.
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});
