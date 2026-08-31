// Path: tests/unit/atlas-settings-schema.test.js
// Item 73. `atlasSettingsSchema` carries a custom validator (`atlas.schemas.js`) enforcing
// default_basemap ∈ basemaps. Every PATCH in the integration suite sends a VALID payload, so
// the custom branch has never executed with a violating one: delete it, or invert the
// comparison, and everything stays green. This is pure Joi, no database.
//
// O ZOOM DE ATLAS SAIU em 2026-08-31 (decisão do dono), e a regra irmã que cruzava
// `min_zoom <= max_zoom` saiu com ele. O que ficou no lugar não é a ausência de teste: é o
// teste da REMOÇÃO, abaixo, que reprova tanto o estado anterior (par invertido era 422, par
// válido era gravado) quanto uma reintrodução silenciosa da chave.
//
// The options must match validate.js exactly (`abortEarly:false, stripUnknown:true`),
// otherwise the unit test would be checking a schema nobody runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atlasSettingsSchema } from '../../src/modules/atlas/atlas.schemas.js';

const VALIDATION_OPTIONS = { abortEarly: false, stripUnknown: true };
const check = (payload) => atlasSettingsSchema.validate(payload, VALIDATION_OPTIONS);

describe('atlasSettingsSchema — the custom cross-field validator', () => {
  // O TESTE DA REMOÇÃO, e ele mede o DESTINO do valor, não a ausência de erro: `stripUnknown`
  // faz uma chave removida do schema virar 200 silencioso, então "não deu erro" sozinho passa
  // igual antes e depois. O que separa os dois mundos é `value.min_zoom` não existir.
  //
  // O PAR INVERTIDO é o insumo de propósito: ele era 422 antes desta mudança, e um `min_zoom`
  // reintroduzido no schema por descuido o faria voltar a ser 422 (ou, sem a regra irmã, o
  // faria ser GRAVADO invertido). Nos dois casos este teste fica vermelho.
  it('o zoom de atlas foi removido: min_zoom/max_zoom são DESCARTADOS, nunca gravados', () => {
    const { error, value } = check({ min_zoom: 15, max_zoom: 8, bounds_2d: null });
    assert.equal(error, undefined, 'a chave que saiu do schema não é erro, é descarte');
    assert.equal(value.min_zoom, undefined, 'min_zoom não pode chegar ao banco');
    assert.equal(value.max_zoom, undefined, 'max_zoom não pode chegar ao banco');
    assert.ok('bounds_2d' in value, 'o irmão declarado sobrevive ao mesmo payload');
  });

  it('rejects a default_basemap that is not in the basemaps list, and SAYS SO', () => {
    const { error } = check({ basemaps: ['osm'], default_basemap: 'satellite' });
    assert.ok(error);
    assert.match(error.message, /default_basemap/);
    assert.ok(!error.message.includes('bounds_2d'), 'a regra que falhou se nomeia');
  });

  it('accepts a default_basemap present in the list', () => {
    assert.equal(check({ basemaps: ['osm', 'satellite'], default_basemap: 'osm' }).error, undefined);
  });

  it('CHARACTERIZATION: an EMPTY basemaps list disables the membership check', () => {
    // The guard requires `basemaps.length > 0`, so this passes today. Pinned so that
    // making the check unconditional is a visible decision and not a silent break.
    const { error, value } = check({ basemaps: [], default_basemap: 'osm' });
    assert.equal(error, undefined);
    assert.equal(value.default_basemap, 'osm');
  });

  it('CHARACTERIZATION: default_basemap alone (no basemaps key) is unconstrained', () => {
    assert.equal(check({ default_basemap: 'whatever' }).error, undefined);
  });

  it('bounds_2d must be exactly two pairs of two numbers', () => {
    assert.equal(check({ bounds_2d: [[-45, -23], [-42, -21]] }).error, undefined);
    assert.equal(check({ bounds_2d: null }).error, undefined);
    assert.ok(check({ bounds_2d: [[-45, -23], [-42, -21], [0, 0]] }).error, 'three pairs');
    assert.ok(check({ bounds_2d: [[-45, -23, 1], [-42, -21, 1]] }).error, 'triples, not pairs');
    assert.ok(check({ bounds_2d: [[-45, -23]] }).error, 'a single pair');
  });

  it('an unknown key is stripped, not rejected (stripUnknown, as validate.js runs it)', () => {
    const { error, value } = check({ foo: 1, basemaps: ['osm'] });
    assert.equal(error, undefined);
    assert.equal(value.foo, undefined);
    assert.deepEqual(value.basemaps, ['osm'], 'the known sibling survives');
  });
});
