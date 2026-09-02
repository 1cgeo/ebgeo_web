// Path: tests/unit/uso-horizonte.test.js
//
// A lógica PURA do relatório de uso: as conversões entre o driver e o payload.
//
// POR QUE ESTE ARQUIVO EXISTE. São funções de três linhas, e o instinto é não testá-las.
// Cada uma é a lápide de um jeito ingênuo de escrever a mesma linha, e todas falham do
// jeito caro: produzindo um número plausível.
//
//  - `paraEpoch(null)` escrito como `new Date(valor).getTime()` devolve 0, ou seja 1970 —
//    um horizonte que cobre qualquer janela imaginável. A tela então afirma que o período
//    está completo justamente quando não há dado nenhum para afirmar coisa alguma.
//  - `inteiro` sem `Number()` deixa o `bigint` do Postgres passar como STRING, e quem
//    somar dois deles recebe `'12' + '3' === '123'`.
//  - `decimalOuNulo` é o AVESSO de `inteiro`, e o par é fácil de confundir na hora de
//    escolher: `percentile_cont` sobre conjunto vazio devolve NULL, e passá-lo por
//    `inteiro` produz `0`. Zero hora ali é uma MEDIDA ("chegou ao passo no mesmo instante
//    do cadastro"), ou seja a afirmação mais forte que o relatório poderia inventar sobre
//    um conjunto em que ninguém chegou. Contagem ausente É zero; medida ausente NÃO é.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - fazer `paraEpoch(null)` cair em `new Date(null).getTime()`: reprova o caso do nulo,
//    nomeando o 1970;
//  - tirar o `Number.isFinite` de `paraEpoch`: uma data impossível vira `NaN` no payload, e
//    `NaN` atravessa o `JSON.stringify` como `null` — reprova o caso da data impossível;
//  - tirar o `Number()` de `inteiro`: reprova o caso de tipo e o da soma;
//  - escrever `decimalOuNulo` com o `?? 0` de `inteiro`: reprova o caso do nulo, que é o
//    único que separa as duas funções, e é a confusão que ele existe para pegar.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { paraEpoch, inteiro, decimalOuNulo } from '../../src/modules/uso/uso.horizonte.js';

describe('uso.horizonte — paraEpoch', () => {
  it('converte Date em epoch ms', () => {
    const d = new Date('2026-08-30T12:00:00.000Z');
    assert.equal(paraEpoch(d), d.getTime());
  });

  it('aceita a forma STRING, que é o que um driver configurado de outro jeito devolveria', () => {
    assert.equal(paraEpoch('2026-08-30T12:00:00.000Z'), Date.UTC(2026, 7, 30, 12));
  });

  it('null e undefined viram null, NUNCA 1970', () => {
    // O caso inteiro: `new Date(null).getTime()` é 0, e 0 como horizonte cobre qualquer
    // janela imaginável. É a mentira mais confortável que este módulo pode contar.
    assert.equal(paraEpoch(null), null);
    assert.equal(paraEpoch(undefined), null);
    assert.notEqual(paraEpoch(null), 0);
  });

  it('data impossível vira null, e não NaN solto no payload', () => {
    assert.equal(paraEpoch('isto não é uma data'), null);
  });
});

describe('uso.horizonte — inteiro', () => {
  it('o COUNT do Postgres chega como STRING e sai como número', () => {
    assert.strictEqual(inteiro('12'), 12);
    assert.strictEqual(typeof inteiro('12'), 'number');
  });

  it('somar dois deles soma, e não concatena', () => {
    // É este o defeito, e ele compila, roda e produz um número plausível na tela.
    assert.strictEqual(inteiro('12') + inteiro('3'), 15);
  });

  it('nulo e ausente valem zero (um GROUP BY sem linhas não é um buraco no payload)', () => {
    assert.strictEqual(inteiro(null), 0);
    assert.strictEqual(inteiro(undefined), 0);
  });

  it('lixo vira 0, e não NaN — NaN atravessa o JSON como null e some da tela', () => {
    assert.strictEqual(inteiro('doze'), 0);
  });
});

describe('uso.horizonte — decimalOuNulo', () => {
  it('a mediana ausente é null, e NUNCA zero', () => {
    // O caso inteiro. `percentile_cont` sobre conjunto vazio devolve NULL: ninguém chegou
    // ao passo. Um `0` ali diz "chegaram no mesmo instante em que se cadastraram", que é
    // uma medida, e sobre um conjunto vazio não há medida nenhuma.
    assert.equal(decimalOuNulo(null), null);
    assert.equal(decimalOuNulo(undefined), null);
    assert.notEqual(decimalOuNulo(null), 0);
    // O par que fecha a discriminação: a MESMA entrada, na irmã, vale zero de propósito.
    assert.strictEqual(inteiro(null), 0);
  });

  it('ZERO é medida e sobrevive: quem criou o atlas no mesmo instante do cadastro existe', () => {
    assert.strictEqual(decimalOuNulo(0), 0);
    assert.strictEqual(decimalOuNulo('0'), 0);
  });

  it('a fração chega como STRING de driver e sai como número, sem arredondar', () => {
    // Não arredonda de propósito: o número que a tela diz tem de ser o número que o
    // servidor mandou, e quem arredonda é a frase, num lugar só.
    assert.strictEqual(decimalOuNulo('2.5'), 2.5);
    assert.strictEqual(decimalOuNulo(6.0166666666666666), 6.0166666666666666);
  });

  it('lixo vira null, e não NaN nem zero', () => {
    // `NaN` atravessa o JSON.stringify como `null` de qualquer jeito; o que muda é que
    // aqui a decisão está escrita, em vez de acontecer por acidente do serializador.
    assert.equal(decimalOuNulo('seis horas'), null);
    assert.equal(decimalOuNulo(Infinity), null);
  });
});
