// Path: tests/unit/config-lod-de-tiles.test.js
//
// O `sourceTileLodParams` servido por GET /api/config, e a borda que o admin atravessa.
//
// O QUE E. O par `[maxZoomLevelsOnScreen, tileCountMaxMinRatio]` que o cliente entrega a
// `map.setSourceTileLodParams`. O primeiro numero diz quao depressa o zoom dos tiles cai rumo
// ao horizonte com a camera inclinada, e quanto MENOR, mais tiles a tela pede.
//
// POR QUE `null`. Decisao do dono em 2026-09-04: o padrao do MapLibre, `(9.314, 3)`, e o mais
// leve dos tres valores que ja passaram por aqui, e `null` significa exatamente "mantem o
// padrao". Modelado a 60 graus, que e a inclinacao que o botao de terreno impoe, o par
// `[1, 10.0]` de um deploy pedia cerca de doze vezes os tiles do padrao e `[5, 6.0]` cerca de
// quatro; medido em Chromium, `[1, 10.0]` retinha oito vezes os tiles raster do padrao e o
// dobro dos de terreno. O parametro tambem nao alcanca a fonte de DEM: o mesmo
// `calculateTileZoom` escolhe os tiles internos de render-to-texture do terreno (issue #7699
// do MapLibre, aberta).
//
// POR QUE A BORDA EXISTE. `map2d` do schema de override e `.unknown(true)`, entao o editor
// "Avancado (JSON)" do painel ja gravava esta chave SEM checagem nenhuma. Um `[1, 10]` salvo
// ali chegaria a todo navegador, para sempre. O cliente recusa o mesmo par com aviso no
// console (`frontend/src/js/map/tile-lod.js`), e so a recusa aqui impede o valor de existir.
//
// O QUE ESTE ARQUIVO NAO ALCANCA: o 422 na ROTA, que e de
// `tests/integration/config-admin.test.js`, e o que o MapLibre faz com o par, que e do cliente.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAP2D_BASE } from '../../src/modules/config/config.static.js';
import { configOverridesSchema } from '../../src/modules/config/config.admin.schemas.js';

/**
 * @param {*} valor - o que o administrador mandaria em `map2d.sourceTileLodParams`
 * @param {Object} [irmas] - outras chaves de `map2d` no mesmo payload
 * @returns {{ erro: string|null, valor: * }} a mensagem de recusa, ou o objeto aceito
 */
function validar(valor, irmas = {}) {
  const r = configOverridesSchema.validate(
    { map2d: { ...irmas, sourceTileLodParams: valor } },
    { stripUnknown: true, abortEarly: false },
  );
  return { erro: r.error ? r.error.message : null, valor: r.value?.map2d };
}

describe('config.static: o LOD de tiles servido', () => {
  it('o padrao servido e `null`, e null e uma RESPOSTA, nao uma ausencia', () => {
    assert.equal(MAP2D_BASE.sourceTileLodParams, null);
    assert.ok(
      'sourceTileLodParams' in MAP2D_BASE,
      'a chave tem de existir no documento: o cliente declara a forma dela, e uma chave ausente '
      + 'faria a fusao do payload parcial cair no piso do cliente em vez de no valor decidido',
    );
  });

  it('e a unica chave de `map2d` que vale null: as vizinhas seguem com numero', () => {
    // CONTROLE: sem isto, um `MAP2D_BASE` inteiro zerado passaria no caso acima.
    assert.equal(typeof MAP2D_BASE.minZoom, 'number');
    assert.equal(typeof MAP2D_BASE.maxZoom, 'number');
    assert.equal(typeof MAP2D_BASE.maxPitch, 'number');
  });
});

describe('config.admin.schemas: a borda do LOD de tiles', () => {
  it('`null` passa, que e o valor servido', () => {
    assert.equal(validar(null).erro, null);
  });

  it('um par valido passa, e o padrao do MapLibre tambem', () => {
    assert.equal(validar([5, 6.0]).erro, null);
    assert.equal(validar([9.314, 3]).erro, null);
    assert.equal(validar([2, 1]).erro, null, 'o par exatamente no piso e valido');
  });

  it('o par de producao antigo `[1, 10.0]` e RECUSADO, e a mensagem nomeia a posicao', () => {
    const { erro } = validar([1, 10.0]);
    assert.ok(erro, 'o par que pedia ~12x os tiles do padrao tem de morrer na borda');
    assert.match(erro, /sourceTileLodParams/);
    assert.match(erro, /2/, 'a mensagem tem de dizer qual e o piso');
  });

  it('o piso e no PRIMEIRO valor: 1.999 cai e 2 passa', () => {
    assert.ok(validar([1.999, 3]).erro);
    assert.equal(validar([2, 3]).erro, null);
  });

  it('o segundo valor tem piso 1', () => {
    assert.ok(validar([5, 0.5]).erro);
    assert.equal(validar([5, 1]).erro, null);
  });

  it('nao-par e recusado: um numero so, tres numeros, texto, numero solto e objeto', () => {
    for (const ruim of [[5], [5, 6, 7], 'sim', 5, {}, [null, 3], [5, null]]) {
      assert.ok(validar(ruim).erro, `${JSON.stringify(ruim)} devia ter sido recusado`);
    }
  });

  it('OBSERVADO: numero em TEXTO e convertido, e o que fica gravado sao numeros', () => {
    // O Joi desta casa roda com `convert` ligado, e `Joi.number()` aceita `'5'` em toda parte
    // (o `maxPitch` acima faz o mesmo). Nao ha por que fechar aqui o que o vizinho abre, e o
    // que importa e o que fica GRAVADO: o cliente le o par com `Number.isFinite`, e uma string
    // sobrevivente cairia no `null` dele, ou seja, no padrao do MapLibre, em silencio.
    const { erro, valor } = validar(['5', '6.5']);
    assert.equal(erro, null);
    assert.deepEqual(valor.sourceTileLodParams, [5, 6.5]);
    // E a conversao NAO afrouxa o piso: `'1'` continua sendo recusado.
    assert.ok(validar(['1', '10']).erro);
  });

  it('declarar a chave NAO passa a descartar as chaves avancadas irmas', () => {
    // A armadilha desta casa: o middleware roda todo schema com `stripUnknown: true`, e uma
    // secao que perdesse o `.unknown(true)` gravaria o objeto podado em silencio, com 200. O
    // `terrainSource` e o caso real, porque e por aqui que o admin edita a fonte do terreno.
    const { erro, valor } = validar(null, {
      terrainSource: { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] },
      maxPitch: 60,
    });
    assert.equal(erro, null);
    assert.deepEqual(valor.terrainSource, { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] });
    assert.equal(valor.maxPitch, 60);
    assert.equal(valor.sourceTileLodParams, null);
  });

  it('a recusa do LOD derruba o PUT INTEIRO, e nao so a chave ruim', () => {
    // Um payload cuja metade boa fosse gravada deixaria o administrador com meia
    // configuracao salva e a tela dizendo que deu certo.
    const { erro } = validar([1, 10.0], { maxPitch: 60 });
    assert.ok(erro);
  });
});
