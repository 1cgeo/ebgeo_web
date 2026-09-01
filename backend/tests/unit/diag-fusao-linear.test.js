// Path: tests/unit/diag-fusao-linear.test.js
//
// `fundirPorRequisicao` (`src/utils/diag-consulta.js`) era QUADRÁTICA: um `registros.find(...)`
// dentro do laço de saída, uma varredura da lista inteira por requisição falha. Medido nesta
// máquina antes da correção: 10 mil registros em 83 ms, 25 mil em 450 ms, 50 mil em 1,9 s e
// 100 mil em 8,9 s, a curva de um O(E×N), que em 200 mil (o `MAX_REGISTROS` da rota de
// diagnóstico) passa de meio minuto com o event loop preso. O gatilho é abrir a aba
// Diagnóstico DURANTE um incidente, que é a única hora em que a janela tem esse volume.
//
// SÃO DOIS TESTES DE NATUREZAS DIFERENTES, e um sem o outro não fecha nada:
//
//   (1) EQUIVALÊNCIA. A implementação antiga está copiada aqui como referência de força
//       bruta, e as duas são comparadas sobre fixtures que cobrem cada sutileza da semântica
//       (elas estão nomeadas caso a caso abaixo) mais um fuzz determinístico. Sem isto, uma
//       reescrita "mais rápida" que mudasse a escolha do parceiro passaria verde, porque o
//       relatório continuaria bem-formado e só o número mudaria.
//   (2) ORÇAMENTO. A equivalência sozinha aceita de volta o código quadrático, que é
//       equivalente por construção. O caso de tempo é o único que reprova a REGRESSÃO.
//
// CONTROLE NEGATIVO: reponha o `registros.find(...)` no laço de saída e o caso do orçamento
// reprova (o de equivalência continua verde, de propósito: ele mede outra coisa). Guarde só
// o PRIMEIRO candidato a parceiro, em vez dos dois, e cai o caso "a linha do errorHandler
// que também tem statusCode não é o próprio parceiro".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fundirPorRequisicao } from '../../src/utils/diag-consulta.js';

/**
 * A implementação de 2026-08-30, palavra por palavra, como referência.
 *
 * Ela é a definição do comportamento que a correção precisa preservar: o parceiro é o
 * PRIMEIRO registro da ordem original com o mesmo `reqId`, diferente do rico, com
 * `statusCode` numérico.
 */
function fundirPorForcaBruta(registros) {
  const ricos = new Map();
  for (const reg of registros) {
    if (reg && reg.reqId && reg.err) ricos.set(reg.reqId, reg);
  }
  const saida = [];
  for (const reg of registros) {
    if (!reg || !reg.reqId) { saida.push(reg); continue; }
    const rico = ricos.get(reg.reqId);
    if (!rico) { saida.push(reg); continue; }
    if (reg === rico) {
      const par = registros.find(
        (r) => r && r.reqId === reg.reqId && r !== rico && typeof r.statusCode === 'number'
      );
      saida.push(par ? { ...rico, statusCode: par.statusCode } : rico);
    }
  }
  return saida;
}

/**
 * Compara as duas saídas exigindo IDENTIDADE onde a referência devolveu um registro de
 * entrada, e igualdade estrutural onde ela devolveu o objeto fundido (que é novo).
 *
 * `deepEqual` sozinho aceitaria uma implementação que clonasse tudo, e a identidade importa:
 * `agruparErros` guarda o registro como `exemplo`, e a rota o recorta depois.
 */
function assertMesmaFusao(entrada, nota) {
  const esperado = fundirPorForcaBruta(entrada);
  const obtido = fundirPorRequisicao(entrada);
  // A procedência de cada posição, por IDENTIDADE: o índice do objeto na entrada, ou -1 para
  // o objeto fundido, que é novo dos dois lados. Comparar as duas listas de procedência é o
  // que torna a asserção incondicional (um `if` por posição seria assert que pode não rodar).
  const procedencia = (lista) => lista.map((reg) => entrada.indexOf(reg));
  assert.deepEqual(procedencia(obtido), procedencia(esperado), `${nota}: procedência`);
  assert.deepEqual(obtido, esperado, `${nota}: conteúdo`);
  return obtido;
}

describe('diag — a fusão por requisição preserva a semântica', () => {
  it('lista vazia', () => {
    assert.deepEqual(fundirPorRequisicao([]), []);
    assertMesmaFusao([], 'vazia');
  });

  it('o par comum: errorHandler + request-logger', () => {
    const rico = { time: 1, reqId: 'r1', err: { type: 'BadRequestError', message: 'x' } };
    const logger = { time: 2, reqId: 'r1', statusCode: 400, duration: 3 };
    const saida = assertMesmaFusao([rico, logger], 'par comum');
    assert.equal(saida.length, 1);
    assert.equal(saida[0].statusCode, 400);
  });

  it('registro nulo passa intacto, na posição original', () => {
    const rico = { time: 2, reqId: 'r1', err: { message: 'x' } };
    const logger = { time: 3, reqId: 'r1', statusCode: 500 };
    const saida = assertMesmaFusao([null, rico, undefined, logger, null], 'nulos');
    assert.deepEqual(saida, [null, { ...rico, statusCode: 500 }, undefined, null]);
  });

  it('registro sem reqId passa intacto', () => {
    const solto = { time: 1, level: 50, err: { message: 'sweep do WS' } };
    assertMesmaFusao([solto], 'sem reqId');
  });

  it('reqId sem nenhum registro rico passa intacto, TODAS as linhas', () => {
    // Requisição de sucesso: duas linhas, nenhuma com `err`. Nada é fundido e nada some.
    const a = { time: 1, reqId: 'r9', statusCode: 200 };
    const b = { time: 2, reqId: 'r9', duration: 5 };
    const saida = assertMesmaFusao([a, b], 'sem rico');
    assert.deepEqual(saida, [a, b]);
  });

  it('o parceiro é o PRIMEIRO da ordem, não o último', () => {
    const rico = { time: 1, reqId: 'r1', err: { message: 'x' } };
    const primeiro = { time: 2, reqId: 'r1', statusCode: 400 };
    const segundo = { time: 3, reqId: 'r1', statusCode: 500 };
    const saida = assertMesmaFusao([rico, primeiro, segundo], 'primeiro parceiro');
    assert.equal(saida[0].statusCode, 400);
  });

  it('a linha do errorHandler que TAMBÉM tem statusCode não é o próprio parceiro', () => {
    // O caso que quebra a versão ingênua da correção (guardar o primeiro statusCode visto):
    // o rico entraria como parceiro de si mesmo e o status da linha de requisição sumiria.
    const rico = { time: 1, reqId: 'r1', statusCode: 500, err: { message: 'x' } };
    const logger = { time: 2, reqId: 'r1', statusCode: 400 };
    const saida = assertMesmaFusao([rico, logger], 'rico com status');
    assert.equal(saida[0].statusCode, 400, 'o status da linha de requisição é que vale');
  });

  it('statusCode não numérico não conta como parceiro', () => {
    const rico = { time: 1, reqId: 'r1', err: { message: 'x' } };
    const texto = { time: 2, reqId: 'r1', statusCode: '400' };
    const saida = assertMesmaFusao([rico, texto], 'status texto');
    assert.equal(saida.length, 1);
    assert.equal(saida[0].statusCode, undefined);
    assert.equal(saida[0], rico, 'sem parceiro, o rico sai sem cópia');
  });

  it('dois ricos no mesmo reqId: fica o ÚLTIMO, e só ele sai', () => {
    const primeiroRico = { time: 1, reqId: 'r1', err: { message: 'a' } };
    const segundoRico = { time: 2, reqId: 'r1', err: { message: 'b' } };
    const logger = { time: 3, reqId: 'r1', statusCode: 404 };
    const saida = assertMesmaFusao([primeiroRico, segundoRico, logger], 'dois ricos');
    assert.equal(saida.length, 1);
    assert.equal(saida[0].err.message, 'b');
    assert.equal(saida[0].statusCode, 404);
  });

  it('dois ricos, e o PRIMEIRO deles é o parceiro do último', () => {
    // O rico que sai é o último; o primeiro rico, que carrega status, é candidato legítimo.
    const primeiroRico = { time: 1, reqId: 'r1', statusCode: 502, err: { message: 'a' } };
    const segundoRico = { time: 2, reqId: 'r1', err: { message: 'b' } };
    const saida = assertMesmaFusao([primeiroRico, segundoRico], 'rico parceiro de rico');
    assert.equal(saida.length, 1);
    assert.equal(saida[0].err.message, 'b');
    assert.equal(saida[0].statusCode, 502);
  });

  it('a mesma referência repetida na lista é pulada nas DUAS ocorrências', () => {
    // É o que a busca linear fazia (`r !== rico` casa por identidade), e é por isso que a
    // lista de candidatos guarda objetos DISTINTOS.
    const rico = { time: 1, reqId: 'r1', statusCode: 500, err: { message: 'x' } };
    const logger = { time: 2, reqId: 'r1', statusCode: 400 };
    assertMesmaFusao([rico, rico, logger], 'referência repetida');
  });

  it('requisições diferentes não se misturam', () => {
    const entrada = [
      { time: 1, reqId: 'a', err: { message: 'x' } },
      { time: 2, reqId: 'b', err: { message: 'y' } },
      { time: 3, reqId: 'b', statusCode: 500 },
      { time: 4, reqId: 'a', statusCode: 400 },
    ];
    const saida = assertMesmaFusao(entrada, 'duas requisições');
    assert.deepEqual(saida.map((r) => r.statusCode), [400, 500]);
  });

  it('fuzz determinístico: mil listas sorteadas, mesma saída da força bruta', () => {
    // Gerador congruencial de semente fixa: o fuzz precisa ser reproduzível, senão um
    // vermelho de madrugada não volta a acontecer para ser investigado.
    let semente = 20260831;
    const proximo = (n) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % n;
    };
    for (let caso = 0; caso < 1000; caso += 1) {
      const entrada = [];
      const tamanho = proximo(9) + 1;
      const anteriores = [];
      for (let i = 0; i < tamanho; i += 1) {
        const sorte = proximo(10);
        if (sorte === 0) { entrada.push(null); continue; }
        if (sorte === 1 && anteriores.length) {
          entrada.push(anteriores[proximo(anteriores.length)]);
          continue;
        }
        const reg = { time: i };
        if (sorte !== 2) reg.reqId = `r${proximo(3)}`;
        if (sorte % 2 === 0) reg.err = { message: `m${i}` };
        const status = proximo(4);
        if (status === 1) reg.statusCode = 400 + i;
        else if (status === 2) reg.statusCode = `${400 + i}`;
        entrada.push(reg);
        anteriores.push(reg);
      }
      assertMesmaFusao(entrada, `fuzz caso ${caso}`);
    }
  });
});

describe('diag — a fusão por requisição é linear', () => {
  it('100 mil registros terminam dentro do orçamento', () => {
    // ORÇAMENTO GENEROSO DE PROPÓSITO: 2 s contra os ~30 ms que a versão linear gasta nesta
    // máquina e os 8,9 s que a quadrática gastava. A diferença entre o certo e o errado aqui
    // é de duas ordens de grandeza, então uma folga de ~60x sobre o esperado não flakeia numa
    // máquina lenta, num laptop em economia de energia ou com outra suíte rodando ao lado, e
    // ainda assim reprova o retorno do comportamento quadrático com margem de 4x. Um
    // orçamento apertado aqui seria a "medição de algo probabilístico" que a constituição
    // proíbe: ele mediria a carga da máquina, não o algoritmo.
    const registros = [];
    for (let i = 0; i < 50_000; i += 1) {
      const reqId = `r${i}`;
      registros.push({ time: i, reqId, err: { type: 'BadRequestError', message: 'x' } });
      registros.push({ time: i, reqId, statusCode: 400, duration: 3 });
    }

    const inicio = process.hrtime.bigint();
    const saida = fundirPorRequisicao(registros);
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;

    // A asserção de tamanho não é enfeite: sem ela, uma implementação que devolvesse a lista
    // vazia passaria no orçamento com folga infinita.
    assert.equal(saida.length, 50_000);
    assert.equal(saida[0].statusCode, 400);
    assert.ok(ms < 2000, `fusão de 100 mil registros levou ${ms.toFixed(0)} ms (orçamento 2000 ms)`);
  });
});
