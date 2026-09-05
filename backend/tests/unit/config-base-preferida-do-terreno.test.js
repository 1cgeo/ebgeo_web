// Path: tests/unit/config-base-preferida-do-terreno.test.js
//
// A BASE PREFERIDA COM O TERRENO LIGADO, servida por GET /api/config, e a borda que o
// administrador atravessa.
//
// O QUE E. `map2d.terrainPreferredBasemap` nomeia uma entrada do catalogo de mapas base, e o
// cliente troca para ela enquanto o terreno 3D esta ligado. `map2d.terrainPreferredBasemapBounds`
// e a cobertura dessa base, `[oeste, sul, leste, norte]` em graus.
//
// POR QUE `null` NOS DOIS. Medido em 2026-09-04 (`docs/wiki/desempenho-do-mapa-2d.md`, que aponta
// o relatorio com o numero de cada causa): com o terreno ligado, uma base RASTER custa de metade
// a um terco do quadro de uma VETORIAL, e segura 60 fps parado na CPU quatro vezes mais lenta.
// So que a base raster que compensa NAO existe em nenhuma das duas linhas do produto: ela e
// gerada por implantacao. Por isso a chave NOMEIA uma base em vez de fixar uma, e por isso o
// padrao servido e nulo, com o cliente fazendo exatamente o que ja fazia.
//
// POR QUE A BORDA EXISTE. `map2d` do schema de override e `.unknown(true)`, entao o editor
// "Avancado (JSON)" do painel ja gravaria as duas chaves SEM checagem nenhuma. Declarar nao cria
// a capacidade, da BORDA a ela: um recorte com o oeste maior que o leste (o antimeridiano, que
// nenhuma das duas linhas trata) salvo ali seria recusado inteiro pelo cliente, e o mecanismo
// ficaria DESLIGADO em silencio, com o painel mostrando o valor salvo. E o mesmo gesto de
// `avisoServidorSecundario`, e pela mesma razao.
//
// O QUE ESTE ARQUIVO NAO ALCANCA: o 422 na ROTA e o efeito no payload servido, que sao de
// `tests/integration/config-admin.test.js`; e o que o cliente faz com a chave, que esta em
// `frontend/tests/unit/terrain-basemap-model.test.js` e `terrain-basemap-wiring.test.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAP2D_BASE } from '../../src/modules/config/config.static.js';
import { configOverridesSchema } from '../../src/modules/config/config.admin.schemas.js';

/**
 * @param {Object} map2d - o bloco `map2d` que o administrador mandaria
 * @returns {{ erro: string|null, valor: * }} a mensagem de recusa, ou o `map2d` aceito
 */
function validar(map2d) {
  const r = configOverridesSchema.validate(
    { map2d },
    { stripUnknown: true, abortEarly: false },
  );
  return { erro: r.error ? r.error.message : null, valor: r.value?.map2d };
}

describe('config.static: a base preferida do terreno servida', () => {
  it('as duas chaves existem no documento e valem `null`', () => {
    // A EXISTENCIA e o que se prende, nao so o valor: o cliente le a chave do objeto que o
    // servidor hidrata, e uma chave AUSENTE aqui faria a fusao do payload cair no piso do
    // cliente em vez de no valor decidido.
    assert.ok('terrainPreferredBasemap' in MAP2D_BASE);
    assert.equal(MAP2D_BASE.terrainPreferredBasemap, null);
    assert.ok('terrainPreferredBasemapBounds' in MAP2D_BASE);
    assert.equal(MAP2D_BASE.terrainPreferredBasemapBounds, null);
  });

  it('CONTROLE: as vizinhas de `map2d` continuam com o valor delas', () => {
    // Sem isto, um `MAP2D_BASE` inteiro zerado passaria no caso acima.
    assert.equal(typeof MAP2D_BASE.minZoom, 'number');
    assert.equal(typeof MAP2D_BASE.maxZoom, 'number');
    assert.equal(typeof MAP2D_BASE.maxPitch, 'number');
    assert.equal(typeof MAP2D_BASE.globe_projection, 'boolean');
    assert.equal(typeof MAP2D_BASE.hillshade, 'object');
  });
});

describe('config.admin.schemas: a borda da base preferida', () => {
  it('`null` passa, que e o valor servido, e um id passa', () => {
    assert.equal(validar({ terrainPreferredBasemap: null }).erro, null);
    assert.equal(validar({ terrainPreferredBasemap: 'carta-ortoimagem' }).erro, null);
    assert.equal(validar({ terrainPreferredBasemap: '' }).erro, null, 'a string vazia desliga, como no miniMapBasemap');
  });

  it('recusa o que nao e id: objeto, array, numero e id gordo', () => {
    for (const ruim of [{}, ['osm'], 7, true, 'x'.repeat(101)]) {
      const { erro } = validar({ terrainPreferredBasemap: ruim });
      assert.ok(erro, `${JSON.stringify(ruim)} devia ter sido recusado`);
      assert.match(erro, /terrainPreferredBasemap/);
    }
  });

  it('OBSERVADO: NAO checa se o id existe no catalogo, e a omissao e deliberada', () => {
    // A MESMA escolha de `streetView360.miniMapBasemap`, escrita ali: o catalogo muda por
    // OUTRA rota (/resources), entao um mapa base apagado depois deixaria a configuracao
    // invalida sem que ninguem salvasse nada. Quem resolve e o cliente, que so troca para um id
    // presente em `BaseLayerControl.availableBasemaps` e nao faz nada com os outros.
    assert.equal(validar({ terrainPreferredBasemap: 'base-que-nunca-existiu' }).erro, null);
  });

  it('o recorte aceita `null` e um [oeste, sul, leste, norte] valido', () => {
    assert.equal(validar({ terrainPreferredBasemapBounds: null }).erro, null);
    assert.equal(validar({ terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1] }).erro, null);
    assert.deepEqual(
      validar({ terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1] }).valor.terrainPreferredBasemapBounds,
      [-58.1, -33.4, -48.7, -27.1],
    );
  });

  it('o recorte recusa forma errada: tres numeros, cinco, texto e nao-numero dentro', () => {
    for (const ruim of [[-58.1, -33.4, -48.7], [-58.1, -33.4, -48.7, -27.1, 0], 'sul', [-58.1, -33.4, -48.7, null]]) {
      assert.ok(validar({ terrainPreferredBasemapBounds: ruim }).erro, `${JSON.stringify(ruim)} devia cair`);
    }
  });

  it('o recorte recusa grau fora de faixa, na posicao certa', () => {
    assert.ok(validar({ terrainPreferredBasemapBounds: [-200, -33.4, -48.7, -27.1] }).erro, 'oeste < -180');
    assert.ok(validar({ terrainPreferredBasemapBounds: [-58.1, -33.4, 200, -27.1] }).erro, 'leste > 180');
    assert.ok(validar({ terrainPreferredBasemapBounds: [-58.1, -100, -48.7, -27.1] }).erro, 'sul < -90');
    assert.ok(validar({ terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, 100] }).erro, 'norte > 90');
    // A FAIXA E POR POSICAO, e 100 e o numero que prova isso: e longitude legitima e latitude
    // impossivel, entao passa nas posicoes impares e cai nas pares.
    assert.equal(validar({ terrainPreferredBasemapBounds: [100, -33.4, 120, -27.1] }).erro, null, '100 e longitude valida');
    assert.ok(validar({ terrainPreferredBasemapBounds: [-58.1, 100, -48.7, 120] }).erro, '100 nao e latitude');
  });

  it('O PIOR CASO: o recorte invertido morre AQUI, em vez de desligar o mecanismo calado', () => {
    // Sul acima do norte, e oeste a leste do leste (a caixa que cruza o antimeridiano). O
    // cliente recusa as duas INTEIRAS e o mecanismo simplesmente para de trocar de base, sem
    // dizer nada a ninguem: o administrador ve o valor salvo no painel e o produto ignorando.
    assert.ok(validar({ terrainPreferredBasemapBounds: [-58.1, -27.1, -48.7, -33.4] }).erro, 'sul > norte');
    assert.ok(validar({ terrainPreferredBasemapBounds: [170, -20, -170, 20] }).erro, 'oeste > leste');
  });

  it('declarar as chaves NAO passa a descartar as chaves avancadas irmas', () => {
    // A armadilha desta casa: o middleware roda todo schema com `stripUnknown: true`, e uma
    // secao que perdesse o `.unknown(true)` gravaria o objeto podado em silencio, com 200. O
    // `terrainSource` e o caso real, porque e por aqui que o admin edita a fonte do terreno.
    const { erro, valor } = validar({
      terrainPreferredBasemap: 'carta-ortoimagem',
      terrainPreferredBasemapBounds: [-58.1, -33.4, -48.7, -27.1],
      terrainSource: { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] },
      hillshade: { enabled: true },
      maxPitch: 60,
      sourceTileLodParams: null,
    });
    assert.equal(erro, null);
    assert.deepEqual(valor.terrainSource, { type: 'raster-dem', tiles: ['/x/{z}/{x}/{y}'] });
    assert.deepEqual(valor.hillshade, { enabled: true });
    assert.equal(valor.maxPitch, 60);
    assert.equal(valor.sourceTileLodParams, null);
    assert.equal(valor.terrainPreferredBasemap, 'carta-ortoimagem');
  });

  it('a recusa da base preferida derruba o PUT INTEIRO, e nao so a chave ruim', () => {
    // Um payload cuja metade boa fosse gravada deixaria o administrador com meia
    // configuracao salva e a tela dizendo que deu certo.
    assert.ok(validar({ terrainPreferredBasemap: 7, maxPitch: 60 }).erro);
    assert.ok(validar({ terrainPreferredBasemapBounds: [170, -20, -170, 20], maxPitch: 60 }).erro);
  });
});
