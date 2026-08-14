// Path: tests/unit/drain-on-error.test.js
//
// A DECISAO do drainOnError, testada diretamente, porque o teste de integracao nao
// consegue distinguir os dois motivos de nao drenar.
//
// O caso "o chamador ANONIMO nao e drenado" vive em
// tests/integration/upload-negado-perde-a-resposta.repro.test.js e afere o SINTOMA: a
// conexao cai, entao o cliente nao recebe status. Isso so acontece enquanto o corpo
// ainda esta subindo. Sob carga, o servidor demora mais para responder, os 3 MB chegam
// inteiros, `req.complete` fica true, e a PRIMEIRA clausula do middleware ja devolve
// next(err) sem drenar: a resposta sai normalmente e o cliente recebe 401.
//
// Ou seja, os dois motivos de "nao drenou" produzem desfechos diferentes e o teste de
// integracao le so um deles. Medido: isolado passou 8 de 8; na suite completa, 2 falhas
// em 4 execucoes. Nao e defeito do codigo nem do ambiente, e ambiguidade do instrumento.
//
// Aqui a decisao e exercitada sem socket, sem carga e sem corrida: o middleware recebe
// um request de mentira e o que se afere e SE ele leu o corpo, que e a propriedade que a
// decisao de 2026-07-25 protege (nao servir de sink para quem nao se identificou).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { drainOnError } from '../../src/middleware/drain-on-error.js';

/**
 * Builds a fake request whose body is still arriving, so the middleware has something
 * it COULD drain. `consumido` records whether it actually read any of it.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.user] - Verified principal, or undefined for anonymous.
 * @param {boolean} [opts.complete=false] - Whether the body already arrived in full.
 * @returns {Object} the fake request, with a `consumido` flag
 */
function requisicaoFalsa({ user, complete = false } = {}) {
  let consumido = false;
  // `_read` so e chamado quando ALGUEM pede dados, entao ele mede leitura de verdade.
  // A primeira versao deste helper usava `stream.on('data', ...)` e media a si mesma:
  // registrar um listener de 'data' poe o stream em modo fluente, ou seja, o instrumento
  // consumia o corpo e depois acusava o middleware de te-lo consumido.
  const stream = new Readable({
    read() {
      consumido = true;
      this.push(Buffer.alloc(1024, 0x41));
      this.push(null);
    },
  });
  // `readableEnded` e getter-only no Readable, entao nao se sobrescreve: ele ja nasce
  // false, que e o estado que interessa (corpo ainda por ler).
  const req = Object.assign(stream, { user, complete, unpipe() {} });
  Object.defineProperty(req, 'consumido', { get: () => consumido });
  return req;
}

/** @returns {Object} a response that never reports headers as sent */
function respostaFalsa() {
  return { headersSent: false };
}

describe('drainOnError: quem tem o corpo lido, e quem nao tem', () => {
  it('o ANONIMO nao e drenado, e passa adiante na hora', async () => {
    const req = requisicaoFalsa({ user: undefined });
    const erro = new Error('403');
    let passou = null;

    drainOnError(erro, req, respostaFalsa(), (e) => { passou = e; });

    // Sincrono de proposito: a decisao acontece antes de qualquer leitura.
    assert.equal(passou, erro, 'o erro tem de seguir para o errorHandler');
    await new Promise((r) => setImmediate(r));
    assert.equal(req.consumido, false,
      'o corpo de um anonimo foi lido: e a amplificacao que a decisao de 2026-07-25 recusou');
  });

  it('o principal VERIFICADO tem o corpo drenado antes da resposta', async () => {
    const req = requisicaoFalsa({ user: { id: 'u1' } });
    const erro = new Error('403');
    let passou = null;

    drainOnError(erro, req, respostaFalsa(), (e) => { passou = e; });

    // Este caminho e assincrono: o next so vem depois de o corpo acabar. Se viesse
    // junto, o socket cairia com o upload em voo, que e o defeito original.
    assert.equal(passou, null, 'o next nao pode sair antes de drenar');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(req.consumido, true, 'o corpo do principal verificado nao foi lido');
    assert.equal(passou, erro);
  });

  it('corpo JA completo passa direto, seja quem for o chamador', async () => {
    // Esta e a clausula que torna ambiguo o caso de integracao: ela vem ANTES do teste
    // de anonimo, entao sob carga o anonimo sai por aqui, e nao pela regra que o teste
    // de integracao pensa estar aferindo.
    for (const user of [undefined, { id: 'u1' }]) {
      const req = requisicaoFalsa({ user, complete: true });
      const erro = new Error('403');
      let passou = null;

      drainOnError(erro, req, respostaFalsa(), (e) => { passou = e; });

      assert.equal(passou, erro);
      await new Promise((r) => setImmediate(r));
      assert.equal(req.consumido, false, 'nao ha o que drenar num corpo ja completo');
    }
  });

  it('resposta ja enviada nao dispara leitura nenhuma', async () => {
    const req = requisicaoFalsa({ user: { id: 'u1' } });
    const erro = new Error('403');
    let passou = null;

    drainOnError(erro, req, { headersSent: true }, (e) => { passou = e; });

    assert.equal(passou, erro);
    await new Promise((r) => setImmediate(r));
    assert.equal(req.consumido, false);
  });
});
