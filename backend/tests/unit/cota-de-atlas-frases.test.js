// Path: tests/unit/cota-de-atlas-frases.test.js
//
// A metade PURA dos dois tetos de recurso do atlas (decisao D12 de 14/09/2026): as frases e a
// fronteira do teto de mapas, que nao precisam de banco. O que precisa esta em
// `tests/integration/cota-de-atlas-por-conta.test.js`.
//
// POR QUE AS FRASES TEM TESTE PROPRIO. Elas sao o que a pessoa le, e sao a unica parte da recusa
// que diz o que FAZER. Uma cota que responde "limite atingido" manda adivinhar quantos ela tem e
// o que libera vaga; a daqui nomeia os dois numeros e a acao que funciona (mover para a lixeira,
// que de fato libera, porque a contagem e de atlas VIVO). Preso por igualdade no teste de
// integracao, que compara a resposta da rota com estas funcoes: e isso que impede a frase de
// divergir entre o servidor e o que este arquivo descreve.
//
// E A FRONTEIRA E `>`, NAO `>=`: um arquivo com exatamente o teto entra. Sem o caso de igualdade
// ao lado do de excesso, trocar um pelo outro nao reprovaria nada.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config, { NUMERIC_ENV_RULES, validateEnvVariables } from '../../src/config.js';
import {
  atlasQuotaNotice,
  importMapsNotice,
  assertImportMapCeiling,
} from '../../src/modules/atlas/atlas-quota.js';

describe('tetos de recurso do atlas — frases e fronteira', () => {
  it('a frase da cota nomeia os DOIS numeros e a acao que libera vaga', () => {
    const frase = atlasQuotaNotice(100, 100);
    assert.match(frase, /100/);
    assert.match(frase, /lixeira/i, 'a acao nomeada precisa ser a que de fato libera vaga');
    // O numero da CONTAGEM e o do TETO sao campos distintos, e a frase precisa dizer os dois
    // mesmo quando eles diferem (a contagem pode passar do teto se ele for baixado por env).
    const acima = atlasQuotaNotice(137, 100);
    assert.match(acima, /137/);
    assert.match(acima, /100/);
  });

  it('a frase do teto de mapas fala do ARQUIVO, nao da conta', () => {
    const frase = importMapsNotice(201, 200);
    assert.match(frase, /201/);
    assert.match(frase, /200/);
    assert.match(frase, /arquiv/i);
    assert.doesNotMatch(frase, /lixeira/i,
      'nada que a pessoa apague no servidor faz este arquivo caber: mandar esvaziar a lixeira seria mentira');
  });

  it('exatamente o teto de mapas ENTRA; um a mais e recusado com 400', () => {
    const max = config.atlas.importMaxMaps;
    assert.ok(max > 0, 'guarda: com o teto desligado este caso nao mede nada');

    const noTeto = Array.from({ length: max }, (_, i) => ({ id: `m${i}` }));
    assert.doesNotThrow(() => assertImportMapCeiling(noTeto));

    const acima = [...noTeto, { id: 'excedente' }];
    assert.throws(() => assertImportMapCeiling(acima), (err) => {
      assert.equal(err.statusCode, 400,
        'e 400 e nao 429: o pedido e grande demais em si mesmo, e esperar nao resolve');
      assert.equal(err.message, importMapsNotice(max + 1, max));
      return true;
    });
  });

  it('entrada que nao e lista conta como zero mapas, e nunca como recusa', () => {
    // O payload chega validado pelo Joi, que ja garante array, mas a funcao e folha e pode ganhar
    // outro chamador: degradar para "nenhum mapa" e a direcao segura, porque a alternativa seria
    // recusar uma importacao valida por causa de um campo ausente.
    assert.doesNotThrow(() => assertImportMapCeiling(undefined));
    assert.doesNotThrow(() => assertImportMapCeiling(null));
    assert.doesNotThrow(() => assertImportMapCeiling('nao e lista'));
  });

  it('as duas variaveis estao em NUMERIC_ENV_RULES, com piso ZERO porque zero DESLIGA', () => {
    // Sem a entrada na tabela, `ATLAS_MAX_PER_ACCOUNT=abc` viraria NaN, e `count >= NaN` e sempre
    // falso: a cota nunca fecharia, com a aparencia de estar configurada. E o piso precisa ser 0,
    // senao a valvula de desligar sem deploy reprovaria o boot.
    assert.equal(NUMERIC_ENV_RULES.ATLAS_MAX_PER_ACCOUNT.min, 0);
    assert.equal(NUMERIC_ENV_RULES.IMPORT_MAX_MAPS.min, 0);
  });

  /** Roda `validateEnvVariables()` com UMA variavel posta, e devolve o ambiente como estava. */
  function comEnv(nome, valor, fn) {
    const salvo = process.env[nome];
    try {
      process.env[nome] = valor;
      fn();
    } finally {
      if (salvo === undefined) delete process.env[nome];
      else process.env[nome] = salvo;
    }
  }

  it('o boot ACEITA zero nas duas, porque zero e a valvula de desligar', () => {
    const aceitos = [['ATLAS_MAX_PER_ACCOUNT', '0'], ['IMPORT_MAX_MAPS', '0']];
    assert.equal(aceitos.length, 2, 'guarda: laco sobre colecao vazia seria verde vazio');
    for (const [nome, valor] of aceitos) {
      comEnv(nome, valor, () => assert.doesNotThrow(
        () => validateEnvVariables(), `${nome}=${valor} precisa passar no boot`));
    }
  });

  it('o boot RECUSA lixo nas duas, que e o que a entrada na tabela compra', () => {
    // Sem a regra, `parseInt('abc')` e NaN e toda comparacao com NaN e falsa: o teto nunca
    // fecharia, com a aparencia de estar configurado.
    const recusados = [['ATLAS_MAX_PER_ACCOUNT', 'abc'], ['IMPORT_MAX_MAPS', '12x']];
    assert.equal(recusados.length, 2, 'guarda: laco sobre colecao vazia seria verde vazio');
    for (const [nome, valor] of recusados) {
      comEnv(nome, valor, () => assert.throws(
        () => validateEnvVariables(), new RegExp(nome), `${nome}=${valor} precisa reprovar no boot`));
    }
  });
});
