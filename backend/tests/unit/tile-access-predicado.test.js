// Path: tests/unit/tile-access-predicado.test.js
//
// AS DUAS PEÇAS PURAS DO GATE DE TILE: o recorte do caminho pedido e o alcance do escopo
// de chave. As duas rodam sem banco e sem Express, e as duas falham FECHADO — que é o que
// este arquivo existe para prender.
//
// O QUE MUDOU EM 2026-08-29, e por que este arquivo foi reescrito: até então o gate
// decidia só sobre a CREDENCIAL, e o predicado testado aqui era `tileAccessDenial`, uma
// função que respondia "esta credencial serve?" sem saber que camada estava sendo pedida.
// Ela deixou de existir quando o gate passou a decidir POR RECURSO (secção (f) de
// PENDENCIA-TILE-PRIVADO.md): a decisão agora é assíncrona, consulta o índice de catálogo
// e o predicado SQL, e vive em `requireTileAccess`. O que sobra de puro são estas duas.
//
// A DIREÇÃO DA FALHA É O ASSUNTO NOS DOIS CASOS:
//
//   `caminhoDoTile` devolve `null` quando o cabeçalho não veio, e o gate lê `null` como
//   RECUSA. Um nginx configurado sem `X-Original-URI` não pode receber "sim" para todo
//   caminho — isso seria falha aberta operada por esquecimento de configuração.
//
//   `scopeReachesTile` pergunta se o escopo está no VOCABULÁRIO, e não se ele é igual a
//   um valor. Escopo nulo, indefinido ou inventado por um servidor mais novo não alcança
//   nada. Comparar por igualdade e cair no `else` falharia ABERTO, que é a lista fechada
//   que a constituição proíbe nos dois eixos de permissão.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY_SCOPES } from '../../src/modules/users/api-key-terms.js';
import {
  scopeReachesTile,
  caminhoDoTile,
  TILE_ACCESS_DENIAL,
} from '../../src/modules/auth/tile-access.js';

/** Um `req` mínimo: só o que `caminhoDoTile` lê. */
function req(uri) {
  return { get: (nome) => (nome.toLowerCase() === 'x-original-uri' ? uri : undefined) };
}

describe('tile-access: o recorte do caminho pedido', () => {
  it('tira o prefixo público e a query', () => {
    // A base da suíte é `/tiles` (`.env.test`), e o recorte usa a MESMA base com que o
    // índice indexa: os dois lados precisam concordar sobre onde o prefixo termina.
    assert.equal(caminhoDoTile(req('/tiles/rodovias')), 'rodovias');
    assert.equal(caminhoDoTile(req('/tiles/rodovias/10/385/577')), 'rodovias/10/385/577');
    assert.equal(caminhoDoTile(req('/tiles/rodovias?api_key=abc')), 'rodovias');
    assert.equal(caminhoDoTile(req('/tiles/dem/1/2/3.png?x=1#frag')), 'dem/1/2/3.png');
  });

  it('devolve null SEM cabeçalho — e o gate lê isso como recusa', () => {
    // O caso que impede a falha aberta por configuração esquecida.
    assert.equal(caminhoDoTile(req(undefined)), null);
    assert.equal(caminhoDoTile(req('')), null);
    assert.equal(caminhoDoTile(req('   ')), null);
    assert.equal(caminhoDoTile(req(42)), null);
  });

  it('devolve null para o prefixo nu, que não endereça fonte nenhuma', () => {
    assert.equal(caminhoDoTile(req('/tiles/')), null);
    assert.equal(caminhoDoTile(req('/tiles')), null);
  });

  it('um caminho fora do prefixo é devolvido como veio, e não casará nada', () => {
    // Não é papel deste recorte recusar: quem não conhece o caminho é o índice, e a
    // recusa acontece lá, com o motivo `caminho-nao-reivindicado`. Recusar aqui
    // esconderia a razão real dentro de uma função de string.
    assert.equal(caminhoDoTile(req('/outra-coisa/x')), 'outra-coisa/x');
  });
});

describe('tile-access: o alcance do escopo de chave', () => {
  it('todo escopo do vocabulário alcança o tile', () => {
    // Asserção sobre a LISTA e não sobre dois literais: um escopo novo entra aqui sozinho,
    // e o caso abaixo é que decide se ele deveria.
    assert.ok(API_KEY_SCOPES.length >= 2, 'o vocabulário não pode estar vazio');
    for (const escopo of API_KEY_SCOPES) {
      assert.equal(scopeReachesTile(escopo), true, `o escopo ${escopo} deveria alcançar`);
    }
  });

  it('FALHA FECHADO para o que não está no vocabulário', () => {
    for (const invalido of [null, undefined, '', 'admin', 'escopo-de-um-servidor-mais-novo', 42, {}]) {
      assert.equal(scopeReachesTile(invalido), false, `${String(invalido)} não pode alcançar`);
    }
  });
});

describe('tile-access: os motivos de recusa são distinguíveis', () => {
  it('os quatro motivos existem e são distintos', () => {
    // Sem motivos distintos, os 401 deste endpoint são indistinguíveis entre si, e um
    // deles poderia estar acontecendo pelo motivo errado sem nada acusar. Eles saem em
    // cabeçalho, que é como chegam ao log de erro do host.
    const motivos = Object.values(TILE_ACCESS_DENIAL);
    assert.equal(motivos.length, 4);
    assert.equal(new Set(motivos).size, 4);
    assert.ok(motivos.every((m) => typeof m === 'string' && m.length > 0));
  });

  it('o motivo do caminho não reivindicado é o da decisão 4', () => {
    // Asserção absoluta sobre o valor: ele aparece no log do host e em
    // `dev/tile-privado`, então renomeá-lo em silêncio quebraria a leitura de fora.
    assert.equal(TILE_ACCESS_DENIAL.CAMINHO_NAO_REIVINDICADO, 'caminho-nao-reivindicado');
  });
});
