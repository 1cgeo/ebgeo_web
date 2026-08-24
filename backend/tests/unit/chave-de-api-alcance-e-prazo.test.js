// Path: tests/unit/chave-de-api-alcance-e-prazo.test.js
//
// O VOCABULÁRIO DA CHAVE DE API, em node puro: a tabela de alcance e o aparo de prazo.
//
// POR QUE ELE MERECE ARQUIVO PRÓPRIO. `apiKeyReaches` é o predicado que os DOIS gates
// consultam (`middleware/auth.js` e `middleware/require-admin.js`), e o modo de falha que
// ele existe para impedir não aparece no teste de integração: um escopo DESCONHECIDO
// (nulo, string do chamador, valor que um servidor mais novo grave) tem de falhar
// FECHADO. Uma comparação por igualdade espalhada pelos gates falharia ABERTO no `else`,
// que é exatamente a lista fechada que a constituição proíbe nos dois eixos de permissão.
//
// A ASSERÇÃO QUE MAIS IMPORTA aqui é a de que NENHUMA linha da tabela alcança
// administração. Ela é sobre a TABELA inteira, e não sobre os dois valores de hoje: um
// escopo acrescentado amanhã com `administracao: true` deixa este arquivo vermelho, que é
// o único jeito de a cláusula 10.7 continuar valendo depois desta fase.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_KEY_SCOPES, API_KEY_SCOPE_REACH, API_KEY_SCOPE_DEFAULT, API_KEY_SCOPE_LEGACY,
  API_KEY_TERM_DEFAULT_DAYS, API_KEY_TERM_MAX_DAYS, API_KEY_TERMS,
  apiKeyReaches, clampApiKeyTermDays,
} from '../../src/modules/users/api-key-terms.js';

describe('Chave de API: a tabela de alcance e a escada de prazos (cláusula 10.7)', () => {
  it('piso: a tabela tem linhas, e o vocabulário é DERIVADO dela (não uma segunda lista)', () => {
    // O PISO PRIMEIRO. Sem ele, toda asserção "para todo escopo" abaixo passaria verde
    // sobre uma tabela vazia — a cobertura vazia que este repositório mais paga.
    const linhas = Object.keys(API_KEY_SCOPE_REACH);
    assert.ok(linhas.length >= 2, `esperava >= 2 escopos na tabela, achei ${linhas.length}`);
    assert.deepEqual(API_KEY_SCOPES, linhas, 'API_KEY_SCOPES precisa SER as chaves da tabela');
    assert.ok(API_KEY_SCOPES.includes(API_KEY_SCOPE_DEFAULT), 'o escopo padrão precisa existir na tabela');
    assert.ok(API_KEY_SCOPES.includes(API_KEY_SCOPE_LEGACY), 'o escopo do slot legado precisa existir na tabela');
  });

  it('NENHUM escopo alcança administração, e isso vale para a tabela INTEIRA', () => {
    // A AMARRA 2 NA SUA FORMA MÍNIMA, dita como propriedade e não como dois casos:
    // "uma chave usada para buscar tile não precisa configurar o sistema".
    const linhas = Object.entries(API_KEY_SCOPE_REACH);
    assert.ok(linhas.length >= 2, 'sem linhas, o laço abaixo não asseriria nada');
    const alcancam = linhas.filter(([, v]) => v.administracao === true).map(([k]) => k);
    assert.deepEqual(
      alcancam, [],
      'escopo que alcança administração: uma chave que vaza de um log de tile voltaria a ser '
      + 'uma sessão de administrador'
    );
    // E pelo predicado, que é o que os gates chamam de verdade.
    const pelosGates = API_KEY_SCOPES.filter((s) => apiKeyReaches(s, 'administracao'));
    assert.deepEqual(pelosGates, [], 'o predicado precisa concordar com a tabela');
  });

  it('os dois escopos de hoje se distinguem no eixo ESTRITO (senão a tabela não decide nada)', () => {
    // A DISCRIMINAÇÃO. Sem este caso, uma tabela em que TODA linha fosse `false` passaria
    // o caso acima e o gate estrito recusaria toda chave, inclusive a legada — quebrando
    // o contrato de `x-api-key` sem que nada ficasse vermelho.
    assert.equal(apiKeyReaches('full', 'estrito'), true, 'o escopo legado alcança rota estrita');
    assert.equal(apiKeyReaches('tiles', 'estrito'), false, 'a chave de tile NÃO alcança rota estrita');
  });

  it('escopo desconhecido falha FECHADO nos dois eixos, e superfície desconhecida também', () => {
    const desconhecidos = [null, undefined, '', 'admin', 'ADMIN', 'full ', 'escopo-do-futuro', 0, {}];
    assert.ok(desconhecidos.length >= 5, 'sem entradas, o laço abaixo não asseriria nada');
    const passaram = desconhecidos.filter(
      (s) => apiKeyReaches(s, 'estrito') || apiKeyReaches(s, 'administracao')
    );
    assert.deepEqual(passaram, [], 'escopo fora da tabela precisa não alcançar nada');

    // A superfície também: pedir por uma coluna que não existe é `false`, nunca
    // `undefined` tratado como verdadeiro por um `if` distraído do outro lado.
    assert.equal(apiKeyReaches('full', 'superficie-inexistente'), false);
    assert.equal(apiKeyReaches('full', ''), false);
  });

  it('o aparo de prazo respeita o teto, o padrão e os números que não são número', () => {
    assert.equal(API_KEY_TERM_MAX_DAYS, 365, 'o teto é o mesmo da concessão de recurso: um ano');
    assert.ok(API_KEY_TERMS.includes(API_KEY_TERM_DEFAULT_DAYS), 'o padrão precisa estar na escada');
    assert.ok(
      API_KEY_TERMS.every((d) => d <= API_KEY_TERM_MAX_DAYS),
      'a escada não pode oferecer um degrau que o banco recusa'
    );

    // Pedido honrado, pedido aparado, pedido ausente.
    assert.equal(clampApiKeyTermDays(30), 30);
    assert.equal(clampApiKeyTermDays(365), 365);
    assert.equal(clampApiKeyTermDays(3000), API_KEY_TERM_MAX_DAYS, 'acima do teto vira o TETO');
    assert.equal(clampApiKeyTermDays(undefined), API_KEY_TERM_DEFAULT_DAYS);

    // AS BORDAS. `x ?? 0` NÃO guarda `NaN`, e é por isso que o predicado é
    // `Number.isFinite`: sem ele, `NaN` atravessaria o `<= 0` e viraria um
    // `make_interval(days => NaN)` no banco.
    const invalidos = [NaN, Infinity, -Infinity, 0, -5, null, '90'];
    assert.ok(invalidos.length >= 5, 'sem entradas, o laço abaixo não asseriria nada');
    const desviaram = invalidos.filter((v) => clampApiKeyTermDays(v) !== API_KEY_TERM_DEFAULT_DAYS);
    assert.deepEqual(desviaram, [], 'todo pedido inválido cai no padrão');

    // Fracionário vira inteiro para baixo: `make_interval(days => ...)` quer int.
    assert.equal(clampApiKeyTermDays(90.9), 90);
    assert.equal(clampApiKeyTermDays(1.2), 1);
  });
});
