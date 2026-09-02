// Path: src/modules/uso/uso.horizonte.js
/**
 * @fileoverview As conversões que o relatório de uso precisa fazer entre o driver e o
 * payload. Cada uma é a lápide de um jeito ingênuo de escrever a mesma linha, e a lista viva
 * são os `export` daqui: a contagem morava nesta frase e envelheceu na primeira conversão
 * acrescentada.
 *
 * ZERO IMPORTS, de propósito: sem eles o módulo é testável em node puro, sem `DATABASE_URL`
 * nem `JWT_SECRET`, que são as variáveis que a avaliação de `config.js` exige.
 *
 * O QUE ESTE ARQUIVO **NÃO** FAZ, e a ausência é a decisão que mais custou pensar: ele não
 * decide se a janela pedida cabe no dado que existe. Chegou a decidir, numa versão anterior
 * desta fase, por um `cobreJanela(horizonte, desde)` publicado no payload como dois
 * booleanos. Foi retirado, e o motivo é que a resposta já carrega os dois instantes
 * (`desde` e `horizonte.*`), de onde o consumidor tira uma leitura ESTRITAMENTE MAIS RICA
 * que um booleano: são QUATRO desfechos, não dois — o dado cobre a janela, o dado começa
 * DEPOIS do início dela (poda), não há dado NENHUM (`null`), e o servidor não informou o
 * campo (versão anterior). Um booleano colapsa os três últimos num só, e a tela precisa
 * dizer coisas diferentes em cada um. Publicá-lo criaria, em dois pacotes, duas respostas
 * para a mesma pergunta, com a do servidor sendo a mais pobre e a primeira que o próximo
 * consumidor alcançaria.
 *
 * O QUE O CONSUMIDOR PRECISA SABER, e não cabe no JSON: `null` NÃO é "está tudo coberto".
 * Tabela vazia hoje não prova que ela sempre esteve vazia — instalação nova e instalação
 * recém-podada são indistinguíveis pelo dado —, e em JavaScript `desde < null` é `false`,
 * então a comparação ingênua produz silêncio exatamente no caso sem evidência nenhuma.
 * `null` é um estado que se NOMEIA, nunca um que se ignora.
 */

/**
 * Um instante do banco em epoch ms, ou `null`.
 *
 * `MIN(created_at)` sobre tabela VAZIA devolve NULL, e o driver devolve `Date` no resto.
 * Uma conversão distraída (`new Date(null).getTime()`) daria 0, ou seja 1970: um horizonte
 * que cobre qualquer janela imaginável, que é a mentira mais confortável que este relatório
 * pode contar.
 *
 * @param {Date|string|null|undefined} valor
 * @returns {number|null} epoch ms, ou null quando não há instante
 */
export function paraEpoch(valor) {
  if (valor === null || valor === undefined) return null;
  const ms = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * `COUNT(*)` do Postgres é `bigint`, e o driver o devolve como STRING.
 *
 * Sem esta passagem o payload sai com `"12"` em vez de `12`, e o cliente que somar dois
 * deles recebe `"12" + "3" === "123"`. É erro que compila, roda e produz número plausível.
 *
 * @param {string|number|null|undefined} valor
 * @returns {number}
 */
export function inteiro(valor) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Uma medida FRACIONÁRIA que pode não existir, e a ausência dela é `null`, jamais zero.
 *
 * É a irmã de {@link inteiro} e é o AVESSO dela, o que faz das duas um par fácil de confundir
 * na hora de escolher. `percentile_cont` sobre conjunto vazio devolve NULL: ninguém da coorte
 * chegou àquele passo, então não há mediana nenhuma. Passar esse NULL por `inteiro()` produz
 * `0`, e `0` ali é uma MEDIDA ("chegaram lá no mesmo instante em que se cadastraram"), isto é,
 * a afirmação mais forte que este relatório poderia inventar sobre um conjunto vazio. O par de
 * conversões existe justamente porque contagem ausente É zero e medida ausente NÃO é.
 *
 * NÃO ARREDONDA, e isso é decisão: o número que a tela diz tem de ser o número que o servidor
 * mandou, então quem arredonda é a frase, num lugar só. Arredondar nos dois lados são dois
 * vereditos sobre a mesma medida, e eles divergem no dia em que um dos dois mudar de casa
 * decimal.
 *
 * @param {string|number|null|undefined} valor
 * @returns {number|null} o número, ou null quando não há medida
 */
export function decimalOuNulo(valor) {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}
