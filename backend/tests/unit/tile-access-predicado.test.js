// Path: tests/unit/tile-access-predicado.test.js
//
// O PREDICADO PURO DO `auth_request` DE TILE, e o que ele existe para segurar.
//
// POR QUE ELE PRECISA DE UM TESTE SEM BANCO, além do de integração. Metade dos
// desfechos deste predicado é INALCANÇÁVEL pela rota, e não por acidente: o CHECK de
// `api_keys.scope` só admite os valores do vocabulário vigente, então não existe
// caminho de banco que entregue ao gate um escopo desconhecido. Isso é bom (o CHECK é a
// primeira barreira) e cria um cego: o ramo que decide o que fazer com um escopo que um
// servidor mais novo invente nunca é exercido pelo teste de integração. Se ele falhasse
// ABERTO, a rodada inteira ficaria verde.
//
// A DIREÇÃO DA FALHA É O ASSUNTO. `scopeReachesTile` pergunta se o escopo está no
// VOCABULÁRIO (`API_KEY_SCOPES`, derivado de `API_KEY_SCOPE_REACH`), porque o cabeçalho
// de `api-key-terms.js` declara que as superfícies SÓ-FLEXÍVEIS são alcançadas por toda
// chave que resolve — escrever aqui uma segunda tabela seria a lista duplicada que a
// casa proíbe. O preço dessa derivação é que um escopo NOVO ganharia alcance de tile
// sozinho, e é o último caso deste arquivo que cobra o preço: o vocabulário é preso por
// igualdade EXATA, de modo que acrescentar um escopo reprova aqui e obriga quem o
// acrescenta a responder a pergunta.
//
// O QUE ESTE ARQUIVO NÃO PRENDE: que a rota responda 401/200, que a chave vencida seja
// recusada, que o corpo saia vazio. Isso é `tests/integration/tile-access-auth-request.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TILE_ACCESS_DENIAL,
  scopeReachesTile,
  tileAccessDenial,
} from '../../src/modules/auth/tile-access.js';
import { API_KEY_SCOPES } from '../../src/modules/users/api-key-terms.js';

describe('tile-access: o predicado puro', () => {
  it('a chave de escopo `tiles` passa, e é o caso que a rota existe para servir', () => {
    assert.equal(tileAccessDenial({ authVia: 'api_key', apiKeyScope: 'tiles' }), null);
  });

  it('a chave de escopo `full` também passa: o vocabulário INTEIRO alcança o tile', () => {
    // Sem este caso, o gate poderia comparar por igualdade com `tiles` e derrubar todo
    // integrador do slot legado, que resolve como `full`.
    assert.equal(tileAccessDenial({ authVia: 'api_key', apiKeyScope: 'full' }), null);

    const semAlcance = API_KEY_SCOPES.filter((s) => !scopeReachesTile(s));
    assert.deepEqual(
      semAlcance, [],
      'todo escopo do vocabulário alcança o tile; se um deixar de alcançar, a mudança certa é uma '
      + 'coluna `tile` em API_KEY_SCOPE_REACH, e não um `if` dentro de scopeReachesTile'
    );
    assert.ok(API_KEY_SCOPES.length > 0, 'guarda: vocabulário vazio faria a asserção acima passar vazia');
  });

  it('credencial que NÃO é chave de API é recusada, seja qual for o escopo que carregue', () => {
    // O 401 desta rota nasce aqui para: anônimo, sessão de cookie, Bearer, e toda chave
    // que não RESOLVEU (vencida, revogada, de conta desativada, de OM inativa, malformada)
    // — em todos esses casos `flexibleAuth` deixa `authVia` sem valor.
    for (const via of [undefined, null, '', 'jwt', 'cookie', 'api-key', 'API_KEY']) {
      assert.equal(
        tileAccessDenial({ authVia: via, apiKeyScope: 'tiles' }),
        TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA,
        `authVia ${JSON.stringify(via)} não pode abrir o tile`
      );
    }
  });

  it('sem argumento nenhum, recusa: o default é o NÃO', () => {
    assert.equal(tileAccessDenial(), TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);
    assert.equal(tileAccessDenial({}), TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA);
  });

  it('escopo FORA do vocabulário falha FECHADO, e este é o ramo que o banco não alcança', () => {
    // `api_keys.scope` tem CHECK, então nenhum destes chega pela rota. É por isso que
    // eles são medidos aqui: o ramo existe para o dia em que o vocabulário crescer, e um
    // ramo nunca exercido é um ramo que pode estar invertido.
    const desconhecidos = [
      undefined, null, '', ' ', 'Tiles', 'TILES', 'tiles ', 'administracao', 'estrito',
      'full,tiles', '*', 'toString', '__proto__', 'constructor', 0, 1, true, {}, [],
    ];
    for (const escopo of desconhecidos) {
      assert.equal(
        scopeReachesTile(escopo), false,
        `o escopo ${JSON.stringify(escopo)} não está no vocabulário e não pode alcançar o tile`
      );
      assert.equal(
        tileAccessDenial({ authVia: 'api_key', apiKeyScope: escopo }),
        TILE_ACCESS_DENIAL.ESCOPO_NAO_ALCANCA,
        `o escopo ${JSON.stringify(escopo)} precisa ser recusado PELO ESCOPO, não por outro termo`
      );
    }
    assert.equal(desconhecidos.length, 19, 'guarda: laço sobre coleção de tamanho não asserido não prova nada');
  });

  it('os DOIS motivos são distintos: a rota consegue dizer de onde veio a recusa', () => {
    // Se os dois colapsassem numa string só, o cabeçalho de diagnóstico da rota mentiria
    // e o teste de integração não teria como separar "chave não resolveu" de "escopo
    // errado" — os dois são o mesmo 401.
    assert.notEqual(TILE_ACCESS_DENIAL.SEM_CHAVE_VIVA, TILE_ACCESS_DENIAL.ESCOPO_NAO_ALCANCA);
    assert.equal(Object.keys(TILE_ACCESS_DENIAL).length, 2);
    assert.equal(Object.isFrozen(TILE_ACCESS_DENIAL), true);
  });

  it('O VOCABULÁRIO É PRESO POR IGUALDADE EXATA, e é isso que obriga a decisão', () => {
    // ESCOPO NOVO REPROVA AQUI. A derivação de `scopeReachesTile` a partir de
    // `API_KEY_SCOPES` daria alcance de tile a um escopo novo SOZINHA, que é a única
    // direção de falha aberta deste arquivo. Este caso a fecha: quem acrescentar um
    // escopo passa por aqui e responde se ele alcança o tile. Se a resposta for NÃO, a
    // mudança certa é uma coluna `tile` em `API_KEY_SCOPE_REACH` (onde o alcance por
    // superfície já mora, como `estrito` e `administracao`), lida por `apiKeyReaches`.
    assert.deepEqual(
      [...API_KEY_SCOPES].sort(), ['full', 'tiles'],
      'o vocabulário de escopo de chave mudou: decida, POR ESCRITO, se o valor novo alcança a '
      + 'superfície de tile antes de atualizar esta lista'
    );
  });
});
