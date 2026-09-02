// Path: tests/unit/defeito-de-servidor-nao-derruba-o-handler.test.js
// O HANDLER DE ERRO NUNCA PODE LANÇAR POR CAUSA DA TELEMETRIA.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que "as funções não lançam por contrato" não bastava.
// Contrato é promessa de quem escreve, e `errorHandler` é o ÚLTIMO handler da cadeia: uma
// exceção ali não tem para onde ir. O Express a entrega ao `finalhandler`, que só sabe
// destruir o socket, então quem paga é o CLIENTE, com resposta truncada, e o erro original
// some substituído por um de contabilidade da telemetria. Ou seja: o defeito mais barato
// desta camada (uma anotação malformada) produziria o desfecho mais caro do produto.
//
// O QUE O VERDE ESTARIA PROVANDO SE O CÓDIGO ESTIVESSE ERRADO: sem o `try/catch` em volta de
// `anotarDefeitoDeServidor(defeitoDeRequisicao(linha))`, o caso hostil abaixo faz o handler
// lançar ANTES do `res.status().json()`, e a asserção de que a resposta saiu igual à do
// controle fica vermelha nomeando a exceção.
//
// COMO A ANOTAÇÃO É FEITA FALHAR, e por que assim: um `method` cujo `toString` lança.
// Ele atravessa `requestErrorLogPayload` intacto (que só o COPIA para os campos da linha) e
// só explode dentro de `defeitoDeRequisicao`, que o interpola para montar a rota. É a falha
// no lugar exato que o `try` cobre, e não uma linha antes nem uma depois; um `message`
// hostil, por exemplo, derrubaria `requestErrorLogPayload`, que é outro assunto e está fora
// deste `try` de propósito (sem a linha de log não há evidência nenhuma).
//
// O CONTROLE é a MESMA requisição com um `method` normal: sem ele, o caso passaria idêntico
// se o handler tivesse parado de responder qualquer coisa.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../../src/middleware/error-handler.js';
import {
  limparDefeitosDeServidor,
  defeitosDeServidorPendentes,
} from '../../src/modules/diag/defeitos-de-servidor.js';

/** Um `res` mínimo que grava o que foi respondido, sem rede. */
function resDuplo() {
  const gravado = { status: null, corpo: null, chamadas: 0 };
  const res = {
    headersSent: false,
    status(codigo) { gravado.status = codigo; return res; },
    json(corpo) { gravado.corpo = corpo; gravado.chamadas += 1; return res; },
  };
  return { res, gravado };
}

const erro500 = () => Object.assign(new Error('column "x" does not exist'), { statusCode: 500 });

const req = (method) => ({ id: 'req-1', method, originalUrl: '/api/v1/atlas/x/sync' });

describe('errorHandler: a telemetria falha, o cliente não percebe', () => {
  it('anotação que LANÇA não derruba o handler, e a resposta sai igual à do controle', () => {
    limparDefeitosDeServidor();

    // CONTROLE: caminho normal, com a anotação funcionando.
    const controle = resDuplo();
    errorHandler(erro500(), req('POST'), controle.res, () => {
      assert.fail('o controle não pode delegar ao next');
    });
    assert.equal(controle.gravado.status, 500, 'guarda: o controle respondeu de verdade');
    assert.equal(defeitosDeServidorPendentes(), 1, 'guarda: o controle ANOTOU de verdade');

    // HOSTIL: o `method` explode ao ser interpolado, dentro de `defeitoDeRequisicao`.
    limparDefeitosDeServidor();
    const hostil = resDuplo();
    const metodoHostil = { toString() { throw new Error('método hostil'); } };
    assert.doesNotThrow(() => {
      errorHandler(erro500(), req(metodoHostil), hostil.res, () => {
        assert.fail('o handler não pode delegar ao next por causa da telemetria');
      });
    }, 'o último handler da cadeia lançou: o socket do cliente seria destruído');

    // A RESPOSTA É A MESMA, byte a byte: é isso que "o cliente não percebe" significa.
    assert.equal(hostil.gravado.status, controle.gravado.status);
    assert.deepEqual(hostil.gravado.corpo, controle.gravado.corpo);
    assert.equal(hostil.gravado.chamadas, 1, 'uma resposta, nem zero nem duas');
    // E a telemetria daquele 5xx foi PERDIDA, que é o preço declarado: o erro em si já está
    // no `.jsonl`, escrito uma linha antes; o que se perde é só o agrupamento.
    assert.equal(defeitosDeServidorPendentes(), 0);
  });

  it('o 4xx não anota, e continua sem anotar mesmo com a anotação sabotada', () => {
    // O corte é o MESMO `>= 500` que decide o nível da linha e a presença da pilha; um 4xx
    // nem chega ao `try`, então o `method` hostil é inofensivo por outro caminho.
    limparDefeitosDeServidor();
    const { res, gravado } = resDuplo();
    const err = Object.assign(new Error('não achei'), { statusCode: 404, expose: true });
    const metodoHostil = { toString() { throw new Error('método hostil'); } };
    assert.doesNotThrow(() => errorHandler(err, req(metodoHostil), res, () => {
      assert.fail('não deveria delegar');
    }));
    assert.equal(gravado.status, 404);
    assert.equal(gravado.corpo.error.code, 'NOT_FOUND');
    assert.equal(defeitosDeServidorPendentes(), 0);
  });
});
