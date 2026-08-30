// Path: tests/unit/diag-janela.test.js
// A janela (`?desde=`) das rotas de diagnóstico: MESMA gramática do comando, mais um teto
// de 7 dias que só existe na porta HTTP.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada metade):
//  - trocar o `custom` por um `Joi.string()` solto: os casos de '24hs' e '7 d' passam a
//    ser aceitos, e a rota responderia sobre uma janela inventada sem avisar (o mesmo
//    modo de falha que `parseJanela` recusa devolvendo null em vez de cair num default);
//  - remover a comparação com `TETO_DA_JANELA_MS`: '30d' passa a valer, e com ele a
//    requisição que abre trinta arquivos de log dentro do ciclo HTTP;
//  - apagar o `.default(...)` de cada rota: `desde` vira undefined e o serviço chamaria
//    `parseJanela(undefined)`, que devolve null, e a janela viraria NaN em silêncio.
//
// Os limites são asseridos nos DOIS lados (7d passa, 7d+1m reprova), porque um teto testado
// só por dentro passa idêntico se a comparação estiver invertida.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  errosQuerySchema, lentoQuerySchema, statusQuerySchema, errosDeClienteQuerySchema,
  erroDeClienteSchema, TETO_DA_JANELA_MS,
} from '../../src/modules/diag/diag.schemas.js';

/** As mesmas opções que `middleware/validate.js` usa na borda real. */
const OPCOES = { abortEarly: false, stripUnknown: true };

const validar = (schema, entrada) => schema.validate(entrada, OPCOES);

describe('diag — a janela `?desde=`', () => {
  it('o teto é exatamente sete dias', () => {
    assert.equal(TETO_DA_JANELA_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it('cada rota tem seu próprio padrão, e ele é aplicado quando o parâmetro falta', () => {
    assert.equal(validar(errosQuerySchema, {}).value.desde, '24h');
    assert.equal(validar(lentoQuerySchema, {}).value.desde, '24h');
    assert.equal(validar(statusQuerySchema, {}).value.desde, '1h');
    assert.equal(validar(errosDeClienteQuerySchema, {}).value.desde, '7d');
  });

  it('aceita a gramática do comando (m, h, d)', () => {
    for (const forma of ['1m', '30m', '1h', '24h', '1d', '7d', '168h', '10080m']) {
      const { error, value } = validar(errosQuerySchema, { desde: forma });
      assert.equal(error, undefined, `esperava aceitar "${forma}"`);
      assert.equal(value.desde, forma, 'a string original é preservada');
    }
  });

  it('recusa o que a gramática não entende, em vez de cair num default', () => {
    const RECUSADAS = ['24hs', '7 d', 'ontem', '24', 'h', '0h', '0m', '-1d', '1.5h', '1H'];
    for (const forma of RECUSADAS) {
      const { error } = validar(errosQuerySchema, { desde: forma });
      assert.ok(error, `esperava recusar "${forma}"`);
      assert.match(error.details[0].message, /Janela inválida/);
    }
    // A string VAZIA reprova antes do `custom`, no `string.empty` do próprio Joi, e por
    // isso a mensagem dela é outra. Ela fica fora do laço acima de propósito: exigir a
    // frase da janela aqui obrigaria a afrouxar o schema (`.allow('')`) para satisfazer o
    // teste, ou seja, o teste mudaria o produto para poder passar.
    assert.ok(validar(errosQuerySchema, { desde: '' }).error);
  });

  it('recusa acima de sete dias, e a mensagem aponta o comando', () => {
    for (const forma of ['8d', '30d', '169h', '10081m']) {
      const { error } = validar(errosQuerySchema, { desde: forma });
      assert.ok(error, `esperava recusar "${forma}"`);
      assert.match(error.details[0].message, /máxima nesta tela é 7d/);
      assert.match(error.details[0].message, /npm run diag/);
    }
  });

  it('a fronteira do teto: 7d e 168h passam, 10081m não', () => {
    assert.equal(validar(errosQuerySchema, { desde: '7d' }).error, undefined);
    assert.equal(validar(errosQuerySchema, { desde: '168h' }).error, undefined);
    assert.ok(validar(errosQuerySchema, { desde: '10081m' }).error);
  });

  it('o mesmo teto vale nas quatro rotas, inclusive na que já tem 7d de padrão', () => {
    for (const schema of [errosQuerySchema, lentoQuerySchema, statusQuerySchema, errosDeClienteQuerySchema]) {
      assert.ok(validar(schema, { desde: '30d' }).error, 'uma rota escapou do teto');
      assert.equal(validar(schema, { desde: '7d' }).error, undefined);
    }
  });

  it('o limite tem padrão por rota, piso, teto e recusa o que não é inteiro', () => {
    assert.equal(validar(errosQuerySchema, {}).value.limite, 20);
    assert.equal(validar(lentoQuerySchema, {}).value.limite, 15);
    assert.equal(validar(errosDeClienteQuerySchema, {}).value.limite, 50);

    assert.equal(validar(errosQuerySchema, { limite: '35' }).value.limite, 35, 'query chega como string');
    assert.ok(validar(errosQuerySchema, { limite: 0 }).error);
    assert.ok(validar(errosQuerySchema, { limite: 101 }).error);
    assert.ok(validar(errosDeClienteQuerySchema, { limite: 201 }).error);
    assert.ok(validar(errosQuerySchema, { limite: 'muitos' }).error);
  });

  it('`status` não aceita limite: ela devolve contagens, não uma lista', () => {
    // `stripUnknown` descarta em vez de reprovar, então o que se afirma é a AUSÊNCIA no
    // valor validado. Sem esta asserção, acrescentar `limite` ao schema por engano
    // passaria despercebido e o controller o ignoraria em silêncio.
    const { value } = validar(statusQuerySchema, { limite: 10 });
    assert.equal(value.limite, undefined);
  });
});

describe('diag — o corpo do relato de erro do navegador', () => {
  it('recusa corpo sem os dois campos obrigatórios', () => {
    assert.ok(validar(erroDeClienteSchema, {}).error);
    assert.ok(validar(erroDeClienteSchema, { assinatura: 'X' }).error, 'mensagem é obrigatória');
    assert.ok(validar(erroDeClienteSchema, { mensagem: 'X' }).error, 'assinatura é obrigatória');
  });

  it('cada campo tem teto, e o teto reprova em vez de truncar', () => {
    const base = { assinatura: 'TypeError | /x', mensagem: 'quebrou' };
    const TETOS = {
      assinatura: 300, mensagem: 500, stack: 4000,
      url: 500, pagina: 500, release: 100, userAgent: 300,
    };
    for (const [campo, teto] of Object.entries(TETOS)) {
      const noLimite = validar(erroDeClienteSchema, { ...base, [campo]: 'a'.repeat(teto) });
      assert.equal(noLimite.error, undefined, `${campo}: ${teto} caracteres deveriam passar`);
      const acima = validar(erroDeClienteSchema, { ...base, [campo]: 'a'.repeat(teto + 1) });
      assert.ok(acima.error, `${campo}: ${teto + 1} caracteres deveriam reprovar`);
    }
  });

  it('descarta qualquer campo de identidade vindo do corpo', () => {
    const { error, value } = validar(erroDeClienteSchema, {
      assinatura: 'X', mensagem: 'y',
      userId: '00000000-0000-0000-0000-000000000009',
      user_id: '00000000-0000-0000-0000-000000000009',
      ocorrencias: 9999,
    });
    assert.equal(error, undefined);
    assert.equal(value.userId, undefined);
    assert.equal(value.user_id, undefined);
    assert.equal(value.ocorrencias, undefined);
  });

  it('atlasId é UUID ou nada (o atlas local não tem id de servidor)', () => {
    const base = { assinatura: 'X', mensagem: 'y' };
    assert.equal(validar(erroDeClienteSchema, base).error, undefined);
    assert.equal(
      validar(erroDeClienteSchema, { ...base, atlasId: '11111111-2222-3333-4444-555555555555' }).error,
      undefined
    );
    assert.ok(validar(erroDeClienteSchema, { ...base, atlasId: 'Principal' }).error);
  });
});
