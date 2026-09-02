// Path: src/utils/query-lenta.js
/**
 * @fileoverview A QUERY LENTA: o contrato da linha que o hook do banco escreve, e a
 * aritmetica pura que decide se ela sai.
 *
 * POR QUE UM ARQUIVO SO PARA ISTO. Ele e FOLHA de ZERO IMPORTS, pela mesma razao que
 * `amostra-de-saude.js` e: quem ESCREVE a linha e `src/database/index.js`, que carrega
 * `config.js` e abre o pool, e quem a LE e `scripts/diag.js`, que existe para responder com
 * o Postgres fora. Se o marcador morasse com o escritor, o comando de log teria de importar
 * o modulo que cria o pool para saber o nome de um campo, e os cinco comandos de arquivo
 * perderiam a unica propriedade que os justifica. Se morasse com o leitor
 * (`diag-consulta.js`), o escritor passaria a depender do modulo de consulta, que e a
 * dependencia invertida. Folha no meio serve aos dois e nao arrasta nenhum.
 *
 * A MENSAGEM E O MARCADOR, e nao um campo proprio, ao contrario da amostra de saude. A
 * escolha copia `MSG_RECUSA_DE_LOTE` (`src/modules/sync/sync.service.js`) e tem o mesmo
 * motivo: esta linha sai por `logger.warn(payload, MARCADOR_QUERY_LENTA)`, o pino grava a
 * mensagem em `msg`, e `msg` e o campo que o `diag -- linhas --filtro` casa sem que nada
 * precise conhecer o formato. Ela e escrita SEM ACENTO de proposito, pelo mesmo motivo
 * daquela: um filtro digitado no terminal casa a linha como ela esta no disco, e ali o
 * acento viaja escapado (`ê`), de modo que uma mensagem acentuada exige que quem
 * procura acerte o escape.
 *
 * ELA FICA DE FORA DO `diag -- erros`, E ISSO E DESENHO. `ehErro` (`diag-consulta.js`) tem
 * tres termos, e esta linha nao satisfaz nenhum: sai em `warn` (nivel 40, abaixo de 50), nao
 * carrega campo `err` e nao carrega `statusCode`. E o mesmo corte de `refusedOpsLogPayload`:
 * uma query que passou do limite e o produto funcionando devagar, nao o produto falhando, e
 * despejar isso no relatorio de erros soterraria o 500 raro sob o comportamento lento
 * frequente. Quem quer ve-las tem `diag -- linhas --filtro` e o bloco de latencia do
 * `diag -- resumo`, que a conta na janela.
 */

/**
 * A mensagem da linha, que e o marcador pelo qual as duas pontas se encontram.
 *
 * Simbolo exportado e nao string digitada duas vezes: quem escreve e o hook do banco, quem
 * conta e o `resumo`, e uma divergencia de digitacao entre os dois nao produz erro nenhum,
 * produz uma contagem ZERO com cara de "nao houve query lenta".
 */
export const MARCADOR_QUERY_LENTA = 'db: query lenta';

/** O limite default, em ms, quando `SLOW_QUERY_MS` nao diz nada. */
export const PADRAO_DE_QUERY_LENTA_MS = 500;

/**
 * O PISO, e ele nao e zelo.
 *
 * Zero (ou negativo) transformaria TODA query numa linha de log, inclusive as do proprio
 * caminho que grava o log, e o resultado nao e ruido: e o `.jsonl` crescendo na cadencia do
 * trafego do sync, ou seja, a instrumentacao virando o incidente. Um seria degenerado do
 * mesmo jeito na pratica, mas e o menor valor que ainda significa "mais de zero
 * milissegundo", e o operador que o escreve esta pedindo isso de proposito.
 */
export const PISO_DE_QUERY_LENTA_MS = 1;

/**
 * Le `SLOW_QUERY_MS` e devolve o limite efetivo, sempre um numero finito >= piso.
 *
 * AUSENTE CAI NO DEFAULT, e ILEGIVEL TAMBEM, de proposito e ao contrario da regra que esta
 * casa aplica a `--desde` e `--intervalo` no comando. La, recusar e certo porque o valor
 * decide QUAL PERGUNTA foi respondida, e um default calado responde outra. Aqui o valor
 * decide so a sensibilidade de um aviso: derrubar o boot do servidor por causa de
 * `SLOW_QUERY_MS=quinhentos` trocaria uma linha de log mal calibrada por uma
 * indisponibilidade, que e o mesmo cambio que `parseRelease` (`src/config.js`) ja recusa.
 *
 * O PISO APARA EM VEZ DE RECUSAR pela mesma razao, e o efeito e conservador: quem escreveu
 * `0` querendo "tudo" recebe 1 ms, que na pratica e tudo, mas por um caminho que nao pode
 * degenerar em divisao por zero nem em comparacao contra `-Infinity`.
 *
 * @param {unknown} bruto - o valor cru da variavel de ambiente.
 * @returns {number} o limite em ms.
 */
export function parseLimiteDeQueryLenta(bruto) {
  if (typeof bruto !== 'string') return PADRAO_DE_QUERY_LENTA_MS;
  const limpo = bruto.trim();
  if (limpo === '') return PADRAO_DE_QUERY_LENTA_MS;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return PADRAO_DE_QUERY_LENTA_MS;
  return Math.max(PISO_DE_QUERY_LENTA_MS, Math.trunc(n));
}

/**
 * A duracao que o driver mediu, ou `null` quando ele nao mediu nenhuma.
 *
 * `result.duration` E CONFERIDO E NAO SUPOSTO. Na pg-promise 12.5.0 instalada aqui,
 * `node_modules/pg-promise/lib/query.js` faz `result.duration = Date.now() - start` UMA
 * linha antes de emitir o evento `receive`, e faz isso SO no ramo de resultado unico: no
 * ramo `multiResult` (varias instrucoes numa chamada so) ele percorre os resultados sem
 * carimbar duracao em nenhum. Ou seja, a ausencia do campo e um estado REAL desta versao, e
 * nao uma defesa teorica contra um upgrade.
 *
 * AUSENTE DEVOLVE `null` E NUNCA ZERO, pela regra de sempre desta camada: zero e o valor
 * mais tranquilizador que a duracao pode ter, e converter ausencia nele faria toda query
 * multi-resultado se declarar instantanea.
 *
 * @param {unknown} result - o `result` do evento `receive`.
 * @returns {number|null}
 */
export function duracaoDeQuery(result) {
  const d = result && typeof result === 'object' ? result.duration : undefined;
  return Number.isFinite(d) ? d : null;
}

/**
 * A decisao, isolada do log e do driver para ser exercitavel em node puro.
 *
 * O COMPARADOR E `>` E NAO `>=`, e a diferenca importa no unico ponto em que alguem vai
 * mexer: com o piso em 1 ms e `>=`, uma query de exatamente 1 ms acusaria, e a maior parte
 * das queries curtas mede 1 ms. `>` mantem o limite significando "passou de", que e como a
 * variavel se le.
 *
 * @param {Object} params
 * @param {number|null} params.duracaoMs - de `duracaoDeQuery`.
 * @param {number} params.limiteMs
 * @returns {boolean}
 */
export function deveAcusarQueryLenta({ duracaoMs, limiteMs }) {
  if (!Number.isFinite(duracaoMs)) return false;
  if (!Number.isFinite(limiteMs) || limiteMs < PISO_DE_QUERY_LENTA_MS) return false;
  return duracaoMs > limiteMs;
}
