// Path: tests/integration/images-bulk-falha-permanente.repro.test.js
//
// CADA ITEM QUE FALHA DIZ SE UMA NOVA TENTATIVA PODE MUDAR O DESFECHO (`permanent`, 2026-09-24).
//
// A resposta do lote é 201 com as falhas dentro, então o status não diz nada por item, e o cliente
// tratava TODA falha por item como definitiva. Um disco cheio (ENOSPC) ou um erro de banco num item
// virava recusa final, e uma foto cuja edição acabara de tirar os bytes inline perdia a única cópia
// no servidor. `permanent: true` é só VALIDAÇÃO (tipo, codificação, tamanho, conteúdo, id tomado por
// outros bytes); o resto é `permanent: false`, e o cliente tenta de novo.
//
// A falha de escrita é provocada como em `images-bulk-error-leak.repro.test.js`: um DIRETÓRIO no
// caminho que o serviço vai gravar, pelo `crypto.randomUUID` fixado.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('POST /images/bulk: a falha por item diz se é permanente', () => {
  let app, db, token, atlas, restaurar = null;

  before(async () => {
    ({ app, db } = await setupTestEnv());
    const owner = await createUser(db, { username: `bulkperm_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Bulk permanente' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  afterEach(() => {
    if (restaurar) restaurar();
    restaurar = null;
  });

  const bulk = (images) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
    .set('Authorization', `Bearer ${token}`)
    .send({ images });

  it('validação é permanente: conteúdo que não bate com o tipo declarado e id com outros bytes', async () => {
    const tomado = randomUUID();
    await bulk([{ localId: tomado, filename: 'a.png', mimeType: 'image/png', data: PNG_B64 }]).expect(201);
    const outros = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(9, 0)]).toString('base64');
    const res = await bulk([
      { localId: randomUUID(), filename: 'b.webp', mimeType: 'image/webp', data: PNG_B64 },
      { localId: randomUUID(), filename: 'c.jpg', mimeType: 'image/jpeg', data: PNG_B64 },
      { localId: tomado, filename: 'd.png', mimeType: 'image/png', data: outros },
    ]).expect(201);
    assert.equal(res.body.data.failed.length, 3);
    assert.deepEqual(res.body.data.failed.map((f) => f.permanent), [true, true, true]);
  });

  it('falha de escrita no disco NÃO é permanente', async () => {
    const localId = randomUUID();
    const uuidRuim = randomUUID();
    const original = crypto.randomUUID;
    const fila = [uuidRuim];
    crypto.randomUUID = () => (fila.length > 0 ? fila.shift() : original());
    const bloqueio = join(config.images.dir, atlas.id, `${uuidRuim}.png`);
    await mkdir(bloqueio, { recursive: true });
    restaurar = () => { crypto.randomUUID = original; };
    try {
      const res = await bulk([{ localId, filename: 'e.png', mimeType: 'image/png', data: PNG_B64 }]).expect(201);
      assert.equal(res.body.data.failed.length, 1, 'o item falha na escrita');
      assert.equal(res.body.data.failed[0].localId, localId);
      assert.equal(res.body.data.failed[0].permanent, false);
    } finally {
      await rm(bloqueio, { recursive: true, force: true });
    }
  });
});
