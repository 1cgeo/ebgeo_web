// Path: src/modules/uso/uso.horizonte.js
/**
 * @fileoverview As duas conversões que o relatório de uso precisa fazer entre o driver e o
 * payload. Ambas são a lápide de um jeito ingênuo de escrever a mesma linha.
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
