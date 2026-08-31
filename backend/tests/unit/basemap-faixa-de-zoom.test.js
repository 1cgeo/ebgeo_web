// Path: tests/unit/basemap-faixa-de-zoom.test.js
//
// A FAIXA DE ZOOM PASSOU A TER UM NÍVEL CONFIGURÁVEL SÓ (decisão do dono, 2026-08-31), e este
// arquivo mede as DUAS metades da borda de escrita que a mudança criou:
//
//   1. o `config` do MAPA BASE aceita `minzoom`/`maxzoom` entre 2 e 21, e recusa fora disso;
//   2. o override de `map2d` do administrador RECUSA `minZoom`/`maxZoom`, que viraram fixos.
//
// A segunda é a que não se prova sozinha. `map2d` é `.unknown(true)`, então apagar as duas
// chaves do schema (em vez de as marcar `forbidden`) deixaria o corpo passar, gravaria em
// `config_settings` e o deep-merge derrubaria o valor fixo em silêncio. Um teste que só olhasse
// `config.static.js` veria 2 e 21 e aprovaria essa implementação.
//
// Joi puro nos dois casos, sem banco. As opções são as de `validate.js`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schemasDeEscrita } from '../../src/modules/catalog/catalog.schemas.js';
import { configOverridesSchema } from '../../src/modules/config/config.admin.schemas.js';
import { MAP2D_BASE } from '../../src/modules/config/config.static.js';

const OPCOES = { abortEarly: false, stripUnknown: true };
const mapaBase = schemasDeEscrita('basemaps');
const camadaDeDados = schemasDeEscrita('data_layers');
const zoom = (config) => mapaBase.update.validate({ config }, OPCOES);

describe('a faixa de zoom do MAPA BASE', () => {
  it('aceita as bordas, e as duas são inclusivas', () => {
    assert.equal(zoom({ minzoom: 2, maxzoom: 21 }).error, undefined);
    assert.equal(zoom({ minzoom: 2, maxzoom: 2 }).error, undefined, 'faixa degenerada é legítima');
    assert.equal(zoom({ minzoom: 21, maxzoom: 21 }).error, undefined);
  });

  it('recusa fora de [2, 21], nos dois lados e nas duas chaves', () => {
    for (const config of [{ minzoom: 1 }, { minzoom: 0 }, { minzoom: -1 }, { maxzoom: 1 }]) {
      assert.ok(zoom(config).error, `abaixo do piso: ${JSON.stringify(config)}`);
    }
    for (const config of [{ minzoom: 22 }, { maxzoom: 22 }, { maxzoom: 24 }]) {
      assert.ok(zoom(config).error, `acima do teto: ${JSON.stringify(config)}`);
    }
  });

  it('recusa minzoom > maxzoom, e SAYS SO', () => {
    // A única falha que nenhuma das duas bordas vê sozinha, e a que produz o pior estado no
    // cliente: `setMinZoom` acima do `setMaxZoom` prende a câmera onde nenhum tile desenha.
    const { error } = zoom({ minzoom: 15, maxzoom: 8 });
    assert.ok(error, 'faixa invertida não pode ser gravada');
    assert.match(error.message, /minzoom/);
  });

  it('aceita minzoom === maxzoom (a comparação é >, não >=)', () => {
    assert.equal(zoom({ minzoom: 10, maxzoom: 10 }).error, undefined);
  });

  it('A OMISSÃO É VALOR: mapa base sem as chaves passa', () => {
    assert.equal(zoom({ enabled: true, priority: 1 }).error, undefined);
  });

  it('texto numérico é CONVERTIDO, e não gravado como texto', () => {
    // `validate.js` roda com conversão, e um `"15"` que virasse texto no JSONB faria o
    // cliente reprovar a chave no `Number.isFinite` e cair no padrão, sem erro nenhum.
    const { error, value } = zoom({ minzoom: '15', maxzoom: '20' });
    assert.equal(error, undefined);
    assert.equal(typeof value.config.minzoom, 'number');
    assert.equal(value.config.minzoom, 15);
  });

  it('`null` é recusado: vazio REMOVE a chave, não a zera', () => {
    assert.ok(zoom({ minzoom: null }).error);
  });

  it('SÓ O MAPA BASE tem a régua: em camada de dados o zoom é da FONTE e continua livre', () => {
    // Ali `minzoom` diz a partir de que zoom o tile existe, não onde a câmera pode ir, e
    // apertá-lo em [2, 21] recusaria configuração legítima de tile server.
    assert.equal(camadaDeDados.update.validate({ config: { minzoom: 0, maxzoom: 22 } }, OPCOES).error, undefined);
  });
});

describe('a faixa de zoom da APLICAÇÃO é fixa', () => {
  it('vale [2, 21]', () => {
    assert.equal(MAP2D_BASE.minZoom, 2);
    assert.equal(MAP2D_BASE.maxZoom, 21);
  });

  it('o override do administrador RECUSA as duas, em vez de as ignorar', () => {
    // O ponto do teste: `map2d` é `.unknown(true)`, então uma chave apenas RETIRADA do schema
    // passaria e seria gravada. A recusa tem de ser nomeada.
    for (const map2d of [{ minZoom: 3 }, { maxZoom: 18 }, { minZoom: 3, maxZoom: 18 }]) {
      const { error } = configOverridesSchema.validate({ map2d }, OPCOES);
      assert.ok(error, `deveria recusar ${JSON.stringify(map2d)}`);
      assert.match(error.message, /Zoom/i);
    }
  });

  it('o resto de map2d continua editável', () => {
    const { error } = configOverridesSchema.validate(
      { map2d: { maxPitch: 70, globe_projection: false } }, OPCOES,
    );
    assert.equal(error, undefined);
  });
});
