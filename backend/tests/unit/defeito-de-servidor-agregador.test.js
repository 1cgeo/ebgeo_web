// Path: tests/unit/defeito-de-servidor-agregador.test.js
// O AGREGADOR DE DEFEITOS DE SERVIDOR, na metade que não precisa de banco: a montagem da
// anotação (pura) e a contagem na janela (memória de processo).
//
// A PROPRIEDADE QUE ESTE ARQUIVO PRENDE, E QUE É A RAZÃO DE ELE EXISTIR: a assinatura desta
// camada é `assinaturaDeErro` (`src/utils/diag-consulta.js`), a MESMA que o comando
// (`npm run diag -- erros`) e a rota `GET /diag/erros` usam sobre o `.jsonl`. Se as duas
// divergirem, o administrador lê dez defeitos numa tela e três na outra, sobre os mesmos
// erros, e nada indica qual está certa. Por isso os casos abaixo comparam a saída de
// `defeitoDeRequisicao` com a de `assinaturaDeErro` aplicada ao registro FUNDIDO que o CLI
// veria, em vez de conferirem um texto escrito à mão.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - montar a assinatura por concatenação própria em vez de `assinaturaDeErro`: o caso da
//    paridade com o CLI fica vermelho;
//  - tirar o `statusCode` do registro que a anotação monta: idem, e é o erro mais fácil de
//    cometer, porque a LINHA DE LOG o omite de propósito (ver `requestErrorLogPayload`) e
//    quem copiar de lá perde o `[500]` que o CLI recupera pela fusão;
//  - trocar o incremento por uma escrita por erro: o caso das mil ocorrências passa a
//    devolver mil entradas em vez de uma com contagem mil;
//  - guardar a PRIMEIRA amostra em vez da última: o caso do `reqId` fica vermelho;
//  - tirar o teto de assinaturas: o caso do teto fica vermelho, e o preço real seria o
//    agregador que existe para não amplificar o incidente virando o vazamento dele;
//  - fazer o teto cortar CALADO (o `return null` sem contar): os casos do descarte relatado
//    ficam vermelhos. Um teto mudo é indistinguível de um produto que não tem aquele
//    defeito, e ele corta exatamente na hora em que alguém está olhando a tela.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  anotarDefeitoDeServidor,
  defeitosDeServidorPendentes,
  limparDefeitosDeServidor,
  descarregarDefeitosDeServidor,
  defeitoDeRequisicao,
  defeitoDaQueda,
  defeitosDeServidorDescartados,
  MAX_ASSINATURAS_NA_JANELA,
  MARCADOR_DESCARGA_PERDIDA,
  MARCADOR_TETO_ESTOURADO,
  INTERVALO_DE_DESCARGA_MS,
} from '../../src/modules/diag/defeitos-de-servidor.js';
import { assinaturaDeErro } from '../../src/utils/diag-consulta.js';
import { requestErrorLogPayload } from '../../src/middleware/error-handler.js';
import { TIPO_DE_QUEDA } from '../../src/utils/logger.js';

/**
 * Um erro de servidor de verdade, com a forma que o Express entrega ao handler.
 *
 * SUBCLASSE E NÃO `err.name = ...`: o `type` que entra na assinatura vem do CONSTRUTOR
 * (`errSerializer`, `src/utils/logger.js`), então atribuir `name` deixa a assinatura dizendo
 * `Error` e o teste verde sobre a coisa errada. Foi medido escrevendo do jeito errado.
 */
class DatabaseError extends Error {}

function erro500() {
  const err = new DatabaseError('column "x" does not exist');
  err.statusCode = 500;
  return err;
}

const req = (over = {}) => ({
  id: 'req-1',
  method: 'POST',
  originalUrl: '/api/v1/atlas/6f1c4b90-1111-2222-3333-444455556666/sync',
  ...over,
});

describe('defeitoDeRequisicao — a assinatura é a MESMA do CLI', () => {
  it('casa, caractere a caractere, com a que `assinaturaDeErro` daria ao registro fundido', () => {
    const linha = requestErrorLogPayload(erro500(), req());
    const anotacao = defeitoDeRequisicao(linha);

    // O registro que o CLI teria em mãos DEPOIS de `fundirPorRequisicao`: a linha do
    // `errorHandler` (que carrega `err`) com o `statusCode` copiado da linha de requisição.
    const registroDoCli = { ...linha.campos, msg: linha.mensagem, statusCode: 500 };
    const esperada = assinaturaDeErro(registroDoCli);

    assert.ok(esperada.length > 10, 'guarda: a assinatura de referência não pode ser trivial');
    assert.equal(anotacao.assinatura, esperada);
    // E ela é o que a leitura humana espera: rota normalizada, tipo, mensagem e status.
    assert.match(anotacao.assinatura, /^POST \/api\/v1\/atlas\/:id\/sync \| DatabaseError \| /);
    assert.match(anotacao.assinatura, /\[500\]$/);
  });

  it('o UUID da rota vira `:id`: mil atlas diferentes são UM defeito', () => {
    const a = defeitoDeRequisicao(requestErrorLogPayload(erro500(), req()));
    const b = defeitoDeRequisicao(requestErrorLogPayload(erro500(), req({
      originalUrl: '/api/v1/atlas/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/sync',
      id: 'req-2',
    })));
    assert.equal(a.assinatura, b.assinatura, 'o agrupamento não pode explodir por id de rota');
    assert.notEqual(a.reqId, b.reqId, 'e mesmo assim cada uma leva o próprio reqId');
  });

  it('carrega a evidência que costura com o log: reqId, sessão, usuário, rota e status', () => {
    const linha = requestErrorLogPayload(erro500(), req({
      sessaoId: '11111111-2222-3333-4444-555555555555',
      user: { id: '99999999-8888-7777-6666-555555555555' },
    }));
    const a = defeitoDeRequisicao(linha);
    assert.equal(a.reqId, 'req-1');
    assert.equal(a.sessaoId, '11111111-2222-3333-4444-555555555555');
    assert.equal(a.userId, '99999999-8888-7777-6666-555555555555');
    assert.equal(a.rota, 'POST /api/v1/atlas/:id/sync');
    assert.equal(a.statusCode, 500);
    assert.equal(a.mensagem, 'column "x" does not exist');
    assert.ok(a.stack.includes('Error'), 'o 5xx mantém a pilha (ver requestErrorLogPayload)');
  });

  it('os tetos da borda anônima valem aqui também, porque aqui não há Joi nenhum', () => {
    const err = erro500();
    err.message = 'x'.repeat(9000);
    const a = defeitoDeRequisicao(requestErrorLogPayload(err, req()));
    // 300 é o teto da chave única em btree; 500 e 4000 são os do relato do cliente.
    assert.equal(a.assinatura.length, 300);
    assert.equal(a.mensagem.length, 500);
    assert.ok(a.stack.length <= 4000);
  });
});

describe('defeitoDaQueda — a morte do processo também é um defeito', () => {
  it('separa as duas quedas com a mesma mensagem, porque elas pedem coisas diferentes', () => {
    const causa = new Error('boom');
    const excecao = defeitoDaQueda(TIPO_DE_QUEDA.EXCECAO, causa);
    const rejeicao = defeitoDaQueda(TIPO_DE_QUEDA.REJEICAO, causa);
    assert.notEqual(excecao.assinatura, rejeicao.assinatura);
    assert.match(excecao.assinatura, /queda: uncaughtException/);
    assert.match(rejeicao.assinatura, /queda: unhandledRejection/);
    assert.equal(excecao.mensagem, 'boom');
    assert.ok(excecao.stack.includes('Error: boom'));
  });

  it('sobrevive à rejeição que NÃO é Error, que é justamente a mais difícil de diagnosticar', () => {
    const a = defeitoDaQueda(TIPO_DE_QUEDA.REJEICAO, 'só uma string');
    assert.equal(a.mensagem, 'só uma string');
    assert.equal(a.stack, null, 'não há pilha para inventar');
    assert.match(a.assinatura, /só uma string/);

    const nulo = defeitoDaQueda(TIPO_DE_QUEDA.REJEICAO, null);
    assert.equal(nulo.mensagem, 'null');
    assert.ok(nulo.assinatura.length > 0);
  });

  it('não tem rota nem status: não houve resposta HTTP para inventar um', () => {
    const a = defeitoDaQueda(TIPO_DE_QUEDA.EXCECAO, new Error('x'));
    assert.equal(a.rota, null);
    assert.equal(a.statusCode, null);
    assert.equal(a.reqId, null);
  });
});

describe('A janela em memória: N erros iguais viram UMA entrada com contagem N', () => {
  beforeEach(() => limparDefeitosDeServidor());

  it('mil ocorrências idênticas são UMA assinatura pendente, com contagem mil', () => {
    const linha = requestErrorLogPayload(erro500(), req());
    let entrada = null;
    for (let i = 0; i < 1000; i += 1) {
      entrada = anotarDefeitoDeServidor(defeitoDeRequisicao(linha));
    }
    assert.equal(defeitosDeServidorPendentes(), 1, 'mil erros iguais, UMA entrada');
    assert.equal(entrada.contagem, 1000);
  });

  it('assinaturas distintas ocupam entradas distintas', () => {
    for (const msg of ['a', 'b', 'c']) {
      const err = erro500();
      err.message = msg;
      anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(err, req())));
    }
    assert.equal(defeitosDeServidorPendentes(), 3);
  });

  it('a amostra guardada é a ÚLTIMA, porque é o `reqId` que ainda resolve no log', () => {
    const linha = requestErrorLogPayload(erro500(), req({ id: 'req-primeiro' }));
    anotarDefeitoDeServidor(defeitoDeRequisicao(linha));
    const ultima = requestErrorLogPayload(erro500(), req({ id: 'req-ultimo' }));
    const entrada = anotarDefeitoDeServidor(defeitoDeRequisicao(ultima));
    assert.equal(entrada.contagem, 2);
    assert.equal(entrada.amostra.reqId, 'req-ultimo');
  });

  it('o teto de assinaturas segura o adversário, e a contagem das que já entraram segue subindo', () => {
    for (let i = 0; i < MAX_ASSINATURAS_NA_JANELA; i += 1) {
      const err = erro500();
      err.message = `distinta ${i}`;
      anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(err, req())));
    }
    assert.equal(defeitosDeServidorPendentes(), MAX_ASSINATURAS_NA_JANELA);

    const nova = erro500();
    nova.message = 'a que passou do teto';
    const recusada = anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(nova, req())));
    assert.equal(recusada, null, 'assinatura nova além do teto é descartada');
    assert.equal(defeitosDeServidorPendentes(), MAX_ASSINATURAS_NA_JANELA);
    assert.equal(defeitosDeServidorDescartados(), 1, 'o descarte é CONTADO, não engolido');

    const conhecida = erro500();
    conhecida.message = 'distinta 0';
    const entrada = anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(conhecida, req())));
    assert.equal(entrada.contagem, 2, 'o que já se sabe continua sendo contado');
  });

  it('anotação sem assinatura não entra, e não lança', () => {
    assert.equal(anotarDefeitoDeServidor(null), null);
    assert.equal(anotarDefeitoDeServidor({}), null);
    assert.equal(anotarDefeitoDeServidor({ assinatura: '' }), null);
    assert.equal(defeitosDeServidorPendentes(), 0);
    // E NÃO conta como descarte por teto: a anotação malformada não é um defeito que a
    // janela recusou por falta de espaço, é uma chamada errada de quem anotou. Somá-las
    // faria o aviso de teto acusar um problema de capacidade que não existe.
    assert.equal(defeitosDeServidorDescartados(), 0);
  });
});

describe('A descarga que FALHA descarta o lote, e fala uma vez', () => {
  beforeEach(() => limparDefeitosDeServidor());

  it('janela vazia não abre transação nenhuma', async () => {
    let chamou = false;
    const r = await descarregarDefeitosDeServidor({
      transacao: async () => { chamou = true; },
    });
    assert.deepEqual(r, { descarregados: 0, ocorrencias: 0, descartadas: 0, motivo: 'vazia' });
    assert.equal(chamou, false);
  });

  it('o TETO ESTOURADO fala UMA vez por descarga, com a contagem, e zera junto', async () => {
    // Relatar por ANOTAÇÃO faria o adversário que gera assinatura nova a cada requisição
    // produzir uma linha de log por requisição, ou seja, o aviso viraria a amplificação que
    // o teto existe para impedir.
    for (let i = 0; i < MAX_ASSINATURAS_NA_JANELA + 3; i += 1) {
      const err = erro500();
      err.message = `distinta ${i}`;
      anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(err, req())));
    }
    assert.equal(defeitosDeServidorDescartados(), 3);

    const avisos = [];
    const r = await descarregarDefeitosDeServidor({
      transacao: async (cb) => cb({ one: async () => ({ id: 'x' }), none: async () => {} }),
      registrar: { info: () => {}, warn: (obj, msg) => avisos.push({ obj, msg }), error: () => {} },
    });

    assert.equal(r.descartadas, 3, 'a contagem sai no retorno, não só no log');
    const doTeto = avisos.filter((a) => a.msg === MARCADOR_TETO_ESTOURADO);
    assert.equal(doTeto.length, 1, 'UM aviso por descarga, nunca um por descarte');
    assert.equal(doTeto[0].obj.descartadas, 3);
    assert.equal(doTeto[0].obj.teto, MAX_ASSINATURAS_NA_JANELA);

    // ZERA JUNTO COM A JANELA: sem isso, a descarga seguinte relataria de novo os mesmos
    // três, e o número viraria um acumulado com cara de taxa.
    assert.equal(defeitosDeServidorDescartados(), 0);
    const segunda = await descarregarDefeitosDeServidor({
      registrar: { info: () => {}, warn: (obj, msg) => avisos.push({ obj, msg }), error: () => {} },
    });
    assert.equal(segunda.descartadas, 0);
    assert.equal(avisos.filter((a) => a.msg === MARCADOR_TETO_ESTOURADO).length, 1);
  });

  it('sem descarte não há aviso de teto: alarme que toca sempre ensina a ignorar alarme', async () => {
    anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(erro500(), req())));
    const avisos = [];
    const r = await descarregarDefeitosDeServidor({
      transacao: async (cb) => cb({ one: async () => ({ id: 'x' }), none: async () => {} }),
      registrar: { info: () => {}, warn: (obj, msg) => avisos.push({ obj, msg }), error: () => {} },
    });
    assert.equal(r.descartadas, 0);
    assert.deepEqual(avisos, []);
  });

  it('o erro do banco NÃO sobe, o lote é DESCARTADO e o aviso é UM, com a contagem', async () => {
    const linha = requestErrorLogPayload(erro500(), req());
    for (let i = 0; i < 7; i += 1) anotarDefeitoDeServidor(defeitoDeRequisicao(linha));
    const outro = erro500();
    outro.message = 'segunda assinatura';
    anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(outro, req())));
    assert.equal(defeitosDeServidorPendentes(), 2);

    const avisos = [];
    const r = await descarregarDefeitosDeServidor({
      transacao: async () => {
        const err = new Error('Connection terminated unexpectedly');
        err.code = 'ECONNREFUSED';
        throw err;
      },
      registrar: { info: () => {}, warn: (obj, msg) => avisos.push({ obj, msg }), error: () => {} },
    });

    assert.deepEqual(r, { descarregados: 0, ocorrencias: 0, descartadas: 0, motivo: 'falha' });
    assert.equal(defeitosDeServidorPendentes(), 0, 'o lote é descartado, nunca retido');
    assert.equal(avisos.length, 1, 'UM aviso por descarga, nunca um por assinatura');
    assert.equal(avisos[0].msg, MARCADOR_DESCARGA_PERDIDA);
    assert.equal(avisos[0].obj.assinaturas, 2);
    assert.equal(avisos[0].obj.ocorrencias, 8, 'o aviso diz QUANTO se perdeu');
    assert.ok(avisos[0].obj.err, 'e carrega a causa, senão não diagnostica nada');
  });

  it('a descarga seguinte começa limpa: uma falha custa um lote, não a janela toda', async () => {
    anotarDefeitoDeServidor(defeitoDeRequisicao(requestErrorLogPayload(erro500(), req())));
    await descarregarDefeitosDeServidor({
      transacao: async () => { throw new Error('fora'); },
      registrar: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const r = await descarregarDefeitosDeServidor({
      transacao: async () => { throw new Error('não deveria ser chamada'); },
      registrar: { info: () => {}, warn: () => {}, error: () => {} },
    });
    assert.equal(r.motivo, 'vazia');
  });

  it('a cadência é a declarada, e ela não é um número mágico solto', () => {
    assert.equal(INTERVALO_DE_DESCARGA_MS, 10_000);
  });
});
