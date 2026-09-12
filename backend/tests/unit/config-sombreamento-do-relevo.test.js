// Path: tests/unit/config-sombreamento-do-relevo.test.js
//
// O `map2d.hillshade.enabled` servido por GET /api/config, e a borda que o admin atravessa.
//
// O QUE E. O sombreamento do relevo, desenhado sobre o mesmo modelo digital de elevacao que o
// terreno usa. O padrao servido e DESLIGADO, e isso e decisao do dono (2026-09-12): a casa nao
// decide por todo mundo, e quem liga e o ADMINISTRADOR, pela aba "Sistema" do painel.
//
// POR QUE A BORDA EXISTE. `map2d` do schema de override e `.unknown(true)`, entao a ROTA ja
// aceitava esta chave sem checagem nenhuma para quem chamasse `PUT /config/admin` a mao. Pela
// TELA nao havia caminho: o editor "Avancado (JSON)" saiu do painel em 2026-08-29, e o campo da
// aba "Sistema" nasceu junto com esta borda. O cliente le o valor por `=== true`, entao um
// `"sim"` chegado por qualquer caminho deixaria o sombreamento DESLIGADO em silencio, com o
// painel mostrando o valor salvo -- a falha que `avisoServidorSecundario` fechou em 2026-09-03,
// e a mesma razao de `sourceTileLodParams` e `terrainPreferredBasemap`.
//
// O QUE ESTE ARQUIVO NAO ALCANCA: o 422 na ROTA, que e de
// `tests/integration/config-admin.test.js`, e o campo na tela, que e do cliente
// (`frontend/tests/unit/admin-sombreamento-do-relevo.test.js`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAP2D_BASE } from '../../src/modules/config/config.static.js';
import { configOverridesSchema } from '../../src/modules/config/config.admin.schemas.js';

/**
 * @param {*} valor - o que o administrador mandaria em `map2d.hillshade`
 * @returns {{ erro: string|null, valor: * }} a mensagem de recusa, ou o objeto aceito
 */
function validar(valor) {
  const r = configOverridesSchema.validate(
    { map2d: { hillshade: valor } },
    { stripUnknown: true, abortEarly: false },
  );
  return { erro: r.error ? r.error.message : null, valor: r.value?.map2d?.hillshade };
}

describe('config.static: o sombreamento servido', () => {
  it('nasce DESLIGADO, e a chave existe: quem liga e o administrador', () => {
    assert.equal(MAP2D_BASE.hillshade.enabled, false);
    assert.ok(
      'enabled' in MAP2D_BASE.hillshade,
      'a chave tem de existir no documento: o painel a le para marcar a caixa, e uma chave '
      + 'ausente faria a tela mostrar "desligado" sem saber se era o valor ou a falta dele',
    );
  });

  it('o bloco traz a CAMADA junto, que e o que o cliente desenha quando liga', () => {
    // CONTROLE: sem isto, um `hillshade: { enabled: false }` pelado passaria no caso acima e o
    // administrador ligaria uma camada que nao existe.
    assert.equal(MAP2D_BASE.hillshade.layer.type, 'hillshade');
    assert.equal(MAP2D_BASE.hillshade.layer.source, 'hillshadeSource');
    assert.equal(typeof MAP2D_BASE.hillshade.layer.paint, 'object');
  });
});

describe('a borda do override: o tipo do sombreamento', () => {
  it('aceita ligar e desligar, que sao as duas respostas legitimas', () => {
    assert.equal(validar({ enabled: true }).erro, null);
    assert.deepEqual(validar({ enabled: true }).valor, { enabled: true });
    assert.equal(validar({ enabled: false }).erro, null);
    assert.deepEqual(validar({ enabled: false }).valor, { enabled: false });
  });

  it('RECUSA a string que o editor JSON produz, que e o caso que existe para pegar', () => {
    // `"sim"` nao e nem `true` nem `false`, e o cliente le por `=== true`: aceito aqui, ele
    // apagaria o sombreamento em silencio com o painel exibindo o valor salvo.
    const r = validar({ enabled: 'sim' });
    assert.ok(r.erro, 'uma string em `enabled` tem de morrer na borda');
    assert.match(r.erro, /enabled/);
  });

  it('RECUSA tambem as outras formas do mesmo erro', () => {
    // `1` e `0` entram aqui de proposito: sao a forma que um formulario mal escrito produz,
    // e o cliente le por `=== true`, entao um `1` aceito seria sombreamento desligado com o
    // painel dizendo que esta ligado.
    for (const ruim of [1, 0, null, [], {}, '']) {
      assert.ok(
        validar({ enabled: ruim }).erro,
        `\`enabled: ${JSON.stringify(ruim)}\` tem de morrer na borda`,
      );
    }
  });

  it('as strings `"true"` e `"false"` passam CONVERTIDAS, e e isso que as torna seguras', () => {
    // O editor "Avancado (JSON)" produz string com facilidade, e Joi converte estas duas em
    // booleano DE VERDADE antes de gravar. Aceitar sem converter e que seria o defeito: o
    // cliente le `=== true`, e a string `"false"` e verdadeira em JavaScript.
    //
    // Esta e a diferenca entre aceitar e converter, e por isso o caso cobra o TIPO do valor
    // gravado, nunca so a ausencia de erro.
    for (const [entrada, esperado] of [['true', true], ['false', false], ['TRUE', true]]) {
      const r = validar({ enabled: entrada });
      assert.equal(r.erro, null, `\`${entrada}\` devia passar`);
      assert.equal(r.valor.enabled, esperado);
      assert.equal(typeof r.valor.enabled, 'boolean', `\`${entrada}\` tem de virar booleano`);
    }
  });

  it('NAO cobra o resto do bloco, que nao e campo de formulario', () => {
    // O override guarda so o que o administrador mexeu, e o `deepMerge` de `getAppConfig`
    // devolve nome, descricao e camada do estatico. Cobrar o bloco inteiro aqui obrigaria a
    // tela a reenviar a tinta que ela leu, congelando-a na versao daquele carregamento.
    assert.equal(validar({ enabled: true, name: 'Relevo' }).erro, null);
    assert.equal(validar({}).erro, null);
  });

  it('o sombreamento sozinho nao arrasta as vizinhas de `map2d`', () => {
    // CONTROLE de escopo: um payload que so liga o sombreamento nao pode exigir nem inventar
    // `maxPitch`, `globe_projection` ou a faixa de zoom.
    const r = configOverridesSchema.validate(
      { map2d: { hillshade: { enabled: true } } },
      { stripUnknown: true, abortEarly: false },
    );
    assert.equal(r.error, undefined);
    assert.deepEqual(Object.keys(r.value.map2d), ['hillshade']);
  });
});
