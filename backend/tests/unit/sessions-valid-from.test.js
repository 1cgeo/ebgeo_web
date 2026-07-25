// Path: tests/unit/sessions-valid-from.test.js
// Achado 35 — a decisão de resolução do corte de sessão, provada sem banco.
//
// `tokenPredatesSessionCut` compara um `iat` de JWT (SEGUNDOS, jwt.sign trunca) com
// `users.sessions_valid_from` (TIMESTAMPTZ, sub-segundo). Truncado o marcador ao
// segundo, sobra UM segundo ambíguo: para o token cujo `iat` é igual ao segundo do
// corte, nada no token diz se ele veio antes ou depois. Alguma coisa tem de ser
// decidida sobre esse segundo, e a decisão é `iat <= floor(corte)`: ele PERDE.
//
// O caso que discrimina é exatamente esse, e só ele: `iat` IGUAL ao segundo do corte
// tem de ser recusado. Com `<` (o segundo ambíguo sobrevive) todo o resto deste
// arquivo continua passando, e a reprodução natural do achado — logar, revogar,
// replicar o access token, tudo dentro do mesmo segundo de relógio — volta a devolver
// 200. Um furo que o próprio teste do bug não consegue enxergar. Justificativa
// completa no JSDoc de src/utils/org-status.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenPredatesSessionCut } from '../../src/utils/org-status.js';

/** Segundo UNIX de um instante em ms. */
const sec = (ms) => Math.floor(ms / 1000);

describe('tokenPredatesSessionCut (corte de sessão, achado 35)', () => {
  it('marcador NULL deixa passar — o caminho de toda conta que nunca foi revogada', () => {
    const agora = sec(Date.now());
    assert.equal(tokenPredatesSessionCut(agora, null), false);
    assert.equal(tokenPredatesSessionCut(agora, undefined), false);
    // Inclusive um token velhíssimo: sem corte não há o que comparar.
    assert.equal(tokenPredatesSessionCut(0, null), false);
  });

  it('token emitido ANTES do corte é recusado', () => {
    const corte = new Date('2026-07-25T12:00:00.500Z');
    assert.equal(tokenPredatesSessionCut(sec(corte.getTime()) - 1, corte), true, 'um segundo antes');
    assert.equal(tokenPredatesSessionCut(sec(corte.getTime()) - 900, corte), true, '15 min antes');
  });

  it('token emitido DEPOIS do corte passa — o corte não pode matar sessão nova', () => {
    const corte = new Date('2026-07-25T12:00:00.500Z');
    assert.equal(tokenPredatesSessionCut(sec(corte.getTime()) + 1, corte), false);
    assert.equal(tokenPredatesSessionCut(sec(corte.getTime()) + 900, corte), false);
  });

  it('MESMO SEGUNDO do corte é RECUSADO — é este caso, e só ele, que decide `<=` contra `<`', () => {
    // Marcador com fração: o segundo do corte é 12:00:00, e o token emitido nesse
    // segundo (em .100 ou em .900, o token não sabe dizer) tem o mesmo iat.
    const corte = new Date('2026-07-25T12:00:00.500Z');
    const mesmoSegundo = sec(corte.getTime());

    assert.equal(
      tokenPredatesSessionCut(mesmoSegundo, corte),
      true,
      'o segundo ambíguo perde: fail closed. Com `<` este caso passaria e a reprodução '
      + 'do achado (login + revogação no mesmo segundo de relógio) voltaria a devolver 200'
    );

    // Fronteira do outro lado: o segundo SEGUINTE passa, senão o corte mataria tudo.
    assert.equal(tokenPredatesSessionCut(mesmoSegundo + 1, corte), false);
  });

  it('marcador exatamente no início de um segundo (fração zero) mantém a mesma fronteira', () => {
    const corte = new Date('2026-07-25T12:00:00.000Z');
    const s = sec(corte.getTime());
    assert.equal(tokenPredatesSessionCut(s, corte), true, 'iat == corte é recusado');
    assert.equal(tokenPredatesSessionCut(s - 1, corte), true, 'iat < corte é recusado');
    assert.equal(tokenPredatesSessionCut(s + 1, corte), false, 'o segundo seguinte passa');
  });

  it('aceita o marcador como string ISO (o driver pode devolver Date ou texto)', () => {
    const iso = '2026-07-25T12:00:00.500Z';
    const s = sec(Date.parse(iso));
    assert.equal(tokenPredatesSessionCut(s, iso), true);
    assert.equal(tokenPredatesSessionCut(s + 1, iso), false);
  });

  it('anomalia não tranca ninguém fora: iat ausente/NaN e marcador impossível passam', () => {
    const corte = new Date('2026-07-25T12:00:00.500Z');
    assert.equal(tokenPredatesSessionCut(undefined, corte), false, 'sem iat não se julga');
    assert.equal(tokenPredatesSessionCut(null, corte), false);
    assert.equal(tokenPredatesSessionCut(NaN, corte), false);
    assert.equal(tokenPredatesSessionCut(Infinity, corte), false);
    assert.equal(tokenPredatesSessionCut(0, 'não é uma data'), false, 'marcador ilegível não revoga');
  });
});
