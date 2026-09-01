// Path: tests/unit/queda-do-processo.test.js
//
// A MONTAGEM da linha que o processo escreve ao morrer, e a descarga do log antes de sair.
//
// POR QUE A PARTE PURA EXISTE SEPARADA DO HANDLER. O handler (`registrarQuedaESair`, em
// `src/index.js`) termina em `process.exit`, então exercê-lo aqui mataria o runner; e
// asserir contra o `logger` não serviria de nada, porque sob `NODE_ENV=test` ele está em
// `silent` e um teste assim ficaria verde com o defeito intacto. `payloadDeQueda` é o
// mesmo desenho de `queryLogPayload`/`dbErrorLogPayload` (`src/database/index.js`): a
// decisão (o que se loga, em que nível, com que código de saída) vira objeto, e o objeto
// se assere. O caminho de verdade, com processo morrendo e arquivo em disco, é
// `tests/integration/queda-do-processo-registra-no-log.test.js`.
//
// O QUE CADA VERDE ESTARIA PROVANDO SE O CÓDIGO ESTIVESSE ERRADO:
//   - nível: um `error` no lugar de `fatal` deixaria a queda indistinguível de uma
//     requisição que falhou, no arquivo em que as duas moram lado a lado;
//   - código de saída: um zero transformaria a morte num desligamento limpo aos olhos do
//     supervisor, que é o silêncio que esta camada existe para fechar;
//   - valor bruto: `Promise.reject('boom')` e `Promise.reject()` são legais, e entregar uma
//     string ao serializer de erro do pino produz linha sem pilha e sem tipo;
//   - segredo: o valor rejeitado costuma ser um corpo de resposta, ou seja, exatamente o
//     tipo de objeto que carrega credencial, e depois de virar texto não há mais nome de
//     campo para redigir.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import logger, {
  payloadDeQueda,
  descarregarLog,
  NIVEL_DA_QUEDA,
  CODIGO_DE_SAIDA_NA_QUEDA,
  TIPO_DE_QUEDA,
} from '../../src/utils/logger.js';
import { ehErro } from '../../src/utils/diag-consulta.js';

describe('payloadDeQueda — o nível e o código de saída', () => {
  it('usa um nível que o logger REAL sabe emitir', () => {
    // Controle negativo do próprio nome: se um dia esta casa declarar `customLevels` sem
    // `fatal`, a chamada `logger[nivel](...)` viraria um "is not a function" DENTRO do
    // handler de queda, que é o pior lugar possível para uma segunda exceção.
    assert.equal(typeof logger[NIVEL_DA_QUEDA], 'function');
  });

  it('escolhe um nível que o leitor de diagnóstico classifica como erro', () => {
    // Contrato com `npm run diag -- erros`: a queda tem de aparecer lá sem fiação nova. O
    // teste importa o `ehErro` REAL em vez de comparar o número 50 à mão, do mesmo jeito
    // que `amostra-de-saude.test.js` faz, para continuar valendo se o critério mudar.
    const valorNumerico = logger.levels.values[NIVEL_DA_QUEDA];
    assert.equal(typeof valorNumerico, 'number');
    assert.equal(ehErro({ level: valorNumerico }), true);
  });

  it('devolve um código de saída diferente de zero', () => {
    const { codigoDeSaida } = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, new Error('x'));
    assert.notEqual(codigoDeSaida, 0, 'sair com 0 diz ao supervisor que o desligamento foi limpo');
    assert.equal(codigoDeSaida, CODIGO_DE_SAIDA_NA_QUEDA);
  });
});

describe('payloadDeQueda — os campos da linha', () => {
  it('entrega o erro INTEIRO e o marcador estrutural da queda', () => {
    const err = new Error('explosão');
    const { nivel, mensagem, campos } = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, err);

    assert.equal(nivel, NIVEL_DA_QUEDA);
    assert.equal(campos.err, err, 'o erro vai inteiro: quem serializa e limpa é o `errSerializer`');
    // O marcador é ESTRUTURAL, como o `amostra` da série de saúde: quem for filtrar quedas
    // no `.jsonl` casa um campo, nunca o texto da mensagem.
    assert.equal(campos.queda, TIPO_DE_QUEDA.EXCECAO);
    assert.match(mensagem, /não tratada/);
  });

  it('distingue a rejeição da exceção na mensagem', () => {
    const a = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, new Error('x')).mensagem;
    const b = payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, new Error('x')).mensagem;
    assert.notEqual(a, b, 'as duas causas pedem investigações diferentes');
    assert.match(b, /[Rr]ejeição/);
  });

  it('só acrescenta a origem quando ela diz algo além do evento', () => {
    const semOrigem = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, new Error('x'), 'uncaughtException');
    assert.equal(semOrigem.campos.origem, undefined, 'origem igual ao evento é campo repetido');

    const comOrigem = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, new Error('x'), 'unhandledRejection');
    assert.equal(comOrigem.campos.origem, 'unhandledRejection');
  });

  it('aceita um Error de outro realm, que reprova no instanceof', () => {
    // Um erro vindo de um `vm` ou de um `worker` não é `instanceof Error` neste realm, e
    // sintetizar um por cima dele jogaria fora a pilha de verdade.
    const forasteiro = { name: 'Error', message: 'de outro realm', stack: 'Error: de outro realm\n    at x' };
    const { campos } = payloadDeQueda(TIPO_DE_QUEDA.EXCECAO, forasteiro);
    assert.equal(campos.err, forasteiro);
  });

  it('cai no texto genérico para um tipo desconhecido, sem herdar do protótipo', () => {
    // `MENSAGEM_DE_QUEDA[tipo] ?? padrão` devolveria a função `toString` herdada em vez de
    // cair no default. É a mesma armadilha de tabela indexada por valor de fora.
    assert.match(payloadDeQueda('toString', new Error('x')).mensagem, /não classificada/);
    assert.match(payloadDeQueda('constructor', new Error('x')).mensagem, /não classificada/);
  });
});

describe('payloadDeQueda — rejeição que não é Error', () => {
  it('sintetiza um Error com pilha e guarda o valor original', () => {
    const { campos } = payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, 'boom');
    assert.equal(campos.err instanceof Error, true, 'sem pilha, a linha do pino sai sem tipo e sem rastro');
    assert.equal(campos.err.valorBruto, 'boom');
    assert.match(campos.err.message, /não é Error/);
  });

  it('descreve undefined e null em vez de sumir com eles', () => {
    // `Promise.reject()` é legal, e é o caso que mais parece "nada aconteceu".
    assert.equal(payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, undefined).campos.err.valorBruto, 'undefined');
    assert.equal(payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, null).campos.err.valorBruto, 'null');
  });

  it('REDIGE segredo antes de o objeto virar texto', () => {
    // Um corpo de resposta rejeitado é o transporte clássico de credencial até o log, e
    // depois de virar string não há mais nome de campo para redigir.
    const { campos } = payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, { usuario: 'ana', password: 'segredo-real' });
    assert.doesNotMatch(campos.err.valorBruto, /segredo-real/);
    assert.match(campos.err.valorBruto, /REDACTED/);
    assert.match(campos.err.valorBruto, /ana/, 'o resto do objeto continua diagnosticável');
  });

  it('não deixa um valor gigante virar a linha inteira', () => {
    const { campos } = payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, 'y'.repeat(10_000));
    assert.ok(campos.err.valorBruto.length <= 300, `ficou com ${campos.err.valorBruto.length} caracteres`);
  });

  it('não LANÇA descrevendo um valor hostil', () => {
    // Este é o último lugar do sistema onde uma exceção pode aparecer: ela mataria
    // justamente o registro da morte. Três formas que quebram um `JSON.stringify` ou um
    // `String()` ingênuo.
    const circular = { nome: 'ciclo' };
    circular.eu = circular;
    const comToStringHostil = { toString() { throw new Error('recuso'); } };
    const comBigInt = { n: 10n };

    assert.doesNotThrow(() => payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, circular));
    assert.doesNotThrow(() => payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, comToStringHostil));
    assert.doesNotThrow(() => payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, comBigInt));

    // E o que sai continua sendo uma linha, não um vazio.
    assert.equal(typeof payloadDeQueda(TIPO_DE_QUEDA.REJEICAO, circular).campos.err.valorBruto, 'string');
  });
});

describe('descarregarLog', () => {
  it('resolve e NUNCA lança, mesmo sem destino de arquivo', async () => {
    // Sob NODE_ENV=test o destino diário nem é montado, e este é o caso que garante que a
    // saída do processo não fica presa esperando um arquivo que não existe. Uma exceção
    // daqui trocaria a linha perdida por uma saída pelo caminho errado, com outro código.
    const r = await descarregarLog({ prazoMs: 50 });
    assert.equal(typeof r.desfecho, 'string');
    assert.equal(r.desfecho, 'sem-arquivo');
  });
});
