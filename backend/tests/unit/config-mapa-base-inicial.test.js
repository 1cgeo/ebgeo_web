// Path: tests/unit/config-mapa-base-inicial.test.js
//
// O `map2d.defaultBasemap` servido por GET /api/config, e a borda de TIPO que o admin atravessa.
//
// O QUE E. A base com que o mapa nasce ao abrir e com que nasce todo documento de mapa novo. Era a
// constante `DEFAULT_LAYER` do cliente (`carta-topografica`) ate 2026-09-23, quando o dono pediu
// que ela fosse escolha do administrador, na aba "Sistema". O padrao servido e o valor da
// constante, entao uma implantacao sem override continua igual.
//
// A BORDA TEM DUAS METADES, e esta e so a primeira. O Joi confere o TIPO (texto de ate 100
// caracteres, nunca vazio, nunca nulo: um mapa sempre tem base). Se o id EXISTE no catalogo e do
// servico (`assertDefaultBasemapKnown`), porque o Joi roda sem banco; o caso e da integracao,
// `tests/integration/config-mapa-base-inicial.test.js`, junto com o 422 na rota e o primeiro mapa
// de um atlas novo. O campo na tela e do cliente
// (`frontend/tests/unit/admin-mapa-base-inicial.test.js`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAP2D_BASE } from '../../src/modules/config/config.static.js';
import { configOverridesSchema } from '../../src/modules/config/config.admin.schemas.js';

/**
 * @param {*} valor - o que o administrador mandaria em `map2d.defaultBasemap`
 * @returns {{ erro: string|null, valor: * }} a mensagem de recusa, ou o valor aceito
 */
function validar(valor) {
  const r = configOverridesSchema.validate(
    { map2d: { defaultBasemap: valor } },
    { stripUnknown: true, abortEarly: false },
  );
  return { erro: r.error ? r.error.message : null, valor: r.value?.map2d?.defaultBasemap };
}

describe('config.static: a base padrao servida', () => {
  it('e a carta topografica, o valor da constante que ela substitui', () => {
    assert.equal(MAP2D_BASE.defaultBasemap, 'carta-topografica');
  });

  it('e um id que o catalogo semeado traz, e nao um nome solto', () => {
    // CONTROLE: um padrao que nao fosse id de catalogo passaria no caso acima e faria todo mapa
    // novo nascer referenciando uma base que ninguem oferece.
    const ids = ['carta-topografica', 'carta-ortoimagem', 'bdgex', 'osm', 'imagens'];
    assert.ok(ids.includes(MAP2D_BASE.defaultBasemap));
  });
});

describe('a borda do override: o tipo da base padrao', () => {
  it('aceita um id de catalogo', () => {
    assert.equal(validar('osm').erro, null);
    assert.equal(validar('osm').valor, 'osm');
    assert.equal(validar('carta-topografica').valor, 'carta-topografica');
  });

  it('apara os espacos, que um formulario ou um PUT a mao trazem com facilidade', () => {
    // Sem aparar, `" osm"` seria gravado e nao casaria com id nenhum, nem aqui nem no cliente.
    assert.equal(validar('  osm ').valor, 'osm');
  });

  it('RECUSA o vazio e o nulo: nao existe "sem base", ao contrario de `terrainPreferredBasemap`', () => {
    for (const ruim of ['', '   ', null]) {
      const r = validar(ruim);
      assert.ok(r.erro, `\`defaultBasemap: ${JSON.stringify(ruim)}\` tem de morrer na borda`);
      assert.match(r.erro, /defaultBasemap/);
    }
  });

  it('RECUSA o que nao e texto', () => {
    for (const ruim of [1, true, [], {}, ['osm']]) {
      assert.ok(validar(ruim).erro, `\`defaultBasemap: ${JSON.stringify(ruim)}\` tem de morrer na borda`);
    }
  });

  it('RECUSA o id gordo, maior que a coluna de id do catalogo (`VARCHAR(100)`)', () => {
    assert.ok(validar('x'.repeat(101)).erro);
    assert.equal(validar('x'.repeat(100)).erro, null);
  });

  it('a base padrao sozinha nao arrasta as vizinhas de `map2d`', () => {
    const r = configOverridesSchema.validate(
      { map2d: { defaultBasemap: 'osm' } },
      { stripUnknown: true, abortEarly: false },
    );
    assert.equal(r.error, undefined);
    assert.deepEqual(Object.keys(r.value.map2d), ['defaultBasemap']);
  });
});
