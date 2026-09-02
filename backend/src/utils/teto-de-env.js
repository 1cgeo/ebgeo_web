// Path: src/utils/teto-de-env.js
/**
 * @fileoverview A leitura de um TETO NUMÉRICO de `process.env`, com default.
 *
 * ELA EXISTIA DUAS VEZES, uma em cada limitador que nasce dentro do seu próprio módulo
 * (`modules/diag/diag.rate-limit.js` e `modules/uso/uso.rate-limit.js`), byte a byte igual. As
 * duas cópias eram inofensivas até o dia em que alguém consertasse UMA: a regra que decide o
 * que fazer com um valor não numérico é uma decisão de segurança (cair no default em vez de
 * derrubar o boot), e duas versões dela divergem sem nada ficar vermelho, porque nenhum teste
 * compara os dois arquivos.
 *
 * POR QUE ELA NÃO É `config.js`, e a ausência é deliberada: os limitadores destes dois módulos
 * são configuração da ROTA, não da aplicação, e por isso não passam pela validação de faixa do
 * boot (`validateEnvVariables`). O preço está declarado no `.env.example`: valor fora de forma
 * cai no default, e o servidor sobe.
 *
 * ZERO IMPORTS, para que os dois limitadores continuem carregáveis sem `config`.
 */

/**
 * Um inteiro POSITIVO de `process.env`, ou o padrão.
 *
 * Zero e negativo caem no default junto com o lixo, e isso é a decisão: `max: 0` num
 * `express-rate-limit` recusa TODA requisição, então uma variável zerada por engano derrubaria
 * a rota inteira em vez de afrouxá-la. Errar para o default é o único lado seguro aqui.
 *
 * @param {string} nome - a variável de ambiente
 * @param {number} padrao - o valor quando ela falta ou não é um inteiro positivo
 * @returns {number}
 */
export function tetoDeEnv(nome, padrao) {
  const bruto = parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : padrao;
}
