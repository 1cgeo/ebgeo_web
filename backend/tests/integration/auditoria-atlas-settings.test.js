// Path: tests/integration/auditoria-atlas-settings.test.js
//
// O TERCEIRO BURACO DO CENSO: o overlay de disponibilidade do atlas.
//
// `PATCH /atlas/:atlasId/settings` desliga 3D, 360 e camadas de dados para TODOS os
// membros do atlas de uma vez. Isso é decisão de acesso, e decisão de acesso deixa
// linha — mas a rota não emitia nada, e o censo a nomeava como buraco desde a fase de
// auditoria.
//
// `SHARING_CHANGE` É REUSADA e `details.kind` discrimina. O alvo ATLAS já tem TRÊS
// emissores da mesma ação (anexar recurso, desanexar recurso e agora as settings), e a
// alternativa — uma ação nova — custaria par DROP/ADD CONSTRAINT numa migração para um
// fato que já tem palavra.
//
// A DISCRIMINAÇÃO é o vizinho que NÃO pode mudar: `PUT /atlas/:atlasId` (nome e
// descrição) continua ISENTO por decisão, porque é cosmético e não move eixo nenhum. Sem
// essa metade, um emissor solto em qualquer escrita de atlas passaria verde aqui.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser, createAtlas } from '../helpers/fixtures.js';

describe('Auditoria — o overlay de disponibilidade do atlas deixa linha', () => {
  let app, db, dono, token, atlas;
  const sufixo = randomUUID().slice(0, 8);

  const linhasDoAtlas = async () => (await db.query(
    `SELECT * FROM audit_trail
      WHERE action = 'SHARING_CHANGE' AND target_type = 'ATLAS' AND target_id = $1
      ORDER BY created_at`,
    [atlas.id],
  )).rows;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    dono = await createUser(db, { username: `set_dono_${sufixo}` });
    token = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `Atlas settings ${sufixo}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: o atlas começa sem linha de SHARING_CHANGE', async () => {
    assert.deepEqual(await linhasDoAtlas(), []);
  });

  it('desligar uma superfície emite SHARING_CHANGE com `kind: settings` e os NOMES dos campos', async () => {
    await supertest(app)
      .patch(`/api/v1/atlas/${atlas.id}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ features: { map_3d: false, panoramic_images: false } })
      .expect(200);

    const achadas = await linhasDoAtlas();
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].actor_id, dono.id);
    assert.equal(achadas[0].details.kind, 'settings');
    assert.deepEqual(achadas[0].details.fields, ['features']);
    assert.equal(achadas[0].target_name, atlas.name);
    assert.equal(
      achadas[0].target_org_id, null,
      'atlas não tem OM dona: carimbar a lotação do ator poluiria o filtro por OM',
    );
  });

  it('a DISCRIMINAÇÃO: renomear o atlas continua SEM trilha (isento por decisão)', async () => {
    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Renomeado ${sufixo}` })
      .expect(200);

    assert.equal(
      (await linhasDoAtlas()).length, 1,
      'o metadado cosmético não move eixo de acesso e continua fora da trilha',
    );
  });
});
