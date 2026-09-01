// Path: tests/unit/regime-vencido-teto.test.js
//
// ATÉ QUANDO UM ÍNDICE DE REGIME VENCIDO AINDA PODE DIZER "ISTO É PÚBLICO": a aritmética
// da fronteira e a faixa da configuração que a alimenta.
//
// O QUE ESTE ARQUIVO PRENDE, e o que ele deliberadamente NÃO prende. Aqui está a DECISÃO
// pura (`afirmacaoPublicaVencida`) e a IDADE que a alimenta (`vigia.vencidoHaMs`), com o
// relógio injetado, nunca falseado globalmente. A FIAÇÃO dela dentro dos dois índices, e o
// fato de que o teto alcança só a resposta pública, é medida contra os módulos reais em
// `regime-teto-indices.test.js` (dentro do teto) e `regime-teto-estourado.test.js` (além
// dele). Os três são necessários: a aritmética certa num índice que não a consulta é verde
// que não prova nada, e a fiação certa sobre uma comparação invertida também.
//
// AS PROPRIEDADES QUE CADA BLOCO COMPRA, e o que ficaria vermelho se o código estivesse
// errado:
//
//   1. regime NORMAL nunca vence. Se vencesse, o produto responderia 503 no caminho
//      público com o banco de pé, que é a regressão mais cara possível desta mudança;
//   2. a fronteira é `>=` no teto EXATO. Trocada por `>`, o teto zero (o regime mais
//      estrito que a configuração oferece) deixaria passar a consulta do instante da
//      queda, e o valor deixaria de significar o que promete;
//   3. NaN não abre a janela. `idade >= NaN` é sempre falso, então um teto mal configurado
//      viraria um teto que nunca fecha, com a aparência de estar configurado. Este é o
//      modo de falha que a faixa em `NUMERIC_ENV_RULES` existe para tornar impossível, e o
//      bloco de baixo cobra a faixa;
//   4. a idade conta DESDE A QUEDA e zera na recuperação. Contada desde a última
//      construção boa, ela cresceria em regime normal e o teto fecharia sozinho; somada
//      entre incidentes, um minuto bom no meio não contaria.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  afirmacaoPublicaVencida,
  criarVigiaDeRegime,
  RegimeVencidoAlemDoTetoError,
} from '../../src/modules/nomes/regime-vencido.js';
import config, { NUMERIC_ENV_RULES, validateEnvVariables } from '../../src/config.js';

/** Um sink mudo: aqui o assunto é a idade, não a linha de log. */
function vigiaMudo(nome = 'tile') {
  return criarVigiaDeRegime(nome, () => {});
}

const CINCO_MINUTOS = 300_000;

describe('teto do regime vencido: a decisão', () => {
  it('regime NORMAL (idade null) nunca vence, com qualquer teto', () => {
    // O caminho quente do produto: banco de pé, índice vigente. Se este caso virasse
    // `true`, todo tile público responderia 503.
    assert.equal(afirmacaoPublicaVencida(null, CINCO_MINUTOS), false);
    assert.equal(afirmacaoPublicaVencida(null, 0), false);
    assert.equal(afirmacaoPublicaVencida(undefined, 0), false);
  });

  it('a fronteira é o teto EXATO, e ela é fechada (`>=`)', () => {
    assert.equal(afirmacaoPublicaVencida(0, CINCO_MINUTOS), false);
    assert.equal(afirmacaoPublicaVencida(CINCO_MINUTOS - 1, CINCO_MINUTOS), false);
    assert.equal(afirmacaoPublicaVencida(CINCO_MINUTOS, CINCO_MINUTOS), true);
    assert.equal(afirmacaoPublicaVencida(CINCO_MINUTOS + 1, CINCO_MINUTOS), true);
    assert.equal(afirmacaoPublicaVencida(3_600_000, CINCO_MINUTOS), true);
  });

  it('teto ZERO é o regime mais estrito, e é o `>=` que o faz valer', () => {
    // Com `>` este caso seria `false` e o valor 0 prometeria uma coisa e faria outra.
    assert.equal(afirmacaoPublicaVencida(0, 0), true);
    assert.equal(afirmacaoPublicaVencida(1, 0), true);
  });

  it('NaN não vira um teto que nunca fecha, e idade infinita vence', () => {
    // `x >= NaN` é sempre falso, então sem as guardas explícitas um NaN de qualquer lado
    // seria indistinguível de "ainda dentro do prazo", para sempre.
    assert.equal(afirmacaoPublicaVencida(NaN, CINCO_MINUTOS), false, 'idade NaN = idade que não existe');
    // Teto ilegível cai no lado aberto, e isso só é aceitável porque a faixa de
    // NUMERIC_ENV_RULES o torna inalcançável (o bloco de baixo é quem compra isso).
    assert.equal(afirmacaoPublicaVencida(10, NaN), false);
    assert.equal(afirmacaoPublicaVencida(10, undefined), false);
    // A idade infinita é o limite de "velho" e tem de VENCER: se ela fosse ignorada junto
    // com o NaN, a função teria um caminho próprio para reabrir a janela.
    assert.equal(afirmacaoPublicaVencida(Infinity, CINCO_MINUTOS), true);
  });

  it('o teto padrão vem da configuração, e é cinco minutos', () => {
    // O número mora em UM lugar. Se ele saísse do `config`, a função teria um segundo
    // padrão embutido e mudar a variável de ambiente não mudaria nada.
    assert.equal(config.regimeIndex.staleMaxMs, CINCO_MINUTOS);
    assert.equal(afirmacaoPublicaVencida(CINCO_MINUTOS - 1), false);
    assert.equal(afirmacaoPublicaVencida(CINCO_MINUTOS), true);
  });
});

describe('teto do regime vencido: a idade que o alimenta', () => {
  it('null em regime normal, a duração exata em regime vencido', () => {
    const vigia = vigiaMudo();
    vigia.anotarConstrucao(1_000);
    assert.equal(vigia.vencidoHaMs(9_999), null, 'construído e vigente: não há idade de queda');

    vigia.anotarQueda(new Error('down'), 2_000);
    assert.equal(vigia.vencidoHaMs(2_000), 0, 'no instante da queda a idade é zero, não null');
    assert.equal(vigia.vencidoHaMs(302_000), CINCO_MINUTOS);
  });

  it('a recuperação ZERA a idade, e o incidente seguinte conta do zero', () => {
    // Somar entre incidentes faria um minuto bom no meio não contar, e o teto fecharia
    // sobre um índice que acabou de ser reconstruído.
    const vigia = vigiaMudo();
    vigia.anotarConstrucao(1_000);
    vigia.anotarQueda(new Error('down'), 2_000);
    vigia.anotarConstrucao(500_000);
    assert.equal(vigia.vencidoHaMs(500_001), null);

    vigia.anotarQueda(new Error('down again'), 600_000);
    assert.equal(vigia.vencidoHaMs(600_010), 10, 'conta da queda NOVA, não da primeira');
  });

  it('a rajada de quedas do mesmo incidente não move a idade', () => {
    // O índice é consultado uma vez por tile e todas as consultas em voo caem no mesmo
    // `catch`: se a segunda queda re-carimbasse `vencidoDesde`, a idade ficaria presa em
    // zero e o teto NUNCA fecharia enquanto houvesse tráfego.
    const vigia = vigiaMudo();
    vigia.anotarConstrucao(1_000);
    vigia.anotarQueda(new Error('down'), 2_000);
    for (let i = 0; i < 100; i += 1) vigia.anotarQueda(new Error('down'), 2_001 + i);
    assert.equal(vigia.vencidoHaMs(302_000), CINCO_MINUTOS);
  });
});

describe('teto do regime vencido: o erro que os índices lançam', () => {
  it('carrega índice, idade e teto, e NÃO é um AppError', () => {
    const erro = new RegimeVencidoAlemDoTetoError('tile', 900_000, CINCO_MINUTOS);
    assert.equal(erro.indice, 'tile');
    assert.equal(erro.vencidoHaMs, 900_000);
    assert.equal(erro.teto, CINCO_MINUTOS);
    // Sem os três campos, a linha do `errorHandler` deixa o 503 do teto indistinguível do
    // 503 de índice que nunca foi construído.
    assert.match(erro.message, /tile/);
    assert.match(erro.message, /900000/);
    // Sem `statusCode`: quem traduz para HTTP é o gate, não o índice. Se ele nascesse
    // `AppError`, o índice passaria a decidir a recusa, que é o que os dois cabeçalhos
    // dizem que ele não faz.
    assert.equal(erro.statusCode, undefined);
    assert.ok(erro instanceof Error);
  });
});

describe('teto do regime vencido: a faixa da configuração', () => {
  it('REGIME_STALE_MAX_MS tem faixa validada, com piso zero e teto de um dia', () => {
    assert.deepEqual(NUMERIC_ENV_RULES.REGIME_STALE_MAX_MS, { min: 0, max: 86_400_000 });
  });

  it('o boot RECUSA valor fora da faixa e valor não inteiro', () => {
    // `-1` e `300.5` são recusados pelo `^\d+$` da tabela, e `86400001` pelo teto.
    const ruins = ['abc', '-1', '300.5', '86400001', '99999999999'];
    const salvo = process.env.REGIME_STALE_MAX_MS;
    let conferidos = 0;
    try {
      for (const valor of ruins) {
        process.env.REGIME_STALE_MAX_MS = valor;
        assert.throws(
          () => validateEnvVariables(),
          /REGIME_STALE_MAX_MS/,
          `REGIME_STALE_MAX_MS=${valor} tem de ser recusado no boot`,
        );
        conferidos += 1;
      }
    } finally {
      if (salvo === undefined) delete process.env.REGIME_STALE_MAX_MS;
      else process.env.REGIME_STALE_MAX_MS = salvo;
    }
    assert.equal(conferidos, ruins.length, 'todos os casos ruins rodaram');
  });

  it('o boot ACEITA a faixa inteira, extremos inclusive', () => {
    // O PAR POSITIVO do bloco acima: sem ele, uma regra que recusasse TODO valor passaria
    // idêntica. A asserção é sobre a MENSAGEM e não sobre `doesNotThrow`, porque
    // `validateEnvVariables` também cobra outras variáveis, e um ambiente de teste sem uma
    // delas faria este bloco falhar por assunto alheio.
    const bons = ['0', '1', '300000', '86400000'];
    const salvo = process.env.REGIME_STALE_MAX_MS;
    let conferidos = 0;
    try {
      for (const valor of bons) {
        process.env.REGIME_STALE_MAX_MS = valor;
        let mensagem = '';
        try {
          validateEnvVariables();
        } catch (erro) {
          mensagem = String(erro.message);
        }
        assert.ok(
          !mensagem.includes('REGIME_STALE_MAX_MS'),
          `REGIME_STALE_MAX_MS=${valor} está dentro da faixa e não pode ser acusado: ${mensagem}`,
        );
        conferidos += 1;
      }
    } finally {
      if (salvo === undefined) delete process.env.REGIME_STALE_MAX_MS;
      else process.env.REGIME_STALE_MAX_MS = salvo;
    }
    assert.equal(conferidos, bons.length, 'todos os casos bons rodaram');
  });
});
