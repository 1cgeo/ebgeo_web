// Path: tests/unit/alvo-do-slide-aceita-slug.test.js
//
// O ALVO DO SLIDE 3D/360 NO IMPORT DE ATLAS, e por que este arquivo existe.
//
// O defeito (revisão da transição, achado B3-4): o cliente entregava `model_id`/`photo_id` só
// quando o valor era UUID, e o produto NÃO identifica esses recursos por UUID. O tileset é um
// slug (`museu-1cgeo`) e a foto 360 é um nome de arquivo (`FOTO_0001.jpg`). Medido no banco, com
// o catálogo cadastrado: 1 slide em modo `3d` e 1 em modo `360`, os dois com o alvo NULO.
//
// AS TRÊS FONTES DO SERVIDOR, conferidas antes de mudar qualquer linha, porque duas delas já
// aceitavam string e só a terceira recusava:
//   1. a coluna, `src/database/migrations/003_atlas.sql:435-436`: `VARCHAR(100)`, nunca `uuid`;
//   2. o podador, `src/modules/atlas/atlas-resource-prune.js:211-212` e `:316-329`: lê os dois
//      com `String(...)` e os confere contra o catálogo por id de recurso, que é o slug;
//   3. o Joi, `src/modules/atlas/atlas.schemas.js`, que exigia `.uuid()` e era o único portão
//      que derrubava o slug. É ele que mudou.
//
// A MARCA É O VALOR QUE SOBREVIVE, nunca "não deu erro": `stripUnknown` faz chave descartada
// virar sucesso silencioso, então cada caso confere o valor em `value`, e o teto de 100 vem com
// o par (100 passa, 101 é 422) porque um `.max()` ausente deixaria os dois verdes e a coluna
// receberia o truncamento do Postgres.
//
// Pure Joi, sem banco. As opções são as de `src/middleware/validate.js` (`abortEarly:false`,
// `stripUnknown:true`), senão o teste mediria um schema que ninguém roda.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { importSchema } from '../../src/modules/atlas/atlas.schemas.js';

const VALIDATION_OPTIONS = { abortEarly: false, stripUnknown: true };

/** Monta o menor payload de import válido que carrega um slide. */
function comSlide(slide) {
  return {
    atlas: { name: 'Atlas', description: '' },
    maps: [],
    briefings: [{ id: randomUUID(), name: 'Briefing', slides: [{ id: randomUUID(), ...slide }] }],
  };
}

const valida = (slide) => importSchema.validate(comSlide(slide), VALIDATION_OPTIONS);
const primeiroSlide = (value) => value.briefings[0].slides[0];

describe('importSchema — o alvo do slide 3D e 360', () => {
  it('aceita o SLUG do tileset e o guarda inteiro', () => {
    const { error, value } = valida({ mode: '3d', model_id: 'museu-1cgeo' });
    assert.equal(error, undefined, error?.message);
    assert.equal(primeiroSlide(value).model_id, 'museu-1cgeo');
  });

  it('aceita o NOME DE ARQUIVO da foto 360 e o guarda inteiro', () => {
    const { error, value } = valida({ mode: '360', photo_id: 'FOTO_0001.jpg' });
    assert.equal(error, undefined, error?.message);
    assert.equal(primeiroSlide(value).photo_id, 'FOTO_0001.jpg');
  });

  it('continua aceitando UUID, que é a forma que o servidor cunha', () => {
    const modelo = randomUUID();
    const { error, value } = valida({ mode: '3d', model_id: modelo });
    assert.equal(error, undefined, error?.message);
    assert.equal(primeiroSlide(value).model_id, modelo);
  });

  it('continua aceitando nulo (slide 2D não tem alvo)', () => {
    const { error, value } = valida({ mode: '2d', model_id: null, photo_id: null });
    assert.equal(error, undefined, error?.message);
    assert.equal(primeiroSlide(value).model_id, null);
  });

  // O PIOR CASO QUE ESTE PORTÃO EXISTE PARA PEGAR depois da mudança: o valor que a COLUNA não
  // comporta. Sem `.max(100)` o Joi passaria e o `VARCHAR(100)` do Postgres derrubaria o import
  // inteiro com erro de driver, ou (pior) truncaria em silêncio se alguém trocasse a coluna por
  // `text`. O par 100/101 é o que separa "tem teto" de "não tem".
  it('recusa alvo maior que a coluna (100 caracteres), e aceita exatamente 100', () => {
    const noLimite = 'a'.repeat(100);
    const { error: semErro, value } = valida({ mode: '3d', model_id: noLimite });
    assert.equal(semErro, undefined, 'o valor no teto da coluna tem de passar');
    assert.equal(primeiroSlide(value).model_id, noLimite);

    const { error } = valida({ mode: '3d', model_id: 'a'.repeat(101) });
    assert.ok(error, 'o valor acima do teto da coluna tem de ser recusado pelo Joi');
    assert.match(error.message, /model_id/);
  });

  it('recusa alvo que não é string (objeto e número não chegam à coluna)', () => {
    assert.ok(valida({ mode: '3d', model_id: { id: 'x' } }).error);
    assert.ok(valida({ mode: '360', photo_id: 42 }).error);
  });
});
